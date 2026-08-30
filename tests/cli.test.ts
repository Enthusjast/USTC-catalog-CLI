import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
    expect(program.version()).toBe("USTC-catalog-CLI 0.2.1");
    services.repository.close();
  });

  it("marks the built-in program catalog as static data", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-static-"));
    const { services } = buildCli({ cacheDir });
    const result = await services.program.catalog();
    expect(result.meta.source).toBe("static");
    services.repository.close();
  });

  it("deduplicates semester requests within one service lifetime", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-semesters-"));
    const { services } = buildCli({ cacheDir });
    const restricted = vi.spyOn(services.api, "restricted").mockResolvedValue({
      data: { restricted: false },
      status: 200,
      fetchedAt: "now",
      path: "/api/restricted",
    });
    const semesters = vi.spyOn(services.api, "semesters").mockResolvedValue({
      data: [{ id: 461, nameZh: "2026年秋季学期", code: "20261", start: "2026-08-30", end: "2027-01-15", isLast: true }],
      status: 200,
      fetchedAt: "now",
      path: "/api/teach/semester/list",
    });

    const options = { offline: false, noCache: true };
    await Promise.all([
      services.common.defaultSemester(options),
      services.common.semesterLabel(461, options),
    ]);

    expect(restricted).toHaveBeenCalledTimes(1);
    expect(semesters).toHaveBeenCalledTimes(1);
    services.repository.close();
  });
});
