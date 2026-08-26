import { DataAccessPolicy, type Loaded, type NetworkValue } from "./data-access-policy.js";
import {
  filterExams,
  filterLessons,
  filterSubstitutes,
  sortExams,
  sortLessons,
  mergeCourseGroups,
  normalizeCourse,
  normalizeCourseDetail,
  normalizeCourseGroups,
  mergeClassroomUsages,
  normalizeDepartmentTree,
  normalizeExams,
  normalizeLesson,
  normalizeLessonDetail,
  normalizeProgramDetail,
  normalizeProgramModule,
  normalizeProgramTree,
  normalizeSemester,
  normalizeSubstitutes,
  normalizeTimetable,
} from "../adapters/adapters.js";
import type { ClassroomUsage, Semester } from "../domain/models.js";
import type { AccessOptions } from "./data-access-policy.js";
import type { AppConfig } from "../infrastructure/config/paths.js";
import { CatalogApiClient, type ApiResult } from "../infrastructure/http/catalog-api-client.js";
import { SnapshotRepository } from "../infrastructure/cache/snapshot-repository.js";
import { STATIC_ROOMS } from "../data/rooms.js";
import { COURSE_CATALOG_BY_CODE } from "../data/course-catalog.js";
import { STATIC_PROGRAM_BY_ID, STATIC_PROGRAMS } from "../data/programs.js";
import { normalizeProgramDocument } from "../adapters/program-document.js";
import type {
  ProgramCatalogEntry,
  ProgramDocument,
  ResultMeta,
} from "../domain/models.js";
import { CliError } from "../domain/errors.js";

export type ServiceOptions = AccessOptions;

export type Services = ReturnType<typeof createServices>;

const sourceOptions = (options: ServiceOptions): ServiceOptions => ({
  ...options,
  onDiagnostic: options.onDiagnostic,
});

const chooseSemester = (semesters: Semester[]): Semester | undefined => {
  const now = Date.now();
  const sorted = [...semesters].sort((a, b) => b.start.localeCompare(a.start));
  return sorted.find((semester) => Date.parse(semester.start) - 30 * 86400000 < now) ?? sorted[0];
};

const buildingNames: Record<string, string> = {
  "1": "第一教学楼",
  "2": "第二教学楼",
  "3": "第三教学楼",
  "5": "第五教学楼",
  "8": "中校区综合体育馆",
  "9": "中校区艺术教学中心",
  "11": "高新校区图书教育中心A楼",
  "12": "高新校区图书教育中心B楼",
  "13": "高新校区图书教育中心C楼",
  "14": "高新校区师生活动中心",
  "15": "高新校区2号学科楼",
  "16": "高新校区3号学科楼",
  "22": "高新校区信智楼",
  "41": "太湖路校区教学楼",
  "42": "太湖路校区教学楼",
  "43": "太湖路校区教学楼",
  "17": "未来技术学院",
};

const displayedBuildingCodes = new Set([
  "1", "2", "3", "5", "8", "9", "11", "12", "13", "14", "15", "16", "22", "41", "42", "43",
]);

const teachingPeriodChannels = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15];

const periodRangesByLayout: Record<number, Array<[number, number]>> = {
  1: [
  [750, 835], [840, 925], [945, 1030], [1035, 1120], [1125, 1210],
  [1220, 1340], [1400, 1445], [1450, 1535], [1555, 1640], [1645, 1730],
  [1735, 1820], [1830, 1920], [1930, 2015], [2020, 2105], [2110, 2155],
  ],
  2: [
    [800, 845], [850, 935], [1010, 1055], [1100, 1145], [1155, 1350],
    [1400, 1445], [1450, 1535], [1610, 1655], [1700, 1745], [1750, 1835],
    [1845, 1920], [1930, 2015], [2020, 2105], [2110, 2155],
  ],
};

const channelLabelsByLayout: Record<number, string[]> = {
  1: ["1", "2", "3", "4", "5", "中午", "6", "7", "8", "9", "10", "傍晚", "11", "12", "13"],
  2: ["1", "2", "3", "4", "中午", "6", "7", "8", "9", "10", "傍晚", "11", "12", "13"],
};

