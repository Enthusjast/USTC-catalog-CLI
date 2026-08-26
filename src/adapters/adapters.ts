/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  ClassroomUsage,
  Course,
  CourseDetail,
  CourseRef,
  DepartmentNode,
  Exam,
  ExamRoom,
  Lesson,
  LessonDetail,
  LessonLocation,
  LessonSpan,
  ProgramCourse,
  ProgramDetail,
  ProgramModule,
  ProgramSummary,
  Semester,
  SubstituteRelation,
  Textbook,
  TimetableData,
  ExamRange,
} from "../domain/models.js";

type AnyRecord = Record<string, any>;

const record = (value: unknown): AnyRecord =>
  value && typeof value === "object" ? (value as AnyRecord) : {};

const stringValue = (value: unknown, fallback = ""): string =>
  value === undefined || value === null ? fallback : String(value);

const numberValue = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
};

const arrayValue = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const stripHtml = (value: unknown): string =>
  stringValue(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rsquo;/gi, "’")
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .trim();

const bilingualName = (value: AnyRecord): { zh: string; en: string } => ({
  zh: stringValue(value.name ?? value.nameZh ?? value.cn),
  en: stringValue(value.ename ?? value.nameEn ?? value.en).replace(/^1$/, ""),
});

const localized = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") {
    const raw = record(value);
    return raw.cn ?? raw.nameZh ?? raw.en ?? raw.nameEn ?? null;
  }
  return String(value);
};

export const normalizeCourse = (input: unknown): Course => {
  const raw = record(input);
  const name = bilingualName(raw);
  return {
    id: stringValue(raw.number ?? raw.code),
    nameZh: name.zh,
    nameEn: name.en || undefined,
    valid: raw.valid !== false,
    lastTerm: raw.lastTerm ?? null,
    department: raw.dept ?? raw.department ?? null,
    category: raw.category ?? raw.courseCategory ?? null,
    classification: raw.classify ?? raw.courseClassify ?? null,
    gradation: raw.gradation ?? null,
  };
};

const normalizeTextbook = (input: unknown): Textbook => {
  const raw = record(input);
  return {
    name: stringValue(raw.nameZh ?? raw.name ?? raw.title),
    nameEn: raw.nameEn ?? null,
    author: raw.author ?? null,
    publisher: raw.publishingHouse ?? raw.publisher ?? null,
    edition: raw.edition ?? null,
    date: raw.dates ?? raw.date ?? null,
    isbn: raw.isbn ?? null,
    type: raw.type ?? null,
  };
};

