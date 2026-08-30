import { describe, expect, it, vi } from "vitest";
import { emitResult } from "../src/presentation/output.js";

describe("output contracts", () => {
  it("unions columns for mixed table rows in CSV", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "test", scope: "all", source: "network", fetchedAt: "now", stale: false },
        data: [{ id: 1 }, { id: 2 }],
      },
      { format: "csv", limit: undefined, offset: 0, all: true, noColor: true, quiet: true },
      25,
      { tableRows: [{ 模块ID: 1, 类型: "模块" }, { 模块ID: 2, 课程编号: "MATH1001", 课程名: "数学分析" }] },
    );
    const output = String(write.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("模块ID,类型,课程编号,课程名");
    expect(output).toContain("2,,MATH1001,数学分析");
    write.mockRestore();
  });

  it("rejects offset for object-shaped results", () => {
    try {
      emitResult(
        {
          meta: { resource: "test", scope: "one", source: "network", fetchedAt: "now", stale: false },
          data: { id: 1 },
        },
        { format: "json", limit: undefined, offset: 1, all: false, noColor: true, quiet: true },
      );
      throw new Error("expected an argument error");
    } catch (error) {
      expect(error).toMatchObject({ code: "ARGUMENT_ERROR" });
    }
  });

  it("does not truncate object-shaped details with --limit", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "test", scope: "detail", source: "network", fetchedAt: "now", stale: false },
        data: { id: 1 },
      },
      { format: "json", limit: 0, offset: 0, all: false, noColor: true, quiet: true },
    );
    const output = String(write.mock.calls[0]?.[0] ?? "");
    expect(JSON.parse(output).data).toEqual({ id: 1 });
    write.mockRestore();
  });

  it("labels static results as static in human-readable output", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "program-catalog", scope: "all", source: "static", fetchedAt: "now", stale: false },
        data: { label: "目录", value: "内置" },
      },
      { format: "table", limit: undefined, offset: 0, all: true, noColor: true, quiet: false },
      25,
      { tableRows: [{ 名称: "目录", 内容: "内置" }] },
    );
    expect(write.mock.calls.flat().join("")).toContain("数据来源：静态");
    write.mockRestore();
  });

  it("distinguishes explicit offline cache use from network fallback", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "test", scope: "offline", source: "cache", fetchedAt: "now", stale: true },
        data: [{ id: 1 }],
      },
      { format: "table", offline: true, limit: undefined, offset: 0, all: true, noColor: true, quiet: false },
      25,
    );
    expect(stderr.mock.calls.flat().join("")).toContain("使用离线缓存数据");
    expect(stderr.mock.calls.flat().join("")).not.toContain("网络请求失败");
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
