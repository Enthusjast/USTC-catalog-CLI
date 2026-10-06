import { describe, expect, it } from "vitest";
import { validateApiPayload } from "../src/infrastructure/http/schemas.js";

const expectInvalidData = (callback: () => unknown): void => {
  try {
    callback();
    throw new Error("expected invalid API data");
  } catch (error) {
    expect(error).toMatchObject({ code: "REMOTE_INVALID_DATA" });
  }
};

describe("catalog API response contracts", () => {
  it("accepts the current public response shapes", () => {
    expect(validateApiPayload("/api/teach/semester/list", [{
      id: 461,
      nameZh: "2026年秋季学期",
      code: "2026A",
      start: "2026-09-01",
      end: "2027-01-31",
      isLast: true,
    }])).toHaveLength(1);
    expect(validateApiPayload("/api/teach/department/college-tree", [{
      id: 1,
      code: "001",
      nameZh: "数学科学学院",
      children: [],
    }, {
      id: 2,
      code: "001001",
      nameZh: "数学系",
    }])).toHaveLength(2);
    expect(validateApiPayload("/api/teach/timetable-public-all/2026-08-30", {
      timetable: {
        lessons: [{ classroomName: "1101" }],
        tmpLessons: [],
        roomOccupies: [],
        exams: [],
        makeupExams: [],
        tmpExams: [],
      },
    })).toMatchObject({ timetable: { lessons: [{ classroomName: "1101" }] } });
    expect(validateApiPayload("/api/teach/course/infos", [{ id: 1, code: "MATH1001" }])).toHaveLength(1);
    expect(validateApiPayload("/api/teach/course-substitute-pool/list", [{
      id: 1,
      substituteCourses: [{ code: "A" }],
      originalCourses: [{ code: "B" }],
    }])).toHaveLength(1);
    expect(validateApiPayload("/api/teach/program/tree", {
      "2": {
        id: 2,
        code: "001",
        nameZh: "数学科学学院",
        majors: {
          "41": {
            id: 41,
            code: "001*1",
            nameZh: "华罗庚数学科技英才班",
            programs: [{ id: 3449, grade: "2026", nameZh: "华罗庚数学科技英才班", trainType: "科技英才班" }],
          },
        },
      },
    })).toMatchObject({ "2": { majors: { "41": { programs: [{ id: 3449 }] } } } });
    expect(validateApiPayload("/api/teach/program/info/3449", {
      trainType: "科技英才班",
      grade: "2026",
      requiredCredits: 164,
      moduleTree: [{
        self: { id: 1, type: "通修课程", requiredSubModuleNum: 1, courses: [] },
        isLeaf: false,
        children: [{ self: { id: 2, type: "军事教育", courses: [{ compulsory: true, totalPeriods: 40, terms: ["1秋"], course: { code: "MIL1001", nameZh: "军事理论" } }] }, isLeaf: true }],
      }],
    })).toMatchObject({ moduleTree: [{ children: [{ self: { courses: [{ course: { code: "MIL1001" } }] } }] }] });
    expect(validateApiPayload("/api/teach/course-module/info/45354", {
      self: { id: 45354, type: "四史一课", courses: [] },
      isLeaf: true,
    })).toMatchObject({ self: { id: 45354 }, isLeaf: true });
  });

  it("rejects changed response shapes instead of passing malformed data downstream", () => {
    expectInvalidData(() => validateApiPayload("/api/teach/semester/list", [{ id: 461 }]));
    expectInvalidData(() => validateApiPayload("/api/teach/course/search?keyword=数学", [{ name: "数学分析" }]));
    expectInvalidData(() => validateApiPayload("/api/teach/timetable-public-all/2026-08-30", {
      timetable: { lessons: "not-an-array" },
    }));
    expectInvalidData(() => validateApiPayload("/api/teach/timetable-public-all/2026-08-30", {
      timetable: { error: "upstream failure" },
    }));
    expectInvalidData(() => validateApiPayload("/api/teach/lesson/list-for-teach/461", [{ id: "bad", code: 123 }]));
    expectInvalidData(() => validateApiPayload("/api/teach/lesson/list-for-teach/461", [{ id: 1, code: "MATH.01", course: "not an object" }]));
    expectInvalidData(() => validateApiPayload("/api/teach/course/infos", { id: 1, code: "MATH1001" }));
    expectInvalidData(() => validateApiPayload("/api/teach/program/tree", { "2": { majors: "bad" } }));
    expectInvalidData(() => validateApiPayload("/api/teach/program/info/3449", { moduleTree: "bad" }));
    expectInvalidData(() => validateApiPayload("/api/teach/course-module/info/45354", { self: { id: 1 } }));
  });
});
