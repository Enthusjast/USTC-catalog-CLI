import Table from "cli-table3";
import { stringify } from "csv-stringify/sync";
import chalk from "chalk";
import type { ResultEnvelope } from "../domain/models.js";
import { CliError } from "../domain/errors.js";

export type OutputOptions = {
  format: "table" | "json" | "csv";
  offline?: boolean;
  limit?: number;
  offset: number;
  all: boolean;
  noColor: boolean;
  wide?: boolean;
  quiet: boolean;
};

export type OutputPayload = {
  tableRows?: DisplayRow[];
  tableTotal?: number;
};

export type DisplayRow = Record<string, unknown>;

type ResultLike<T> = ResultEnvelope<T> | { value: T; meta: ResultEnvelope<T>["meta"] };

const primitive = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(primitive).filter(Boolean).join("、");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const normalizeRows = (data: unknown): DisplayRow[] => {
  if (!Array.isArray(data)) return [data as DisplayRow];
  return data.map((value) => {
    if (!value || typeof value !== "object") return { 值: value };
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, primitive(item)]),
    );
  });
};

const columnsFor = (rows: DisplayRow[]): string[] =>
  [...new Set(rows.flatMap((row) => Object.keys(row)))];

const sliceRows = <T>(rows: T[], options: OutputOptions, pageSize: number): T[] => {
  if (options.format !== "table") {
    const start = options.offset;
    return options.limit === undefined ? rows.slice(start) : rows.slice(start, start + options.limit);
  }
  const limit = options.all ? rows.length : options.limit ?? pageSize;
  return rows.slice(options.offset, options.offset + limit);
};

const jsonSafe = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "searchText")
        .map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
};

const sourceName = (source: string): string =>
  source === "cache" ? "缓存" : source === "static" ? "静态" : source === "mixed" ? "混合" : "网络";

const printMeta = (meta: ResultEnvelope<unknown>["meta"], options: OutputOptions): void => {
  if (options.quiet) return;
  const dataAsOf = meta.dataAsOf ? `，数据时间：${meta.dataAsOf}` : "";
  process.stdout.write(`数据来源：${sourceName(meta.source)}，抓取时间：${meta.fetchedAt}${dataAsOf}\n`);
};

export const emitResult = <T>(
  envelope: ResultLike<T>,
  options: OutputOptions,
  pageSize = 25,
  payload: OutputPayload = {},
): void => {
  const value = "data" in envelope ? envelope.data : envelope.value;
  const isArray = Array.isArray(value);
  if (!isArray && options.offset > 0) {
    throw new CliError("ARGUMENT_ERROR", "详情对象不支持 --offset；请只对列表结果使用分页参数。");
  }
  const data = isArray ? value : [value];
  const selected = isArray ? sliceRows(data, options, pageSize) : data;
  if (envelope.meta.stale && !options.quiet) {
    const dataAsOf = envelope.meta.dataAsOf ? `，数据时间：${envelope.meta.dataAsOf}` : "";
    const warning = options.offline
      ? `提示：使用离线缓存数据。抓取时间：${envelope.meta.fetchedAt}${dataAsOf}`
      : `警告：网络请求失败，使用缓存数据。抓取时间：${envelope.meta.fetchedAt}${dataAsOf}`;
    process.stderr.write(`${options.noColor ? warning : chalk.yellow(warning)}\n`);
  }

  if (options.format === "json") {
    const jsonData = isArray ? selected : selected[0];
    process.stdout.write(`${JSON.stringify({ meta: envelope.meta, data: jsonSafe(jsonData) }, null, 2)}\n`);
    return;
  }

  const rows = payload.tableRows
    ? sliceRows(payload.tableRows, options, pageSize)
    : normalizeRows(selected);
  if (options.format === "csv") {
    const columns = columnsFor(payload.tableRows ?? rows);
    process.stdout.write(stringify(rows, { header: true, columns, bom: true }));
    return;
  }

  if (!rows.length) {
    printMeta(envelope.meta, options);
    process.stdout.write("未找到符合条件的数据。\n");
    return;
  }
  const columns = columnsFor(rows);
  const table = new Table({
    head: options.noColor ? columns : columns.map((column) => chalk.cyan(column)),
    style: options.noColor ? { head: [], border: [] } : undefined,
    wordWrap: true,
    colWidths: columns.map((column) => {
      const naturalWidth = Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)) + 4;
      const identityColumn = /编号|代码|日期|时间|课堂号|考试ID|教室|学期ID/.test(column);
      return options.wide || identityColumn ? Math.max(10, naturalWidth) : Math.min(32, Math.max(10, column.length + 4));
    }),
  });
  for (const row of rows) table.push(columns.map((column) => primitive(row[column])));
  process.stdout.write(`${table.toString()}\n`);
  printMeta(envelope.meta, options);
  const totalRows = payload.tableTotal ?? payload.tableRows?.length ?? data.length;
  if (!options.all && totalRows > rows.length) {
    const nextStep = options.limit === undefined ? "使用 --all 查看全部" : "使用 --offset 查看后续记录";
    process.stdout.write(`共 ${totalRows} 条，当前显示 ${rows.length} 条；${nextStep}。\n`);
  }
};

export const emitMessage = (message: string): void => {
  process.stdout.write(`${message}\n`);
};
