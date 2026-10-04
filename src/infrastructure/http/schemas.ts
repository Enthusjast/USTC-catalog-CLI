import { z } from "zod";
import { CliError } from "../../domain/errors.js";

const recordPayload = z.record(z.unknown());
const scalarId = z.union([z.string(), z.number()]);

const recordsPayload = z.array(recordPayload);
const courseInfoItem = recordPayload.superRefine((value, context) => {
  if (typeof value.code !== "string" || value.code.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "课程详情缺少课程编号" });
  }
});

const courseSearchItem = recordPayload.superRefine((value, context) => {
  if (!["number", "code", "id"].some((key) => value[key] !== undefined && value[key] !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "课程搜索结果缺少课程编号或 ID",
    });
  }
});

const courseSearchPayload = z.array(courseSearchItem);

const semesterItem = z.object({
  id: scalarId,
  nameZh: z.string(),
  code: z.string(),
  start: z.string(),
  end: z.string(),
  isLast: z.boolean().optional(),
}).passthrough();

const semesterPayload = z.array(semesterItem);

const departmentNode: z.ZodTypeAny = z.lazy(() => z.object({
  id: scalarId.optional(),
  code: z.string(),
  nameZh: z.string(),
  nameEn: z.string().nullable().optional(),
  children: z.array(departmentNode).optional(),
}).passthrough());

const departmentPayload = z.array(departmentNode);

const lessonItem = z.object({
  id: scalarId,
  code: z.string().min(1),
  course: recordPayload.optional(),
}).passthrough();
const lessonPayload = z.array(lessonItem);

const plannedExamItem = z.object({
  id: scalarId,
  examDate: z.string().optional(),
  lesson: recordPayload.optional(),
}).passthrough();
const generalExamItem = z.object({
  id: scalarId,
  courseCode: z.string().optional(),
  examDate: z.string().optional(),
}).passthrough();
const examPayload = z.array(z.union([plannedExamItem, generalExamItem]));

const substituteItem = z.object({
  id: scalarId.optional(),
  substituteCourses: z.array(recordPayload),
  originalCourses: z.array(recordPayload),
}).passthrough();

const substitutePayload = z.array(substituteItem);

const timetableGroup = z.object({
  lessons: recordsPayload,
  tmpLessons: recordsPayload,
  roomOccupies: recordsPayload,
  exams: recordsPayload,
  makeupExams: recordsPayload,
  tmpExams: recordsPayload,
}).strict();

const timetablePayload = z.object({
  timetable: timetableGroup,
}).passthrough();

const courseGroupValue = z.union([recordsPayload, z.record(recordsPayload)]);
const courseCollectionPayload = z.union([recordsPayload, z.record(courseGroupValue)]);

const schemaFor = (path: string): z.ZodTypeAny => {
  const endpoint = path.split("?", 1)[0];
  if (endpoint === "/api/restricted") return z.object({ restricted: z.boolean() }).passthrough();
  if (endpoint.startsWith("/api/teach/timetable-public-all/")) return timetablePayload;
  if (endpoint === "/api/teach/course/search") return courseSearchPayload;
  if (endpoint === "/api/teach/semester/list") return semesterPayload;
  if (endpoint === "/api/teach/department/college-tree") return departmentPayload;
  if (endpoint === "/api/teach/course/infos") return z.array(courseInfoItem);
  if (endpoint.startsWith("/api/teach/lesson/list-for-teach/") || endpoint === "/api/teach/lesson/infos") return lessonPayload;
  if (endpoint.startsWith("/api/teach/exam/list/") || endpoint.startsWith("/api/teach/general-exam/list/")) return examPayload;
  if (endpoint === "/api/teach/course-substitute-pool/list") return substitutePayload;
  if (
    endpoint.startsWith("/api/teach/course/public/") ||
    endpoint === "/api/teach/course/quality" ||
    endpoint.startsWith("/api/teach/course/department/")
  ) return courseCollectionPayload;
  return recordPayload;
};

export const validateApiPayload = <T>(path: string, value: unknown): T => {
  const result = schemaFor(path).safeParse(value);
  if (!result.success) {
    throw new CliError(
      "REMOTE_INVALID_DATA",
      `${path} 返回的数据结构不符合网页接口约定。`,
      result.error.issues.map((issue) => issue.message).join("；"),
    );
  }
  return result.data as T;
};
