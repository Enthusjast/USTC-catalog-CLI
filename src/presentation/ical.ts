import type { ClassroomUsage, Exam, Lesson, LessonSpan, Semester } from "../domain/models.js";
import { spanHasUnparsedWeeks, spanPeriods, spanWeeks, timeToMinutes } from "../domain/schedule.js";
import { CliError } from "../domain/errors.js";

const MAX_CALENDAR_EVENTS = 20_000;

export type IcsEvent = {
  uid: string;
  summary: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  description?: string;
  location?: string;
};

const escapeText = (value: string): string => value
  .replace(/\\/g, "\\\\")
  .replace(/\r?\n/g, "\\n")
  .replace(/,/g, "\\,")
  .replace(/;/g, "\\;");

const foldLine = (value: string): string => {
  const chunks: string[] = [];
  let current = "";
  let octets = 0;
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (octets + size > 75) {
      chunks.push(current);
      current = ` ${codePoint}`;
      octets = size + 1;
    } else {
      current += codePoint;
      octets += size;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n");
};

const datePart = (value: string): string => value.replaceAll("-", "");
const nextDate = (value: string): string => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
};
const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const timePart = (value: number): string => {
  const hours = Math.floor(value / 60).toString().padStart(2, "0");
  const minutes = (value % 60).toString().padStart(2, "0");
  return `${hours}${minutes}00`;
};

const hhmmToMinutes = (value: number): number => Math.floor(value / 100) * 60 + value % 100;

const dateForWeekday = (semesterStart: string, weekday: number, week: number): string | undefined => {
  const [year, month, day] = semesterStart.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  const offset = (weekday - anchor.getUTCDay() + 7) % 7 + (week - 1) * 7;
  const date = new Date(anchor.getTime() + offset * 86400000).toISOString().slice(0, 10);
  return date >= semesterStart ? date : undefined;
};

const weekNumbers = (span: LessonSpan, semester: Semester): number[] => {
  const explicit = spanWeeks(span);
  if (explicit) return explicit;
  const [startYear, startMonth, startDay] = semester.start.split("-").map(Number);
  const [endYear, endMonth, endDay] = semester.end.split("-").map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  const weeks = Math.floor((end - start) / (7 * 86400000)) + 1;
  return Array.from({ length: Math.min(weeks, 60) }, (_, index) => index + 1);
};

export const lessonCalendarEvents = (lessons: Lesson[], semester: Semester): { events: IcsEvent[]; skipped: number } => {
  const events: IcsEvent[] = [];
  let skipped = 0;
  for (const lesson of lessons) {
    for (const span of lesson.spans) {
      if (span.day === undefined || spanPeriods(span).length === 0 || spanHasUnparsedWeeks(span)) {
        skipped += 1;
        continue;
      }
      const periods = spanPeriods(span);
      const first = hhmmToMinutes(periods[0].start);
      const last = hhmmToMinutes(periods.at(-1)!.end);
      for (const week of weekNumbers(span, semester)) {
        const date = dateForWeekday(semester.start, span.day, week);
        if (!date || date > semester.end) continue;
        events.push({
          uid: `lesson-${encodeURIComponent(lesson.code)}-${week}-${span.day}-${first}-${last}@ustc-catalog-cli`,
          summary: `${lesson.courseName}（${lesson.code}）`,
          start: `${datePart(date)}T${timePart(first)}`,
          end: `${datePart(date)}T${timePart(last)}`,
          description: [
            `课堂号：${lesson.code}`,
            `教师：${lesson.teachers.map((teacher) => teacher.nameZh).join("、") || "未知"}`,
            `周次：${week}`,
            span.text,
          ].join("\n"),
          location: lesson.locations.map((location) => location.text).join("、"),
        });
        if (events.length > MAX_CALENDAR_EVENTS) {
          throw new CliError("ARGUMENT_ERROR", `日历导出超过 ${MAX_CALENDAR_EVENTS} 条活动上限。`, "请按课程、院系或教师筛选，或使用 --limit 缩小结果范围。");
        }
      }
    }
  }
  return { events, skipped };
};

