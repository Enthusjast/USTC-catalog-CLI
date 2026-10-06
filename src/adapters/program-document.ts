import { load } from "cheerio";
import type {
  ProgramDocument,
  ProgramDocumentBlock,
  ProgramDocumentLink,
  ProgramDocumentSection,
  ProgramDocumentTable,
} from "../domain/models.js";

const cleanText = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();

const nodeText = ($: ReturnType<typeof load>, node: CheerioInput): string => {
  const copy = $(node).clone();
  copy.find("br").replaceWith(" ");
  return cleanText(copy.text());
};

type CheerioInput = Parameters<ReturnType<typeof load>>[0];

const linksFrom = ($: ReturnType<typeof load>, node: CheerioInput): ProgramDocumentLink[] =>
  $(node)
    .find("a")
    .addBack("a")
    .toArray()
    .map((link) => ({
      text: cleanText($(link).text()),
      href: cleanText($(link).attr("href") ?? ""),
    }))
    .filter((link) => link.href.length > 0);

const tableFrom = ($: ReturnType<typeof load>, table: Parameters<ReturnType<typeof load>>[0]): ProgramDocumentTable => {
  const tableNode = $(table);
  const rowsFor = (selector: string): CheerioInput[] => tableNode.find(selector).toArray();
  const rowCells = (row: CheerioInput): string[] => $(row).find("th,td").toArray().map((cell) => nodeText($, cell));
  const allRows = rowsFor("tr");
  const headRows = rowsFor("thead tr");
  const bodyRows = rowsFor("tbody tr");
  const footnoteRows = rowsFor("tfoot tr");
  const explicitHeader = headRows[0] ?? allRows.find((row) => $(row).find("th").length > 0);
  const fallbackHeader = explicitHeader ?? allRows.reduce<CheerioInput | undefined>((best, row) =>
    !best || rowCells(row).length > rowCells(best).length ? row : best, undefined);
  const firstHeaderIndex = allRows.findIndex((row) => $(row).find("th").length > 0);
  const consecutiveHeaderRows: CheerioInput[] = [];
  for (const row of firstHeaderIndex < 0 ? [] : allRows.slice(firstHeaderIndex)) {
    const cells = $(row).find("th,td").toArray();
    if (cells.length === 0 || !cells.every((cell) => $(cell).is("th"))) break;
    consecutiveHeaderRows.push(row);
  }
  const headerElements = headRows.length > 0
    ? headRows
    : consecutiveHeaderRows.length > 0
      ? consecutiveHeaderRows
      : fallbackHeader ? [fallbackHeader] : [];
  const headerRows = headerElements.map(rowCells);
  const headers = headerRows[0] ?? [];
  const footnoteSet = new Set(footnoteRows);
  const dataSource = bodyRows.length > 0 ? bodyRows : allRows;
  const headerSet = new Set(headerElements);
  const dataRows = dataSource
    .filter((row) => !headerSet.has(row) && !footnoteSet.has(row))
    .map(rowCells);
  const footnoteRowValues = footnoteRows.map(rowCells);
  const footnotes = footnoteRowValues.flat();
  const spansFor = (
    elements: CheerioInput[],
    section: "header" | "body" | "footnote",
  ): NonNullable<ProgramDocumentTable["cellSpans"]> => elements.flatMap((row, rowIndex) =>
    $(row).find("th,td").toArray().flatMap((cell, cellIndex) => {
      const rowSpanText = $(cell).attr("rowspan");
      const colSpan = Math.max(1, Number($(cell).attr("colspan") ?? 1) || 1);
      const rowSpan = rowSpanText === "0"
        ? elements.length - rowIndex
        : Math.max(1, Number(rowSpanText ?? 1) || 1);
      return rowSpan > 1 || colSpan > 1
        ? [{ section, row: rowIndex, cell: cellIndex, rowSpan, colSpan }]
        : [];
    }),
  );
  const cellSpans = [
    ...spansFor(headerElements, "header"),
    ...spansFor(dataSource.filter((row) => !headerSet.has(row) && !footnoteSet.has(row)), "body"),
    ...spansFor(footnoteRows, "footnote"),
  ];
  const caption = nodeText($, tableNode.find("caption").first());
  return {
    ...(caption ? { caption } : {}),
    headers,
    ...(headerRows.length > 0 ? { headerRows } : {}),
    rows: dataRows,
    ...(footnoteRowValues.length > 0 ? { footnoteRows: footnoteRowValues } : {}),
    ...(footnotes.length > 0 ? { footnotes } : {}),
    ...(cellSpans.length > 0 ? { cellSpans } : {}),
  };
};

export type ExpandedProgramDocumentTable = {
  headerRows: string[][];
  rows: string[][];
  footnoteRows: string[][];
};

