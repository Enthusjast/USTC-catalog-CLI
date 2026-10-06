import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareProgramDetails } from "../src/adapters/program-comparison.js";
import { buildCli } from "../src/cli.js";
import type { ProgramDetail, ProgramModule } from "../src/domain/models.js";
import type { ApiResult } from "../src/infrastructure/http/catalog-api-client.js";

const activeServices: Array<ReturnType<typeof buildCli>["services"]> = [];
const temporaryDirs: string[] = [];

afterEach(() => {
  for (const services of activeServices.splice(0)) services.repository.close();
  for (const directory of temporaryDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const apiResult = <T>(data: T): ApiResult<T> => ({
  data,
  status: 200,
  fetchedAt: "2026-10-06T00:00:00.000Z",
  path: "/fixture",
});

const makeServices = () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-program-cache-"));
  temporaryDirs.push(cacheDir);
  const built = buildCli({ cacheDir });
  activeServices.push(built.services);
  vi.spyOn(built.services.api, "restricted").mockResolvedValue(apiResult({ restricted: false }));
  return built;
};

const programTree = () => ({
  math: {
    id: 1,
    code: "001",
    nameZh: "数学科学学院",
    majors: {
      math: {
        id: 10,
        code: "001001",
        nameZh: "数学与应用数学",
        programs: [
          { id: 100, grade: "2024", nameZh: "数学方案", trainType: "主修" },
          { id: 101, grade: "2025", nameZh: "数学方案新版", trainType: "主修" },
        ],
      },
    },
  },
});

const referencePlan = (publicId: number, requiredCredits: number) => ({
  trainType: "主修",
  grade: publicId === 900 ? "2024" : "2025",
  department: { id: 1, nameZh: "数学科学学院" },
  major: { id: 10, nameZh: "数学与应用数学" },
  majorDirection: "基础数学",
  beginSemester: "2024秋",
  awardDegree: true,
  requiredCredits: 150,
  moduleTree: [{
    self: { id: publicId, type: "专业必修", parent: null, public: publicId, requiredCredits, courses: [] },
    isLeaf: true,
    children: [],
  }],
});

const publicModule = (id: number, requiredCredits: number, courses: unknown[]) => ({
  self: { id, type: "专业必修", parent: null, public: null, requiredCredits, courses },
  isLeaf: true,
  children: [],
});

const course = (code: string, nameZh: string, credits: number, totalPeriods: number) => ({
  course: { code, nameZh, credits, totalPeriods },
  compulsory: true,
  credits,
  totalPeriods,
  terms: ["1秋"],
});

describe("program query behavior", () => {
  it("keeps public references unresolved by default and recursively expands them on request", async () => {
    const { services } = makeServices();
    vi.spyOn(services.api, "programTree").mockResolvedValue(apiResult(programTree()));
    vi.spyOn(services.api, "programInfo").mockResolvedValue(apiResult(referencePlan(900, 9)));
    const moduleInfo = vi.spyOn(services.api, "moduleInfo").mockResolvedValue(apiResult(publicModule(900, 9, [
      course("MATH1001", "数学分析", 6, 90),
    ])));
    const access = { offline: false, noCache: true };

    const summary = await services.program.detail(100, access);
    expect(summary.value.modules[0]?.publicModuleId).toBe(900);
    expect(summary.meta.notice).toContain("--expand-public");
    expect(moduleInfo).not.toHaveBeenCalled();

    const expanded = await services.program.detail(100, access, true);
    expect(expanded.value.modules[0]).toMatchObject({ id: 900, publicModuleId: undefined });
    expect(expanded.value.modules[0]?.courses.map((item) => item.code)).toEqual(["MATH1001"]);
    expect(moduleInfo).toHaveBeenCalledTimes(1);
  });

  it("compares API plans after expanding references and reports course and module changes", async () => {
    const { services } = makeServices();
    vi.spyOn(services.api, "programTree").mockResolvedValue(apiResult(programTree()));
    vi.spyOn(services.api, "programInfo").mockImplementation(async (id) =>
      apiResult(referencePlan(id === 100 ? 900 : 901, id === 100 ? 9 : 12)));
    const moduleInfo = vi.spyOn(services.api, "moduleInfo").mockImplementation(async (id) => id === 900
      ? apiResult(publicModule(900, 9, [
        course("MATH1001", "数学分析", 6, 90),
        course("MATH2001", "高等代数", 5, 75),
      ]))
      : apiResult(publicModule(901, 12, [
        course("MATH1001", "数学分析", 7, 105),
        course("MATH3001", "实变函数", 4, 60),
      ])));

    const result = await services.program.compare(100, 101, { offline: false, noCache: true });
    expect(result.value.summary).toEqual({
      addedCourses: 1,
      removedCourses: 1,
      movedCourses: 0,
      changedCourses: 1,
      changedModules: 1,
    });
    expect(result.value.courses).toEqual(expect.arrayContaining([
      expect.objectContaining({ change: "changed", code: "MATH1001", changedFields: ["学时", "学分"] }),
      expect.objectContaining({ change: "removed", code: "MATH2001" }),
      expect.objectContaining({ change: "added", code: "MATH3001" }),
    ]));
    expect(moduleInfo).toHaveBeenCalledTimes(2);
  });

  it("matches a unique course moved between modules instead of calling it an addition and removal", () => {
    const base = {
      id: 1,
      departmentId: 1,
      departmentCode: "001",
      departmentName: "数学科学学院",
      majorId: 10,
      majorCode: "001001",
      majorName: "数学",
      name: "方案",
      grade: "2024",
      trainType: "主修",
      modules: [] as ProgramModule[],
    } satisfies ProgramDetail;
    const module = (id: number, type: string, code: string): ProgramModule => ({
      id,
      type,
      isLeaf: true,
      courses: [{ code, name: "课程", compulsory: true, terms: [] }],
      children: [],
    });
    const result = compareProgramDetails(
      { ...base, modules: [module(1, "通修", "MATH1001")] },
      { ...base, id: 2, modules: [module(2, "专业必修", "MATH1001")] },
    );
    expect(result.summary.movedCourses).toBe(1);
    expect(result.courses[0]).toMatchObject({ change: "moved", code: "MATH1001" });
  });

  it("lists stable official history entries, supports filtering, and safely downloads an attachment PDF", async () => {
    const { services } = makeServices();
    const indexHtml = `<details><summary>历史培养方案</summary>
      <a href="/data/program/cn/001001.html">在线版本</a>
      <table><tbody><tr><td>2024</td><td><a href="/attachment/100">修订方案</a></td><td><a href="https://example.com/foreign.pdf">外部材料</a></td></tr></tbody></table>
      <dl class="plan"><dt>数学科学学院 <a href="/attachment/200">2020级</a></dt><dd><ul><li>数学类 <a href="/attachment/201">2018级</a></li></ul></dd></dl>
    </details>`;
    vi.spyOn(services.api, "programHistory").mockResolvedValue(apiResult(indexHtml));
    const access = { offline: false, noCache: true };
    const all = await services.program.history(undefined, access);
    const filtered = await services.program.history("修订方案", access);
    expect(all.value.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^history-[a-f0-9]{12}$/),
    ]));
    expect(all.value.find((entry) => entry.title.includes("2024级修订方案"))?.downloadable).toBe(true);
    expect(all.value.find((entry) => entry.title === "2024级外部材料")?.downloadable).toBe(false);
    expect(filtered.value).toHaveLength(1);
    expect(filtered.value[0]?.title).toContain("2024级修订方案");

    const attachmentPage = vi.spyOn(services.api, "getText").mockResolvedValue(apiResult(
      `<a class="download-link" href="/wp-content/uploads/2024-plan.pdf">下载 PDF</a>`,
    ));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-plan-pdf-"));
    temporaryDirs.push(directory);
    const target = path.join(directory, "plan.pdf");
    const pdf = Buffer.from("%PDF-1.7\nplan fixture\n%%EOF\n");
    const fetchMock = vi.fn().mockResolvedValue(new Response(pdf, {
      headers: { "content-type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const item = all.value.find((entry) => entry.title.includes("2024级修订方案"));
    if (!item) throw new Error("history fixture did not produce the expected plan");
    const downloaded = await services.program.downloadHistory(item.id, target, access);
    expect(attachmentPage).toHaveBeenCalledWith(item.href);
    expect(fs.readFileSync(target)).toEqual(pdf);
    expect(downloaded.value.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).pathname).toBe("/wp-content/uploads/2024-plan.pdf");
  });

  it("rejects history downloads in offline mode or for non-PDF entries before fetching", async () => {
    const { services } = makeServices();
    const history = vi.spyOn(services.api, "programHistory").mockResolvedValue(apiResult(
      `<details><summary>历史培养方案</summary><table><tr><td>2024</td><td><a href="https://example.com/foreign.html">网页</a></td></tr></table></details>`,
    ));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(services.program.downloadHistory("entry", "plan.pdf", { offline: true, noCache: false }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    expect(history).not.toHaveBeenCalled();

    const item = (await services.program.history(undefined, { offline: false, noCache: true })).value[0];
    if (!item) throw new Error("history fixture did not produce an entry");
    await expect(services.program.downloadHistory(item.id, "plan.pdf", { offline: false, noCache: true }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an authentication interstitial without caching it as a valid history index", async () => {
    const { services } = makeServices();
    vi.spyOn(services.api, "programHistory").mockResolvedValue(apiResult(
      `<h1>中国科学技术大学教务处</h1><h2>受限资源</h2><p>您从中国科学技术大学校外访问，请先<a>统一认证登录</a>后访问此页面。</p>`,
    ));
    await expect(services.program.history(undefined, { offline: false, noCache: false }))
      .rejects.toMatchObject({ code: "RESTRICTED" });
    expect(services.repository.read("program-history", "all")).toBeNull();
  });

  it("keeps a valid history snapshot when the site serves unrecognized HTML with HTTP 200", async () => {
    const { services } = makeServices();
    const programHistory = vi.spyOn(services.api, "programHistory")
      .mockResolvedValueOnce(apiResult(
        `<details><summary>历史培养方案</summary><table><tr><td>2024</td><td><a href="/attachment/100">修订方案</a></td></tr></table></details>`,
      ))
      .mockResolvedValueOnce(apiResult("<html><body>temporary maintenance</body></html>"));
    const access = { offline: false, noCache: false };
    const first = await services.program.history(undefined, access);
    await expect(services.program.history(undefined, access)).rejects.toMatchObject({ code: "REMOTE_INVALID_DATA" });

    const cached = services.repository.read<string>("program-history", "all");
    expect(programHistory).toHaveBeenCalledTimes(2);
    expect(first.value).toHaveLength(1);
    expect(cached?.value).toContain("历史培养方案");
    expect(cached?.value).not.toContain("temporary maintenance");
  });

  it("filters API plan names by all space-separated terms in the CLI", async () => {
    const { program, services } = makeServices();
    program.exitOverride();
    vi.spyOn(services.api, "programTree").mockResolvedValue(apiResult({
      unit: {
        id: 1, code: "001", nameZh: "数学科学学院", majors: {
          math: { id: 10, code: "001001", nameZh: "数学", programs: [
            { id: 100, grade: "2024", nameZh: "数学与应用数学", trainType: "主修" },
            { id: 102, grade: "2024", nameZh: "应用物理", trainType: "主修" },
          ] },
        },
      },
    }));
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync(["--json", "--no-cache", "program", "list", "--name", "数学 应用"], { from: "user" });
      const output = write.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(JSON.parse(output).data.map((entry: { id: number }) => entry.id)).toEqual([100]);
    } finally {
      write.mockRestore();
    }
  });
});
