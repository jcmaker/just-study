# just-study Codex Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing learning services through a localhost-only Streamable HTTP MCP endpoint and ship an explicit `$just-study` Codex skill that can create, research, teach, assess, remediate, resume, and complete a 30-Day course.

**Architecture:** A stateless official MCP v2 handler runs inside the existing Next.js process at `/mcp`, so MCP, HTTP APIs, and the later dashboard share one SQLite/Markdown owner through `getRuntime()`. The MCP adapter validates transport and JSON boundaries, delegates every domain rule to existing services, and returns compact structured results; the instruction-only repo skill owns web research and conversation flow.

**Tech Stack:** Node.js >=22.23.1, Next.js 16, TypeScript 5.9, SQLite/Markdown services, `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/client` 2.0.0, Zod 4.4.3, Node test runner, Codex CLI 0.144.1+

## Global Constraints

- Read `docs/superpowers/specs/2026-07-31-just-study-codex-connection-design.md` before each task and do not expand its scope.
- Start execution in an isolated `codex/codex-connection` worktree created with the `using-git-worktrees` skill; never copy the user's uncommitted documents into it.
- Pin `@modelcontextprotocol/server` and `zod` as exact production dependencies and `@modelcontextprotocol/client` as an exact development dependency; do not add a framework, YAML/TOML parser, auth library, or test framework.
- Keep the endpoint exactly `http://127.0.0.1:3000/mcp`, the MCP server ID exactly `just-study`, and the skill exactly `.agents/skills/just-study`.
- Keep `npm run dev` and `npm start` bound to `127.0.0.1`; never add `0.0.0.0`, login, accounts, OAuth, tokens, CORS, or remote access.
- Accept only local Host/Origin values, only POST, `application/json`, and at most 8 MiB while reading the body stream; reject the request before MCP parsing or service mutation.
- The server must not call an LLM, web search, SQL from the adapter, arbitrary files, paths supplied by callers, or shell commands.
- All state-changing tools delegate to existing service functions. `create_course` is idempotent through `requestId`; every other write requires the caller's exact `expectedRevision` and is never silently retried.
- Return `VALIDATION`, `STATE`, `REVISION_CONFLICT`, `STORAGE_CORRUPT`, `UNAVAILABLE`, or `INTERNAL`; never return stack traces, SQL, absolute paths, raw filesystem/database errors, environment values, or secrets.
- Mark only `health`, `list_courses`, `get_learning_state`, and `read_learning_document` read-only. Mark no tool open-world; the Codex skill, not the server, performs web research.
- Keep the skill instruction-only. Do not add skill scripts, references, assets, README files, plugin manifests, Claude support, resources, prompts, notifications, subscriptions, or MCP sessions.
- Use strict TDD for every behavior: observe the focused RED failure, make the minimum implementation GREEN, run the full current suite, inspect the diff, then commit only the task files.
- Preserve the existing user-owned modified/untracked documents. Do not use destructive Git commands, push, create a PR, deploy, or write secrets.
- A task passes review only with Critical 0 and Important 0. The phase passes only at >=95/100: product behavior 30, protocol/data integrity 20, security/error safety 20, skill intent 15, regression/operations 10, simplicity 5.

## File Map

**Create**

- `.codex/config.toml` — trusted-project Streamable HTTP registration and write approval policy.
- `.agents/skills/just-study/SKILL.md` — explicit learning workflow, web-source rules, stage routing, and recovery behavior.
- `.agents/skills/just-study/agents/openai.yaml` — UI metadata, explicit-only invocation policy, and `just-study` MCP dependency.
- `src/server/mcp.ts` — server factory, schemas, compact serializers, tool registrations, and safe error mapping.
- `src/app/mcp/route.ts` — localhost request boundary, bounded streaming body, and delegation to the official MCP handler.
- `tests/mcp.test.ts` — service seam, protocol, tool, security, restart, and 30-Day acceptance tests.
- `tests/codex-skill.test.ts` — filesystem-only static skill/config contract tests.

**Modify**

- `package.json`, `package-lock.json` — exact MCP/Zod packages and inclusion of both new test files in `npm test`.
- `src/server/storage.ts` — export the existing `StorageError` class without changing storage behavior.
- `src/server/learning.ts` — add one fixed-enum verified document reader; no arbitrary paths.
- `README.md` — MCP/skill setup, localhost/no-login boundary, commands, and verified acceptance behavior.

**Do not create**

- A standalone MCP process, proxy, auth/session layer, schema package, test helper framework, skill script/reference folder, or second data-access layer.

---

### Task 1: Safe service seams and MCP server foundation

**Files:**

- Create: `src/server/mcp.ts`
- Create: `tests/mcp.test.ts`
- Modify: `src/server/storage.ts:66`
- Modify: `src/server/learning.ts:22-43,798-817`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: `getRuntime(): Runtime`, `requireDatabase(runtime): DatabaseHandle`, `getHealth(db, dataRoot): HealthReport`, existing domain error classes, `getCourse`, and `readVerifiedMarkdown`.
- Produces: `LearningDocumentName`, `getLearningDocument(db, dataRoot, courseId, document)`, `McpErrorCode`, `McpFailure`, `CompactCourse`, `CompactLearningState`, `compactCourse(course)`, `compactLearningState(snapshot)`, `createJustStudyMcpServer(): McpServer`, and `mcpHandler.fetch(request): Promise<Response>`.

- [ ] **Step 1: Install the exact protocol dependencies**

Run:

```bash
npm install --save-exact @modelcontextprotocol/server@2.0.0 zod@4.4.3
npm install --save-dev --save-exact @modelcontextprotocol/client@2.0.0
```

Expected: `package.json` contains `"@modelcontextprotocol/server": "2.0.0"`, `"zod": "4.4.3"`, and dev dependency `"@modelcontextprotocol/client": "2.0.0"`; the lockfile resolves the same versions.

- [ ] **Step 2: Add the focused test file to the full runner and write failing foundation tests**

Change the test script to:

```json
"test": "node --test tests/platform-foundation.test.ts tests/learning-engine.test.ts tests/mcp.test.ts"
```

Create `tests/mcp.test.ts` with Node's existing import style and these first contracts:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CourseValidationError, createCourse } from "../src/server/courses.ts";
import { openDatabase } from "../src/server/database.ts";
import {
  getLearningDocument,
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  type LearningDocumentName,
} from "../src/server/learning.ts";
import {
  createJustStudyMcpServer,
  mcpHandler,
  toMcpFailure,
} from "../src/server/mcp.ts";
import { DatabaseUnavailableError } from "../src/server/runtime.ts";
import { StorageError } from "../src/server/storage.ts";

function makeDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "just-study-mcp-"));
}

test("reads only a named verified learning document", () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  try {
    const course = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "자료구조",
      goal: "핵심 자료구조를 설명하고 선택한다.",
    }).course;
    const document: LearningDocumentName = "course";
    assert.match(getLearningDocument(db, dataRoot, course.id, document)!.markdown, /자료구조/);
    assert.equal(getLearningDocument(db, dataRoot, course.id, "progress"), null);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("maps known failures without leaking raw internals", () => {
  assert.deepEqual(toMcpFailure(new CourseValidationError("bad title")), {
    ok: false,
    error: { code: "VALIDATION", message: "bad title", retryable: false },
  });
  assert.equal(toMcpFailure(new LearningValidationError("bad lesson")).error.code, "VALIDATION");
  assert.equal(toMcpFailure(new LearningStateError("wrong stage")).error.code, "STATE");
  assert.equal(toMcpFailure(new LearningRevisionConflictError("raw conflict")).error.code, "REVISION_CONFLICT");
  const unavailable = toMcpFailure(new DatabaseUnavailableError("raw database failure"));
  assert.equal(unavailable.error.code, "UNAVAILABLE");
  assert.equal(unavailable.error.retryable, true);
  assert.equal(JSON.stringify(unavailable).includes("raw database"), false);
  const storage = toMcpFailure(new StorageError("/private/data/course.md checksum mismatch"));
  assert.equal(storage.error.code, "STORAGE_CORRUPT");
  assert.equal(JSON.stringify(storage).includes("/private/data"), false);
  const internal = toMcpFailure(new Error("SQLITE failure at /secret/path"));
  assert.equal(internal.error.code, "INTERNAL");
  assert.equal(JSON.stringify(internal).includes("SQLITE"), false);
});

test("creates an official MCP server with a health tool", () => {
  assert.equal(typeof createJustStudyMcpServer().registerTool, "function");
  assert.equal(typeof mcpHandler.fetch, "function");
});
```

- [ ] **Step 3: Run the focused test and observe RED**

Run: `node --test tests/mcp.test.ts`

Expected: FAIL because `StorageError`, `getLearningDocument`, and `src/server/mcp.ts` exports do not exist.

- [ ] **Step 4: Expose the existing storage signal and add the fixed document reader**

In `src/server/storage.ts`, change only the declaration:

```ts
export class StorageError extends Error {}
```

In `src/server/learning.ts`, add:

```ts
export type LearningDocumentName = "course" | "progress" | "journal" | "current-day";

export type LearningDocument = {
  course: Course;
  document: LearningDocumentName;
  markdown: string;
};

export function getLearningDocument(
  db: DatabaseHandle,
  dataRoot: string,
  courseId: string,
  document: LearningDocumentName,
): LearningDocument | null {
  const course = getCourse(db, courseId);
  if (!course) return null;
  const registration = {
    course: [course.markdownPath, course.markdownSha256],
    progress: [course.progressMarkdownPath, course.progressMarkdownSha256],
    journal: [course.journalMarkdownPath, course.journalMarkdownSha256],
    "current-day": [course.currentDayMarkdownPath, course.currentDayMarkdownSha256],
  } as const;
  const [path, checksum] = registration[document];
  if (path === null && checksum === null) return null;
  if (path === null || checksum === null) {
    throw new LearningStateError("Document registration is incomplete");
  }
  return { course, document, markdown: readVerifiedMarkdown(dataRoot, path, checksum) };
}
```

Do not accept a path, filename, or unchecked string in this service.

- [ ] **Step 5: Implement the minimal MCP factory, common schemas, serializers, and safe errors**

Create `src/server/mcp.ts` around this concrete shape:

```ts
import {
  createMcpHandler,
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { CourseValidationError, type Course } from "./courses.ts";
import { getHealth } from "./health.ts";
import {
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  type LearningSnapshot,
} from "./learning.ts";
import { DatabaseUnavailableError, getRuntime } from "./runtime.ts";
import { StorageError } from "./storage.ts";

export type McpErrorCode =
  | "VALIDATION"
  | "STATE"
  | "REVISION_CONFLICT"
  | "STORAGE_CORRUPT"
  | "UNAVAILABLE"
  | "INTERNAL";

export type McpFailure = {
  ok: false;
  error: { code: McpErrorCode; message: string; retryable: boolean };
};

export function toMcpFailure(error: unknown): McpFailure {
  if (error instanceof CourseValidationError || error instanceof LearningValidationError) {
    return { ok: false, error: { code: "VALIDATION", message: error.message, retryable: false } };
  }
  if (error instanceof LearningStateError) {
    return { ok: false, error: { code: "STATE", message: error.message, retryable: false } };
  }
  if (error instanceof LearningRevisionConflictError) {
    return { ok: false, error: { code: "REVISION_CONFLICT", message: "학습 상태가 변경되었습니다. 최신 상태를 다시 읽어 주세요.", retryable: false } };
  }
  if (error instanceof StorageError) {
    return { ok: false, error: { code: "STORAGE_CORRUPT", message: "저장된 학습 데이터의 무결성을 확인할 수 없습니다. 복구 전에는 덮어쓰지 마세요.", retryable: false } };
  }
  if (error instanceof DatabaseUnavailableError) {
    return { ok: false, error: { code: "UNAVAILABLE", message: "데이터베이스를 사용할 수 없습니다.", retryable: true } };
  }
  return { ok: false, error: { code: "INTERNAL", message: "요청을 처리하지 못했습니다.", retryable: false } };
}

function success<T extends object>(summary: string, data: T) {
  const structuredContent = { ok: true as const, data };
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent,
  };
}

