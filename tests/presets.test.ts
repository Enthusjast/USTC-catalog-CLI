import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PresetStore } from "../src/infrastructure/config/presets.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const createStore = async (): Promise<PresetStore> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-cli-preset-"));
  dirs.push(dir);
  return new PresetStore(dir);
};

describe("query presets", () => {
  it("saves, lists, replaces, and deletes a read-only query", async () => {
    const store = await createStore();
    const saved = await store.save("数学课", ["lesson", "list", "--semester", "461", "--course", "数学"]);
    expect(saved.args).toEqual(["lesson", "list", "--semester", "461", "--course", "数学"]);
    const scheduled = await store.save("时间筛选", [
      "lesson", "list", "--semester", "461", "--class-type", "计划内与自由选修", "--weekday", "1", "--period", "3", "--week", "1-5,7-10",
    ]);
    expect(scheduled.args).toContain("--class-type");
    const options = await store.save("筛选选项", ["lesson", "options", "--semester", "461"]);
    expect(options.args).toEqual(["lesson", "options", "--semester", "461"]);
    expect((await store.list()).map((preset) => preset.name)).toEqual(expect.arrayContaining(["数学课", "时间筛选", "筛选选项"]));
    await expect(store.save("数学课", ["semester", "list"])).rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    await expect(store.save("坏预设", ["cache", "clear"])).rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    await expect(store.save("改路预设", ["course", "search", "数学", "--cache-dir", "/tmp/other"]))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    await store.save("数学课", ["semester", "list"], true);
    expect((await store.get("数学课")).args).toEqual(["semester", "list"]);
    await store.delete("时间筛选");
    await store.delete("筛选选项");
    expect(await store.delete("数学课")).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it("rejects a malformed preset file with a configuration error", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-cli-preset-corrupt-"));
    dirs.push(dir);
    await fs.writeFile(path.join(dir, "presets.json"), JSON.stringify({ broken: { args: "not-an-array" } }));
    const store = new PresetStore(dir);
    await expect(store.list()).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});
