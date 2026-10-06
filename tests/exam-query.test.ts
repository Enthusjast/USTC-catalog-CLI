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
  path: "/fixture",
});

const planned = (id: number, date: string, startTime: number, endTime: number, room: string, code: string, name: string) => ({
  id,
  examType: 2,
  examDate: date,
  startTime,
  endTime,
  examRooms: [{ room, count: 20 }],
  examTakeCount: 20,
  lesson: {
    code: `${code}.01`,
    course: { code, cn: name, credits: 3 },
    openDepartment: { code: "004", cn: "物理系" },
    education: { cn: "研究生" },
    courseGradation: { cn: "专业基础" },
    courseType: { cn: "理论课" },
  },
});

type Active = { services: ReturnType<typeof buildCli>["services"]; cacheDir: string };
const active: Active[] = [];

afterEach(() => {
  for (const item of active.splice(0)) {
    item.services.repository.close();
    fs.rmSync(item.cacheDir, { recursive: true, force: true });
  }
});

const makeServices = (tree?: unknown[]) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-exam-"));
  const { services } = buildCli({ cacheDir });
  active.push({ services, cacheDir });
  vi.spyOn(services.api, "restricted").mockResolvedValue(apiResult({ restricted: false }));
  vi.spyOn(services.api, "semesters").mockResolvedValue(apiResult([
    { id: 461, nameZh: "2026年秋季学期", code: "20261", start: "2026-08-30", end: "2027-01-15", isLast: true },
  ]));
  vi.spyOn(services.api, "exams").mockResolvedValue(apiResult([
    planned(1, "2026-11-04", 900, 1000, "5401", "MATH1001", "数学分析"),
    planned(2, "2026-11-04", 959, 1030, "5401", "PHYS1001", "力学"),
    planned(3, "2026-11-08", 900, 1000, "A101", "CS1001", "程序设计"),
  ]));
  vi.spyOn(services.api, "generalExams").mockResolvedValue(apiResult([
    {
      id: 20,
      courseCode: "001669",
      courseName: "综合法语",
      examDate: "2026-09-08T00:00:00+08:00",
      startTime: 1930,
      endTime: 2130,
      dept: "数学科学学院",
      batch: "2026年夏季学期补考",
      room: "A101",
      education: { cn: "本科" },
    },
  ]));
  if (tree) vi.spyOn(services.api, "departmentTree").mockResolvedValue(apiResult(tree));
  return services;
};

const access = { offline: false, noCache: true };

describe("exam query services", () => {
  it("maps general exam departments on demand and retains the website补考 batch label", async () => {
    const services = makeServices([
      { id: 1, code: "001", nameZh: "数学科学学院", children: [] },
      { id: 2, code: "004", nameZh: "物理系", children: [] },
    ]);
    const treeRequest = vi.spyOn(services.api, "departmentTree");

    const result = await services.exam.list({ semesterId: 461, department: "001" }, access);
    expect(treeRequest).toHaveBeenCalledTimes(1);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      recordKind: "general",
      type: "补考",
      batch: "2026年夏季学期补考",
      departmentCode: "001",
      departmentName: "数学科学学院",
    });
    expect(result.meta.notice).toContain("次日更新");
  });

  it("does not fail exam queries when the optional department-tree lookup fails", async () => {
    const services = makeServices();
    vi.spyOn(services.api, "departmentTree").mockRejectedValue(new Error("tree unavailable"));

    const result = await services.exam.list({ semesterId: 461, department: "数学科学学院" }, access);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({ departmentName: "数学科学学院", departmentCode: undefined });
    expect(result.meta.unmappedDepartmentCount).toBe(1);
  });

  it("returns context-linked facet counts while excluding each facet's own active filter", async () => {
    const services = makeServices([
      { id: 1, code: "001", nameZh: "数学科学学院", children: [] },
      { id: 2, code: "004", nameZh: "物理系", children: [] },
    ]);

    const result = await services.exam.options({ semesterId: 461, department: "001", type: "补考" }, access);
    expect(result.value).toContainEqual({ dimension: "type", value: "补考", label: "补考", count: 1 });
    expect(result.value).toContainEqual({ dimension: "department", value: "001", label: "001 数学科学学院", count: 1 });
    expect(result.value.some((option) => option.dimension === "date" && option.value === "2026-11-08")).toBe(false);
  });

  it("builds Monday-to-Sunday schedule data and detects half-open room overlaps", async () => {
    const services = makeServices([
      { id: 1, code: "001", nameZh: "数学科学学院", children: [] },
      { id: 2, code: "004", nameZh: "物理系", children: [] },
    ]);
    const schedule = await services.exam.schedule(461, "2026-11-02", "2026-11-08", {}, access);
    expect(schedule.value).toHaveLength(7);
    expect(schedule.value[0]?.date).toBe("2026-11-02");
    expect(schedule.value.at(-1)?.date).toBe("2026-11-08");
    expect(schedule.value.find((day) => day.date === "2026-11-04")?.exams).toHaveLength(2);

    vi.spyOn(services.api, "generalExams").mockResolvedValueOnce(apiResult([{
      id: 99,
      courseCode: "UNKNOWN",
      courseName: "时间缺失",
      examDate: "2026-11-06",
      dept: "物理系",
      batch: "2026秋季考试",
    }]));
    const conflicts = await services.exam.conflicts({ semesterId: 461 }, access);
    expect(conflicts.value).toMatchObject([{
      date: "2026-11-04",
      room: "5401",
      overlapStart: "09:59",
      overlapEnd: "10:00",
    }]);
    expect(conflicts.meta.uncheckableExamCount).toBe(1);
  });
});
