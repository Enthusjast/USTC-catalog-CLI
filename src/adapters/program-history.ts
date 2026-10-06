import { createHash } from "node:crypto";
import { load } from "cheerio";
import { CliError } from "../domain/errors.js";
import type { ProgramHistoryEntry } from "../domain/models.js";

export const PROGRAM_HISTORY_PAGE_URL = "https://www.teach.ustc.edu.cn/education/241.html";
const OFFICIAL_HOST = "www.teach.ustc.edu.cn";

const cleanText = (value: string): string => value.replace(/\s+/g, " ").trim();

export const assertProgramHistoryPageAccessible = (html: string): void => {
  const $ = load(html);
  const restrictedHeading = $("h1, h2, title").toArray()
    .some((heading) => cleanText($(heading).text()).includes("受限资源"));
  const body = cleanText($.text());
  if (restrictedHeading && body.includes("统一认证")) {
    throw new CliError(
      "RESTRICTED",
      "教务处历史培养方案页面当前限制校外访问。",
      "CLI 不执行统一认证登录；请在可访问该页面的网络环境中查看，或稍后重试。",
    );
  }
};

const canonicalUrl = (href: string, baseUrl = PROGRAM_HISTORY_PAGE_URL): URL | undefined => {
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol === "http:" && url.hostname === OFFICIAL_HOST) url.protocol = "https:";
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url;
  } catch {
    return undefined;
  }
};

const entryId = (category: string, title: string, href: string): string =>
  `history-${createHash("sha256").update(`${category}\u0000${title}\u0000${href}`).digest("hex").slice(0, 12)}`;

export const normalizeProgramHistory = (html: string): ProgramHistoryEntry[] => {
  assertProgramHistoryPageAccessible(html);
  const $ = load(html);
  const history = $("details").filter((_, element) =>
    cleanText($(element).find("summary").first().text()).includes("历史培养方案"),
  ).first();
  if (history.length === 0) return [];

  const entries: ProgramHistoryEntry[] = [];
  const add = (category: string, title: string, version: string | undefined, href: string): void => {
    const url = canonicalUrl(href);
    if (!url) return;
    const normalizedHref = url.toString();
    const downloadable = url.hostname === OFFICIAL_HOST && !url.username && !url.password && !url.port &&
      (/\.pdf$/i.test(url.pathname) || /\/attachment\//i.test(url.pathname));
    const id = entryId(category, title, normalizedHref);
    if (entries.some((entry) => entry.id === id)) return;
    entries.push({
      id,
      title,
      section: category,
      version,
      href: normalizedHref,
      downloadable,
    });
  };

  history.find("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href") ?? "";
    const text = cleanText($(anchor).text());
    if (text === "在线版本") add("在线版本", text, undefined, href);
  });

  history.find("table tr").each((_, row) => {
    const cells = $(row).children("td").toArray();
    if (cells.length < 2) return;
    const version = cleanText($(cells[0]).text());
    for (let column = 1; column < cells.length; column += 1) {
      const category = column === 1 ? "修订方案" : "专业设置";
      $(cells[column]).find("a[href]").each((_, anchor) => {
        const text = cleanText($(anchor).text()) || category;
        add(category, `${version}级${text}`, version, $(anchor).attr("href") ?? "");
      });
    }
  });

  history.find("dl.plan").each((_, list) => {
    let unit = "";
    $(list).children("dt,dd").each((_, group) => {
      const groupNode = $(group);
      if (groupNode.is("dt")) {
        const copy = groupNode.clone();
        copy.find("a").remove();
        unit = cleanText(copy.text());
        groupNode.find("a[href]").each((_, anchor) => {
          const version = cleanText($(anchor).text());
          add("专业培养方案", `${unit} ${version}`, version, $(anchor).attr("href") ?? "");
        });
        return;
      }

      groupNode.find("a[href]").each((_, anchor) => {
        const link = $(anchor);
        const copy = link.closest("li").length > 0 ? link.closest("li").clone() : groupNode.clone();
        copy.find("a").remove();
        const subject = cleanText(copy.text());
        const version = cleanText(link.text()) || undefined;
        const title = [unit, subject, version].filter(Boolean).join(" ");
        add("历史专业方案", title || unit, version, link.attr("href") ?? "");
      });
    });
  });

  return entries;
};

export const resolveProgramHistoryPdfUrl = (html: string, attachmentUrl: string): string => {
  assertProgramHistoryPageAccessible(html);
  const $ = load(html);
  let link = $("a.download-link[href]").first();
  if (link.length === 0) {
    link = $("a[href]").filter((_, anchor) => /\.pdf(?:[?#]|$)/i.test($(anchor).attr("href") ?? "")).first();
  }
  const url = canonicalUrl(link.attr("href") ?? "", attachmentUrl);
  if (!url || url.protocol !== "https:" || url.hostname !== OFFICIAL_HOST || !/\.pdf$/i.test(url.pathname)) {
    throw new CliError("REMOTE_INVALID_DATA", "该历史条目没有指向教务处官方 PDF 文件。", "请先运行 program history list 检查该条目的类型和链接。");
  }
  return url.toString();
};
