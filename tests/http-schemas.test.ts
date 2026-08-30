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
  });

  it("rejects changed response shapes instead of passing malformed data downstream", () => {
    expectInvalidData(() => validateApiPayload("/api/teach/semester/list", [{ id: 461 }]));
    expectInvalidData(() => validateApiPayload("/api/teach/course/search?keyword=数学", [{ name: "数学分析" }]));
    expectInvalidData(() => validateApiPayload("/api/teach/timetable-public-all/2026-08-30", {
      timetable: { lessons: "not-an-array" },
    }));
  });
});
