import type { Context } from "hono";
import { AppError } from "./error-handler";
import type { Env } from "../types";

export const MAX_JSON_BODY_BYTES = 1_000_000;

// Limit the streamed body as well as Content-Length: clients can omit or lie about the latter.
export async function parseJsonBody(c: Context<Env>): Promise<unknown> {
  const declaredLength = c.req.header("content-length");
  if (declaredLength && Number(declaredLength) > MAX_JSON_BODY_BYTES) {
    throw new AppError("REQUEST_BODY_TOO_LARGE", "Request body is too large.", 413);
  }

  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new SyntaxError("Request body is empty.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new AppError("REQUEST_BODY_TOO_LARGE", "Request body is too large.", 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
