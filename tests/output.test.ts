import { describe, expect, it, vi } from "vitest";
import { emitResult } from "../src/presentation/output.js";
import { normalizeExams, normalizeLesson, normalizeTimetable } from "../src/adapters/adapters.js";
import { classroomRows, examRows, lessonExportRows, lessonRows, substituteRows } from "../src/presentation/rows.js";

describe("output contracts", () => {
  it("unions columns for mixed table rows in CSV", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "test", scope: "all", source: "network", fetchedAt: "now", stale: false },
        data: [{ id: 1 }, { id: 2 }],
      },
      { format: "csv", limit: undefined, offset: 0, all: true, noColor: true, quiet: true },
      25,
      { tableRows: [{ 模块ID: 1, 类型: "模块" }, { 模块ID: 2, 课程编号: "MATH1001", 课程名: "数学分析" }] },
    );
    const output = String(write.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("模块ID,类型,课程编号,课程名");
    expect(output).toContain("2,,MATH1001,数学分析");
    write.mockRestore();
  });

  it("applies explicit CSV limits to flattened rows and keeps the full column set", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "test", scope: "all", source: "network", fetchedAt: "now", stale: false },
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
      { format: "csv", limit: 1, offset: 1, all: false, noColor: true, quiet: true },
      25,
      { tableRows: [{ ID: 1 }, { ID: 2, 课程编号: "MATH1001" }, { ID: 3 }] },
    );
    const output = String(write.mock.calls[0]?.[0] ?? "").replace(/^\uFEFF/, "");
    expect(output).toContain("ID,课程编号");
    expect(output).toContain("2,MATH1001");
    expect(output).not.toContain("1,");
    expect(output).not.toContain("3,");
    write.mockRestore();
  });

  it("keeps API lesson type fields distinct and exports the website's full lesson columns", () => {
    const lesson = normalizeLesson({
      id: 1,
      code: "MATH1001.01",
      course: { code: "MATH1001", cn: "数学分析" },
      classType: { cn: "计划内与自由选修" },
      courseType: { cn: "理论课" },
      courseCategory: { cn: "本科计划内课程" },
      courseClassify: { cn: null },
      courseGradation: { cn: "本研贯通" },
      education: { cn: "本科" },
      teachLang: { cn: "中文" },
      examMode: { cn: "笔试" },
      graduateAndPostgraduate: true,
      stdCount: 30,
      limitCount: 40,
      teacherAssignmentList: [{ cn: "张三" }],
      adminClasses: [{ cn: "26数学" }],
      dateTimePlaceText: "5401: 1(3,4)",
      dateTimePlacePersonText: { cn: "1~15周 5401 :1(3,4) 张三" },
    });
    const row = lessonRows([lesson])[0];
    expect(row).toMatchObject({
      课堂类型: "计划内与自由选修",
      课程范畴分类: "",
      课程类型: "理论课",
      本研同堂: "是",
    });
    expect(lessonExportRows([lesson])[0]).toMatchObject({
      课堂类型: "计划内与自由选修",
      课程范畴分类: "",
      课程类型: "理论课",
      授课语言: "中文",
      考核方式: "笔试",
      本研同堂: "是",
      上课班级: "26数学",
      时间地点: "1~15周 5401 :1(3,4) 张三",
    });
  });

  it("renders classroom usage labels and room properties in Chinese table and CSV rows", () => {
    const usages = normalizeTimetable({
      timetable: {
        tmpLessons: [{ classroomName: "1101", courseName: "讲座", type: "讲座", start: "10:00", end: "11:00" }],
      },
    }, "2026-10-04");
    const rows = classroomRows([{
      classroomCode: "1101",
      building: "第一教学楼",
      date: "2026-10-04",
      usages,
      roomType: "2",
      roomTypeName: "多媒体教室",
      canBorrow: true,
      arrangeSchedule: false,
      arrangeExam: true,
    }]);
    expect(rows[0]).toMatchObject({
      房间类型: "多媒体教室",
      可借用: true,
      可排课: false,
      可安排考试: true,
      使用类型: "讲座",
    });
  });

  it("renders substitute direction and course credits and hours", () => {
    const rows = substituteRows([{
      id: 1,
      substituteCourses: [{ id: 1, code: "A", nameZh: "替代课程", credits: 3, hours: 60 }],
      originalCourses: [{ id: 2, code: "B", nameZh: "原课程", credits: 4, hours: 80 }],
      interchangeable: false,
      multiple: false,
      searchText: "",
    }]);

    expect(rows[0]).toEqual({
      替代方课程: "A 替代课程（3 学分，60 学时）",
      被替代课程: "B 原课程（4 学分，80 学时）",
      替代关系: "单向高级替代",
      方向: "替代方 → 被替代方",
      门数: "单门",
    });
  });

  it("includes exam credits and course type in human-readable rows", () => {
    const exams = normalizeExams([{
      id: 1,
      examType: 2,
      examDate: "2026-11-04",
      examRooms: [{ room: "5401", count: 20 }],
      examMode: "笔试",
      lesson: {
        code: "MATH1001.01",
        course: { cn: "数学分析", credits: 6 },
        courseType: { cn: "理论课" },
      },
    }], []);
    expect(examRows(exams)[0]).toMatchObject({ 学分: 6, 课程类型: "理论课", 考试类型: "期末考试" });
  });

  it("rejects offset for object-shaped results", () => {
    try {
      emitResult(
        {
          meta: { resource: "test", scope: "one", source: "network", fetchedAt: "now", stale: false },
          data: { id: 1 },
        },
        { format: "json", limit: undefined, offset: 1, all: false, noColor: true, quiet: true },
      );
      throw new Error("expected an argument error");
    } catch (error) {
      expect(error).toMatchObject({ code: "ARGUMENT_ERROR" });
    }
  });

  it("does not truncate object-shaped details with --limit", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "test", scope: "detail", source: "network", fetchedAt: "now", stale: false },
        data: { id: 1 },
      },
      { format: "json", limit: 0, offset: 0, all: false, noColor: true, quiet: true },
    );
    const output = String(write.mock.calls[0]?.[0] ?? "");
    expect(JSON.parse(output).data).toEqual({ id: 1 });
    write.mockRestore();
  });

  it("paginates flattened detail rows and retains full identifier columns", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "program-detail", scope: "1", source: "network", fetchedAt: "now", stale: false },
        data: { id: 1 },
      },
      { format: "table", limit: 1, offset: 0, all: false, noColor: true, wide: false, quiet: true },
      25,
      { tableRows: [{ 课程编号: "MATH1001.01" }, { 课程编号: "PHYS1001.01" }], tableTotal: 2 },
    );
    const output = write.mock.calls.flat().join("");
    expect(output).toContain("MATH1001.01");
    expect(output).not.toContain("PHYS1001.01");
    expect(output).toContain("共 2 条");
    write.mockRestore();
  });

  it("labels static results as static in human-readable output", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "program-catalog", scope: "all", source: "static", fetchedAt: "now", stale: false },
        data: { label: "目录", value: "内置" },
      },
      { format: "table", limit: undefined, offset: 0, all: true, noColor: true, quiet: false },
      25,
      { tableRows: [{ 名称: "目录", 内容: "内置" }] },
    );
    expect(write.mock.calls.flat().join("")).toContain("数据来源：静态");
    write.mockRestore();
  });

  it("distinguishes explicit offline cache use from network fallback", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    emitResult(
      {
        meta: { resource: "test", scope: "offline", source: "cache", fetchedAt: "now", stale: true },
        data: [{ id: 1 }],
      },
      { format: "table", offline: true, limit: undefined, offset: 0, all: true, noColor: true, quiet: false },
      25,
    );
    expect(stderr.mock.calls.flat().join("")).toContain("使用离线缓存数据");
    expect(stderr.mock.calls.flat().join("")).not.toContain("网络请求失败");
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("reports unlocated classroom usages on stderr without corrupting JSON output", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    emitResult({
      meta: {
        resource: "timetable",
        scope: "2026-10-04",
        source: "network",
        fetchedAt: "now",
        stale: false,
        unlocatedUsageCount: 2,
      },
      data: [],
    }, { format: "json", limit: undefined, offset: 0, all: false, noColor: true, quiet: false });
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0])).meta.unlocatedUsageCount).toBe(2);
    expect(stderr.mock.calls.flat().join("")).toContain("2 条使用记录无法关联到网页教室目录");
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("prints the exam freshness notice to stderr and preserves it in JSON meta", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const notice = "考试查询数据由网页次日更新，非实时；实时安排请以综合教务系统为准。";
    emitResult({
      meta: { resource: "exams", scope: "461", source: "network", fetchedAt: "now", stale: false, notice },
      data: [],
    }, { format: "table", limit: undefined, offset: 0, all: true, noColor: true, quiet: false });
    expect(stderr.mock.calls.flat().join("")).toContain(notice);
    stdout.mockClear();
    stderr.mockClear();
    emitResult({
      meta: { resource: "exams", scope: "461", source: "network", fetchedAt: "now", stale: false, notice },
      data: [],
    }, { format: "json", limit: undefined, offset: 0, all: true, noColor: true, quiet: false });
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0])).meta.notice).toBe(notice);
    expect(stderr.mock.calls).toHaveLength(0);
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
