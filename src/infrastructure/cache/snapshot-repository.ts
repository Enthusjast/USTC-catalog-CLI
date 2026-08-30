import crypto from "node:crypto";
import zlib from "node:zlib";
import type { AppConfig } from "../config/paths.js";
import { databasePath } from "../config/paths.js";
import { CacheDatabase, type SnapshotRow, type SnapshotStat } from "./database.js";
import { CliError } from "../../domain/errors.js";

export type CachedValue<T> = {
  value: T;
  fetchedAt: string;
  dataAsOf?: string | null;
  payloadHash: string;
  status: number | null;
};

const serialize = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf8");

const hash = (payload: Buffer): string =>
  crypto.createHash("sha256").update(payload).digest("hex");

export class SnapshotRepository {
  private databaseInstance?: CacheDatabase;
  private readonly filePathValue: string;

  constructor(config: AppConfig) {
    this.filePathValue = databasePath(config);
  }

  get database(): CacheDatabase {
    if (!this.databaseInstance) {
      try {
        this.databaseInstance = new CacheDatabase(this.filePathValue);
      } catch (error) {
        throw new CliError("CACHE_ERROR", "无法打开或迁移 SQLite 缓存。", "请检查 --cache-dir 的权限或删除损坏的数据库后重试。", error);
      }
    }
    return this.databaseInstance;
  }

  get filePath(): string {
    return this.filePathValue;
  }

  read<T>(resource: string, scopeKey: string): CachedValue<T> | null {
    let row: SnapshotRow | null;
    try {
      row = this.database.get(resource, scopeKey);
    } catch (error) {
      throw new CliError("CACHE_ERROR", "无法读取 SQLite 缓存。", "请检查缓存数据库是否损坏。", error);
    }
    if (!row) return null;
    try {
      const payload = row.payloadEncoding === "gzip"
        ? zlib.gunzipSync(row.payloadJson)
        : row.payloadJson;
      const actualHash = hash(payload);
      if (actualHash !== row.payloadHash) {
        throw new CliError(
          "CACHE_ERROR",
          `缓存快照 ${resource}/${scopeKey} 的完整性校验失败。`,
          "删除该资源缓存后重新联网获取。",
        );
      }
      return {
        value: JSON.parse(payload.toString("utf8")) as T,
        fetchedAt: row.fetchedAt,
        dataAsOf: row.dataAsOf,
        payloadHash: row.payloadHash,
        status: row.httpStatus,
      };
    } catch (error) {
      throw new CliError("CACHE_ERROR", `缓存快照 ${resource}/${scopeKey} 已损坏。`, "删除该资源缓存后重新联网获取。", error);
    }
  }

  write<T>(
    resource: string,
    scopeKey: string,
    requestKey: string,
    value: T,
    status = 200,
    dataAsOf: string | null = null,
    fetchedAt?: string,
  ): CachedValue<T> {
    const payload = serialize(value);
    const storedPayload = zlib.gzipSync(payload);
    const snapshotFetchedAt = fetchedAt ?? new Date().toISOString();
    const payloadHash = hash(payload);
    const row: SnapshotRow = {
      resource,
      scopeKey,
      requestKey,
      fetchedAt: snapshotFetchedAt,
      dataAsOf,
      httpStatus: status,
      payloadHash,
      payloadJson: storedPayload,
      payloadEncoding: "gzip",
      byteSize: storedPayload.byteLength,
    };
    try {
      this.database.put(row);
    } catch (error) {
      throw new CliError("CACHE_ERROR", "无法写入 SQLite 缓存。", "请检查缓存目录权限或磁盘空间。", error);
    }
    return { value, fetchedAt: snapshotFetchedAt, dataAsOf, payloadHash, status };
  }

  clear(resource?: string): number {
    try {
      return this.database.clear(resource);
    } catch (error) {
      throw new CliError("CACHE_ERROR", "无法清理 SQLite 缓存。", "请检查缓存数据库权限或完整性。", error);
    }
  }

  stats(): SnapshotStat[] {
    try {
      return this.database.stats();
    } catch (error) {
      throw new CliError("CACHE_ERROR", "无法读取缓存统计信息。", "请检查缓存数据库是否损坏。", error);
    }
  }

  totalBytes(): number {
    try {
      return this.database.totalBytes();
    } catch (error) {
      throw new CliError("CACHE_ERROR", "无法读取缓存大小。", "请检查缓存数据库是否损坏。", error);
    }
  }

  close(): void {
    this.databaseInstance?.close();
  }
}