const normalizeSyllabus = (raw: AnyRecord): CourseDetail["syllabus"] => {
  const syllabus = record(raw.syllabus);
  if (Array.isArray(raw.syllabus)) {
    return raw.syllabus
      .map((item, index) => ({
        title: stringValue(record(item).title),
        content: stripHtml(record(item).content),
        index: numberValue(record(item).indexNo) ?? index,
      }))
      .filter((item) => !["none", "nothing", "无"].includes(item.content.toLowerCase()));
  }
  const documents = syllabus.documents;
  if (typeof documents !== "string") return [];
  try {
    const parsed = record(JSON.parse(documents));
    const paragraphs = arrayValue(record(parsed["language-zh"]).paragraphs);
    return paragraphs
      .map((item, index) => ({
        title: stringValue(record(item).title),
        content: stripHtml(record(item).content),
        index: numberValue(record(item).indexNo) ?? index,
      }))
      .filter((item) => !["none", "nothing", "无", "<p>none</p>"].includes(item.content.toLowerCase()))
      .sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
};

export const normalizeCourseDetail = (input: unknown): CourseDetail => {
  const raw = record(input);
  const base = normalizeCourse({
    number: raw.code,
    name: record(raw.name).cn ?? raw.name,
    ename: record(raw.name).en,
    valid: raw.valid,
    lastTerm: raw.lastTerm,
    dept: raw.dept,
    category: raw.courseCategory,
    classify: raw.courseClassify,
  });
  const legacyTextbook = raw.textbook ? [normalizeTextbook({ nameZh: raw.textbook })] : [];
  const allBooks = arrayValue(raw.textbooks).map(normalizeTextbook);
  const published = allBooks.filter((item) => item.type !== "讲义");
  const materials = [
    ...allBooks.filter((item) => item.type === "讲义"),
    ...arrayValue(raw.materials).map(normalizeTextbook),
  ];
  return {
    ...base,
    numericId: numberValue(raw.id),
    courseId: numberValue(raw.courseId),
    credits: numberValue(raw.credit),
    hours: numberValue(raw.hour),
    semester: raw.sem ?? null,
    grading: raw.grading ?? null,
    examType: raw.examType ?? null,
    language: raw.lang ?? null,
    discipline: raw.discipline ?? null,
    prerequisite: raw.preq ?? null,
    descriptionZh: stripHtml(record(raw.desc).cn ?? raw.desc),
    descriptionEn: stripHtml(record(raw.desc).en),
    textbooks: published.length > 0 ? published : legacyTextbook,
    materials,
    references: raw.ref ?? null,
    syllabus: normalizeSyllabus(raw),
  };
};

export type CourseGroup = {
  name: string;
  courses: Course[];
};

const displayCourseGroupName: Record<string, string> = {
  学科群: "学科群基础课程",
  专业核心: "专业核心课程",
  专业方向: "专业方向课程",
};

const groupEntries = (value: unknown): Array<[string, unknown[]]> =>
  Object.entries(record(value)).map(([key, items]) => [key, arrayValue(items)]);

export const normalizeCourseGroups = (input: unknown): CourseGroup[] => {
  const groups: CourseGroup[] = [];
  for (const [name, values] of groupEntries(input)) {
    if (name === "体育选项" && !Array.isArray(values)) continue;
    const nested = record(record(input)[name]);
    if (name === "体育选项" && Object.keys(nested).length > 0) {
      for (const [subName, subValues] of groupEntries(nested)) {
        groups.push({
          name: `体育选项 - ${subName}`,
          courses: subValues.map(normalizeCourse).sort(courseSort),
        });
      }
      continue;
    }
    groups.push({
      name: displayCourseGroupName[name] ?? (name || "其他单位"),
      courses: values.map(normalizeCourse).sort(courseSort),
    });
  }
  return groups;
};

export const mergeCourseGroups = (groups: CourseGroup[]): CourseGroup[] => {
  const merged = new Map<string, Course[]>();
  for (const group of groups) {
    merged.set(group.name, [...(merged.get(group.name) ?? []), ...group.courses]);
  }
  return [...merged.entries()]
    .map(([name, courses]) => ({ name, courses: courses.sort(courseSort) }))
    ;
};

export const courseSort = (a: Course, b: Course): number =>
  a.id.localeCompare(b.id, "zh-CN", { numeric: true });

export const normalizeDepartmentTree = (input: unknown): DepartmentNode[] => {
  const visit = (value: unknown): DepartmentNode => {
    const raw = record(value);
    return {
      id: numberValue(raw.id),
      code: stringValue(raw.code),
      nameZh: stringValue(raw.nameZh ?? raw.name),
      nameEn: raw.nameEn ?? undefined,
      children: arrayValue(raw.children).map(visit),
    };
  };
  return arrayValue(input).map(visit).sort((a, b) => a.code.localeCompare(b.code));
};

const trainType = (value: unknown): string => stringValue(value, "未知");

export const normalizeProgramTree = (input: unknown): ProgramSummary[] => {
  const result: ProgramSummary[] = [];
  for (const department of Object.values(record(input))) {
    const d = record(department);
    for (const major of Object.values(record(d.majors))) {
      const m = record(major);
      for (const program of arrayValue(m.programs)) {
        const p = record(program);
        result.push({
          id: numberValue(p.id) ?? 0,
          departmentId: numberValue(d.id) ?? 0,
          departmentCode: stringValue(d.code),
          departmentName: stringValue(d.nameZh),
          majorId: numberValue(m.id) ?? 0,
          majorCode: stringValue(m.code),
          majorName: stringValue(m.nameZh),
          name: stringValue(p.nameZh ?? p.name),
          grade: stringValue(p.grade),
          trainType: trainType(p.trainType),
        });
      }
    }
  }
  return result.sort(
    (a, b) =>
      a.departmentCode.localeCompare(b.departmentCode) ||
      a.majorCode.localeCompare(b.majorCode) ||
      b.grade.localeCompare(a.grade),
  );
};

const normalizeProgramCourse = (value: unknown): ProgramCourse => {
  const raw = record(value);
  const course = record(raw.course);
  return {
    code: stringValue(course.code ?? raw.code),
    name: stringValue(course.nameZh ?? course.name ?? raw.name),
    compulsory: raw.compulsory === true,
    hours: numberValue(raw.totalPeriods ?? course.totalPeriods),
    credits: numberValue(raw.credits ?? course.credits),
    terms: arrayValue(raw.terms).map(String),
  };
};

export const normalizeProgramModule = (input: unknown): ProgramModule => {
  const raw = record(input);
  const self = record(raw.self);
  return {
    id: numberValue(self.id) ?? 0,
    parentId: numberValue(self.parent),
    type: stringValue(self.type),
    typeEn: self.typeEn ?? undefined,
    major: self.major ?? undefined,
    majorDirection: self.majorDirection ?? undefined,
    remark: self.remark ?? null,
    requiredCredits: numberValue(self.requiredCredits),
    requiredCourseNum: numberValue(self.requiredCourseNum),
    isLeaf: raw.isLeaf === true,
    publicModuleId: numberValue(self.public),
    courses: arrayValue(self.courses).map(normalizeProgramCourse),
    children: arrayValue(raw.children).map(normalizeProgramModule),
  };
};

export const normalizeProgramDetail = (
  input: unknown,
  summary: ProgramSummary,
): ProgramDetail => {
  const raw = record(input);
  return {
    ...summary,
    beginSemester: raw.beginSemester ?? undefined,
    requiredCredits: numberValue(raw.requiredCredits),
    awardDegree: raw.awardDegree,
    modules: arrayValue(raw.moduleTree).map(normalizeProgramModule),
  };
};

const person = (value: unknown): { nameZh: string; nameEn?: string; departmentCode?: string } => {
  const raw = record(value);
  return {
    nameZh: stringValue(raw.cn ?? raw.nameZh ?? raw.name),
    nameEn: raw.en ?? raw.nameEn,
    departmentCode: raw.departmentCode,
  };
};

const uniquePeople = <T extends { nameZh: string }>(people: T[]): T[] =>
  people.filter((personValue, index) => people.findIndex((candidate) => candidate.nameZh === personValue.nameZh) === index);

const scheduleSpans = (value: unknown): LessonSpan[] => {
  const text = stringValue(value);
  const spans: LessonSpan[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(.*?)周\s+[^:]*:\s*([1-7])\(([^)]+)\)/);
    if (!match) continue;
    spans.push({
      text: line.trim(),
      weeks: match[1],
      day: Number(match[2]),
      periods: match[3]
        .split(",")
        .map((item) => Number(item))
        .filter(Number.isFinite),
    });
  }
  return spans;
};

