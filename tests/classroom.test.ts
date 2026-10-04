import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCli } from "../src/cli.js";
import type { ApiResult } from "../src/infrastructure/http/catalog-api-client.js";

const emptyTimetable = () => ({
  timetable: {
    lessons: [],
    tmpLessons: [],
    roomOccupies: [],
    exams: [],
    makeupExams: [],
    tmpExams: [],
  },
});

const apiResult = <T>(data: T): ApiResult<T> => ({
  data,
  status: 200,
  fetchedAt: "2026-10-04T00:00:00.000Z",
  path: "/fixture",
});

const activeServices: ReturnType<typeof buildCli>["services"][] = [];

afterEach(() => {
  for (const services of activeServices.splice(0)) services.repository.close();
});

const makeServices = (fixtures: Record<string, ReturnType<typeof emptyTimetable>> = {}) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-classroom-"));
  const { services } = buildCli({ cacheDir });
  activeServices.push(services);
  vi.spyOn(services.api, "restricted").mockResolvedValue(apiResult({ restricted: false }));
  const timetable = vi.spyOn(services.api, "timetable").mockImplementation(async (date) =>
    apiResult(fixtures[date] ?? emptyTimetable()),
  );
  return { services, timetable };
};

const options = { offline: false, noCache: true };

describe("classroom query services", () => {
  it("filters by web record type and room properties, and counts unlocated API records", async () => {
    const { services } = makeServices({
      "2026-10-04": {
        timetable: {
          ...emptyTimetable().timetable,
          tmpLessons: [
            { buildingCode: "2", classroomName: "2303", courseName: "读书会", type: "会议", start: "09:30", end: "10:30" },
            { buildingCode: "2", classroomName: "2304", courseName: "班会", type: "班会", start: "09:30", end: "10:30" },
            { buildingCode: null, classroomName: null, courseName: "未定位记录", type: "讲座", start: "09:30", end: "10:30" },
          ],
        },
      },
    });

    const result = await services.classroom.list("2026-10-04", {
      usageType: ["会议"],
      roomType: ["多媒体教室"],
      bookable: true,
      arrangeable: true,
    }, options);

    expect(result.value.map((room) => room.classroomCode)).toEqual(["2303"]);
    expect(result.value[0]).toMatchObject({
      date: "2026-10-04",
      roomType: "2",
      roomTypeName: "多媒体教室",
      canBorrow: true,
      arrangeSchedule: true,
      usages: [{ rawType: "会议" }],
    });
    expect(result.meta.unlocatedUsageCount).toBe(1);
  });

  it("returns only rooms free in the requested interval on every date in a range", async () => {
    const { services, timetable } = makeServices({
      "2026-10-04": {
        timetable: {
          ...emptyTimetable().timetable,
          tmpLessons: [
            { classroomName: "1101", courseName: "活动", start: "14:00", end: "15:00" },
            { buildingCode: "99", classroomName: "UNKNOWN", courseName: "未定位活动", start: "14:00", end: "15:00" },
          ],
          roomOccupies: [{ classroomName: "1109", courseName: "封楼", start: "00:00", end: "23:59" }],
        },
      },
      "2026-10-05": {
        timetable: {
          ...emptyTimetable().timetable,
          tmpLessons: [{ classroomName: "1102", courseName: "活动", start: "14:30", end: "15:30" }],
        },
      },
    });

    const result = await services.classroom.availableAcrossDates("2026-10-04", "2026-10-05", {
      availableBetween: { from: 14 * 60, to: 15 * 60 },
      building: "1",
    }, options);

    const codes = result.value.map((room) => room.classroomCode);
    expect(codes).not.toContain("1101");
    expect(codes).not.toContain("1102");
    expect(codes).not.toContain("1109");
    expect(codes).toContain("1201");
    expect(result.value[0]).toMatchObject({
      dateRange: { from: "2026-10-04", to: "2026-10-05" },
      availableBetween: { from: "14:00", to: "15:00", everyDay: true },
      usages: [],
    });
    expect(result.meta.dataAsOf).toBe("2026-10-04 至 2026-10-05");
    expect(result.meta.unlocatedUsageCount).toBe(1);
    expect(timetable).toHaveBeenCalledTimes(2);
  });

  it("rejects date ranges longer than 31 days before requesting timetable data", async () => {
    const { services, timetable } = makeServices();
    await expect(services.classroom.availableAcrossDates("2026-10-01", "2026-11-01", {
      availableBetween: { from: 600, to: 660 },
    }, options)).rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    expect(timetable).not.toHaveBeenCalled();
  });

  it("summarizes all seven days per room without losing daily usage records", async () => {
    const { services, timetable } = makeServices({
      "2026-10-04": {
        timetable: {
          ...emptyTimetable().timetable,
          tmpLessons: [{ classroomName: "1101", courseName: "社团活动", type: "会议", start: "10:00", end: "11:00" }],
        },
      },
      "2026-10-05": {
        timetable: {
          ...emptyTimetable().timetable,
          roomOccupies: [{ classroomName: "1101", courseName: "封楼", start: "00:00", end: "23:59" }],
        },
      },
    });

    const result = await services.classroom.weekSummary("2026-10-04", {}, options);
    const room = result.value.find((item) => item.classroomCode === "1101");
    expect(timetable).toHaveBeenCalledTimes(7);
    expect(room).toMatchObject({ busyDays: 2, usageCount: 2 });
    expect(room?.days).toHaveLength(7);
    expect(room?.days[0]?.usages[0]?.rawType).toBe("会议");
    expect(result.meta.unlocatedUsageCount).toBe(0);
  });
});
