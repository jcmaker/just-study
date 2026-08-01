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
