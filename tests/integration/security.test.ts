import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/worker/app";
import { authHeader, createTestClient, type TestClient } from "./harness";

let client: TestClient;
beforeEach(() => { client = createTestClient(); });

describe("security boundaries", () => {
  it.each(["/", "/parts", "/assets/app.js", "/api/health", "/api/export/parts"])("requires auth for %s", async (path) => {
    const response = await client.raw(path, { headers: { authorization: "" } });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("fails closed when secrets are missing, before fetching assets", async () => {
    const fetch = vi.fn();
    const response = await app.request("/", {}, { DB: client.db as unknown as D1Database, ASSETS: { fetch } as unknown as Fetcher });
    expect(response.status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("protects successful asset responses and does not send unknown API routes to the SPA", async () => {
    const fetch = vi.fn(() => new Response("<html></html>", { headers: { "content-type": "text/html", "cache-control": "public, max-age=3600" } }));
    const env = { DB: client.db as unknown as D1Database, BASIC_AUTH_USER: "inventory", BASIC_AUTH_PASSWORD: "inventory-pass", ASSETS: { fetch } as unknown as Fetcher };
    const headers = { authorization: authHeader() };
    const asset = await app.request("/parts", { headers }, env);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("no-store");
    expect(asset.headers.get("vary")).toContain("Authorization");
    expect(asset.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(asset.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(asset.headers.get("referrer-policy")).toBe("same-origin");
    expect((await app.request("/api/missing", { headers }, env)).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("adds security headers to immutable fetch responses from the asset binding", async () => {
    const asset = await fetch("data:text/html,<html></html>");
    expect(() => asset.headers.set("x-test", "test")).toThrow();
    const response = await app.request("/", { headers: { authorization: authHeader() } }, {
      DB: client.db as unknown as D1Database,
      BASIC_AUTH_USER: "inventory", BASIC_AUTH_PASSWORD: "inventory-pass",
      ASSETS: { fetch: async () => asset } as unknown as Fetcher,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["https://evil.example", "null", "http://localhost.evil.example", "http://other.localhost"])("rejects mutation from %s", async (origin) => {
    const response = await client.raw("/api/categories", { method: "POST", headers: { origin }, body: JSON.stringify({ name: "CSRF" }) });
    expect(response.status).toBe(403);
    const { body } = await client.request("/api/categories");
    expect(body.data.some((row: { name: string }) => row.name === "CSRF")).toBe(false);
  });

  it.each(["cross-site", "same-site"])("rejects %s fetch metadata even without Origin", async (site) => {
    const response = await client.raw("/api/logout", { method: "POST", headers: { "sec-fetch-site": site } });
    expect(response.status).toBe(403);
    expect(response.headers.has("clear-site-data")).toBe(false);
  });

  it("allows same-origin JSON mutations and rejects text/plain JSON", async () => {
    const allowed = await client.raw("/api/categories", { method: "POST", headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ name: "Allowed" }) });
    expect(allowed.status).toBe(201);
    const rejected = await client.raw("/api/categories", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ name: "Rejected" }) });
    expect(rejected.status).toBe(415);
  });

  it("limits JSON bodies even when Content-Length is absent", async () => {
    const response = await client.raw("/api/import/parts", { method: "POST", body: JSON.stringify({ memo: "x".repeat(5 * 1024 * 1024) }) });
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["__proto__", "constructor", "toString", "updatedAt; DROP TABLE parts;--"])("handles untrusted sort %s without executing SQL", async (sort) => {
    const response = await client.raw(`/api/parts?sort=${encodeURIComponent(sort)}`);
    expect(response.status).toBe(200);
    expect((await client.raw("/api/parts")).status).toBe(200);
  });

  it("exports a category named __proto__ safely", async () => {
    const { body: category } = await client.request("/api/categories", { method: "POST", body: JSON.stringify({ name: "__proto__", slug: "proto-category" }) });
    await client.request("/api/parts", { method: "POST", body: JSON.stringify({ categoryId: category.data.id, modelNumber: "P1", name: "Part", stockQuantity: 1 }) });
    const response = await client.raw("/api/export/parts?format=csv");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("P1");
  });
});

describe("logout", () => {
  it("requests credential and cookie clearing without clearing preferences, then redirects to the fixed top page", async () => {
    const response = await client.raw("/api/logout?next=https://evil.example", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" }, body: "" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("clear-site-data")).toBe('"cookies"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("www-authenticate")).toBe(false);
  });

  it("requires authentication and rejects cross-origin logout", async () => {
    expect((await client.raw("/api/logout", { method: "POST", headers: { authorization: "" } })).status).toBe(401);
    expect((await client.raw("/api/logout", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("does not log out on GET", async () => {
    const response = await client.raw("/api/logout");
    expect(response.status).toBe(404);
    expect(response.headers.has("clear-site-data")).toBe(false);
  });
});
