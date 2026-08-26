import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-tools.js";
import { CliProcessExecutor, type CliExecutor } from "./mcp-cli-runner.js";

export const startMcpServer = async (executor: CliExecutor = new CliProcessExecutor()): Promise<void> => {
  const server = createMcpServer(executor);
  const transport = new StdioServerTransport();
  transport.onerror = (error) => {
    process.stderr.write(`[MCP] stdio 传输错误：${error.message}\n`);
  };
  await server.connect(transport);
};