function failure(error: unknown) {
  const structuredContent = toMcpFailure(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

type SafeInput<T> =
  | { ok: true; value: T }
  | { ok: false };

function safeInputSchema<T extends z.ZodType>(
  schema: T,
): StandardSchemaWithJSON<unknown, SafeInput<z.output<T>>> {
  const standard = {
    ...(schema as unknown as StandardSchemaWithJSON)["~standard"],
    types: undefined,
  };
  return {
    "~standard": {
      ...standard,
      validate: async (value, options) => {
        try {
          const result = await standard.validate(value, options);
          return result.issues !== undefined
            ? { value: { ok: false as const } }
            : { value: { ok: true as const, value: result.value as z.output<T> } };
        } catch {
          return { value: { ok: false as const } };
        }
      },
    },
  };
}

function invalidInput() {
  return failure(new LearningValidationError("요청 형식이 올바르지 않습니다."));
}

function withSafeInput<T, R>(input: SafeInput<T>, operation: (value: T) => R): R | ReturnType<typeof invalidInput> {
  return input.ok ? operation(input.value) : invalidInput();
}

export function compactCourse(course: Course) {
  return {
    id: course.id,
    title: course.title,
    goal: course.goal,
    status: course.status,
    currentDayId: course.currentDayId,
    currentStage: course.currentStage,
    revision: course.revision,
    outlineApprovedAt: course.outlineApprovedAt,
    completedAt: course.completedAt,
    updatedAt: course.updatedAt,
  };
}

export function compactLearningState(snapshot: LearningSnapshot) {
  return {
    course: compactCourse(snapshot.course),
    days: snapshot.days,
    currentDay: snapshot.currentDay,
    researchRuns: snapshot.researchRuns,
    understoodConcepts: snapshot.understoodConcepts,
    remediationConcepts: snapshot.remediationConcepts,
    quizAttempts: snapshot.quizAttempts,
    currentDayMarkdown: snapshot.documents.currentDay,
  };
}

export type CompactCourse = ReturnType<typeof compactCourse>;
export type CompactLearningState = ReturnType<typeof compactLearningState>;

const INSTRUCTIONS = "실제로 확인하지 않은 출처를 만들지 마세요. 쓰기 전 최신 revision을 사용하세요. 충돌·손상 시 자동 재시도하거나 덮어쓰지 마세요. 현재 Day와 stage에 맞는 도구만 호출하세요. 웹 조사는 서버가 아니라 Codex가 수행하며 확인한 URL만 입력하세요.";

export function createJustStudyMcpServer(): McpServer {
  const server = new McpServer(
    { name: "just-study", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "health",
    {
      title: "Check just-study health",
      description: "Checks the local database, Markdown storage, schema, and recovery state.",
      inputSchema: safeInputSchema(z.object({}).strict()),
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({
          ok: z.boolean(),
          database: z.enum(["ok", "error"]),
          storage: z.enum(["ok", "error"]),
          schemaVersion: z.number().int().nullable(),
          expectedSchemaVersion: z.number().int(),
          orphanCourseIds: z.array(z.string()),
          missingCourseIds: z.array(z.string()),
          corruptCourseIds: z.array(z.string()),
          temporaryEntries: z.array(z.string()),
          message: z.string(),
        }).strict(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => withSafeInput(input, () => {
      try {
        const runtime = getRuntime();
        const report = getHealth(runtime.db, runtime.dataRoot);
        return success(report.message, report);
      } catch (error) {
        return failure(error);
      }
    }),
  );
  return server;
}

export const mcpHandler = createMcpHandler(createJustStudyMcpServer, {
  maxSubscriptions: 0,
});
```

`maxSubscriptions: 0` is required: MCP v2 otherwise exposes a built-in `subscriptions/listen` SSE path even when this server registers no resources or notifications.

- [ ] **Step 6: Run focused and full verification**

Run:

```bash
node --test tests/mcp.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass; `createJustStudyMcpServer` has only `health`; no app route or skill exists yet.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json package-lock.json src/server/storage.ts src/server/learning.ts src/server/mcp.ts tests/mcp.test.ts
git commit -m "feat: add the MCP server foundation"
```

### Task 2: Local-only Streamable HTTP boundary and project config

**Files:**

- Create: `src/app/mcp/route.ts`
- Create: `.codex/config.toml`
- Modify: `tests/mcp.test.ts`

**Interfaces:**

- Consumes: `mcpHandler.fetch(request)` from Task 1.
- Produces: `POST(request): Promise<Response>`, `MAX_MCP_BODY_BYTES = 8 * 1024 * 1024`, and trusted-project server registration `[mcp_servers.just-study]`.

- [ ] **Step 1: Write failing transport-boundary tests**

Append tests that import the route namespace and verify rejection happens with an empty database before MCP dispatch:

```ts
import * as mcpRoute from "../src/app/mcp/route.ts";
import type { DatabaseHandle } from "../src/server/database.ts";

type TestRuntimeGlobal = typeof globalThis & {
  __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
};

function setTestRuntime(dataRoot: string, db: DatabaseHandle | null): void {
  (globalThis as TestRuntimeGlobal).__justStudyRuntime = { dataRoot, db };
}

function clearTestRuntime(): void {
  delete (globalThis as TestRuntimeGlobal).__justStudyRuntime;
}

function mcpRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

test("exports only POST for the MCP route", () => {
  assert.equal(typeof mcpRoute.POST, "function");
  assert.equal("GET" in mcpRoute, false);
  assert.equal("DELETE" in mcpRoute, false);
  assert.equal("OPTIONS" in mcpRoute, false);
});

test("rejects non-local Host and mismatched Origin before MCP parsing", async () => {
  clearTestRuntime();
  const badHost = await mcpRoute.POST(mcpRequest("{}", { host: "example.com" }));
  const badOrigin = await mcpRoute.POST(mcpRequest("{}", { origin: "http://evil.test" }));
  assert.equal(badHost.status, 403);
  assert.equal(badOrigin.status, 403);
  assert.equal(badHost.headers.has("access-control-allow-origin"), false);
  assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
});

test("rejects unsupported media types and oversized streamed bodies", async () => {
  clearTestRuntime();
  const wrongType = mcpRequest("{}", { "content-type": "text/plain" });
  assert.equal((await mcpRoute.POST(wrongType)).status, 415);

  const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
  assert.equal((await mcpRoute.POST(mcpRequest(oversized))).status, 413);
  assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
});

test("rejects malformed JSON before any tool mutation", async () => {
  clearTestRuntime();
  const response = await mcpRoute.POST(mcpRequest("{"));
  const body = await response.text();
  assert.equal(response.status, 400);
  assert.equal(body.includes("/private/"), false);
  assert.equal(body.includes("SQLITE"), false);
  assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
});

test("keeps MCP subscriptions disabled", async () => {
  const response = await mcpRoute.POST(mcpRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "listen-disabled",
      method: "subscriptions/listen",
      params: {
        notifications: { toolsListChanged: true },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
    {
      accept: "application/json, text/event-stream",
      "mcp-method": "subscriptions/listen",
      "mcp-protocol-version": "2026-07-28",
    },
  ));
  const body = await response.json() as { error?: { code?: number; message?: string } };
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type")?.includes("text/event-stream"), false);
  assert.equal(body.error?.code, -32603);
  assert.equal(body.error?.message, "Subscription limit reached");
});
```

- [ ] **Step 2: Run the route tests and observe RED**

Run: `node --test --test-name-pattern='exports only POST|rejects non-local|rejects unsupported|rejects malformed|subscriptions disabled' tests/mcp.test.ts`

Expected: FAIL because `src/app/mcp/route.ts` does not exist.

- [ ] **Step 3: Implement local request validation and bounded streaming**

Create `src/app/mcp/route.ts` with no exports except `POST` and the testable size constant:

```ts
import { mcpHandler } from "../../server/mcp.ts";

export const MAX_MCP_BODY_BYTES = 8 * 1024 * 1024;

function errorResponse(status: number, message: string): Response {
  return Response.json({ ok: false, error: { message } }, { status });
}

function localHost(host: string | null): string | null {
  if (host === null || !/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host)) return null;
  try {
    const url = new URL(`http://${host}`);
    if (url.port !== "" && Number(url.port) > 65_535) return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

async function boundedBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_MCP_BODY_BYTES)) {
    throw new RangeError("MCP request body is too large");
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MCP_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* The 413 response remains authoritative. */ }
      throw new RangeError("MCP request body is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request): Promise<Response> {
  const host = localHost(request.headers.get("host"));
  if (host === null) return errorResponse(403, "Local MCP requests only");
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) {
    return errorResponse(403, "Cross-origin MCP requests are not allowed");
  }
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return errorResponse(403, "Cross-site MCP requests are not allowed");
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return errorResponse(415, "Content-Type must be application/json");
  let body: Uint8Array;
  try {
    body = await boundedBody(request);
  } catch (error) {
    return error instanceof RangeError
      ? errorResponse(413, "MCP request body is too large")
      : errorResponse(400, "MCP request body could not be read");
  }
  try {
    return await mcpHandler.fetch(new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    }));
  } catch {
    return errorResponse(500, "MCP request could not be processed");
  }
}
```

Do not export `GET`, `DELETE`, or `OPTIONS`; Next returns 405 without entering this module's MCP path. Do not add CORS headers.

- [ ] **Step 4: Add the trusted-project MCP config**

Create `.codex/config.toml` exactly:

```toml
[mcp_servers.just-study]
url = "http://127.0.0.1:3000/mcp"
required = false
default_tools_approval_mode = "writes"
```

- [ ] **Step 5: Verify boundary tests, protocol initialization, and project config discovery**

Add the official client imports, runtime helpers, and a client helper whose fetch override supplies the real HTTP Host header:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

async function withMcpClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1:3000/mcp"),
    {
      fetch: (input, init) => {
        const request = new Request(input, init);
        request.headers.set("host", "127.0.0.1:3000");
        return mcpRoute.POST(request);
      },
    },
  );
  const client = new Client(
    { name: "just-study-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}
```

Add this protocol test:

```ts
test("negotiates Streamable HTTP and lists health", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
      assert.equal(client.getProtocolEra(), "modern");
      const tools = (await client.listTools()).tools;
      const health = tools.find(({ name }) => name === "health");
      assert.ok(health);
      assert.equal(health.annotations?.readOnlyHint, true);
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
```

Then run:

```bash
node --test tests/mcp.test.ts
codex mcp list --json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const servers = JSON.parse(input);
  const server = servers.find(({ name }) => name === "just-study");
  if (!server || server.enabled !== true || server.transport?.type !== "streamable_http" || server.transport?.url !== "http://127.0.0.1:3000/mcp") process.exit(1);
});
'
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass; the JSON assertion finds the exact enabled Streamable HTTP URL, and `tests/codex-skill.test.ts` pins the otherwise-unreported `required = false` and `default_tools_approval_mode = "writes"` values. Codex CLI 0.144.1 does not support top-level `--strict-config` with the `mcp` subcommand, so do not claim that check; the server need not be running for `mcp list`.

- [ ] **Step 6: Commit Task 2**

```bash
git add .codex/config.toml src/app/mcp/route.ts tests/mcp.test.ts
git commit -m "feat: serve MCP on localhost"
```

### Task 3: Read tools and idempotent course creation

**Files:**

- Modify: `src/server/mcp.ts`
- Modify: `tests/mcp.test.ts`

**Interfaces:**

- Consumes: `listCourses`, `createCourse`, `getLearningSnapshot`, `getLearningDocument`, `requireDatabase`, Task 1 schemas/serializers, and Task 2 `withMcpClient` test helper.
- Produces: MCP tools `list_courses`, `get_learning_state`, `read_learning_document`, and `create_course`; all return `{ ok: true, data: ... }` on success.

Before adding registrations, replace the three existing import groups in `src/server/mcp.ts` with these complete groups so this task compiles independently:

```ts
import {
  CourseValidationError,
  createCourse,
  listCourses,
  UUID_PATTERN,
  type Course,
} from "./courses.ts";
import {
  getLearningDocument,
  getLearningSnapshot,
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  type LearningSnapshot,
} from "./learning.ts";
import {
  DatabaseUnavailableError,
  getRuntime,
  requireDatabase,
} from "./runtime.ts";
```

- [ ] **Step 1: Write a failing official-client test for all four contracts**

Use one temporary runtime and call tools only through `Client.callTool`:

```ts
function structured<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  assert.equal(result.isError, undefined);
  assert.ok(result.structuredContent);
  return result.structuredContent as T;
}

