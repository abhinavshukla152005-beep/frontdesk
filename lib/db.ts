import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MIGRATIONS } from "./schema";
import { seedDemo } from "./seed";

export type Db = DatabaseSync;

function countClinics(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM clinics").get() as { n: number };
  return row.n;
}

function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = row.user_version;
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    db.exec("BEGIN");
    try {
      migration.run(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      version = migration.version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openDb(file: string, options: { seed?: boolean } = {}): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  if (options.seed !== false && countClinics(db) === 0) seedDemo(db);
  return db;
}

declare global {
  var __frontdeskDb: Db | undefined;
}

export function getDb(): Db {
  if (!globalThis.__frontdeskDb) {
    // Serverless platforms ship a read-only bundle; only the temp dir is writable.
    const fallback = process.env.VERCEL
      ? path.join(tmpdir(), "frontdesk.db")
      : path.join(process.cwd(), "data", "frontdesk.db");
    const file = process.env.DB_PATH || fallback;
    globalThis.__frontdeskDb = openDb(file);
  }
  return globalThis.__frontdeskDb;
}