const locations = (value: unknown): LessonLocation[] => {
  const text = stringValue(value);
  const values = text
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ text: item.split(":")[0] }));
  return values.filter((item, index) => values.findIndex((candidate) => candidate.text === item.text) === index);
};

export const normalizeLesson = (input: unknown): Lesson => {
  const raw = record(input);
  const course = record(raw.course);
  const name = record(raw.name);
  const department = record(raw.openDepartment);
  const scheduleText = stringValue(raw.dateTimePlaceText).replace(/;/g, "\n");
  return {
    id: numberValue(raw.id) ?? 0,
    code: stringValue(raw.code),
    courseId: numberValue(course.id ?? raw.courseId),
    courseCode: stringValue(course.code ?? raw.courseCode ?? raw.code),
    courseName: stringValue(course.cn ?? course.nameZh ?? name.cn ?? raw.courseName),
    courseNameEn: course.en ?? course.nameEn ?? name.en,
    credits: numberValue(raw.credits ?? course.credits),
    hours: numberValue(raw.period ?? raw.totalPeriods),
    education: localized(raw.education),
    courseType: localized(raw.courseType),
    courseGradation: localized(raw.courseGradation),
    courseCategory: localized(raw.courseCategory),
    courseClassify: localized(raw.courseClassify),
    departmentCode: stringValue(department.code ?? raw.departmentCode),
    departmentName: stringValue(department.cn ?? department.nameZh ?? raw.dept),
    teachers: uniquePeople(arrayValue(raw.teacherAssignmentList).map(person)),
    classes: uniquePeople(arrayValue(raw.adminClasses).map(person)),
    campus: localized(raw.campus),
    locations: locations(raw.dateTimePlaceText),
    spans: scheduleSpans(record(raw.dateTimePlacePersonText).cn ?? raw.dateTimePlaceText),
    scheduleText,
    examMode: localized(raw.examMode),
    studentCount: numberValue(raw.stdCount),
    limitCount: numberValue(raw.limitCount),
    teachLanguage: localized(raw.teachLang),
    graduateAndPostgraduate: raw.graduateAndPostgraduate === true,
  };
};

