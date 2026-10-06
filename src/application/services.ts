import { DataAccessPolicy, type Loaded, type NetworkValue } from "./data-access-policy.js";
import {
  filterExams,
  examFilterOptions,
  findExamConflicts,
  filterLessons,
  filterSubstitutes,
  sortExams,
  type ExamFilters,
  type ExamSortKey,
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
import { compareProgramDetails } from "../adapters/program-comparison.js";
import { normalizeProgramHistory, PROGRAM_HISTORY_PAGE_URL, resolveProgramHistoryPdfUrl } from "../adapters/program-history.js";
import type { ClassroomUsage, ClassroomWeekSummary, FreePeriod, Lesson, LessonFilterOption, ProgramModule, Semester, SubstituteCourseSide } from "../domain/models.js";
import type { AccessOptions } from "./data-access-policy.js";
import type { AppConfig } from "../infrastructure/config/paths.js";
import type { SubstituteFilter } from "../domain/query.js";
import { CatalogApiClient, type ApiResult } from "../infrastructure/http/catalog-api-client.js";
import { SnapshotRepository } from "../infrastructure/cache/snapshot-repository.js";
import { STATIC_ROOMS } from "../data/rooms.js";
import { COURSE_CATALOG_BY_CODE, COURSE_CATALOG_ENTRIES } from "../data/course-catalog.js";
import { STATIC_PROGRAM_BY_ID, STATIC_PROGRAMS } from "../data/programs.js";
import { normalizeProgramDocument } from "../adapters/program-document.js";
import { downloadOfficialPdf } from "../infrastructure/http/official-pdf-downloader.js";
import type {
  DepartmentNode,
  Exam,
  ExamConflict,
  ExamFilterOption,
  ExamScheduleDay,
  ProgramCatalogEntry,
  ProgramComparison,
  ProgramDetail,
  ProgramDocument,
  ProgramHistoryEntry,
  ProgramSummary,
  ResultMeta,
} from "../domain/models.js";
import { CliError } from "../domain/errors.js";
import { hhmmToMinutes, lessonSpanKey, requestedChannels, teachingPeriods, timeRangeOverlaps, timeToMinutes } from "../domain/schedule.js";

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
  "41": "太湖路园区教学楼A楼",
  "42": "太湖路园区教学楼B楼",
  "43": "太湖路园区教学楼C楼（报告厅）",
};

const roomTypeNames: Record<string, string> = {
  "1": "普通教室",
  "2": "多媒体教室",
  "3": "语音机房",
  "4": "实验室",
  "5": "研讨室",
  "7": "录播教室",
  "8": "绘画室",
  "9": "智慧型研讨室",
  "10": "报告厅",
  "12": "绘画教室",
  "13": "摄影教室",
  "14": "钢琴教室",
  "15": "舞蹈教室",
};

const usageTypeLabels: Record<ClassroomUsage["usageType"], string> = {
  lesson: "课程",
  temporary: "临时借用",
  exam: "考试",
  occupancy: "占用",
};

type ClassroomFilters = {
  building?: string;
  keyword?: string;
  freePeriod?: FreePeriod;
  availableBetween?: { from: number; to: number };
  minSeats?: number;
  availableOnly?: boolean;
  usageType?: string[];
  roomType?: string[];
  bookable?: boolean;
  arrangeable?: boolean;
};

