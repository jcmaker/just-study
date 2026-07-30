# just-study Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost-only Next.js application that safely creates, stores, lists, and reads course shells using SQLite plus Markdown.

**Architecture:** One Next.js App Router process serves the UI and HTTP API. UI routes and API adapters call the same synchronous course service, which coordinates a direct-SQL SQLite repository and an atomic local-file store under `data/`.

**Tech Stack:** Node 22+, Next.js 16, React 19, TypeScript 5.9, `better-sqlite3`, Node standard `fs`/`crypto`/`test`, ESLint 9.

## Global Constraints

- Bind development and production servers to `127.0.0.1`; do not expose an external interface.
- Store all runtime data under `JUST_STUDY_DATA_DIR`, defaulting to `resolve(process.cwd(), "data")`.
- Use SQLite for structured course data and Markdown for long-form course content.
- Use `better-sqlite3` with WAL mode and foreign keys; do not add an ORM.
- Use direct TypeScript service calls from the UI and thin route handlers for HTTP; storage adapters are never called from UI or route code.
- Course titles are 1–120 trimmed characters, single-line; goals are 1–2,000 trimmed characters.
- Accept UUID request IDs only and enforce uniqueness in SQLite.
- Derive storage paths from server-generated UUID course IDs, never from titles or goals.
- Do not add research, 30-Day curriculum, quiz, MCP, PDF, scheduling, authentication, Docker, or multi-user code.
- Keep one integration test file: `tests/platform-foundation.test.ts`.

---

## File Map

### Project configuration

- `package.json`: exact runtime, scripts, and dependencies.
- `package-lock.json`: npm-resolved dependency lock.
- `tsconfig.json`: strict TypeScript and `.ts` import support for Node tests.
- `next-env.d.ts`: Next.js TypeScript declarations.
- `next.config.ts`: externalize the native SQLite driver.
- `eslint.config.mjs`: Next.js core-web-vitals and TypeScript lint rules.
- `.gitignore`: already ignores `data/`, `.superpowers/`, and `.DS_Store`; extend only for Next.js build artifacts and local environment files.

### Server modules

- `src/server/database.ts`: open SQLite, apply migrations, expose the schema version.
- `src/server/storage.ts`: safe path resolution, prepared Markdown writes, atomic course-directory finalize, checksums, read verification, and directory inspection.
- `src/server/courses.ts`: input validation, course CRUD reads, idempotent course creation, and DB/filesystem coordination.
- `src/server/health.ts`: DB, schema, write probe, temporary directory, and DB/filesystem mismatch checks.
- `src/server/runtime.ts`: one development-safe runtime containing the data root and nullable database handle.

### HTTP adapters

- `src/app/api/courses/route.ts`: list and create courses.
- `src/app/api/courses/[id]/route.ts`: retrieve one course and its Markdown.
- `src/app/api/health/route.ts`: return 200 for healthy or 503 for unhealthy.

### UI

- `src/app/layout.tsx`: root document and metadata.
- `src/app/globals.css`: minimal accessible layout and form styles.
- `src/app/actions.ts`: course creation server action.
- `src/app/course-form.tsx`: accessible pending/error form.
- `src/app/page.tsx`: create form and course list.
- `src/app/courses/[id]/page.tsx`: course details and Markdown text.
- `src/app/status/page.tsx`: health report.

### Verification and documentation

- `tests/platform-foundation.test.ts`: all service integration cases using temporary data roots.
- `README.md`: setup, commands, data location, localhost boundary, and current scope.

---

### Task 1: Bootstrap the project and SQLite schema

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Modify: `.gitignore`
- Create: `src/server/database.ts`
- Create: `tests/platform-foundation.test.ts`

**Interfaces:**

- Consumes: Node 22+ and npm.
- Produces:
  - `SCHEMA_VERSION: 1`
  - `type DatabaseHandle = Database.Database`
  - `openDatabase(dataRoot: string): DatabaseHandle`

- [ ] **Step 1: Add exact project configuration**

Create `package.json`:

```json
{
  "name": "just-study",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1",
    "build": "next build",
    "start": "next start --hostname 127.0.0.1",
    "lint": "eslint .",
    "test": "node --test tests/platform-foundation.test.ts"
  },
  "dependencies": {
    "better-sqlite3": "^12.4.1",
    "next": "^16.0.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^16.0.0",
    "typescript": "^5.9.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "allowImportingTsExtensions": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    ".next/types/**/*.ts",
    "**/*.ts",
    "**/*.tsx"
  ],
  "exclude": ["node_modules"]
}
```

