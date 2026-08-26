import os from "node:os";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://catalog.ustc.edu.cn";

export type AppConfig = {
  baseUrl: string;
  cacheDir: string;
  timeoutMs: number;
  userAgent: string;
};

const defaultCacheDir = (): string => {
  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "catalog-cli");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "catalog-cli");
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "catalog-cli");
  }
  return path.join(os.homedir(), ".cache", "catalog-cli");
};

export const loadConfig = (overrides?: Partial<AppConfig>): AppConfig => ({
  baseUrl: overrides?.baseUrl ?? process.env.CATALOG_BASE_URL ?? DEFAULT_BASE_URL,
  cacheDir: overrides?.cacheDir ?? process.env.CATALOG_CACHE_DIR ?? defaultCacheDir(),
  timeoutMs: overrides?.timeoutMs ?? Number(process.env.CATALOG_TIMEOUT_MS ?? 15_000),
  userAgent:
    overrides?.userAgent ??
    process.env.CATALOG_USER_AGENT ??
    "ustc-catalog-cli/0.1.0",
});

export const databasePath = (config: AppConfig): string =>
  path.join(config.cacheDir, "catalog.sqlite");
