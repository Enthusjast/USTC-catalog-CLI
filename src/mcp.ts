#!/usr/bin/env node
import { startMcpServer } from "./mcp-server.js";

try {
  await startMcpServer();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`MCP 启动失败：${message}\n`);
  process.exitCode = 1;
}
