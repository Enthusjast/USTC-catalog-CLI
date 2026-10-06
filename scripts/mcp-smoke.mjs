import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entryPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));
const client = new Client({ name: "ustc-catalog-cli-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entryPath],
  cwd: process.cwd(),
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 33);
  assert.equal(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true), true);

  const result = await client.callTool({
    name: "ustc_program_catalog",
    arguments: { keyword: "数学", limit: 1 },
  });
  assert.equal(result.isError ?? false, false);
  const text = result.content.find((item) => item.type === "text");
  assert.ok(text && text.type === "text");
  const envelope = JSON.parse(text.text);
  assert.equal(envelope.meta.source, "static");
  assert.equal(envelope.data.length, 1);
} finally {
  await client.close().catch(() => undefined);
}

console.log("MCP stdio smoke test passed");
