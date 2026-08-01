import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { CourseValidationError, createCourse } from "../src/server/courses.ts";
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