const asMinute = (value: string): number => {
  if (value.includes(":")) {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }
  const numeric = Number(value);
  return Math.floor(numeric / 100) * 60 + numeric % 100;
};

const channelsFor = (start: string, end: string, layout = 1): number[] => {
  const startValue = asMinute(start);
  const endValue = asMinute(end);
  const periods = periodRangesByLayout[layout] ?? periodRangesByLayout[1];
  return periods.flatMap(([rangeStart, rangeEnd], index) => {
    const startMinute = asMinute(String(rangeStart));
    const endMinute = asMinute(String(rangeEnd));
    return startValue < endMinute && endValue > startMinute ? [index + 1] : [];
  });
};

const asNetworkValue = <T>(result: ApiResult<T>, dataAsOf?: string | null): NetworkValue<T> => ({
  value: result.data,
  fetchedAt: result.fetchedAt,
  status: result.status,
  dataAsOf,
});

const aggregateMeta = (
  values: Array<{ meta: ResultMeta }>,
  resource: string,
  scope: string,
): ResultMeta => {
  const first = values[0]?.meta;
  const sources = new Set(values.map((value) => value.meta.source));
  const dataAsOf = new Set(values.map((value) => value.meta.dataAsOf).filter(Boolean));
  return {
    resource,
    scope,
    source: sources.size === 1 ? (first?.source ?? "network") : "mixed",
    fetchedAt: values
      .map((value) => value.meta.fetchedAt)
      .sort()
      .at(-1) ?? new Date().toISOString(),
    dataAsOf: dataAsOf.size === 1 ? [...dataAsOf][0] : null,
    stale: values.some((value) => value.meta.stale),
  };
};

const applyUsageChannels = (usage: ClassroomUsage): ClassroomUsage => {
  const layout = usage.layout ?? 1;
  const channels = channelsFor(usage.start, usage.end, layout);
  return {
    ...usage,
    channels,
    channelText: channels.map((channel) => channelLabelsByLayout[layout]?.[channel - 1] ?? String(channel)),
  };
};

