import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const npmCli = process.env.npm_execpath;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ustc-catalog-package-smoke-"));
const packageDir = path.join(tempDir, "package");
fs.mkdirSync(packageDir);

const run = (args, options = {}) => {
  if (!npmCli) throw new Error("请通过 npm run package:smoke 启动此脚本，以便定位当前 npm CLI。");
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
};

try {
  const packed = JSON.parse(run(["pack", "--ignore-scripts", "--json", "--pack-destination", packageDir]));
  const packedMetadata = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  const tarball = packedMetadata?.filename;
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

  const installedRoot = path.join(tempDir, "node_modules", "ustc-catalog-cli");
  const cliEntry = path.join(installedRoot, "dist", "main.js");
  const mcpEntry = path.join(installedRoot, "dist", "mcp.js");
  const cliOutput = execFileSync(process.execPath, [cliEntry, "--json", "program", "catalog", "数学", "--limit", "1"], {
    cwd: tempDir,
    encoding: "utf8",
  });
  const envelope = JSON.parse(cliOutput);
  assert.equal(envelope.meta.source, "static");
  assert.equal(envelope.data.length, 1);

  const presetEnvironment = { ...process.env, XDG_CONFIG_HOME: path.join(tempDir, "config") };
  execFileSync(process.execPath, [cliEntry, "preset", "save", "静态目录", "--", "course", "categories"], {
    cwd: tempDir,
    env: presetEnvironment,
    stdio: "pipe",
  });
  const presetOutput = execFileSync(process.execPath, [cliEntry, "--json", "preset", "run", "静态目录"], {
    cwd: tempDir,
    env: presetEnvironment,
    encoding: "utf8",
  });
  assert.ok(JSON.parse(presetOutput).data.length > 0);
  assert.throws(() => execFileSync(process.execPath, [cliEntry, "--ics", "preset", "run", "静态目录"], {
    cwd: tempDir,
    env: presetEnvironment,
    stdio: "pipe",
  }), (error) => error.status === 2 && error.stderr.toString().includes("--ics 只适用于"));

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
    assert.equal(tools.tools.length, 33);
  } finally {
    await client.close().catch(() => undefined);
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("packed npm package smoke test passed");
