import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { GET as getCourseRoute } from "../src/app/api/courses/[id]/route.ts";
import {
  GET as listCoursesRoute,
  POST as createCourseRoute,
} from "../src/app/api/courses/route.ts";
import { GET as getHealthRoute } from "../src/app/api/health/route.ts";
import {
  CourseValidationError,
  type CreateCourseInput,
  createCourse,
  getCourse,
  getCourseDocument,
  listCourses,
} from "../src/server/courses.ts";
import { openDatabase, SCHEMA_VERSION } from "../src/server/database.ts";
import { getHealth } from "../src/server/health.ts";
import { getRuntime, requireDatabase } from "../src/server/runtime.ts";
import {
  discardCourseDraft,
  finalizeCourseFiles,
  listCourseDirectoryIds,
  listTemporaryEntries,
  prepareCourseFiles,
  probeStorageWritable,
  readVerifiedMarkdown,
} from "../src/server/storage.ts";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", shortCircuit: true, source: "" };
    }
    if (url.endsWith(".tsx")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});

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

test("cleans up a created draft when its Markdown write fails", { concurrency: false }, () => {
  const dataRoot = makeDataRoot();
  const temporaryRoot = join(dataRoot, "tmp");
  const coursesRoot = join(dataRoot, "courses");

  try {
    mkdirSync(temporaryRoot);
    mkdirSync(coursesRoot);
    const originalUmask = process.umask(0o222);
    try {
      assert.throws(
        () => prepareCourseFiles(dataRoot, courseId, "# Test\n"),
        /Storage preparation failed/,
      );
    } finally {
      process.umask(originalUmask);
    }
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
    assert.equal(existsSync(join(coursesRoot, courseId)), false);
  } finally {
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

test("keeps the draft when an atomic final rename fails", () => {
  const dataRoot = makeDataRoot();
  const coursesRoot = join(dataRoot, "courses");

  try {
    const draft = prepareCourseFiles(dataRoot, courseId, "# Test\n");
    chmodSync(coursesRoot, 0o500);
    try {
      assert.throws(() => finalizeCourseFiles(draft), /Storage finalization failed/);
    } finally {
      chmodSync(coursesRoot, 0o700);
    }

    assert.equal(existsSync(draft.tempDirectory), true);
    assert.equal(existsSync(draft.finalDirectory), false);
    discardCourseDraft(draft);
    assert.equal(existsSync(draft.tempDirectory), false);
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

test("creates one SQLite row and one Markdown document", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const result = createCourse(db, dataRoot, {
      requestId: "11111111-1111-4111-8111-111111111111",
      title: "  TypeScript 기초  ",
      goal: "  작은 프로그램을 직접 만든다.  ",
    });
    const document = getCourseDocument(db, dataRoot, result.course.id);

    assert.equal(result.created, true);
    assert.equal(listCourses(db).length, 1);
    assert.equal(document?.course.title, "TypeScript 기초");
    assert.equal(document?.course.goal, "작은 프로그램을 직접 만든다.");
    assert.equal(
      document?.markdown,
      "# TypeScript 기초\n\n## 학습 목표\n\n> 작은 프로그램을 직접 만든다\\.\n",
    );
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("uses request ID as the idempotency identity even when repeated payload differs", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const requestId = "22222222-2222-4222-8222-222222222222";

  try {
    const first = createCourse(db, dataRoot, {
      requestId,
      title: "SQLite",
      goal: "트랜잭션을 이해한다.",
    });
    const second = createCourse(db, dataRoot, {
      requestId,
      title: "Changed title",
      goal: "Changed goal",
    });

    assert.equal(first.course.id, second.course.id);
    assert.equal(second.created, false);
    assert.equal(second.course.title, "SQLite");
    assert.equal(second.course.goal, "트랜잭션을 이해한다.");
    assert.equal(listCourses(db).length, 1);
    assert.deepEqual(listCourseDirectoryIds(dataRoot), [first.course.id]);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rethrows a non-request error when a request duplicate appears after lookup", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const requestId = "29999999-9999-4999-8999-999999999999";
  const originalTransaction = db.transaction;
  const forcedError = new Error("forced non-request failure");

  db.transaction = (() => () => {
    originalTransaction.call(db, () => {
      db.prepare(`
        INSERT INTO courses (
          id, request_id, title, goal, markdown_path, markdown_sha256, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          requestId,
          "Concurrent winner",
          "먼저 저장된 과정을 사용한다.",
          "courses/concurrent/course.md",
          "0".repeat(64),
          "2026-07-31T00:00:00.000Z",
          "2026-07-31T00:00:00.000Z",
        );
    })();
    throw forcedError;
  }) as unknown as typeof db.transaction;

  try {
    assert.equal(listCourses(db).length, 0);
    assert.throws(
      () =>
        createCourse(db, dataRoot, {
          requestId,
          title: "Losing request",
          goal: "원래 오류가 보존되는지 확인한다.",
        }),
      (error) => error === forcedError,
    );
    assert.equal(listCourses(db).length, 1);
  } finally {
    db.transaction = originalTransaction;
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("escapes user Markdown while preserving the fixed document structure", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const title = "<!-- # heading -->";
  const goal = '# heading\n> quote\n<!-- comment -->\n<script>alert("x")</script>';

  try {
    const created = createCourse(db, dataRoot, {
      requestId: "33333333-3333-4333-8333-333333333333",
      title,
      goal,
    });
    const stored = getCourse(db, created.course.id);

    assert.equal(created.course.title, title);
    assert.equal(created.course.goal, goal);
    assert.equal(stored?.title, title);
    assert.equal(stored?.goal, goal);
    assert.equal(
      getCourseDocument(db, dataRoot, created.course.id)?.markdown,
      "# \\<\\!\\-\\- \\# heading \\-\\-\\>\n\n" +
        "## 학습 목표\n\n" +
        "> \\# heading\n" +
        "> \\> quote\n" +
        "> \\<\\!\\-\\- comment \\-\\-\\>\n" +
        '> \\<script\\>alert\\(\\"x\\"\\)\\<\\/script\\>\n',
    );
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("accepts exact minimum and maximum trimmed course input boundaries", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const minimum = createCourse(db, dataRoot, {
      requestId: "44444444-4444-4444-8444-444444444444",
      title: " x ",
      goal: " y ",
    });
    const maximum = createCourse(db, dataRoot, {
      requestId: "55555555-5555-4555-8555-555555555555",
      title: ` ${"t".repeat(120)} `,
      goal: ` ${"g".repeat(2_000)} `,
    });

    assert.equal(minimum.course.title.length, 1);
    assert.equal(minimum.course.goal.length, 1);
    assert.equal(maximum.course.title.length, 120);
    assert.equal(maximum.course.goal.length, 2_000);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects empty, over-limit, and multiline course input boundaries", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const invalidInputs: CreateCourseInput[] = [
    {
      requestId: "61111111-1111-4111-8111-111111111111",
      title: "   ",
      goal: "goal",
    },
    {
      requestId: "62222222-2222-4222-8222-222222222222",
      title: "title",
      goal: "   ",
    },
    {
      requestId: "63333333-3333-4333-8333-333333333333",
      title: "t".repeat(121),
      goal: "goal",
    },
    {
      requestId: "64444444-4444-4444-8444-444444444444",
      title: "title",
      goal: "g".repeat(2_001),
    },
    {
      requestId: "65555555-5555-4555-8555-555555555555",
      title: "line one\nline two",
      goal: "goal",
    },
    {
      requestId: "66666666-6666-4666-8666-666666666666",
      title: "line one\rline two",
      goal: "goal",
    },
  ];

  try {
    for (const input of invalidInputs) {
      assert.throws(() => createCourse(db, dataRoot, input), CourseValidationError);
    }
    assert.equal(listCourses(db).length, 0);
    assert.equal(existsSync(join(dataRoot, "courses")), false);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects runtime-invalid values and malformed UUIDs before storage access", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const invalidInputs = [
    null,
    {
      requestId: "77777777-7777-4777-8777-777777777777",
      title: null,
      goal: "goal",
    },
    {
      requestId: "77777777-7777-4777-8777-777777777777",
      title: "title",
      goal: [],
    },
    { requestId: "not-a-uuid", title: "title", goal: "goal" },
    {
      requestId: "77777777-7777-0777-8777-777777777777",
      title: "title",
      goal: "goal",
    },
    {
      requestId: "77777777-7777-4777-7777-777777777777",
      title: "title",
      goal: "goal",
    },
  ] as unknown as CreateCourseInput[];

  try {
    for (const input of invalidInputs) {
      assert.throws(() => createCourse(db, dataRoot, input), CourseValidationError);
    }
    assert.equal(listCourses(db).length, 0);
    assert.equal(existsSync(join(dataRoot, "courses")), false);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rolls back the database when the actual Markdown write fails", { concurrency: false }, () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  mkdirSync(join(dataRoot, "courses"));
  mkdirSync(join(dataRoot, "tmp"));

  try {
    const originalUmask = process.umask(0o222);
    try {
      assert.throws(
        () =>
          createCourse(db, dataRoot, {
            requestId: "81111111-1111-4111-8111-111111111111",
            title: "Write failure",
            goal: "실제 파일 쓰기 실패를 확인한다.",
          }),
        /Storage preparation failed/,
      );
    } finally {
      process.umask(originalUmask);
    }

    assert.equal(listCourses(db).length, 0);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
    assert.deepEqual(listCourseDirectoryIds(dataRoot), []);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rolls back the database and draft when the actual final directory rename fails", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const coursesRoot = join(dataRoot, "courses");
  mkdirSync(coursesRoot);
  mkdirSync(join(dataRoot, "tmp"));

  try {
    chmodSync(coursesRoot, 0o500);
    try {
      assert.throws(
        () =>
          createCourse(db, dataRoot, {
            requestId: "82222222-2222-4222-8222-222222222222",
            title: "Rename failure",
            goal: "실제 최종 이동 실패를 확인한다.",
          }),
        /Storage finalization failed/,
      );
    } finally {
      chmodSync(coursesRoot, 0o700);
    }

    assert.equal(listCourses(db).length, 0);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
    assert.deepEqual(listCourseDirectoryIds(dataRoot), []);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("preserves a finalized orphan and the original error when SQLite COMMIT fails", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  db.exec(`
    CREATE TABLE course_commit_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE course_commit_gate (
      course_id TEXT NOT NULL,
      missing_parent INTEGER NOT NULL,
      FOREIGN KEY (missing_parent) REFERENCES course_commit_parent(id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TRIGGER fail_course_commit
    AFTER INSERT ON courses
    BEGIN
      INSERT INTO course_commit_gate (course_id, missing_parent) VALUES (NEW.id, 1);
    END;
  `);

  try {
    let failure: unknown;
    try {
      createCourse(db, dataRoot, {
        requestId: "83333333-3333-4333-8333-333333333333",
        title: "Commit failure",
        goal: "커밋 실패 뒤 orphan을 확인한다.",
      });
    } catch (error) {
      failure = error;
    }

    assert.match((failure as Error)?.message ?? "", /FOREIGN KEY constraint failed/);
    assert.equal(listCourses(db).length, 0);
    assert.equal(listCourseDirectoryIds(dataRoot).length, 1);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reopens the database and verifies the persisted Markdown checksum", () => {
  const dataRoot = makeDataRoot();
  let db = openDatabase(dataRoot);

  try {
    const created = createCourse(db, dataRoot, {
      requestId: "84444444-4444-4444-8444-444444444444",
      title: "Persistence",
      goal: "재시작 뒤 과정과 체크섬을 읽는다.",
    });
    db.close();
    db = openDatabase(dataRoot);

    const document = getCourseDocument(db, dataRoot, created.course.id);
    assert.equal(document?.course.title, "Persistence");
    assert.equal(
      document?.markdown,
      "# Persistence\n\n## 학습 목표\n\n> 재시작 뒤 과정과 체크섬을 읽는다\\.\n",
    );
    assert.equal(
      createHash("sha256").update(document?.markdown ?? "", "utf8").digest("hex"),
      document?.course.markdownSha256,
    );
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("returns null for a missing course and document", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const missingId = "99999999-9999-4999-8999-999999999999";

  try {
    assert.equal(getCourse(db, missingId), null);
    assert.equal(getCourseDocument(db, dataRoot, missingId), null);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports a healthy database and writable storage", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, true);
    assert.equal(health.database, "ok");
    assert.equal(health.storage, "ok");
    assert.equal(health.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(health.orphanCourseIds, []);
    assert.deepEqual(health.missingCourseIds, []);
    assert.deepEqual(health.corruptCourseIds, []);
    assert.match(health.message, /정상/);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports a course directory missing from SQLite as an orphan", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const orphanId = "55555555-5555-4555-8555-555555555555";
  const draft = prepareCourseFiles(dataRoot, orphanId, "# Orphan\n");
  finalizeCourseFiles(draft);

  try {
    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, false);
    assert.deepEqual(health.orphanCourseIds, [orphanId]);
    assert.match(health.message, /복구/);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("does not accuse courses when course directory inventory fails", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const created = createCourse(db, dataRoot, {
      requestId: "56666666-6666-4666-8666-666666666666",
      title: "Inventory failure",
      goal: "과정 목록 검사 실패를 안전하게 보고한다.",
    });
    symlinkSync(
      join(dataRoot, "courses", created.course.id),
      join(dataRoot, "courses", "unrelated"),
    );
    writeFileSync(join(dataRoot, "tmp", "unfinished"), "partial", "utf8");
    assert.throws(
      () => listCourseDirectoryIds(dataRoot),
      /symbolic link/,
    );

    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, false);
    assert.equal(health.storage, "error");
    assert.deepEqual(health.orphanCourseIds, []);
    assert.deepEqual(health.missingCourseIds, []);
    assert.deepEqual(health.corruptCourseIds, []);
    assert.deepEqual(health.temporaryEntries, ["unfinished"]);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports a SQLite course missing its directory", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const created = createCourse(db, dataRoot, {
      requestId: "77777777-7777-4777-8777-777777777777",
      title: "Missing files",
      goal: "누락된 과정 폴더를 감지한다.",
    });
    rmSync(join(dataRoot, "courses", created.course.id), {
      recursive: true,
      force: true,
    });

    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, false);
    assert.deepEqual(health.missingCourseIds, [created.course.id]);
    assert.deepEqual(health.corruptCourseIds, []);
    assert.match(health.message, /복구/);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports tampered course Markdown as corrupt", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const created = createCourse(db, dataRoot, {
      requestId: "78888888-8888-4888-8888-888888888888",
      title: "Checksum",
      goal: "변조된 과정 문서를 감지한다.",
    });
    writeFileSync(join(dataRoot, created.course.markdownPath), "# Tampered\n", "utf8");

    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, false);
    assert.deepEqual(health.corruptCourseIds, [created.course.id]);
    assert.match(health.message, /복구/);
    assert.equal(health.message.includes(dataRoot), false);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports a course whose database row points at the wrong Markdown path", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const created = createCourse(db, dataRoot, {
      requestId: "79999999-9999-4999-8999-999999999999",
      title: "Path check",
      goal: "과정 문서 경로 연결을 검증한다.",
    });
    const originalPath = join(dataRoot, created.course.markdownPath);
    const wrongRelativePath = `courses/${created.course.id}/other.md`;
    writeFileSync(
      join(dataRoot, wrongRelativePath),
      readFileSync(originalPath, "utf8"),
      "utf8",
    );
    db.prepare("UPDATE courses SET markdown_path = ? WHERE id = ?").run(
      wrongRelativePath,
      created.course.id,
    );

    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, false);
    assert.deepEqual(health.corruptCourseIds, [created.course.id]);
    assert.match(health.message, /복구/);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports schema and temporary-entry recovery states", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    mkdirSync(join(dataRoot, "tmp"), { recursive: true });
    writeFileSync(join(dataRoot, "tmp", "unfinished"), "partial", "utf8");

    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, false);
    assert.equal(health.schemaVersion, SCHEMA_VERSION + 1);
    assert.deepEqual(health.temporaryEntries, ["unfinished"]);
    assert.match(health.message, /데이터베이스|스키마/);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports database startup failure while still checking storage", () => {
  const dataRoot = makeDataRoot();

  try {
    const health = getHealth(null, dataRoot);
    assert.equal(health.ok, false);
    assert.equal(health.database, "error");
    assert.equal(health.storage, "ok");
    assert.equal(health.schemaVersion, null);
    assert.match(health.message, /데이터베이스|스키마|권한/);
    assert.equal(health.message.includes(dataRoot), false);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports storage failure with safe permission guidance", () => {
  const parentRoot = makeDataRoot();
  const dataRoot = join(parentRoot, "not-a-directory");
  writeFileSync(dataRoot, "blocked", "utf8");

  try {
    const health = getHealth(null, dataRoot);
    assert.equal(health.ok, false);
    assert.equal(health.database, "error");
    assert.equal(health.storage, "error");
    assert.match(health.message, /저장소|권한/);
    assert.equal(health.message.includes(dataRoot), false);
  } finally {
    rmSync(parentRoot, { recursive: true, force: true });
  }
});

type TestRuntimeGlobal = typeof globalThis & {
  __justStudyRuntime?: ReturnType<typeof getRuntime>;
};

function clearTestRuntime(): void {
  delete (globalThis as TestRuntimeGlobal).__justStudyRuntime;
}

function setTestRuntime(
  dataRoot: string,
  db: Database.Database | null,
): void {
  (globalThis as TestRuntimeGlobal).__justStudyRuntime = { dataRoot, db };
}

function restoreDataRootEnvironment(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.JUST_STUDY_DATA_DIR;
  } else {
    process.env.JUST_STUDY_DATA_DIR = previous;
  }
}

test("keeps one hot-reload-safe runtime for the configured data root", () => {
  const dataRoot = makeDataRoot();
  const previous = process.env.JUST_STUDY_DATA_DIR;
  process.env.JUST_STUDY_DATA_DIR = dataRoot;
  clearTestRuntime();

  try {
    const first = getRuntime();
    const second = getRuntime();
    assert.equal(first, second);
    assert.equal(first.dataRoot, resolve(dataRoot));
    assert.equal(requireDatabase(first).open, true);
  } finally {
    (globalThis as TestRuntimeGlobal).__justStudyRuntime?.db?.close();
    clearTestRuntime();
    restoreDataRootEnvironment(previous);
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("keeps runtime and storage health available after database startup failure", () => {
  const dataRoot = makeDataRoot();
  const seeded = new Database(databasePath(dataRoot));
  const previous = process.env.JUST_STUDY_DATA_DIR;
  seeded.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
  seeded.close();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;
  clearTestRuntime();

  try {
    const runtime = getRuntime();
    const health = getHealth(runtime.db, runtime.dataRoot);
    assert.equal(runtime.dataRoot, resolve(dataRoot));
    assert.equal(runtime.db, null);
    assert.equal(health.database, "error");
    assert.equal(health.storage, "ok");
    assert.throws(() => requireDatabase(runtime), /Database is unavailable/);
  } finally {
    clearTestRuntime();
    restoreDataRootEnvironment(previous);
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

function assertSafeBody(
  body: unknown,
  dataRoot: string,
): void {
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(dataRoot), false);
  assert.equal(serialized.includes("Error:"), false);
  assert.equal(serialized.includes("\n    at "), false);
}

test("health route returns 200 for healthy runtime", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const response = getHealthRoute();
    const body = (await response.json()) as { ok: boolean; message: string };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.match(body.message, /정상/);
    assertSafeBody(body, dataRoot);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("health route returns 503 for corrupt Markdown", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const created = createCourse(db, dataRoot, {
    requestId: "90000000-0000-4000-8000-000000000001",
    title: "Corrupt health",
    goal: "손상 상태를 HTTP 실패로 보고한다.",
  });
  writeFileSync(join(dataRoot, created.course.markdownPath), "# broken\n", "utf8");
  setTestRuntime(dataRoot, db);

  try {
    const response = getHealthRoute();
    const body = (await response.json()) as {
      ok: boolean;
      corruptCourseIds: string[];
    };
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.deepEqual(body.corruptCourseIds, [created.course.id]);
    assertSafeBody(body, dataRoot);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("health route remains callable when the database is unavailable", async () => {
  const dataRoot = makeDataRoot();
  setTestRuntime(dataRoot, null);

  try {
    const response = getHealthRoute();
    const body = (await response.json()) as {
      database: string;
      storage: string;
      message: string;
    };
    assert.equal(response.status, 503);
    assert.equal(body.database, "error");
    assert.equal(body.storage, "ok");
    assert.match(body.message, /데이터베이스|스키마|권한/);
    assertSafeBody(body, dataRoot);
  } finally {
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses GET returns the course list", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const created = createCourse(db, dataRoot, {
    requestId: "90000000-0000-4000-8000-000000000002",
    title: "List API",
    goal: "목록 API를 확인한다.",
  });
  setTestRuntime(dataRoot, db);

  try {
    const response = listCoursesRoute();
    const body = (await response.json()) as Array<{ id: string; title: string }>;
    assert.equal(response.status, 200);
    assert.deepEqual(body.map(({ id }) => id), [created.course.id]);
    assert.equal(body[0]?.title, "List API");
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses POST returns 201 then 200 for an idempotent replay", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const input = {
    requestId: "90000000-0000-4000-8000-000000000003",
    title: "Create API",
    goal: "과정 생성 API를 확인한다.",
  };
  setTestRuntime(dataRoot, db);

  try {
    const first = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    const firstBody = (await first.json()) as { id: string };
    const replay = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(input),
      }),
    );
    const replayBody = (await replay.json()) as { id: string };

    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replayBody.id, firstBody.id);
    assert.equal(listCourses(db).length, 1);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses POST rejects text/plain without mutating storage", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const response = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({
          requestId: "90000000-0000-4000-8000-000000000020",
          title: "Wrong media type",
          goal: "JSON이 아닌 요청은 저장하지 않는다.",
        }),
      }),
    );

    assert.equal(response.status, 415);
    assert.equal(listCourses(db).length, 0);
    assert.deepEqual(listCourseDirectoryIds(dataRoot), []);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses POST rejects cross-site JSON without mutating storage", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const response = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({
          requestId: "90000000-0000-4000-8000-000000000021",
          title: "Cross-site request",
          goal: "교차 사이트 요청은 저장하지 않는다.",
        }),
      }),
    );

    assert.equal(response.status, 403);
    assert.equal(listCourses(db).length, 0);
    assert.deepEqual(listCourseDirectoryIds(dataRoot), []);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses POST returns 400 for validation failure", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const response = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "not-a-uuid",
          title: "",
          goal: "",
        }),
      }),
    );
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /요청 ID|과정|목표/);
    assert.equal(listCourses(db).length, 0);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses POST returns 400 for malformed JSON", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const response = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{broken",
      }),
    );
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /JSON/);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses POST returns safe 503 when the database is unavailable", async () => {
  const dataRoot = makeDataRoot();
  setTestRuntime(dataRoot, null);

  try {
    const response = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "90000000-0000-4000-8000-000000000004",
          title: "Unavailable",
          goal: "데이터베이스 실패를 확인한다.",
        }),
      }),
    );
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 503);
    assert.match(body.error, /데이터베이스|스키마|권한/);
    assertSafeBody(body, dataRoot);
  } finally {
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("courses POST returns safe 500 for storage failure", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  writeFileSync(join(dataRoot, "courses"), `private path: ${dataRoot}`, "utf8");
  setTestRuntime(dataRoot, db);

  try {
    const response = await createCourseRoute(
      new Request("http://127.0.0.1/api/courses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "90000000-0000-4000-8000-000000000005",
          title: "Storage failure",
          goal: "저장 실패를 확인한다.",
        }),
      }),
    );
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 500);
    assert.match(body.error, /저장|권한|다시/);
    assertSafeBody(body, dataRoot);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("course detail GET returns 200 or 404", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const created = createCourse(db, dataRoot, {
    requestId: "90000000-0000-4000-8000-000000000006",
    title: "Detail API",
    goal: "상세 API를 확인한다.",
  });
  setTestRuntime(dataRoot, db);

  try {
    const found = await getCourseRoute(new Request("http://127.0.0.1"), {
      params: Promise.resolve({ id: created.course.id }),
    });
    const foundBody = (await found.json()) as {
      course: { id: string };
      markdown: string;
    };
    const missing = await getCourseRoute(new Request("http://127.0.0.1"), {
      params: Promise.resolve({
        id: "99999999-9999-4999-8999-999999999999",
      }),
    });

    assert.equal(found.status, 200);
    assert.equal(foundBody.course.id, created.course.id);
    assert.match(foundBody.markdown, /Detail API/);
    assert.equal(missing.status, 404);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("course detail GET returns safe 500 for corrupt Markdown", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const created = createCourse(db, dataRoot, {
    requestId: "90000000-0000-4000-8000-000000000007",
    title: "Corrupt detail",
    goal: "손상 상세 응답을 확인한다.",
  });
  writeFileSync(
    join(dataRoot, created.course.markdownPath),
    `# leaked ${dataRoot}\n`,
    "utf8",
  );
  setTestRuntime(dataRoot, db);

  try {
    const response = await getCourseRoute(new Request("http://127.0.0.1"), {
      params: Promise.resolve({ id: created.course.id }),
    });
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 500);
    assert.match(body.error, /읽|복구|다시/);
    assertSafeBody(body, dataRoot);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI layout renders Korean language and semantic navigation", async () => {
  const { default: RootLayout } = await import("../src/app/layout.tsx");
  const html = renderToStaticMarkup(
    createElement(
      RootLayout,
      null,
      createElement("p", null, "본문"),
    ),
  );

  assert.match(html, /^<html lang="ko">/);
  assert.match(html, /<nav aria-label="주요 메뉴">/);
  assert.match(html, /href="\/">과정<\/a>/);
  assert.match(html, /href="\/status">상태<\/a>/);
  assert.match(html, /<main>.*본문.*<\/main>/);
});

function makeCourseFormData(
  requestId: string,
  title: string,
  goal: string,
): FormData {
  const formData = new FormData();
  formData.set("requestId", requestId);
  formData.set("title", title);
  formData.set("goal", goal);
  return formData;
}

test("UI form renders labels, limits, alert, and pending state", async () => {
  const { CourseFormView } = await import("../src/app/course-form.tsx");
  const html = renderToStaticMarkup(
    createElement(CourseFormView, {
      action: "/",
      pending: true,
      requestId: "90000000-0000-4000-8000-000000000010",
      state: { error: "과정 제목은 줄바꿈 없이 1~120자여야 합니다." },
    }),
  );

  assert.match(html, /과정 이름/);
  assert.match(html, /name="title"/);
  assert.match(html, /minLength="1"/);
  assert.match(html, /maxLength="120"/);
  assert.match(html, /30일 뒤 학습 목표/);
  assert.match(html, /name="goal"/);
  assert.match(html, /maxLength="2000"/);
  assert.match(html, /required=""/);
  assert.match(html, /role="alert"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /생성 중…/);
});

test("UI action keeps title and goal validation field-specific", async () => {
  const { createCourseAction } = await import("../src/app/actions.ts");
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const title = await createCourseAction(
      { error: null },
      makeCourseFormData(
        "90000000-0000-4000-8000-000000000011",
        "첫 줄\n둘째 줄",
        "목표",
      ),
    );
    const goal = await createCourseAction(
      { error: null },
      makeCourseFormData(
        "90000000-0000-4000-8000-000000000012",
        "과정",
        "g".repeat(2_001),
      ),
    );

    assert.match(title.error ?? "", /과정 제목.*1~120자/);
    assert.match(goal.error ?? "", /학습 목표.*2,000자/);
    assert.equal(listCourses(db).length, 0);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI action returns safe status guidance when storage fails", async () => {
  const { createCourseAction } = await import("../src/app/actions.ts");
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  writeFileSync(join(dataRoot, "courses"), `private path: ${dataRoot}`, "utf8");
  setTestRuntime(dataRoot, db);

  try {
    const state = await createCourseAction(
      { error: null },
      makeCourseFormData(
        "90000000-0000-4000-8000-000000000013",
        "저장 실패",
        "안전한 안내를 확인한다.",
      ),
    );

    assert.match(state.error ?? "", /저장.*\/status.*다시/);
    assert.equal((state.error ?? "").includes(dataRoot), false);
    assert.equal(listCourses(db).length, 0);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI action redirects only after the course is persisted", async () => {
  const { createCourseAction } = await import("../src/app/actions.ts");
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    await assert.rejects(
      () =>
        createCourseAction(
          { error: null },
          makeCourseFormData(
            "90000000-0000-4000-8000-000000000014",
            "저장 뒤 이동",
            "저장된 뒤에만 상세 화면으로 이동한다.",
          ),
        ),
      (error) =>
        error instanceof Error &&
        "digest" in error &&
        String(error.digest).startsWith("NEXT_REDIRECT;"),
    );
    assert.equal(listCourses(db).length, 1);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI root renders an empty state and then a saved course link", async () => {
  const { default: HomePage } = await import("../src/app/page.tsx");
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const emptyHtml = renderToStaticMarkup(createElement(HomePage));
    assert.match(emptyHtml, /아직 저장된 과정이 없습니다/);

    const created = createCourse(db, dataRoot, {
      requestId: "90000000-0000-4000-8000-000000000015",
      title: "웹 서비스 기초",
      goal: "요청과 응답을 설명한다.",
    });
    const listHtml = renderToStaticMarkup(createElement(HomePage));
    assert.match(listHtml, /웹 서비스 기초/);
    assert.match(listHtml, new RegExp(`href="/courses/${created.course.id}"`));
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI root renders safe recovery guidance when the database is unavailable", async () => {
  const { default: HomePage } = await import("../src/app/page.tsx");
  const dataRoot = makeDataRoot();
  setTestRuntime(dataRoot, null);

  try {
    const html = renderToStaticMarkup(createElement(HomePage));
    assert.match(html, /데이터베이스|저장소|상태/);
    assert.match(html, /href="\/status"/);
    assert.equal(html.includes("<form"), false);
    assert.equal(html.includes("새 과정"), false);
    assertSafeBody(html, dataRoot);
  } finally {
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI detail renders exact title and verified Markdown as text", async () => {
  const { default: CoursePage } = await import(
    "../src/app/courses/[id]/page.tsx"
  );
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const created = createCourse(db, dataRoot, {
    requestId: "90000000-0000-4000-8000-000000000016",
    title: "<웹> & API",
    goal: "요청 > 응답을 그대로 설명한다.",
  });
  setTestRuntime(dataRoot, db);

  try {
    const html = renderToStaticMarkup(
      await CoursePage({ params: Promise.resolve({ id: created.course.id }) }),
    );
    assert.match(html, /<h1>&lt;웹&gt; &amp; API<\/h1>/);
    assert.match(html, /# \\&lt;웹\\&gt; \\&amp; API/);
    assert.match(html, /요청 \\&gt; 응답을 그대로 설명한다\\\./);
    assert.equal(html.includes("<script>"), false);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI missing page gives a Korean recovery path", async () => {
  const { default: NotFound } = await import("../src/app/not-found.tsx");
  const html = renderToStaticMarkup(createElement(NotFound));

  assert.match(html, /과정을 찾을 수 없습니다/);
  assert.match(html, /href="\/">과정 목록으로 돌아가기<\/a>/);
});

test("UI status explains healthy and recovery-needed states with all counts", async () => {
  const { default: StatusPage } = await import("../src/app/status/page.tsx");
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  try {
    const healthy = renderToStaticMarkup(createElement(StatusPage));
    assert.match(healthy, /정상/);
    assert.match(healthy, /시스템이 정상입니다/);
    for (const label of [
      "데이터베이스",
      "스키마",
      "저장소",
      "고아 과정",
      "누락 과정",
      "손상 과정",
      "임시 항목",
    ]) {
      assert.match(healthy, new RegExp(label));
    }

    const corrupt = createCourse(db, dataRoot, {
      requestId: "90000000-0000-4000-8000-000000000018",
      title: "손상 상태",
      goal: "손상 개수를 확인한다.",
    });
    const missing = createCourse(db, dataRoot, {
      requestId: "90000000-0000-4000-8000-000000000019",
      title: "누락 상태",
      goal: "누락 개수를 확인한다.",
    });
    writeFileSync(
      join(dataRoot, corrupt.course.markdownPath),
      "# changed\n",
      "utf8",
    );
    rmSync(join(dataRoot, "courses", missing.course.id), {
      recursive: true,
      force: true,
    });
    mkdirSync(
      join(dataRoot, "courses", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
    mkdirSync(join(dataRoot, "tmp", "recovery-entry"));

    const inconsistent = renderToStaticMarkup(createElement(StatusPage));
    assert.match(inconsistent, /확인 필요/);
    assert.match(inconsistent, /저장 데이터가 일치하지 않습니다/);
    for (const label of ["고아 과정", "누락 과정", "손상 과정", "임시 항목"]) {
      assert.match(inconsistent, new RegExp(`<dt>${label}</dt><dd>1개</dd>`));
    }

    db.close();
    setTestRuntime(dataRoot, null);
    const unhealthy = renderToStaticMarkup(createElement(StatusPage));
    assert.match(unhealthy, /확인 필요/);
    assert.match(unhealthy, /데이터베이스 파일, 스키마 및 권한을 확인/);
    assert.match(unhealthy, /조치 방법/);
  } finally {
    if (db.open) db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("UI detail renders safe recovery guidance for checksum damage", async () => {
  const { default: CoursePage } = await import(
    "../src/app/courses/[id]/page.tsx"
  );
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const created = createCourse(db, dataRoot, {
    requestId: "90000000-0000-4000-8000-000000000017",
    title: "손상된 과정",
    goal: "손상 화면을 확인한다.",
  });
  writeFileSync(
    join(dataRoot, created.course.markdownPath),
    `# private ${dataRoot}\n`,
    "utf8",
  );
  setTestRuntime(dataRoot, db);

  try {
    const html = renderToStaticMarkup(
      await CoursePage({ params: Promise.resolve({ id: created.course.id }) }),
    );
    assert.match(html, /과정 데이터를 확인할 수 없습니다/);
    assert.match(html, /href="\/status">상태에서 복구 방법 확인하기<\/a>/);
    assert.equal(html.includes(dataRoot), false);
    assert.equal(html.includes("손상된 과정"), false);
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