test("lists, creates, resumes, and reads courses through MCP", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  const requestId = crypto.randomUUID();
  try {
    await withMcpClient(async (client) => {
      const names = (await client.listTools()).tools.map(({ name }) => name);
      for (const name of ["health", "list_courses", "get_learning_state", "read_learning_document", "create_course"]) {
        assert.ok(names.includes(name), `${name} is missing`);
      }

      const created = structured<{ ok: true; data: { created: boolean; course: { id: string; revision: number } } }>(
        await client.callTool({ name: "create_course", arguments: { requestId, title: "자료구조", goal: "핵심 자료구조를 설명하고 선택한다." } }),
      );
      assert.equal(created.data.created, true);
      assert.equal(created.data.course.revision, 0);
      assert.equal("markdownPath" in created.data.course, false);

      const duplicate = structured<{ ok: true; data: { created: boolean; course: { id: string } } }>(
        await client.callTool({ name: "create_course", arguments: { requestId, title: "자료구조", goal: "핵심 자료구조를 설명하고 선택한다." } }),
      );
      assert.equal(duplicate.data.created, false);
      assert.equal(duplicate.data.course.id, created.data.course.id);

      const listed = structured<{ ok: true; data: { courses: { id: string }[] } }>(
        await client.callTool({ name: "list_courses", arguments: {} }),
      );
      assert.deepEqual(listed.data.courses.map(({ id }) => id), [created.data.course.id]);

      const state = structured<{ ok: true; data: { state: { course: { status: string }; days: unknown[]; currentDayMarkdown: null } } }>(
        await client.callTool({ name: "get_learning_state", arguments: { courseId: created.data.course.id } }),
      );
      assert.equal(state.data.state.course.status, "draft");
      assert.deepEqual(state.data.state.days, []);
      assert.equal(state.data.state.currentDayMarkdown, null);
      assert.equal(JSON.stringify(state).includes("journal"), false);

      const document = structured<{ ok: true; data: { document: string; markdown: string } }>(
        await client.callTool({ name: "read_learning_document", arguments: { courseId: created.data.course.id, document: "course" } }),
      );
      assert.equal(document.data.document, "course");
      assert.match(document.data.markdown, /자료구조/);
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
```

Also assert `read_learning_document` rejects `"../../secret"` at the MCP schema and returns `isError: true` without echoing the value as a path.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='lists, creates, resumes|secret' tests/mcp.test.ts`

Expected: FAIL because the four tools are not registered.

- [ ] **Step 3: Add exact input/output schemas and a single tool error wrapper**

Keep these in `src/server/mcp.ts`; do not create a schema module:

```ts
const uuidSchema = z.string().regex(UUID_PATTERN);
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const documentSchema = z.enum(["course", "progress", "journal", "current-day"]);

const compactCourseSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  goal: z.string(),
  status: z.enum(["draft", "active", "completed"]),
  currentDayId: uuidSchema.nullable(),
  currentStage: z.enum(["lecture", "quiz", "remediation", "reflection"]).nullable(),
  revision: revisionSchema,
  outlineApprovedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
}).strict();

const successSchema = <T extends z.ZodType>(data: T) => z.object({
  ok: z.literal(true),
  data,
}).strict();

function runTool<T extends object>(summary: (value: T) => string, operation: () => T) {
  try {
    const value = operation();
    return success(summary(value), value);
  } catch (error) {
    return failure(error);
  }
}
```

Define every compact nested output with the same enum and nullability as `src/server/learning.ts:24-39`:

```ts
const requiredText = (maximum: number) => z.string().min(1).max(maximum).refine((value) => !value.includes("\0"));
const rubricSchema = z.object({
  authority: z.number().int().min(0).max(25),
  crossValidation: z.number().int().min(0).max(25),
  relevance: z.number().int().min(0).max(20),
  teachingQuality: z.number().int().min(0).max(15),
  currency: z.number().int().min(0).max(10),
  accessibility: z.number().int().min(0).max(5),
}).strict();
const evidenceSchema = z.object({
  sourceId: uuidSchema,
  stance: z.enum(["supports", "opposes", "context"]),
}).strict();
const sourceInputSchema = z.object({
  id: uuidSchema,
  url: requiredText(2_048),
  title: requiredText(500),
  publisher: requiredText(300),
  independenceKey: requiredText(200),
  scores: rubricSchema,
  rank: z.number().int().positive(),
  selected: z.boolean(),
  selectionReason: requiredText(1_000).nullable(),
  limitation: requiredText(2_000).nullable(),
}).strict();
const claimSchema = z.object({
  id: uuidSchema,
  statement: requiredText(5_000),
  major: z.boolean(),
  conclusion: requiredText(5_000),
  uncertainty: requiredText(5_000).nullable(),
  evidence: z.array(evidenceSchema).min(1),
}).strict();
const researchInputSchema = z.object({
  questions: z.array(requiredText(1_000)).min(1).max(20),
  topicCriteria: z.array(requiredText(1_000)).min(1).max(20),
  narrativeMarkdown: requiredText(1_000_000),
  sources: z.array(sourceInputSchema).min(1).max(100),
  claims: z.array(claimSchema).min(1).max(100),
}).strict();
const sourceOutputSchema = sourceInputSchema.extend({ totalScore: z.number().int().min(0).max(100) });
const researchRunSchema = researchInputSchema.omit({ narrativeMarkdown: true }).extend({
  id: uuidSchema,
  scope: z.enum(["course", "day"]),
  dayId: uuidSchema.nullable(),
  sources: z.array(sourceOutputSchema),
  createdAt: z.string(),
});
const learningDaySchema = z.object({
  id: uuidSchema,
  dayNumber: z.number().int().min(1).max(30),
  objective: z.string(),
  completedAt: z.string().nullable(),
}).strict();
const conceptOutputSchema = z.object({ key: z.string(), label: z.string() }).strict();
const quizResponseSchema = z.object({
  id: uuidSchema,
  questionId: uuidSchema,
  responseNumber: z.number().int().positive(),
  answer: z.string(),
  result: z.enum(["correct", "incorrect", "needs_clarification"]),
  feedback: z.string(),
  clarificationQuestion: z.string().nullable(),
  createdAt: z.string(),
}).strict();
const quizQuestionOutputSchema = z.object({
  id: uuidSchema,
  position: z.number().int().min(1).max(5),
  conceptKey: z.string(),
  conceptLabel: z.string(),
  prompt: z.string(),
  gradingCriteria: z.string(),
  responses: z.array(quizResponseSchema),
}).strict();
const quizAttemptSchema = z.object({
  id: uuidSchema,
  attemptNumber: z.number().int().positive(),
  status: z.enum(["in_progress", "passed", "failed"]),
  score: z.number().int().min(0).max(5).nullable(),
  questions: z.array(quizQuestionOutputSchema).length(5),
  createdAt: z.string(),
  gradedAt: z.string().nullable(),
}).strict();
const compactLearningStateSchema = z.object({
  course: compactCourseSchema,
  days: z.array(learningDaySchema).max(30),
  currentDay: learningDaySchema.nullable(),
  researchRuns: z.array(researchRunSchema),
  understoodConcepts: z.array(conceptOutputSchema),
  remediationConcepts: z.array(conceptOutputSchema),
  quizAttempts: z.array(quizAttemptSchema),
  currentDayMarkdown: z.string().nullable(),
}).strict();
const stateOutputSchema = successSchema(z.object({ state: compactLearningStateSchema }).strict());
```

- [ ] **Step 4: Register the read tools and `create_course`**

Add these registrations inside `createJustStudyMcpServer`:

```ts
server.registerTool(
  "list_courses",
  {
    title: "List learning courses",
    description: "Lists local courses with resumable Day, stage, and revision state.",
    inputSchema: safeInputSchema(z.object({}).strict()),
    outputSchema: successSchema(z.object({ courses: z.array(compactCourseSchema) }).strict()),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => withSafeInput(input, () => runTool(
      ({ courses }) => `${courses.length}개의 과정을 찾았습니다.`,
      () => {
        const runtime = getRuntime();
        return { courses: listCourses(requireDatabase(runtime)).map(compactCourse) };
      },
    )),
);

server.registerTool(
  "get_learning_state",
  {
    title: "Get resumable learning state",
    description: "Reads the saved current Day, stage, research, concepts, quiz, and current Day Markdown.",
    inputSchema: safeInputSchema(z.object({ courseId: uuidSchema }).strict()),
    outputSchema: stateOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => withSafeInput(input, ({ courseId }) => runTool(
      ({ state }) => `${state.course.title}의 ${state.course.currentStage ?? "완료"} 단계입니다.`,
      () => {
        const runtime = getRuntime();
        const snapshot = getLearningSnapshot(requireDatabase(runtime), runtime.dataRoot, courseId);
        if (!snapshot) throw new LearningStateError("Course does not exist");
        return { state: compactLearningState(snapshot) };
      },
    )),
);

server.registerTool(
  "read_learning_document",
  {
    title: "Read a verified learning document",
    description: "Reads one fixed, checksum-verified course, progress, journal, or current-day Markdown document.",
    inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, document: documentSchema }).strict()),
    outputSchema: successSchema(z.object({ course: compactCourseSchema, document: documentSchema, markdown: z.string() }).strict()),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => withSafeInput(input, ({ courseId, document }) => runTool(
      () => `${document} 문서를 읽었습니다.`,
      () => {
        const runtime = getRuntime();
        const found = getLearningDocument(requireDatabase(runtime), runtime.dataRoot, courseId, document);
        if (!found) throw new LearningStateError("Learning document is not available");
        return { course: compactCourse(found.course), document: found.document, markdown: found.markdown };
      },
    )),
);

server.registerTool(
  "create_course",
  {
    title: "Create a draft learning course",
    description: "Creates one local draft course idempotently from a reusable request UUID.",
    inputSchema: safeInputSchema(z.object({ requestId: uuidSchema, title: z.string().min(1).max(120), goal: z.string().min(1).max(2_000) }).strict()),
    outputSchema: successSchema(z.object({ course: compactCourseSchema, created: z.boolean() }).strict()),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => withSafeInput(input, (value) => runTool(
      ({ created }) => created ? "새 학습 과정을 만들었습니다." : "같은 요청의 기존 학습 과정을 반환했습니다.",
      () => {
        const runtime = getRuntime();
        const result = createCourse(requireDatabase(runtime), runtime.dataRoot, value);
        return { course: compactCourse(result.course), created: result.created };
      },
    )),
);
```

- [ ] **Step 5: Verify schema rejection, idempotency, compact output, and regressions**

Run:

```bash
node --test tests/mcp.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass; output contains no Markdown path/checksum and state contains no full journal.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/server/mcp.ts tests/mcp.test.ts
git commit -m "feat: expose resumable MCP course reads"
```

### Task 4: Outline, research, and learning checkpoint tools

**Files:**

- Modify: `src/server/mcp.ts`
- Modify: `tests/mcp.test.ts`

**Interfaces:**

- Consumes: `approveOutline`, `recordDailyResearch`, `saveLearningCheckpoint`, `ResearchBundleInput`, `LessonContentInput`, Task 3's compact state and `runTool`.
- Produces: MCP tools `approve_outline`, `record_daily_research`, and `save_checkpoint`, each returning `{ state: CompactLearningState }` with the incremented revision.

Add these values to the existing `./learning.ts` import in `src/server/mcp.ts` before writing tests or registrations:

```ts
import {
  approveOutline,
  getLearningDocument,
  getLearningSnapshot,
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  recordDailyResearch,
  saveLearningCheckpoint,
  type LearningSnapshot,
} from "./learning.ts";
```

- [ ] **Step 1: Add exact research and lesson fixture builders to the MCP test**

Define a two-source independently corroborated bundle and complete seven-part lesson:

```ts
import type { CompactLearningState } from "../src/server/mcp.ts";

type StateResult = { ok: true; data: { state: CompactLearningState } };

function validResearch(topic: string) {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  return {
    questions: [`${topic}의 핵심 개념은 무엇인가?`],
    topicCriteria: ["공식·대학 자료를 우선한다"],
    narrativeMarkdown: `${topic}의 핵심 개념과 학습 순서를 교차 검증했다.`,
    sources: [
      {
        id: first,
        url: "https://example.edu/foundations",
        title: "Foundations",
        publisher: "Example University",
        independenceKey: "example-university",
        scores: { authority: 24, crossValidation: 23, relevance: 19, teachingQuality: 14, currency: 9, accessibility: 5 },
        rank: 1,
        selected: true,
        selectionReason: "공개 기초 과정이며 예제와 선수 지식 설명이 명확하다.",
        limitation: null,
      },
      {
        id: second,
        url: "https://standards.example.org/curriculum",
        title: "Curriculum Standard",
        publisher: "Independent Standards Group",
        independenceKey: "standards-group",
        scores: { authority: 23, crossValidation: 24, relevance: 18, teachingQuality: 13, currency: 9, accessibility: 5 },
        rank: 2,
        selected: true,
        selectionReason: "독립 기관의 학습 순서와 성취 기준을 제공한다.",
        limitation: null,
      },
    ],
    claims: [{
      id: crypto.randomUUID(),
      statement: `${topic}은 개념 설명과 적용 연습을 함께 학습해야 한다.`,
      major: true,
      conclusion: "두 독립 자료가 같은 학습 방향을 지지한다.",
      uncertainty: null,
      evidence: [
        { sourceId: first, stance: "supports" as const },
        { sourceId: second, stance: "supports" as const },
      ],
    }],
  };
}

const fullLesson = {
  recallMarkdown: "전날 개념을 한 문장으로 회상한다.",
  preciseExplanationMarkdown: "정확한 정의와 작동 원리를 설명한다.",
  eli5Markdown: "다섯 살도 이해할 말로 다시 설명한다.",
  analogyMarkdown: "일상적인 정리함에 비유한다.",
  exampleMarkdown: "작은 입력을 단계별로 추적한다.",
  applicationMarkdown: "새 문제에 개념을 적용한다.",
  interviewMarkdown: "왜 이 방법을 선택했는지 설명한다.",
};
```

- [ ] **Step 2: Write the failing write-flow test**

Create a course via `create_course`, then call:

```ts
const created = structured<{ ok: true; data: { course: { id: string } } }>(
  await client.callTool({
    name: "create_course",
    arguments: {
      requestId: crypto.randomUUID(),
      title: "자료구조",
      goal: "핵심 자료구조를 설명하고 선택한다.",
    },
  }),
);
const courseId = created.data.course.id;

const approved = structured<StateResult>(
  await client.callTool({
    name: "approve_outline",
    arguments: {
      courseId,
      expectedRevision: 0,
      priorKnowledge: "배열을 사용해 본 적이 있다.",
      learningPreference: "examples",
      knowledgeMapMarkdown: "배열 → 리스트 → 스택과 큐",
      research: validResearch("자료구조"),
      days: Array.from({ length: 30 }, (_, index) => ({ objective: `자료구조 목표 ${index + 1}을 설명한다` })),
    },
  }),
);
assert.equal(approved.data.state.course.revision, 1);
assert.equal(approved.data.state.course.currentStage, "lecture");

const researched = structured<StateResult>(
  await client.callTool({ name: "record_daily_research", arguments: { courseId, expectedRevision: 1, research: validResearch("Day 1 배열") } }),
);
assert.equal(researched.data.state.course.revision, 2);

const checkpoint = structured<StateResult>(
  await client.callTool({
    name: "save_checkpoint",
    arguments: {
      courseId,
      expectedRevision: 2,
      lesson: fullLesson,
      understoodConcepts: [{ key: "array", label: "배열" }],
      remediationConcepts: [{ key: "tradeoff", label: "시간·공간 절충" }],
    },
  }),
);
assert.equal(checkpoint.data.state.course.revision, 3);
assert.match(checkpoint.data.state.currentDayMarkdown, /정확한 정의/);
```

Place this exact sequence in a file-local `createLectureReadyCourse(client: Client): Promise<{ courseId: string; state: CompactLearningState }>` helper and return the checkpoint state. The Task 4 test calls that helper; Tasks 5 and 7 reuse it without bypassing MCP.

Call `record_daily_research` again with `expectedRevision: 1`; assert `isError === true`, code `REVISION_CONFLICT`, and the course remains at revision 3. Create a second draft through `create_course`, call `approve_outline` for that second course with 29 Days, assert `isError === true`, then read it with `get_learning_state` and assert status `draft`, revision 0, zero Days, and zero research runs. Because the rejection occurs in the MCP schema before the service callback, assert the safe protocol error and no mutation; service-thrown `LearningValidationError` coverage remains in Task 1.

- [ ] **Step 3: Run the focused write tests and observe RED**

Run: `node --test --test-name-pattern='outline, research|revision conflict|29 Days' tests/mcp.test.ts`

Expected: FAIL because these tools are not registered.

- [ ] **Step 4: Add the remaining lesson and concept Zod schemas**

Reuse Task 3's `researchInputSchema` and add only these remaining service-bound shapes:

```ts
const lessonSchema = z.object({
  recallMarkdown: requiredText(1_000_000).optional(),
  preciseExplanationMarkdown: requiredText(1_000_000).optional(),
  eli5Markdown: requiredText(1_000_000).optional(),
  analogyMarkdown: requiredText(1_000_000).optional(),
  exampleMarkdown: requiredText(1_000_000).optional(),
  applicationMarkdown: requiredText(1_000_000).optional(),
  interviewMarkdown: requiredText(1_000_000).optional(),
  remediationMarkdown: requiredText(1_000_000).optional(),
}).strict();
const conceptKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const conceptSchema = z.object({ key: conceptKeySchema, label: requiredText(300) }).strict();
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
```

- [ ] **Step 5: Register the three write tools by direct service delegation**

Each annotation is `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`.

```ts
server.registerTool(
  "approve_outline",
  {
    title: "Approve a researched 30-Day outline",
    description: "Activates a draft only after the user approves its interview, research, knowledge map, and exactly 30 objectives.",
    inputSchema: safeInputSchema(z.object({
      courseId: uuidSchema,
      expectedRevision: revisionSchema,
      priorKnowledge: requiredText(10_000),
      learningPreference: z.enum(["examples", "theory", "practice"]),
      knowledgeMapMarkdown: requiredText(1_000_000),
      research: researchInputSchema,
      days: z.array(z.object({ objective: requiredText(500) }).strict()).length(30),
    }).strict()),
    outputSchema: stateOutputSchema,
    annotations: writeAnnotations,
  },
  async (input) => withSafeInput(input, (value) => stateTool("30일 학습 목차를 승인했습니다.", (db, root) => approveOutline(db, root, value))),
);

server.registerTool(
  "record_daily_research",
  {
    title: "Record verified daily research",
    description: "Stores sources and cross-checked claims actually researched by Codex for the current Day.",
    inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, research: researchInputSchema }).strict()),
    outputSchema: stateOutputSchema,
    annotations: writeAnnotations,
  },
  async (input) => withSafeInput(input, (value) => stateTool("오늘의 리서치를 저장했습니다.", (db, root) => recordDailyResearch(db, root, value))),
);

server.registerTool(
  "save_checkpoint",
  {
    title: "Save a lesson or remediation checkpoint",
    description: "Persists supplied lesson content and concept status for the current allowed stage.",
    inputSchema: safeInputSchema(z.object({
      courseId: uuidSchema,
      expectedRevision: revisionSchema,
      lesson: lessonSchema,
      understoodConcepts: z.array(conceptSchema).max(100).optional(),
      remediationConcepts: z.array(conceptSchema).max(100).optional(),
    }).strict()),
    outputSchema: stateOutputSchema,
    annotations: writeAnnotations,
  },
  async (input) => withSafeInput(input, (value) => stateTool("학습 체크포인트를 저장했습니다.", (db, root) => saveLearningCheckpoint(db, root, value))),
);
```

Implement the wrapper once:

```ts
import type { DatabaseHandle } from "./database.ts";

async function stateTool(
  summary: string,
  operation: (db: DatabaseHandle, dataRoot: string) => LearningSnapshot,
) {
  try {
    const runtime = getRuntime();
    const snapshot = operation(requireDatabase(runtime), runtime.dataRoot);
    return success(summary, { state: compactLearningState(snapshot) });
  } catch (error) {
    return failure(error);
  }
}
```

It must not alter input, infer stage, or retry.

- [ ] **Step 6: Verify the flow and regressions**

Run:

```bash
node --test tests/mcp.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass; the test state is revision 3 with one course research run, one Day research run, and all seven lesson parts in verified Markdown.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/server/mcp.ts tests/mcp.test.ts
git commit -m "feat: expose researched learning checkpoints"
```

### Task 5: Quiz, remediation, and Day completion tools

**Files:**

- Modify: `src/server/mcp.ts`
- Modify: `tests/mcp.test.ts`

**Interfaces:**

- Consumes: `startQuiz`, `gradeQuiz`, `startRemediationQuiz`, `completeDay`, Task 4's active revision-3 fixture, `stateTool`, and compact state schema.
- Produces: MCP tools `start_quiz`, `grade_quiz`, `start_remediation_quiz`, and `complete_day`; a complete MCP-visible Day state machine.

Replace the existing `./learning.ts` import in `src/server/mcp.ts` with the complete final value/type list before adding the four tools:

```ts
import {
  approveOutline,
  completeDay,
  getLearningDocument,
  getLearningSnapshot,
  gradeQuiz,
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  recordDailyResearch,
  saveLearningCheckpoint,
  startQuiz,
  startRemediationQuiz,
  type LearningSnapshot,
} from "./learning.ts";
```

- [ ] **Step 1: Add deterministic question and grade builders**

```ts
function quizQuestions(prefix: string) {
  return Array.from({ length: 5 }, (_, index) => ({
    id: crypto.randomUUID(),
    conceptKey: `${prefix}-${index + 1}`,
    conceptLabel: `${prefix} 개념 ${index + 1}`,
    prompt: `${prefix} 질문 ${index + 1}: 핵심 원리를 설명하세요.`,
    gradingCriteria: "핵심 원리와 적용 이유를 모두 설명한다.",
  }));
}

function terminalGrades(
  questions: ReturnType<typeof quizQuestions>,
  incorrectIndex: number | null,
) {
  return questions.map((question, index) => ({
    questionId: question.id,
    answer: `${question.conceptLabel}에 대한 사용자 답변`,
    result: index === incorrectIndex ? "incorrect" as const : "correct" as const,
    feedback: index === incorrectIndex ? "적용 이유를 보완해야 합니다." : "핵심 원리와 적용 이유가 정확합니다.",
  }));
}
```

- [ ] **Step 2: Write the failing ambiguity → 4/5 → remediation → 5/5 → reflection test**

Starting from revision 3:

```ts
const { courseId, state: lectureReady } = await createLectureReadyCourse(client);
assert.equal(lectureReady.course.revision, 3);
const firstQuestions = quizQuestions("initial");
const started = structured<StateResult>(await client.callTool({
  name: "start_quiz",
  arguments: { courseId, expectedRevision: 3, questions: firstQuestions },
}));
const firstAttempt = started.data.state.quizAttempts.at(-1)!;
assert.equal(started.data.state.course.revision, 4);
assert.equal(started.data.state.course.currentStage, "quiz");

const clarification = structured<StateResult>(await client.callTool({
  name: "grade_quiz",
  arguments: {
    courseId,
    expectedRevision: 4,
    attemptId: firstAttempt.id,
    grades: [{
      questionId: firstQuestions[0]!.id,
      answer: "정렬한다는 뜻인가요?",
      result: "needs_clarification",
      feedback: "어떤 비용을 기준으로 정렬하는지 불명확합니다.",
      clarificationQuestion: "시간 비용과 공간 비용 중 무엇을 뜻하나요?",
    }],
  },
}));
assert.equal(clarification.data.state.course.revision, 5);
assert.equal(clarification.data.state.course.currentStage, "quiz");

const failed = structured<StateResult>(await client.callTool({
  name: "grade_quiz",
  arguments: {
    courseId,
    expectedRevision: 5,
    attemptId: firstAttempt.id,
    grades: terminalGrades(firstQuestions, 4),
  },
}));
assert.equal(failed.data.state.quizAttempts.at(-1)!.score, 4);
assert.equal(failed.data.state.course.currentStage, "remediation");
assert.equal(failed.data.state.course.revision, 6);

const remediation = structured<StateResult>(await client.callTool({
  name: "save_checkpoint",
  arguments: { courseId, expectedRevision: 6, lesson: { remediationMarkdown: "다른 비유와 반례로 취약 개념을 다시 설명한다." } },
}));
assert.equal(remediation.data.state.course.revision, 7);

const secondQuestions = quizQuestions("remediation");
secondQuestions[0] = {
  ...secondQuestions[0]!,
  conceptKey: "tradeoff",
  conceptLabel: "시간·공간 절충",
};
secondQuestions[1] = {
  ...secondQuestions[1]!,
  conceptKey: firstQuestions[4]!.conceptKey,
  conceptLabel: firstQuestions[4]!.conceptLabel,
};
const restarted = structured<StateResult>(await client.callTool({
  name: "start_remediation_quiz",
  arguments: { courseId, expectedRevision: 7, remediationMarkdown: "새 예제로 다시 적용한다.", questions: secondQuestions },
}));
const secondAttempt = restarted.data.state.quizAttempts.at(-1)!;
assert.equal(restarted.data.state.course.revision, 8);

const passed = structured<StateResult>(await client.callTool({
  name: "grade_quiz",
  arguments: { courseId, expectedRevision: 8, attemptId: secondAttempt.id, grades: terminalGrades(secondQuestions, null) },
}));
assert.equal(passed.data.state.quizAttempts.at(-1)!.score, 5);
assert.equal(passed.data.state.course.currentStage, "reflection");
assert.equal(passed.data.state.course.revision, 9);

const completed = structured<StateResult>(await client.callTool({
  name: "complete_day",
  arguments: {
    courseId,
    expectedRevision: 9,
    reflection: { learned: "자료구조 선택 기준", confusing: "상각 분석", feeling: "적용할 수 있다" },
  },
}));
assert.equal(completed.data.state.currentDay?.dayNumber, 2);
assert.equal(completed.data.state.course.currentStage, "lecture");
assert.equal(completed.data.state.course.revision, 10);
```

Also test that repeating `complete_day` with revision 9 returns `REVISION_CONFLICT` and leaves Day 2 unchanged.

- [ ] **Step 3: Run the focused state-machine test and observe RED**

Run: `node --test --test-name-pattern='ambiguity.*4/5|repeating complete' tests/mcp.test.ts`

Expected: FAIL because the four quiz/Day tools are not registered.

- [ ] **Step 4: Add exact quiz, grade, and reflection schemas**

```ts
const quizQuestionSchema = z.object({
  id: uuidSchema,
  conceptKey: conceptKeySchema,
  conceptLabel: requiredText(300),
  prompt: requiredText(10_000),
  gradingCriteria: requiredText(10_000),
}).strict();
const gradeSchema = z.object({
  questionId: uuidSchema,
  answer: requiredText(50_000),
  result: z.enum(["correct", "incorrect", "needs_clarification"]),
  feedback: requiredText(10_000),
  clarificationQuestion: requiredText(10_000).optional(),
}).strict();
const reflectionSchema = z.object({
  learned: requiredText(10_000),
  confusing: requiredText(10_000),
  feeling: requiredText(10_000),
}).strict();
```

The service remains responsible for cross-field rules such as clarification presence, new remediation prompts, exactly five terminal answers, and a required 5/5 before reflection.

- [ ] **Step 5: Register all four state-machine tools**

```ts
server.registerTool(
  "start_quiz",
  {
    title: "Start the current Day quiz",
    description: "Stores exactly five questions fixed before seeing the learner's answers.",
    inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, questions: z.array(quizQuestionSchema).length(5) }).strict()),
    outputSchema: stateOutputSchema,
    annotations: writeAnnotations,
  },
  async (input) => withSafeInput(input, (value) => stateTool("다섯 문제 퀴즈를 시작했습니다.", (db, root) => startQuiz(db, root, value))),
);

server.registerTool(
  "grade_quiz",
  {
    title: "Grade quiz responses",
    description: "Stores one to five supplied answers, judgments, feedback, and optional clarification without inventing answers.",
    inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, attemptId: uuidSchema, grades: z.array(gradeSchema).min(1).max(5) }).strict()),
    outputSchema: stateOutputSchema,
    annotations: writeAnnotations,
  },
  async (input) => withSafeInput(input, (value) => stateTool("퀴즈 응답과 판정을 저장했습니다.", (db, root) => gradeQuiz(db, root, value))),
);

server.registerTool(
  "start_remediation_quiz",
  {
    title: "Start a new remediation quiz",
    description: "Stores a different explanation and five new questions covering every remediation concept.",
    inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, remediationMarkdown: requiredText(1_000_000), questions: z.array(quizQuestionSchema).length(5) }).strict()),
    outputSchema: stateOutputSchema,
    annotations: writeAnnotations,
  },
  async (input) => withSafeInput(input, (value) => stateTool("새 보충 퀴즈를 시작했습니다.", (db, root) => startRemediationQuiz(db, root, value))),
);

server.registerTool(
  "complete_day",
  {
    title: "Complete the current learning Day",
    description: "Stores three reflections after verified daily research and a passed five-of-five quiz.",
    inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, reflection: reflectionSchema }).strict()),
    outputSchema: stateOutputSchema,
    annotations: writeAnnotations,
  },
  async (input) => withSafeInput(input, (value) => stateTool("오늘의 학습과 회고를 완료했습니다.", (db, root) => completeDay(db, root, value))),
);
```

- [ ] **Step 6: Verify every tool annotation and the complete Day flow**

Assert the final `listTools()` result contains exactly the twelve approved tools. The four read tools must have `readOnlyHint === true`; the eight writes must not. Every tool must have `openWorldHint === false`; only `create_course` has `idempotentHint === true` among writes.

Also prove the safe-validation wrapper did not change the advertised contract:

```ts
const createDefinition = (await client.listTools()).tools.find(({ name }) => name === "create_course")!;
const createInputSchema = createDefinition.inputSchema as { properties?: Record<string, unknown> };
const createProperties = createInputSchema.properties ?? {};
assert.deepEqual(Object.keys(createProperties).sort(), ["goal", "requestId", "title"]);
assert.equal(JSON.stringify(createDefinition.inputSchema).includes('"value"'), false);
assert.equal(JSON.stringify(createDefinition.inputSchema).includes('"ok"'), false);
```

Run:

```bash
node --test tests/mcp.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass; no adapter branch changes stage or revision outside a service call.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/server/mcp.ts tests/mcp.test.ts
git commit -m "feat: expose mastery-gated MCP learning"
```

### Task 6: Explicit repo-scoped `$just-study` skill

**Files:**

- Create: `.agents/skills/just-study/SKILL.md`
- Create: `.agents/skills/just-study/agents/openai.yaml`
- Create: `tests/codex-skill.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: the twelve MCP tool names and state/error contracts from Tasks 1–5, the project MCP ID `just-study`, and Codex's repo skill discovery at `.agents/skills`.
- Produces: explicit `$just-study` and `$just-study 계속` workflows with no scripts, plus static validation that new research is never fabricated when web is unavailable.

- [ ] **Step 1: Initialize the skill with the official skill-creator script**

Run from the worktree root:

```bash
python3 /Users/justin/.codex/skills/.system/skill-creator/scripts/init_skill.py just-study --path .agents/skills --interface 'display_name=Just Study' --interface 'short_description=검증된 30일 학습 과정을 안전하게 만들고 이어갑니다' --interface 'default_prompt=Use $just-study to create or continue a researched 30-day learning course.'
```

Expected: only `.agents/skills/just-study/SKILL.md` and `.agents/skills/just-study/agents/openai.yaml` are created. Do not request `scripts`, `references`, `assets`, or examples.

- [ ] **Step 2: Write failing static contract tests and add them to `npm test`**

Change the test script to:

```json
"test": "node --test tests/platform-foundation.test.ts tests/learning-engine.test.ts tests/mcp.test.ts tests/codex-skill.test.ts"
```

Create `tests/codex-skill.test.ts`:

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const skillRoot = resolve(root, ".agents/skills/just-study");
const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");
const metadata = readFileSync(resolve(skillRoot, "agents/openai.yaml"), "utf8");
const config = readFileSync(resolve(root, ".codex/config.toml"), "utf8");

test("keeps the just-study skill explicit and instruction-only", () => {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1];
  assert.ok(frontmatter);
  assert.match(frontmatter, /^name: just-study$/m);
  assert.match(frontmatter, /^description: .+$/m);
  assert.equal([...frontmatter.matchAll(/^\w+:/gm)].length, 2);
  assert.ok(skill.split("\n").length < 500);
  assert.deepEqual(readdirSync(skillRoot).sort(), ["SKILL.md", "agents"]);
  for (const marker of ["TO" + "DO", "TB" + "D", "FIX" + "ME"])
    assert.equal(skill.includes(marker), false);
  assert.match(metadata, /allow_implicit_invocation: false/);
  assert.match(metadata, /value: "just-study"/);
  assert.match(metadata, /transport: "streamable_http"/);
  assert.match(metadata, /url: "http:\/\/127\.0\.0\.1:3000\/mcp"/);
});

test("names every approved tool and all research safety invariants", () => {
  for (const name of [
    "health", "list_courses", "get_learning_state", "read_learning_document",
    "create_course", "approve_outline", "record_daily_research", "save_checkpoint",
    "start_quiz", "grade_quiz", "start_remediation_quiz", "complete_day",
  ]) assert.match(skill, new RegExp(`\\b${name}\\b`));
  for (const phrase of [
    "never ask the server to browse",
    "Never invent a source",
    "Open every URL before submitting it",
    "latest saved `revision`",
    "Do not replay the write automatically",
    "saved current Day and stage",
    "When web is unavailable",
  ])
    assert.match(skill, new RegExp(phrase));
});

test("keeps project MCP config aligned with the skill dependency", () => {
  assert.match(config, /\[mcp_servers\.just-study\]/);
  assert.match(config, /url = "http:\/\/127\.0\.0\.1:3000\/mcp"/);
  assert.match(config, /required = false/);
  assert.match(config, /default_tools_approval_mode = "writes"/);
  assert.equal(existsSync(resolve(skillRoot, "scripts")), false);
  assert.equal(existsSync(resolve(skillRoot, "references")), false);
  assert.equal(existsSync(resolve(skillRoot, "assets")), false);
});
```

- [ ] **Step 3: Run static tests and observe RED**

Run: `node --test tests/codex-skill.test.ts`

Expected: FAIL because the generated template still contains unfinished instructions and lacks the MCP dependency/policy.

- [ ] **Step 4: Replace the generated `SKILL.md` with the complete instruction-only workflow**

Use this content, keeping only `name` and `description` in frontmatter:

```markdown
---
name: just-study
description: Create or continue a researched 30-Day just-study learning course through the local MCP server. Use only when the user explicitly invokes $just-study or $just-study 계속.
---

# Just Study

Use the local `just-study` MCP as the only source of persisted course state. Perform web research yourself; never ask the server to browse or call a model.

## Invariants

1. Call `health` first. If unavailable, tell the user to run `npm run dev` in the repository and stop.
2. Use the latest saved `revision` for every write except `create_course`.
3. On `REVISION_CONFLICT`, read state again and explain the conflict. Do not replay the write automatically.
4. On `STORAGE_CORRUPT`, stop. Do not overwrite or attempt repair through MCP.
5. Follow the saved current Day and stage. Do not skip research, quiz mastery, remediation, or reflection.
6. Never invent a source, URL, quote, learner answer, grade, approval, or completed activity.

## Choose a flow

Call `list_courses` after health.

- For `$just-study 계속`, show title, status, current Day, and stage. If several courses exist, ask the user to choose one. Then call `get_learning_state` and resume the saved stage.
- For a new course, check for a matching existing course and ask whether to continue it or create another. If no course matches, follow the new-course flow.

## Create a new course

1. Ask for existing knowledge, the concrete Day 30 outcome, and learning preference one question at a time. Reuse answers already supplied by the user.
2. Generate one UUID request ID and reuse it if `create_course` must be called again. Store the draft with the topic as title and the Day 30 outcome as goal.
3. Before searching, write the research questions, the fixed 100-point rubric, and topic-specific selection criteria.
4. Browse actual primary, official, university, standards, and strong educational sources. Open every selected URL. Open every URL before submitting it through `approve_outline` or `record_daily_research`; the matching `openPage` event must exist in the current persisted Codex thread.
5. Score authority 0–25, cross-validation 0–25, relevance 0–20, teaching quality 0–15, currency 0–10, and accessibility 0–5. Rank every candidate. Explain selection and limitations.
6. Support every major claim with at least two selected sources scoring at least 80 and having different independence keys. Record opposition and uncertainty.
7. Build exactly 30 ordered Days. Give each Day one observable objective.
8. Show the research summary, selected sources, limitations, and all 30 objectives. Call `approve_outline` only after the user explicitly approves what was shown.

## Resume by stage

### Lecture

1. If the current Day has no Day research, define its questions and criteria, browse actual sources, cross-check claims, and call `record_daily_research`.
2. Teach recall, precise explanation, ELI5, analogy, worked example, application, and an understanding interview.
3. Ask one understanding question at a time. Record only content actually taught and the user's demonstrated concept status with `save_checkpoint`.
4. When the seven parts are complete, create exactly five distinct questions before showing any of them. Call `start_quiz`, then present the first saved question.

### Quiz

1. Read the saved current attempt and ask the first unanswered saved question.
2. Grade only the user's actual answer against the saved criterion.
3. If ambiguous, use `needs_clarification` with one specific clarification question; ask it and grade the follow-up on the next revision.
4. Call `grade_quiz` after each supplied answer. Continue with the saved next unanswered question.
5. A score of 5/5 moves to reflection. Any lower terminal score moves to remediation.

### Remediation

1. Explain each saved remediation concept in a materially different way with a new analogy or example.
2. Save only `remediationMarkdown` with `save_checkpoint`.
3. Create five new prompts that cover every remediation concept and do not repeat an earlier prompt. Call `start_remediation_quiz` and return to the quiz flow.

### Reflection

Ask what was learned, what remains confusing, and how the learner feels. After all three actual answers exist, call `complete_day`. Report the saved next Day, or course completion after Day 30.

## When web is unavailable

Do not claim new research and do not create URLs. If approved saved sources are relevant, ask whether to reuse them with their known limitations. Only after explicit reuse approval may you submit a Day research bundle containing those saved URLs. If no relevant approved source exists, stop until web access is available.

## Responses

Keep normal responses focused on the current question, teaching step, or decision. Do not dump the full journal unless the user asks; use `read_learning_document` for an explicitly requested long document.
```

- [ ] **Step 5: Replace `agents/openai.yaml` with exact UI/dependency metadata**

```yaml
interface:
  display_name: "Just Study"
  short_description: "검증된 30일 학습 과정을 안전하게 만들고 이어갑니다"
  default_prompt: "Use $just-study to create or continue a researched 30-day learning course."

dependencies:
  tools:
    - type: "mcp"
      value: "just-study"
      description: "Local just-study learning state and persistence tools"
      transport: "streamable_http"
      url: "http://127.0.0.1:3000/mcp"

policy:
  allow_implicit_invocation: false
```

- [ ] **Step 6: Validate the skill with both repository tests and the official validator**

Run:

```bash
node --test tests/codex-skill.test.ts
python3 /Users/justin/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/just-study
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass; the validator reports the skill valid; no extra skill resource directories exist.

- [ ] **Step 7: Commit Task 6**

```bash
git add package.json .agents/skills/just-study/SKILL.md .agents/skills/just-study/agents/openai.yaml tests/codex-skill.test.ts
git commit -m "feat: add the just-study Codex skill"
```

### Task 7: Protocol, restart, and 30-Day MCP acceptance

**Files:**

- Modify: `tests/mcp.test.ts`

**Interfaces:**

- Consumes: the actual `/mcp` `POST`, all twelve tools, `withMcpClient`, and the exact fixture builders introduced in Tasks 4–5.
- Produces: deterministic evidence for modern Streamable HTTP negotiation, restart-safe resume, one remediation cycle, and Day 30 terminal cleanup using MCP calls only.

Update the existing test import before adding terminal-file assertions:

```ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
```

- [ ] **Step 1: Negotiate the current HTTP protocol era in the official client helper**

Construct the test client with explicit negotiation:

```ts
const client = new Client(
  { name: "just-study-test", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
```

After `connect`, assert `client.getProtocolEra() === "modern"`. Keep the fetch override routed through the actual Next `POST`; do not start a socket server or use `InMemoryTransport`.

- [ ] **Step 2: Write a failing restart test at an in-progress clarification**

Create/approve/research/checkpoint/start a quiz and store one `needs_clarification` response through MCP. Close the client and database, clear the global runtime, reopen the same data root, install the reopened database in the runtime, and connect a new client:

```ts
const dataRoot = makeDataRoot();
let db: DatabaseHandle | null = openDatabase(dataRoot);
setTestRuntime(dataRoot, db);
let courseId = "";
let beforeRestart: CompactLearningState | null = null;

try {
  await withMcpClient(async (client) => {
    const ready = await createLectureReadyCourse(client);
    courseId = ready.courseId;
    const questions = quizQuestions("restart");
    const started = structured<StateResult>(await client.callTool({
      name: "start_quiz",
      arguments: { courseId, expectedRevision: 3, questions },
    }));
    const attemptId = started.data.state.quizAttempts.at(-1)!.id;
    const clarified = structured<StateResult>(await client.callTool({
      name: "grade_quiz",
      arguments: {
        courseId,
        expectedRevision: 4,
        attemptId,
        grades: [{
          questionId: questions[0]!.id,
          answer: "정렬한다는 뜻인가요?",
          result: "needs_clarification",
          feedback: "어떤 비용인지 불명확합니다.",
          clarificationQuestion: "시간 비용과 공간 비용 중 무엇을 뜻하나요?",
        }],
      },
    }));
    assert.equal(clarified.data.state.course.revision, 5);
    beforeRestart = clarified.data.state;
  });

  db.close();
  db = null;
  clearTestRuntime();
  db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);

  await withMcpClient(async (client) => {
    const expected = beforeRestart;
    assert.ok(expected);
    const resumed = structured<StateResult>(await client.callTool({
      name: "get_learning_state",
      arguments: { courseId },
    }));
    const attempt = resumed.data.state.quizAttempts.at(-1)!;
    const response = attempt.questions[0]!.responses.at(-1)!;
    assert.equal(resumed.data.state.course.currentStage, "quiz");
    assert.equal(resumed.data.state.course.revision, expected.course.revision);
    assert.equal(resumed.data.state.currentDay?.id, expected.currentDay?.id);
    assert.equal(resumed.data.state.currentDayMarkdown, expected.currentDayMarkdown);
    assert.deepEqual(attempt.questions, expected.quizAttempts.at(-1)!.questions);
    assert.equal(response.result, "needs_clarification");
    assert.equal(response.clarificationQuestion, "시간 비용과 공간 비용 중 무엇을 뜻하나요?");
  });
} finally {
  db?.close();
  clearTestRuntime();
  rmSync(dataRoot, { recursive: true, force: true });
}
```

Expected RED cause before final implementation cleanup: any handler/runtime state accidentally held outside SQLite/Markdown loses the attempt or response.

- [ ] **Step 3: Write the complete 30-Day MCP-only acceptance test**

Use a fresh data root and a separate course. Create and approve through MCP, then drive every Day with this exact sequence:

```ts
const created = structured<{ ok: true; data: { course: { id: string } } }>(
  await client.callTool({
    name: "create_course",
    arguments: {
      requestId: crypto.randomUUID(),
      title: "30일 컴퓨터 과학",
      goal: "30일 동안 핵심 개념을 설명한다.",
    },
  }),
);
const courseId = created.data.course.id;
let state = structured<StateResult>(await client.callTool({
  name: "approve_outline",
  arguments: {
    courseId,
    expectedRevision: 0,
    priorKnowledge: "기초 용어만 안다.",
    learningPreference: "examples",
    knowledgeMapMarkdown: "기초 → 자료구조 → 시스템 → 적용",
    research: validResearch("컴퓨터 과학 30일 과정"),
    days: Array.from({ length: 30 }, (_, index) => ({ objective: `Day ${index + 1} 목표를 설명한다` })),
  },
})).data.state;
assert.equal(state.course.revision, 1);

for (let dayNumber = 1; dayNumber <= 30; dayNumber += 1) {
  state = structured<StateResult>(await client.callTool({
    name: "get_learning_state",
    arguments: { courseId },
  })).data.state;
  assert.equal(state.currentDay?.dayNumber, dayNumber);
  assert.equal(state.course.currentStage, "lecture");

  state = structured<StateResult>(await client.callTool({
    name: "record_daily_research",
    arguments: { courseId, expectedRevision: state.course.revision, research: validResearch(`Day ${dayNumber}`) },
  })).data.state;
  state = structured<StateResult>(await client.callTool({
    name: "save_checkpoint",
    arguments: {
      courseId,
      expectedRevision: state.course.revision,
      lesson: fullLesson,
      understoodConcepts: [{ key: `day-${dayNumber}-known`, label: `Day ${dayNumber} 이해 개념` }],
      remediationConcepts: [],
    },
  })).data.state;

  const questions = quizQuestions(`day-${dayNumber}`);
  state = structured<StateResult>(await client.callTool({
    name: "start_quiz",
    arguments: { courseId, expectedRevision: state.course.revision, questions },
  })).data.state;
  const attemptId = state.quizAttempts.at(-1)!.id;
  state = structured<StateResult>(await client.callTool({
    name: "grade_quiz",
    arguments: { courseId, expectedRevision: state.course.revision, attemptId, grades: terminalGrades(questions, null) },
  })).data.state;
  assert.equal(state.course.currentStage, "reflection");

  state = structured<StateResult>(await client.callTool({
    name: "complete_day",
    arguments: {
      courseId,
      expectedRevision: state.course.revision,
      reflection: {
        learned: `Day ${dayNumber}의 핵심 원리`,
        confusing: "추가 예제로 계속 확인한다.",
        feeling: "다음 단계로 진행할 준비가 됐다.",
      },
    },
  })).data.state;
}
```

After the loop assert:

```ts
assert.equal(state.course.status, "completed");
assert.equal(state.course.currentDayId, null);
assert.equal(state.course.currentStage, null);
assert.equal(state.currentDay, null);
assert.equal(state.days.length, 30);
assert.equal(state.days.every(({ completedAt }) => completedAt !== null), true);
assert.equal(state.course.revision, 151);
assert.equal(existsSync(join(dataRoot, "courses", courseId, "current-day.md")), false);
const health = structured<{ ok: true; data: { ok: boolean; corruptCourseIds: string[]; temporaryEntries: string[] } }>(
  await client.callTool({ name: "health", arguments: {} }),
);
assert.equal(health.data.ok, true);
assert.deepEqual(health.data.corruptCourseIds, []);
assert.deepEqual(health.data.temporaryEntries, []);
```

- [ ] **Step 4: Add a table-driven schema rejection matrix for every tool**

Create `test("schema rejection matrix rejects without mutation", { concurrency: false }, async () => { ... })` with the same fresh data-root/runtime setup and `finally` cleanup as Task 2. Put the following body inside its `withMcpClient(async (client) => { ... })` callback. These are validation fixtures only; the write fixtures intentionally reference a nonexistent UUID because the strict-schema rejection must happen before any service callback:

```ts
const courseId = crypto.randomUUID();
const attemptId = crypto.randomUUID();
const research = validResearch("schema matrix");
const questions = quizQuestions("schema");
const validShapes: Record<string, Record<string, unknown>> = {
  health: {},
  list_courses: {},
  get_learning_state: { courseId },
  read_learning_document: { courseId, document: "course" },
  create_course: { requestId: crypto.randomUUID(), title: "스키마", goal: "경계를 검증한다." },
  approve_outline: {
    courseId,
    expectedRevision: 0,
    priorKnowledge: "기초",
    learningPreference: "examples",
    knowledgeMapMarkdown: "기초 → 적용",
    research,
    days: Array.from({ length: 30 }, (_, index) => ({ objective: `목표 ${index + 1}` })),
  },
  record_daily_research: { courseId, expectedRevision: 0, research },
  save_checkpoint: {
    courseId,
    expectedRevision: 0,
    lesson: fullLesson,
    understoodConcepts: [],
    remediationConcepts: [],
  },
  start_quiz: { courseId, expectedRevision: 0, questions },
  grade_quiz: {
    courseId,
    expectedRevision: 0,
    attemptId,
    grades: [{
      questionId: questions[0]!.id,
      answer: "답변",
      result: "correct",
      feedback: "피드백",
    }],
  },
  start_remediation_quiz: {
    courseId,
    expectedRevision: 0,
    remediationMarkdown: "다른 설명",
    questions,
  },
  complete_day: {
    courseId,
    expectedRevision: 0,
    reflection: { learned: "배운 점", confusing: "헷갈린 점", feeling: "느낀 점" },
  },
};

async function assertSchemaRejected(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
  label: string,
): Promise<void> {
  const result = await client.callTool({ name, arguments: arguments_ });
  assert.equal(result.isError, true, label);
  assert.deepEqual(result.structuredContent, {
    ok: false,
    error: {
      code: "VALIDATION",
      message: "요청 형식이 올바르지 않습니다.",
      retryable: false,
    },
  }, label);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SQLITE"), false, label);
  assert.equal(serialized.includes("/private/"), false, label);
  assert.equal(serialized.includes("../../secret"), false, label);
  assert.equal(serialized.includes("unexpected"), false, label);
}

const approvedNames = [
  "approve_outline", "complete_day", "create_course", "get_learning_state",
  "grade_quiz", "health", "list_courses", "read_learning_document",
  "record_daily_research", "save_checkpoint", "start_quiz",
  "start_remediation_quiz",
];
assert.deepEqual(Object.keys(validShapes).sort(), approvedNames);

for (const [name, arguments_] of Object.entries(validShapes)) {
  await assertSchemaRejected(client, name, { ...arguments_, unexpected: true }, `${name}: strict object`);
}

for (const [name, arguments_] of [
  ["get_learning_state", { courseId: 7 }],
  ["read_learning_document", { courseId: 7, document: "course" }],
  ["create_course", { ...validShapes.create_course, requestId: 7 }],
  ["approve_outline", { ...validShapes.approve_outline, courseId: 7 }],
  ["record_daily_research", { ...validShapes.record_daily_research, courseId: 7 }],
  ["save_checkpoint", { ...validShapes.save_checkpoint, courseId: 7 }],
  ["start_quiz", { ...validShapes.start_quiz, courseId: 7 }],
  ["grade_quiz", { ...validShapes.grade_quiz, courseId: 7 }],
  ["start_remediation_quiz", { ...validShapes.start_remediation_quiz, courseId: 7 }],
  ["complete_day", { ...validShapes.complete_day, courseId: 7 }],
] as const) {
  await assertSchemaRejected(client, name, arguments_, `${name}: wrong type`);
}

for (const [name, arguments_] of [
  ["read_learning_document", { courseId, document: "../../secret" }],
  ["create_course", { ...validShapes.create_course, title: "x".repeat(121) }],
  ["approve_outline", {
    ...validShapes.approve_outline,
    days: Array.from({ length: 31 }, (_, index) => ({ objective: `목표 ${index + 1}` })),
  }],
  ["record_daily_research", {
    ...validShapes.record_daily_research,
    research: { ...research, questions: Array.from({ length: 21 }, (_, index) => `질문 ${index + 1}`) },
  }],
  ["save_checkpoint", {
    ...validShapes.save_checkpoint,
    understoodConcepts: Array.from({ length: 101 }, (_, index) => ({ key: `key-${index}`, label: `개념 ${index}` })),
  }],
  ["start_quiz", { ...validShapes.start_quiz, questions: questions.slice(0, 4) }],
  ["grade_quiz", { ...validShapes.grade_quiz, grades: [] }],
  ["start_remediation_quiz", {
    ...validShapes.start_remediation_quiz,
    questions: [...questions, { ...questions[0]!, id: crypto.randomUUID(), conceptKey: "schema-6" }],
  }],
  ["complete_day", {
    ...validShapes.complete_day,
    reflection: { learned: "x".repeat(10_001), confusing: "y", feeling: "z" },
  }],
] as const) {
  await assertSchemaRejected(client, name, arguments_, `${name}: boundary`);
}

const listed = structured<{ ok: true; data: { courses: unknown[] } }>(
  await client.callTool({ name: "list_courses", arguments: {} }),
);
assert.deepEqual(listed.data.courses, []);
```

`health` and `list_courses` have no typed fields or numeric/string boundaries, so their applicable schema boundary is strict rejection of any key. Task 2 owns raw malformed JSON and 8 MiB transport cases. Every normal success in Tasks 3–5 and the 30-Day test passes through its registered `outputSchema`; keep the SDK's output validation enabled and assert structured output on each call. The `safeInputSchema` wrapper must continue advertising the underlying strict Zod JSON Schema while converting validation failure to an opaque sentinel; never expose the SDK's raw `parseResult.error` text.

- [ ] **Step 5: Run the new tests and observe any RED failure before fixing**

Run:

```bash
node --test --test-name-pattern='protocol era|restart|30-Day MCP-only|schema rejection matrix' tests/mcp.test.ts
```

Expected: either PASS immediately because Tasks 1–6 implemented the contract correctly, or a focused RED exposing leaked session state, schema mismatch, revision drift, or terminal cleanup. If it passes immediately, record that this task adds acceptance coverage rather than production code.

- [ ] **Step 6: Fix only the root contract violation, if any**

Trace the failing tool to `src/server/mcp.ts`, the route boundary, or the existing service. Do not weaken the assertion, increase timeouts, add session state, or bypass a service rule. Run the focused test after each minimal fix.

- [ ] **Step 7: Run the full deterministic quality gate**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Expected: every test passes, lint/typecheck/build pass, and status contains only intentional Task 7 files. If build changes `next-env.d.ts`, `tsconfig.json`, or `tsconfig.tsbuildinfo`, inspect each diff and remove only generated changes with `apply_patch`; never use checkout/reset.

- [ ] **Step 8: Commit Task 7**

```bash
git add tests/mcp.test.ts
git commit -m "test: verify the complete MCP learning flow"
```

If a minimal production fix was required, include only its exact file in the same commit and explain it in the task ledger.

### Task 8: Real Codex acceptance, operator documentation, and phase QA

**Files:**

- Modify: `README.md`
- Verify only: `.codex/config.toml`
- Verify only: `.agents/skills/just-study/SKILL.md`
- Verify only: temporary `JUST_STUDY_DATA_DIR` outside the repository

**Interfaces:**

- Consumes: a running localhost application, project-scoped MCP config, explicit `$just-study` skill, Codex CLI, and all deterministic evidence.
- Produces: real web-disabled, web-enabled, and fresh-conversation resume evidence; accurate operator instructions; independent scored QA >=95/100.

- [ ] **Step 1: Write the README acceptance contract first**

Add concise sections with these exact facts and commands:

````markdown
## Codex learning workflow

Start the localhost application:

```bash
npm run dev
```

From a trusted Codex session opened in this repository, invoke `$just-study` to create a course or `$just-study 계속` to resume. The project config connects Codex to `http://127.0.0.1:3000/mcp`; write tools ask for approval. If the server is stopped, the skill reports the command above instead of fabricating progress.

The default self-host mode is single-user and localhost-only. It has no signup, account, login, OAuth, remote binding, or server-side model/API key. Codex performs web research and stores only the URLs and claims it supplies through MCP.
````

Keep the existing install, data directory, recovery, and verification sections. Add the twelve tool names in one compact table grouped into four reads and eight writes.

- [ ] **Step 2: Verify the web-unavailable behavior with a real Codex process**

Use one dedicated shell for this whole task. Create separate temporary data and transcript roots, enable pipeline failure propagation, fail if port 3000 is already occupied, start Next directly on the configured host/port with the exact generated data-root value, and record both the exact supervisor and listener PIDs:

```bash
set -o pipefail
justStudyDataRoot="$(mktemp -d /private/tmp/just-study-codex-acceptance.XXXXXX)"
justStudyTranscriptRoot="$(mktemp -d /private/tmp/just-study-codex-transcripts.XXXXXX)"
case "$justStudyDataRoot" in /private/tmp/just-study-codex-acceptance.*) ;; *) exit 1 ;; esac
case "$justStudyTranscriptRoot" in /private/tmp/just-study-codex-transcripts.*) ;; *) exit 1 ;; esac
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then exit 1; fi
env JUST_STUDY_DATA_DIR="$justStudyDataRoot" node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000 >"$justStudyTranscriptRoot/dev-server.log" 2>&1 &
justStudySupervisorPid=$!
curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
justStudyListenerPid="$(lsof -nP -t -iTCP:3000 -sTCP:LISTEN)"
case "$justStudyListenerPid" in ''|*$'\n'*) exit 1 ;; esac
test "$(ps -o ppid= -p "$justStudyListenerPid" | tr -d '[:space:]')" = "$justStudySupervisorPid"
typeset -p justStudyDataRoot justStudyTranscriptRoot justStudySupervisorPid justStudyListenerPid
```

Record the two printed/resolved absolute roots and both PIDs in the task ledger. The empty-port precondition plus the direct parent check prove that the tested listener is the worker created by this exact Next process, not an unrelated app. Do not set a test bypass, auth value, model key, or any other application variable.

First verify that the running Next route, not only the imported module, rejects unsupported methods and non-local request metadata before Codex connects:

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/mcp)" = 405
test "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE http://127.0.0.1:3000/mcp)" = 405
test "$(curl -sS -o /dev/null -w '%{http_code}' -X OPTIONS http://127.0.0.1:3000/mcp)" = 405
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: evil.test' -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:3000/mcp)" = 403
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Origin: http://evil.test' -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:3000/mcp)" = 403
curl -sS -D "$justStudyTranscriptRoot/local-headers.txt" -o /dev/null -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:3000/mcp
curl -sS -D "$justStudyTranscriptRoot/rejected-origin-headers.txt" -o /dev/null -H 'Origin: http://evil.test' -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:3000/mcp
if rg -qi '^access-control-allow-origin:' "$justStudyTranscriptRoot/local-headers.txt" "$justStudyTranscriptRoot/rejected-origin-headers.txt"; then exit 1; fi
```

Expected: every command exits zero, the temporary database remains empty, and no response carries `Access-Control-Allow-Origin`.

Then run from the worktree:

```bash
codex exec --ephemeral --sandbox read-only --json -c 'web_search="disabled"' -c 'mcp_servers.just-study.default_tools_approval_mode="approve"' '$just-study 새 과정을 시작해. 주제는 운영체제, 기존 지식은 프로세스와 스레드의 이름만 아는 수준, Day 30 목표는 작은 스케줄러의 선택을 설명하는 것, 선호 방식은 examples다. 제공한 답을 다시 묻지 말고 웹을 사용할 수 없는 규칙을 그대로 지켜라.' | tee "$justStudyTranscriptRoot/web-disabled.jsonl"
```

Expected transcript and stored state:

- The skill calls `health` and checks/creates a draft through the configured MCP server.
- It does not claim research succeeded, invent a URL, call `approve_outline`, or advance beyond draft.
- It asks to wait for web or to reuse a relevant approved saved source; because this fresh root has none, it stops.

- [ ] **Step 3: Verify actual web research and explicit outline approval**

Run a non-ephemeral fresh Codex process against the same data root:

```bash
codex exec --sandbox read-only --json -c 'web_search="live"' -c 'mcp_servers.just-study.default_tools_approval_mode="approve"' '$just-study 운영체제 과정을 이어서 설계해. 실제 웹 자료를 조사하고 30개 Day 목차와 출처 평가를 보여준 뒤 내 승인을 기다려.' | tee "$justStudyTranscriptRoot/web-enabled-outline.jsonl"
```

Inspect the transcript before continuing: it must contain actual web tool results, scored selected sources, limitations, two independent supports for major claims, and exactly 30 single-objective Days; it must not yet call `approve_outline`. Then run immediately in the same worktree:

```bash
justStudyOutlineThreadId="$(node -e '
const fs = require("node:fs");
const events = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
const id = events.find((event) => event.type === "thread.started")?.thread_id;
if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id ?? "")) process.exit(1);
process.stdout.write(id);
' "$justStudyTranscriptRoot/web-enabled-outline.jsonl")"
codex exec resume "$justStudyOutlineThreadId" --json '제시한 출처 평가와 30개 Day 목차를 승인한다.' | tee "$justStudyTranscriptRoot/outline-approval.jsonl"
```

Expected: the extracted UUID resumes exactly the thread whose outline was inspected, exactly one `approve_outline` call uses only URLs opened in that thread, and state advances to active Day 1 lecture. If the first process did not produce acceptable research or a complete outline, do not send approval; fix the skill and repeat with a new temp root.

- [ ] **Step 4: Verify a web-researched Day and fresh-conversation resume**

Run:

```bash
codex exec --sandbox read-only --json -c 'web_search="live"' -c 'mcp_servers.just-study.default_tools_approval_mode="approve"' '$just-study 계속. 저장된 운영체제 과정의 Day 1을 실제 웹 조사부터 시작하고, 첫 이해 확인 질문을 한 뒤 기다려.' | tee "$justStudyTranscriptRoot/day-1.jsonl"
```

Expected: the process reads saved Day 1, performs real web calls, sends only observed URLs to `record_daily_research`, saves actually taught content, asks one question, and does not invent the learner's answer.

Start one more new ephemeral process:

```bash
codex exec --ephemeral --sandbox read-only --json -c 'web_search="disabled"' '$just-study 계속. 저장된 과정의 제목, 현재 Day, stage, revision, 마지막으로 실제 저장된 질문만 요약하고 어떤 쓰기도 하지 마.' | tee "$justStudyTranscriptRoot/fresh-resume.jsonl"
```

Expected: the new process restores exactly the state stored by the prior process.

Codex CLI 0.144.1 JSONL omits raw search result lists but retains `web_search.action` and completed MCP arguments. Because the skill requires every selected URL to be opened first, compare submitted URLs against `openPage` events and save a machine-readable report:

```bash
node -e '
const fs = require("node:fs");
const read = (path) => fs.readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const opened = (events) => new Set(events.flatMap(({item}) =>
  ["web_search", "web_search_call"].includes(item?.type) && ["openPage", "open_page"].includes(item.action?.type) && typeof item.action.url === "string"
    ? [item.action.url] : []));
const submitted = (events, tool) => new Set(events.flatMap(({item}) => {
  if (item?.type !== "mcp_tool_call" || item.tool !== tool || item.status !== "completed") return [];
  return JSON.stringify(item.arguments).match(/https?:\/\/[^"\s]+/g) ?? [];
}));
const check = (openEvents, writeEvents, tool) => {
  const seen = opened(openEvents);
  const saved = submitted(writeEvents, tool);
  const missing = [...saved].filter((url) => !seen.has(url));
  if (saved.size === 0 || missing.length > 0) process.exitCode = 1;
  return {tool, opened: [...seen].sort(), submitted: [...saved].sort(), missing};
};
const report = [
  check(read(process.argv[1]), read(process.argv[2]), "approve_outline"),
  check(read(process.argv[3]), read(process.argv[3]), "record_daily_research"),
];
fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + "\n");
' "$justStudyTranscriptRoot/web-enabled-outline.jsonl" "$justStudyTranscriptRoot/outline-approval.jsonl" "$justStudyTranscriptRoot/day-1.jsonl" "$justStudyTranscriptRoot/url-provenance.json"
test -s "$justStudyTranscriptRoot/url-provenance.json"
```

Expected: exit zero; both report entries contain at least one submitted URL and an empty `missing` array. Thus every stored outline/Day research URL was actually opened by the matching Codex research thread and no synthetic submitted URL passed the gate.

- [ ] **Step 5: Handle real-Codex blockers honestly**

If Codex authentication, model access, live web, project trust, MCP write approval, or external network permission is unavailable, keep the phase incomplete and report the exact failing command/output. Do not replace this gate with a mocked model, copied URLs, manual SQL, a server-side API key, or a weaker static assertion.

- [ ] **Step 6: Finish README verification and stop the exact temporary server**

Run:

```bash
{
  npm test
  npm run lint
  npx tsc --noEmit
  npm run build
  git diff --check
} 2>&1 | tee "$justStudyTranscriptRoot/deterministic-verification.log"
```

With `set -o pipefail` still active, any command failure fails the pipeline while preserving its raw output. Stop `justStudySupervisorPid` from Step 2 and confirm that both the exact supervisor and its validated listener are gone. Keep both validated temporary roots until Step 8 finishes so the independent reviewer can inspect `dev-server.log`, `deterministic-verification.log`, `url-provenance.json`, all five JSONL transcripts, and the resulting data. Do not leave the server running or delete evidence early.

```bash
kill "$justStudySupervisorPid"
wait "$justStudySupervisorPid" || true
for pid in "$justStudySupervisorPid" "$justStudyListenerPid"; do
  if kill -0 "$pid" 2>/dev/null; then exit 1; fi
done
```

- [ ] **Step 7: Commit operator documentation**

```bash
git add README.md
git commit -m "docs: document the Codex learning workflow"
```

- [ ] **Step 8: Run fresh independent phase review and enforce the rubric**

Dispatch a new `gpt-5.6-terra` reviewer with `xhigh` reasoning and no inherited implementation discussion. Give it only the approved design, this plan, the phase commit range, the exact `justStudyTranscriptRoot` path with `dev-server.log`, `deterministic-verification.log`, `url-provenance.json`, and all five JSONL files, plus the exact acceptance data root. Require:

```text
Product behavior: 30
Protocol and data integrity: 20
Security and error safety: 20
Skill intent and source fidelity: 15
Regression and operations: 10
Simplicity/YAGNI: 5
Pass: >=95/100, Critical 0, Important 0
```

If it reports any Critical or Important finding, dispatch a fresh implementation agent to reproduce and fix it with TDD, rerun the complete deterministic and actual-Codex gates, then use a different fresh reviewer. Minor findings must either be fixed or explicitly justified against the approved scope before phase acceptance.

- [ ] **Step 9: Clean acceptance evidence and merge only after the phase is green**

After the independent review passes, revalidate that the recorded roots begin exactly with `/private/tmp/just-study-codex-acceptance.` and `/private/tmp/just-study-codex-transcripts.`. Delete only those two exact directories and report that their test data/transcripts are unrecoverable. Do not use a broad variable, unresolved value, glob, workspace path, or home directory.

Then review `git log`, `git status`, and the complete diff from the worktree branch point. Use the `finishing-a-development-branch` skill to present local merge/keep/discard options. Do not push, create a PR, deploy, or mark the end-to-end product goal complete; the dashboard, management/PDF, self-host, and final cross-phase E2E phases remain.

## Final Evidence Checklist

- [ ] Twelve MCP tools are discoverable through the official client and actual Codex.
- [ ] Four reads and eight writes carry correct annotations; no server tool is open-world.
- [ ] `maxSubscriptions: 0` rejects `subscriptions/listen` without opening an SSE stream.
- [ ] Host, Origin, method, media type, malformed JSON/schema, and >8 MiB bodies fail before mutation.
- [ ] Known service/storage errors map to safe codes; unknown errors leak no internals.
- [ ] Duplicate `requestId` returns one course; stale revisions never auto-retry.
- [ ] Restart preserves exact Day, stage, questions, responses, Markdown, and revision.
- [ ] Day 1 covers clarification, 4/5, remediation, new questions, 5/5, and reflection.
- [ ] A separate MCP-only course completes exactly 30 Days with no Day 31 or current-Day residue.
- [ ] `$just-study` is explicit-only, instruction-only, validator-clean, and contains no scaffolding marker.
- [ ] Web-disabled Codex invents no source; web-enabled stored URLs are a subset of observed tool URLs.
- [ ] Local operation has no login/account/auth, CORS, remote binding, secret, or server-side model call.
- [ ] Focused tests, full tests, lint, typecheck, build, and diff checks pass from a clean worktree.
- [ ] Independent score is >=95/100 with Critical 0 and Important 0.