export const expandProgramDocumentTable = (table: ProgramDocumentTable): ExpandedProgramDocumentTable => {
  const spans = table.cellSpans ?? [];
  const expand = (rows: string[][], section: "header" | "body" | "footnote"): string[][] => {
    const grid: string[][] = rows.map(() => []);
    const occupied: boolean[][] = rows.map(() => []);
    const sectionSpans = spans.filter((span) => span.section === section);
    for (let row = 0; row < rows.length; row += 1) {
      let column = 0;
      for (let cell = 0; cell < rows[row].length; cell += 1) {
        while (occupied[row][column]) column += 1;
        const span = sectionSpans.find((item) => item.row === row && item.cell === cell);
        const rowSpan = Math.min(span?.rowSpan ?? 1, rows.length - row);
        const colSpan = span?.colSpan ?? 1;
        for (let targetRow = row; targetRow < row + rowSpan; targetRow += 1) {
          for (let targetColumn = column; targetColumn < column + colSpan; targetColumn += 1) {
            grid[targetRow][targetColumn] = rows[row][cell] ?? "";
            occupied[targetRow][targetColumn] = true;
          }
        }
        column += colSpan;
      }
    }
    const width = grid.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    return grid.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  };

  return {
    headerRows: expand(table.headerRows ?? (table.headers.length > 0 ? [table.headers] : []), "header"),
    rows: expand(table.rows, "body"),
    footnoteRows: expand(table.footnoteRows ?? (table.footnotes?.length ? [table.footnotes] : []), "footnote"),
  };
};

const blocksFrom = ($: ReturnType<typeof load>, elements: CheerioInput[]): ProgramDocumentBlock[] => {
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
    node.find("img").addBack("img").each((_, image) => {
      const src = cleanText($(image).attr("src") ?? "");
      if (src) blocks.push({ type: "image", src, alt: cleanText($(image).attr("alt") ?? "") || undefined });
    });
    if (node.is("table")) continue;
    if (node.is("img")) continue;
    if (node.is("p,li,blockquote")) {
      const links = linksFrom($, element);
      const paragraphText = nodeText($, element);
      if (paragraphText) blocks.push({ type: "paragraph", text: paragraphText, ...(links.length > 0 ? { links } : {}) });
    }
  }
  return blocks;
};

type DocumentItem =
  | { type: "heading"; level: number; text: string }
  | { type: "element"; element: CheerioInput };

const collectItems = ($: ReturnType<typeof load>, root: CheerioInput): DocumentItem[] => {
  const items: DocumentItem[] = [];
  const walk = (container: CheerioInput): void => {
    $(container).contents().each((_, child) => {
      const node = $(child);
      if (node.is("h1,h2,h3,h4,h5,h6")) {
        const candidate = node.get(0);
        const tag = candidate && "name" in candidate && typeof candidate.name === "string"
          ? candidate.name
          : undefined;
        const level = tag ? Number(tag.slice(1)) : 0;
        if (level > 0) items.push({ type: "heading", level, text: cleanText(node.text()) });
        return;
      }
      if (node.is("table,p,li,blockquote,img")) {
        items.push({ type: "element", element: child });
        return;
      }
      if (node.is("article,section,div,main,body,ul,ol,figure")) walk(child);
    });
  };
  walk(root);
  return items;
};

const appendCourseCodes = (blocks: ProgramDocumentBlock[], target: string[]): void => {
  for (const block of blocks) {
    if (block.type === "course" && !target.includes(block.code)) target.push(block.code);
  }
};

export const normalizeProgramDocument = (
  html: string,
  code: string,
  title: string,
  sourcePath: string,
): ProgramDocument => {
  const $ = load(html);
  $("script,style,noscript").remove();
  const items = collectItems($, $("body").get(0) ?? $.root().get(0));
  const sections: ProgramDocumentSection[] = [];
  const allCourseCodes: string[] = [];

  let pendingElements: CheerioInput[] = [];
  let current: { title: string; level: number; elements: CheerioInput[] } | undefined;
  const flush = (): void => {
    if (!current) return;
    const blocks = blocksFrom($, current.elements);
    appendCourseCodes(blocks, allCourseCodes);
    sections.push({
      id: `h${sections.length}`,
      title: current.title,
      level: current.level,
      blocks,
    });
    current = undefined;
  };

  for (const item of items) {
    if (item.type === "heading") {
      if (item.level === 1) continue;
      flush();
      current = { title: item.text, level: item.level, elements: pendingElements };
      pendingElements = [];
    } else if (current) {
      current.elements.push(item.element);
    } else {
      pendingElements.push(item.element);
    }
  }
  flush();

  if (sections.length === 0) {
    const blocks = blocksFrom($, pendingElements);
    appendCourseCodes(blocks, allCourseCodes);
    sections.push({ id: "body", title, level: 1, blocks });
  }

  return { code, title, sourcePath, sections, courseCodes: allCourseCodes };
};
