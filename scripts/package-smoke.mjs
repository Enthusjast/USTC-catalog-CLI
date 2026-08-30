import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ustc-catalog-package-smoke-"));
const packageDir = path.join(tempDir, "package");
fs.mkdirSync(packageDir);

const run = (args, options = {}) => execFileSync(npm, args, {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
  ...options,
});

try {
  const packed = JSON.parse(run(["pack", "--ignore-scripts", "--json", "--pack-destination", packageDir]));
  const tarball = packed[0]?.filename;
  assert.ok(tarball, "npm pack did not return a tarball");

  const tempPackagePath = path.join(tempDir, "package.json");
  const tempPackage = {
    name: "ustc-catalog-package-smoke",
    version: "1.0.0",
    private: true,
    allowScripts: { "better-sqlite3": true, esbuild: true },
  };
  fs.writeFileSync(tempPackagePath, `${JSON.stringify(tempPackage, null, 2)}\n`);
  const installEnvironment = { ...process.env };
  delete installEnvironment.npm_config_allow_scripts;
  run(["install", "--prefix", tempDir, "--no-package-lock", "--no-save", path.join(packageDir, tarball)], {
    cwd: tempDir,
    env: installEnvironment,
  });

  const installedRoot = path.join(tempDir, "node_modules", "@enthusjast", "ustc-catalog-cli");
  const cliEntry = path.join(installedRoot, "dist", "main.js");
  const mcpEntry = path.join(installedRoot, "dist", "mcp.js");
  const cliOutput = execFileSync(process.execPath, [cliEntry, "--json", "program", "catalog", "数学", "--limit", "1"], {
    cwd: tempDir,
    encoding: "utf8",
  });
  const envelope = JSON.parse(cliOutput);
  assert.equal(envelope.meta.source, "static");
  assert.equal(envelope.data.length, 1);

  const client = new Client({ name: "ustc-catalog-package-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntry],
    cwd: tempDir,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 22);
  } finally {
    await client.close().catch(() => undefined);
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("packed npm package smoke test passed");
