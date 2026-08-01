import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { CourseValidationError, UUID_PATTERN, createCourse } from "../src/server/courses.ts";
import { openDatabase } from "../src/server/database.ts";
import type { DatabaseHandle } from "../src/server/database.ts";
import * as mcpRoute from "../src/app/mcp/route.ts";
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
  type CompactLearningState,
} from "../src/server/mcp.ts";
import { DatabaseUnavailableError, getReadOnlyRuntime } from "../src/server/runtime.ts";
import { StorageError } from "../src/server/storage.ts";

function makeDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "just-study-mcp-"));
}

function snapshotRootFiles(dataRoot: string): Record<string, { sha256: string; mtimeNs: string }> {
  return Object.fromEntries(
    readdirSync(dataRoot)
      .sort()
      .flatMap((name) => {
        const path = join(dataRoot, name);
        const stat = statSync(path, { bigint: true });
        if (!stat.isFile()) return [];
        return [[name, {
          sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
          mtimeNs: stat.mtimeNs.toString(),
        }] as const];
      }),
  );
}

function snapshotTreeFiles(dataRoot: string): Record<string, { sha256: string; mtimeNs: string }> {
  const snapshot: Record<string, { sha256: string; mtimeNs: string }> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const stat = statSync(path, { bigint: true });
        snapshot[path.slice(dataRoot.length + 1)] = {
          sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
          mtimeNs: stat.mtimeNs.toString(),
        };
      }
    }
  };
  visit(dataRoot);
  return snapshot;
}

function makeWalResidue(title: string): { dataRoot: string; sourceRoot: string } {
  const sourceRoot = makeDataRoot();
  const dataRoot = makeDataRoot();
  const writer = openDatabase(sourceRoot);
  const course = createCourse(writer, sourceRoot, {
    requestId: crypto.randomUUID(),
    title,
    goal: "유효한 로컬 MCP 읽기가 저장 상태를 복구한다.",
  }).course;

  for (const name of ["just-study.sqlite", "just-study.sqlite-wal", "just-study.sqlite-shm"]) {
    copyFileSync(join(sourceRoot, name), join(dataRoot, name));
  }
  mkdirSync(join(dataRoot, "courses", course.id), { recursive: true });
  copyFileSync(join(sourceRoot, course.markdownPath), join(dataRoot, course.markdownPath));
  writer.close();
  return { dataRoot, sourceRoot };
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

type TestRuntimeGlobal = typeof globalThis & {
  __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
};

function setTestRuntime(dataRoot: string, db: DatabaseHandle | null): void {
  (globalThis as TestRuntimeGlobal).__justStudyRuntime = { dataRoot, db };
}

function clearTestRuntime(): void {
  delete (globalThis as TestRuntimeGlobal).__justStudyRuntime;
}

function closeAndClearTestRuntime(): void {
  const runtime = (globalThis as TestRuntimeGlobal).__justStudyRuntime;
  if (runtime?.db?.open) runtime.db.close();
  clearTestRuntime();
}

async function loadStartupInitializer(): Promise<{ initializeExistingRuntime?: () => void }> {
  return import("../src/server/runtime.ts") as Promise<{ initializeExistingRuntime?: () => void }>;
}

async function loadInstrumentation(): Promise<{ register?: () => Promise<void> }> {
  return import("../src/instrumentation.ts") as Promise<{ register?: () => Promise<void> }>;
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

test("rejects a streamed body exceeding the byte bound with no declared Content-Length", { concurrency: false }, async () => {
  clearTestRuntime();
  // A Uint8Array body lets fetch compute an exact Content-Length, which is only
  // caught by boundedBody's declared-length pre-check. A ReadableStream body has
  // no known length, so this exercises the actual streaming-loop bound instead.
  // Keep this memory-sane: a few small chunks that together exceed 8 MiB is
  // enough to prove the loop aborts partway rather than buffering everything.
  const chunkBytes = 2 * 1024 * 1024;
  const chunksAvailable = 10; // 20 MiB available if the loop never stopped early
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls >= chunksAvailable) {
        controller.close();
        return;
      }
      pulls += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
  });
  const request = new Request("http://127.0.0.1:3000/mcp", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal(request.headers.has("content-length"), false);

  const response = await mcpRoute.POST(request);
  assert.equal(response.status, 413);
  assert.ok(pulls < chunksAvailable, "the loop must abort before consuming the whole stream");
  assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
});

