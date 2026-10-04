import type {
  ClassroomUsage,
  Course,
  CourseDetail,
  Exam,
  Lesson,
  LessonDetail,
  ProgramCatalogEntry,
  ProgramDocument,
  ProgramSummary,
  SubstituteRelation,
} from "../domain/models.js";
import type { DisplayRow } from "./output.js";

export const courseRows = (items: Course[]): DisplayRow[] =>
  items.map((item) => ({
    课程编号: item.id,
    课程名: item.nameZh,
    英文名: item.nameEn ?? "",
    开课单位: item.department ?? "",
    有效: item.valid ? "是" : "否",
    最近开课: item.lastTerm ?? "",
  }));

export const courseDetailRows = (items: CourseDetail[]): DisplayRow[] =>
  items.map((item) => ({
    课程编号: item.id,
    课程名: item.nameZh,
    英文名: item.nameEn ?? "",
    开课单位: item.department ?? "",
    学分: item.credits ?? "",
    学时: item.hours ?? "",
    学期: item.semester ?? "",
    考核方式: item.examType ?? "",
    授课语言: item.language ?? "",
    预修要求: item.prerequisite ?? "",
    教材: item.textbooks.map((book) => book.name).join("；"),
    简介: item.descriptionZh ?? "",
  }));

export const programRows = (items: ProgramSummary[]): DisplayRow[] =>
  items.map((item) => ({
    计划ID: item.id,
    院系: `${item.departmentCode} ${item.departmentName}`,
    专业: `${item.majorCode} ${item.majorName}`,
    计划名称: item.name,
    年级: item.grade,
    培养类型: item.trainType,
  }));

export const programCatalogRows = (items: ProgramCatalogEntry[]): DisplayRow[] =>
  items.map((item) => ({
    编号: item.id,
    类型: item.type === "school" ? "院系" : item.type === "major" ? "专业" : item.type === "talent" ? "英才班" : item.type === "special" ? "学科交叉" : item.type === "dual" ? "双学位" : "说明",
    名称: item.nameZh,
    上级: item.parent.join("、"),
  }));

export const programDocumentRows = (document: ProgramDocument): DisplayRow[] =>
  document.sections.flatMap((section) => section.blocks.map((block) => ({
    章节: section.id,
    标题: section.title,
    层级: section.level,
    类型: block.type === "paragraph" ? "正文" : block.type === "table" ? "表格" : block.type === "image" ? "图片" : "课程",
    内容: block.type === "paragraph"
      ? block.text
      : block.type === "course"
        ? `${block.code} ${block.text}`
        : block.type === "image"
          ? block.alt ?? block.src
          : [...(block.table.footnotes ?? []), ...block.table.rows.map((row) => row.join(" | "))].join("；"),
    ...(block.type === "paragraph" && block.links?.length
      ? { 链接: block.links.map((link) => `${link.text} → ${link.href}`).join("；") }
      : {}),
  })));

export const lessonRows = (items: Lesson[]): DisplayRow[] =>
  items.map((item) => ({
    课堂号: item.code,
    课程名: item.courseName,
    开课单位: `${item.departmentCode ?? ""} ${item.departmentName ?? ""}`.trim(),
    授课教师: item.teachers.map((teacher) => teacher.nameZh).join("、"),
    时间地点: item.scheduleText,
    学分: item.credits ?? "",
    学时: item.hours ?? "",
    学历: item.education ?? "",
    课堂类型: item.classType ?? "",
    课程范畴分类: item.courseClassify ?? "",
    课程类型: item.courseType ?? "",
    本研同堂: item.graduateAndPostgraduate ? "是" : "否",
    选课人数: item.studentCount ?? "",
    限选人数: item.limitCount ?? "",
  }));

