import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCli } from "../src/cli.js";
import type { ApiResult } from "../src/infrastructure/http/catalog-api-client.js";

const apiResult = <T>(data: T): ApiResult<T> => ({
  data,
  status: 200,
  fetchedAt: "2026-10-05T00:00:00.000Z",
  path: "/api/teach/course-substitute-pool/list",
});

const relation = (
  id: number,
  substitute: Array<[string, string]>,
  original: Array<[string, string]>,
) => ({
  id,
  substituteCourses: substitute.map(([code, cn], index) => ({ id: id * 10 + index, code, cn, period: 60, credits: 3 })),
  originalCourses: original.map(([code, cn], index) => ({ id: id * 100 + index, code, cn, period: 80, credits: 4 })),
});

const activeServices: ReturnType<typeof buildCli>["services"][] = [];
const temporaryDirs: string[] = [];

afterEach(() => {
  for (const services of activeServices.splice(0)) services.repository.close();
  for (const directory of temporaryDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const makeServices = (data: unknown[]) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-substitute-cache-"));
  temporaryDirs.push(cacheDir);
  const { program, services } = buildCli({ cacheDir });
  activeServices.push(services);
  vi.spyOn(services.api, "restricted").mockResolvedValue(apiResult({ restricted: false }));
  const substitutes = vi.spyOn(services.api, "substitutes").mockResolvedValue(apiResult(data));
  return { program, services, substitutes };
};

describe("substitute query services", () => {
  it("explains only direct relations and exposes the website's update notice", async () => {
    const { services } = makeServices([
      relation(1, [["A", "课程甲"]], [["B", "课程乙"]]),
      relation(2, [["B", "课程乙"]], [["C", "课程丙"]]),
    ]);

    const result = await services.substitute.explain("课程甲", undefined, { offline: false, noCache: true });
    expect(result.value.map((item) => item.id)).toEqual([1]);
    expect(result.meta.notice).toContain("次日更新");
    expect(result.meta.notice).toContain("直接记录");
  });

  it("restricts a course query to the requested side and rejects side without course", async () => {
    const { services, substitutes } = makeServices([
      relation(1, [["A", "课程甲"]], [["B", "课程乙"]]),
      relation(2, [["B", "课程乙"]], [["C", "课程丙"]]),
    ]);
    const access = { offline: false, noCache: true };

    const asSubstitute = await services.substitute.list({ course: "课程乙", side: "substitute" }, access);
    const asOriginal = await services.substitute.list({ course: "课程乙", side: "original" }, access);
    expect(asSubstitute.value.map((item) => item.id)).toEqual([2]);
    expect(asOriginal.value.map((item) => item.id)).toEqual([1]);
    await expect(services.substitute.list({ side: "original" }, access)).rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    expect(substitutes).toHaveBeenCalledTimes(2);
  });

  it("validates CLI side selection and requires network for an explicit PDF download", async () => {
    const { program, substitutes } = makeServices([]);
    program.exitOverride();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(program.parseAsync(["substitute", "list", "--side", "替代方"], { from: "user" }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    await expect(program.parseAsync([
      "--offline", "substitute", "summary", "--download", path.join(os.tmpdir(), "should-not-exist.pdf"),
    ], { from: "user" })).rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    expect(substitutes).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("official substitute summary PDF download", () => {
  it("downloads a verified PDF atomically and reports a checksum", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-substitute-pdf-"));
    temporaryDirs.push(directory);
    const pdf = Buffer.from("%PDF-1.7\nfixture\n%%EOF\n");
    const fetchMock = vi.fn().mockResolvedValue(new Response(pdf, {
      headers: { "content-type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { downloadSubstituteSummary } = await import("../src/infrastructure/http/substitute-summary-downloader.js");

    const result = await downloadSubstituteSummary(path.join(directory, "summary.pdf"));

    expect(fs.readFileSync(result.path)).toEqual(pdf);
    expect(result.sizeBytes).toBe(pdf.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new URL(result.url).hostname).toBe("www.teach.ustc.edu.cn");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get("user-agent")).toMatch(/^ustc-catalog-cli\//);
    expect(requestHeaders.get("referer")).toBe("https://www.teach.ustc.edu.cn/?attachment_id=3310");
  });

  it("refuses to overwrite a file before making a request", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-substitute-pdf-existing-"));
    temporaryDirs.push(directory);
    const target = path.join(directory, "summary.pdf");
    fs.writeFileSync(target, "keep me");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { downloadSubstituteSummary } = await import("../src/infrastructure/http/substitute-summary-downloader.js");

    await expect(downloadSubstituteSummary(target)).rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    expect(fs.readFileSync(target, "utf8")).toBe("keep me");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects untrusted redirects and non-PDF responses without creating the target", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-substitute-pdf-invalid-"));
    temporaryDirs.push(directory);
    const target = path.join(directory, "summary.pdf");
    const { downloadSubstituteSummary } = await import("../src/infrastructure/http/substitute-summary-downloader.js");
    const externalRedirect = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://example.com/file.pdf" },
    }));
    vi.stubGlobal("fetch", externalRedirect);
    await expect(downloadSubstituteSummary(target)).rejects.toMatchObject({ code: "REMOTE_INVALID_DATA" });
    expect(externalRedirect).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(target)).toBe(false);

    const htmlResponse = vi.fn().mockResolvedValue(new Response("not a PDF", {
      headers: { "content-type": "text/html" },
    }));
    vi.stubGlobal("fetch", htmlResponse);
    await expect(downloadSubstituteSummary(target)).rejects.toMatchObject({ code: "REMOTE_INVALID_DATA" });
    expect(fs.existsSync(target)).toBe(false);

    const invalidSignature = vi.fn().mockResolvedValue(new Response("not a PDF", {
      headers: { "content-type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", invalidSignature);
    await expect(downloadSubstituteSummary(target)).rejects.toMatchObject({ code: "REMOTE_INVALID_DATA" });
    expect(fs.existsSync(target)).toBe(false);

    const oversized = vi.fn().mockResolvedValue(new Response("too large", {
      headers: { "content-type": "application/pdf", "content-length": String(33 * 1024 * 1024) },
    }));
    vi.stubGlobal("fetch", oversized);
    await expect(downloadSubstituteSummary(target)).rejects.toMatchObject({ code: "REMOTE_RESPONSE_TOO_LARGE" });
    expect(fs.existsSync(target)).toBe(false);
  });
});
