import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  MCP_TOOL_NAMES,
  createMcpServer,
} from "../src/mcp-tools.js";
import {
  CliProcessError,
  type CatalogEnvelope,
  type CliExecutor,
  LimitedCliExecutor,
} from "../src/mcp-cli-runner.js";

const envelope: CatalogEnvelope = {
  meta: {
    resource: "course-search",
    scope: "数学",
    source: "network",
    fetchedAt: "2026-08-26T00:00:00.000Z",
    dataAsOf: null,
    stale: false,
  },
  data: [{ id: "MATH1001", nameZh: "数学分析" }],
};

class FakeExecutor implements CliExecutor {
  readonly calls: string[][] = [];
  result: CatalogEnvelope = envelope;
  failure?: Error;

  async run(args: readonly string[]): Promise<CatalogEnvelope> {
    this.calls.push([...args]);
    if (this.failure) throw this.failure;
    return this.result;
  }
}

type Session = {
  client: Client;
  server: ReturnType<typeof createMcpServer>;
};

const sessions: Session[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.client.close();
    await session.server.close();
  }
});

const connect = async (executor: CliExecutor): Promise<Session> => {
  const server = createMcpServer(executor);
  const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const session = { client, server };
  sessions.push(session);
  return session;
};

describe("USTC catalog MCP tools", () => {
  it("lists the complete read-only tool surface", async () => {
    const session = await connect(new FakeExecutor());
    const result = await session.client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(result.tools.find((tool) => tool.name === "ustc_course_search")?.inputSchema.properties)
      .toHaveProperty("keyword");
    expect(result.tools.some((tool) => tool.name.includes("cache_clear"))).toBe(false);
  });

  it("maps typed arguments to catalog CLI arguments and returns structured JSON", async () => {
    const executor = new FakeExecutor();
    const session = await connect(executor);
    const result = await session.client.callTool({
      name: "ustc_course_search",
      arguments: {
        keyword: "数学",
        includeInvalid: true,
        offline: true,
        limit: 5,
      },
    });

    expect(executor.calls).toEqual([[
      "--offline",
      "--limit",
      "5",
      "course",
      "search",
      "--include-invalid",
      "--",
      "数学",
    ]]);
    expect(result.structuredContent).toEqual(envelope);
    expect(JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}")).toEqual(envelope);
  });

  it("maps every public tool to the corresponding catalog command", async () => {
    const executor = new FakeExecutor();
    const session = await connect(executor);
    const cases: Array<{ name: string; arguments: Record<string, unknown>; expected: string[] }> = [
      { name: "ustc_semester_list", arguments: {}, expected: ["semester", "list"] },
      { name: "ustc_department_list", arguments: {}, expected: ["department", "list"] },
      { name: "ustc_calendar", arguments: {}, expected: ["calendar"] },
      {
        name: "ustc_course_list",
        arguments: { category: "001", department: "2,5", limit: 2 },
        expected: ["--limit", "2", "course", "list", "--department", "2,5", "--", "001"],
      },
      {
        name: "ustc_course_show",
        arguments: { codes: ["MATH1001", "MATH1002"] },
        expected: ["course", "show", "--", "MATH1001", "MATH1002"],
      },
      {
        name: "ustc_program_catalog",
        arguments: { keyword: "数学" },
        expected: ["program", "catalog", "--", "数学"],
      },
      {
        name: "ustc_program_document",
        arguments: { code: "001001" },
        expected: ["program", "document", "--", "001001"],
      },
      { name: "ustc_program_history", arguments: {}, expected: ["program", "history"] },
      {
        name: "ustc_program_list",
        arguments: { department: "001", major: "20", grade: "2026", type: "主修" },
        expected: ["program", "list", "--department", "001", "--major", "20", "--grade", "2026", "--type", "主修"],
      },
      {
        name: "ustc_program_show",
        arguments: { id: 3430, term: "1秋" },
        expected: ["program", "show", "--term", "1秋", "--", "3430"],
      },
      {
        name: "ustc_program_module",
        arguments: { id: 31764, courses: true },
        expected: ["program", "module", "--courses", "--", "31764"],
      },
      {
        name: "ustc_lesson_list",
        arguments: {
          semester: 461,
          department: "001",
          education: "本科",
          course: "数学",
          teacher: "张三",
          location: "5401",
          span: "1(3,4)",
          courseType: "理论课",
          courseClassify: "本科计划内课程",
          sort: "students",
          desc: true,
        },
        expected: [
          "lesson", "list", "--semester", "461", "--department", "001", "--education", "本科", "--course", "数学",
          "--teacher", "张三", "--location", "5401", "--span", "1(3,4)", "--course-type", "理论课",
          "--course-classify", "本科计划内课程", "--sort", "students", "--desc",
        ],
      },
      {
        name: "ustc_lesson_show",
        arguments: { codes: ["MATH1001.01"], semester: "461", offset: 1 },
        expected: ["--offset", "1", "lesson", "show", "--semester", "461", "--", "MATH1001.01"],
      },
      {
        name: "ustc_classroom_list",
        arguments: { date: "2026-08-26", building: "1,2", keyword: "数学", available: true, freePeriod: 3 },
        expected: ["classroom", "list", "--date", "2026-08-26", "--building", "1,2", "--keyword", "数学", "--available", "--free-period", "3"],
      },
      {
        name: "ustc_classroom_show",
        arguments: { room: "2303", date: "2026-08-26" },
        expected: ["classroom", "show", "--date", "2026-08-26", "--", "2303"],
      },
      {
        name: "ustc_classroom_week",
        arguments: { date: "2026-08-26", building: "1,2,3" },
        expected: ["classroom", "week", "--date", "2026-08-26", "--building", "1,2,3"],
      },
      {
        name: "ustc_exam_list",
        arguments: {
          semester: 441,
          type: "期末考试",
          education: "本科",
          department: "001",
          grade: "2026",
          building: "3",
          date: "2026-07-25",
          course: "微积分",
          teacher: "张三",
          location: "3A101",
          className: "行政班",
          span: "morning",
          sort: "time",
          desc: true,
        },
        expected: [
          "exam", "list", "--semester", "441", "--type", "期末考试", "--education", "本科", "--department", "001", "--grade", "2026",
          "--building", "3", "--date", "2026-07-25", "--course", "微积分", "--teacher", "张三", "--location", "3A101",
          "--class", "行政班", "--span", "morning", "--sort", "time", "--desc",
        ],
      },
      {
        name: "ustc_exam_show",
        arguments: { id: 13138, semester: "441" },
        expected: ["exam", "show", "--semester", "441", "--", "13138"],
      },
      {
        name: "ustc_substitute_list",
        arguments: { course: "数学分析", mode: "interchangeable", multiple: true },
        expected: ["substitute", "list", "--course", "数学分析", "--mode", "interchangeable", "--multiple"],
      },
      { name: "ustc_substitute_summary", arguments: {}, expected: ["substitute", "summary"] },
      { name: "ustc_cache_status", arguments: {}, expected: ["cache", "status"] },
    ];

    for (const item of cases) {
      await session.client.callTool({ name: item.name, arguments: item.arguments });
    }

    expect(executor.calls).toEqual(cases.map((item) => item.expected));
  });

  it("returns CLI errors as MCP tool errors without exposing a stack", async () => {
    const executor = new FakeExecutor();
    executor.failure = new CliProcessError("CACHE_MISS", "没有找到缓存。", "请先联网查询。");
    const session = await connect(executor);
    const result = await session.client.callTool({
      name: "ustc_cache_status",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}")).toEqual({
      error: {
        code: "CACHE_MISS",
        message: "没有找到缓存。",
        hint: "请先联网查询。",
      },
    });
  });

  it("rejects mutually exclusive substitute filters before spawning the CLI", async () => {
    const executor = new FakeExecutor();
    const session = await connect(executor);
    const result = await session.client.callTool({
      name: "ustc_substitute_list",
      arguments: { multiple: true, single: true },
    });

    expect(result.isError).toBe(true);
    expect(executor.calls).toHaveLength(0);
  });
});

describe("LimitedCliExecutor", () => {
  it("keeps at most three CLI processes active", async () => {
    let active = 0;
    let maximum = 0;
    const delegate: CliExecutor = {
      run: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return envelope;
      },
    };
    const executor = new LimitedCliExecutor(delegate);

    await Promise.all(Array.from({ length: 10 }, (_, index) => executor.run([String(index)])));

    expect(maximum).toBe(3);
  });
});
