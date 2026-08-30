import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CliProcessError, CliProcessExecutor } from "../src/mcp-cli-runner.js";

const temporaryScript = (body: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ustc-catalog-mcp-runner-"));
  const file = path.join(directory, "fake-cli.mjs");
  fs.writeFileSync(file, body, "utf8");
  return file;
};

const validEnvelope = JSON.stringify({
  meta: {
    resource: "test",
    scope: "one",
    source: "network",
    fetchedAt: "2026-08-26T00:00:00.000Z",
    stale: false,
  },
  data: { ok: true },
});

describe("CliProcessExecutor", () => {
  it("executes the fixed Node entrypoint without a shell and parses the envelope", async () => {
    const script = temporaryScript(`
      import { writeSync } from "node:fs";
      writeSync(1, JSON.stringify({
        meta: { resource: "test", scope: "args", source: "network", fetchedAt: "now", stale: false },
        data: { argv: process.argv.slice(2) }
      }));
    `);
    const marker = `${script}.shell-marker`;
    const executor = new CliProcessExecutor({ entryPath: script });

    const shellExpression = `$(touch ${marker})`;
    const result = await executor.run(["course", "search", shellExpression]);

    expect(result.data).toEqual({ argv: ["--json", "course", "search", shellExpression] });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("parses the CLI error code and hint from stderr", async () => {
    const script = temporaryScript(`
      import { writeSync } from "node:fs";
      writeSync(2, "错误 [CACHE_MISS]：没有缓存。\\n提示：请先联网查询。\\n");
      process.exitCode = 3;
    `);
    const executor = new CliProcessExecutor({ entryPath: script });

    await expect(executor.run(["--offline", "course", "search", "数学"]))
      .rejects.toMatchObject({
        code: "CACHE_MISS",
        message: "没有缓存。",
        hint: "请先联网查询。",
        exitCode: 3,
      });
  });

  it("reports malformed output", async () => {
    const script = temporaryScript("process.stdout.write('not-json');");
    const executor = new CliProcessExecutor({ entryPath: script });

    await expect(executor.run([])).rejects.toMatchObject({ code: "MCP_INVALID_OUTPUT" });
  });

  it("terminates a CLI process that exceeds the MCP timeout", async () => {
    const script = temporaryScript("setTimeout(() => process.stdout.write('" + validEnvelope + "'), 2000);");
    const executor = new CliProcessExecutor({ entryPath: script, timeoutMs: 100 });

    await expect(executor.run([])).rejects.toMatchObject({
      code: "MCP_TIMEOUT",
    } satisfies Partial<CliProcessError>);
  });
});
