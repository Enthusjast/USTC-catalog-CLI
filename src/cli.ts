import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { loadConfig, defaultConfigDir, type AppConfig } from "./infrastructure/config/paths.js";
import { createServices, type Services } from "./application/services.js";
import { CliError } from "./domain/errors.js";
import type { FreePeriod, LessonFilterOption, ProgramModule, QueryOptions, ResultMeta } from "./domain/models.js";
import { emitMessage, emitResult } from "./presentation/output.js";
import { serializeIcalendar, lessonCalendarEvents, examCalendarEvents } from "./presentation/ical.js";
import { buildLessonConflictReport } from "./application/lesson-conflicts.js";
import { PresetStore } from "./infrastructure/config/presets.js";
import { pruneSnapshots, prefetchSnapshots } from "./application/cache-maintenance.js";
import { runDiagnostics } from "./application/diagnostics.js";
import { shellCompletion } from "./presentation/completion.js";
import { CLI_VERSION_TEXT } from "./version.js";
import { CACHE_RESOURCE_NAMES, type LessonFilter } from "./domain/query.js";
import { parseLessonSpanFilter, parseWeekNumbers } from "./domain/schedule.js";
import {
  classroomRows,
  courseDetailRows,
  courseRows,
  examRows,
  lessonRows,
  lessonDetailRows,
  lessonExportRows,
  programCatalogRows,
  programDocumentRows,
  programRows,
  substituteRows,
} from "./presentation/rows.js";

const parseInteger = (value: string): number => {
  if (!/^-?\d+$/.test(value)) throw new CliError("ARGUMENT_ERROR", `${value} 必须是整数。`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CliError("ARGUMENT_ERROR", `${value} 必须是安全范围内的整数。`);
  return parsed;
};

const parsePositiveInteger = (value: string): number => {
  const parsed = parseInteger(value);
  if (parsed < 0) throw new CliError("ARGUMENT_ERROR", `${value} 必须是非负整数。`);
  return parsed;
};

export const parseFreePeriod = (value: string): FreePeriod => {
  if (value === "noon" || value === "中午") return "noon";
  if (value === "evening" || value === "傍晚") return "evening";
  const parsed = parseInteger(value);
  if (parsed < 0 || parsed > 13) throw new CliError("ARGUMENT_ERROR", "节次必须是 0 到 13 之间的整数。");
  return parsed;
};

const parseFormat = (opts: Record<string, unknown>): QueryOptions["format"] => {
  if (Number(Boolean(opts.json)) + Number(Boolean(opts.csv)) + Number(Boolean(opts.ics)) > 1) {
    throw new CliError("ARGUMENT_ERROR", "--json、--csv 和 --ics 只能选择一个。");
  }
  return opts.json ? "json" : opts.csv ? "csv" : "table";
};

const choice = <T extends string>(value: string | undefined, values: readonly T[], label: string): T | undefined => {
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) {
    throw new CliError("ARGUMENT_ERROR", `${label}只能是：${values.join("、")}`);
  }
  return value as T;
};

const queryOptions = (command: unknown, root?: Command): QueryOptions => {
  const local = command instanceof Command ? command.optsWithGlobals() : (command as Record<string, unknown>);
  const opts = { ...(root?.opts() ?? {}), ...(local ?? {}) } as Record<string, unknown>;
  const noCache = opts.noCache === true || opts.cache === false;
  if (opts.offline && noCache) {
    throw new CliError("ARGUMENT_ERROR", "--offline 和 --no-cache 不能同时使用。");
  }
  return {
    format: parseFormat(opts),
    offline: Boolean(opts.offline),
    noCache: opts.noCache !== undefined ? Boolean(opts.noCache) : opts.cache === false,
    limit: opts.limit === undefined ? undefined : parsePositiveInteger(String(opts.limit)),
    offset: opts.offset === undefined ? 0 : parsePositiveInteger(String(opts.offset)),
    all: Boolean(opts.all),
    noColor: opts.noColor !== undefined ? Boolean(opts.noColor) : opts.color === false,
    wide: Boolean(opts.wide),
    ics: Boolean(opts.ics),
    quiet: Boolean(opts.quiet),
    verbose: Boolean(opts.verbose),
  };
};

const accessOptions = (options: QueryOptions) => ({
  offline: options.offline,
  noCache: options.noCache,
  onDiagnostic: options.verbose ? (message: string) => process.stderr.write(`[诊断] ${message}\n`) : undefined,
});

const resolveSemester = async (
  services: Services,
  value: string | undefined,
  options: QueryOptions,
): Promise<number> => {
  if (!value) return (await services.common.defaultSemester(accessOptions(options))).value.id;
  const semesters = (await services.common.semesters(accessOptions(options))).value;
  const numeric = Number(value);
  const found = Number.isInteger(numeric)
    ? semesters.find((semester) => semester.id === numeric || semester.code === value)
    : semesters.find((semester) => semester.code === value || semester.nameZh === value);
  if (!found) throw new CliError("ARGUMENT_ERROR", `找不到学期：${value}`);
  return found.id;
};

