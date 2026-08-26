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
});
