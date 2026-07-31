import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

export const SCHEMA_VERSION = 1;
export type DatabaseHandle = Database.Database;

const INITIAL_SCHEMA = `
  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
    goal TEXT NOT NULL CHECK(length(goal) BETWEEN 1 AND 2000),
    markdown_path TEXT NOT NULL UNIQUE,
    markdown_sha256 TEXT NOT NULL CHECK(length(markdown_sha256) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function migrateDatabase(db: DatabaseHandle): void {
  const current = db.pragma("user_version", { simple: true }) as number;

  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema ${current} is newer than supported ${SCHEMA_VERSION}`);
  }

  if (current === 0) {
    db.transaction(() => {
      db.exec(INITIAL_SCHEMA);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }
}

export function openDatabase(dataRoot: string): DatabaseHandle {
  mkdirSync(dataRoot, { recursive: true });
  const db = new Database(join(dataRoot, "just-study.sqlite"));

  try {
    const current = db.pragma("user_version", { simple: true }) as number;

    if (current > SCHEMA_VERSION) {
      throw new Error(`Database schema ${current} is newer than supported ${SCHEMA_VERSION}`);
    }

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
