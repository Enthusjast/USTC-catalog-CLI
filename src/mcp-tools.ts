import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CLI_VERSION } from "./version.js";
import {
  CliProcessError,
  LimitedCliExecutor,
  type CatalogEnvelope,
  type CliExecutor,
} from "./mcp-cli-runner.js";

export const MCP_TOOL_NAMES = [
  "ustc_semester_list",
  "ustc_department_list",
  "ustc_course_categories",
  "ustc_calendar",
  "ustc_course_search",
  "ustc_course_list",
  "ustc_course_show",
  "ustc_program_catalog",
  "ustc_program_document",
  "ustc_program_history",
  "ustc_program_list",
  "ustc_program_show",
  "ustc_program_module",
  "ustc_lesson_list",
  "ustc_lesson_options",
  "ustc_lesson_show",
  "ustc_lesson_conflicts",
  "ustc_classroom_buildings",
  "ustc_classroom_list",
  "ustc_classroom_available",
  "ustc_classroom_show",
  "ustc_classroom_week",
  "ustc_exam_list",
  "ustc_exam_show",
  "ustc_substitute_list",
  "ustc_substitute_summary",
  "ustc_cache_status",
] as const;

type ToolArguments = Record<string, unknown>;
type ToolShape = z.ZodRawShape;
type BuildArgs = (args: ToolArguments) => string[];

const outputSchema = {
  meta: z.object({
    resource: z.string(),
    scope: z.string(),
    source: z.enum(["network", "cache", "static", "mixed"]),
    fetchedAt: z.string(),
    dataAsOf: z.string().nullable().optional(),
    stale: z.boolean(),
    unlocatedUsageCount: z.number().int().nonnegative().optional(),
  }),
  data: z.unknown(),
};

const commonSchema = (): ToolShape => ({
  offline: z.boolean().optional().describe("只读取本地缓存，不访问网络。"),
  noCache: z.boolean().optional().describe("忽略已有缓存并强制请求最新数据。"),
  limit: z.number().int().min(0).optional().describe("限制返回记录数。"),
  offset: z.number().int().min(0).optional().describe("跳过前 n 条列表记录。"),
});

const stringValue = (args: ToolArguments, key: string): string | undefined => {
  const value = args[key];
  return value === undefined ? undefined : String(value);
};

const numberValue = (args: ToolArguments, key: string): number | undefined => {
  const value = args[key];
  return value === undefined ? undefined : Number(value);
};

const booleanValue = (args: ToolArguments, key: string): boolean => args[key] === true;

const appendOption = (result: string[], flag: string, value: unknown): void => {
  if (value === undefined || value === false) return;
  if (value === true) {
    result.push(flag);
    return;
  }
  result.push(flag, String(value));
};

const commonArgs = (args: ToolArguments): string[] => {
  const result: string[] = [];
  appendOption(result, "--offline", args.offline);
  appendOption(result, "--no-cache", args.noCache);
  appendOption(result, "--limit", numberValue(args, "limit"));
  appendOption(result, "--offset", numberValue(args, "offset"));
  return result;
};

const commandArgs = (command: string[], args: ToolArguments): string[] => [
  ...commonArgs(args),
  ...command,
];

const positionals = (args: string[], values: string[]): string[] => [...args, "--", ...values];

const arrayValue = (args: ToolArguments, key: string): string[] => {
  const value = args[key];
  return Array.isArray(value) ? value.map(String) : [];
};

class McpInputError extends Error {
  readonly code = "ARGUMENT_ERROR";
}

const successResult = (envelope: CatalogEnvelope): CallToolResult => ({
  structuredContent: envelope,
  content: [{
    type: "text",
    text: JSON.stringify(envelope, null, 2),
  }],
});

const errorResult = (error: unknown): CallToolResult => {
  const details = error instanceof CliProcessError || error instanceof McpInputError
    ? {
        code: error.code,
        message: error.message,
        ...(error instanceof CliProcessError && error.hint ? { hint: error.hint } : {}),
      }
    : {
        code: "MCP_INTERNAL_ERROR",
        message: "MCP 工具执行失败。",
      };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: details }, null, 2) }],
  };
};