export const normalizeLessonDetail = (input: unknown): LessonDetail => {
  const raw = record(input);
  const course = normalizeCourseDetail(input);
  const base = normalizeLesson(input);
  return {
    course,
    lesson: {
      ...base,
      courseName: base.courseName || course.nameZh,
      courseNameEn: base.courseNameEn ?? course.nameEn,
      courseCode: base.courseCode || course.id,
      credits: base.credits ?? course.credits,
      hours: base.hours ?? course.hours,
      departmentName: base.departmentName ?? course.department,
      courseCategory: base.courseCategory ?? course.category,
      examMode: base.examMode ?? course.examType,
      teachLanguage: base.teachLanguage ?? course.language,
    },
    teachingClassDataAvailable: ["teacherAssignmentList", "adminClasses", "dateTimePlaceText", "dateTimePlacePersonText"]
      .some((key) => key in raw),
  };
};

const tokens = (value: string | undefined): string[] =>
  stringValue(value).trim().toLowerCase().split(/\s+/).filter(Boolean);

const includesAll = (haystack: string, terms: string[]): boolean =>
  terms.every((term) => haystack.includes(term));

export type LessonFilters = {
  department?: string;
  education?: string;
  course?: string;
  teacher?: string;
  location?: string;
  span?: string;
  courseType?: string;
  courseClassify?: string;
};

export const filterLessons = (lessons: Lesson[], filters: LessonFilters): Lesson[] => {
  let result = lessons;
  if (filters.education) {
    if (filters.education === "本研贯通") {
      result = result.filter((item) => item.courseGradation === "本研贯通");
    } else if (filters.education === "研究生") {
      result = result.filter(
        (item) => item.education === "研究生" && item.courseGradation !== "本研贯通",
      );
    } else {
      result = result.filter((item) => item.education === filters.education);
    }
  }
  if (filters.courseType) result = result.filter((item) => item.courseType === filters.courseType);
  if (filters.courseClassify) {
    result = result.filter((item) => item.courseClassify === filters.courseClassify);
  }
  if (filters.department) {
    result = result.filter((item) => item.departmentCode === filters.department);
  }
  const teacherTerms = tokens(filters.teacher);
  if (teacherTerms.length) {
    result = result.filter((item) =>
      includesAll(
        item.teachers.map((teacher) => `${teacher.nameZh} ${teacher.nameEn ?? ""}`).join("").toLowerCase(),
        teacherTerms,
      ),
    );
  }
  const courseTerms = tokens(filters.course);
  if (courseTerms.length) {
    result = result.filter((item) =>
      includesAll(`${item.courseName} ${item.courseNameEn ?? ""} ${item.code}`.toLowerCase(), courseTerms),
    );
  }
  const locationTerms = tokens(filters.location);
  if (locationTerms.length) {
    result = result.filter((item) =>
      includesAll(
        `${item.locations.map((location) => location.text).join(" ")} ${item.campus ?? ""}`.toLowerCase(),
        locationTerms,
      ),
    );
  }
  if (filters.span) result = result.filter((item) => item.spans.some((span) => span.text === filters.span));
  return result;
};

export type LessonSortKey = "course" | "department" | "teacher" | "location" | "students";

const compareNullable = (left: unknown, right: unknown): number =>
  String(left ?? "").localeCompare(String(right ?? ""), "zh-CN", { numeric: true });

export const sortLessons = (
  lessons: Lesson[],
  key: LessonSortKey = "course",
  descending = false,
): Lesson[] => {
  const result = [...lessons].sort((left, right) => {
    const leftValue = key === "course" ? left.courseName :
      key === "department" ? left.departmentName :
        key === "teacher" ? left.teachers[0]?.nameZh :
          key === "location" ? left.locations[0]?.text : left.studentCount;
    const rightValue = key === "course" ? right.courseName :
      key === "department" ? right.departmentName :
        key === "teacher" ? right.teachers[0]?.nameZh :
          key === "location" ? right.locations[0]?.text : right.studentCount;
    const comparison = compareNullable(leftValue, rightValue);
    return comparison || compareNullable(left.code, right.code);
  });
  return descending ? result.reverse() : result;
};