export const examCalendarEvents = (exams: Exam[]): { events: IcsEvent[]; skipped: number } => {
  const events: IcsEvent[] = [];
  let skipped = 0;
  for (const exam of exams) {
    if (!validDate(exam.date)) {
      skipped += 1;
      continue;
    }
    const start = exam.startTime ? timeToMinutes(exam.startTime) : undefined;
    const end = exam.endTime ? timeToMinutes(exam.endTime) : undefined;
    if ((exam.startTime && start === undefined) || (exam.endTime && end === undefined) || (start !== undefined && end !== undefined && end <= start)) {
      skipped += 1;
      continue;
    }
    const allDay = start === undefined || end === undefined;
    events.push({
      uid: `exam-${exam.id}-${datePart(exam.date)}@ustc-catalog-cli`,
      summary: `${exam.type}：${exam.courseName}（${exam.courseCode}）`,
      ...(allDay
        ? { start: datePart(exam.date), end: datePart(nextDate(exam.date)), allDay: true }
        : { start: `${datePart(exam.date)}T${timePart(start!)}`, end: `${datePart(exam.date)}T${timePart(end!)}` }),
      description: [
        `考试类型：${exam.type}`,
        `课程：${exam.courseCode} ${exam.courseName}`,
        `教师：${exam.teachers.join("、") || "未知"}`,
        `班级：${exam.classes.join("、") || "未知"}`,
      ].join("\n"),
      location: exam.rooms.map((room) => room.room).join("、"),
    });
  }
  return { events, skipped };
};

export const classroomCalendarEvents = (usages: ClassroomUsage[]): { events: IcsEvent[]; skipped: number } => {
  const events: IcsEvent[] = [];
  let skipped = 0;
  for (const [index, usage] of usages.entries()) {
    if (!validDate(usage.date)) {
      skipped += 1;
      continue;
    }
    const start = timeToMinutes(usage.start);
    const end = timeToMinutes(usage.end);
    if (start === undefined || end === undefined || end <= start) {
      skipped += 1;
      continue;
    }
    const date = datePart(usage.date);
    const kind = usage.rawType ?? ({
      lesson: "课程",
      temporary: "临时借用",
      exam: "考试",
      occupancy: "占用",
    }[usage.usageType]);
    const allDay = start === 0 && end >= 23 * 60 + 59;
    events.push({
      uid: `classroom-${encodeURIComponent(usage.classroomCode)}-${date}-${start}-${end}-${index}@ustc-catalog-cli`,
      summary: `${kind}：${usage.courseName || "教室使用"}（${usage.classroomCode}）`,
      ...(allDay
        ? { start: date, end: datePart(nextDate(usage.date)), allDay: true }
        : { start: `${date}T${timePart(start)}`, end: `${date}T${timePart(end)}` }),
      description: [
        `使用类型：${kind}`,
        `教室：${usage.classroomCode}`,
        `课程编号：${usage.courseIds.join("、") || "无"}`,
        `教师：${usage.teachers.join("、") || "无"}`,
        `申请人：${usage.applicant ?? "无"}`,
        `主办方：${usage.sponsor ?? "无"}`,
      ].join("\n"),
      location: usage.classroomCode,
    });
    if (events.length > MAX_CALENDAR_EVENTS) {
      throw new CliError("ARGUMENT_ERROR", `日历导出超过 ${MAX_CALENDAR_EVENTS} 条活动上限。`, "请按日期或楼栋筛选，或使用 --limit 缩小结果范围。");
    }
  }
  return { events, skipped };
};

export const serializeIcalendar = (name: string, events: IcsEvent[]): string => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//USTC//Catalog CLI//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Shanghai",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:CST",
    "END:STANDARD",
    "END:VTIMEZONE",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${escapeText(event.uid)}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${event.start}`, `DTEND;VALUE=DATE:${event.end}`);
    } else if (event.start && event.end) {
      lines.push(`DTSTART;TZID=Asia/Shanghai:${event.start}`, `DTEND;TZID=Asia/Shanghai:${event.end}`);
    }
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
};