const register = (
  server: McpServer,
  executor: CliExecutor,
  name: string,
  description: string,
  inputSchema: ToolShape,
  buildArgs: BuildArgs,
): void => {
  server.registerTool(
    name,
    {
      title: name,
      description,
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, extra) => {
      try {
        return successResult(await executor.run(buildArgs(args), extra.signal));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
};

const semesterInput = commonSchema();
const departmentInput = commonSchema();
const calendarInput = commonSchema();

export const registerCatalogTools = (server: McpServer, executor: CliExecutor): void => {
  register(server, executor, "ustc_semester_list", "查看中国科学技术大学公开学期列表。", semesterInput,
    (args) => commandArgs(["semester", "list"], args));
  register(server, executor, "ustc_department_list", "查看网页筛选器使用的院系树。", departmentInput,
    (args) => commandArgs(["department", "list"], args));
  register(server, executor, "ustc_course_categories", "列出网页课程分类代码及其 API 来源。", commonSchema(),
    (args) => commandArgs(["course", "categories"], args));
  register(server, executor, "ustc_calendar", "查看教学日历公开状态；当前网页没有公开日历数据。", calendarInput,
    (args) => commandArgs(["calendar"], args));

  register(server, executor, "ustc_course_search", "按课程编号、中文名或英文名搜索课程。默认只返回有效课程。", {
    ...commonSchema(),
    keyword: z.string().min(1).describe("课程编号、中文名或英文名关键词。"),
    includeInvalid: z.boolean().optional().describe("是否包含网页标记为无效的课程。"),
  }, (args) => {
    const command = commandArgs(["course", "search"], args);
    appendOption(command, "--include-invalid", args.includeInvalid);
    return positionals(command, [stringValue(args, "keyword") ?? ""]);
  });

  register(server, executor, "ustc_course_list", "查看网页课程分类目录。支持网页分类代码和院系课程来源。", {
    ...commonSchema(),
    category: z.string().min(1).describe("网页课程分类代码，例如 ma、quality 或 001。"),
    department: z.string().optional().describe("院系课程来源的 API 内部 ID，可用逗号分隔。"),
  }, (args) => {
    const command = commandArgs(["course", "list"], args);
    appendOption(command, "--department", stringValue(args, "department"));
    return positionals(command, [stringValue(args, "category") ?? ""]);
  });

  register(server, executor, "ustc_course_show", "查看一个或多个课程的规范化详情、教材、简介和教学大纲。", {
    ...commonSchema(),
    codes: z.array(z.string().min(1)).min(1).describe("课程编号数组。"),
  }, (args) => positionals(commandArgs(["course", "show"], args), arrayValue(args, "codes")));

  register(server, executor, "ustc_program_catalog", "搜索或列出网页内置的 2013 版静态培养方案目录。", {
    ...commonSchema(),
    keyword: z.string().optional().describe("培养方案名称或编号关键词。"),
  }, (args) => {
    const command = commandArgs(["program", "catalog"], args);
    const keyword = stringValue(args, "keyword");
    return keyword === undefined ? command : positionals(command, [keyword]);
  });

  register(server, executor, "ustc_program_document", "读取并解析静态培养方案正文，不执行正文中的 HTML 脚本。", {
    ...commonSchema(),
    code: z.string().min(1).describe("静态培养方案代码，例如 001001。"),
  }, (args) => positionals(commandArgs(["program", "document"], args), [stringValue(args, "code") ?? ""]));

  register(server, executor, "ustc_program_history", "查看网页提供的历史培养方案链接。", {
    ...commonSchema(),
  }, (args) => commandArgs(["program", "history"], args));

  register(server, executor, "ustc_program_list", "列出 API 培养方案，并按院系、专业、年级和培养类型筛选。", {
    ...commonSchema(),
    department: z.string().optional().describe("院系代码或内部 ID。"),
    major: z.string().optional().describe("专业代码或内部 ID。"),
    grade: z.string().optional().describe("年级。"),
    type: z.string().optional().describe("培养类型。"),
  }, (args) => {
    const command = commandArgs(["program", "list"], args);
    appendOption(command, "--department", stringValue(args, "department"));
    appendOption(command, "--major", stringValue(args, "major"));
    appendOption(command, "--grade", stringValue(args, "grade"));
    appendOption(command, "--type", stringValue(args, "type"));
    return command;
  });

  register(server, executor, "ustc_program_show", "查看 API 培养方案摘要、递归课程模块，并可按开课学期筛选。", {
    ...commonSchema(),
    id: z.number().int().describe("API 培养方案 ID。"),
    term: z.string().optional().describe("只保留指定开课学期的课程。"),
  }, (args) => {
    const command = commandArgs(["program", "show"], args);
    appendOption(command, "--term", stringValue(args, "term"));
    return positionals(command, [String(numberValue(args, "id"))]);
  });

  register(server, executor, "ustc_program_module", "查看 API 培养方案模块，可选择同时返回模块内课程。", {
    ...commonSchema(),
    id: z.number().int().describe("API 培养方案模块 ID。"),
    courses: z.boolean().optional().describe("是否同时显示模块中的课程行。"),
  }, (args) => {
    const command = commandArgs(["program", "module"], args);
    appendOption(command, "--courses", args.courses);
    return positionals(command, [String(numberValue(args, "id"))]);
  });

  register(server, executor, "ustc_lesson_list", "查询全校教学班，并按学期、课程、教师、地点等条件筛选和排序。", {
    ...commonSchema(),
    semester: z.union([z.string(), z.number().int()]).optional().describe("学期 ID、学期代码或中文名称；省略时使用默认学期。"),
    department: z.string().optional().describe("开课单位代码。"),
    education: z.string().optional().describe("学历层次。"),
    classType: z.string().optional().describe("网页筛选器中的课堂类型，对应 API classType。"),
    courseType: z.string().optional().describe("课程类型，对应 API courseType；这是 CLI 额外筛选。"),
    courseClassify: z.string().optional().describe("课程范畴分类，对应 API courseClassify。"),
    course: z.string().optional().describe("课程名或课堂号。"),
    teacher: z.string().optional().describe("教师。"),
    location: z.string().optional().describe("校区或教室。"),
    span: z.string().optional().describe("精确匹配网页节次，例如 1(3,4)。"),
    weekday: z.number().int().min(1).max(7).optional().describe("星期几；1 为星期一，7 为星期日。"),
    period: z.number().int().min(1).max(13).optional().describe("只要该上课跨度包含此节次即可。"),
    week: z.string().optional().describe("周次或范围，例如 3、1-5、1-5,7-10。"),
    sort: z.enum(["code", "course", "department", "department-code", "teacher", "location", "students"]).optional(),
    desc: z.boolean().optional().describe("是否降序。"),
  }, (args) => {
    const command = commandArgs(["lesson", "list"], args);
    appendOption(command, "--semester", stringValue(args, "semester"));
    appendOption(command, "--department", stringValue(args, "department"));
    appendOption(command, "--education", stringValue(args, "education"));
    appendOption(command, "--class-type", stringValue(args, "classType"));
    appendOption(command, "--course-type", stringValue(args, "courseType"));
    appendOption(command, "--course-classify", stringValue(args, "courseClassify"));
    appendOption(command, "--course", stringValue(args, "course"));
    appendOption(command, "--teacher", stringValue(args, "teacher"));
    appendOption(command, "--location", stringValue(args, "location"));
    appendOption(command, "--span", stringValue(args, "span"));
    appendOption(command, "--weekday", numberValue(args, "weekday"));
    appendOption(command, "--period", numberValue(args, "period"));
    appendOption(command, "--week", stringValue(args, "week"));
    appendOption(command, "--sort", stringValue(args, "sort"));
    appendOption(command, "--desc", args.desc);
    return command;
  });

  register(server, executor, "ustc_lesson_options", "根据学期公开教学班数据列出筛选项和班次数，可用其他筛选条件收窄节次列表。", {
    ...commonSchema(),
    semester: z.union([z.string(), z.number().int()]).optional().describe("学期 ID、学期代码或中文名称；省略时使用默认学期。"),
    department: z.string().optional(),
    education: z.string().optional(),
    classType: z.string().optional().describe("网页筛选器中的课堂类型。"),
    courseType: z.string().optional().describe("课程类型的 CLI 额外筛选。"),
    courseClassify: z.string().optional().describe("课程范畴分类。"),
    course: z.string().optional(),
    teacher: z.string().optional(),
    location: z.string().optional(),
    weekday: z.number().int().min(1).max(7).optional(),
    period: z.number().int().min(1).max(13).optional(),
    week: z.string().optional(),
  }, (args) => {
    const command = commandArgs(["lesson", "options"], args);
    appendOption(command, "--semester", stringValue(args, "semester"));
    appendOption(command, "--department", stringValue(args, "department"));
    appendOption(command, "--education", stringValue(args, "education"));
    appendOption(command, "--class-type", stringValue(args, "classType"));
    appendOption(command, "--course-type", stringValue(args, "courseType"));
    appendOption(command, "--course-classify", stringValue(args, "courseClassify"));
    appendOption(command, "--course", stringValue(args, "course"));
    appendOption(command, "--teacher", stringValue(args, "teacher"));
    appendOption(command, "--location", stringValue(args, "location"));
    appendOption(command, "--weekday", numberValue(args, "weekday"));
    appendOption(command, "--period", numberValue(args, "period"));
    appendOption(command, "--week", stringValue(args, "week"));
    return command;
  });

  register(server, executor, "ustc_lesson_show", "查看指定学期的一个或多个教学班详情，并分别返回教学班和课程层数据。", {
    ...commonSchema(),
    codes: z.array(z.string().min(1)).min(1).describe("课堂号数组。"),
    semester: z.union([z.string(), z.number().int()]).describe("学期 ID、学期代码或中文名称。"),
  }, (args) => {
    const command = commandArgs(["lesson", "show"], args);
    appendOption(command, "--semester", stringValue(args, "semester"));
    return positionals(command, arrayValue(args, "codes"));
  });

  register(server, executor, "ustc_lesson_conflicts", "检查明确提供的公开教学班之间是否存在可能的时间重叠，不推断选课关系。", {
    ...commonSchema(),
    codes: z.array(z.string().min(1)).min(2).describe("至少两个教学班编号。"),
    semester: z.union([z.string(), z.number().int()]).describe("学期 ID、学期代码或中文名称。"),
  }, (args) => {
    const command = commandArgs(["lesson", "conflicts"], args);
    appendOption(command, "--semester", stringValue(args, "semester"));
    return positionals(command, arrayValue(args, "codes"));
  });

  register(server, executor, "ustc_classroom_buildings", "列出网页教室筛选器可选的楼栋代码和房间数量。", commonSchema(),
    (args) => commandArgs(["classroom", "buildings"], args));

  register(server, executor, "ustc_classroom_list", "查看指定日期的教室使用情况，并筛选楼栋、关键词、记录类型、房间属性或空闲状态。", {
    ...commonSchema(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("日期；省略时使用中国标准时间当天。"),
    building: z.string().optional().describe("楼栋代码，可用逗号分隔。"),
    keyword: z.string().optional().describe("房间、课程、教师、申请人或主办方关键词。"),
    usageType: z.string().optional().describe("使用记录类型；可用逗号分隔多个网页类型或课程、临时借用、考试、占用。"),
    roomType: z.string().optional().describe("房间类型代码或名称，可用逗号分隔。"),
    bookable: z.boolean().optional().describe("只保留网页标记为可借用的教室。"),
    arrangeable: z.boolean().optional().describe("只保留网页标记为可排课的教室。"),
    available: z.boolean().optional().describe("只显示当天没有使用记录的教室。"),
    freePeriod: z.union([z.number().int().min(0).max(13), z.enum(["noon", "evening"])]).optional()
      .describe("只显示指定节次空闲的教室；0 表示全天空闲，noon/evening 表示中午/傍晚。"),
  }, (args) => {
    const command = commandArgs(["classroom", "list"], args);
    appendOption(command, "--date", stringValue(args, "date"));
    appendOption(command, "--building", stringValue(args, "building"));
    appendOption(command, "--keyword", stringValue(args, "keyword"));
    appendOption(command, "--usage-type", stringValue(args, "usageType"));
    appendOption(command, "--room-type", stringValue(args, "roomType"));
    appendOption(command, "--bookable", args.bookable);
    appendOption(command, "--arrangeable", args.arrangeable);
    appendOption(command, "--available", args.available);
    appendOption(command, "--free-period", args.freePeriod);
    return command;
  });

  register(server, executor, "ustc_classroom_available", "按单日或日期范围和时间范围查找空闲教室。", {
    ...commonSchema(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: z.string().regex(/^\d{2}:\d{2}$/),
    to: z.string().regex(/^\d{2}:\d{2}$/),
    building: z.string().optional(),
    minSeats: z.number().int().min(0).optional(),
    roomType: z.string().optional(),
    bookable: z.boolean().optional(),
    arrangeable: z.boolean().optional(),
  }, (args) => {
    const command = commandArgs(["classroom", "available"], args);
    appendOption(command, "--date", stringValue(args, "date"));
    appendOption(command, "--from-date", stringValue(args, "fromDate"));
    appendOption(command, "--to-date", stringValue(args, "toDate"));
    appendOption(command, "--from", stringValue(args, "from"));
    appendOption(command, "--to", stringValue(args, "to"));
    appendOption(command, "--building", stringValue(args, "building"));
    appendOption(command, "--min-seats", numberValue(args, "minSeats"));
    appendOption(command, "--room-type", stringValue(args, "roomType"));
    appendOption(command, "--bookable", args.bookable);
    appendOption(command, "--arrangeable", args.arrangeable);
    return command;
  });

  register(server, executor, "ustc_classroom_show", "查看指定日期的单个教室及其完整使用记录。", {
    ...commonSchema(),
    room: z.string().min(1).describe("教室编号。"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("日期；省略时使用中国标准时间当天。"),
  }, (args) => {
    const command = commandArgs(["classroom", "show"], args);
    appendOption(command, "--date", stringValue(args, "date"));
    return positionals(command, [stringValue(args, "room") ?? ""]);
  });

  register(server, executor, "ustc_classroom_week", "查看给定日期所在周的教室使用情况，可按教室汇总。", {
    ...commonSchema(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("周内日期；省略时使用中国标准时间当天。"),
    building: z.string().optional().describe("楼栋代码，可用逗号分隔。"),
    usageType: z.string().optional().describe("按记录类型过滤，可用逗号分隔。"),
    roomType: z.string().optional().describe("房间类型代码或名称，可用逗号分隔。"),
    bookable: z.boolean().optional().describe("只保留网页标记为可借用的教室。"),
    arrangeable: z.boolean().optional().describe("只保留网页标记为可排课的教室。"),
    summary: z.boolean().optional().describe("按教室汇总整周使用情况。"),
  }, (args) => {
    const command = commandArgs(["classroom", "week"], args);
    appendOption(command, "--date", stringValue(args, "date"));
    appendOption(command, "--building", stringValue(args, "building"));
    appendOption(command, "--usage-type", stringValue(args, "usageType"));
    appendOption(command, "--room-type", stringValue(args, "roomType"));
    appendOption(command, "--bookable", args.bookable);
    appendOption(command, "--arrangeable", args.arrangeable);
    appendOption(command, "--summary", args.summary);
    return command;
  });

  register(server, executor, "ustc_exam_list", "查询计划内考试和通用考试，并按学期、课程、教师、地点、时间段等条件筛选。", {
    ...commonSchema(),
    semester: z.union([z.string(), z.number().int()]).optional().describe("学期 ID、学期代码或中文名称；省略时使用默认学期。"),
    type: z.string().optional().describe("考试类型。"),
    education: z.string().optional().describe("学历层次。"),
    department: z.string().optional().describe("开课单位代码。"),
    grade: z.string().optional().describe("年级。"),
    building: z.string().optional().describe("教学楼代码或前缀。"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("考试日期。"),
    course: z.string().optional().describe("课程名称或课程号。"),
    teacher: z.string().optional().describe("教师。"),
    location: z.string().optional().describe("考场。"),
    className: z.string().optional().describe("上课班级。"),
    span: z.enum(["morning", "afternoon", "evening"]).optional().describe("时间段。"),
    sort: z.enum(["course", "department", "teacher", "location", "date", "time", "class"]).optional(),
    desc: z.boolean().optional().describe("是否降序。"),
  }, (args) => {
    const command = commandArgs(["exam", "list"], args);
    appendOption(command, "--semester", stringValue(args, "semester"));
    appendOption(command, "--type", stringValue(args, "type"));
    appendOption(command, "--education", stringValue(args, "education"));
    appendOption(command, "--department", stringValue(args, "department"));
    appendOption(command, "--grade", stringValue(args, "grade"));
    appendOption(command, "--building", stringValue(args, "building"));
    appendOption(command, "--date", stringValue(args, "date"));
    appendOption(command, "--course", stringValue(args, "course"));
    appendOption(command, "--teacher", stringValue(args, "teacher"));
    appendOption(command, "--location", stringValue(args, "location"));
    appendOption(command, "--class", stringValue(args, "className"));
    appendOption(command, "--span", stringValue(args, "span"));
    appendOption(command, "--sort", stringValue(args, "sort"));
    appendOption(command, "--desc", args.desc);
    return command;
  });

  register(server, executor, "ustc_exam_show", "查看指定学期的单个考试详情。", {
    ...commonSchema(),
    id: z.number().int().describe("考试 ID。"),
    semester: z.union([z.string(), z.number().int()]).describe("学期 ID、学期代码或中文名称。"),
  }, (args) => {
    const command = commandArgs(["exam", "show"], args);
    appendOption(command, "--semester", stringValue(args, "semester"));
    return positionals(command, [String(numberValue(args, "id"))]);
  });

  register(server, executor, "ustc_substitute_list", "查询替代课程关系，并按课程、关系类型和单多门关系筛选。", {
    ...commonSchema(),
    course: z.string().optional().describe("课程编号或名称。"),
    mode: z.enum(["interchangeable", "straight"]).optional().describe("同级可互换或单向高级替代。"),
    multiple: z.boolean().optional().describe("只显示多门关系。"),
    single: z.boolean().optional().describe("只显示单门关系。"),
  }, (args) => {
    if (booleanValue(args, "multiple") && booleanValue(args, "single")) {
      throw new McpInputError("multiple 和 single 不能同时使用。");
    }
    const command = commandArgs(["substitute", "list"], args);
    appendOption(command, "--course", stringValue(args, "course"));
    appendOption(command, "--mode", stringValue(args, "mode"));
    appendOption(command, "--multiple", args.multiple);
    appendOption(command, "--single", args.single);
    return command;
  });

  register(server, executor, "ustc_substitute_summary", "查看网页提供的交流学校课程替代关系汇总表链接。", {
    ...commonSchema(),
  }, (args) => commandArgs(["substitute", "summary"], args));

  register(server, executor, "ustc_cache_status", "查看本地 SQLite 缓存数据库路径、资源快照数量和大小。", {},
    () => ["cache", "status"]);
};

export const createMcpServer = (executor: CliExecutor): McpServer => {
  const server = new McpServer(
    {
      name: "ustc-catalog-cli-mcp",
      version: CLI_VERSION,
    },
    {
      instructions: "这是 USTC Catalog CLI 的只读 MCP 服务。所有工具返回 meta/data JSON；默认请求最新公开数据，网络失败时回退到最近缓存。不要将其用于登录、选课、退课或修改教务数据。",
    },
  );
  registerCatalogTools(server, new LimitedCliExecutor(executor));
  return server;
};