export const normalizeSemester = (input: unknown): Semester => {
  const raw = record(input);
  return {
    id: numberValue(raw.id) ?? 0,
    nameZh: stringValue(raw.nameZh),
    code: stringValue(raw.code),
    start: stringValue(raw.start),
    end: stringValue(raw.end),
    isLast: raw.isLast === true,
  };
};

const formatTime = (value: unknown): string | undefined => {
  const numeric = numberValue(value);
  if (numeric === undefined) return undefined;
  return `${Math.floor(numeric / 100).toString().padStart(2, "0")}:${(numeric % 100)
    .toString()
    .padStart(2, "0")}`;
};

const examTypeName = (value: unknown): string => {
  if (value === 1) return "期中考试";
  if (value === 2) return "期末考试";
  if (value === 3) return "通用考试";
  return stringValue(value, "考试");
};

const normalizeRooms = (value: unknown): ExamRoom[] =>
  arrayValue(value).map((item) => {
    const raw = record(item);
    return { room: stringValue(raw.room), count: numberValue(raw.count) };
  });

export const normalizeExams = (planned: unknown[], general: unknown[]): Exam[] => {
  const plannedItems = planned.map((input): Exam => {
    const raw = record(input);
    const lesson = record(raw.lesson);
    const course = record(lesson.course);
    const department = record(lesson.openDepartment);
    return {
      id: numberValue(raw.id) ?? 0,
      type: examTypeName(raw.examType),
      courseCode: stringValue(lesson.code),
      courseName: stringValue(course.cn ?? course.nameZh),
      departmentCode: department.code,
      departmentName: department.cn ?? department.nameZh,
      date: stringValue(raw.examDate).slice(0, 10),
      startTime: formatTime(raw.startTime),
      endTime: formatTime(raw.endTime),
      rooms: normalizeRooms(raw.examRooms),
      teachers: arrayValue(lesson.teacherAssignmentList).map((item) =>
        stringValue(record(item).cn ?? record(item).nameZh ?? record(item).en),
      ),
      students: numberValue(raw.examTakeCount),
      classes: stringValue(raw.adminclasseNames)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      grades: stringValue(raw.grades)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      education: record(lesson.education).cn ?? lesson.education,
      courseCredits: numberValue(course.credits),
      courseType: record(lesson.courseType).cn ?? lesson.courseType,
      examMode: raw.examMode,
    };
  });
  const generalItems = general.map((input): Exam => {
    const raw = record(input);
    const education = record(raw.education);
    return {
      id: numberValue(raw.id) ?? 0,
      type: "通用考试",
      courseCode: stringValue(raw.courseCode),
      courseName: stringValue(raw.courseName),
      departmentName: stringValue(raw.dept),
      date: stringValue(raw.examDate).slice(0, 10),
      startTime: formatTime(raw.startTime),
      endTime: formatTime(raw.endTime),
      rooms: [{ room: stringValue(raw.room), count: undefined }],
      teachers: arrayValue(raw.persons).map((item) =>
        stringValue(record(item).nameZh ?? record(item).cn ?? record(item).name),
      ),
      students: undefined,
      classes: [],
      grades: [],
      education: education.cn ?? raw.education,
      courseType: "",
      examMode: "",
    };
  });
  return [...plannedItems, ...generalItems].sort(
    (a, b) => `${a.date} ${a.startTime ?? ""}`.localeCompare(`${b.date} ${b.startTime ?? ""}`),
  );
};

export type ExamFilters = {
  type?: string;
  education?: string;
  department?: string;
  grade?: string;
  building?: string;
  date?: string;
  course?: string;
  teacher?: string;
  location?: string;
  className?: string;
  span?: ExamRange;
};