const formatMinutes = (minutes: number): string =>
  `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;

const datesBetween = (from: string, to: string): string[] => {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const first = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const last = Date.UTC(toYear, toMonth - 1, toDay);
  const dayCount = Math.floor((last - first) / 86400000) + 1;
  if (dayCount < 1) throw new CliError("ARGUMENT_ERROR", "结束日期必须不早于开始日期。");
  if (dayCount > 31) throw new CliError("ARGUMENT_ERROR", "一次最多查询 31 天的教室空闲情况。");
  return Array.from({ length: dayCount }, (_, index) =>
    new Date(first + index * 86400000).toISOString().slice(0, 10),
  );
};

const displayedBuildingCodes = new Set([
  "1", "2", "3", "5", "8", "9", "11", "12", "13", "14", "15", "16", "22", "41", "42", "43",
]);

const roomsByCode = new Map<string, typeof STATIC_ROOMS>();
for (const room of STATIC_ROOMS) {
  roomsByCode.set(room.code, [...(roomsByCode.get(room.code) ?? []), room]);
}

const roomForUsage = (usage: ClassroomUsage): typeof STATIC_ROOMS[number] | undefined => {
  if (!usage.classroomCode) return undefined;
  const candidates = (roomsByCode.get(usage.classroomCode) ?? []).filter((room) =>
    usage.buildingCode === undefined || room.buildingCode === usage.buildingCode,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

const roomUsageKey = (buildingCode: string, roomCode: string): string => `${buildingCode}\u0000${roomCode}`;

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
    ...(values.some((value) => value.meta.unlocatedUsageCount !== undefined)
      ? { unlocatedUsageCount: values.reduce((sum, value) => sum + (value.meta.unlocatedUsageCount ?? 0), 0) }
      : {}),
  };
};

const normalizeProgramHistoryPage = (html: string): ProgramHistoryEntry[] => {
  const entries = normalizeProgramHistory(html);
  if (entries.length === 0) {
    throw new CliError("REMOTE_INVALID_DATA", "教务处历史方案页未包含可识别的归档条目。", "稍后重试，或直接访问官方历史方案页面。");
  }
  return entries;
};

const applyUsageChannels = (usage: ClassroomUsage): ClassroomUsage => {
  const layout = usage.layout ?? 1;
  const start = timeToMinutes(usage.start);
  const end = timeToMinutes(usage.end);
  const channels = start === undefined || end === undefined ? [] : teachingPeriods(layout)
    .filter((period) => start < hhmmToMinutes(period.end) && end > hhmmToMinutes(period.start))
    .map((period) => period.channel);
  const labels = new Map(teachingPeriods(layout).map((period) => [period.channel, period.label]));
  return {
    ...usage,
    channels,
    channelText: channels.map((channel) => labels.get(channel) ?? String(channel)),
  };
};

export function createServices(config: AppConfig) {
  const api = new CatalogApiClient(config);
  const repository = new SnapshotRepository(config);
  const policy = new DataAccessPolicy(repository);
  let publicChecked = false;
  let publicCheckPromise: Promise<void> | undefined;
  const semesterLoads = new Map<string, Promise<Loaded<Semester[]>>>();

  const semesterLoadKey = (options: ServiceOptions): string =>
    `${options.offline ? "offline" : "online"}:${options.noCache ? "no-cache" : "cache"}:${options.verbose ? "verbose" : "quiet"}`;

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
    categories() {
      return {
        value: COURSE_CATALOG_ENTRIES.map((entry) => ({ ...entry, sourceIds: [...entry.sourceIds] })),
        meta: {
          resource: "course-categories",
          scope: "all",
          source: "static" as const,
          fetchedAt: new Date().toISOString(),
          dataAsOf: "网页课程目录配置随 CLI 版本固化",
          stale: false,
        },
      };
    },

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

  const loadProgramModule = async (id: number, options: ServiceOptions): Promise<Loaded<ProgramModule>> => {
    const loaded = await loadApi("program-module", String(id), () => api.moduleInfo(id), options);
    return { ...loaded, value: normalizeProgramModule(loaded.value) };
  };

  const expandProgramModules = async (
    modules: ProgramModule[],
    options: ServiceOptions,
    loads: Map<number, Promise<Loaded<ProgramModule>>>,
  ): Promise<{ modules: ProgramModule[]; loaded: Loaded<ProgramModule>[] }> => {
    const loadedModules = new Map<number, Loaded<ProgramModule>>();
    const expand = async (module: ProgramModule, ancestors: Set<number>): Promise<ProgramModule> => {
      const publicId = module.publicModuleId;
      if (publicId !== undefined && publicId !== null) {
        if (ancestors.has(publicId)) {
          throw new CliError("REMOTE_INVALID_DATA", `培养方案引用模块形成循环：${[...ancestors, publicId].join(" → ")}`);
        }
        let request = loads.get(publicId);
        if (!request) {
          request = loadProgramModule(publicId, options);
          loads.set(publicId, request);
        }
        let loaded: Loaded<ProgramModule>;
        try {
          loaded = await request;
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          throw new CliError(
            error instanceof CliError ? error.code : "REMOTE_INVALID_DATA",
            `无法展开培养方案引用模块 ${publicId}：${cause.message}`,
            error instanceof CliError ? error.hint : undefined,
            error,
          );
        }
        loadedModules.set(publicId, loaded);
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(publicId);
        const resolved = await expand(loaded.value, nextAncestors);
        return { ...resolved, parentId: module.parentId ?? resolved.parentId };
      }
      return {
        ...module,
        children: await Promise.all(module.children.map((child) => expand(child, ancestors))),
      };
    };

    return {
      modules: await Promise.all(modules.map((module) => expand(module, new Set<number>()))),
      loaded: [...loadedModules.values()],
    };
  };

  const unresolvedProgramModuleIds = (modules: ProgramModule[]): number[] => modules.flatMap((module) => [
    ...(module.publicModuleId == null ? [] : [module.publicModuleId]),
    ...unresolvedProgramModuleIds(module.children),
  ]);

  const loadProgramDetail = async (
    id: number,
    summary: ProgramSummary,
    options: ServiceOptions,
    expandPublic: boolean,
    moduleLoads: Map<number, Promise<Loaded<ProgramModule>>>,
  ): Promise<Loaded<ProgramDetail>> => {
    const loaded = await loadApi("program-detail", String(id), () => api.programInfo(id), options);
    const detail = normalizeProgramDetail(loaded.value, summary);
    if (!expandPublic) {
      const unresolved = unresolvedProgramModuleIds(detail.modules);
      return {
        ...loaded,
        value: detail,
        ...(unresolved.length > 0
          ? { meta: { ...loaded.meta, notice: `${unresolved.length} 个课程模块尚未展开；使用 --expand-public 查看其课程。` } }
          : {}),
      };
    }
    const expanded = await expandProgramModules(detail.modules, options, moduleLoads);
    return {
      value: { ...detail, modules: expanded.modules },
      meta: aggregateMeta([{ meta: loaded.meta }, ...expanded.loaded], "program-detail", String(id)),
    };
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
          source: "static",
          fetchedAt: new Date().toISOString(),
          stale: false,
          notice: "官网内置的 2013 版静态培养方案目录，与 /plan 的当前 API 计划分开。",
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
      );
      return {
        ...loaded,
        value: normalizeProgramDocument(loaded.value, code, entry.nameZh, `/data/program/cn/${code}.html`),
        meta: { ...loaded.meta, notice: "这是官网静态培养方案正文；课程引用保持原文，不保证都能在当前课程目录中查到。" },
      };
    },

    async departments(options: ServiceOptions) {
      const loaded = await loadApi("program-tree", "all", () => api.programTree(), options);
      return { ...loaded, value: normalizeProgramTree(loaded.value) };
    },

    async detail(id: number, options: ServiceOptions, expandPublic = false) {
      const summaries = await programService.departments(options);
      const summary = summaries.value.find((item) => item.id === id);
      if (!summary) throw new CliError("REMOTE_NOT_FOUND", `未在培养方案树中找到计划 ${id}`);
      return loadProgramDetail(id, summary, options, expandPublic, new Map());
    },

    async module(id: number, options: ServiceOptions) {
      return loadProgramModule(id, options);
    },

    async compare(beforeId: number, afterId: number, options: ServiceOptions): Promise<Loaded<ProgramComparison>> {
      const tree = await programService.departments(options);
      const beforeSummary = tree.value.find((item) => item.id === beforeId);
      const afterSummary = tree.value.find((item) => item.id === afterId);
      if (!beforeSummary) throw new CliError("REMOTE_NOT_FOUND", `未在培养方案树中找到计划 ${beforeId}`);
      if (!afterSummary) throw new CliError("REMOTE_NOT_FOUND", `未在培养方案树中找到计划 ${afterId}`);
      const moduleLoads = new Map<number, Promise<Loaded<ProgramModule>>>();
      const beforePromise = loadProgramDetail(beforeId, beforeSummary, options, true, moduleLoads);
      const afterPromise = beforeId === afterId
        ? beforePromise
        : loadProgramDetail(afterId, afterSummary, options, true, moduleLoads);
      const [before, after] = await Promise.all([beforePromise, afterPromise]);
      return {
        value: compareProgramDetails(before.value, after.value),
        meta: aggregateMeta(
          [{ meta: tree.meta }, { meta: before.meta }, { meta: after.meta }],
          "program-comparison",
          `${beforeId}:${afterId}`,
        ),
      };
    },

    async history(keyword: string | undefined, options: ServiceOptions): Promise<Loaded<ProgramHistoryEntry[]>> {
      const loaded = await loadApi("program-history", "all", async () => {
        const response = await api.programHistory();
        normalizeProgramHistoryPage(response.data);
        return response;
      }, options);
      const entries = normalizeProgramHistoryPage(loaded.value);
      const terms = (keyword ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const value = terms.length === 0 ? entries : entries.filter((entry) => {
        const searchable = `${entry.id} ${entry.title} ${entry.section} ${entry.version ?? ""}`.toLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
      return { ...loaded, value };
    },

    async downloadHistory(id: string, outputPath: string, options: ServiceOptions) {
      if (options.offline) throw new CliError("ARGUMENT_ERROR", "下载历史 PDF 需要访问网络，不能与 --offline 同时使用。");
      const entry = (await programService.history(undefined, options)).value.find((item) => item.id === id);
      if (!entry) throw new CliError("REMOTE_NOT_FOUND", `未在历史方案索引中找到条目 ${id}`);
      if (!entry.downloadable) {
        throw new CliError("ARGUMENT_ERROR", `历史条目“${entry.title}”不是可下载 PDF。`, "可使用 program history list 查看其网页链接。");
      }
      const attachment = /\/attachment\//i.test(new URL(entry.href).pathname);
      let pdfUrl = entry.href;
      if (attachment) {
        const attachmentPage = (await api.getText(entry.href)).data;
        pdfUrl = resolveProgramHistoryPdfUrl(attachmentPage, entry.href);
      }
      const downloaded = await downloadOfficialPdf(pdfUrl, outputPath, {
        timeoutMs: config.timeoutMs,
        userAgent: config.userAgent,
        referer: attachment ? entry.href : PROGRAM_HISTORY_PAGE_URL,
      });
      return {
        value: { entry, ...downloaded },
        meta: {
          resource: "program-history-download",
          scope: id,
          source: "network" as const,
          fetchedAt: new Date().toISOString(),
          stale: false,
        },
      };
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
      const key = semesterLoadKey(options);
      const existing = semesterLoads.get(key);
      if (existing) return existing;
      const pending = (async (): Promise<Loaded<Semester[]>> => {
        const loaded = await loadApi("semesters", "all", () => api.semesters(), options);
        const value = (loaded.value as unknown[]).map(normalizeSemester).sort((a, b) => b.start.localeCompare(a.start));
        return { ...loaded, value };
      })();
      semesterLoads.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        if (semesterLoads.get(key) === pending) semesterLoads.delete(key);
        throw error;
      }
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
      filters: { semesterId?: number; sort?: "code" | "course" | "department" | "department-code" | "teacher" | "location" | "students"; descending?: boolean } & Parameters<typeof filterLessons>[1],
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

    async options(
      filters: { semesterId?: number } & Parameters<typeof filterLessons>[1],
      options: ServiceOptions,
    ): Promise<Loaded<LessonFilterOption[]>> {
      const loaded = await lessonService.list(
        { semesterId: filters.semesterId, sort: "code" },
        options,
      );
      const allLessons = loaded.value;
      const scopedLessons = filterLessons(allLessons, {
        department: filters.department,
        education: filters.education,
        classType: filters.classType,
        course: filters.course,
        teacher: filters.teacher,
        location: filters.location,
        weekday: filters.weekday,
        period: filters.period,
        week: filters.week,
        courseType: filters.courseType,
        courseClassify: filters.courseClassify,
      });
      const rows: LessonFilterOption[] = [];
      const addOptions = (
        dimension: LessonFilterOption["dimension"],
        lessons: Lesson[],
        field: (lesson: Lesson) => string | null | undefined,
      ): void => {
        const counts = new Map<string, number>();
        for (const lesson of lessons) {
          const value = field(lesson);
          if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        for (const [value, count] of [...counts.entries()].sort(([left], [right]) =>
          left.localeCompare(right, "zh-CN", { numeric: true }))) {
          rows.push({ dimension, value, label: value, count });
        }
      };

      addOptions("education", allLessons, (lesson) => lesson.education);
      const integratedCount = allLessons.filter((lesson) => lesson.courseGradation === "本研贯通").length;
      if (integratedCount > 0) {
        rows.push({ dimension: "education", value: "本研贯通", label: "本研贯通", count: integratedCount });
      }
      addOptions("classType", allLessons, (lesson) => lesson.classType);
      addOptions("courseClassify", allLessons, (lesson) => lesson.courseClassify);

      const departments = new Map<string, { label: string; count: number }>();
      for (const lesson of allLessons) {
        if (!lesson.departmentCode) continue;
        const current = departments.get(lesson.departmentCode);
        departments.set(lesson.departmentCode, {
          label: lesson.departmentName
            ? `${lesson.departmentCode} ${lesson.departmentName}`
            : lesson.departmentCode,
          count: (current?.count ?? 0) + 1,
        });
      }
      for (const [value, item] of [...departments.entries()].sort(([left], [right]) =>
        left.localeCompare(right, "zh-CN", { numeric: true }))) {
        rows.push({ dimension: "department", value, label: item.label, count: item.count });
      }

      const spanCounts = new Map<string, number>();
      for (const lesson of scopedLessons) {
        const spans = new Set(lesson.spans.map(lessonSpanKey).filter((span): span is string => Boolean(span)));
        for (const span of spans) spanCounts.set(span, (spanCounts.get(span) ?? 0) + 1);
      }
      for (const [value, count] of [...spanCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        rows.push({ dimension: "span", value, label: value, count });
      }

      return {
        ...loaded,
        value: rows,
        meta: { ...loaded.meta, resource: "lesson-options", scope: String(filters.semesterId ?? loaded.meta.scope) },
      };
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
    buildings() {
      const byCode = new Map<string, { code: string; name: string; rooms: number }>();
      for (const room of STATIC_ROOMS) {
        if (!displayedBuildingCodes.has(room.buildingCode)) continue;
        const existing = byCode.get(room.buildingCode);
        byCode.set(room.buildingCode, {
          code: room.buildingCode,
          name: buildingNames[room.buildingCode] ?? "其他",
          rooms: (existing?.rooms ?? 0) + 1,
        });
      }
      return {
        value: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, "zh-CN", { numeric: true })),
        meta: {
          resource: "classroom-buildings",
          scope: "all",
          source: "static" as const,
          fetchedAt: new Date().toISOString(),
          dataAsOf: "网页目录核对于 2026-10-04，随 CLI 版本固化",
          stale: false,
        },
      };
    },

    async list(
      date: string,
      filters: ClassroomFilters,
      options: ServiceOptions,
    ) {
      const loaded = await loadApi("timetable", date, () => api.timetable(date), options, date);
      const rawUsages = normalizeTimetable(loaded.value, date);
      const unlocatedUsageCount = rawUsages.filter((usage) => !roomForUsage(usage)).length;
      const usages = mergeClassroomUsages(rawUsages.map(applyUsageChannels));
      const grouped = new Map<string, ClassroomUsage[]>();
      for (const usage of usages) {
        const room = roomForUsage(usage);
        if (!room) continue;
        const key = roomUsageKey(room.buildingCode, room.code);
        grouped.set(key, [...(grouped.get(key) ?? []), usage]);
      }
      const rawGrouped = new Map<string, ClassroomUsage[]>();
      for (const usage of rawUsages) {
        const room = roomForUsage(usage);
        if (!room) continue;
        const key = roomUsageKey(room.buildingCode, room.code);
        rawGrouped.set(key, [...(rawGrouped.get(key) ?? []), usage]);
      }
      const keyword = filters.keyword?.toLowerCase();
      const usageTypes = filters.usageType ?? [];
      const roomTypes = filters.roomType ?? [];
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
        if (filters.minSeats !== undefined && room.seats < filters.minSeats) return [];
        if (roomTypes.length > 0 && !roomTypes.some((type) =>
          type === room.roomTypeCode || type === roomTypeNames[room.roomTypeCode])) return [];
        if (filters.bookable && !room.canBorrow) return [];
        if (filters.arrangeable && !room.arrangeSchedule) return [];
        const key = roomUsageKey(room.buildingCode, room.code);
        const entries = grouped.get(key) ?? [];
        const displayedEntries = usageTypes.length === 0
          ? entries
          : entries.filter((usage) => usageTypes.includes(usage.rawType ?? "") || usageTypes.includes(usageTypeLabels[usage.usageType]));
        if (usageTypes.length > 0 && displayedEntries.length === 0) return [];
        if (filters.availableOnly && entries.length > 0) return [];
        if (filters.freePeriod === 0 && entries.length > 0) {
          return [];
        }
        const requested = filters.freePeriod === undefined || filters.freePeriod === 0
          ? []
          : requestedChannels(filters.freePeriod, entries.find((item) => item.layout)?.layout ?? 1);
        if (filters.freePeriod !== undefined && filters.freePeriod !== 0 && requested.length === 0) return [];
        if (requested.length > 0 && entries.some((item) => requested.some((channel) => item.channels.includes(channel)))) {
          return [];
        }
        if (filters.availableBetween && (rawGrouped.get(key) ?? []).some((item) =>
          item.allDay || timeRangeOverlaps(
            item.start,
            item.end,
            filters.availableBetween!.from,
            filters.availableBetween!.to,
          ))) return [];
        if (keyword) {
          const haystack = `${room.code} ${room.nameZh} ${entries
            .map((item) => `${item.courseIds.join(" ")} ${item.courseName ?? ""} ${item.teachers.join(" ")} ${item.applicant ?? ""} ${item.sponsor ?? ""}`)
            .join(" ")}`.toLowerCase();
          if (!haystack.includes(keyword)) return [];
        }
        return [{
          classroomCode: room.code,
          date,
          building: buildingNames[room.buildingCode] ?? "其他",
          roomType: room.roomTypeCode,
          roomTypeName: roomTypeNames[room.roomTypeCode] ?? "其他",
          floor: room.floor,
          seats: room.seats,
          enabled: room.enabled,
          experiment: room.experiment,
          mediaRecord: room.mediaRecord,
          standardExam: room.standardExam,
          canBorrow: room.canBorrow,
          arrangeSchedule: room.arrangeSchedule,
          arrangeExam: room.arrangeExam,
          usages: displayedEntries,
        }];
      });
      return {
        ...loaded,
        meta: { ...loaded.meta, unlocatedUsageCount },
        value,
      };
    },

    async availableAcrossDates(
      fromDate: string,
      toDate: string,
      filters: Omit<ClassroomFilters, "freePeriod" | "availableOnly" | "usageType"> & { availableBetween: { from: number; to: number } },
      options: ServiceOptions,
    ) {
      const dates = datesBetween(fromDate, toDate);
      const results = await Promise.all(dates.map((date) => classroomService.list(date, filters, options)));
      const availableCodes = new Set(results[0]?.value.map((room) => room.classroomCode) ?? []);
      for (const result of results.slice(1)) {
        const availableThatDay = new Set(result.value.map((room) => room.classroomCode));
        for (const code of availableCodes) if (!availableThatDay.has(code)) availableCodes.delete(code);
      }
      const value = (results[0]?.value ?? [])
        .filter((room) => availableCodes.has(room.classroomCode))
        .map((room) => ({
          ...room,
          date: undefined,
          dateRange: { from: fromDate, to: toDate },
          availableBetween: {
            from: formatMinutes(filters.availableBetween.from),
            to: formatMinutes(filters.availableBetween.to),
            everyDay: true,
          },
          usages: [],
        }));
      const meta = aggregateMeta(results, "timetable", `available:${fromDate}:${toDate}`);
      return {
        value,
        meta: {
          ...meta,
          dataAsOf: `${fromDate} 至 ${toDate}`,
        },
      };
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

    async week(date: string, filters: ClassroomFilters, options: ServiceOptions) {
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
          result.value.map((room) => ({ ...room, date: dates[index] })),
        ),
        meta: {
          ...weekMeta,
          dataAsOf: `${dates[0]} 至 ${dates[6]}`,
        },
      };
    },

    async weekSummary(date: string, filters: ClassroomFilters, options: ServiceOptions) {
      const week = await classroomService.week(date, filters, options);
      const dates = datesBetween(week.meta.dataAsOf?.split(" 至 ")[0] ?? date, week.meta.dataAsOf?.split(" 至 ")[1] ?? date);
      const byCode = new Map<string, Array<(typeof week.value)[number]>>();
      for (const item of week.value) {
        byCode.set(item.classroomCode, [...(byCode.get(item.classroomCode) ?? []), item]);
      }
      const value: ClassroomWeekSummary[] = [...byCode.entries()].map(([classroomCode, items]) => {
        const room = items[0]!;
        const daily = dates.map((day) => ({
          date: day,
          usages: items.find((item) => item.date === day)?.usages ?? [],
        }));
        return {
          classroomCode,
          building: room.building,
          floor: room.floor,
          seats: room.seats,
          roomType: room.roomType,
          roomTypeName: room.roomTypeName,
          enabled: room.enabled,
          experiment: room.experiment,
          mediaRecord: room.mediaRecord,
          standardExam: room.standardExam,
          canBorrow: room.canBorrow,
          arrangeSchedule: room.arrangeSchedule,
          arrangeExam: room.arrangeExam,
          busyDays: daily.filter((day) => day.usages.length > 0).length,
          usageCount: daily.reduce((sum, day) => sum + day.usages.length, 0),
          days: daily,
        };
      });
      return { ...week, value };
    },
  };

  const loadExamDataset = async (semesterId: number, options: ServiceOptions): Promise<Loaded<Exam[]>> => {
    const semesterLabel = await commonService.semesterLabel(semesterId, options);
    const [planned, general] = await Promise.all([
      loadApi("exams", String(semesterId), () => api.exams(semesterId), options, semesterLabel),
      loadApi("general-exams", String(semesterId), () => api.generalExams(semesterId), options, semesterLabel),
    ]);
    const plannedItems = planned.value as unknown[];
    const generalItems = general.value as unknown[];
    const mappings = new Map<string, Set<string>>();
    const remember = (name: string | undefined, code: string | undefined): void => {
      const key = name?.trim();
      if (!key || !code) return;
      mappings.set(key, new Set([...(mappings.get(key) ?? []), code]));
    };
    for (const exam of normalizeExams(plannedItems, [])) remember(exam.departmentName, exam.departmentCode);

    const unmappedNames = [...new Set(normalizeExams([], generalItems)
      .map((exam) => exam.departmentName?.trim())
      .filter((name): name is string => Boolean(name && (mappings.get(name)?.size ?? 0) !== 1)))];
    if (unmappedNames.length > 0) {
      try {
        const tree = (await commonService.departmentTree(options)).value;
        const visit = (nodes: DepartmentNode[]): void => {
          for (const node of nodes) {
            remember(node.nameZh, node.code);
            visit(node.children);
          }
        };
        visit(tree);
      } catch {
        options.onDiagnostic?.("exam department mapping unavailable; keeping general exam department names");
      }
    }
    const departmentCodesByName = new Map(
      [...mappings.entries()].flatMap(([name, codes]) => codes.size === 1 ? [[name, [...codes][0]!] as const] : []),
    );
    const meta = aggregateMeta([planned, general], "exams", String(semesterId));
    const exams = normalizeExams(plannedItems, generalItems, departmentCodesByName);
    return {
      value: exams,
      meta: {
        ...meta,
        notice: "考试查询数据由网页次日更新，非实时；实时安排请以综合教务系统为准。",
        unmappedDepartmentCount: exams.filter((exam) => exam.recordKind === "general" && !exam.departmentCode).length,
      },
    };
  };

  const examService = {
    async list(
      filters: ExamFilters & { semesterId?: number; sort?: ExamSortKey; descending?: boolean },
      options: ServiceOptions,
    ) {
      const semesterId = filters.semesterId ?? (await commonService.defaultSemester(options)).value.id;
      const loaded = await loadExamDataset(semesterId, options);
      const filtered = filterExams(loaded.value, filters);
      return { ...loaded, value: sortExams(filtered, filters.sort ?? "date", filters.descending) };
    },

    async options(
      filters: ExamFilters & { semesterId?: number },
      options: ServiceOptions,
    ): Promise<Loaded<ExamFilterOption[]>> {
      const semesterId = filters.semesterId ?? (await commonService.defaultSemester(options)).value.id;
      const loaded = await loadExamDataset(semesterId, options);
      return {
        ...loaded,
        value: examFilterOptions(loaded.value, filters),
        meta: { ...loaded.meta, resource: "exam-options", scope: String(semesterId) },
      };
    },

    async schedule(
      semesterId: number,
      fromDate: string,
      toDate: string,
      filters: ExamFilters,
      options: ServiceOptions,
    ): Promise<Loaded<ExamScheduleDay[]>> {
      const loaded = await loadExamDataset(semesterId, options);
      const exams = sortExams(filterExams(loaded.value, { ...filters, dateFrom: fromDate, dateTo: toDate }), "date");
      const dates: string[] = [];
      const [year, month, day] = fromDate.split("-").map(Number);
      const [endYear, endMonth, endDay] = toDate.split("-").map(Number);
      const end = Date.UTC(endYear, endMonth - 1, endDay);
      for (let cursor = Date.UTC(year, month - 1, day); cursor <= end; cursor += 86400000) {
        dates.push(new Date(cursor).toISOString().slice(0, 10));
      }
      const value: ExamScheduleDay[] = dates.map((date) => ({
        date,
        exams: exams.filter((exam) => exam.date === date),
      }));
      return {
        ...loaded,
        value,
        meta: {
          ...loaded.meta,
          resource: "exam-schedule",
          scope: `${semesterId}:${fromDate}:${toDate}`,
          dataAsOf: `${fromDate} 至 ${toDate}`,
        },
      };
    },

    async conflicts(
      filters: ExamFilters & { semesterId?: number },
      options: ServiceOptions,
    ): Promise<Loaded<ExamConflict[]>> {
      const semesterId = filters.semesterId ?? (await commonService.defaultSemester(options)).value.id;
      const loaded = await loadExamDataset(semesterId, options);
      const report = findExamConflicts(filterExams(loaded.value, filters));
      return {
        ...loaded,
        value: report.conflicts,
        meta: {
          ...loaded.meta,
          resource: "exam-conflicts",
          scope: String(semesterId),
          uncheckableExamCount: report.uncheckableCount,
        },
      };
    },

    async show(id: number, semester: number, options: ServiceOptions) {
      const result = await examService.list({ semesterId: semester }, options);
      const exam = result.value.find((item) => item.id === id);
      if (!exam) throw new CliError("REMOTE_NOT_FOUND", `学期 ${semester} 没有找到考试 ${id}。`);
      return { ...result, value: exam };
    },
  };

  const querySubstitutes = async (
    filters: SubstituteFilter,
    options: ServiceOptions,
  ) => {
    if (filters.course !== undefined && !filters.course.trim()) {
      throw new CliError("ARGUMENT_ERROR", "课程条件不能为空。");
    }
    if (filters.side && !filters.course) {
      throw new CliError("ARGUMENT_ERROR", "按替代方或被替代方筛选时必须同时提供课程条件。");
    }
    const loaded = await loadApi("substitutes", "all", () => api.substitutes(), options);
    const relations = normalizeSubstitutes(loaded.value as unknown[]);
    return {
      ...loaded,
      value: filterSubstitutes(relations, filters.course, filters.mode, filters.multiple, filters.side),
      meta: { ...loaded.meta, notice: "官网替代课程数据非实时、次日更新；关系只表示关系表中的直接记录，不代表教务审批结论。" },
    };
  };

  const substituteService = {
    list(filters: SubstituteFilter, options: ServiceOptions) {
      return querySubstitutes(filters, options);
    },
    explain(course: string, side: SubstituteCourseSide | undefined, options: ServiceOptions) {
      return querySubstitutes({ course, side }, options);
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
