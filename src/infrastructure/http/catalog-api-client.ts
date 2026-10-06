import { request } from "undici";
import { CliError } from "../../domain/errors.js";
import type { AppConfig } from "../config/paths.js";
import { validateApiPayload } from "./schemas.js";

export type ApiResult<T> = {
  data: T;
  status: number;
  fetchedAt: string;
  path: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export class CatalogApiClient {
  private activeRequests = 0;
  private readonly waitingRequests: Array<() => void> = [];

  constructor(private readonly config: AppConfig) {}

  async get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>("GET", path, undefined, "json");
  }

  async getText(path: string): Promise<ApiResult<string>> {
    return this.request<string>("GET", path, undefined, "text");
  }

  async post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>("POST", path, body, "json");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    responseType: "json" | "text" = "json",
  ): Promise<ApiResult<T>> {
    const url = new URL(path, this.config.baseUrl).toString();
    const maxAttempts = method === "GET" ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const release = await this.acquire();
      try {
        const response = await request(url, {
          method,
          headers: {
            accept: "application/json",
            "user-agent": this.config.userAgent,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          headersTimeout: this.config.timeoutMs,
          bodyTimeout: this.config.timeoutMs,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        const advertisedLength = Number(response.headers["content-length"]);
        if (Number.isFinite(advertisedLength) && advertisedLength > MAX_RESPONSE_BYTES) {
          response.body.destroy();
          throw new CliError(
            "REMOTE_RESPONSE_TOO_LARGE",
            `${method} ${path} 返回内容超过 ${MAX_RESPONSE_BYTES} 字节上限。`,
            "请调整查询范围，或稍后重试较小的数据范围。",
          );
        }
        const chunks: Buffer[] = [];
        let responseBytes = 0;
        for await (const chunk of response.body) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += bytes.byteLength;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            response.body.destroy();
            throw new CliError(
              "REMOTE_RESPONSE_TOO_LARGE",
              `${method} ${path} 返回内容超过 ${MAX_RESPONSE_BYTES} 字节上限。`,
              "请调整查询范围，或稍后重试较小的数据范围。",
            );
          }
          chunks.push(bytes);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        const contentType = String(response.headers["content-type"] ?? "");

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new CliError(
            response.statusCode === 404 ? "REMOTE_NOT_FOUND" : "REMOTE_HTTP_ERROR",
            `${method} ${path} 返回 HTTP ${response.statusCode}`,
            text.slice(0, 240) || undefined,
          );
        }

        let data: T;
        if (responseType === "text") {
          data = text as T;
        } else {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch (error) {
            throw new CliError(
              "REMOTE_INVALID_JSON",
              `${method} ${path} 返回的不是有效 JSON（${contentType || "未知类型"}）`,
              text.slice(0, 240),
              error,
            );
          }
          data = validateApiPayload<T>(path, parsed);
        }

        return {
          data,
          status: response.statusCode,
          fetchedAt: new Date().toISOString(),
          path,
        };
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof CliError) && attempt < maxAttempts;
        if (!retryable) break;
        await sleep(200 * 2 ** (attempt - 1));
      } finally {
        release();
      }
    }

    if (lastError instanceof CliError) throw lastError;
    throw new CliError(
      "NETWORK_ERROR",
      `无法访问 catalog：${method} ${path}`,
      "请检查网络，或使用 --offline 读取缓存。",
      lastError,
    );
  }

  private async acquire(): Promise<() => void> {
    if (this.activeRequests >= 3) {
      await new Promise<void>((resolve) => this.waitingRequests.push(resolve));
    }
    this.activeRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRequests -= 1;
      this.waitingRequests.shift()?.();
    };
  }

  restricted() {
    return this.get<{ restricted: boolean }>("/api/restricted");
  }

  coursePublic(id: string) {
    return this.get<unknown>(`/api/teach/course/public/${encodeURIComponent(id)}`);
  }

  courseQuality() {
    return this.get<unknown>("/api/teach/course/quality");
  }

  courseDepartment(id: string) {
    return this.get<unknown>(`/api/teach/course/department/${encodeURIComponent(id)}`);
  }

  courseSearch(keyword: string) {
    return this.get<unknown[]>(
      `/api/teach/course/search?keyword=${encodeURIComponent(keyword)}`,
    );
  }

  courseInfos(codes: string[]) {
    return this.post<unknown[]>("/api/teach/course/infos", { codes });
  }

  departmentTree() {
    return this.get<unknown[]>("/api/teach/department/college-tree");
  }

  programTree() {
    return this.get<Record<string, unknown>>("/api/teach/program/tree");
  }

  programInfo(id: number) {
    return this.get<unknown>(`/api/teach/program/info/${id}`);
  }

  moduleInfo(id: number) {
    return this.get<unknown>(`/api/teach/course-module/info/${id}`);
  }

  semesters() {
    return this.get<unknown[]>("/api/teach/semester/list");
  }

  lessons(semesterId: number) {
    return this.get<unknown[]>(`/api/teach/lesson/list-for-teach/${semesterId}`);
  }

  lessonInfos(codes: string[], semester: number) {
    return this.post<unknown[]>("/api/teach/lesson/infos", { codes, semester });
  }

  exams(semesterId: number) {
    return this.get<unknown[]>(`/api/teach/exam/list/${semesterId}`);
  }

  generalExams(semesterId: number) {
    return this.get<unknown[]>(`/api/teach/general-exam/list/${semesterId}`);
  }

  substitutes() {
    return this.get<unknown[]>("/api/teach/course-substitute-pool/list");
  }

  timetable(date: string) {
    return this.get<{ timetable: Record<string, unknown[]> }>(
      `/api/teach/timetable-public-all/${date}`,
    );
  }

  programDocument(code: string) {
    return this.getText(`/data/program/cn/${encodeURIComponent(code)}.html`);
  }

  programHistory() {
    return this.getText("https://www.teach.ustc.edu.cn/education/241.html");
  }
}
