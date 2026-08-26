import { load } from "cheerio";
import type {
  ProgramDocument,
  ProgramDocumentBlock,
  ProgramDocumentSection,
  ProgramDocumentTable,
} from "../domain/models.js";

const cleanText = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();

const tableFrom = ($: ReturnType<typeof load>, table: Parameters<ReturnType<typeof load>>[0]): ProgramDocumentTable => {
  const rows = $(table)
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("th,td")
        .toArray()
        .map((cell) => cleanText($(cell).text())),
    )
    .filter((row) => row.length > 0);
  const headerIndex = rows.reduce(
    (best, row, index) => row.length > rows[best]?.length ? index : best,
    0,
  );
  return {
    headers: headerIndex >= 0 ? rows[headerIndex] : [],
    rows: headerIndex >= 0 ? rows.slice(headerIndex + 1) : [],
  };
};

const blocksFrom = ($: ReturnType<typeof load>, elements: Parameters<ReturnType<typeof load>>[0][]): ProgramDocumentBlock[] => {
  const blocks: ProgramDocumentBlock[] = [];
  const seenCourseCodes = new Set<string>();
  for (const element of elements) {
    const node = $(element);
    if (node.is("table")) {
      blocks.push({ type: "table", table: tableFrom($, element) });
    }
    node.find("[data-cid]").addBack("[data-cid]").each((_, course) => {
      const code = cleanText($(course).attr("data-cid") ?? "");
      if (code && !seenCourseCodes.has(code)) {
        seenCourseCodes.add(code);
        blocks.push({ type: "course", code, text: cleanText($(course).text()) });
      }
    });
    if (node.is("table")) continue;
    if (node.is("p,li,blockquote")) {
      const text = cleanText(node.text());
      if (text) blocks.push({ type: "paragraph", text });
    }
  }
  return blocks;
};

export const normalizeProgramDocument = (
  html: string,
  code: string,
  title: string,
  sourcePath: string,
): ProgramDocument => {
  const $ = load(html);
  $("script,style,noscript").remove();
  const headings = $("h2").toArray();
  const sections: ProgramDocumentSection[] = [];
  const allCourseCodes: string[] = [];

  headings.forEach((heading, index) => {
    const elements: Parameters<ReturnType<typeof load>>[0][] = [];
    let next = $(heading).next();
    while (next.length > 0 && !next.is("h2")) {
      elements.push(next.get(0));
      next = next.next();
    }
    const blocks = blocksFrom($, elements);
    for (const block of blocks) {
      if (block.type === "course" && !allCourseCodes.includes(block.code)) {
        allCourseCodes.push(block.code);
      }
    }
    sections.push({
      id: `h${index}`,
      title: cleanText($(heading).text()),
      blocks,
    });
  });

  if (sections.length === 0) {
    const blocks = blocksFrom($, $("body").children().toArray());
    for (const block of blocks) {
      if (block.type === "course" && !allCourseCodes.includes(block.code)) {
        allCourseCodes.push(block.code);
      }
    }
    sections.push({ id: "body", title, blocks });
  }

  return { code, title, sourcePath, sections, courseCodes: allCourseCodes };
};
