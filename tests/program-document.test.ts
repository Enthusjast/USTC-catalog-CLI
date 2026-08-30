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
});
