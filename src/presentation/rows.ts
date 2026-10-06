import type {
  ClassroomUsage,
  Course,
  CourseDetail,
  Exam,
  ExamConflict,
  ExamFilterOption,
  ExamScheduleDay,
  Lesson,
  LessonDetail,
  ProgramComparison,
  ProgramCatalogEntry,
  ProgramDocument,
  ProgramHistoryEntry,
  ProgramSummary,
  SubstituteRelation,
} from "../domain/models.js";
import type { DisplayRow } from "./output.js";
import { expandProgramDocumentTable } from "../adapters/program-document.js";

const classroomUsageTypeLabel = (usage: ClassroomUsage): string => usage.rawType ?? ({
  lesson: "课程",
  temporary: "临时借用",
  exam: "考试",
  occupancy: "占用",
})[usage.usageType];

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

export const programHistoryRows = (items: ProgramHistoryEntry[]): DisplayRow[] =>
  items.map((item) => ({
    条目ID: item.id,
    版本: item.version ?? "",
    分类: item.section,
    名称: item.title,
    类型: item.downloadable ? "PDF/附件" : "网页",
    下载可用: item.downloadable ? "是" : "否",
    链接: item.href,
  }));

export const programComparisonRows = (comparison: ProgramComparison): DisplayRow[] => [
  {
    类型: "方案摘要",
    变化: `${comparison.before.grade} ${comparison.before.name} → ${comparison.after.grade} ${comparison.after.name}`,
    旧总学分: comparison.before.requiredCredits ?? "",
    新总学分: comparison.after.requiredCredits ?? "",
    新增课程: comparison.summary.addedCourses,
    删除课程: comparison.summary.removedCourses,
    模块迁移: comparison.summary.movedCourses,
    课程变化: comparison.summary.changedCourses,
    模块要求变化: comparison.summary.changedModules,
  },
  ...comparison.modules.map((item) => ({
    类型: "模块",
    变化: item.change === "added" ? "新增" : item.change === "removed" ? "删除" : "要求变化",
    模块路径: item.path,
    变化字段: item.changedFields.join("、"),
    旧要求学分: item.before?.requiredCredits ?? "",
    新要求学分: item.after?.requiredCredits ?? "",
    旧要求门数: item.before?.requiredCourseNum ?? "",
    新要求门数: item.after?.requiredCourseNum ?? "",
  })),
  ...comparison.courses.map((item) => ({
    类型: "课程",
    变化: item.change === "added" ? "新增" : item.change === "removed" ? "删除" : item.change === "moved" ? "模块迁移" : "课程信息变化",
    课程编号: item.code,
    课程名: item.name,
    原模块: item.before?.modulePath ?? "",
    新模块: item.after?.modulePath ?? "",
    变化字段: item.changedFields.join("、"),
    旧必修: item.before ? (item.before.compulsory ? "是" : "否") : "",
    新必修: item.after ? (item.after.compulsory ? "是" : "否") : "",
    旧学分: item.before?.credits ?? "",
    新学分: item.after?.credits ?? "",
    旧学时: item.before?.hours ?? "",
    新学时: item.after?.hours ?? "",
    旧学期: item.before?.terms.join("、") ?? "",
    新学期: item.after?.terms.join("、") ?? "",
  })),
];

export const programCatalogRows = (items: ProgramCatalogEntry[]): DisplayRow[] =>
  items.map((item) => ({
    编号: item.id,
    类型: item.type === "school" ? "院系" : item.type === "major" ? "专业" : item.type === "talent" ? "英才班" : item.type === "special" ? "学科交叉" : item.type === "dual" ? "双学位" : "说明",
    名称: item.nameZh,
    上级: item.parent.join("、"),
  }));

export const programDocumentRows = (document: ProgramDocument): DisplayRow[] => {
  const rows: DisplayRow[] = [];
  let tableIndex = 0;
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.type === "table") {
        tableIndex += 1;
        const expanded = expandProgramDocumentTable(block.table);
        const width = Math.max(0, ...expanded.headerRows.map((row) => row.length), ...expanded.rows.map((row) => row.length));
        const common = {
          章节: section.id,
          标题: section.title,
          层级: section.level,
          类型: "表格",
          表格序号: tableIndex,
          表题: block.table.caption ?? `表格 ${tableIndex}`,
        };
        const appendMatrixRows = (matrix: string[][], kind: string, start: number): void => {
          matrix.forEach((cells, index) => {
            rows.push({
              ...common,
              行类型: kind,
              行号: start + index + 1,
              ...Object.fromEntries(Array.from({ length: width }, (_, cell) => [`列${cell + 1}`, cells[cell] ?? ""])),
            });
          });
        };
        appendMatrixRows(expanded.headerRows, "表头", 0);
        appendMatrixRows(expanded.rows, "数据", expanded.headerRows.length);
        appendMatrixRows(expanded.footnoteRows, "脚注", expanded.headerRows.length + expanded.rows.length);
        continue;
      }

      rows.push({
        章节: section.id,
        标题: section.title,
        层级: section.level,
        类型: block.type === "paragraph" ? "正文" : block.type === "image" ? "图片" : "课程",
        内容: block.type === "paragraph"
          ? block.text
          : block.type === "course"
            ? `${block.code} ${block.text}`
            : block.alt ?? block.src,
        ...(block.type === "paragraph" && block.links?.length
          ? { 链接: block.links.map((link) => `${link.text} → ${link.href}`).join("；") }
          : {}),
      });
    }
  }
  return rows;
};

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
  items: Array<{
    classroomCode: string;
    building: string;
    usages: ClassroomUsage[];
    date?: string;
    floor?: number;
    seats?: number;
    roomType?: string;
    roomTypeName?: string;
    canBorrow?: boolean;
    arrangeSchedule?: boolean;
    arrangeExam?: boolean;
    dateRange?: { from: string; to: string };
    availableBetween?: { from: string; to: string; everyDay: boolean };
  }>,
): DisplayRow[] =>
  items.map((item) => ({
    ...(item.dateRange ? { 日期范围: `${item.dateRange.from} 至 ${item.dateRange.to}` } : { 日期: item.date ?? item.usages[0]?.date ?? "" }),
    ...(item.availableBetween ? { 空闲时段: `${item.availableBetween.from}-${item.availableBetween.to}（每天）` } : {}),
    教室: item.classroomCode,
    楼栋: item.building,
    楼层: item.floor ?? "",
    座位: item.seats ?? "",
    房间类型: item.roomTypeName ?? item.roomType ?? "",
    可借用: item.canBorrow ?? "",
    可排课: item.arrangeSchedule ?? "",
    可安排考试: item.arrangeExam ?? "",
    使用情况: item.usages
      .map((usage) => `${usage.start}-${usage.end} ${usage.courseName ?? classroomUsageTypeLabel(usage)}`)
      .join("；"),
    授课教师: item.usages.flatMap((usage) => usage.teachers).join("、"),
    使用类型: item.usages.map(classroomUsageTypeLabel).join("、"),
    申请人: item.usages.map((usage) => usage.applicant ?? "").filter(Boolean).join("、"),
  }));