Create `next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

Create `eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "node_modules/**", "data/**"]),
]);
```

Append these entries to `.gitignore`:

```gitignore
.next/
node_modules/
.env
.env.local
```

- [ ] **Step 2: Install dependencies and generate the lockfile**

Run:

```bash
npm install
npm ls --depth=0
```

Expected: `package-lock.json` is created and both commands exit 0.

- [ ] **Step 3: Write the failing database migration test**

Create `tests/platform-foundation.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the test and confirm the expected failure**

Run:

```bash
npm test
```

Expected: FAIL because `src/server/database.ts` does not exist.

- [ ] **Step 5: Implement SQLite opening and the first migration**

Create `src/server/database.ts`:

```ts
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
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
```

- [ ] **Step 6: Run the database test**

Run:

```bash
npm test
```

Expected: PASS `migrates an empty SQLite database`.

- [ ] **Step 7: Commit the bootstrap and schema**

```bash
git add .gitignore package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts eslint.config.mjs src/server/database.ts tests/platform-foundation.test.ts
git commit -m "feat: bootstrap just-study storage foundation"
```

---

### Task 2: Add safe and atomic Markdown storage

**Files:**

- Create: `src/server/storage.ts`
- Modify: `tests/platform-foundation.test.ts`

**Interfaces:**

- Consumes: server-generated UUID course IDs and a configured data root.
- Produces:
  - `type CourseDraft`
  - `prepareCourseFiles(dataRoot: string, courseId: string, markdown: string): CourseDraft`
  - `finalizeCourseFiles(draft: CourseDraft): void`
  - `discardCourseDraft(draft: CourseDraft): void`
  - `readVerifiedMarkdown(dataRoot: string, relativePath: string, sha256: string): string`
  - `listCourseDirectoryIds(dataRoot: string): string[]`
  - `listTemporaryEntries(dataRoot: string): string[]`
  - `probeStorageWritable(dataRoot: string): void`

- [ ] **Step 1: Add failing storage tests**

Add these imports and tests to `tests/platform-foundation.test.ts`:

```ts
import { existsSync, readFileSync, symlinkSync } from "node:fs";

import {
  finalizeCourseFiles,
  prepareCourseFiles,
  probeStorageWritable,
  readVerifiedMarkdown,
} from "../src/server/storage.ts";

test("prepares and atomically finalizes course Markdown", () => {
  const dataRoot = makeDataRoot();
  const courseId = "11111111-1111-4111-8111-111111111111";

  try {
    const draft = prepareCourseFiles(dataRoot, courseId, "# Test\n");
    assert.equal(existsSync(draft.tempDirectory), true);

    finalizeCourseFiles(draft);

    assert.equal(existsSync(draft.tempDirectory), false);
    assert.equal(readFileSync(draft.finalMarkdownPath, "utf8"), "# Test\n");
    assert.equal(
      readVerifiedMarkdown(dataRoot, draft.relativeMarkdownPath, draft.sha256),
      "# Test\n",
    );
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects a Markdown path outside the data root", () => {
  const dataRoot = makeDataRoot();

  try {
    assert.throws(
      () => readVerifiedMarkdown(dataRoot, "../outside.md", "0".repeat(64)),
      /outside the data root/,
    );
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects a symlinked temporary storage root", () => {
  const dataRoot = makeDataRoot();
  const outsideRoot = makeDataRoot();

  try {
    symlinkSync(outsideRoot, join(dataRoot, "tmp"), "dir");
    assert.throws(() => probeStorageWritable(dataRoot), /symbolic link/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run only the storage tests and confirm failure**

Run:

```bash
node --test --test-name-pattern="Markdown|outside|symlinked" tests/platform-foundation.test.ts
```

Expected: FAIL because `src/server/storage.ts` does not exist.

- [ ] **Step 3: Implement safe paths, atomic writes, checksums, and inspection**

Create `src/server/storage.ts`:

```ts
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";

export type CourseDraft = {
  tempDirectory: string;
  finalDirectory: string;
  finalMarkdownPath: string;
  relativeMarkdownPath: string;
  sha256: string;
};

function resolveInsideDataRoot(dataRoot: string, relativePath: string): string {
  const root = resolve(dataRoot);
  const target = resolve(root, relativePath);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Path is outside the data root");
  }

  return target;
}

function assertNotSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`Storage path must not be a symbolic link: ${path}`);
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function prepareCourseFiles(
  dataRoot: string,
  courseId: string,
  markdown: string,
): CourseDraft {
  const root = resolve(dataRoot);
  const coursesRoot = resolveInsideDataRoot(root, "courses");
  const temporaryRoot = resolveInsideDataRoot(root, "tmp");
  assertNotSymlink(root);
  assertNotSymlink(coursesRoot);
  assertNotSymlink(temporaryRoot);
  mkdirSync(coursesRoot, { recursive: true });
  mkdirSync(temporaryRoot, { recursive: true });

  const tempDirectory = join(temporaryRoot, `${courseId}-${randomUUID()}`);
  const finalDirectory = join(coursesRoot, courseId);
  const temporaryMarkdown = join(tempDirectory, "course.md.tmp");
  const finalMarkdownInTemp = join(tempDirectory, "course.md");
  const finalMarkdownPath = join(finalDirectory, "course.md");

  mkdirSync(tempDirectory, { recursive: false });
  try {
    writeFileSync(temporaryMarkdown, markdown, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryMarkdown, finalMarkdownInTemp);
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    tempDirectory,
    finalDirectory,
    finalMarkdownPath,
    relativeMarkdownPath: relative(root, finalMarkdownPath),
    sha256: sha256(markdown),
  };
}

export function finalizeCourseFiles(draft: CourseDraft): void {
  renameSync(draft.tempDirectory, draft.finalDirectory);
}

export function discardCourseDraft(draft: CourseDraft): void {
  if (existsSync(draft.tempDirectory)) {
    rmSync(draft.tempDirectory, { recursive: true, force: true });
  }
}

export function readVerifiedMarkdown(
  dataRoot: string,
  relativePath: string,
  expectedSha256: string,
): string {
  const path = resolveInsideDataRoot(dataRoot, relativePath);
  assertNotSymlink(dirname(path));
  assertNotSymlink(path);
  const content = readFileSync(path, "utf8");

  if (sha256(content) !== expectedSha256) {
    throw new Error("Markdown checksum mismatch");
  }

  return content;
}

