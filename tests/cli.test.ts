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
    expect(program.version()).toBe("USTC-catalog-CLI 0.2.2");
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

  it("rejects iCalendar output for unsupported commands before running their action", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-ics-unsupported-"));
    const { program, services } = buildCli({ cacheDir });
    program.exitOverride();
    await expect(program.parseAsync(["--ics", "course", "search", "数学"], { from: "user" }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    services.repository.close();
  });
});
