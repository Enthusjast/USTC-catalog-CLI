import type {
  ProgramComparison,
  ProgramComparisonCourse,
  ProgramComparisonModule,
  ProgramCourse,
  ProgramDetail,
  ProgramModule,
} from "../domain/models.js";

type ModuleOccurrence = { path: string; module: ProgramModule };
type CourseOccurrence = { path: string; course: ProgramCourse; index: number };

const moduleLabel = (module: ProgramModule): string =>
  [module.type, module.major, module.majorDirection].filter(Boolean).join(" / ");

const flattenModules = (modules: ProgramModule[], parentPath = ""): ModuleOccurrence[] => {
  const counts = new Map<string, number>();
  return modules.flatMap((module) => {
    const label = moduleLabel(module) || `模块 ${module.id}`;
    const occurrence = counts.get(label) ?? 0;
    counts.set(label, occurrence + 1);
    const segment = occurrence === 0 ? label : `${label} [${occurrence + 1}]`;
    const path = parentPath ? `${parentPath} > ${segment}` : segment;
    return [
      { path, module },
      ...flattenModules(module.children, path),
    ];
  });
};

const flattenCourses = (modules: ProgramModule[]): CourseOccurrence[] =>
  flattenModules(modules).flatMap(({ path, module }) =>
    module.courses.map((course, index) => ({ path, course, index })),
  );

const courseFields = [
  ["课程名称", "name"],
  ["必修状态", "compulsory"],
  ["学时", "hours"],
  ["学分", "credits"],
  ["开课学期", "terms"],
  ["开课单位代码", "departmentCode"],
  ["开课单位", "departmentName"],
  ["考核方式", "examMode"],
  ["备注", "remark"],
] as const;

const moduleFields = [
  ["要求子模块数", "requiredSubModuleNum"],
  ["要求学分", "requiredCredits"],
  ["要求门数", "requiredCourseNum"],
  ["学分上限", "creditsUpperLimit"],
  ["门数上限", "courseNumUpperLimit"],
  ["备注", "remark"],
] as const;

const equalValue = (left: unknown, right: unknown): boolean =>
  Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => value === right[index])
    : Object.is(left ?? null, right ?? null);

const compareCourseFields = (before: ProgramCourse, after: ProgramCourse): string[] =>
  courseFields
    .filter(([, key]) => !equalValue(before[key], after[key]))
    .map(([label]) => label);

const compareModuleFields = (before: ProgramModule, after: ProgramModule): string[] =>
  moduleFields
    .filter(([, key]) => !equalValue(before[key], after[key]))
    .map(([label]) => label);

const courseSnapshot = (item: CourseOccurrence): ProgramCourse & { modulePath: string } => ({
  ...item.course,
  modulePath: item.path,
});

const courseChange = (
  change: ProgramComparisonCourse["change"],
  before?: CourseOccurrence,
  after?: CourseOccurrence,
): ProgramComparisonCourse => ({
  change,
  code: after?.course.code || before?.course.code || "",
  name: after?.course.name || before?.course.name || "",
  ...(before ? { before: courseSnapshot(before) } : {}),
  ...(after ? { after: courseSnapshot(after) } : {}),
  changedFields: before && after ? compareCourseFields(before.course, after.course) : [],
});

