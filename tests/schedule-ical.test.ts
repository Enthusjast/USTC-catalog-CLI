import { describe, expect, it } from "vitest";
import { normalizeExams, normalizeLesson, normalizeTimetable } from "../src/adapters/adapters.js";
import { classroomCalendarEvents, examCalendarEvents, lessonCalendarEvents, serializeIcalendar } from "../src/presentation/ical.js";
import { requestedChannels } from "../src/domain/schedule.js";

describe("calendar export", () => {
  const semester = {
    id: 461,
    code: "20261",
    nameZh: "2026 秋季学期",
    start: "2026-08-30",
    end: "2026-12-31",
  };

  it("expands requested lesson weeks into Asia/Shanghai calendar events", () => {
    const lesson = normalizeLesson({
      id: 1,
      code: "MATH1001.01",
      course: { code: "MATH1001", cn: "数学分析" },
      teacherAssignmentList: [{ cn: "张三" }],
      dateTimePlaceText: "5401: 1(3,4)",
      dateTimePlacePersonText: { cn: "1,3周 5401 :1(3,4) 张三" },
    });
    const calendar = serializeIcalendar("教学班", lessonCalendarEvents([lesson], semester).events);
    expect(calendar).toContain("TZID:Asia/Shanghai");
    expect(calendar).toContain("DTSTART;TZID=Asia/Shanghai:20260831T094500");
    expect(calendar).toContain("DTSTART;TZID=Asia/Shanghai:20260914T094500");
    expect(calendar).toContain("SUMMARY:数学分析（MATH1001.01）");
  });

  it("exports dated exams and folds escaped UTF-8 lines at the ICS limit", () => {
    const exams = normalizeExams([], [{
      id: 9,
      courseCode: "MATH1001",
      courseName: `${"数学分析".repeat(16)},期末`,
      examDate: "2026-12-20",
      startTime: 830,
      endTime: 1030,
      room: "3A101",
      persons: [],
    }]);
    const { events, skipped } = examCalendarEvents(exams);
    expect(skipped).toBe(0);
    const calendar = serializeIcalendar("考试", events);
    expect(calendar).toContain("DTSTART;TZID=Asia/Shanghai:20261220T083000");
    expect(calendar).toContain("\\,期末");
    expect(calendar.endsWith("\r\n")).toBe(true);
    for (const line of calendar.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it("uses an exclusive next-day end for exams exported as all-day events", () => {
    const exams = normalizeExams([], [{
      id: 10,
      courseCode: "MATH1001",
      courseName: "数学分析",
      examDate: "2026-12-31",
    }]);
    const { events } = examCalendarEvents(exams);
    expect(events[0]).toMatchObject({ start: "20261231", end: "20270101", allDay: true });
  });

  it("exports only valid classroom usage intervals and retains website event types", () => {
    const usages = normalizeTimetable({
      timetable: {
        tmpLessons: [
          { classroomName: "1101", courseName: "研讨会", type: "会议", start: "09:30", end: "10:30" },
          { classroomName: "1102", courseName: "无效时间", type: "班会", start: "bad", end: "10:30" },
        ],
      },
    }, "2026-10-04");
    const result = classroomCalendarEvents(usages);
    expect(result.skipped).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      summary: "会议：研讨会（1101）",
      start: "20261004T093000",
      end: "20261004T103000",
      location: "1101",
    });
  });

  it("does not pretend that a layout without period 5 has a matching free-period channel", () => {
    expect(requestedChannels(5, 1)).toEqual([5]);
    expect(requestedChannels(5, 2)).toEqual([]);
  });
});
