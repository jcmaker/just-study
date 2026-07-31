import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { openDatabase, SCHEMA_VERSION } from "../src/server/database.ts";

function makeDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "just-study-"));
}

function databasePath(dataRoot: string): string {
  return join(dataRoot, "just-study.sqlite");
}

function coursesTable(db: Database.Database): { name: string } | undefined {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'courses'")
    .get() as { name: string } | undefined;
}

test("migrates an empty SQLite database", () => {
  const dataRoot = makeDataRoot();

  try {
    const db = openDatabase(dataRoot);
    try {
      assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
      assert.equal(coursesTable(db)?.name, "courses");
      assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
      assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    } finally {
      db.close();
    }
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects a newer schema without changing its database", () => {
  const dataRoot = makeDataRoot();
  const path = databasePath(dataRoot);
  const seeded = new Database(path);

  try {
    seeded.pragma("user_version = 2");
    seeded.pragma("journal_mode = DELETE");
  } finally {
    seeded.close();
  }

  try {
    assert.throws(
      () => openDatabase(dataRoot),
      /Database schema 2 is newer than supported 1/,
    );

    const db = new Database(path);
    try {
      assert.equal(db.pragma("user_version", { simple: true }), 2);
      assert.equal(db.pragma("journal_mode", { simple: true }), "delete");
      assert.equal(coursesTable(db), undefined);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rolls back a forced initial migration failure and closes the database", () => {
  const dataRoot = makeDataRoot();
  const path = databasePath(dataRoot);
  const originalPragma = Database.prototype.pragma;
  const originalClose = Database.prototype.close;
  let closed = false;

  Database.prototype.pragma = function (
    this: Database.Database,
    source: string,
    options?: Database.PragmaOptions,
  ): unknown {
    if (source === "user_version = 1") {
      throw new Error("forced migration failure");
    }

    return originalPragma.call(this, source, options);
  };
  Database.prototype.close = function (this: Database.Database): Database.Database {
    closed = true;
    return originalClose.call(this);
  };

  try {
    assert.throws(() => openDatabase(dataRoot), /forced migration failure/);
    assert.equal(closed, true);

    const db = new Database(path);
    try {
      assert.equal(db.pragma("user_version", { simple: true }), 0);
      assert.equal(coursesTable(db), undefined);
    } finally {
      db.close();
    }
  } finally {
    Database.prototype.pragma = originalPragma;
    Database.prototype.close = originalClose;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