export const lessonExportRows = (items: Lesson[]): DisplayRow[] =>
  items.map((item) => ({
    课堂号: item.code,
    课程名: item.courseName,
    开课单位: `${item.departmentCode ?? ""} ${item.departmentName ?? ""}`.trim(),
    授课教师: item.teachers.map((teacher) => teacher.nameZh).join("、"),
    时间地点: item.spans.length > 0 ? item.spans.map((span) => span.text).join("\n") : item.scheduleText,
    学分: item.credits ?? "",
    学时: item.hours ?? "",
    学历: item.courseGradation === "本研贯通" ? "本研贯通" : item.education ?? "",
    课堂类型: item.classType ?? "",
    课程范畴分类: item.courseClassify ?? "",
    课程类型: item.courseType ?? "",
    授课语言: item.teachLanguage ?? "",
    考核方式: item.examMode ?? "",
    本研同堂: item.graduateAndPostgraduate ? "是" : "否",
    选课人数: item.studentCount ?? "",
    限选人数: item.limitCount ?? "",
    上课班级: item.classes.map((studentClass) => studentClass.nameZh).join("、"),
  }));

export const lessonDetailRows = (items: LessonDetail[]): DisplayRow[] =>
  items.map((item) => ({
    课堂号: item.lesson.code,
    课程编号: item.lesson.courseCode,
    课程名: item.lesson.courseName,
    开课单位: `${item.lesson.departmentCode ?? ""} ${item.lesson.departmentName ?? ""}`.trim(),
    授课教师: item.lesson.teachers.map((teacher) => teacher.nameZh).join("、"),
    上课班级: item.lesson.classes.map((studentClass) => studentClass.nameZh).join("、"),
    课堂类型: item.lesson.classType ?? "",
    课程范畴分类: item.lesson.courseClassify ?? "",
    课程类型: item.lesson.courseType ?? "",
    校区: item.lesson.campus ?? "",
    地点: item.lesson.locations.map((location) => location.text).join("；"),
    上课时间: item.lesson.spans.map((span) => span.text).join("；"),
    学分: item.course.credits ?? item.lesson.credits ?? "",
    学时: item.course.hours ?? item.lesson.hours ?? "",
    选课人数: item.lesson.studentCount ?? "",
    限选人数: item.lesson.limitCount ?? "",
    考核方式: item.lesson.examMode ?? item.course.examType ?? "",
    教学班字段: item.teachingClassDataAvailable ? "接口已提供" : "接口未提供",
  }));

export const classroomRows = (
  items: Array<{ classroomCode: string; building: string; usages: ClassroomUsage[]; date?: string; floor?: number; seats?: number; roomType?: string }>,
): DisplayRow[] =>
  items.map((item) => ({
    日期: item.date ?? item.usages[0]?.date ?? "",
    教室: item.classroomCode,
    楼栋: item.building,
    楼层: item.floor ?? "",
    座位: item.seats ?? "",
    房间类型: item.roomType ?? "",
    使用情况: item.usages
      .map((usage) => `${usage.start}-${usage.end} ${usage.courseName ?? usage.usageType}`)
      .join("；"),
    授课教师: item.usages.flatMap((usage) => usage.teachers).join("、"),
    使用类型: item.usages.map((usage) => usage.usageType).join("、"),
    申请人: item.usages.map((usage) => usage.applicant ?? "").filter(Boolean).join("、"),
  }));

export const examRows = (items: Exam[]): DisplayRow[] =>
  items.map((item) => ({
    课程号: item.courseCode,
    课程名: item.courseName,
    开课单位: `${item.departmentCode ?? ""} ${item.departmentName ?? ""}`.trim(),
    授课教师: item.teachers.join("、"),
    考试类型: item.type,
    日期: item.date,
    时间: `${item.startTime ?? ""}-${item.endTime ?? ""}`,
    地点: item.rooms.map((room) => `${room.room}${room.count == null ? "" : `(${room.count})`}`).join("、"),
    人数: item.students ?? "",
    上课班级: item.classes.join("、"),
    学历: item.education ?? "",
    年级: item.grades.join("、"),
    考核方式: item.examMode ?? "",
  }));

export const substituteRows = (items: SubstituteRelation[]): DisplayRow[] =>
  items.map((item) => ({
    替代课程: item.substituteCourses.map((course) => `${course.code} ${course.nameZh}`).join("；"),
    原课程: item.originalCourses.map((course) => `${course.code} ${course.nameZh}`).join("；"),
    关系: item.interchangeable ? "同级替代" : "高级替代",
    门数: item.multiple ? "多门" : "单门",
  }));
