import type { LessonSpan } from "./models.js";

export type TeachingPeriod = {
  number: number | null;
  start: number;
  end: number;
  channel: number;
  label: string;
};

const layoutPeriods: Record<number, TeachingPeriod[]> = {
  1: [
    [750, 835], [840, 925], [945, 1030], [1035, 1120], [1125, 1210],
    [1220, 1340], [1400, 1445], [1450, 1535], [1555, 1640], [1645, 1730],
    [1735, 1820], [1830, 1920], [1930, 2015], [2020, 2105], [2110, 2155],
  ].map(([start, end], index) => ({
    number: index === 5 || index === 11 ? null : index < 5 ? index + 1 : index < 11 ? index : index - 1,
    start,
    end,
    channel: index + 1,
    label: index === 5 ? "中午" : index === 11 ? "傍晚" : String(index < 5 ? index + 1 : index < 11 ? index : index - 1),
  })),
  2: [
    [800, 845], [850, 935], [1010, 1055], [1100, 1145], [1155, 1350],
    [1400, 1445], [1450, 1535], [1610, 1655], [1700, 1745], [1750, 1835],
    [1845, 1920], [1930, 2015], [2020, 2105], [2110, 2155],
  ].map(([start, end], index) => ({
    number: index === 4 || index === 10 ? null : index < 4 ? index + 1 : index < 10 ? index + 1 : index,
    start,
    end,
    channel: index + 1,
    label: index === 4 ? "中午" : index === 10 ? "傍晚" : String(index < 4 ? index + 1 : index < 10 ? index + 1 : index),
  })),
};

export const teachingPeriods = (layout = 1): TeachingPeriod[] =>
  layoutPeriods[layout] ?? layoutPeriods[1];

export const timeToMinutes = (value: string): number | undefined => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
};

export const hhmmToMinutes = (value: number): number => Math.floor(value / 100) * 60 + value % 100;

export const parseWeekNumbers = (value: string | undefined): number[] | undefined => {
  if (!value) return undefined;
  const weeks = new Set<number>();
  for (const segment of value.split(/[，,、]/)) {
    const range = segment.trim().match(/^(\d+)\s*[-~至]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < start || end > 60) return undefined;
      for (let week = start; week <= end; week += 1) weeks.add(week);
      continue;
    }
    const single = segment.trim().match(/^\d+$/);
    if (!single) return undefined;
    const week = Number(segment);
    if (week < 1 || week > 60) return undefined;
    weeks.add(week);
  }
  return [...weeks].sort((a, b) => a - b);
};

export const spanWeeks = (span: LessonSpan): number[] | undefined =>
  parseWeekNumbers(span.weeks);

export const parseLessonSpanFilter = (value: string): { day: number; periods: number[] } | undefined => {
  const match = value.trim().match(/^([1-7])\s*\((\d+(?:\s*[，,、]\s*\d+)*)\)$/);
  if (!match) return undefined;
  const periods = match[2].split(/[，,、]/).map((item) => Number(item.trim()));
  if (periods.some((period) => !Number.isInteger(period) || period < 1 || period > 13)) return undefined;
  return { day: Number(match[1]), periods };
};

export const lessonSpanKey = (span: LessonSpan): string | undefined =>
  span.day === undefined || span.periods.length === 0
    ? undefined
    : `${span.day}(${span.periods.join(",")})`;

export const spanHasUnparsedWeeks = (span: LessonSpan): boolean =>
  span.weeks !== undefined && spanWeeks(span) === undefined;

export const spanPeriods = (span: LessonSpan, layout = 1): TeachingPeriod[] => {
  const periods = teachingPeriods(layout);
  return span.periods.flatMap((period) => {
    const item = periods.find((candidate) => candidate.number === period);
    return item ? [item] : [];
  });
};

export const requestedChannels = (period: number | "noon" | "evening", layout = 1): number[] => {
  const periods = teachingPeriods(layout);
  const selected = period === "noon"
    ? periods.filter((item) => item.label === "中午")
    : period === "evening"
      ? periods.filter((item) => item.label === "傍晚")
      : periods.filter((item) => item.number === period);
  return selected.map((item) => item.channel);
};

export const timeRangeOverlaps = (
  start: string,
  end: string,
  fromMinutes: number,
  toMinutes: number,
): boolean => {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return startMinutes !== undefined && endMinutes !== undefined &&
    startMinutes < toMinutes && endMinutes > fromMinutes;
};

export const scheduleSpansConflict = (left: LessonSpan, right: LessonSpan): boolean => {
  if (left.day === undefined || right.day === undefined || left.day !== right.day) return false;
  const leftWeeks = spanWeeks(left);
  const rightWeeks = spanWeeks(right);
  if (spanHasUnparsedWeeks(left) || spanHasUnparsedWeeks(right)) return false;
  if (leftWeeks && rightWeeks && !leftWeeks.some((week) => rightWeeks.includes(week))) return false;
  return left.periods.some((period) => right.periods.includes(period));
};
