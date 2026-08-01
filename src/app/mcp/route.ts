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
      body: body as BodyInit,
    }));
  } catch {
    return errorResponse(500, "MCP request could not be processed");
  }
}
