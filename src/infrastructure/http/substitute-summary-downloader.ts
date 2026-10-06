import { CLI_VERSION } from "../../version.js";
import { downloadOfficialPdf, type DownloadedOfficialPdf } from "./official-pdf-downloader.js";

const SUMMARY_PDF_URL =
  "https://www.teach.ustc.edu.cn/wp-content/uploads/legacy/2015/交流学校课程替代关系汇总表.pdf";
const SUMMARY_PAGE_URL = "https://www.teach.ustc.edu.cn/?attachment_id=3310";

export type DownloadedSubstituteSummary = DownloadedOfficialPdf;

export const downloadSubstituteSummary = (
  outputPath: string,
  timeoutMs = 15_000,
  userAgent = `ustc-catalog-cli/${CLI_VERSION}`,
): Promise<DownloadedSubstituteSummary> => downloadOfficialPdf(SUMMARY_PDF_URL, outputPath, {
  timeoutMs,
  userAgent,
  referer: SUMMARY_PAGE_URL,
});
