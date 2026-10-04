import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DataAccessPolicy } from "../src/application/data-access-policy.js";
import { loadConfig } from "../src/infrastructure/config/paths.js";
import { SnapshotRepository } from "../src/infrastructure/cache/snapshot-repository.js";
import { CliError } from "../src/domain/errors.js";

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
        throw new CliError("NETWORK_ERROR", "offline");
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

  it("does not hide remote contract errors behind stale cache", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-test-"));
    const repository = new SnapshotRepository(loadConfig({ cacheDir }));
    resources.push(repository);
    const policy = new DataAccessPolicy(repository);
    await policy.load("test", "remote-error", async () => ({ value: 1 }), {
      offline: false,
      noCache: false,
    });

    await expect(
      policy.load("test", "remote-error", async () => {
        throw new CliError("REMOTE_INVALID_DATA", "接口结构已变化。");
      }, { offline: false, noCache: false }),
    ).rejects.toMatchObject({ code: "REMOTE_INVALID_DATA" });
  });

  it("rejects a valid but tampered snapshot by its payload hash", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-test-"));
    const repository = new SnapshotRepository(loadConfig({ cacheDir }));
    resources.push(repository);
    repository.write("test", "tampered", "test:tampered", { id: 1 });
    repository.database.db
      .prepare("UPDATE snapshots SET payload_json = ?, payload_encoding = 'identity' WHERE resource = ? AND scope_key = ?")
      .run(Buffer.from(JSON.stringify({ id: 2 })), "test", "tampered");

    try {
      repository.read("test", "tampered");
      throw new Error("expected a cache integrity error");
    } catch (error) {
      expect(error).toMatchObject({ code: "CACHE_ERROR" });
    }
  });

  it("ignores a corrupted snapshot when an online refresh succeeds", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-test-"));
    const repository = new SnapshotRepository(loadConfig({ cacheDir }));
    resources.push(repository);
    repository.write("test", "refresh", "test:refresh", { id: 1 });
    repository.database.db
      .prepare("UPDATE snapshots SET payload_json = ?, payload_encoding = 'identity' WHERE resource = ? AND scope_key = ?")
      .run(Buffer.from(JSON.stringify({ id: 2 })), "test", "refresh");

    const policy = new DataAccessPolicy(repository);
    const result = await policy.load("test", "refresh", async () => ({
      value: { id: 3 },
      fetchedAt: "2026-08-30T00:00:00.000Z",
    }), { offline: false, noCache: false });

    expect(result.value).toEqual({ id: 3 });
    expect(result.meta.source).toBe("network");
    expect(repository.read("test", "refresh")?.value).toEqual({ id: 3 });
  });

  it("prunes snapshots older than a timestamp while keeping recent rows", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-cli-test-"));
    const repository = new SnapshotRepository(loadConfig({ cacheDir }));
    resources.push(repository);
    repository.write("lessons", "old", "lessons:old", { id: 1 }, 200, null, "2026-01-01T00:00:00.000Z");
    repository.write("lessons", "new", "lessons:new", { id: 2 }, 200, null, "2026-09-01T00:00:00.000Z");

    expect(repository.database.pruneBefore("2026-08-01T00:00:00.000Z")).toBe(1);
    expect(repository.read("lessons", "old")).toBeNull();
    expect(repository.read("lessons", "new")?.value).toEqual({ id: 2 });
  });
});
