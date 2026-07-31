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
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  CourseValidationError,
  type CreateCourseInput,
  createCourse,
  getCourse,
  getCourseDocument,
  listCourses,
} from "../src/server/courses.ts";
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
