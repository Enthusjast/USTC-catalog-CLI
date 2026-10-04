import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SnapshotRow = {
  resource: string;
  scopeKey: string;
  requestKey: string;
  fetchedAt: string;
  dataAsOf: string | null;
  httpStatus: number | null;
  payloadHash: string;
  payloadJson: Buffer;
  payloadEncoding: "identity" | "gzip";
  byteSize: number;
};

export type SnapshotStat = {
  resource: string;
  count: number;
  latestFetchedAt: string | null;
  bytes: number;
};

export class CacheDatabase {
  readonly db: Database.Database;

  constructor(public readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY,
        resource TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        request_key TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        data_as_of TEXT,
        http_status INTEGER,
        payload_hash TEXT NOT NULL,
        payload_json BLOB NOT NULL,
        byte_size INTEGER NOT NULL,
        UNIQUE(resource, scope_key)
      );
      CREATE INDEX IF NOT EXISTS snapshots_resource_scope
        ON snapshots(resource, scope_key);
      CREATE INDEX IF NOT EXISTS snapshots_fetched_at
        ON snapshots(fetched_at);
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(snapshots)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "payload_encoding")) {
      this.db.exec("ALTER TABLE snapshots ADD COLUMN payload_encoding TEXT NOT NULL DEFAULT 'identity'");
    }
  }

  get(resource: string, scopeKey: string): SnapshotRow | null {
    const row = this.db
      .prepare(
        `SELECT resource, scope_key as scopeKey, request_key as requestKey,
                fetched_at as fetchedAt, data_as_of as dataAsOf,
                http_status as httpStatus, payload_hash as payloadHash,
                payload_json as payloadJson, payload_encoding as payloadEncoding,
                byte_size as byteSize
           FROM snapshots
          WHERE resource = ? AND scope_key = ?`,
      )
      .get(resource, scopeKey) as SnapshotRow | undefined;
    return row ?? null;
  }

  put(row: SnapshotRow): void {
    this.db
      .prepare(
        `INSERT INTO snapshots
          (resource, scope_key, request_key, fetched_at, data_as_of,
           http_status, payload_hash, payload_json, payload_encoding, byte_size)
         VALUES (@resource, @scopeKey, @requestKey, @fetchedAt, @dataAsOf,
                 @httpStatus, @payloadHash, @payloadJson, @payloadEncoding, @byteSize)
         ON CONFLICT(resource, scope_key) DO UPDATE SET
           request_key = excluded.request_key,
           fetched_at = excluded.fetched_at,
           data_as_of = excluded.data_as_of,
           http_status = excluded.http_status,
           payload_hash = excluded.payload_hash,
           payload_json = excluded.payload_json,
           payload_encoding = excluded.payload_encoding,
           byte_size = excluded.byte_size`,
      )
      .run(row);
  }

  clear(resource?: string): number {
    if (resource) {
      return this.db.prepare("DELETE FROM snapshots WHERE resource = ?").run(resource)
        .changes;
    }
    return this.db.prepare("DELETE FROM snapshots").run().changes;
  }

  pruneBefore(fetchedAt: string, resource?: string): number {
    if (resource) {
      return this.db.prepare("DELETE FROM snapshots WHERE resource = ? AND fetched_at < ?").run(resource, fetchedAt).changes;
    }
    return this.db.prepare("DELETE FROM snapshots WHERE fetched_at < ?").run(fetchedAt).changes;
  }

  stats(): SnapshotStat[] {
    return this.db
      .prepare(
        `SELECT resource,
                COUNT(*) as count,
                MAX(fetched_at) as latestFetchedAt,
                COALESCE(SUM(byte_size), 0) as bytes
           FROM snapshots
          GROUP BY resource
          ORDER BY resource`,
      )
      .all() as SnapshotStat[];
  }

  totalBytes(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(byte_size), 0) as bytes FROM snapshots")
      .get() as { bytes: number };
    return row.bytes;
  }

  close(): void {
    this.db.close();
  }
}
