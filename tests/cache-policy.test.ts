import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DataAccessPolicy } from "../src/application/data-access-policy.js";
import { loadConfig } from "../src/infrastructure/config/paths.js";
import { SnapshotRepository } from "../src/infrastructure/cache/snapshot-repository.js";

const resources: SnapshotRepository[] = [];

afterEach(() => {
  for (const repository of resources.splice(0)) repository.close();
});

describe("DataAccessPolicy", () => {
  it("falls back to the latest cache after a network failure", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-test-"));
    const repository = new SnapshotRepository(loadConfig({ cacheDir }));
    resources.push(repository);
    const policy = new DataAccessPolicy(repository);

    const online = await policy.load(
      "test",
      "one",
      async () => ({ value: [{ id: 1 }], fetchedAt: "2026-08-26T00:00:00.000Z", status: 200, dataAsOf: "测试日期" }),
      { offline: false, noCache: false },
    );
    expect(online.value).toEqual([{ id: 1 }]);
    expect(online.meta.source).toBe("network");
    expect(online.meta.dataAsOf).toBe("测试日期");

    const fallback = await policy.load(
      "test",
      "one",
      async () => {
        throw new Error("offline");
      },
      { offline: false, noCache: false },
    );
    expect(fallback.value).toEqual([{ id: 1 }]);
    expect(fallback.meta.source).toBe("cache");
    expect(fallback.meta.stale).toBe(true);
    expect(fallback.meta.fetchedAt).toBe("2026-08-26T00:00:00.000Z");
  });

  it("reports a cache miss in offline mode", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-test-"));
    const repository = new SnapshotRepository(loadConfig({ cacheDir }));
    resources.push(repository);
    const policy = new DataAccessPolicy(repository);

    await expect(
      policy.load("test", "missing", async () => ({ value: 1 }), {
        offline: true,
        noCache: false,
      }),
    ).rejects.toMatchObject({ code: "CACHE_MISS" });
  });

  it("reports corrupted snapshots as cache errors", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-test-"));
    const repository = new SnapshotRepository(loadConfig({ cacheDir }));
    resources.push(repository);
    repository.write("test", "broken", "test:broken", { id: 1 });
    repository.database.db.prepare("UPDATE snapshots SET payload_json = ?, payload_encoding = 'identity'").run(Buffer.from("not-json"));
    try {
      repository.read("test", "broken");
      throw new Error("expected a cache error");
    } catch (error) {
      expect(error).toMatchObject({ code: "CACHE_ERROR" });
    }
  });
});