export const filterExams = (exams: Exam[], filters: ExamFilters): Exam[] => {
  let result = exams;
  if (filters.type) result = result.filter((item) => item.type === filters.type);
  if (filters.education) result = result.filter((item) => item.education === filters.education);
  if (filters.department) result = result.filter((item) => item.departmentCode === filters.department);
  if (filters.grade) result = result.filter((item) => item.grades.includes(filters.grade!));
  if (filters.building) {
    result = result.filter((item) => item.rooms.some((room) => room.room.startsWith(filters.building!)));
  }
  if (filters.date) result = result.filter((item) => item.date === filters.date);
  const courseTerms = tokens(filters.course);
  if (courseTerms.length) {
    result = result.filter((item) =>
      includesAll(`${item.courseName} ${item.courseCode}`.toLowerCase(), courseTerms),
    );
  }
  const teacherTerms = tokens(filters.teacher);
  if (teacherTerms.length) {
    result = result.filter((item) => includesAll(item.teachers.join(" ").toLowerCase(), teacherTerms));
  }
  const locationTerms = tokens(filters.location);
  if (locationTerms.length) {
    result = result.filter((item) =>
      includesAll(item.rooms.map((room) => room.room).join(" ").toLowerCase(), locationTerms),
    );
  }
  if (filters.className) {
    const classTerms = tokens(filters.className);
    result = result.filter((item) => includesAll(item.classes.join(" ").toLowerCase(), classTerms));
  }
  if (filters.span) {
    result = result.filter((item) => {
      const hour = Number((item.startTime ?? "00:00").slice(0, 2));
      if (filters.span === "morning") return hour < 12;
      if (filters.span === "afternoon") return hour >= 12 && hour < 18;
      return hour >= 18;
    });
  }
  return result;
};

export type ExamSortKey = "course" | "department" | "teacher" | "location" | "date" | "time" | "class";

export const sortExams = (
  exams: Exam[],
  key: ExamSortKey = "date",
  descending = false,
): Exam[] => {
  const result = [...exams].sort((left, right) => {
    const value = (item: Exam): string => {
      if (key === "course") return `${item.courseName} ${item.courseCode}`;
      if (key === "department") return item.departmentName ?? "";
      if (key === "teacher") return item.teachers.join(" ");
      if (key === "location") return item.rooms.map((room) => room.room).join(" ");
      if (key === "time") return `${item.startTime ?? ""} ${item.endTime ?? ""}`;
      if (key === "class") return item.classes.join(" ");
      return `${item.date} ${item.startTime ?? ""}`;
    };
    return compareNullable(value(left), value(right)) || compareNullable(left.id, right.id);
  });
  return descending ? result.reverse() : result;
};

const courseRef = (value: unknown): CourseRef => {
  const raw = record(value);
  return {
    id: numberValue(raw.id) ?? 0,
    code: stringValue(raw.code),
    nameZh: stringValue(raw.cn ?? raw.nameZh),
    nameEn: raw.en ?? raw.nameEn,
    hours: numberValue(raw.period),
    credits: numberValue(raw.credits),
  };
};

export const normalizeSubstitutes = (input: unknown[]): SubstituteRelation[] => {
  const normalized = input.map((value) => {
    const raw = record(value);
    const substituteCourses = arrayValue(raw.substituteCourses).map(courseRef).sort((a, b) => a.code.localeCompare(b.code));
    const originalCourses = arrayValue(raw.originalCourses).map(courseRef).sort((a, b) => a.code.localeCompare(b.code));
    return {
      id: numberValue(raw.id) ?? 0,
      substituteCourses,
      originalCourses,
      interchangeable: false,
      multiple: substituteCourses.length > 1 || originalCourses.length > 1,
      searchText: [...substituteCourses, ...originalCourses]
        .map((item) => `${item.code} ${item.nameZh} ${item.nameEn ?? ""}`)
        .join(" ")
        .toLowerCase(),
    } satisfies SubstituteRelation;
  });
  const result: SubstituteRelation[] = [];
  for (const relation of normalized) {
    const reverse = result.find(
      (item) =>
        item.substituteCourses.map((course) => course.code).join(" ") ===
          relation.originalCourses.map((course) => course.code).join(" ") &&
        item.originalCourses.map((course) => course.code).join(" ") ===
          relation.substituteCourses.map((course) => course.code).join(" "),
    );
    if (reverse) reverse.interchangeable = true;
    else result.push(relation);
  }
  return result.sort((a, b) =>
    a.substituteCourses[0]?.code.localeCompare(b.substituteCourses[0]?.code ?? "") ?? 0,
  );
};

export const filterSubstitutes = (
  relations: SubstituteRelation[],
  course?: string,
  mode?: "interchangeable" | "straight",
  multiple?: boolean,
): SubstituteRelation[] => {
  let result = relations;
  const terms = tokens(course);
  if (terms.length) result = result.filter((item) => includesAll(item.searchText, terms));
  if (mode === "interchangeable") result = result.filter((item) => item.interchangeable);
  if (mode === "straight") result = result.filter((item) => !item.interchangeable);
  if (multiple !== undefined) result = result.filter((item) => item.multiple === multiple);
  return result;
};