const dateOrToday = (value?: string): string =>
  value ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

export const validDate = (value: string, label = "日期"): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CliError("ARGUMENT_ERROR", `${label}必须是 YYYY-MM-DD 格式。`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new CliError("ARGUMENT_ERROR", `${label}不是有效日期：${value}`);
  }
  return value;
};

export const parseClock = (value: string, label: string, allowEndOfDay = false): number => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new CliError("ARGUMENT_ERROR", `${label}必须使用 HH:MM 格式。`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && (!allowEndOfDay || minute !== 0))) {
    throw new CliError("ARGUMENT_ERROR", `${label}不是有效时间：${value}`);
  }
  return hour * 60 + minute;
};

const addLessonFilterOptions = (command: Command, includeSpan = true): Command => {
  command
    .option("--semester <id-or-code>", "学期 ID 或学期代码")
    .option("--department <code>", "开课单位代码")
    .option("--education <name>", "学历层次")
    .option("--class-type <text>", "网页筛选器中的课堂类型")
    .option("--course-type <text>", "课程类型；CLI 额外筛选，对应 API courseType")
    .option("--course-classify <text>", "课程范畴分类，对应 API courseClassify")
    .option("--course <text>", "课程名或课堂号")
    .option("--teacher <text>", "教师")
    .option("--location <text>", "校区或教室");
  if (includeSpan) command.option("--span <day(periods)>", "精确匹配网页节次，例如 1(3,4)");
  return command
    .option("--weekday <1-7>", "星期几；1 为星期一，7 为星期日")
    .option("--period <1-13>", "包含指定节次")
    .option("--week <n|range>", "周次或逗号分隔的范围，例如 1-5,7-10");
};

const lessonFiltersFrom = (opts: Record<string, unknown>): Omit<LessonFilter, "semesterId"> => {
  const value = (key: string): string | undefined =>
    typeof opts[key] === "string" ? opts[key] as string : undefined;
  const weekdayValue = value("weekday");
  const weekday = weekdayValue === undefined ? undefined : parseInteger(weekdayValue);
  if (weekday !== undefined && (weekday < 1 || weekday > 7)) {
    throw new CliError("ARGUMENT_ERROR", "--weekday 必须是 1 到 7 之间的整数。");
  }
  const periodValue = value("period");
  const period = periodValue === undefined ? undefined : parseInteger(periodValue);
  if (period !== undefined && (period < 1 || period > 13)) {
    throw new CliError("ARGUMENT_ERROR", "--period 必须是 1 到 13 之间的整数。");
  }
  const week = value("week");
  if (week !== undefined && !parseWeekNumbers(week)) {
    throw new CliError("ARGUMENT_ERROR", "--week 使用周次或范围，例如 3、1-5、1-5,7-10；周次范围为 1 到 60。");
  }
  const span = value("span");
  if (span !== undefined && !parseLessonSpanFilter(span)) {
    throw new CliError("ARGUMENT_ERROR", "--span 使用网页展示的节次格式，例如 1(3,4)。");
  }
  return {
    department: value("department"),
    education: value("education"),
    classType: value("classType"),
    courseType: value("courseType"),
    courseClassify: value("courseClassify"),
    course: value("course"),
    teacher: value("teacher"),
    location: value("location"),
    span,
    weekday,
    period,
    week,
  };
};

