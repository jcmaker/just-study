import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase, SCHEMA_VERSION } from "../src/server/database.ts";

function makeDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "just-study-"));
}

test("migrates an empty SQLite database", () => {
  const dataRoot = makeDataRoot();

  try {
    const db = openDatabase(dataRoot);
    const version = db.pragma("user_version", { simple: true });
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'courses'")
      .get() as { name: string } | undefined;

    assert.equal(version, SCHEMA_VERSION);
    assert.equal(table?.name, "courses");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    db.close();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