const usageType = (key: string): ClassroomUsage["usageType"] => {
  if (key === "tmpLessons") return "temporary";
  if (key === "exams" || key === "makeupExams" || key === "tmpExams") return "exam";
  if (key === "roomOccupies") return "occupancy";
  return "lesson";
};

const timeText = (value: unknown): string => {
  const text = stringValue(value);
  return text === ":0" ? "00:00" : text;
};

const personName = (value: unknown): string => {
  if (typeof value === "string") return value;
  const raw = record(value);
  return stringValue(raw.name ?? raw.nameZh ?? raw.cn ?? raw.nameEn ?? raw.en);
};

const splitText = (value: unknown): string[] =>
  stringValue(value)
    .split(/[;,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);

const classroomChannelLabelsByLayout: Record<number, string[]> = {
  1: ["1", "2", "3", "4", "5", "中午", "6", "7", "8", "9", "10", "傍晚", "11", "12", "13"],
  2: ["1", "2", "3", "4", "中午", "6", "7", "8", "9", "10", "傍晚", "11", "12", "13"],
};

const classroomPeriods: Record<number, Array<[number, number]>> = {
  1: [[750, 835], [840, 925], [945, 1030], [1035, 1120], [1125, 1210], [1220, 1340], [1400, 1445], [1450, 1535], [1555, 1640], [1645, 1730], [1735, 1820], [1830, 1920], [1930, 2015], [2020, 2105], [2110, 2155]],
  2: [[800, 845], [850, 935], [1010, 1055], [1100, 1145], [1155, 1350], [1400, 1445], [1450, 1535], [1610, 1655], [1700, 1745], [1750, 1835], [1845, 1920], [1930, 2015], [2020, 2105], [2110, 2155]],
};

const hhmm = (value: number): string => `${Math.floor(value / 100).toString().padStart(2, "0")}:${(value % 100).toString().padStart(2, "0")}`;

export const normalizeTimetable = (input: unknown, date: string): ClassroomUsage[] => {
  const timetable = record(record(input).timetable);
  const result: ClassroomUsage[] = [];
  for (const [key, values] of Object.entries(timetable)) {
    for (const value of arrayValue(values)) {
      const raw = record(value);
      const start = timeText(raw.start);
      const end = timeText(raw.end);
      const code = stringValue(raw.classroomName);
      const lessonItems = arrayValue(raw.lessons).map(record);
      const lessonCodes = lessonItems.map((item) => stringValue(item.code)).filter(Boolean);
      const isMakeupExam = key === "makeupExams";
      const courseId = isMakeupExam
        ? stringValue(raw.code)
        : stringValue(raw.courseId ?? raw.courseCode) || lessonCodes.join(", ");
      const courseNames = lessonItems.map((item) => stringValue(item.nameZh ?? item.courseName)).filter(Boolean);
      const teacherValues = arrayValue(raw.teachers).map(personName).filter(Boolean);
      const lessonTeachers = lessonItems.flatMap((item) => arrayValue(item.teachers).map(personName));
      const makeupTeachers = arrayValue(raw.persons).map(personName).filter(Boolean);
      const usageTypeValue = usageType(key);
      const classes = Array.isArray(raw.adminClasses)
        ? raw.adminClasses.map(personName).filter(Boolean)
        : splitText(raw.adminclasseNames ?? raw.classes);
      result.push({
        classroomCode: code,
        date,
        usageType: usageTypeValue,
        courseIds: courseId ? courseId.split(",").map((item) => item.trim()) : [],
        courseName: isMakeupExam ? stringValue(raw.nameZh) : raw.courseName ?? raw.nameZh ?? courseNames.join(","),
        teachers: isMakeupExam ? [...new Set(makeupTeachers)] : [...new Set([...teacherValues, ...lessonTeachers])],
        applicant: raw.applierName,
        sponsor: raw.sponsorName,
        departmentName: stringValue(raw.departmentName ?? raw.openDepartment?.cn, "") || undefined,
        classes,
        studentCount: numberValue(raw.studentCount ?? raw.stdCount),
        courseType: isMakeupExam ? "4" : stringValue(raw.courseType, "") || undefined,
        start,
        end,
        channels: [],
        channelText: [],
        layout: numberValue(raw.layout),
        allDay: start === "00:00" && end === "23:59",
        occupied: true,
        seal: raw.courseName === "封楼" || usageTypeValue === "occupancy",
      });
    }
  }
  return result.sort((a, b) =>
    a.classroomCode.localeCompare(b.classroomCode) || a.start.localeCompare(b.start),
  );
};

const overlap = (left: number[], right: number[]): boolean =>
  left.some((item) => right.includes(item));

const sameCourse = (left: ClassroomUsage, right: ClassroomUsage): boolean =>
  left.courseIds.length > 0 && right.courseIds.length > 0 &&
  left.courseIds.some((id) => right.courseIds.includes(id));

const mergeUsage = (target: ClassroomUsage, source: ClassroomUsage): void => {
  target.channels = [...new Set([...target.channels, ...source.channels])].sort((a, b) => a - b);
  const labels = classroomChannelLabelsByLayout[target.layout ?? 1] ?? classroomChannelLabelsByLayout[1];
  target.channelText = target.channels.map((channel) => labels[channel - 1] ?? String(channel));
  target.courseIds = [...new Set([...target.courseIds, ...source.courseIds])];
  target.teachers = [...new Set([...target.teachers, ...source.teachers])];
  target.classes = [...new Set([...target.classes, ...source.classes])];
  if (source.start < target.start) target.start = source.start;
  if (source.end > target.end) target.end = source.end;
  if (source.courseName && target.courseName && !target.courseName.includes(source.courseName)) {
    target.courseName = `${target.courseName}，${source.courseName}`;
  }
  target.usageType = source.usageType === "exam" ? "exam" : target.usageType;
}

export const mergeClassroomUsages = (usages: ClassroomUsage[]): ClassroomUsage[] => {
  const grouped = new Map<string, ClassroomUsage[]>();
  for (const usage of usages) {
    const current = grouped.get(usage.classroomCode) ?? [];
    const match = current.find((item) =>
      item.courseName === usage.courseName &&
      (sameCourse(item, usage) ||
        (item.usageType === "temporary" && usage.usageType === "temporary" && item.applicant === usage.applicant) ||
        overlap(item.channels, usage.channels)),
    );
    if (match) mergeUsage(match, usage);
    else if (
      usage.usageType === "exam" &&
      usage.courseType === "4"
    ) {
      const examMatch = current.find(
        (item) => item.usageType === "exam" && item.courseType === "4" && item.start === usage.start && item.end === usage.end,
      );
      if (examMatch) mergeUsage(examMatch, usage);
      else current.push(usage);
    } else current.push(usage);
    grouped.set(usage.classroomCode, current);
  }
  const split = [...grouped.values()].flat().flatMap((usage) => {
    const channels = [...usage.channels].sort((a, b) => a - b);
    const chunks: number[][] = [];
    for (const channel of channels) {
      const last = chunks.at(-1);
      if (!last || channel !== last[last.length - 1] + 1) chunks.push([channel]);
      else last.push(channel);
    }
    if (chunks.length <= 1) return [usage];
    const periods = classroomPeriods[usage.layout ?? 1] ?? classroomPeriods[1];
    return chunks.map((chunk) => ({
      ...usage,
      channels: chunk,
      channelText: chunk.map((channel) => {
        const labels = classroomChannelLabelsByLayout[usage.layout ?? 1] ?? classroomChannelLabelsByLayout[1];
        return labels[channel - 1] ?? String(channel);
      }),
      start: hhmm(periods[chunk[0] - 1]?.[0] ?? 0),
      end: hhmm(periods[chunk[chunk.length - 1] - 1]?.[1] ?? 0),
    }));
  });
  return split.sort(
    (a, b) => a.classroomCode.localeCompare(b.classroomCode) || a.start.localeCompare(b.start),
  );
};

export const normalizeTimetableData = (input: unknown): TimetableData => {
  const value = record(record(input).timetable);
  return {
    lessons: arrayValue(value.lessons).map(record),
    tmpLessons: arrayValue(value.tmpLessons).map(record),
    roomOccupies: arrayValue(value.roomOccupies).map(record),
    exams: arrayValue(value.exams).map(record),
    makeupExams: arrayValue(value.makeupExams).map(record),
    tmpExams: arrayValue(value.tmpExams).map(record),
  };
};
