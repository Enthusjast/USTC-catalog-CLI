import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCli } from "../src/cli.js";

describe("CLI contract", () => {
  it("exposes all public resource command groups", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-cli-"));
    const { program, services } = buildCli({ cacheDir });
    expect(program.commands.map((command) => command.name())).toEqual([
      "semester",
      "department",
      "calendar",
      "course",
      "program",
      "lesson",
      "classroom",
      "exam",
      "substitute",
      "cache",
    ]);
    services.repository.close();
  });

  it("shows the product name together with the version", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-version-"));
    const { program, services } = buildCli({ cacheDir });
    expect(program.version()).toBe("USTC-catalog-CLI 0.2.0");
    services.repository.close();
  });
});
