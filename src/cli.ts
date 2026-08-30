import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { loadConfig, type AppConfig } from "./infrastructure/config/paths.js";
import { createServices, type Services } from "./application/services.js";
import { CliError } from "./domain/errors.js";
import type { ProgramModule, QueryOptions } from "./domain/models.js";
import { emitMessage, emitResult } from "./presentation/output.js";
import { CLI_VERSION_TEXT } from "./version.js";
import { CACHE_RESOURCE_NAMES } from "./domain/query.js";
import {
  classroomRows,
  courseDetailRows,
  courseRows,
  examRows,
  lessonRows,
  lessonDetailRows,
  programCatalogRows,
  programDocumentRows,
  programRows,
  substituteRows,
} from "./presentation/rows.js";

const parseInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new CliError("ARGUMENT_ERROR", `${value} 必须是整数。`);
  return parsed;
};

const parsePositiveInteger = (value: string): number => {
  const parsed = parseInteger(value);
  if (parsed < 0) throw new CliError("ARGUMENT_ERROR", `${value} 必须是非负整数。`);
  return parsed;
};

export const parseFreePeriod = (value: string): number => {
  const parsed = parseInteger(value);
  if (parsed < 0 || parsed > 13) throw new CliError("ARGUMENT_ERROR", "节次必须是 0 到 13 之间的整数。");
  return parsed;
};

const parseFormat = (opts: Record<string, unknown>): QueryOptions["format"] => {
  if (opts.json && opts.csv) throw new CliError("ARGUMENT_ERROR", "--json 和 --csv 不能同时使用。");
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
  if (opts.offline && opts.noCache) {
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

const confirmCacheClear = async (options: QueryOptions, yes: boolean, resource?: string): Promise<void> => {
  if (yes) return;
  if (options.format !== "table") {
    throw new CliError("ARGUMENT_ERROR", "使用 --json 或 --csv 清理缓存时必须显式提供 --yes。");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("ARGUMENT_ERROR", "非交互环境清理缓存时必须显式提供 --yes。");
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const target = resource ? `资源 ${resource}` : "全部缓存快照";
    const answer = await readline.question(`确认删除${target}？此操作不可撤销 [y/N] `);
    if (!/^(y|yes)$/i.test(answer.trim())) {
      throw new CliError("ARGUMENT_ERROR", "已取消缓存清理。");
    }
  } finally {
    readline.close();
  }
};

export const buildCli = (config?: Partial<AppConfig>): { program: Command; services: Services } => {
  const appConfig = loadConfig(config);
  const services = createServices(appConfig);
  const program = new Command();
  const cliOptions = (command: unknown): QueryOptions => queryOptions(command, program);

  program
    .name("catalog")
    .description("中国科学技术大学本科教务目录命令行客户端")
    .version(CLI_VERSION_TEXT)
    .option("--json", "输出规范化 JSON")
    .option("--csv", "输出规范化 CSV")
    .option("--offline", "只读取缓存")
    .option("--no-cache", "跳过已有缓存并强制请求")
    .option("--cache-dir <path>", "覆盖 SQLite 缓存目录")
    .option("--timeout <ms>", "网络超时时间")
    .option("--limit <n>", "限制输出记录数")
    .option("--offset <n>", "跳过前 n 条记录", "0")
    .option("--all", "表格输出全部匹配记录")
    .option("--no-color", "关闭颜色")
    .option("--quiet", "不输出提示")
    .option("--verbose", "输出诊断信息到 stderr");

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
  lesson
    .command("list")
    .option("--semester <id-or-code>", "学期 ID 或学期代码")
    .option("--department <code>", "开课单位代码")
    .option("--education <name>", "学历层次")
    .option("--course <text>", "课程名或课堂号")
    .option("--teacher <text>", "教师")
    .option("--location <text>", "校区或教室")
    .option("--span <text>", "上课时间片")
    .option("--course-type <text>", "课堂类型")
    .option("--course-classify <text>", "课程范畴")
    .option("--sort <field>", "排序字段：code、course、department、teacher、location、students", "code")
    .option("--desc", "降序")
    .action(async (_opts: unknown, command: Command) => {
      const options = cliOptions(command);
      const opts = command.opts();
      const sort = choice(opts.sort, ["code", "course", "department", "teacher", "location", "students"], "--sort");
      const semesterId = await resolveSemester(services, opts.semester, options);
      const result = await services.lesson.list(
        {
          semesterId,
          department: opts.department,
          education: opts.education,
          course: opts.course,
          teacher: opts.teacher,
          location: opts.location,
          span: opts.span,
          courseType: opts.courseType,
          courseClassify: opts.courseClassify,
          sort,
          descending: Boolean(opts.desc),
        },
        accessOptions(options),
      );
      emitResult(result, options, 25, { tableRows: lessonRows(result.value) });
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

  const classroom = program.command("classroom").description("教室使用情况");
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
      await confirmCacheClear(options, Boolean(command.opts().yes), resource);
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

  return { program, services };
};