const emitPresetProcess = (args: string[], format: QueryOptions["format"], ics: boolean): void => {
  const entry = fileURLToPath(new URL(process.argv[1]?.endsWith(".ts") ? "./main.ts" : "./main.js", import.meta.url));
  const output = ics ? ["--ics"] : format === "table" ? [] : [`--${format}`];
  const child = spawnSync(process.execPath, [entry, ...output, ...args], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (child.error) throw new CliError("PRESET_ERROR", "无法启动预设查询。", "请检查 Node.js 和 CLI 安装。", child.error);
  process.exitCode = child.status ?? 1;
};

const buildingFilter = (value?: string): string | undefined => {
  if (value === undefined) return undefined;
  const buildings = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (buildings.length === 0) throw new CliError("ARGUMENT_ERROR", "--building 不能为空");
  return buildings.join(",");
};

const cacheResource = (value?: string): string | undefined => {
  if (value === undefined) return undefined;
  if (!(CACHE_RESOURCE_NAMES as readonly string[]).includes(value)) {
    throw new CliError("ARGUMENT_ERROR", `未知缓存资源：${value}。`, `可选资源：${CACHE_RESOURCE_NAMES.join("、")}`);
  }
  return value;
};

const flattenDepartments = (nodes: Array<{ code: string; nameZh: string; id?: number; children: typeof nodes }>): Array<Record<string, unknown>> =>
  nodes.flatMap((node) => [
    { 院系代码: node.code, 院系名称: node.nameZh, 内部ID: node.id ?? "" },
    ...flattenDepartments(node.children),
  ]);

const filterProgramModules = (modules: ProgramModule[], term?: string): ProgramModule[] => {
  if (!term) return modules;
  return modules
    .map((module) => ({
      ...module,
      courses: module.courses.filter((course) => course.terms.includes(term)),
      children: filterProgramModules(module.children, term),
    }))
    .filter((module) => module.courses.length > 0 || module.children.length > 0 || !module.isLeaf);
};

const programModuleRows = (module: ProgramModule, includeCourses = true): Array<Record<string, unknown>> => [
  {
    模块ID: module.id,
    类型: module.type,
    要求学分: module.requiredCredits ?? "",
    要求门数: module.requiredCourseNum ?? "",
    叶子: module.isLeaf ? "是" : "否",
    课程数: module.courses.length,
  },
  ...(includeCourses ? module.courses.map((course) => ({
    模块ID: module.id,
    课程编号: course.code,
    课程名: course.name,
    必修: course.compulsory ? "是" : "否",
    学时: course.hours ?? "",
    学分: course.credits ?? "",
    开课学期: course.terms.join("、"),
  })) : []),
  ...module.children.flatMap((child) => programModuleRows(child, includeCourses)),
];

const emitStaticMessage = (resource: string, label: string, value: string, options: QueryOptions): void => {
  emitResult(
    {
      meta: {
        resource,
        scope: "static",
        source: "static",
        fetchedAt: new Date().toISOString(),
        dataAsOf: "网页静态内容",
        stale: false,
      },
      data: { label, value },
    },
    options,
    1,
    { tableRows: [{ 名称: label, 内容: value }], tableTotal: 1 },
  );
};

const emitCalendarOutput = (
  title: string,
  result: { events: Parameters<typeof serializeIcalendar>[1]; skipped: number },
  meta?: ResultMeta,
  offline = false,
  quiet = false,
): void => {
  process.stdout.write(serializeIcalendar(title, result.events));
  if (!quiet && meta?.stale) {
    const text = offline ? "提示：日历数据来自离线缓存" : "警告：网络请求失败，日历数据来自缓存";
    process.stderr.write(`${text}，抓取时间：${meta.fetchedAt}${meta.dataAsOf ? `，数据时间：${meta.dataAsOf}` : ""}\n`);
  }
  if (!quiet && result.skipped > 0) process.stderr.write(`提示：${result.skipped} 条记录因缺少可解析的日期或时间，未写入日历。\n`);
}

const confirmDestructiveAction = async (options: QueryOptions, yes: boolean, target: string): Promise<void> => {
  if (yes) return;
  if (options.format !== "table") {
    throw new CliError("ARGUMENT_ERROR", "使用非表格输出执行删除操作时必须显式提供 --yes。");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("ARGUMENT_ERROR", "非交互环境执行删除操作时必须显式提供 --yes。");
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`确认${target}？此操作不可撤销 [y/N] `);
    if (!/^(y|yes)$/i.test(answer.trim())) {
      throw new CliError("ARGUMENT_ERROR", "已取消操作。");
    }
  } finally {
    readline.close();
  }
};