export const classroomWeekSummaryRows = (items: import("../domain/models.js").ClassroomWeekSummary[]): DisplayRow[] =>
  items.map((item) => ({
    教室: item.classroomCode,
    楼栋: item.building,
    楼层: item.floor,
    座位: item.seats,
    房间类型: item.roomTypeName,
    可借用: item.canBorrow,
    可排课: item.arrangeSchedule,
    使用天数: item.busyDays,
    使用记录数: item.usageCount,
    周使用摘要: item.days
      .filter((day) => day.usages.length > 0)
      .map((day) => `${day.date} ${day.usages.map((usage) => `${usage.start}-${usage.end} ${usage.courseName ?? classroomUsageTypeLabel(usage)}`).join("、")}`)
      .join("；") || "无使用记录",
  }));

export const examRows = (items: Exam[]): DisplayRow[] =>
  items.map((item) => ({
    课程号: item.courseCode,
    课程名: item.courseName,
    开课单位: `${item.departmentCode ?? ""} ${item.departmentName ?? ""}`.trim(),
    授课教师: item.teachers.join("、"),
    考试类型: item.type,
    学分: item.courseCredits ?? "",
    课程类型: item.courseType ?? "",
    日期: item.date,
    时间: `${item.startTime ?? ""}-${item.endTime ?? ""}`,
    地点: item.rooms.map((room) => `${room.room}${room.count == null ? "" : `(${room.count})`}`).join("、"),
    人数: item.students ?? "",
    上课班级: item.classes.join("、"),
    学历: item.education ?? "",
    年级: item.grades.join("、"),
    考核方式: item.examMode ?? "",
  }));

export const examOptionRows = (items: ExamFilterOption[]): DisplayRow[] => {
  const labels: Record<ExamFilterOption["dimension"], string> = {
    type: "考试类型",
    education: "学历层次",
    department: "开课单位",
    grade: "年级",
    building: "教学楼",
    date: "日期",
    span: "时间段",
  };
  return items.map((item) => ({
    筛选项: labels[item.dimension],
    值: item.value,
    名称: item.label,
    考试数: item.count,
  }));
};

export const examScheduleRows = (days: ExamScheduleDay[]): DisplayRow[] =>
  days.map((day) => ({
    日期: day.date,
    考试场数: day.exams.length,
    考试安排: day.exams.map((exam) => {
      const time = exam.startTime && exam.endTime ? `${exam.startTime}-${exam.endTime}` : "时间待定";
      const locations = exam.rooms.map((room) => room.room).filter(Boolean).join("、") || "考场待定";
      return `${time} ${exam.courseCode} ${exam.courseName} @ ${locations}`;
    }).join("；") || "无考试",
  }));

export const examConflictRows = (items: ExamConflict[]): DisplayRow[] =>
  items.map((item) => ({
    日期: item.date,
    考场: item.room,
    冲突时段: `${item.overlapStart}-${item.overlapEnd}`,
    考试一: `${item.first.courseCode} ${item.first.courseName}（${item.first.type}）`,
    考试二: `${item.second.courseCode} ${item.second.courseName}（${item.second.type}）`,
  }));

export const substituteRows = (items: SubstituteRelation[]): DisplayRow[] =>
  items.map((item) => ({
    替代方课程: item.substituteCourses.map((course) => {
      const details = [
        course.credits == null ? undefined : `${course.credits} 学分`,
        course.hours == null ? undefined : `${course.hours} 学时`,
      ].filter(Boolean).join("，");
      return `${course.code} ${course.nameZh}${details ? `（${details}）` : ""}`;
    }).join("；"),
    被替代课程: item.originalCourses.map((course) => {
      const details = [
        course.credits == null ? undefined : `${course.credits} 学分`,
        course.hours == null ? undefined : `${course.hours} 学时`,
      ].filter(Boolean).join("，");
      return `${course.code} ${course.nameZh}${details ? `（${details}）` : ""}`;
    }).join("；"),
    替代关系: item.interchangeable ? "同级可互换" : "单向高级替代",
    方向: item.interchangeable ? "双方可互换" : "替代方 → 被替代方",
    门数: item.multiple ? "多门" : "单门",
  }));
