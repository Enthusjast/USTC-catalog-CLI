import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  await Promise.all([
    chmod(fileURLToPath(new URL("../dist/main.js", import.meta.url)), 0o755),
    chmod(fileURLToPath(new URL("../dist/mcp.js", import.meta.url)), 0o755),
  ]);
}
