import fs from "node:fs/promises";
import path from "node:path";
import { CliError } from "../../domain/errors.js";

export type QueryPreset = {
  name: string;
  args: string[];
  updatedAt: string;
};

const validName = (name: string): boolean =>
  name.length > 0 && name.length <= 40 && /^[\p{L}\p{N}_-]+$/u.test(name);

const isKnownReadOnlyCommand = (args: string[]): boolean => {
  let index = 0;
  while (index < args.length && args[index].startsWith("--")) {
    const option = args[index++];
    if (["--json", "--csv", "--ics", "--offline", "--no-cache", "--all", "--no-color", "--quiet", "--verbose"].includes(option)) continue;
    if (["--limit", "--offset", "--timeout", "--semester", "--department", "--major", "--grade", "--type", "--term", "--date", "--building", "--keyword", "--available", "--free-period", "--course", "--teacher", "--location", "--span", "--weekday", "--period", "--week", "--class-type", "--course-type", "--course-classify", "--sort", "--desc", "--class", "--education", "--include-invalid", "--mode", "--multiple", "--single", "--courses"].includes(option)) {
      if (index < args.length && !args[index].startsWith("--")) index += 1;
      continue;
    }
    return false;
  }
  const [group, action] = args.slice(index, index + 2);
  if (group === "calendar") return args.length === index + 1;
  if (group === "semester" || group === "department") return action === "list";
  if (group === "course") return ["search", "list", "show", "categories"].includes(action ?? "");
  if (group === "program") return ["catalog", "document", "history", "list", "show", "module"].includes(action ?? "");
  if (group === "lesson") return ["list", "options", "show", "conflicts"].includes(action ?? "");
  if (group === "classroom") return ["list", "show", "week", "available", "buildings"].includes(action ?? "");
  if (group === "exam") return ["list", "show"].includes(action ?? "");
  if (group === "substitute") return ["list", "summary"].includes(action ?? "");
  return false;
};

export const validatePresetArgs = (args: string[]): string[] => {
  const normalized = args[0] === "--" ? args.slice(1) : [...args];
  const presentationAndExecutionFlags = new Set([
    "--json", "--csv", "--ics", "--offline", "--no-cache", "--cache-dir", "--timeout",
    "--limit", "--offset", "--all", "--no-color", "--wide", "--quiet", "--verbose",
  ]);
  const savedGlobal = normalized.find((arg) => presentationAndExecutionFlags.has(arg.split("=", 1)[0]));
  if (savedGlobal) {
    throw new CliError("ARGUMENT_ERROR", `预设不能保存全局参数 ${savedGlobal}；运行预设时可单独指定输出与缓存参数。`);
  }
  if (!isKnownReadOnlyCommand(normalized)) {
    throw new CliError("ARGUMENT_ERROR", "预设只支持公开只读查询命令，不能保存 cache clear 或未知命令。");
  }
  return normalized;
};

export class PresetStore {
  private readonly filePath: string;

  constructor(configDir: string) {
    this.filePath = path.join(configDir, "presets.json");
  }

  private async write(data: Record<string, QueryPreset>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
    await fs.chmod(this.filePath, 0o600);
  }

  private async read(): Promise<Record<string, QueryPreset>> {
    try {
      const text = await fs.readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid preset file");
      const entries = Object.entries(parsed as Record<string, unknown>);
      for (const [key, value] of entries) {
        const preset = value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : undefined;
        if (
          !validName(key) ||
          !preset ||
          preset.name !== key ||
          !Array.isArray(preset.args) ||
          !preset.args.every((arg: unknown) => typeof arg === "string") ||
          typeof preset.updatedAt !== "string"
        ) throw new Error(`invalid preset: ${key}`);
      }
      return parsed as Record<string, QueryPreset>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new CliError("CONFIG_ERROR", "无法读取查询预设文件。", "检查用户配置目录中的 presets.json。", error);
    }
  }

  async list(): Promise<QueryPreset[]> {
    return Object.values(await this.read()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async get(name: string): Promise<QueryPreset> {
    if (!validName(name)) throw new CliError("ARGUMENT_ERROR", "预设名只能含中文、字母、数字、下划线或连字符，且不超过 40 字符。");
    const preset = (await this.read())[name];
    if (!preset) throw new CliError("ARGUMENT_ERROR", `没有名为“${name}”的查询预设。`);
    return { ...preset, args: validatePresetArgs(preset.args) };
  }

  async save(name: string, args: string[], replace = false): Promise<QueryPreset> {
    if (!validName(name)) throw new CliError("ARGUMENT_ERROR", "预设名只能含中文、字母、数字、下划线或连字符，且不超过 40 字符。");
    const data = await this.read();
    if (data[name] && !replace) throw new CliError("ARGUMENT_ERROR", `预设“${name}”已存在；使用 --replace 才能覆盖。`);
    const preset = { name, args: validatePresetArgs(args), updatedAt: new Date().toISOString() };
    data[name] = preset;
    try {
      await this.write(data);
    } catch (error) {
      throw new CliError("CONFIG_ERROR", "无法保存查询预设。", "检查用户配置目录的写入权限。", error);
    }
    return preset;
  }

  async delete(name: string): Promise<boolean> {
    if (!validName(name)) throw new CliError("ARGUMENT_ERROR", "预设名只能含中文、字母、数字、下划线或连字符，且不超过 40 字符。");
    const data = await this.read();
    if (!data[name]) return false;
    delete data[name];
    try {
      await this.write(data);
    } catch (error) {
      throw new CliError("CONFIG_ERROR", "无法删除查询预设。", "检查用户配置目录的写入权限。", error);
    }
    return true;
  }
}
