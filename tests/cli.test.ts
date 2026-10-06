import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildCli } from "../src/cli.js";

describe("CLI contract", () => {
  it("exposes all public resource command groups", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-cli-"));
    const { program, services } = buildCli({ cacheDir });
    expect(program.commands.map((command) => command.name())).toEqual([
      "semester",
      "department",
      "calendar",
      "course",
      "program",
      "lesson",
      "classroom",
      "exam",
      "substitute",
      "cache",
      "doctor",
      "completion",
      "preset",
    ]);
    services.repository.close();
  });

  it("shows the product name together with the version", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-version-"));
    const { program, services } = buildCli({ cacheDir });
    expect(program.version()).toBe("USTC-catalog-CLI 0.3.0");
    services.repository.close();
  });

  it("marks the built-in program catalog as static data", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-static-"));
    const { services } = buildCli({ cacheDir });
    const result = await services.program.catalog();
    expect(result.meta.source).toBe("static");
    services.repository.close();
  });

  it("deduplicates semester requests within one service lifetime", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-semesters-"));
    const { services } = buildCli({ cacheDir });
    const restricted = vi.spyOn(services.api, "restricted").mockResolvedValue({
      data: { restricted: false },
      status: 200,
      fetchedAt: "now",
      path: "/api/restricted",
    });
    const semesters = vi.spyOn(services.api, "semesters").mockResolvedValue({
      data: [{ id: 461, nameZh: "2026年秋季学期", code: "20261", start: "2026-08-30", end: "2027-01-15", isLast: true }],
      status: 200,
      fetchedAt: "now",
      path: "/api/teach/semester/list",
    });

    const options = { offline: false, noCache: true };
    await Promise.all([
      services.common.defaultSemester(options),
      services.common.semesterLabel(461, options),
    ]);

    expect(restricted).toHaveBeenCalledTimes(1);
    expect(semesters).toHaveBeenCalledTimes(1);
    services.repository.close();
  });

  it("rejects offline and no-cache together before making any network request", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-exclusive-options-"));
    const { program, services } = buildCli({ cacheDir });
    program.exitOverride();
    const restricted = vi.spyOn(services.api, "restricted");
    await expect(program.parseAsync(["--offline", "--no-cache", "course", "search", "数学"], { from: "user" }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    expect(restricted).not.toHaveBeenCalled();
    services.repository.close();
  });

  it("stores query arguments after the separator in a named preset", async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-preset-config-"));
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-preset-cache-"));
    vi.stubEnv("XDG_CONFIG_HOME", configDir);
    const { program, services } = buildCli({ cacheDir });
    program.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync([
        "preset", "save", "数学课", "--", "lesson", "list", "--semester", "461", "--course", "数学",
      ], { from: "user" });
      const saved = JSON.parse(fs.readFileSync(path.join(configDir, "catalog-cli", "presets.json"), "utf8"));
      expect(saved["数学课"].args).toEqual(["lesson", "list", "--semester", "461", "--course", "数学"]);
    } finally {
      stdout.mockRestore();
      vi.unstubAllEnvs();
      services.repository.close();
    }
  });

  it("lists static course categories and available classroom buildings offline", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-discovery-"));
    const { program, services } = buildCli({ cacheDir });
    program.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync(["--json", "course", "categories"], { from: "user" });
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0])).data.some((item: { 代码: string }) => item.代码 === "001")).toBe(true);

      await program.parseAsync(["--json", "classroom", "buildings"], { from: "user" });
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0])).data.some((item: { 楼栋代码: string }) => item.楼栋代码 === "1")).toBe(true);
    } finally {
      stdout.mockRestore();
      services.repository.close();
    }
  });

  it("derives lesson options from cached data and applies exact spans plus structured schedule filters", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-lesson-options-"));
    const { program, services } = buildCli({ cacheDir });
    services.repository.write("semesters", "all", "fixture", [{
      id: 461,
      nameZh: "2026 年秋季学期",
      code: "20261",
      start: "2026-08-30",
      end: "2027-01-15",
      isLast: true,
    }]);
    services.repository.write("lessons", "461", "fixture", [
      {
        id: 1,
        code: "MATH1001.01",
        course: { code: "MATH1001", cn: "数学分析" },
        openDepartment: { code: "001", cn: "数学科学学院" },
        education: { cn: "本科" },
        classType: { cn: "计划内与自由选修" },
        courseType: { cn: "理论课" },
        courseClassify: { cn: "安全教育-必修" },
        courseCategory: { cn: "本科计划内课程" },
        courseGradation: { cn: "专业基础" },
        teacherAssignmentList: [{ cn: "张三" }],
        adminClasses: [{ cn: "26数学" }],
        dateTimePlaceText: "5401: 1(3,4)",
        dateTimePlacePersonText: { cn: "1~5,7~10周 5401 :1(3,4) 张三" },
        teachLang: { cn: "中文" },
        examMode: { cn: "笔试" },
        graduateAndPostgraduate: true,
        stdCount: 30,
        limitCount: 40,
      },
      {
        id: 2,
        code: "MATH1002.01",
        course: { code: "MATH1002", cn: "数学分析续论" },
        openDepartment: { code: "001", cn: "数学科学学院" },
        education: { cn: "本科" },
        classType: { cn: "素能拓展" },
        courseType: { cn: "理论课" },
        courseGradation: { cn: "自由选修" },
        teacherAssignmentList: [{ cn: "李四" }],
        dateTimePlaceText: "5401: 1(3,4,5)",
        dateTimePlacePersonText: { cn: "1~5周 5401 :1(3,4,5) 李四" },
      },
    ]);
    program.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync([
        "--json", "--offline", "lesson", "options", "--semester", "461", "--class-type", "计划内与自由选修",
      ], { from: "user" });
      const options = JSON.parse(String(stdout.mock.calls.at(-1)?.[0])).data;
      expect(options.filter((item: { dimension: string }) => item.dimension === "classType").map((item: { value: string }) => item.value))
        .toEqual(["计划内与自由选修", "素能拓展"]);
      expect(options.filter((item: { dimension: string }) => item.dimension === "span"))
        .toEqual([{ dimension: "span", value: "1(3,4)", label: "1(3,4)", count: 1 }]);

      await program.parseAsync([
        "--json", "--offline", "lesson", "list", "--semester", "461", "--span", "1(3,4)",
      ], { from: "user" });
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0])).data.map((item: { code: string }) => item.code))
        .toEqual(["MATH1001.01"]);

      await program.parseAsync([
        "--json", "--offline", "lesson", "list", "--semester", "461", "--class-type", "计划内与自由选修",
        "--weekday", "1", "--period", "4", "--week", "1-5,7-10",
      ], { from: "user" });
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0])).data.map((item: { code: string }) => item.code))
        .toEqual(["MATH1001.01"]);

      await program.parseAsync([
        "--csv", "--offline", "lesson", "list", "--semester", "461", "--limit", "1",
      ], { from: "user" });
      const csv = String(stdout.mock.calls.at(-1)?.[0]);
      expect(csv).toContain("课堂类型,课程范畴分类,课程类型,授课语言,考核方式,本研同堂");
      expect(csv).toContain("计划内与自由选修,安全教育-必修,理论课,中文,笔试,是");
      expect(csv).not.toContain("素能拓展");
    } finally {
      stdout.mockRestore();
      services.repository.close();
    }
  });

  it("finds a room with an exact cached free time window", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-room-window-"));
    const { program, services } = buildCli({ cacheDir });
    services.repository.write("timetable", "2026-08-30", "fixture", {
      timetable: { lessons: [], tmpLessons: [], roomOccupies: [], exams: [], makeupExams: [], tmpExams: [] },
    });
    program.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync([
        "--json", "--offline", "classroom", "available", "--date", "2026-08-30", "--from", "14:00", "--to", "16:00", "--min-seats", "100",
      ], { from: "user" });
      const data = JSON.parse(String(stdout.mock.calls.at(-1)?.[0])).data;
      expect(data.some((room: { classroomCode: string }) => room.classroomCode === "1101")).toBe(true);
    } finally {
      stdout.mockRestore();
      services.repository.close();
    }
  });

  it("exports cached teaching classes to iCalendar without accessing the network", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-ics-"));
    const { program, services } = buildCli({ cacheDir });
    services.repository.write("semesters", "all", "fixture", [{
      id: 461, nameZh: "2026 秋季学期", code: "20261", start: "2026-08-30", end: "2027-01-15", isLast: true,
    }]);
    services.repository.write("lessons", "461", "fixture", [{
      id: 1,
      code: "MATH1001.01",
      course: { code: "MATH1001", cn: "数学分析" },
      dateTimePlaceText: "5401: 1(3,4)",
      dateTimePlacePersonText: { cn: "1,3周 5401 :1(3,4) 张三" },
      teacherAssignmentList: [{ cn: "张三" }],
    }]);
    program.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync(["--offline", "--ics", "lesson", "list", "--semester", "461"], { from: "user" });
      const calendar = stdout.mock.calls.map(([value]) => String(value)).join("");
      expect(calendar).toContain("BEGIN:VCALENDAR");
      expect(calendar).toContain("SUMMARY:数学分析（MATH1001.01）");
      expect(calendar).toContain("DTSTART;TZID=Asia/Shanghai:20260831T094500");
    } finally {
      stdout.mockRestore();
      services.repository.close();
    }
  });

  it("exports cached classroom usage to iCalendar with the source usage type", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-classroom-ics-"));
    const { program, services } = buildCli({ cacheDir });
    services.repository.write("timetable", "2026-10-04", "fixture", {
      timetable: {
        lessons: [],
        tmpLessons: [{ classroomName: "1101", courseName: "读书会", type: "会议", start: "09:30", end: "10:30" }],
        roomOccupies: [],
        exams: [],
        makeupExams: [],
        tmpExams: [],
      },
    });
    program.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync(["--offline", "--ics", "classroom", "list", "--date", "2026-10-04"], { from: "user" });
      const calendar = stdout.mock.calls.map(([value]) => String(value)).join("");
      expect(calendar).toContain("BEGIN:VCALENDAR");
      expect(calendar).toContain("SUMMARY:会议：读书会（1101）");
      expect(calendar).toContain("DTSTART;TZID=Asia/Shanghai:20261004T093000");

      stdout.mockClear();
      await program.parseAsync(["--offline", "--ics", "classroom", "show", "1101", "--date", "2026-10-04"], { from: "user" });
      expect(stdout.mock.calls.map(([value]) => String(value)).join("")).toContain("SUMMARY:会议：读书会（1101）");
    } finally {
      stdout.mockRestore();
      services.repository.close();
    }
  });

  it("runs exam options, schedule, and conflicts entirely from cached semester data", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-exam-commands-"));
    const { program, services } = buildCli({ cacheDir });
    services.repository.write("semesters", "all", "fixture", [
      { id: 461, nameZh: "2026年秋季学期", code: "20261", start: "2026-08-30", end: "2027-01-15", isLast: true },
    ]);
    services.repository.write("exams", "461", "fixture", [
      { id: 1, examType: 2, examDate: "2026-11-04", startTime: 900, endTime: 1000, examRooms: [{ room: "5401", count: 20 }], lesson: { code: "A.01", course: { cn: "甲", credits: 3 }, openDepartment: { code: "001", cn: "数学科学学院" }, courseType: { cn: "理论课" } } },
      { id: 2, examType: 2, examDate: "2026-11-04", startTime: 959, endTime: 1030, examRooms: [{ room: "5401", count: 20 }], lesson: { code: "B.01", course: { cn: "乙" }, openDepartment: { code: "001", cn: "数学科学学院" } } },
      { id: 3, examType: 2, examDate: "2026-11-08", startTime: 900, endTime: 1000, examRooms: [{ room: "A101", count: 20 }], lesson: { code: "C.01", course: { cn: "丙" }, openDepartment: { code: "004", cn: "物理系" } } },
    ]);
    services.repository.write("general-exams", "461", "fixture", [{
      id: 20, courseCode: "001669", courseName: "综合法语", examDate: "2026-09-08T00:00:00+08:00",
      startTime: 1930, endTime: 2130, dept: "数学科学学院", batch: "2026年夏季学期补考", room: "A101",
      education: { cn: "本科" },
    }, {
      id: 21, courseCode: "X", courseName: "时间缺失", examDate: "2026-11-05", dept: "数学科学学院", batch: "2026秋季考试",
    }]);
    program.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await program.parseAsync(["--offline", "--json", "exam", "options", "--semester", "461", "--department", "001", "--type", "补考"], { from: "user" });
      const options = JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
      expect(options.meta.notice).toContain("次日更新");
      expect(options.data).toContainEqual({ dimension: "type", value: "补考", label: "补考", count: 1 });

      stdout.mockClear();
      await program.parseAsync(["--offline", "--json", "exam", "schedule", "--week-of", "2026-11-04", "--semester", "461"], { from: "user" });
      const schedule = JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
      expect(schedule.data).toHaveLength(7);
      expect(schedule.data[0].date).toBe("2026-11-02");
      expect(schedule.data[2].exams).toHaveLength(2);

      stdout.mockClear();
      await program.parseAsync(["--offline", "--json", "exam", "conflicts", "--semester", "461"], { from: "user" });
      const conflicts = JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
      expect(conflicts.data).toMatchObject([{ room: "5401", overlapStart: "09:59", overlapEnd: "10:00" }]);
      expect(conflicts.meta.uncheckableExamCount).toBe(1);
    } finally {
      stdout.mockRestore();
      services.repository.close();
    }
  });

  it("rejects iCalendar output for unsupported commands before running their action", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-ics-unsupported-"));
    const { program, services } = buildCli({ cacheDir });
    program.exitOverride();
    await expect(program.parseAsync(["--ics", "course", "search", "数学"], { from: "user" }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    await expect(program.parseAsync(["--ics", "classroom", "available", "--from", "10:00", "--to", "11:00"], { from: "user" }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    services.repository.close();
  });
});
