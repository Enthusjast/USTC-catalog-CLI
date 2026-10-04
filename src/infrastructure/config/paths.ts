import os from "node:os";
import path from "node:path";
import { CLI_VERSION } from "../../version.js";
import { CliError } from "../../domain/errors.js";

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

export const defaultConfigDir = (): string => {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "catalog-cli");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "catalog-cli");
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "catalog-cli");
  return path.join(os.homedir(), ".config", "catalog-cli");
};

export const loadConfig = (overrides?: Partial<AppConfig>): AppConfig => {
  const config: AppConfig = {
    baseUrl: overrides?.baseUrl ?? process.env.CATALOG_BASE_URL ?? DEFAULT_BASE_URL,
    cacheDir: overrides?.cacheDir ?? process.env.CATALOG_CACHE_DIR ?? defaultCacheDir(),
    timeoutMs: overrides?.timeoutMs ?? Number(process.env.CATALOG_TIMEOUT_MS ?? 15_000),
    userAgent:
      overrides?.userAgent ??
      process.env.CATALOG_USER_AGENT ??
      `ustc-catalog-cli/${CLI_VERSION}`,
  };
  let baseUrl: URL;
  try {
    baseUrl = new URL(config.baseUrl);
  } catch (error) {
    throw new CliError("ARGUMENT_ERROR", "CATALOG_BASE_URL 必须是有效的 HTTP 或 HTTPS 地址。", undefined, error);
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new CliError("ARGUMENT_ERROR", "CATALOG_BASE_URL 只支持 HTTP 或 HTTPS 地址。");
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new CliError("ARGUMENT_ERROR", "CATALOG_TIMEOUT_MS 必须是正整数。 ");
  }
  if (!config.cacheDir.trim()) {
    throw new CliError("ARGUMENT_ERROR", "CATALOG_CACHE_DIR 不能为空。");
  }
  return config;
};

export const databasePath = (config: AppConfig): string =>
  path.join(config.cacheDir, "catalog.sqlite");