test("rejects Sec-Fetch-Site: cross-site before MCP parsing", async () => {
  clearTestRuntime();
  const response = await mcpRoute.POST(mcpRequest("{}", { "sec-fetch-site": "cross-site" }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
});

test("rejects malformed JSON before any tool mutation", async () => {
  clearTestRuntime();
  const response = await mcpRoute.POST(mcpRequest("{", {
    accept: "application/json, text/event-stream",
  }));
  const body = await response.text();
  assert.equal(response.status, 400);
  assert.equal(body.includes("/private/"), false);
  assert.equal(body.includes("SQLITE"), false);
  assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
});

test("rejected MCP requests leave a closed WAL store uninitialized and unchanged", { concurrency: false }, async () => {
  const { dataRoot, sourceRoot } = makeWalResidue("Rejected request boundary");
  const previous = process.env.JUST_STUDY_DATA_DIR;
  process.env.JUST_STUDY_DATA_DIR = dataRoot;
  closeAndClearTestRuntime();
  const before = snapshotTreeFiles(dataRoot);

  try {
    const cases = [
      [403, mcpRequest("{}", { host: "example.com" })],
      [403, mcpRequest("{}", { origin: "http://evil.test" })],
      [403, mcpRequest("{}", { "sec-fetch-site": "cross-site" })],
      [415, mcpRequest("{}", { "content-type": "text/plain" })],
      [413, mcpRequest("{}", { "content-length": String(8 * 1024 * 1024 + 1) })],
      [400, mcpRequest("{", { accept: "application/json, text/event-stream" })],
    ] as const;

    for (const [status, request] of cases) {
      assert.equal((await mcpRoute.POST(request)).status, status);
      assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
      assert.deepEqual(snapshotTreeFiles(dataRoot), before);
    }
  } finally {
    closeAndClearTestRuntime();
    if (previous === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previous;
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
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

async function withDirectMcpClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1:3000/mcp"),
    { fetch: (input, init) => mcpHandler.fetch(new Request(input, init)) },
  );
  const client = new Client(
    { name: "just-study-direct-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

test("valid local MCP reads initialize a closed WAL store once", { concurrency: false }, async () => {
  const { dataRoot, sourceRoot } = makeWalResidue("MCP warm worker");
  const previous = process.env.JUST_STUDY_DATA_DIR;
  process.env.JUST_STUDY_DATA_DIR = dataRoot;
  closeAndClearTestRuntime();

  try {
    await withMcpClient(async (client) => {
      const first = structured<{ ok: true; data: { ok: boolean; state: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(first.data.ok, true);
      assert.equal(first.data.state, "ready");
      assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime?.db?.open, true);

      const afterFirst = snapshotTreeFiles(dataRoot);
      const second = structured<{ ok: true; data: { ok: boolean; state: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(second.data.state, "ready");
      assert.deepEqual(snapshotTreeFiles(dataRoot), afterFirst);
    });
  } finally {
    closeAndClearTestRuntime();
    if (previous === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previous;
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("startup registration leaves an empty root uninitialized until create_course", { concurrency: false }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "just-study-mcp-startup-empty-"));
  const dataRoot = join(parent, "data");
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  const previousRuntime = process.env.NEXT_RUNTIME;
  closeAndClearTestRuntime();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;
  process.env.NEXT_RUNTIME = "nodejs";

  try {
    const instrumentation = await loadInstrumentation();
    assert.equal(typeof instrumentation.register, "function");
    await instrumentation.register?.();
    assert.equal(existsSync(dataRoot), false);
    assert.deepEqual(readdirSync(parent), []);

    await withMcpClient(async (client) => {
      const health = structured<{ ok: true; data: { ok: boolean; state: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(health.data.ok, true);
      assert.equal(health.data.state, "uninitialized");
      assert.deepEqual(structured<{ ok: true; data: { courses: unknown[] } }>(
        await client.callTool({ name: "list_courses", arguments: {} }),
      ).data.courses, []);

      const created = structured<{ ok: true; data: { created: boolean } }>(
        await client.callTool({
          name: "create_course",
          arguments: {
            requestId: crypto.randomUUID(),
            title: "첫 시작 과정",
            goal: "비어 있는 저장소를 승인된 쓰기로만 초기화한다.",
          },
        }),
      );
      assert.equal(created.data.created, true);
    });
    assert.equal(existsSync(join(dataRoot, "just-study.sqlite")), true);
  } finally {
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    if (previousRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = previousRuntime;
    closeAndClearTestRuntime();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("startup initializer recovers a WAL store once and pins stable MCP reads", { concurrency: false }, async () => {
  const sourceRoot = makeDataRoot();
  const residueRoot = makeDataRoot();
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  const writer = openDatabase(sourceRoot);
  const course = createCourse(writer, sourceRoot, {
    requestId: crypto.randomUUID(),
    title: "재시작 복구 과정",
    goal: "WAL 저장소가 재시작 후에도 읽혀야 한다.",
  }).course;

  try {
    for (const name of ["just-study.sqlite", "just-study.sqlite-wal", "just-study.sqlite-shm"]) {
      assert.ok(existsSync(join(sourceRoot, name)), `${name} fixture`);
      copyFileSync(join(sourceRoot, name), join(residueRoot, name));
    }
    mkdirSync(join(residueRoot, "courses", course.id), { recursive: true });
    copyFileSync(
      join(sourceRoot, course.markdownPath),
      join(residueRoot, course.markdownPath),
    );
    writer.close();
    closeAndClearTestRuntime();
    process.env.JUST_STUDY_DATA_DIR = residueRoot;

    const unpinnedBefore = snapshotRootFiles(residueRoot);
    const unpinnedRuntime = getReadOnlyRuntime();
    assert.equal(unpinnedRuntime.db, null);
    unpinnedRuntime.close();
    assert.deepEqual(snapshotRootFiles(residueRoot), unpinnedBefore);

    const runtime = await loadStartupInitializer();
    assert.equal(typeof runtime.initializeExistingRuntime, "function");
    runtime.initializeExistingRuntime?.();
    const afterStartup = snapshotRootFiles(residueRoot);

    await withMcpClient(async (client) => {
      const health = structured<{ ok: true; data: { ok: boolean; state: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(health.data.ok, true);
      assert.equal(health.data.state, "ready");
      assert.deepEqual(structured<{ ok: true; data: { courses: { id: string }[] } }>(
        await client.callTool({ name: "list_courses", arguments: {} }),
      ).data.courses.map(({ id }) => id), [course.id]);
      assert.equal(structured<{ ok: true; data: { state: { course: { id: string } } } }>(
        await client.callTool({ name: "get_learning_state", arguments: { courseId: course.id } }),
      ).data.state.course.id, course.id);
      assert.match(structured<{ ok: true; data: { markdown: string } }>(
        await client.callTool({ name: "read_learning_document", arguments: { courseId: course.id, document: "course" } }),
      ).data.markdown, /재시작 복구 과정/);
    });
    assert.deepEqual(snapshotRootFiles(residueRoot), afterStartup);
  } finally {
    if (writer.open) writer.close();
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    closeAndClearTestRuntime();
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(residueRoot, { recursive: true, force: true });
  }
});

test("startup initialization preserves a corrupt main database as recovery required", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  writeFileSync(join(dataRoot, "just-study.sqlite"), "not a SQLite database", "utf8");
  closeAndClearTestRuntime();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;

  try {
    const before = snapshotRootFiles(dataRoot);
    const runtime = await loadStartupInitializer();
    assert.equal(typeof runtime.initializeExistingRuntime, "function");
    runtime.initializeExistingRuntime?.();
    assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime?.db, null);
    assert.deepEqual(snapshotRootFiles(dataRoot), before);

    await withMcpClient(async (client) => {
      const health = structured<{ ok: true; data: { ok: boolean; state: string; database: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(health.data.ok, false);
      assert.equal(health.data.state, "recovery_required");
      assert.equal(health.data.database, "error");
    });
    assert.deepEqual(snapshotRootFiles(dataRoot), before);
  } finally {
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    closeAndClearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("repeated Node startup registration is idempotent", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  const previousRuntime = process.env.NEXT_RUNTIME;
  const db = openDatabase(dataRoot);
  db.close();
  closeAndClearTestRuntime();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;
  process.env.NEXT_RUNTIME = "nodejs";

  try {
    const instrumentation = await loadInstrumentation();
    assert.equal(typeof instrumentation.register, "function");
    await instrumentation.register?.();
    const firstRuntime = (globalThis as TestRuntimeGlobal).__justStudyRuntime;
    assert.ok(firstRuntime?.db);
    const afterFirstRegistration = snapshotRootFiles(dataRoot);

    await instrumentation.register?.();
    assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, firstRuntime);
    assert.deepEqual(snapshotRootFiles(dataRoot), afterFirstRegistration);
  } finally {
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    if (previousRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = previousRuntime;
    closeAndClearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

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

test("health reports a new data root as safe but uninitialized without creating it", { concurrency: false }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "just-study-mcp-empty-"));
  const dataRoot = join(parent, "data");
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  clearTestRuntime();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;

  try {
    await withMcpClient(async (client) => {
      const health = structured<{ ok: true; data: { ok: boolean; state: string; database: string; storage: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(health.data.ok, true);
      assert.equal(health.data.state, "uninitialized");
      assert.equal(health.data.database, "uninitialized");
      assert.equal(health.data.storage, "ok");
    });
    assert.equal(existsSync(dataRoot), false);
    assert.deepEqual(readdirSync(parent), []);
    assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime, undefined);
  } finally {
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    clearTestRuntime();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("list_courses exposes an uninitialized store as empty without initializing it", { concurrency: false }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "just-study-mcp-empty-list-"));
  const dataRoot = join(parent, "data");
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  clearTestRuntime();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;

  try {
    await withMcpClient(async (client) => {
      const listed = structured<{ ok: true; data: { courses: unknown[] } }>(
        await client.callTool({ name: "list_courses", arguments: {} }),
      );
      assert.deepEqual(listed.data.courses, []);
    });
    assert.equal(existsSync(dataRoot), false);
  } finally {
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    clearTestRuntime();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("remaining read-only tools do not initialize a missing data store", { concurrency: false }, async () => {
  for (const [name, arguments_] of [
    ["get_learning_state", { courseId: crypto.randomUUID() }],
    ["read_learning_document", { courseId: crypto.randomUUID(), document: "course" }],
  ] as const) {
    const parent = mkdtempSync(join(tmpdir(), "just-study-mcp-empty-read-"));
    const dataRoot = join(parent, "data");
    const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
    clearTestRuntime();
    process.env.JUST_STUDY_DATA_DIR = dataRoot;

    try {
      await withMcpClient(async (client) => {
        const result = await client.callTool({ name, arguments: arguments_ });
        assert.equal(result.isError, true, name);
        assert.equal((result.structuredContent as { error: { code: string } }).error.code, "UNAVAILABLE", name);
      });
      assert.equal(existsSync(dataRoot), false, name);
    } finally {
      if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
      else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
      clearTestRuntime();
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("fresh MCP onboarding initializes storage only through create_course", { concurrency: false }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "just-study-mcp-onboarding-"));
  const dataRoot = join(parent, "data");
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  clearTestRuntime();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;

  try {
    await withMcpClient(async (client) => {
      const before = structured<{ ok: true; data: { ok: boolean; state: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(before.data.ok, true);
      assert.equal(before.data.state, "uninitialized");
      assert.deepEqual(structured<{ ok: true; data: { courses: unknown[] } }>(
        await client.callTool({ name: "list_courses", arguments: {} }),
      ).data.courses, []);
      assert.equal(existsSync(dataRoot), false);

      const created = structured<{ ok: true; data: { created: boolean; course: { id: string } } }>(
        await client.callTool({
          name: "create_course",
          arguments: {
            requestId: crypto.randomUUID(),
            title: "첫 과정",
            goal: "MCP로 첫 과정을 안전하게 시작한다.",
          },
        }),
      );
      assert.equal(created.data.created, true);
      assert.ok(existsSync(dataRoot));

      const after = structured<{ ok: true; data: { ok: boolean; state: string; database: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(after.data.ok, true);
      assert.equal(after.data.state, "ready");
      assert.equal(after.data.database, "ok");
    });
  } finally {
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    (globalThis as TestRuntimeGlobal).__justStudyRuntime?.db?.close();
    clearTestRuntime();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("every read-only tool leaves a closed WAL store's files unchanged", { concurrency: false }, async () => {
  for (const [name, arguments_] of [
    ["health", {}],
    ["list_courses", {}],
    ["get_learning_state", null],
    ["read_learning_document", null],
  ] as const) {
    const dataRoot = makeDataRoot();
    const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
    const db = openDatabase(dataRoot);
    const course = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: `${name} WAL 점검`,
      goal: "읽기 도구가 파일을 만들지 않는지 확인한다.",
    }).course;
    db.close();
    clearTestRuntime();
    process.env.JUST_STUDY_DATA_DIR = dataRoot;
    const argumentsForTool = arguments_ ?? (name === "get_learning_state"
      ? { courseId: course.id }
      : { courseId: course.id, document: "course" });
    const before = readdirSync(dataRoot).sort();

    try {
      await withDirectMcpClient(async (client) => {
        const result = await client.callTool({ name, arguments: argumentsForTool });
        assert.equal(result.isError, undefined, name);
      });
      assert.deepEqual(readdirSync(dataRoot).sort(), before, name);
    } finally {
      if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
      else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
      clearTestRuntime();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  }
});

test("unpinned WAL sidecars fail closed without changing file names, hashes, or mtimes", { concurrency: false }, async () => {
  const sourceRoot = makeDataRoot();
  const residueRoot = makeDataRoot();
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  const writer = openDatabase(sourceRoot);
  const course = createCourse(writer, sourceRoot, {
    requestId: crypto.randomUUID(),
    title: "WAL 복구 점검",
    goal: "승인 없는 읽기가 복구 파일을 변경하지 않게 한다.",
  }).course;

  try {
    for (const name of ["just-study.sqlite", "just-study.sqlite-wal", "just-study.sqlite-shm"]) {
      assert.ok(existsSync(join(sourceRoot, name)), `${name} fixture`);
      copyFileSync(join(sourceRoot, name), join(residueRoot, name));
    }
    writer.close();
    clearTestRuntime();
    process.env.JUST_STUDY_DATA_DIR = residueRoot;
    const before = snapshotRootFiles(residueRoot);
    assert.deepEqual(Object.keys(before), [
      "just-study.sqlite",
      "just-study.sqlite-shm",
      "just-study.sqlite-wal",
    ]);

    await withDirectMcpClient(async (client) => {
      for (const [name, arguments_] of [
        ["health", {}],
        ["list_courses", {}],
        ["get_learning_state", { courseId: course.id }],
        ["read_learning_document", { courseId: course.id, document: "course" }],
      ] as const) {
        const result = await client.callTool({ name, arguments: arguments_ });
        assert.deepEqual(snapshotRootFiles(residueRoot), before, name);
        if (name === "health") {
          const health = structured<{ ok: true; data: { ok: boolean; state: string; database: string } }>(result);
          assert.equal(health.data.ok, false);
          assert.equal(health.data.state, "recovery_required");
          assert.equal(health.data.database, "error");
        } else {
          assert.equal(result.isError, true, name);
          assert.equal((result.structuredContent as { error: { code: string } }).error.code, "UNAVAILABLE", name);
        }
      }
    });
  } finally {
    if (writer.open) writer.close();
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    clearTestRuntime();
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(residueRoot, { recursive: true, force: true });
  }
});

test("health rejects an existing tmp directory without writable mode bits", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  mkdirSync(join(dataRoot, "tmp"));
  chmodSync(join(dataRoot, "tmp"), 0o555);

  try {
    await withMcpClient(async (client) => {
      const health = structured<{ ok: true; data: { ok: boolean; storage: string } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(health.data.ok, false);
      assert.equal(health.data.storage, "error");
    });
  } finally {
    chmodSync(join(dataRoot, "tmp"), 0o700);
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("health inspects an existing store without weakening its recovery inventory", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const previousDataRoot = process.env.JUST_STUDY_DATA_DIR;
  const db = openDatabase(dataRoot);
  const course = createCourse(db, dataRoot, {
    requestId: crypto.randomUUID(),
    title: "점검 과정",
    goal: "복구 점검 결과를 확인한다.",
  }).course;
  db.close();
  clearTestRuntime();
  process.env.JUST_STUDY_DATA_DIR = dataRoot;
  writeFileSync(join(dataRoot, course.markdownPath), "# 변경됨\n", "utf8");
  mkdirSync(join(dataRoot, "tmp", "unfinished-recovery"));

  try {
    await withMcpClient(async (client) => {
      const health = structured<{
        ok: true;
        data: { ok: boolean; database: string; storage: string; corruptCourseIds: string[]; temporaryEntries: string[] };
      }>(await client.callTool({ name: "health", arguments: {} }));
      assert.equal(health.data.ok, false);
      assert.equal(health.data.database, "ok");
      assert.equal(health.data.storage, "ok");
      assert.deepEqual(health.data.corruptCourseIds, [course.id]);
      assert.deepEqual(health.data.temporaryEntries, ["unfinished-recovery"]);
    });
    assert.equal((globalThis as TestRuntimeGlobal).__justStudyRuntime?.db?.open, true);
  } finally {
    if (previousDataRoot === undefined) delete process.env.JUST_STUDY_DATA_DIR;
    else process.env.JUST_STUDY_DATA_DIR = previousDataRoot;
    closeAndClearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

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

      const rejected = await client.callTool({ name: "read_learning_document", arguments: { courseId: created.data.course.id, document: "../../secret" } });
      assert.equal(rejected.isError, true);
      assert.equal(JSON.stringify(rejected).includes("../../secret"), false);
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("lists an active course with its user-meaningful current Day number", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
      const { courseId } = await createLectureReadyCourse(client);
      const listed = structured<{ ok: true; data: { courses: { id: string; currentDayId: string | null; currentDayNumber: number | null }[] } }>(
        await client.callTool({ name: "list_courses", arguments: {} }),
      );
      assert.equal(listed.data.courses.length, 1);
      assert.equal(listed.data.courses[0]!.id, courseId);
      assert.notEqual(listed.data.courses[0]!.currentDayId, null);
      assert.equal(listed.data.courses[0]!.currentDayNumber, 1);
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

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

function withLocalResearchKeys<T extends ReturnType<typeof validResearch>>(research: T): T {
  const sourceKeys = new Map(research.sources.map((source, index) => [source.id, `s-${index + 1}`]));
  return {
    ...research,
    sources: research.sources.map((source, index) => ({ ...source, id: `s-${index + 1}` })),
    claims: research.claims.map((claim, index) => ({
      ...claim,
      id: `c-${index + 1}`,
      evidence: claim.evidence.map((evidence) => ({ ...evidence, sourceId: sourceKeys.get(evidence.sourceId)! })),
    })),
  } as T;
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

async function createLectureReadyCourse(client: Client): Promise<{ courseId: string; state: CompactLearningState }> {
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
  assert.match(checkpoint.data.state.currentDayMarkdown ?? "", /정확한 정의/);

  return { courseId, state: checkpoint.data.state };
}

function quizQuestions(prefix: string) {
  return Array.from({ length: 5 }, (_, index) => ({
    id: crypto.randomUUID(),
    conceptKey: `${prefix}-${index + 1}`,
    conceptLabel: `${prefix} 개념 ${index + 1}`,
    prompt: `${prefix} 질문 ${index + 1}: 핵심 원리를 설명하세요.`,
    choices: [`${prefix} 보기 A${index + 1}`, `${prefix} 보기 B${index + 1}`, `${prefix} 보기 C${index + 1}`, `${prefix} 보기 D${index + 1}`],
    correctChoiceIndex: index % 4,
    explanation: "핵심 원리와 적용 이유를 모두 설명한다.",
  }));
}

function terminalAnswers(
  questions: ReturnType<typeof quizQuestions>,
  incorrectIndex: number | null,
) {
  return questions.map((question, index) => ({
    questionId: question.id,
    selectedChoiceIndex: index === incorrectIndex
      ? (question.correctChoiceIndex + 1) % 4
      : question.correctChoiceIndex,
  }));
}

test("drives ambiguity, 4/5 remediation, and 5/5 reflection through the full Day state machine", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
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

      // 한 문항만 먼저 답하면 채점이 끝나지 않고 quiz 단계에 머문다.
      const partial = structured<StateResult>(await client.callTool({
        name: "answer_quiz",
        arguments: {
          courseId,
          expectedRevision: 4,
          attemptId: firstAttempt.id,
          answers: [{ questionId: firstQuestions[0]!.id, selectedChoiceIndex: firstQuestions[0]!.correctChoiceIndex }],
        },
      }));
      assert.equal(partial.data.state.course.revision, 5);
      assert.equal(partial.data.state.course.currentStage, "quiz");

      // 이미 답한 0번을 빼고 나머지를 보낸다. 마지막 문항만 오답이라 4/5가 된다.
      const failed = structured<StateResult>(await client.callTool({
        name: "answer_quiz",
        arguments: {
          courseId,
          expectedRevision: 5,
          attemptId: firstAttempt.id,
          answers: terminalAnswers(firstQuestions, 4).slice(1),
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
        name: "answer_quiz",
        arguments: { courseId, expectedRevision: 8, attemptId: secondAttempt.id, answers: terminalAnswers(secondQuestions, null) },
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

      const repeat = await client.callTool({
        name: "complete_day",
        arguments: {
          courseId,
          expectedRevision: 9,
          reflection: { learned: "자료구조 선택 기준", confusing: "상각 분석", feeling: "적용할 수 있다" },
        },
      });
      assert.equal(repeat.isError, true);
      assert.equal((repeat.structuredContent as { error: { code: string } }).error.code, "REVISION_CONFLICT");

      const stillDay2 = structured<StateResult>(
        await client.callTool({ name: "get_learning_state", arguments: { courseId } }),
      );
      assert.equal(stillDay2.data.state.currentDay?.dayNumber, 2);
      assert.equal(stillDay2.data.state.course.currentStage, "lecture");
      assert.equal(stillDay2.data.state.course.revision, 10);
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("approves outline, research runs, and rejects stale revision conflict and 29 Days outlines", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
      const { courseId, state } = await createLectureReadyCourse(client);
      assert.equal(state.course.revision, 3);
      assert.equal(state.researchRuns.length, 2);
      assert.equal(state.researchRuns.filter((run) => run.scope === "day").length, 1);
      assert.match(state.currentDayMarkdown ?? "", /정확한 정의/);

      const staleConflict = await client.callTool({
        name: "record_daily_research",
        arguments: { courseId, expectedRevision: 1, research: validResearch("Day 1 배열") },
      });
      assert.equal(staleConflict.isError, true);
      assert.equal((staleConflict.structuredContent as { error: { code: string } }).error.code, "REVISION_CONFLICT");

      const stillAt3 = structured<StateResult>(
        await client.callTool({ name: "get_learning_state", arguments: { courseId } }),
      );
      assert.equal(stillAt3.data.state.course.revision, 3);

      const secondCourse = structured<{ ok: true; data: { course: { id: string } } }>(
        await client.callTool({
          name: "create_course",
          arguments: {
            requestId: crypto.randomUUID(),
            title: "두 번째 과정",
            goal: "다른 목표를 학습한다.",
          },
        }),
      );
      const secondCourseId = secondCourse.data.course.id;

      const badOutline = await client.callTool({
        name: "approve_outline",
        arguments: {
          courseId: secondCourseId,
          expectedRevision: 0,
          priorKnowledge: "없음",
          learningPreference: "theory",
          knowledgeMapMarkdown: "개요",
          research: validResearch("두 번째"),
          days: Array.from({ length: 29 }, (_, index) => ({ objective: `두 번째 목표 ${index + 1}을 설명한다` })),
        },
      });
      assert.equal(badOutline.isError, true);

      const secondState = structured<StateResult>(
        await client.callTool({ name: "get_learning_state", arguments: { courseId: secondCourseId } }),
      );
      assert.equal(secondState.data.state.course.status, "draft");
      assert.equal(secondState.data.state.course.revision, 0);
      assert.deepEqual(secondState.data.state.days, []);
      assert.deepEqual(secondState.data.state.researchRuns, []);
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("accepts reusable local research keys and returns canonical identifiers", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
      const created = structured<{ ok: true; data: { course: { id: string } } }>(
        await client.callTool({ name: "create_course", arguments: { requestId: crypto.randomUUID(), title: "로컬 키", goal: "서버가 연구 식별자를 정식화한다." } }),
      );
      const courseId = created.data.course.id;
      const approved = structured<StateResult>(
        await client.callTool({
          name: "approve_outline",
          arguments: {
            courseId,
            expectedRevision: 0,
            priorKnowledge: "기초 지식",
            learningPreference: "examples",
            knowledgeMapMarkdown: "기초 → 적용",
            research: withLocalResearchKeys(validResearch("로컬 키 과정")),
            days: Array.from({ length: 30 }, (_, index) => ({ objective: `목표 ${index + 1}` })),
          },
        }),
      );
      const courseRun = approved.data.state.researchRuns[0]!;
      const researched = structured<StateResult>(
        await client.callTool({ name: "record_daily_research", arguments: { courseId, expectedRevision: 1, research: withLocalResearchKeys(validResearch("로컬 키 Day 1")) } }),
      );
      const dayRun = researched.data.state.researchRuns.find(({ scope }) => scope === "day")!;
      const sourceIds = [...courseRun.sources, ...dayRun.sources].map(({ id }) => id);
      const claimIds = [...courseRun.claims, ...dayRun.claims].map(({ id }) => id);
      assert.equal(new Set(sourceIds).size, sourceIds.length);
      assert.equal(new Set(claimIds).size, claimIds.length);
      assert.ok(sourceIds.every((id) => UUID_PATTERN.test(id)));
      assert.ok(claimIds.every((id) => UUID_PATTERN.test(id)));
      for (const run of [courseRun, dayRun]) {
        const runSourceIds = new Set(run.sources.map(({ id }) => id));
        assert.ok(run.claims.every((claim) => claim.evidence.every(({ sourceId }) => UUID_PATTERN.test(sourceId) && runSourceIds.has(sourceId))));
      }
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("registers exactly the twelve approved tools with correct annotations and an uncorrupted create_course contract", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
      const tools = (await client.listTools()).tools;
      const names = tools.map(({ name }) => name).sort();
      assert.deepEqual(names, [
        "answer_quiz",
        "approve_outline",
        "complete_day",
        "create_course",
        "get_learning_state",
        "health",
        "list_courses",
        "read_learning_document",
        "record_daily_research",
        "save_checkpoint",
        "start_quiz",
        "start_remediation_quiz",
      ]);

      const readOnlyNames = new Set(["health", "list_courses", "get_learning_state", "read_learning_document"]);
      for (const tool of tools) {
        const expectedReadOnly = readOnlyNames.has(tool.name);
        assert.equal(tool.annotations?.readOnlyHint, expectedReadOnly, `${tool.name} readOnlyHint`);
        assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} openWorldHint`);
        if (!expectedReadOnly) {
          const expectedIdempotent = tool.name === "create_course";
          assert.equal(tool.annotations?.idempotentHint, expectedIdempotent, `${tool.name} idempotentHint`);
        }
      }

      const createDefinition = tools.find(({ name }) => name === "create_course")!;
      const createInputSchema = createDefinition.inputSchema as { properties?: Record<string, unknown> };
      const createProperties = createInputSchema.properties ?? {};
      assert.deepEqual(Object.keys(createProperties).sort(), ["goal", "requestId", "title"]);
      assert.equal(JSON.stringify(createDefinition.inputSchema).includes('"value"'), false);
      assert.equal(JSON.stringify(createDefinition.inputSchema).includes('"ok"'), false);
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("negotiates the modern Streamable HTTP protocol era", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
      assert.equal(client.getProtocolEra(), "modern");
      const health = structured<{ ok: true; data: { ok: boolean } }>(
        await client.callTool({ name: "health", arguments: {} }),
      );
      assert.equal(typeof health.data.ok, "boolean");
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("resumes an in-progress clarification after a full runtime restart", { concurrency: false }, async () => {
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
        name: "answer_quiz",
        arguments: {
          courseId,
          expectedRevision: 4,
          attemptId,
          answers: [{ questionId: questions[0]!.id, selectedChoiceIndex: questions[0]!.correctChoiceIndex }],
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
      const response = attempt.questions[0]!.response!;
      assert.equal(resumed.data.state.course.currentStage, "quiz");
      assert.equal(resumed.data.state.course.revision, expected.course.revision);
      assert.equal(resumed.data.state.currentDay?.id, expected.currentDay?.id);
      assert.equal(resumed.data.state.currentDayMarkdown, expected.currentDayMarkdown);
      assert.deepEqual(attempt.questions, expected.quizAttempts.at(-1)!.questions);
      assert.equal(response.correct, true);
      assert.equal(response.selectedChoiceIndex, attempt.questions[0]!.correctChoiceIndex);
    });
  } finally {
    db?.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("drives the complete 30-Day MCP-only acceptance loop to terminal cleanup", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
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
          name: "answer_quiz",
          arguments: { courseId, expectedRevision: state.course.revision, attemptId, answers: terminalAnswers(questions, null) },
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
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("schema rejection matrix rejects without mutation", { concurrency: false }, async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  setTestRuntime(dataRoot, db);
  try {
    await withMcpClient(async (client) => {
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
        answer_quiz: {
          courseId,
          expectedRevision: 0,
          attemptId,
          answers: [{ questionId: questions[0]!.id, selectedChoiceIndex: 0 }],
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
        client_: Client,
        name: string,
        arguments_: Record<string, unknown>,
        label: string,
      ): Promise<void> {
        const result = await client_.callTool({ name, arguments: arguments_ });
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
        "answer_quiz", "approve_outline", "complete_day", "create_course",
        "get_learning_state", "health", "list_courses", "read_learning_document",
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
        ["answer_quiz", { ...validShapes.answer_quiz, courseId: 7 }],
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
        ["approve_outline", {
          ...validShapes.approve_outline,
          research: { ...research, sources: [{ ...research.sources[0]!, id: "s/1" }, ...research.sources.slice(1)] },
        }],
        ["approve_outline", {
          ...validShapes.approve_outline,
          research: { ...research, claims: [{ ...research.claims[0]!, id: "c 1" }] },
        }],
        ["record_daily_research", {
          ...validShapes.record_daily_research,
          research: { ...research, claims: [{ ...research.claims[0]!, evidence: [{ sourceId: "s".repeat(65), stance: "supports" }] }] },
        }],
        ["save_checkpoint", {
          ...validShapes.save_checkpoint,
          understoodConcepts: Array.from({ length: 101 }, (_, index) => ({ key: `key-${index}`, label: `개념 ${index}` })),
        }],
        ["start_quiz", { ...validShapes.start_quiz, questions: questions.slice(0, 4) }],
        ["answer_quiz", { ...validShapes.answer_quiz, answers: [] }],
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
    });
  } finally {
    db.close();
    clearTestRuntime();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
