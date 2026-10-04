import type { Lesson, LessonConflict } from "../domain/models.js";
import { findLessonConflicts } from "../adapters/adapters.js";
import { spanHasUnparsedWeeks } from "../domain/schedule.js";

export type LessonConflictReport = {
  conflicts: LessonConflict[];
  unparsedLessons: Array<{ code: string; courseName: string; scheduleText: string }>;
};

export const buildLessonConflictReport = (lessons: Lesson[]): LessonConflictReport => ({
  conflicts: findLessonConflicts(lessons),
  unparsedLessons: lessons
    .filter((lesson) => lesson.spans.length === 0 || lesson.spans.some(spanHasUnparsedWeeks))
    .map(({ code, courseName, scheduleText }) => ({ code, courseName, scheduleText })),
});
