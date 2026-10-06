import { describe, expect, it, vi } from "vitest";
import { expandProgramDocumentTable, normalizeProgramDocument } from "../src/adapters/program-document.js";
import { emitResult } from "../src/presentation/output.js";
import { programDocumentRows } from "../src/presentation/rows.js";

describe("static program document adapter", () => {
  it("extracts headings, tables and course references without executing HTML", () => {
    const document = normalizeProgramDocument(
      `<h2>培养要求</h2><p>正文</p><table><tr><th>课程</th><th>学分</th></tr><tr><td><span data-cid="MATH1001">数学分析</span></td><td>6</td></tr></table>`,
      "001001",
      "数学与应用数学专业",
      "/data/program/cn/001001.html",
    );
    expect(document.sections[0].title).toBe("培养要求");
    expect(document.courseCodes).toEqual(["MATH1001"]);
    expect(document.sections[0].blocks.some((block) => block.type === "table")).toBe(true);
    expect(document.sections[0].blocks.some((block) => block.type === "course")).toBe(true);
  });

  it("keeps heading levels, links and images from the static document", () => {
    const document = normalizeProgramDocument(
      `<article><figure><img src="001_title.jpg" alt="标题图"></figure><h1>数学与应用数学专业培养方案</h1><section><h2>课程要求</h2><h3>通修课程</h3><p><a href="https://example.com/course">课程说明</a></p></section></article>`,
      "001001",
      "数学与应用数学专业",
      "/data/program/cn/001001.html",
    );

    expect(document.sections.map((section) => [section.level, section.title])).toEqual([
      [2, "课程要求"],
      [3, "通修课程"],
    ]);
    expect(document.sections[0].blocks).toContainEqual({
      type: "image",
      src: "001_title.jpg",
      alt: "标题图",
    });
    expect(document.sections[1].blocks).toContainEqual({
      type: "paragraph",
      text: "课程说明",
      links: [{ text: "课程说明", href: "https://example.com/course" }],
    });
  });

  it("preserves footnotes before table headers and line breaks", () => {
    const document = normalizeProgramDocument(
      `<h2>课程</h2><table><tfoot><tr><td>脚注说明</td></tr></tfoot><thead><tr><th>课程</th><th>学分</th></tr></thead><tbody><tr><td>分析</td><td>6</td></tr></tbody></table><p>第一行<br>第二行</p>`,
      "001001",
      "数学专业",
      "/data/program/cn/001001.html",
    );
    const table = document.sections[0].blocks.find((block) => block.type === "table");
    const paragraph = document.sections[0].blocks.find((block) => block.type === "paragraph");
    expect(table).toMatchObject({ type: "table", table: { headers: ["课程", "学分"], rows: [["分析", "6"]], footnotes: ["脚注说明"] } });
    expect(paragraph).toMatchObject({ type: "paragraph", text: "第一行 第二行" });
  });

  it("extracts multiple header rows inside tbody without dropping them or the data", () => {
    const document = normalizeProgramDocument(
      `<h2>课程</h2><table><tbody><tr><th rowspan="2">课程</th><th colspan="2">要求</th></tr><tr><th>学分</th><th>门数</th></tr><tr><td>分析</td><td>6</td><td>1</td></tr></tbody></table>`,
      "001001",
      "数学专业",
      "/data/program/cn/001001.html",
    );
    const table = document.sections[0].blocks.find((block) => block.type === "table");
    expect(table).toMatchObject({
      type: "table",
      table: {
        headers: ["课程", "要求"],
        headerRows: [["课程", "要求"], ["学分", "门数"]],
        rows: [["分析", "6", "1"]],
      },
    });
  });

  it("preserves table captions and merged cells, and expands spans for terminal and CSV rows", () => {
    const document = normalizeProgramDocument(
      `<h2>要求</h2><table><caption>分类要求</caption><thead><tr><th rowspan="2">类别</th><th colspan="2">课程要求</th></tr><tr><th>学分</th><th>门数</th></tr></thead><tbody><tr><td rowspan="2">通修</td><td>80.5</td><td>20</td></tr><tr><td colspan="2">共享规则</td></tr></tbody><tfoot><tr><td colspan="3">以方案要求为准</td></tr></tfoot></table>`,
      "001001",
      "数学与应用数学专业",
      "/data/program/cn/001001.html",
    );
    const tableBlock = document.sections[0].blocks.find((block) => block.type === "table");
    expect(tableBlock).toMatchObject({
      type: "table",
      table: {
        caption: "分类要求",
        headers: ["类别", "课程要求"],
        headerRows: [["类别", "课程要求"], ["学分", "门数"]],
        cellSpans: expect.arrayContaining([
          { section: "header", row: 0, cell: 0, rowSpan: 2, colSpan: 1 },
          { section: "header", row: 0, cell: 1, rowSpan: 1, colSpan: 2 },
          { section: "body", row: 0, cell: 0, rowSpan: 2, colSpan: 1 },
          { section: "body", row: 1, cell: 0, rowSpan: 1, colSpan: 2 },
        ]),
      },
    });
    if (tableBlock?.type !== "table") throw new Error("expected a table block");
    const expanded = expandProgramDocumentTable(tableBlock.table);
    expect(expanded.headerRows).toEqual([
      ["类别", "课程要求", "课程要求"],
      ["类别", "学分", "门数"],
    ]);
    expect(expanded.rows).toEqual([
      ["通修", "80.5", "20"],
      ["通修", "共享规则", "共享规则"],
    ]);
    expect(expanded.footnoteRows).toEqual([["以方案要求为准", "以方案要求为准", "以方案要求为准"]]);

    const rows = programDocumentRows(document);
    expect(rows).toContainEqual(expect.objectContaining({ 类型: "表格", 表题: "分类要求", 行类型: "表头", 列1: "类别" }));
    expect(rows).toContainEqual(expect.objectContaining({ 类型: "表格", 表题: "分类要求", 行类型: "数据", 行号: 3, 列1: "通修" }));

    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      { meta: { resource: "program-document", scope: "001001", source: "network", fetchedAt: "now", stale: false }, data: document },
      { format: "csv", limit: undefined, offset: 0, all: true, noColor: true, quiet: true },
      50,
      { tableRows: rows, tableTotal: rows.length },
    );
    const csv = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(csv).toContain("表题");
    expect(csv).toContain("列1,列2,列3");
    expect(csv).toContain("通修,共享规则,共享规则");
    write.mockRestore();
  });
});
