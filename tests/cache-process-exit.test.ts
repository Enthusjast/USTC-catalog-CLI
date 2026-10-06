import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const listen = (server: http.Server): Promise<number> => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") reject(new Error("test server did not bind a TCP port"));
    else resolve(address.port);
  });
});

describe("SQLite process shutdown", () => {
  it("exits cleanly after a real CLI query creates and closes its cache database", async () => {
    const server = http.createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/restricted") {
        response.end(JSON.stringify({ restricted: false }));
      } else if (request.url === "/api/teach/program/tree") {
        response.end(JSON.stringify({
          unit: {
            id: 1,
            code: "001",
            nameZh: "测试院系",
            majors: {
              major: {
                id: 2,
                code: "001001",
                nameZh: "测试专业",
                programs: [{ id: 3, grade: "2026", nameZh: "测试方案", trainType: "主修" }],
              },
            },
          },
        }));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    const cacheDir = await import("node:fs/promises").then(({ mkdtemp }) =>
      mkdtemp(path.join(os.tmpdir(), "catalog-cli-exit-cache-")));
    const port = await listen(server);
    const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));

    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", entry, "--json", "--no-cache", "program", "list"], {
          env: {
            ...process.env,
            CATALOG_BASE_URL: `http://127.0.0.1:${port}`,
            CATALOG_CACHE_DIR: cacheDir,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.once("error", reject);
        child.once("close", (code, signal) => {
          clearTimeout(timeout);
          resolve({
            code,
            signal,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        });
      });

      expect(result.signal).toBeNull();
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).data).toMatchObject([{ id: 3, name: "测试方案" }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await import("node:fs/promises").then(({ rm }) => rm(cacheDir, { recursive: true, force: true }));
    }
  }, 30_000);
});
