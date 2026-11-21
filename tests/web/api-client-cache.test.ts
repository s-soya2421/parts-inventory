import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, invalidateAllCache } from "../../src/web/lib/api-client";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function jsonResponse(data: unknown): Response {
  return { ok: true, json: async () => ({ data }) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invalidateAllCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api-client cache", () => {
  it("serves a fresh GET from cache without refetching", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));

    await apiClient.listCategories();
    await apiClient.listCategories();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent identical GETs into a single request", async () => {
    const d = deferred<Response>();
    fetchMock.mockReturnValue(d.promise);

    const p1 = apiClient.listCategories();
    const p2 = apiClient.listCategories();
    d.resolve(jsonResponse([{ id: 1 }]));
    await Promise.all([p1, p2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes query order so equivalent filters share a cache entry", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], total: 0, page: 1, pageSize: 50 }) } as unknown as Response);

    await apiClient.listParts(new URLSearchParams("q=uart&categoryId=3"));
    await apiClient.listParts(new URLSearchParams("categoryId=3&q=uart"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates parts cache when a related resource mutates", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], total: 0, page: 1, pageSize: 50 }) } as unknown as Response);
    await apiClient.listParts(new URLSearchParams());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Mutating a category should drop the parts list cache (names are embedded).
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: "x" }));
    await apiClient.createCategory({ name: "x" });

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], total: 0, page: 1, pageSize: 50 }) } as unknown as Response);
    await apiClient.listParts(new URLSearchParams());
    // 1 (initial list) + 1 (createCategory) + 1 (refetched list) = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns stale data immediately and revalidates in the background", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));

    await apiClient.listCategories(); // fresh, fetch #1
    // categories TTL is 5min; advance past it but stay within the stale grace window.
    vi.advanceTimersByTime(6 * 60_000);

    await apiClient.listCategories(); // stale → returns immediately + triggers background refetch
    await vi.advanceTimersByTimeAsync(0); // let the background refetch settle

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("upstream JSON-only mutation compatibility", () => {
  it.each([
    ["restore part", () => apiClient.restorePart(123), "/api/parts/123/restore"],
    ["undo import", () => apiClient.revertImportBatch(456), "/api/import/batches/456/revert"],
  ])("%s sends application/json even with empty data", async (_name, invoke, url) => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, deleted: 0, restored: 0, failed: 0 }));
    await invoke();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });
});
