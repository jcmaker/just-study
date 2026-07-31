import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { openDatabase, SCHEMA_VERSION } from "../src/server/database.ts";
import {
  discardCourseDraft,
  finalizeCourseFiles,
  listCourseDirectoryIds,
  listTemporaryEntries,
  prepareCourseFiles,
  probeStorageWritable,
  readVerifiedMarkdown,
} from "../src/server/storage.ts";

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

const courseId = "11111111-1111-4111-8111-111111111111";

test("prepares and atomically finalizes course Markdown", () => {
  const dataRoot = makeDataRoot();

  try {
    const draft = prepareCourseFiles(dataRoot, courseId, "# Test\n");
    assert.equal(existsSync(draft.tempDirectory), true);
    assert.deepEqual(listCourseDirectoryIds(dataRoot), []);
    assert.equal(listTemporaryEntries(dataRoot).length, 1);

    finalizeCourseFiles(draft);

    assert.equal(existsSync(draft.tempDirectory), false);
    assert.equal(readFileSync(draft.finalMarkdownPath, "utf8"), "# Test\n");
    assert.equal(
      readVerifiedMarkdown(dataRoot, draft.relativeMarkdownPath, draft.sha256),
      "# Test\n",
    );
    assert.deepEqual(listCourseDirectoryIds(dataRoot), [courseId]);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects Markdown paths outside the data root", () => {
  const dataRoot = makeDataRoot();

  try {
    assert.throws(
      () => readVerifiedMarkdown(dataRoot, "../outside.md", "0".repeat(64)),
      /outside the data root/,
    );
    assert.throws(
      () => readVerifiedMarkdown(dataRoot, "courses/../../outside.md", "0".repeat(64)),
      /outside the data root/,
    );
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects malicious course IDs before creating storage paths", () => {
  const dataRoot = makeDataRoot();

  try {
    for (const id of ["../outside", "not-a-uuid", `${courseId}/other`]) {
      assert.throws(() => prepareCourseFiles(dataRoot, id, "# Test\n"), /course ID/);
    }
    assert.equal(existsSync(join(dataRoot, "courses")), false);
    assert.equal(existsSync(join(dataRoot, "tmp")), false);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects symlinked data and courses storage roots", () => {
  const parentRoot = makeDataRoot();
  const dataRoot = join(parentRoot, "data");
  const outsideRoot = makeDataRoot();

  try {
    symlinkSync(outsideRoot, dataRoot, "dir");
    assert.throws(() => prepareCourseFiles(dataRoot, courseId, "# Test\n"), /symbolic link/);

    rmSync(dataRoot);
    mkdirSync(dataRoot);
    symlinkSync(outsideRoot, join(dataRoot, "courses"), "dir");
    assert.throws(() => prepareCourseFiles(dataRoot, courseId, "# Test\n"), /symbolic link/);
  } finally {
    rmSync(parentRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("rejects symlinked temporary roots, course directories, and Markdown files", () => {
  const dataRoot = makeDataRoot();
  const outsideRoot = makeDataRoot();

  try {
    symlinkSync(outsideRoot, join(dataRoot, "tmp"), "dir");
    assert.throws(() => probeStorageWritable(dataRoot), /symbolic link/);

    rmSync(join(dataRoot, "tmp"));
    mkdirSync(join(dataRoot, "courses"), { recursive: true });
    symlinkSync(outsideRoot, join(dataRoot, "courses", courseId), "dir");
    assert.throws(() => prepareCourseFiles(dataRoot, courseId, "# Test\n"), /symbolic link/);

    rmSync(join(dataRoot, "courses", courseId));
    mkdirSync(join(dataRoot, "courses", courseId));
    symlinkSync(join(outsideRoot, "outside.md"), join(dataRoot, "courses", courseId, "course.md"));
    assert.throws(() => prepareCourseFiles(dataRoot, courseId, "# Test\n"), /symbolic link/);
    assert.throws(
      () => readVerifiedMarkdown(dataRoot, `courses/${courseId}/course.md`, "0".repeat(64)),
      /symbolic link/,
    );
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("rejects tampered Markdown with a checksum mismatch", () => {
  const dataRoot = makeDataRoot();

  try {
    const draft = prepareCourseFiles(dataRoot, courseId, "# Original\n");
    finalizeCourseFiles(draft);
    writeFileSync(draft.finalMarkdownPath, "# Tampered\n", "utf8");

    assert.throws(
      () => readVerifiedMarkdown(dataRoot, draft.relativeMarkdownPath, draft.sha256),
      /checksum mismatch/,
    );
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("cleans up a draft after a preparation failure", () => {
  const dataRoot = makeDataRoot();
  const temporaryRoot = join(dataRoot, "tmp");

  try {
    mkdirSync(temporaryRoot);
    chmodSync(temporaryRoot, 0o500);
    assert.throws(
      () => prepareCourseFiles(dataRoot, courseId, "# Test\n"),
      /Storage preparation failed/,
    );
    chmodSync(temporaryRoot, 0o700);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  } finally {
    chmodSync(temporaryRoot, 0o700);
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("leaves user final data and the draft intact when finalization fails", () => {
  const dataRoot = makeDataRoot();

  try {
    const draft = prepareCourseFiles(dataRoot, courseId, "# Test\n");
    mkdirSync(draft.finalDirectory);
    writeFileSync(draft.finalMarkdownPath, "# User data\n", "utf8");

    assert.throws(() => finalizeCourseFiles(draft), /Storage finalization failed/);
    assert.equal(existsSync(draft.tempDirectory), true);
    assert.equal(readFileSync(draft.finalMarkdownPath, "utf8"), "# User data\n");

    discardCourseDraft(draft);
    assert.equal(existsSync(draft.tempDirectory), false);
    assert.equal(readFileSync(draft.finalMarkdownPath, "utf8"), "# User data\n");
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("probes writable storage without leaving a temporary entry", () => {
  const dataRoot = makeDataRoot();

  try {
    probeStorageWritable(dataRoot);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