const compareCourses = (beforeModules: ProgramModule[], afterModules: ProgramModule[]): ProgramComparisonCourse[] => {
  const before = flattenCourses(beforeModules);
  const after = flattenCourses(afterModules);
  const matchedBefore = new Set<number>();
  const matchedAfter = new Set<number>();
  const changes: ProgramComparisonCourse[] = [];
  const codes = [...new Set([...before, ...after].map((item) => item.course.code))].sort((a, b) => a.localeCompare(b, "zh-CN"));

  for (const code of codes) {
    const left = before.map((item, index) => ({ ...item, index })).filter((item) => item.course.code === code);
    const right = after.map((item, index) => ({ ...item, index })).filter((item) => item.course.code === code);
    const rightByPath = new Map<string, number[]>();
    for (const item of right) {
      const queue = rightByPath.get(item.path) ?? [];
      queue.push(item.index);
      rightByPath.set(item.path, queue);
    }

    const leftRemainder: typeof left = [];
    for (const item of left) {
      const candidate = rightByPath.get(item.path)?.shift();
      if (candidate === undefined) {
        leftRemainder.push(item);
        continue;
      }
      matchedBefore.add(item.index);
      matchedAfter.add(candidate);
      const changedFields = compareCourseFields(item.course, after[candidate].course);
      if (changedFields.length > 0) changes.push(courseChange("changed", item, after[candidate]));
    }

    const rightRemainder = right.filter((item) => !matchedAfter.has(item.index));
    if (leftRemainder.length === 1 && rightRemainder.length === 1) {
      const oldCourse = leftRemainder[0];
      const newCourse = rightRemainder[0];
      matchedBefore.add(oldCourse.index);
      matchedAfter.add(newCourse.index);
      changes.push(courseChange("moved", oldCourse, newCourse));
    }
  }

  before.forEach((item, index) => {
    if (!matchedBefore.has(index)) changes.push(courseChange("removed", item));
  });
  after.forEach((item, index) => {
    if (!matchedAfter.has(index)) changes.push(courseChange("added", undefined, item));
  });
  return changes.sort((a, b) =>
    a.code.localeCompare(b.code, "zh-CN") || (a.before?.modulePath ?? a.after?.modulePath ?? "").localeCompare(b.before?.modulePath ?? b.after?.modulePath ?? "", "zh-CN"),
  );
};

const moduleSnapshot = (module: ProgramModule): NonNullable<ProgramComparisonModule["before"]> => ({
  requiredSubModuleNum: module.requiredSubModuleNum,
  requiredCredits: module.requiredCredits,
  requiredCourseNum: module.requiredCourseNum,
  creditsUpperLimit: module.creditsUpperLimit,
  courseNumUpperLimit: module.courseNumUpperLimit,
  remark: module.remark,
});

const compareModules = (beforeModules: ProgramModule[], afterModules: ProgramModule[]): ProgramComparisonModule[] => {
  const before = flattenModules(beforeModules);
  const after = flattenModules(afterModules);
  const beforeByPath = new Map(before.map((item) => [item.path, item.module]));
  const afterByPath = new Map(after.map((item) => [item.path, item.module]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort((a, b) => a.localeCompare(b, "zh-CN"));

  const changes: ProgramComparisonModule[] = [];
  for (const path of paths) {
    const oldModule = beforeByPath.get(path);
    const newModule = afterByPath.get(path);
    if (!oldModule) {
      changes.push({ change: "added", path, after: moduleSnapshot(newModule!), changedFields: [] });
      continue;
    }
    if (!newModule) {
      changes.push({ change: "removed", path, before: moduleSnapshot(oldModule), changedFields: [] });
      continue;
    }
    const changedFields = compareModuleFields(oldModule, newModule);
    if (changedFields.length > 0) {
      changes.push({ change: "changed", path, before: moduleSnapshot(oldModule), after: moduleSnapshot(newModule), changedFields });
    }
  }
  return changes;
};

export const compareProgramDetails = (before: ProgramDetail, after: ProgramDetail): ProgramComparison => {
  const courses = compareCourses(before.modules, after.modules);
  const modules = compareModules(before.modules, after.modules);
  return {
    before: {
      id: before.id,
      departmentName: before.departmentName,
      majorName: before.majorName,
      name: before.name,
      grade: before.grade,
      trainType: before.trainType,
      beginSemester: before.beginSemester,
      requiredCredits: before.requiredCredits,
    },
    after: {
      id: after.id,
      departmentName: after.departmentName,
      majorName: after.majorName,
      name: after.name,
      grade: after.grade,
      trainType: after.trainType,
      beginSemester: after.beginSemester,
      requiredCredits: after.requiredCredits,
    },
    summary: {
      addedCourses: courses.filter((item) => item.change === "added").length,
      removedCourses: courses.filter((item) => item.change === "removed").length,
      movedCourses: courses.filter((item) => item.change === "moved").length,
      changedCourses: courses.filter((item) => item.change === "changed").length,
      changedModules: modules.filter((item) => item.change === "changed").length,
    },
    courses,
    modules,
  };
};
