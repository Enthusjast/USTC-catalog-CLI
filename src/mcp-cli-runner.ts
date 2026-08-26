import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";

export type CatalogEnvelope = {
  meta: Record<string, unknown>;
  data: unknown;
};

export type CliExecutor = {
  run(args: readonly string[], signal?: AbortSignal): Promise<CatalogEnvelope>;
};

export class CliProcessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly hint?: string,
    public readonly exitCode?: number | null,
    public readonly signal?: NodeJS.Signals | null,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CliProcessError";
  }
}

export type CliProcessExecutorOptions = {
  entryPath?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
};

type SpawnedCliProcess = ChildProcessByStdio<null, Readable, Readable>;

const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;

const positiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const defaultProcessTimeout = (): number =>
  positiveInteger(process.env.CATALOG_MCP_PROCESS_TIMEOUT_MS) ?? DEFAULT_PROCESS_TIMEOUT_MS;

const defaultCliEntry = (): string => fileURLToPath(new URL("./main.js", import.meta.url));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseEnvelope = (stdout: string): CatalogEnvelope => {
  let value: unknown;
  try {
    value = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new CliProcessError(
      "MCP_INVALID_OUTPUT",
      "catalog 返回的不是有效 JSON。",
      "请检查 CLI 版本或使用 CATALOG_DEBUG 获取更多诊断信息。",
      0,
      null,
      error,
    );
  }
  if (!isRecord(value) || !isRecord(value.meta) || !("data" in value)) {
    throw new CliProcessError(
      "MCP_INVALID_OUTPUT",
      "catalog 返回的 JSON 不符合 meta/data 结构。",
      "请检查 CLI 版本是否与 MCP 入口匹配。",
      0,
      null,
    );
  }
  return { meta: value.meta, data: value.data };
};

const parseCliStderr = (stderr: string, exitCode: number | null, signal: NodeJS.Signals | null): CliProcessError => {
  const errorLine = stderr.match(/^错误 \[([^\]]+)\]：([^\n]*)/m);
  const hintLine = stderr.match(/^提示：([^\n]*)/m);
  if (errorLine) {
    return new CliProcessError(
      errorLine[1],
      errorLine[2] || "catalog 命令失败。",
      hintLine?.[1],
      exitCode,
      signal,
    );
  }
  const reason = signal ? `信号 ${signal}` : `退出码 ${exitCode ?? "未知"}`;
  return new CliProcessError(
    "MCP_CLI_EXITED",
    `catalog 进程异常结束（${reason}）。`,
    "请检查 CLI 安装和 CATALOG_* 环境变量。",
    exitCode,
    signal,
  );
};

export class CliProcessExecutor implements CliExecutor {
  private readonly entryPath: string;
  private readonly timeoutMs: number;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: CliProcessExecutorOptions = {}) {
    this.entryPath = options.entryPath ?? defaultCliEntry();
    this.timeoutMs = options.timeoutMs ?? defaultProcessTimeout();
    this.environment = { ...process.env, ...options.environment };
  }

  run(args: readonly string[], signal?: AbortSignal): Promise<CatalogEnvelope> {
    return new Promise<CatalogEnvelope>((resolve, reject) => {
      let child: SpawnedCliProcess;
      try {
        child = spawn(process.execPath, [this.entryPath, "--json", ...args], {
          cwd: process.cwd(),
          env: this.environment,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(new CliProcessError(
          "MCP_EXECUTION_ERROR",
          "无法启动 catalog 进程。",
          "请检查 Node.js 和 CLI 安装。",
          null,
          null,
          error,
        ));
        return;
      }

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        callback();
      };

      const abort = (): void => {
        child.kill("SIGTERM");
        finish(() => reject(new CliProcessError(
          "MCP_CANCELLED",
          "MCP 请求已取消。",
          "可以重新发起相同查询。",
        )));
      };

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", (error) => finish(() => reject(new CliProcessError(
        "MCP_EXECUTION_ERROR",
        "catalog 进程执行失败。",
        "请检查 Node.js、CLI 文件和缓存目录权限。",
        null,
        null,
        error,
      ))));
      child.once("close", (exitCode, exitSignal) => finish(() => {
        if (exitCode === 0) {
          try {
            resolve(parseEnvelope(Buffer.concat(stdout).toString("utf8").trim()));
          } catch (error) {
            reject(error);
          }
          return;
        }
        reject(parseCliStderr(Buffer.concat(stderr).toString("utf8"), exitCode, exitSignal));
      }));

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => reject(new CliProcessError(
          "MCP_TIMEOUT",
          `catalog 查询超过 ${this.timeoutMs} 毫秒仍未完成。`,
          "可设置 CATALOG_MCP_PROCESS_TIMEOUT_MS 延长 MCP 进程超时时间。",
        )));
      }, this.timeoutMs);

      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

type WaitingTask = {
  args: readonly string[];
  signal?: AbortSignal;
  resolve: (value: CatalogEnvelope | PromiseLike<CatalogEnvelope>) => void;
  reject: (reason?: unknown) => void;
  cancelled: boolean;
  cleanup: () => void;
};

export const MCP_MAX_CONCURRENT_CLI_PROCESSES = 3;

export class LimitedCliExecutor implements CliExecutor {
  private active = 0;
  private readonly waiting: WaitingTask[] = [];

  constructor(
    private readonly delegate: CliExecutor,
    private readonly maximum = MCP_MAX_CONCURRENT_CLI_PROCESSES,
  ) {}

  run(args: readonly string[], signal?: AbortSignal): Promise<CatalogEnvelope> {
    return new Promise<CatalogEnvelope>((resolve, reject) => {
      let cleanup = (): void => undefined;
      const task: WaitingTask = { args, signal, resolve, reject, cancelled: false, cleanup: () => cleanup() };
      if (signal?.aborted) {
        reject(new CliProcessError("MCP_CANCELLED", "MCP 请求已取消。"));
        return;
      }
      const onAbort = (): void => {
        if (task.cancelled) return;
        task.cancelled = true;
        reject(new CliProcessError("MCP_CANCELLED", "MCP 请求已取消。"));
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        cleanup = () => signal.removeEventListener("abort", onAbort);
      }
      this.waiting.push(task);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.maximum && this.waiting.length > 0) {
      const task = this.waiting.shift();
      if (!task) continue;
      if (task.cancelled) {
        task.cleanup();
        continue;
      }
      this.active += 1;
      void Promise.resolve()
        .then(() => this.delegate.run(task.args, task.signal))
        .then(task.resolve, task.reject)
        .finally(() => {
          task.cleanup();
          this.active -= 1;
          this.drain();
        });
    }
  }
}