export function createServices(config: AppConfig) {
  const api = new CatalogApiClient(config);
  const repository = new SnapshotRepository(config);
  const policy = new DataAccessPolicy(repository);
  let publicChecked = false;
  let publicCheckPromise: Promise<void> | undefined;

  const load = async <T>(
    resource: string,
    scope: string,
    loader: () => Promise<NetworkValue<T>>,
    options: ServiceOptions,
  ): Promise<Loaded<T>> => {
    if (resource !== "restricted" && !options.offline && !publicChecked) {
      publicCheckPromise ??= (async () => {
        const gate = await policy.load(
          "restricted",
          "public",
          async () => asNetworkValue(await api.restricted()),
          sourceOptions(options),
        );
        if (gate.value.restricted) {
          throw new CliError(
            "RESTRICTED",
            "catalog 当前处于限制模式，公开查询需要统一认证。",
            "CLI 不执行 CAS 登录，请在网页端完成认证后再查询。",
          );
        }
        publicChecked = true;
      })();
      await publicCheckPromise;
    }
    return policy.load(resource, scope, loader, sourceOptions(options));
  };

  const loadApi = async <T>(
    resource: string,
    scope: string,
    request: () => Promise<ApiResult<T>>,
    options: ServiceOptions,
    dataAsOf?: string | null,
  ): Promise<Loaded<T>> => load(resource, scope, async () => asNetworkValue(await request(), dataAsOf), options);

  const courseService = {
    async search(keyword: string, options: ServiceOptions, includeInvalid = false) {
      const loaded = await loadApi("course-search", keyword, () => api.courseSearch(keyword), options);
      const courses = (loaded.value as unknown[]).map(normalizeCourse);
      return { ...loaded, value: includeInvalid ? courses : courses.filter((course) => course.valid) };
    },

    async groups(category: string, options: ServiceOptions, department?: string) {
      if (category === "quality") {
        const loaded = await loadApi("course-list", "quality", () => api.courseQuality(), options);
        return { ...loaded, value: normalizeCourseGroups(loaded.value) };
      }
      if (category === "department") {
        if (!department) throw new CliError("ARGUMENT_ERROR", "course list department 需要 --department");
        const ids = department.split(",").map((item) => item.trim()).filter(Boolean);
        if (ids.length === 0) throw new CliError("ARGUMENT_ERROR", "--department 不能为空");
        const loadedValues = await Promise.all(
          ids.map((id) => loadApi("course-list", `department:${id}`, () => api.courseDepartment(id), options)),
        );
        const groups = mergeCourseGroups(
          loadedValues.flatMap((loadedValue) => normalizeCourseGroups(loadedValue.value)),
        );
        return {
          value: groups,
          meta: aggregateMeta(loadedValues, "course-list", `department:${ids.join(",")}`),
        };
      }
      const entry = COURSE_CATALOG_BY_CODE.get(category);
      if (!entry && category === "department") {
        throw new CliError("ARGUMENT_ERROR", "course list department 需要 --department");
      }
      const sourceIds = entry?.sourceIds ?? category.split("+").filter(Boolean);
      if (sourceIds.length === 0 && !entry) {
        throw new CliError("ARGUMENT_ERROR", `未知课程分类：${category}`);
      }
      const loadedValues = await Promise.all(
        sourceIds.map((id) =>
          loadApi("course-list", `${entry?.kind === "school" ? "department" : "public"}:${id}`,
            () => entry?.kind === "school" ? api.courseDepartment(id) : api.coursePublic(id), options),
        ),
      );
      const groups = mergeCourseGroups(
        loadedValues.flatMap((loaded) => normalizeCourseGroups(loaded.value)),
      );
      return { value: groups, meta: aggregateMeta(loadedValues, "course-list", category) };
    },

    async details(codes: string[], options: ServiceOptions) {
      const scope = [...codes].sort().join(",");
      const loaded = await loadApi("course-detail", scope, () => api.courseInfos(codes), options);
      return { ...loaded, value: (loaded.value as unknown[]).map(normalizeCourseDetail) };
    },
  };

  const programService = {
    async catalog(keyword: string | undefined): Promise<Loaded<ProgramCatalogEntry[]>> {
      const terms = (keyword ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const value = STATIC_PROGRAMS.filter((program) => {
        if (terms.length === 0) return true;
        const haystack = `${program.id} ${program.nameZh}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
      return {
        value,
        meta: {
          resource: "program-catalog",
          scope: keyword ?? "all",
          source: "network",
          fetchedAt: new Date().toISOString(),
          dataAsOf: "网页内置静态目录",
          stale: false,
        },
      };
    },

    async document(code: string, options: ServiceOptions): Promise<Loaded<ProgramDocument>> {
      const entry = STATIC_PROGRAM_BY_ID.get(code);
      if (!entry) throw new CliError("ARGUMENT_ERROR", `找不到静态培养方案：${code}`);
      const loaded = await loadApi(
        "program-document",
        code,
        () => api.programDocument(code),
        options,
        "网页静态培养方案",
      );
      return {
        ...loaded,
        value: normalizeProgramDocument(loaded.value, code, entry.nameZh, `/data/program/cn/${code}.html`),
      };
    },

    async departments(options: ServiceOptions) {
      const loaded = await loadApi("program-tree", "all", () => api.programTree(), options);
      return { ...loaded, value: normalizeProgramTree(loaded.value) };
    },

    async detail(id: number, options: ServiceOptions) {
      const summaries = await programService.departments(options);
      const summary = summaries.value.find((item) => item.id === id);
      if (!summary) throw new CliError("REMOTE_NOT_FOUND", `未在培养方案树中找到计划 ${id}`);
      const loaded = await loadApi("program-detail", String(id), () => api.programInfo(id), options,
        `培养方案 ${summary.grade} ${summary.name}`);
      return { ...loaded, value: normalizeProgramDetail(loaded.value, summary) };
    },

    async module(id: number, options: ServiceOptions) {
      const loaded = await loadApi("program-module", String(id), () => api.moduleInfo(id), options);
      return { ...loaded, value: normalizeProgramModule(loaded.value) };
    },
  };

  const commonService = {
    async restricted(options: ServiceOptions) {
      return loadApi("restricted", "public", () => api.restricted(), options);
    },

    async departmentTree(options: ServiceOptions) {
      const loaded = await loadApi("department-tree", "all", () => api.departmentTree(), options);
      return { ...loaded, value: normalizeDepartmentTree(loaded.value) };
    },

    async semesters(options: ServiceOptions) {
      const loaded = await loadApi("semesters", "all", () => api.semesters(), options);
      const value = (loaded.value as unknown[]).map(normalizeSemester).sort((a, b) => b.start.localeCompare(a.start));
      return { ...loaded, value };
    },

    async defaultSemester(options: ServiceOptions) {
      const loaded = await commonService.semesters(options);
      const semester = chooseSemester(loaded.value);
      if (!semester) throw new CliError("REMOTE_NOT_FOUND", "没有可用学期");
      return { ...loaded, value: semester };
    },

    async semesterLabel(id: number, options: ServiceOptions): Promise<string> {
      const semester = (await commonService.semesters(options)).value.find((item) => item.id === id);
      return semester?.nameZh ?? `学期 ${id}`;
    },
  };

  const lessonService = {
    async list(
      filters: { semesterId?: number; sort?: "code" | "course" | "department" | "teacher" | "location" | "students"; descending?: boolean } & Parameters<typeof filterLessons>[1],
      options: ServiceOptions,
    ) {
      const semester = filters.semesterId ?? (await commonService.defaultSemester(options)).value.id;
      const semesterLabel = await commonService.semesterLabel(semester, options);
      const loaded = await loadApi("lessons", String(semester), () => api.lessons(semester), options,
        semesterLabel);
      const lessons = (loaded.value as unknown[]).map(normalizeLesson);
      const filtered = filterLessons(lessons, filters);
      const codeSorted = [...filtered].sort((left, right) => left.code.localeCompare(right.code, "zh-CN", { numeric: true }));
      const sorted = filters.sort === "code"
        ? (filters.descending ? codeSorted.reverse() : codeSorted)
        : sortLessons(filtered, filters.sort ?? "course", filters.descending);
      return { ...loaded, value: sorted };
    },

    async details(codes: string[], semester: number, options: ServiceOptions) {
      const scope = `${semester}:${[...codes].sort().join(",")}`;
      const semesterLabel = await commonService.semesterLabel(semester, options);
      const loaded = await loadApi("lesson-detail", scope, () => api.lessonInfos(codes, semester), options,
        semesterLabel);
      return { ...loaded, value: (loaded.value as unknown[]).map(normalizeLessonDetail) };
    },
  };

  const classroomService = {
    async list(
      date: string,
      filters: { building?: string; keyword?: string; freePeriod?: number; availableOnly?: boolean },
      options: ServiceOptions,
    ) {
      const loaded = await loadApi("timetable", date, () => api.timetable(date), options, date);
      const usages = mergeClassroomUsages(
        normalizeTimetable(loaded.value, date).map(applyUsageChannels),
      );
      const grouped = new Map<string, ClassroomUsage[]>();
      for (const usage of usages) {
        grouped.set(usage.classroomCode, [...(grouped.get(usage.classroomCode) ?? []), usage]);
      }
      const keyword = filters.keyword?.toLowerCase();
      const value = STATIC_ROOMS.flatMap((room) => {
        if (!displayedBuildingCodes.has(room.buildingCode)) return [];
        const buildings = (filters.building ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const buildingMatches =
          buildings.length === 0 ||
          buildings.includes(room.buildingCode) ||
          (buildings.includes("4123") && ["41", "42", "43"].includes(room.buildingCode));
        if (!buildingMatches) return [];
        const entries = grouped.get(room.code) ?? [];
        if (filters.availableOnly && entries.length > 0) return [];
        if (filters.freePeriod === 0 && entries.length > 0) {
          return [];
        }
        const requestedChannel = filters.freePeriod && filters.freePeriod > 0
          ? teachingPeriodChannels[filters.freePeriod - 1]
          : undefined;
        if (requestedChannel !== undefined && entries.some((item) => item.channels.includes(requestedChannel))) {
          return [];
        }
        if (keyword) {
          const haystack = `${room.code} ${room.nameZh} ${entries
            .map((item) => `${item.courseIds.join(" ")} ${item.courseName ?? ""} ${item.teachers.join(" ")} ${item.applicant ?? ""} ${item.sponsor ?? ""}`)
            .join(" ")}`.toLowerCase();
          if (!haystack.includes(keyword)) return [];
        }
        return [{
          classroomCode: room.code,
          building: buildingNames[room.buildingCode] ?? "其他",
          roomType: room.roomTypeCode,
          floor: room.floor,
          seats: room.seats,
          usages: entries,
        }];
      });
      return { ...loaded, value };
    },

    async show(
      date: string,
      roomCode: string,
      options: ServiceOptions,
    ) {
      const result = await classroomService.list(date, {}, options);
      const room = result.value.find((item) => item.classroomCode === roomCode);
      if (!room) throw new CliError("REMOTE_NOT_FOUND", `日期 ${date} 没有找到教室 ${roomCode}。`);
      return { ...result, value: room };
    },

    async week(date: string, filters: { building?: string }, options: ServiceOptions) {
      const [year, month, dayOfMonth] = date.split("-").map(Number);
      const anchor = new Date(Date.UTC(year, month - 1, dayOfMonth));
      const day = anchor.getUTCDay();
      const dates = Array.from({ length: 7 }, (_, index) => {
        const next = new Date(anchor.getTime() + (index - day) * 86400000);
        return next.toISOString().slice(0, 10);
      });
      const results = await Promise.all(dates.map((item) => classroomService.list(item, filters, options)));
      const weekMeta = aggregateMeta(results, "timetable", `week:${date}`);
      return {
        value: results.flatMap((result, index) =>
          result.value.map((room) => ({ date: dates[index], ...room })),
        ),
        meta: {
          ...weekMeta,
          dataAsOf: `${dates[0]} 至 ${dates[6]}`,
        },
      };
    },
  };

  const examService = {
    async list(
      filters: { semesterId?: number; sort?: "course" | "department" | "teacher" | "location" | "date" | "time" | "class"; descending?: boolean } & Parameters<typeof filterExams>[1],
      options: ServiceOptions,
    ) {
      const semester = filters.semesterId ?? (await commonService.defaultSemester(options)).value.id;
      const semesterLabel = await commonService.semesterLabel(semester, options);
      const [planned, general] = await Promise.all([
        loadApi("exams", String(semester), () => api.exams(semester), options, semesterLabel),
        loadApi("general-exams", String(semester), () => api.generalExams(semester), options, semesterLabel),
      ]);
      const filtered = filterExams(
        normalizeExams(planned.value as unknown[], general.value as unknown[]),
        filters,
      );
      const value = sortExams(filtered, filters.sort ?? "date", filters.descending);
      return {
        value,
        meta: aggregateMeta([planned, general], "exams", String(semester)),
      };
    },

    async show(id: number, semester: number, options: ServiceOptions) {
      const result = await examService.list({ semesterId: semester }, options);
      const exam = result.value.find((item) => item.id === id);
      if (!exam) throw new CliError("REMOTE_NOT_FOUND", `学期 ${semester} 没有找到考试 ${id}。`);
      return { ...result, value: exam };
    },
  };

  const substituteService = {
    async list(filters: { course?: string; mode?: "interchangeable" | "straight"; multiple?: boolean }, options: ServiceOptions) {
      const loaded = await loadApi("substitutes", "all", () => api.substitutes(), options);
      const relations = normalizeSubstitutes(loaded.value as unknown[]);
      return { ...loaded, value: filterSubstitutes(relations, filters.course, filters.mode, filters.multiple) };
    },
  };

  return {
    api,
    repository,
    policy,
    course: courseService,
    program: programService,
    common: commonService,
    lesson: lessonService,
    classroom: classroomService,
    exam: examService,
    substitute: substituteService,
  };
}
