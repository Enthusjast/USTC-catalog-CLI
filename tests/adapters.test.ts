import { describe, expect, it } from "vitest";
import {
  filterExams,
  examFilterOptions,
  findExamConflicts,
  filterLessons,
  filterSubstitutes,
  findLessonConflicts,
  mergeClassroomUsages,
  normalizeExams,
  normalizeLesson,
  normalizeLessonDetail,
  normalizeSubstitutes,
  normalizeTimetable,
  sortLessons,
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
      classType: { cn: "计划内与自由选修" },
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
    expect(lesson.classType).toBe("计划内与自由选修");
    expect(lesson.courseClassify).toBeNull();
    expect(filterLessons([lesson], { course: "数学" })).toHaveLength(1);
    expect(filterLessons([lesson], { classType: "计划内与自由选修" })).toHaveLength(1);
    expect(filterLessons([lesson], { classType: "理论课" })).toHaveLength(0);
    expect(filterLessons([lesson], { course: "不存在" })).toHaveLength(0);
  });

  it("matches exact web spans and conjunctive weekday, period, and week filters", () => {
    const lesson = normalizeLesson({
      id: 1,
      code: "MATH1001.01",
      course: { code: "MATH1001", cn: "数学分析" },
      dateTimePlaceText: "5401: 1(3,4)",
      dateTimePlacePersonText: { cn: "1~15周 5401 :1(3,4) 张三" },
    });
    expect(filterLessons([lesson], { span: "1(3,4)" })).toHaveLength(1);
    expect(filterLessons([
      normalizeLesson({
        id: 2,
        code: "MATH1002.01",
        course: { code: "MATH1002", cn: "数学分析续论" },
        dateTimePlaceText: "5401: 1(3,4,5)",
        dateTimePlacePersonText: { cn: "1~15周 5401 :1(3,4,5) 张三" },
      }),
    ], { span: "1(3,4)" })).toHaveLength(0);
    expect(filterLessons([lesson], { weekday: 1, period: 4, week: "1-3,7" })).toHaveLength(1);
    expect(filterLessons([lesson], { weekday: 2, period: 4 })).toHaveLength(0);
    expect(filterLessons([lesson], { week: "16-18" })).toHaveLength(0);
    expect(filterLessons([
      { ...lesson, spans: [{ day: 1, periods: [4], weeks: "单周", text: "单周" }] },
    ], { weekday: 1, period: 4, week: "3" })).toHaveLength(0);

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

  it("supports sorting lessons by the website's department code", () => {
    const lessons = [
      normalizeLesson({ id: 1, code: "B.01", course: { cn: "课程B" }, openDepartment: { code: "010", cn: "乙系" } }),
      normalizeLesson({ id: 2, code: "A.01", course: { cn: "课程A" }, openDepartment: { code: "002", cn: "甲系" } }),
    ];
    expect(sortLessons(lessons, "department-code").map((lesson) => lesson.code)).toEqual(["A.01", "B.01"]);
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
    expect(relations[0].originalCourses[0]).toMatchObject({ hours: 1, credits: 1 });
    expect(filterSubstitutes(relations, undefined, "interchangeable")).toHaveLength(1);

    const originalSideMultiple = normalizeSubstitutes([{
      id: 3,
      substituteCourses: [{ id: 1, code: "A", cn: "A" }],
      originalCourses: [{ id: 2, code: "B", cn: "B" }, { id: 3, code: "C", cn: "C" }],
    }]);
    expect(originalSideMultiple[0].multiple).toBe(true);
  });

  it("sorts substitute relations before reverse merging to match the website's canonical direction", () => {
    const relations = normalizeSubstitutes([
      {
        id: 20,
        substituteCourses: [{ id: 3, code: "Z", cn: "课程 Z" }],
        originalCourses: [{ id: 1, code: "A", cn: "课程 A" }, { id: 2, code: "B", cn: "课程 B" }],
      },
      {
        id: 10,
        substituteCourses: [{ id: 1, code: "A", cn: "课程 A" }, { id: 2, code: "B", cn: "课程 B" }],
        originalCourses: [{ id: 3, code: "Z", cn: "课程 Z" }],
      },
    ]);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ id: 10, interchangeable: true, multiple: true });
    expect(relations[0].substituteCourses.map((course) => course.code)).toEqual(["A", "B"]);
    expect(relations[0].originalCourses.map((course) => course.code)).toEqual(["Z"]);
  });

  it("filters substitute relations on the requested course side", () => {
    const relation = normalizeSubstitutes([{
      id: 1,
      substituteCourses: [{ id: 1, code: "A", cn: "替代课程" }],
      originalCourses: [{ id: 2, code: "B", cn: "原课程" }],
    }]);

    expect(filterSubstitutes(relation, "替代课程", undefined, undefined, "substitute")).toHaveLength(1);
    expect(filterSubstitutes(relation, "原课程", undefined, undefined, "substitute")).toHaveLength(0);
    expect(filterSubstitutes(relation, "原课程", undefined, undefined, "original")).toHaveLength(1);
    expect(filterSubstitutes(relation, "替代课程", undefined, undefined, "original")).toHaveLength(0);
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

  it("preserves general exam batch and gradation semantics and maps website building buckets", () => {
    const exams = normalizeExams([
      {
        id: 10,
        examType: 2,
        examDate: "2026-07-25",
        startTime: 830,
        endTime: 1030,
        examRooms: [{ room: "2101", count: 20 }],
        lesson: {
          code: "MATH1001.01",
          course: { cn: "数学分析", credits: 6 },
          openDepartment: { code: "001", cn: "数学科学学院" },
          education: { cn: "研究生" },
          courseGradation: { cn: "本研贯通" },
          teacherAssignmentList: [{ cn: "张三" }],
        },
      },
      {
        id: 11,
        examType: 2,
        examDate: "2026-07-26",
        startTime: 900,
        endTime: 1100,
        examRooms: [{ room: "2201", count: 20 }],
        lesson: {
          code: "PHYS1001.01",
          course: { cn: "力学" },
          openDepartment: { code: "004", cn: "物理系" },
          education: { cn: "研究生" },
          courseGradation: { cn: "专业基础" },
        },
      },
    ], [
      {
        id: 12,
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
    ], new Map([["数学科学学院", "001"]]));

    expect(exams[2]).toMatchObject({ recordKind: "general", type: "补考", batch: "2026年夏季学期补考", departmentCode: "001" });
    expect(filterExams(exams, { department: "001" })).toHaveLength(2);
    expect(filterExams(exams, { department: "数学科学学院" })).toHaveLength(2);
    expect(filterExams(exams, { building: "0" }).map((exam) => exam.id)).toEqual([12]);
    expect(filterExams(exams, { education: "本研贯通" }).map((exam) => exam.id)).toEqual([10]);
    expect(filterExams(exams, { education: "研究生" }).map((exam) => exam.id)).toEqual([11]);

    const options = examFilterOptions(exams, { department: "001" });
    expect(options).toEqual(expect.arrayContaining([
      { dimension: "type", value: "补考", label: "补考", count: 1 },
      { dimension: "building", value: "0", label: "其他", count: 1 },
      { dimension: "department", value: "004", label: "004 物理系", count: 1 },
    ]));
  });

  it("finds only strict same-room interval overlaps and reports uncheckable exams", () => {
    const exams = normalizeExams([
      { id: 1, examType: 1, examDate: "2026-11-04", startTime: 900, endTime: 1000, examRooms: [{ room: "5401", count: 20 }], lesson: { code: "A.01", course: { cn: "甲" } } },
      { id: 2, examType: 1, examDate: "2026-11-04", startTime: 959, endTime: 1030, examRooms: [{ room: "5401", count: 20 }], lesson: { code: "B.01", course: { cn: "乙" } } },
      { id: 3, examType: 1, examDate: "2026-11-04", startTime: 1030, endTime: 1100, examRooms: [{ room: "5401", count: 20 }], lesson: { code: "C.01", course: { cn: "丙" } } },
      { id: 4, examType: 1, examDate: "2026-11-04", examRooms: [{ room: "5401", count: 20 }], lesson: { code: "D.01", course: { cn: "缺时间" } } },
    ], []);
    expect(filterExams(exams, { span: "morning" }).map((exam) => exam.id)).toEqual([1, 2, 3]);
    const report = findExamConflicts(exams);
    expect(report.uncheckableCount).toBe(1);
    expect(report.conflicts).toMatchObject([{
      date: "2026-11-04",
      room: "5401",
      overlapStart: "09:59",
      overlapEnd: "10:00",
      first: { id: 1 },
      second: { id: 2 },
    }]);
  });

  it("uses the website's visible course category mapping", () => {
    expect(COURSE_CATALOG_BY_CODE.get("001")?.sourceIds).toEqual(["2", "5", "6", "61"]);
    expect(COURSE_CATALOG_BY_CODE.get("cs+es+in")?.sourceIds).toEqual(["49", "41", "47", "102"]);
  });

  it("keeps the static room inventory aligned with visible classroom buildings", () => {
    expect(STATIC_ROOMS.some((room) => room.buildingCode === "17")).toBe(false);
    expect(STATIC_ROOMS).toHaveLength(257);
    expect(STATIC_ROOMS.every((room) => room.enabled && (room.canBorrow || room.arrangeSchedule))).toBe(true);
    expect(STATIC_ROOMS.find((room) => room.code === "2102")).toMatchObject({
      roomTypeCode: "5",
      arrangeSchedule: false,
      canBorrow: true,
    });
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

  it("preserves web usage labels and never merges different temporary-use types", () => {
    const records = normalizeTimetable({
      timetable: {
        tmpLessons: [
          { classroomName: "1101", courseName: "活动", type: "会议", applierName: "张老师", start: "9:30", end: "10:30" },
          { classroomName: "1101", courseName: "活动", type: "班会", applierName: "张老师", start: "10:00", end: "10:30" },
        ],
      },
    }, "2026-10-04");

    expect(records.map((item) => item.rawType)).toEqual(["会议", "班会"]);
    expect(mergeClassroomUsages(records.map((item) => ({ ...item, channels: [3, 4] })))).toHaveLength(2);
  });
});