export const buildCli = (config?: Partial<AppConfig>): { program: Command; services: Services; config: AppConfig } => {
  const appConfig = loadConfig(config);
  const services = createServices(appConfig);
  const program = new Command();
  const cliOptions = (command: unknown): QueryOptions => queryOptions(command, program);

  program
    .name("catalog")
    .description("中国科学技术大学本科教务目录命令行客户端")
    .version(CLI_VERSION_TEXT, "-V, --version", "显示版本信息")
    .option("--json", "输出规范化 JSON")
    .option("--csv", "输出规范化 CSV")
    .option("--ics", "输出 iCalendar 日历，仅适用于教学班与考试列表")
    .option("--offline", "只读取缓存")
    .option("--no-cache", "跳过已有缓存并强制请求")
    .option("--cache-dir <path>", "覆盖 SQLite 缓存目录")
    .option("--timeout <ms>", "网络超时时间")
    .option("--limit <n>", "限制输出记录数")
    .option("--offset <n>", "跳过前 n 条记录", "0")
    .option("--all", "表格输出全部匹配记录")
    .option("--no-color", "关闭颜色")
    .option("--wide", "表格列不截断，保留完整编号、日期和文本")
    .option("--quiet", "不输出提示")
    .option("--verbose", "输出诊断信息到 stderr");
  program.helpOption("-h, --help", "显示帮助信息");
  program.configureHelp({
    styleTitle: (title: string) => ({
      "Usage:": "用法：",
      "Arguments:": "参数：",
      "Options:": "选项：",
      "Commands:": "命令：",
    }[title] ?? title),
  });
  program.configureOutput({
    outputError: () => undefined,
  }).exitOverride();

  const semester = program.command("semester").description("学期列表");
  semester.command("list").action(async (_options: unknown, command: Command) => {
    const options = cliOptions(command);
    const result = await services.common.semesters(accessOptions(options));
    emitResult(result, options, 25, {
      tableRows: result.value.map((item) => ({
        学期ID: item.id,
        学期代码: item.code,
        学期名称: item.nameZh,
        开始日期: item.start,
        结束日期: item.end,
        当前: item.isLast ? "是" : "否",
      })),
    });
  });

  const department = program.command("department").description("院系树");
  department.command("list").action(async (_options: unknown, command: Command) => {
    const options = cliOptions(command);
    const result = await services.common.departmentTree(accessOptions(options));
    emitResult(result, options, 100, { tableRows: flattenDepartments(result.value) });
  });

  program.command("calendar")
    .description("教学日历（网页当前为空占位页）")
    .action((_opts: unknown, command: Command) => emitStaticMessage(
      "calendar",
      "教学日历",
      "网页当前没有公开教学日历数据。",
      cliOptions(command),
    ));

  const course = program.command("course").description("课程目录和课程详情");
  course
    .command("search <keyword>")
    .option("--include-invalid", "包含无效课程")
    .action(async (keyword: string, _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const result = await services.course.search(keyword, accessOptions(options), command.opts().includeInvalid);
      emitResult(result, options, 25, { tableRows: courseRows(result.value) });
    });
  course.command("categories").description("列出网页课程分类代码").action((_opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const result = services.course.categories();
    const value = result.value.map((item) => ({
      代码: item.code,
      分类: item.name,
      来源: item.kind === "quality" ? "综合素质接口" : item.kind === "school" ? "院系课程接口" : "公共课程接口",
      来源ID: item.sourceIds.join("、"),
    }));
    emitResult({ ...result, value }, options, 50, { tableRows: value });
  });
  course.command("show <codes...>").action(async (codes: string[], _opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const result = await services.course.details(codes, accessOptions(options));
    emitResult(result, options, 25, { tableRows: courseDetailRows(result.value) });
  });
  course
    .command("list <category>")
    .option("--department <id>", "院系内部 ID，可用逗号分隔")
    .action(async (category: string, _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const result = await services.course.groups(category, accessOptions(options), command.opts().department);
      const rows = result.value.flatMap((group) => group.courses.map((item) => ({ 分组: group.name, ...courseRows([item])[0] })));
      emitResult(result, options, 25, { tableRows: rows, tableTotal: rows.length });
    });

  const programCommand = program.command("program").description("培养方案和执行计划");
  programCommand
    .command("catalog [keyword]")
    .description("2013 版静态培养方案目录")
    .action(async (keyword: string | undefined, _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const result = await services.program.catalog(keyword);
      emitResult(result, options, 25, { tableRows: programCatalogRows(result.value) });
    });
  programCommand
    .command("document <code>")
    .description("查看静态培养方案正文")
    .action(async (code: string, _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const result = await services.program.document(code, accessOptions(options));
      const tableRows = programDocumentRows(result.value);
      emitResult(result, options, 50, { tableRows, tableTotal: tableRows.length });
    });
  programCommand
    .command("history")
    .description("输出网页提供的历史培养方案链接")
    .action((_opts: unknown, command: Command) => emitStaticMessage(
      "program-history",
      "历史培养方案",
      "https://www.teach.ustc.edu.cn/education/241.html",
      cliOptions(command),
    ));
  programCommand
    .command("list")
    .option("--department <id>", "院系内部 ID")
    .option("--major <id>", "专业内部 ID")
    .option("--grade <grade>", "年级")
    .option("--type <type>", "培养类型")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const result = await services.program.departments(accessOptions(options));
      const value = result.value.filter((item) =>
        (!opts.department || item.departmentCode === opts.department || String(item.departmentId) === opts.department) &&
        (!opts.major || item.majorCode === opts.major || String(item.majorId) === opts.major) &&
        (!opts.grade || item.grade === opts.grade) &&
        (!opts.type || item.trainType === opts.type),
      );
      emitResult({ ...result, value }, options, 25, { tableRows: programRows(value) });
    });
  programCommand.command("show <id>")
    .option("--term <term>", "只显示指定开课学期的课程")
    .action(async (id: string, _opts: unknown, command: Command) => {
    const options = cliOptions(command);
      const result = await services.program.detail(parseInteger(id), accessOptions(options));
    const term = command.opts().term as string | undefined;
    const value = term ? { ...result.value, modules: filterProgramModules(result.value.modules, term) } : result.value;
    emitResult({ ...result, value }, options, 25, {
      tableRows: [
        {
          计划ID: value.id,
          院系: value.departmentName,
          专业: value.majorName,
          计划名称: value.name,
          年级: value.grade,
          培养类型: value.trainType,
          要求总学分: value.requiredCredits ?? "",
          顶层模块数: value.modules.length,
        },
        ...value.modules.flatMap((module) => programModuleRows(module)),
      ],
      tableTotal: 1 + value.modules.reduce((count, module) => count + programModuleRows(module).length, 0),
    });
  });
  programCommand.command("module <id>")
    .option("--courses", "同时显示模块中的课程行")
    .action(async (id: string, _opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const result = await services.program.module(parseInteger(id), accessOptions(options));
    const tableRows = programModuleRows(result.value, Boolean(command.opts().courses));
    emitResult(result, options, 25, { tableRows, tableTotal: tableRows.length });
  });

  const lesson = program.command("lesson").description("全校开课查询");
  const lessonList = lesson.command("list");
  addLessonFilterOptions(lessonList)
    .option("--sort <field>", "排序字段：code、course、department、department-code、teacher、location、students", "code")
    .option("--desc", "降序")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const filters = lessonFiltersFrom(opts);
      const sort = choice(opts.sort, ["code", "course", "department", "department-code", "teacher", "location", "students"], "--sort");
      const semesterId = await resolveSemester(services, opts.semester, options);
      const result = await services.lesson.list(
        {
          semesterId,
          ...filters,
          sort,
          descending: Boolean(opts.desc),
        },
        accessOptions(options),
      );
      if (options.ics) {
        const semester = (await services.common.semesters(accessOptions(options))).value.find((item) => item.id === semesterId);
        if (!semester) throw new CliError("REMOTE_NOT_FOUND", `找不到学期 ${semesterId}`);
        const lessons = options.limit === undefined
          ? result.value.slice(options.offset)
          : result.value.slice(options.offset, options.offset + options.limit);
        emitCalendarOutput(`USTC ${semester.nameZh} 教学班`, lessonCalendarEvents(lessons, semester), result.meta, options.offline, options.quiet);
        return;
      }
      emitResult(result, options, 25, {
        tableRows: lessonRows(result.value),
        csvRows: lessonExportRows(result.value),
        tableTotal: result.value.length,
      });
    });
  const lessonOptions = lesson.command("options")
    .description("查看学期筛选选项和课程数量；可用列表筛选条件收窄节次选项");
  addLessonFilterOptions(lessonOptions, false).action(async (_opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const opts = command.opts();
    const filters = lessonFiltersFrom(opts);
    const semesterId = await resolveSemester(services, opts.semester, options);
    const result = await services.lesson.options({ semesterId, ...filters }, accessOptions(options));
    const dimensionNames: Record<LessonFilterOption["dimension"], string> = {
      education: "学历层次",
      classType: "课堂类型",
      courseClassify: "课程范畴分类",
      department: "院系",
      span: "上课节次",
    };
    const rows = result.value.map((item) => ({
      筛选项: dimensionNames[item.dimension],
      选项: item.label,
      参数值: item.value,
      教学班数: item.count,
    }));
    emitResult(result, options, 100, { tableRows: rows, tableTotal: rows.length });
  });
  lesson
    .command("show <codes...>")
    .requiredOption("--semester <id-or-code>", "学期 ID 或学期代码")
    .action(async (codes: string[], _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const semesterId = await resolveSemester(services, command.opts().semester, options);
      const result = await services.lesson.details(codes, semesterId, accessOptions(options));
      emitResult(result, options, 25, { tableRows: lessonDetailRows(result.value) });
    });
  lesson.command("conflicts <codes...>")
    .requiredOption("--semester <id-or-code>", "学期 ID 或学期代码")
    .description("检查指定公开教学班之间的可能时间冲突")
    .action(async (codes: string[], _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const semesterId = await resolveSemester(services, command.opts().semester, options);
      const details = await services.lesson.details(codes, semesterId, accessOptions(options));
      const report = buildLessonConflictReport(details.value.map((item) => item.lesson));
      const rows = report.conflicts.map((conflict) => ({
        星期: conflict.dayName,
        节次: conflict.periods.join("、"),
        周次: conflict.weekText ?? "未知",
        冲突教学班: conflict.lessons.map((lesson) => `${lesson.code} ${lesson.courseName}`).join("；"),
      }));
      emitResult({ ...details, value: report }, options, 50, { tableRows: rows, tableTotal: rows.length });
      for (const lesson of report.unparsedLessons) {
        process.stderr.write(`提示：教学班 ${lesson.code} 的上课时间无法解析，未纳入冲突判断。\n`);
      }
      if (report.conflicts.length === 0 && report.unparsedLessons.length === 0 && !options.quiet && options.format === "table") {
        process.stdout.write("未发现输入教学班之间的可能时间冲突。\n");
      }
    });

  const classroom = program.command("classroom").description("教室使用情况");
  classroom.command("buildings").description("列出网页教室楼栋代码").action((_opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const result = services.classroom.buildings();
    const rows = result.value.map((item) => ({ 楼栋代码: item.code, 楼栋: item.name, 教室数: item.rooms }));
    emitResult({ ...result, value: rows }, options, 50, { tableRows: rows });
  });
  classroom
    .command("list")
    .option("--date <YYYY-MM-DD>", "日期")
    .option("--building <code>", "楼栋代码")
    .option("--keyword <text>", "课程、教师或教室关键词")
    .option("--available", "只显示无占用教室")
    .option("--free-period <n>", "只显示指定节次空闲")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const freePeriod = opts.freePeriod === undefined ? undefined : parseFreePeriod(String(opts.freePeriod));
      const result = await services.classroom.list(
        validDate(dateOrToday(opts.date)),
        {
          building: buildingFilter(opts.building),
          keyword: opts.keyword,
          availableOnly: Boolean(opts.available),
          freePeriod,
        },
        accessOptions(options),
      );
      emitResult(result, options, 25, { tableRows: classroomRows(result.value) });
    });
  classroom.command("available")
    .description("查找指定时段空闲的教室")
    .requiredOption("--from <HH:MM>", "空闲时段开始时间")
    .requiredOption("--to <HH:MM>", "空闲时段结束时间")
    .option("--date <YYYY-MM-DD>", "日期")
    .option("--building <codes>", "楼栋代码，可用逗号分隔")
    .option("--min-seats <n>", "最少座位数")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const from = parseClock(opts.from, "开始时间");
      const to = parseClock(opts.to, "结束时间", true);
      if (to <= from) throw new CliError("ARGUMENT_ERROR", "结束时间必须晚于开始时间；跨午夜查询请拆成两条命令。");
      const minSeats = opts.minSeats === undefined ? undefined : parsePositiveInteger(String(opts.minSeats));
      const result = await services.classroom.list(
        validDate(dateOrToday(opts.date)),
        { building: buildingFilter(opts.building), availableBetween: { from, to }, minSeats },
        accessOptions(options),
      );
      emitResult(result, options, 25, { tableRows: classroomRows(result.value) });
    });
  classroom
    .command("show <room>")
    .option("--date <YYYY-MM-DD>", "日期")
    .action(async (room: string, _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const result = await services.classroom.show(
        validDate(dateOrToday(command.opts().date)),
        room,
        accessOptions(options),
      );
      emitResult(result, options, 25, { tableRows: classroomRows([result.value]) });
    });
  classroom
    .command("week")
    .option("--date <YYYY-MM-DD>", "所在周的日期")
    .option("--building <codes>", "逗号分隔的楼栋代码")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const result = await services.classroom.week(
        validDate(dateOrToday(opts.date), "周日期"),
        { building: buildingFilter(opts.building) },
        accessOptions(options),
      );
      emitResult(result, options, 25, { tableRows: classroomRows(result.value) });
    });

  const exam = program.command("exam").description("考试查询");
  exam
    .command("list")
    .option("--semester <id-or-code>", "学期 ID 或学期代码")
    .option("--type <type>", "考试类型")
    .option("--education <name>", "学历层次")
    .option("--department <code>", "开课单位代码")
    .option("--grade <grade>", "年级")
    .option("--building <code>", "教学楼")
    .option("--date <YYYY-MM-DD>", "日期")
    .option("--course <text>", "课程")
    .option("--teacher <text>", "教师")
    .option("--location <text>", "教室")
    .option("--class <text>", "上课班级")
    .option("--span <span>", "时间段：morning、afternoon、evening")
    .option("--sort <field>", "排序字段：course、department、teacher、location、date、time、class", "date")
    .option("--desc", "降序")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const span = choice(opts.span, ["morning", "afternoon", "evening"], "--span");
      const sort = choice(opts.sort, ["course", "department", "teacher", "location", "date", "time", "class"], "--sort");
      const semesterId = await resolveSemester(services, opts.semester, options);
      const result = await services.exam.list(
        {
          semesterId,
          type: opts.type,
          education: opts.education,
          department: opts.department,
          grade: opts.grade,
          building: opts.building,
          date: opts.date ? validDate(opts.date, "考试日期") : undefined,
          course: opts.course,
          teacher: opts.teacher,
          location: opts.location,
          className: opts.class,
          span,
          sort,
          descending: Boolean(opts.desc),
        },
        accessOptions(options),
      );
      if (options.ics) {
        const semester = (await services.common.semesters(accessOptions(options))).value.find((item) => item.id === semesterId);
        const exams = options.limit === undefined
          ? result.value.slice(options.offset)
          : result.value.slice(options.offset, options.offset + options.limit);
        emitCalendarOutput(`USTC ${semester?.nameZh ?? `学期 ${semesterId}`} 考试`, examCalendarEvents(exams), result.meta, options.offline, options.quiet);
        return;
      }
      emitResult(result, options, 25, { tableRows: examRows(result.value) });
    });
  exam
    .command("show <id>")
    .requiredOption("--semester <id-or-code>", "学期 ID 或学期代码")
    .action(async (id: string, _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const semesterId = await resolveSemester(services, command.opts().semester, options);
      const result = await services.exam.show(parseInteger(id), semesterId, accessOptions(options));
      emitResult(result, options, 25, { tableRows: examRows([result.value]) });
    });

  const substitute = program.command("substitute").description("替代课程查询");
  substitute
    .command("list")
    .option("--course <text>", "课程名称或编号")
    .option("--mode <mode>", "interchangeable 或 straight")
    .option("--multiple", "只显示多门关系")
    .option("--single", "只显示单门关系")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      if (opts.multiple && opts.single) throw new CliError("ARGUMENT_ERROR", "--multiple 和 --single 不能同时使用。");
      if (opts.mode && !["interchangeable", "straight"].includes(opts.mode)) {
        throw new CliError("ARGUMENT_ERROR", "--mode 只能是 interchangeable 或 straight。");
      }
      const result = await services.substitute.list(
        {
          course: opts.course,
          mode: opts.mode,
          multiple: opts.multiple ? true : opts.single ? false : undefined,
        },
        accessOptions(options),
      );
      emitResult(result, options, 40, { tableRows: substituteRows(result.value) });
    });
  substitute
    .command("summary")
    .description("输出网页提供的交流学校课程替代关系汇总表链接")
    .action((_opts: unknown, command: Command) => emitStaticMessage(
      "substitute-summary",
      "交流学校课程替代关系汇总表",
      "https://www.teach.ustc.edu.cn/?attachment_id=3310",
      cliOptions(command),
    ));

  const cache = program.command("cache").description("缓存管理");
  cache.command("status").action((command: Command) => {
    const options = cliOptions(command);
    const stats = services.repository.stats();
    const totalBytes = services.repository.totalBytes();
    emitResult(
      {
        meta: {
          resource: "cache",
          scope: "all",
          source: "cache",
          fetchedAt: new Date().toISOString(),
          stale: false,
        },
        data: { databasePath: services.repository.filePath, totalBytes, resources: stats },
      },
      options,
      100,
      {
        tableRows: [
          { 类型: "数据库", 资源: services.repository.filePath, 快照数: "", 最近抓取: "", 字节数: totalBytes },
          ...stats.map((item) => ({ 类型: "资源", 资源: item.resource, 快照数: item.count, 最近抓取: item.latestFetchedAt ?? "", 字节数: item.bytes })),
        ],
      },
    );
  });
  cache
    .command("clear")
    .option("--resource <name>", "只清理指定资源")
    .option("--yes", "确认删除，不进行交互确认")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const resource = cacheResource(command.opts().resource as string | undefined);
      await confirmDestructiveAction(options, Boolean(command.opts().yes), resource ? `删除资源 ${resource} 的缓存快照` : "删除全部缓存快照");
      const removed = services.repository.clear(resource);
      if (options.format === "table") {
        emitMessage(`已清理 ${removed} 条缓存快照。`);
        return;
      }
      emitResult(
        {
          meta: {
            resource: "cache",
            scope: "clear",
            source: "cache",
            fetchedAt: new Date().toISOString(),
            dataAsOf: null,
            stale: false,
          },
          data: { removed, resource: resource ?? null },
        },
        options,
        1,
        { tableRows: [{ 删除数量: removed, 资源: resource ?? "全部" }], tableTotal: 1 },
      );
    });

  cache.command("prefetch")
    .description("预先缓存学期教学班、考试及指定日期教室数据")
    .option("--semester <id-or-code>", "学期 ID 或代码；省略时使用默认学期")
    .option("--date <YYYY-MM-DD>", "预取教室日期，可重复指定", (value: string, previous: string[] = []) => [...previous, value], [])
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      if (options.offline) throw new CliError("ARGUMENT_ERROR", "缓存预取需要联网，请移除 --offline。");
      const opts = command.opts();
      const dates = (opts.date as string[]).map((date) => validDate(date));
      const semesterId = opts.semester ? await resolveSemester(services, opts.semester, options) : undefined;
      const result = await prefetchSnapshots(services, accessOptions(options), semesterId, dates);
      emitResult(result, options, 1, {
        tableRows: [{ 学期: result.value.semester.nameZh, 查询数: result.value.queries, 资源: result.value.queriedResources.join("、"), 日期: dates.join("、") }],
        tableTotal: 1,
      });
    });

  cache.command("prune")
    .description("删除早于指定时间的缓存快照")
    .requiredOption("--older-than <duration>", "保留最近时长，例如 30d、12h")
    .option("--resource <name>", "只清理一个缓存资源")
    .option("--yes", "确认删除，不进行交互确认")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const age = String(opts.olderThan).match(/^(\d{1,4})([dh])$/);
      if (!age || Number(age[1]) < 1 || Number(age[1]) > 3650) {
        throw new CliError("ARGUMENT_ERROR", "--older-than 使用 1–3650d 或 1–3650h。");
      }
      const resource = cacheResource(opts.resource as string | undefined);
      const milliseconds = Number(age[1]) * (age[2] === "d" ? 86400000 : 3600000);
      const cutoff = new Date(Date.now() - milliseconds).toISOString();
      await confirmDestructiveAction(options, Boolean(opts.yes), `删除 ${cutoff} 之前的缓存快照`);
      const removed = pruneSnapshots(services, cutoff, resource);
      emitResult({
        meta: { resource: "cache", scope: "prune", source: "cache", fetchedAt: new Date().toISOString(), dataAsOf: cutoff, stale: false },
        data: { removed, resource: resource ?? null, olderThan: cutoff },
      }, options, 1, { tableRows: [{ 删除数量: removed, 时间界限: cutoff, 资源: resource ?? "全部" }], tableTotal: 1 });
    });

  const doctor = program.command("doctor").description("检查运行环境、缓存目录和网站连接");
  doctor.action(async (_opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const checks = await runDiagnostics(appConfig, options.offline);
    const rows = checks.map((check) => ({
      检查项: check.name,
      状态: check.status === "ok" ? "正常" : check.status === "warning" ? "提示" : "异常",
      详情: check.detail,
    }));
    emitResult({
      meta: { resource: "doctor", scope: options.offline ? "offline" : "online", source: options.offline ? "static" : "mixed", fetchedAt: new Date().toISOString(), stale: false },
      data: checks,
    }, options, 20, { tableRows: rows, tableTotal: rows.length });
    if (checks.some((check) => check.status === "error")) process.exitCode = 1;
  });

  const completion = program.command("completion").description("生成 shell 命令补全脚本");
  completion.command("show <shell>")
    .description("显示指定 shell 的补全脚本；可用 bash、zsh、fish、powershell")
    .action((shell: string) => {
      try {
        process.stdout.write(shellCompletion(shell));
      } catch {
        throw new CliError("ARGUMENT_ERROR", "Shell 只能是 bash、zsh、fish 或 powershell。");
      }
    });

  const presets = new PresetStore(defaultConfigDir());
  const preset = program.command("preset").description("保存和重复运行公开只读查询");
  preset.command("list").action(async (_opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const result = await presets.list();
    const rows = result.map((item) => ({ 名称: item.name, 查询: item.args.join(" "), 更新时间: item.updatedAt }));
    emitResult({
      meta: { resource: "presets", scope: "all", source: "static", fetchedAt: new Date().toISOString(), stale: false },
      data: result,
    }, options, 50, { tableRows: rows, tableTotal: rows.length });
  });
  preset.command("save <name> <query...>")
    .allowUnknownOption()
    .option("--replace", "覆盖同名预设")
    .action(async (name: string, query: string[], _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const saved = await presets.save(name, query, Boolean(command.opts().replace));
      emitResult({
        meta: { resource: "presets", scope: name, source: "static", fetchedAt: saved.updatedAt, stale: false },
        data: saved,
      }, options, 1, { tableRows: [{ 名称: saved.name, 查询: saved.args.join(" "), 更新时间: saved.updatedAt }], tableTotal: 1 });
    });
  preset.command("run <name>").action(async (name: string, _opts: unknown, command: Command) => {
    const options = cliOptions(command);
    const saved = await presets.get(name);
    const args = ["--cache-dir", appConfig.cacheDir, "--timeout", String(appConfig.timeoutMs)];
    if (options.format !== "table") args.push(`--${options.format}`);
    if (options.offline) args.push("--offline");
    if (options.noCache) args.push("--no-cache");
    if (options.all) args.push("--all");
    if (options.noColor) args.push("--no-color");
    if (options.wide) args.push("--wide");
    if (options.quiet) args.push("--quiet");
    if (options.verbose) args.push("--verbose");
    if (options.limit !== undefined) args.push("--limit", String(options.limit));
    if (options.offset > 0) args.push("--offset", String(options.offset));
    emitPresetProcess([...args, ...saved.args], options.format, options.ics);
  });
  preset.command("delete <name>")
    .option("--yes", "确认删除，不进行交互确认")
    .action(async (name: string, _opts: unknown, command: Command) => {
      const options = cliOptions(command);
      await presets.get(name);
      await confirmDestructiveAction(options, Boolean(command.opts().yes), `删除查询预设“${name}”`);
      const removed = await presets.delete(name);
      emitResult({
        meta: { resource: "presets", scope: name, source: "static", fetchedAt: new Date().toISOString(), stale: false },
        data: { removed, name },
      }, options, 1, { tableRows: [{ 名称: name, 已删除: removed ? "是" : "否" }], tableTotal: 1 });
    });

  program.hook("preAction", (_root, actionCommand) => {
    if (!program.opts().ics) return;
    const parent = actionCommand.parent;
    const isCalendarList = actionCommand.name() === "list" && parent && ["lesson", "exam"].includes(parent.name());
    const isPresetRun = actionCommand.name() === "run" && parent?.name() === "preset";
    if (!isCalendarList && !isPresetRun) {
      throw new CliError("ARGUMENT_ERROR", "--ics 只适用于 catalog lesson list 和 catalog exam list。");
    }
  });

  return { program, services, config: appConfig };
};
