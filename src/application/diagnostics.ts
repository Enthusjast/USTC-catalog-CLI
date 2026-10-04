import fs from "node:fs";
import path from "node:path";
import { CliError } from "../domain/errors.js";
import type { AppConfig } from "../infrastructure/config/paths.js";
import { databasePath } from "../infrastructure/config/paths.js";
import { CacheDatabase } from "../infrastructure/cache/database.js";
import { CatalogApiClient } from "../infrastructure/http/catalog-api-client.js";

export type DiagnosticCheck = {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

export const runDiagnostics = async (config: AppConfig, offline: boolean): Promise<DiagnosticCheck[]> => {
  const checks: DiagnosticCheck[] = [];
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const supported = major > 20 || (major === 20 && (minor > 18 || (minor === 18 && patch >= 1)));
  checks.push({
    name: "Node.js",
    status: supported ? "ok" : "error",
    detail: `${process.versions.node}（要求 >=20.18.1）`,
  });

  let memoryDatabase: CacheDatabase | undefined;
  try {
    memoryDatabase = new CacheDatabase(":memory:");
    memoryDatabase.db.prepare("SELECT 1").get();
    checks.push({ name: "SQLite", status: "ok", detail: "better-sqlite3 可打开内存数据库" });
  } catch (error) {
    checks.push({ name: "SQLite", status: "error", detail: error instanceof Error ? error.message : String(error) });
  } finally {
    memoryDatabase?.close();
  }

  const cacheFile = databasePath(config);
  let existingParent = path.dirname(cacheFile);
  while (existingParent !== path.dirname(existingParent)) {
    try {
      await fs.promises.access(existingParent, fs.constants.W_OK);
      break;
    } catch {
      existingParent = path.dirname(existingParent);
    }
  }
  let writable = false;
  try {
    await fs.promises.access(existingParent, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    name: "缓存目录",
    status: writable ? "ok" : "error",
    detail: `${cacheFile}（${writable ? "父目录可写，未创建数据库文件" : "父目录不可写"}）`,
  });

  if (offline) {
    checks.push({ name: "网站 API", status: "warning", detail: "已按 --offline 跳过网络检查" });
  } else {
    try {
      const response = await new CatalogApiClient(config).restricted();
      checks.push({
        name: "网站 API",
        status: response.data.restricted ? "warning" : "ok",
        detail: response.data.restricted ? "API 可达，但当前进入统一认证限制模式" : `API 可达（HTTP ${response.status}）`,
      });
    } catch (error) {
      const detail = error instanceof CliError ? `${error.code}：${error.message}` : String(error);
      checks.push({ name: "网站 API", status: "error", detail });
    }
  }
  return checks;
};
