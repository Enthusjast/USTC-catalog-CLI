import { describe, expect, it } from "vitest";
import { normalizeProgramDocument } from "../src/adapters/program-document.js";

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

  it("extracts a header row inside tbody without dropping it or its data", () => {
    const document = normalizeProgramDocument(
      `<h2>课程</h2><table><tbody><tr><th>课程</th><th>学分</th></tr><tr><td>分析</td><td>6</td></tr></tbody></table>`,
      "001001",
      "数学专业",
      "/data/program/cn/001001.html",
    );
    const table = document.sections[0].blocks.find((block) => block.type === "table");
    expect(table).toMatchObject({ type: "table", table: { headers: ["课程", "学分"], rows: [["分析", "6"]] } });
  });
});
