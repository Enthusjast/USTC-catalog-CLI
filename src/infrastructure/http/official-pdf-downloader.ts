import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CliError } from "../../domain/errors.js";
import { CLI_VERSION } from "../../version.js";

const OFFICIAL_HOST = "www.teach.ustc.edu.cn";
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type DownloadedOfficialPdf = {
  path: string;
  sizeBytes: number;
  sha256: string;
  url: string;
};

const validateOfficialUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== OFFICIAL_HOST || url.username || url.password || url.port) {
    throw new CliError("REMOTE_INVALID_DATA", "官方 PDF 地址跳转到了不受信任的位置。", `只允许 HTTPS ${OFFICIAL_HOST}。`);
  }
  return url;
};

const readResponseBytes = async (response: Response): Promise<Buffer> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new CliError("REMOTE_RESPONSE_TOO_LARGE", `官方 PDF 超过 ${MAX_DOWNLOAD_BYTES} 字节上限。`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CliError("REMOTE_INVALID_DATA", "官方 PDF 响应没有文件内容。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new CliError("REMOTE_RESPONSE_TOO_LARGE", `官方 PDF 超过 ${MAX_DOWNLOAD_BYTES} 字节上限。`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
};

const fetchPdf = async (
  sourceUrl: string,
  options: { timeoutMs: number; userAgent: string; referer: string },
): Promise<{ bytes: Buffer; url: string }> => {
  let currentUrl = validateOfficialUrl(sourceUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: {
          accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
          referer: options.referer,
          "user-agent": options.userAgent,
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      throw new CliError("NETWORK_ERROR", "无法访问教务处官方 PDF。", "请检查网络后重试。", error);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === MAX_REDIRECTS) {
        throw new CliError("REMOTE_HTTP_ERROR", "官方 PDF 下载重定向次数过多或缺少跳转地址。");
      }
      try {
        currentUrl = validateOfficialUrl(new URL(location, currentUrl).toString());
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError("REMOTE_INVALID_DATA", "官方 PDF 返回了无效的跳转地址。", undefined, error);
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CliError("REMOTE_HTTP_ERROR", `教务处官方 PDF 返回 HTTP ${response.status}。`);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/pdf") {
      await response.body?.cancel();
      throw new CliError("REMOTE_INVALID_DATA", `官方附件的响应类型不是 PDF（${contentType ?? "未知"}）。`);
    }
    let bytes: Buffer;
    try {
      bytes = await readResponseBytes(response);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("NETWORK_ERROR", "下载教务处 PDF 时连接中断。", "请检查网络后重试。", error);
    }
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new CliError("REMOTE_INVALID_DATA", "教务处附件没有有效的 PDF 文件签名，未写入磁盘。");
    }
    return { bytes, url: currentUrl.toString() };
  }
  throw new CliError("REMOTE_HTTP_ERROR", "官方 PDF 下载重定向次数过多。");
};

export const downloadOfficialPdf = async (
  sourceUrl: string,
  outputPath: string,
  options: {
    timeoutMs?: number;
    userAgent?: string;
    referer: string;
  },
): Promise<DownloadedOfficialPdf> => {
  if (!outputPath.trim()) throw new CliError("ARGUMENT_ERROR", "必须提供非空文件路径。");
  const destination = path.resolve(outputPath);
  const directory = path.dirname(destination);
  try {
    const directoryStat = await fs.stat(directory);
    if (!directoryStat.isDirectory()) throw new CliError("FILE_ERROR", `目标父路径不是目录：${directory}`);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("FILE_ERROR", `无法使用目标父目录：${directory}`, "请确认目录存在且可写。", error);
  }
  try {
    await fs.access(directory, constants.W_OK);
  } catch (error) {
    throw new CliError("FILE_ERROR", `目标父目录不可写：${directory}`, undefined, error);
  }
  try {
    await fs.lstat(destination);
    throw new CliError("ARGUMENT_ERROR", `目标文件已存在，不会覆盖：${destination}`);
  } catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new CliError("FILE_ERROR", `无法检查目标文件：${destination}`, undefined, error);
    }
  }

  const { bytes, url } = await fetchPdf(sourceUrl, {
    timeoutMs: options.timeoutMs ?? 15_000,
    userAgent: options.userAgent ?? `ustc-catalog-cli/${CLI_VERSION}`,
    referer: options.referer,
  });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new CliError("ARGUMENT_ERROR", `目标文件已存在，不会覆盖：${destination}`);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("FILE_ERROR", `无法保存官方 PDF：${destination}`, "请检查目标目录的写入权限和剩余空间。", error);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }

  return {
    path: destination,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url,
  };
};
