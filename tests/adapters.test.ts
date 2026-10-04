import { describe, expect, it } from "vitest";
import {
  filterExams,
  filterLessons,
  filterSubstitutes,
  findLessonConflicts,
  mergeClassroomUsages,
  normalizeExams,
  normalizeLesson,
  normalizeLessonDetail,
  normalizeSubstitutes,
  normalizeTimetable,
  sortExams,
} from "../src/adapters/adapters.js";
import { COURSE_CATALOG_BY_CODE } from "../src/data/course-catalog.js";
import { STATIC_ROOMS } from "../src/data/rooms.js";

describe("web behavior adapters", () => {
  it("normalizes lesson fields and filters by course", () => {
    const lesson = normalizeLesson({
      id: 1,
      code: "MATH1001.01",
      course: { id: 2, code: "MATH1001", cn: "数学分析", en: "Analysis" },
      education: { cn: "本科", en: "Undergraduate" },
      courseType: { cn: "理论课" },
      courseGradation: { cn: "专业基础" },
      courseCategory: { cn: "本科计划内课程" },
      courseClassify: { cn: null },
      openDepartment: { code: "001", cn: "数学科学学院" },
      teacherAssignmentList: [{ cn: "张三", en: "Zhang San" }],
      adminClasses: [],
      dateTimePlaceText: "5401: 1(3,4)",
      dateTimePlacePersonText: { cn: "1~15周 5401 :1(3,4) 张三" },
    });

    expect(lesson.courseCode).toBe("MATH1001");
    expect(lesson.courseClassify).toBeNull();
    expect(filterLessons([lesson], { course: "数学" })).toHaveLength(1);
    expect(filterLessons([lesson], { course: "不存在" })).toHaveLength(0);
  });

  it("matches normalized lesson spans and reports overlaps only in shared weeks", () => {
    const lesson = normalizeLesson({
      id: 1,
      code: "MATH1001.01",
      course: { code: "MATH1001", cn: "数学分析" },
      dateTimePlaceText: "5401: 1(3,4)",
      dateTimePlacePersonText: { cn: "1~15周 5401 :1(3,4) 张三" },
    });
    expect(filterLessons([lesson], { span: "1(3,4)" })).toHaveLength(1);

    const conflicts = findLessonConflicts([
      lesson,
      { ...lesson, code: "PHYS1001.01", courseCode: "PHYS1001", spans: [{ day: 1, periods: [4], weeks: "1~3" }] },
      { ...lesson, code: "CS1001.01", courseCode: "CS1001", spans: [{ day: 1, periods: [4], weeks: "8~10" }] },
    ]);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].lessons.map((item) => item.code)).toEqual(["MATH1001.01", "PHYS1001.01"]);
  });

  it("keeps course and teaching-class detail as separate layers", () => {
    const detail = normalizeLessonDetail({
      id: 1,
      code: "MATH1001.01",
      courseId: 2,
      name: { cn: "数学分析", en: "Analysis" },
      dept: "数学科学学院",
      credit: 6,
      hour: 120,
      courseType: "理论课",
      courseCategory: "本科计划内课程",
      examType: "笔试（闭卷）",
      lang: "中文",
      valid: true,
      textbooks: [],
      syllabus: {},
    });
    expect(detail.course.nameZh).toBe("数学分析");
    expect(detail.lesson.code).toBe("MATH1001.01");
    expect(detail.lesson.courseName).toBe("数学分析");
    expect(detail.lesson.credits).toBe(6);
    expect(detail.lesson.examMode).toBe("笔试（闭卷）");
    expect(detail.teachingClassDataAvailable).toBe(false);
  });

  it("merges reverse substitute relations and detects both-side multiple courses", () => {
    const relations = normalizeSubstitutes([
      {
        id: 1,
        substituteCourses: [{ id: 1, code: "A", cn: "A", period: 1, credits: 1 }],
        originalCourses: [
          { id: 2, code: "B", cn: "B", period: 1, credits: 1 },
          { id: 3, code: "C", cn: "C", period: 1, credits: 1 },
        ],
      },
      {
        id: 2,
        substituteCourses: [
          { id: 2, code: "B", cn: "B", period: 1, credits: 1 },
          { id: 3, code: "C", cn: "C", period: 1, credits: 1 },
        ],
        originalCourses: [{ id: 1, code: "A", cn: "A", period: 1, credits: 1 }],
      },
    ]);

    expect(relations).toHaveLength(1);
    expect(relations[0].interchangeable).toBe(true);
    expect(relations[0].multiple).toBe(true);
    expect(filterSubstitutes(relations, undefined, "interchangeable")).toHaveLength(1);
  });

  it("unifies planned and general exams and filters teachers", () => {
    const exams = normalizeExams(
      [
        {
          id: 1,
          examType: 2,
          examDate: "2026-07-25",
          startTime: 830,
          endTime: 1030,
          examRooms: [{ room: "3A101", count: 20 }],
          lesson: {
            code: "MATH1001.01",
            course: { cn: "数学分析", credits: 6 },
            openDepartment: { code: "001", cn: "数学科学学院" },
            teacherAssignmentList: [{ cn: "张三" }],
            education: { cn: "本科" },
          },
        },
      ],
      [],
    );
    expect(exams[0].type).toBe("期末考试");
    expect(exams[0].teachers).toEqual(["张三"]);
    expect(filterExams(exams, { teacher: "张三" })).toHaveLength(1);
    expect(filterExams(exams, { date: "2026-07-26" })).toHaveLength(0);
    expect(filterExams(exams, { span: "morning" })).toHaveLength(1);
    expect(filterExams(exams, { span: "evening" })).toHaveLength(0);
    expect(sortExams(exams, "course", true)[0].courseCode).toBe("MATH1001.01");
  });

  it("uses the website's visible course category mapping", () => {
    expect(COURSE_CATALOG_BY_CODE.get("001")?.sourceIds).toEqual(["2", "5", "6", "61"]);
    expect(COURSE_CATALOG_BY_CODE.get("cs+es+in")?.sourceIds).toEqual(["49", "41", "47", "102"]);
  });

  it("keeps the static room inventory aligned with visible classroom buildings", () => {
    expect(STATIC_ROOMS.some((room) => room.buildingCode === "17")).toBe(false);
  });

  it("merges timetable usage records and keeps course ids searchable", () => {
    const usages = normalizeTimetable({
      timetable: {
        lessons: [
          {
            classroomName: "1101",
            courseId: "MATH1001",
            courseName: "数学分析",
            teachers: ["张三"],
            start: "19:30",
            end: "21:00",
          },
          {
            classroomName: "1101",
            courseId: "MATH1001",
            courseName: "数学分析",
            teachers: ["李四"],
            start: "20:00",
            end: "21:55",
          },
        ],
      },
    }, "2026-08-26");
    const merged = mergeClassroomUsages(usages);
    expect(merged).toHaveLength(1);
    expect(merged[0].courseIds).toEqual(["MATH1001"]);
    expect(merged[0].teachers).toEqual(["张三", "李四"]);
  });

  it("merges overlapping clock times without losing the earliest start", () => {
    const records = normalizeTimetable({
      timetable: {
        tmpLessons: [
          { classroomName: "1101", courseName: "班会", applierName: "张老师", start: "9:30", end: "10:30" },
          { classroomName: "1101", courseName: "班会", applierName: "张老师", start: "10:00", end: "11:00" },
        ],
      },
    }, "2026-10-04");
    expect(mergeClassroomUsages(records.map((item) => ({ ...item, channels: [3, 4] }))))
      .toMatchObject([{ start: "09:30", end: "11:00" }]);
  });
});
