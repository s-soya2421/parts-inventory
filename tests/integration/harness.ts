import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { app } from "../../src/worker/app";
import { createMigratedDb, type SqliteD1 } from "./d1-adapter";
import type { Env } from "../../src/worker/types";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

const BASIC_AUTH_USER = "inventory";
const BASIC_AUTH_PASSWORD = "inventory-pass";

export type TestClient = {
  db: SqliteD1;
  request: <T = any>(path: string, options?: RequestInit) => Promise<{ response: Response; body: T; contentType: string }>;
  raw: (path: string, options?: RequestInit) => Promise<Response>;
};

function authHeader(user = BASIC_AUTH_USER, password = BASIC_AUTH_PASSWORD): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

// Build a fresh in-memory DB + bound app for each test, so cases stay isolated.
export function createTestClient(bindings: Partial<Env["Bindings"]> = {}): TestClient {
  const db = createMigratedDb(migrationsDir);
  const env = {
    DB: db as unknown as D1Database,
    BASIC_AUTH_USER,
    BASIC_AUTH_PASSWORD,
    ...bindings,
  };

  const raw = async (path: string, options: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(options.headers);
    if (!headers.has("authorization")) headers.set("authorization", authHeader());
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const url = path.startsWith("http") ? path : `http://localhost${path}`;
    return app.fetch(new Request(url, { ...options, headers }), env);
  };

  const request = async <T = any>(path: string, options: RequestInit = {}) => {
    const response = await raw(path, options);
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ((await response.arrayBuffer()) as unknown as T);
    return { response, body, contentType };
  };

  return { db, request, raw };
}

export { authHeader };