export function listCourseDirectoryIds(dataRoot: string): string[] {
  const coursesRoot = resolveInsideDataRoot(dataRoot, "courses");
  if (!existsSync(coursesRoot)) return [];
  assertNotSymlink(coursesRoot);

  return readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listTemporaryEntries(dataRoot: string): string[] {
  const temporaryRoot = resolveInsideDataRoot(dataRoot, "tmp");
  if (!existsSync(temporaryRoot)) return [];
  assertNotSymlink(temporaryRoot);
  return readdirSync(temporaryRoot).sort();
}

export function probeStorageWritable(dataRoot: string): void {
  const temporaryRoot = resolveInsideDataRoot(dataRoot, "tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  assertNotSymlink(temporaryRoot);
  const probe = join(temporaryRoot, `.health-${randomUUID()}`);
  writeFileSync(probe, "ok", { encoding: "utf8", flag: "wx" });
  unlinkSync(probe);
}
```

- [ ] **Step 4: Run the storage and database tests**

Run:

```bash
npm test
```

Expected: all four tests PASS.

- [ ] **Step 5: Commit safe Markdown storage**

```bash
git add src/server/storage.ts tests/platform-foundation.test.ts
git commit -m "feat: add atomic course file storage"
```

---

### Task 3: Implement the idempotent course service

**Files:**

- Create: `src/server/courses.ts`
- Modify: `tests/platform-foundation.test.ts`

**Interfaces:**

- Consumes:
  - `DatabaseHandle`
  - storage draft/finalize/read functions
- Produces:
  - `type Course`
  - `type CourseDocument`
  - `type CreateCourseInput`
  - `class CourseValidationError`
  - `createCourse(db: DatabaseHandle, dataRoot: string, input: CreateCourseInput): { course: Course; created: boolean }`
  - `listCourses(db: DatabaseHandle): Course[]`
  - `getCourse(db: DatabaseHandle, id: string): Course | null`
  - `getCourseDocument(db: DatabaseHandle, dataRoot: string, id: string): CourseDocument | null`

- [ ] **Step 1: Add failing course service tests**

Add these imports and tests to `tests/platform-foundation.test.ts`:

```ts
import { writeFileSync } from "node:fs";

import {
  CourseValidationError,
  type CreateCourseInput,
  createCourse,
  getCourse,
  getCourseDocument,
  listCourses,
} from "../src/server/courses.ts";

test("creates one SQLite row and one Markdown document", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    const result = createCourse(db, dataRoot, {
      requestId: "11111111-1111-4111-8111-111111111111",
      title: "  TypeScript 기초  ",
      goal: "작은 프로그램을 직접 만든다.",
    });
    const document = getCourseDocument(db, dataRoot, result.course.id);

    assert.equal(result.created, true);
    assert.equal(listCourses(db).length, 1);
    assert.equal(document?.course.title, "TypeScript 기초");
    assert.match(document?.markdown ?? "", /작은 프로그램을 직접 만든다/);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("returns the same course for a repeated request ID", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const input = {
    requestId: "22222222-2222-4222-8222-222222222222",
    title: "SQLite",
    goal: "트랜잭션을 이해한다.",
  };

  try {
    const first = createCourse(db, dataRoot, input);
    const second = createCourse(db, dataRoot, input);

    assert.equal(first.course.id, second.course.id);
    assert.equal(second.created, false);
    assert.equal(listCourses(db).length, 1);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("does not leave a database row when file preparation fails", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  writeFileSync(join(dataRoot, "courses"), "not a directory");

  try {
    assert.throws(() =>
      createCourse(db, dataRoot, {
        requestId: "33333333-3333-4333-8333-333333333333",
        title: "Failure",
        goal: "저장 실패를 확인한다.",
      }),
    );
    assert.equal(listCourses(db).length, 0);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("persists a course after the database is reopened", () => {
  const dataRoot = makeDataRoot();
  let db = openDatabase(dataRoot);

  try {
    const created = createCourse(db, dataRoot, {
      requestId: "44444444-4444-4444-8444-444444444444",
      title: "Persistence",
      goal: "재시작 뒤 과정을 읽는다.",
    });
    db.close();
    db = openDatabase(dataRoot);

    assert.equal(getCourse(db, created.course.id)?.title, "Persistence");
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects invalid course input", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    assert.throws(
      () =>
        createCourse(db, dataRoot, {
          requestId: "not-a-uuid",
          title: "line one\nline two",
          goal: "",
        }),
      CourseValidationError,
    );
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("rejects runtime-invalid values before trimming", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);

  try {
    assert.throws(
      () =>
        createCourse(
          db,
          dataRoot,
          {
            requestId: "88888888-8888-4888-8888-888888888888",
            title: null,
            goal: [],
          } as unknown as CreateCourseInput,
        ),
      CourseValidationError,
    );
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the course tests and confirm failure**

Run:

```bash
node --test --test-name-pattern="course|request ID|database row|persists|invalid|trimming" tests/platform-foundation.test.ts
```

Expected: FAIL because `src/server/courses.ts` does not exist.

- [ ] **Step 3: Implement course validation, repository reads, and creation**

Create `src/server/courses.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { DatabaseHandle } from "./database.ts";
import {
  discardCourseDraft,
  finalizeCourseFiles,
  prepareCourseFiles,
  readVerifiedMarkdown,
} from "./storage.ts";

export type Course = {
  id: string;
  requestId: string;
  title: string;
  goal: string;
  markdownPath: string;
  markdownSha256: string;
  createdAt: string;
  updatedAt: string;
};

export type CourseDocument = {
  course: Course;
  markdown: string;
};

export type CreateCourseInput = {
  requestId: string;
  title: string;
  goal: string;
};

type CourseRow = {
  id: string;
  request_id: string;
  title: string;
  goal: string;
  markdown_path: string;
  markdown_sha256: string;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CourseValidationError extends Error {}

function rowToCourse(row: CourseRow): Course {
  return {
    id: row.id,
    requestId: row.request_id,
    title: row.title,
    goal: row.goal,
    markdownPath: row.markdown_path,
    markdownSha256: row.markdown_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeInput(input: CreateCourseInput): CreateCourseInput {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.requestId !== "string" ||
    typeof input.title !== "string" ||
    typeof input.goal !== "string"
  ) {
    throw new CourseValidationError("과정 요청 형식이 올바르지 않습니다.");
  }

  if (!UUID_PATTERN.test(input.requestId)) {
    throw new CourseValidationError("요청 ID가 올바른 UUID가 아닙니다.");
  }

  const title = input.title.trim();
  const goal = input.goal.trim();

  if (title.length < 1 || title.length > 120 || /[\r\n]/.test(title)) {
    throw new CourseValidationError("과정 제목은 줄바꿈 없이 1~120자여야 합니다.");
  }

  if (goal.length < 1 || goal.length > 2_000) {
    throw new CourseValidationError("학습 목표는 1~2,000자여야 합니다.");
  }

  return { requestId: input.requestId, title, goal };
}

function renderMarkdown(title: string, goal: string): string {
  const quotedGoal = goal
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `# ${title}\n\n## 학습 목표\n\n${quotedGoal}\n`;
}

function findByRequestId(db: DatabaseHandle, requestId: string): Course | null {
  const row = db
    .prepare("SELECT * FROM courses WHERE request_id = ?")
    .get(requestId) as CourseRow | undefined;
  return row ? rowToCourse(row) : null;
}

export function getCourse(db: DatabaseHandle, id: string): Course | null {
  const row = db
    .prepare("SELECT * FROM courses WHERE id = ?")
    .get(id) as CourseRow | undefined;
  return row ? rowToCourse(row) : null;
}

export function listCourses(db: DatabaseHandle): Course[] {
  return (
    db
      .prepare("SELECT * FROM courses ORDER BY created_at DESC, id ASC")
      .all() as CourseRow[]
  ).map(rowToCourse);
}

export function createCourse(
  db: DatabaseHandle,
  dataRoot: string,
  rawInput: CreateCourseInput,
): { course: Course; created: boolean } {
  const input = normalizeInput(rawInput);
  const existing = findByRequestId(db, input.requestId);
  if (existing) return { course: existing, created: false };

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const draft = prepareCourseFiles(dataRoot, id, renderMarkdown(input.title, input.goal));
  const insert = db.prepare(`
    INSERT INTO courses (
      id, request_id, title, goal, markdown_path, markdown_sha256, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    db.transaction(() => {
      insert.run(
        id,
        input.requestId,
        input.title,
        input.goal,
        draft.relativeMarkdownPath,
        draft.sha256,
        createdAt,
        createdAt,
      );
      finalizeCourseFiles(draft);
    })();
  } catch (error) {
    discardCourseDraft(draft);
    const duplicate = findByRequestId(db, input.requestId);
    if (duplicate) return { course: duplicate, created: false };
    throw error;
  }

  const course = getCourse(db, id);
  if (!course) throw new Error("Created course could not be read");
  return { course, created: true };
}

export function getCourseDocument(
  db: DatabaseHandle,
  dataRoot: string,
  id: string,
): CourseDocument | null {
  const course = getCourse(db, id);
  if (!course) return null;

  return {
    course,
    markdown: readVerifiedMarkdown(
      dataRoot,
      course.markdownPath,
      course.markdownSha256,
    ),
  };
}
```

- [ ] **Step 4: Run all integration tests**

Run:

```bash
npm test
```

Expected: all database, storage, course, idempotency, failure, restart, and validation tests PASS.

- [ ] **Step 5: Commit the course service**

```bash
git add src/server/courses.ts tests/platform-foundation.test.ts
git commit -m "feat: add idempotent course service"
```

---

### Task 4: Add health reporting and HTTP adapters

**Files:**

- Create: `src/server/health.ts`
- Create: `src/server/runtime.ts`
- Create: `src/app/api/health/route.ts`
- Create: `src/app/api/courses/route.ts`
- Create: `src/app/api/courses/[id]/route.ts`
- Modify: `tests/platform-foundation.test.ts`

**Interfaces:**

- Consumes: course service, SQLite handle, and storage inspection functions.
- Produces:
  - `type HealthReport`
  - `getHealth(db: DatabaseHandle | null, dataRoot: string): HealthReport`
  - `getRuntime(): { dataRoot: string; db: DatabaseHandle | null }`
  - `requireDatabase(runtime: Runtime): DatabaseHandle`
  - `GET /api/health`
  - `GET|POST /api/courses`
  - `GET /api/courses/:id`

- [ ] **Step 1: Add failing health tests**

Add these imports and tests to `tests/platform-foundation.test.ts`:

```ts
import { getHealth } from "../src/server/health.ts";

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
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reports a course directory missing from SQLite as an orphan", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const draft = prepareCourseFiles(
    dataRoot,
    "55555555-5555-4555-8555-555555555555",
    "# Orphan\n",
  );
  finalizeCourseFiles(draft);

  try {
    const health = getHealth(db, dataRoot);
    assert.equal(health.ok, false);
    assert.deepEqual(health.orphanCourseIds, [
      "55555555-5555-4555-8555-555555555555",
    ]);
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
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run health tests and confirm failure**

Run:

```bash
node --test --test-name-pattern="healthy|orphan|missing its directory|startup failure" tests/platform-foundation.test.ts
```

Expected: FAIL because `src/server/health.ts` does not exist.

- [ ] **Step 3: Implement health reporting**

Create `src/server/health.ts`:

```ts
import type { DatabaseHandle } from "./database.ts";
import { SCHEMA_VERSION } from "./database.ts";
import {
  listCourseDirectoryIds,
  listTemporaryEntries,
  probeStorageWritable,
} from "./storage.ts";

export type HealthReport = {
  ok: boolean;
  database: "ok" | "error";
  storage: "ok" | "error";
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  orphanCourseIds: string[];
  missingCourseIds: string[];
  temporaryEntries: string[];
};

export function getHealth(
  db: DatabaseHandle | null,
  dataRoot: string,
): HealthReport {
  let database: HealthReport["database"] = "ok";
  let storage: HealthReport["storage"] = "ok";
  let schemaVersion: number | null = null;
  let databaseIds: string[] = [];
  let courseDirectoryIds: string[] = [];
  let temporaryEntries: string[] = [];

  if (db) {
    try {
      db.prepare("SELECT 1").get();
      schemaVersion = db.pragma("user_version", { simple: true }) as number;
      databaseIds = (
        db.prepare("SELECT id FROM courses ORDER BY id").all() as Array<{ id: string }>
      ).map(({ id }) => id);
    } catch {
      database = "error";
    }
  } else {
    database = "error";
  }

  try {
    probeStorageWritable(dataRoot);
    courseDirectoryIds = listCourseDirectoryIds(dataRoot);
    temporaryEntries = listTemporaryEntries(dataRoot);
  } catch {
    storage = "error";
  }

  const canCompare = database === "ok" && storage === "ok";
  const known = new Set(databaseIds);
  const stored = new Set(courseDirectoryIds);
  const orphanCourseIds = canCompare
    ? courseDirectoryIds.filter((id) => !known.has(id))
    : [];
  const missingCourseIds = canCompare
    ? databaseIds.filter((id) => !stored.has(id))
    : [];
  const ok =
    database === "ok" &&
    storage === "ok" &&
    schemaVersion === SCHEMA_VERSION &&
    orphanCourseIds.length === 0 &&
    missingCourseIds.length === 0 &&
    temporaryEntries.length === 0;

  return {
    ok,
    database,
    storage,
    schemaVersion,
    expectedSchemaVersion: SCHEMA_VERSION,
    orphanCourseIds,
    missingCourseIds,
    temporaryEntries,
  };
}
```

- [ ] **Step 4: Run health tests**

Run:

```bash
npm test
```

Expected: all tests PASS, including healthy, orphan, missing-directory, and database-startup-failure reports.

- [ ] **Step 5: Add a hot-reload-safe runtime**

Create `src/server/runtime.ts`:

```ts
import { resolve } from "node:path";

import type { DatabaseHandle } from "./database.ts";
import { openDatabase } from "./database.ts";

export type Runtime = {
  dataRoot: string;
  db: DatabaseHandle | null;
};

const runtimeGlobal = globalThis as typeof globalThis & {
  __justStudyRuntime?: Runtime;
};

export function getRuntime(): Runtime {
  if (!runtimeGlobal.__justStudyRuntime) {
    const dataRoot = resolve(
      process.env.JUST_STUDY_DATA_DIR ?? resolve(process.cwd(), "data"),
    );
    let db: DatabaseHandle | null = null;

    try {
      db = openDatabase(dataRoot);
    } catch {
      // Health reporting must remain available when database startup fails.
    }

    runtimeGlobal.__justStudyRuntime = {
      dataRoot,
      db,
    };
  }

  return runtimeGlobal.__justStudyRuntime;
}

export function requireDatabase(runtime: Runtime): DatabaseHandle {
  if (!runtime.db) throw new Error("Database is unavailable");
  return runtime.db;
}
```

- [ ] **Step 6: Add thin API route handlers**

Create `src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getHealth } from "@/server/health";
import { getRuntime } from "@/server/runtime";

export function GET(): NextResponse {
  const { db, dataRoot } = getRuntime();
  const health = getHealth(db, dataRoot);
  return NextResponse.json(health, { status: health.ok ? 200 : 503 });
}
```

Create `src/app/api/courses/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import {
  CourseValidationError,
  type CreateCourseInput,
  createCourse,
  listCourses,
} from "@/server/courses";
import { getRuntime, requireDatabase } from "@/server/runtime";

export function GET(): NextResponse {
  const runtime = getRuntime();
  return NextResponse.json(listCourses(requireDatabase(runtime)));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = (await request.json()) as CreateCourseInput;
    const runtime = getRuntime();
    const result = createCourse(
      requireDatabase(runtime),
      runtime.dataRoot,
      input,
    );
    return NextResponse.json(result.course, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    if (error instanceof CourseValidationError || error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error:
            error instanceof CourseValidationError
              ? error.message
              : "요청 본문이 올바른 JSON이 아닙니다.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "과정을 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}
```

Create `src/app/api/courses/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getCourseDocument } from "@/server/courses";
import { getRuntime, requireDatabase } from "@/server/runtime";

export function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return context.params.then(({ id }) => {
    const runtime = getRuntime();
    const document = getCourseDocument(
      requireDatabase(runtime),
      runtime.dataRoot,
      id,
    );
    return document
      ? NextResponse.json(document)
      : NextResponse.json({ error: "과정을 찾을 수 없습니다." }, { status: 404 });
  });
}
```

- [ ] **Step 7: Type-check the adapters**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 8: Commit health and HTTP adapters**

```bash
git add src/server/health.ts src/server/runtime.ts src/app/api tests/platform-foundation.test.ts
git commit -m "feat: expose course and health APIs"
```

---

### Task 5: Add the minimal course and status UI

**Files:**

- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/actions.ts`
- Create: `src/app/course-form.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/courses/[id]/page.tsx`
- Create: `src/app/status/page.tsx`

**Interfaces:**

- Consumes: `createCourse`, `listCourses`, `getCourseDocument`, `getHealth`, and `getRuntime`.
- Produces: accessible localhost pages for course creation, course listing, course detail, and platform status.

- [ ] **Step 1: Build the API-only app and confirm the root page is absent**

Build, then start the production server in one terminal:

```bash
npm run build
npm run start
```

In a second terminal:

```bash
curl -i http://127.0.0.1:3000/
```

Expected: the build succeeds and `/` returns `404`. Stop the server before continuing.

- [ ] **Step 2: Add the root layout and minimal styles**

Create `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "just-study",
  description: "Agent-researched, self-hosted learning",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <header>
          <Link href="/">just-study</Link>
          <nav aria-label="주요 메뉴">
            <Link href="/">과정</Link>
            <Link href="/status">상태</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

Create `src/app/globals.css`:

```css
:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #172033;
  background: #f6f7fb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

header,
main {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto;
}

header {
  display: flex;
  justify-content: space-between;
  padding: 24px 0;
}

nav {
  display: flex;
  gap: 16px;
}

a {
  color: #3347b0;
}

section,
article {
  padding: 20px;
  margin-bottom: 16px;
  border: 1px solid #dfe3ee;
  border-radius: 12px;
  background: white;
}

label {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
  font-weight: 600;
}

input,
textarea,
button {
  font: inherit;
}

input,
textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid #aeb6ca;
  border-radius: 8px;
}

button {
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  color: white;
  background: #3347b0;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.error {
  color: #a51d2d;
}

pre {
  overflow-x: auto;
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Add the server action and accessible client form**

Create `src/app/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";

import {
  CourseValidationError,
  createCourse,
} from "@/server/courses";
import { getRuntime, requireDatabase } from "@/server/runtime";

export type CreateCourseState = { error: string | null };

export async function createCourseAction(
  _previous: CreateCourseState,
  formData: FormData,
): Promise<CreateCourseState> {
  const runtime = getRuntime();

  try {
    const result = createCourse(requireDatabase(runtime), runtime.dataRoot, {
      requestId: String(formData.get("requestId") ?? ""),
      title: String(formData.get("title") ?? ""),
      goal: String(formData.get("goal") ?? ""),
    });
    redirect(`/courses/${result.course.id}`);
  } catch (error) {
    if (error instanceof CourseValidationError) {
      return { error: error.message };
    }
    throw error;
  }
}
```

Create `src/app/course-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import {
  createCourseAction,
  type CreateCourseState,
} from "./actions";

const initialState: CreateCourseState = { error: null };

export function CourseForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(
    createCourseAction,
    initialState,
  );

  return (
    <form action={action}>
      <input type="hidden" name="requestId" value={requestId} />
      <label>
        과정 이름
        <input name="title" minLength={1} maxLength={120} required />
      </label>
      <label>
        30일 뒤 학습 목표
        <textarea name="goal" minLength={1} maxLength={2000} required rows={5} />
      </label>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "생성 중…" : "과정 만들기"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Add the course list and detail pages**

Create `src/app/page.tsx`:

```tsx
import { randomUUID } from "node:crypto";

import Link from "next/link";

import { listCourses } from "@/server/courses";
import { getRuntime, requireDatabase } from "@/server/runtime";

import { CourseForm } from "./course-form";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const runtime = getRuntime();
  const courses = listCourses(requireDatabase(runtime));

  return (
    <>
      <h1>과정</h1>
      <section>
        <h2>새 과정</h2>
        <CourseForm requestId={randomUUID()} />
      </section>
      <section>
        <h2>저장된 과정</h2>
        {courses.length === 0 ? (
          <p>아직 과정이 없습니다.</p>
        ) : (
          <ul>
            {courses.map((course) => (
              <li key={course.id}>
                <Link href={`/courses/${course.id}`}>{course.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
```

Create `src/app/courses/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

import { getCourseDocument } from "@/server/courses";
import { getRuntime, requireDatabase } from "@/server/runtime";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const runtime = getRuntime();
  const document = getCourseDocument(
    requireDatabase(runtime),
    runtime.dataRoot,
    id,
  );
  if (!document) notFound();

  return (
    <>
      <h1>{document.course.title}</h1>
      <article>
        <pre>{document.markdown}</pre>
      </article>
    </>
  );
}
```

- [ ] **Step 5: Add the status page**

Create `src/app/status/page.tsx`:

```tsx
import { getHealth } from "@/server/health";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  const { db, dataRoot } = getRuntime();
  const health = getHealth(db, dataRoot);

  return (
    <>
      <h1>상태</h1>
      <section>
        <dl>
          <dt>전체</dt>
          <dd>{health.ok ? "정상" : "확인 필요"}</dd>
          <dt>SQLite</dt>
          <dd>{health.database}</dd>
          <dt>저장소</dt>
          <dd>{health.storage}</dd>
          <dt>스키마</dt>
          <dd>
            {health.schemaVersion ?? "읽기 실패"} / {health.expectedSchemaVersion}
          </dd>
          <dt>고아 과정 폴더</dt>
          <dd>{health.orphanCourseIds.length}</dd>
          <dt>누락된 과정 폴더</dt>
          <dd>{health.missingCourseIds.length}</dd>
          <dt>임시 항목</dt>
          <dd>{health.temporaryEntries.length}</dd>
        </dl>
      </section>
    </>
  );
}
```

- [ ] **Step 6: Build, lint, and run tests**

Run:

```bash
npm run build
npm run lint
npm test
```

Expected: all three commands PASS.

Start the built app normally:

```bash
npm run start
```

Check the new root page from a second terminal:

```bash
curl -i http://127.0.0.1:3000/
```

Expected: `/` returns `200`. Stop the server.

Start the built app with an intentionally invalid data root:

```bash
JUST_STUDY_DATA_DIR="/dev/null/just-study" npm run start
```

In a second terminal:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/status
```

Expected: health returns `503`; `/status` returns `200` and includes `확인 필요`. Stop the server.

- [ ] **Step 7: Commit the minimal UI**

```bash
git add src/app
git commit -m "feat: add course and status pages"
```

---

### Task 6: Document and smoke-test the completed foundation

**Files:**

- Create: `README.md`
- Verify: all files from Tasks 1–5

**Interfaces:**

- Consumes: completed localhost app, APIs, test suite, and scripts.
- Produces: documented developer workflow and evidence that the complete vertical slice works.

- [ ] **Step 1: Write the project README**

Create `README.md`:

````markdown
# just-study

Agent-researched, self-hosted learning. The current foundation stores course
shells in SQLite and human-readable Markdown.

## Requirements

- Node.js 22 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. The scripts bind to localhost only.

## Verify

```bash
npm test
npm run lint
npm run build
```

## Data

Runtime data defaults to `./data` and is ignored by Git:

- `data/just-study.sqlite`: structured course records
- `data/courses/<course-id>/course.md`: long-form course Markdown

Set `JUST_STUDY_DATA_DIR` to use another local directory.

Do not copy only `just-study.sqlite` while the app is running in WAL mode.
Live backup is outside this phase. Stop the app before copying the `data`
directory.

## Current scope

This phase includes course shell creation, listing, reading, health checks,
atomic Markdown writes, and restart persistence. Research, the 30-Day learning
engine, MCP, PDF files, schedules, login, Docker, and multi-user support are
separate phases.
````

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Start the app with an isolated smoke-test data directory**

In one terminal:

```bash
JUST_STUDY_DATA_DIR="$(mktemp -d)" npm run dev
```

Expected: Next.js reports `http://127.0.0.1:3000`.

- [ ] **Step 4: Verify health and idempotent creation over HTTP**

In a second terminal:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i \
  -H 'content-type: application/json' \
  -d '{"requestId":"66666666-6666-4666-8666-666666666666","title":"Smoke Test","goal":"과정 저장을 확인한다."}' \
  http://127.0.0.1:3000/api/courses
curl -i \
  -H 'content-type: application/json' \
  -d '{"requestId":"66666666-6666-4666-8666-666666666666","title":"Smoke Test","goal":"과정 저장을 확인한다."}' \
  http://127.0.0.1:3000/api/courses
curl -i \
  -H 'content-type: application/json' \
  -d '{"requestId":7,"title":null,"goal":[]}' \
  http://127.0.0.1:3000/api/courses
curl -i \
  -H 'content-type: application/json' \
  -d '{"requestId":' \
  http://127.0.0.1:3000/api/courses
curl -sS http://127.0.0.1:3000/api/courses
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Expected:

- health returns `200`;
- the first create returns `201`;
- the repeated create returns `200`;
- both invalid bodies return `400`;
- the course list contains exactly one `Smoke Test`;
- `lsof` shows `127.0.0.1:3000`, not `*:3000`.

- [ ] **Step 5: Verify the browser flow**

Open <http://127.0.0.1:3000>, create one course, open its detail page, and open `/status`.

Expected:

- one course appears;
- detail shows the exact title and goal as Markdown text;
- status shows 정상, SQLite `ok`, storage `ok`, and zero orphan/missing/temp entries.

- [ ] **Step 6: Commit documentation and final verification state**

```bash
git add README.md
git commit -m "docs: document platform foundation"
git status --short
```

Expected: the worktree is clean.
