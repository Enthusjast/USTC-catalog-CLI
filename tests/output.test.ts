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
});
