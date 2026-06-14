import type { AttributeDefinition, Category, CategoryListHeader, Location, PartDetail, PartsAnalytics, PartStatus, PartSummary, PartWriteInput, ProjectDetail, ProjectSummary, ProjectWriteInput, Tag } from "@shared/types";

type ApiEnvelope<T> = { data: T };
type ApiErrorBody = { error?: { message?: string; issues?: unknown } };

export type ImportBatchSummary = {
  id: number;
  mode: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  createdAt: string;
  revertedAt: string | null;
  revertable: boolean;
};

export type BulkUpdatePartsInput = Partial<
  Pick<PartWriteInput, "categoryId" | "manufacturer" | "footprint" | "locationName" | "caseNumber" | "lowStockThreshold" | "statusId">
>;

// --- In-memory cache (resource-aware TTL + stale-while-revalidate + request coalescing) ---
const DEFAULT_TTL_MS = 30_000;
// 期限切れ後もこの猶予内なら古い値を即返しつつ裏で再取得する（stale-while-revalidate）。
const STALE_GRACE_MS = 5 * 60_000;

// リソース別の鮮度(TTL)。先頭から最初にマッチしたものを採用するため、
// 具体的なパス(stats/analytics 等)を /api/parts より前に並べる。
const TTL_RULES: { pattern: RegExp; ttl: number }[] = [
  { pattern: /^\/api\/(categories|tags|locations|statuses)\b/, ttl: 5 * 60_000 },
  { pattern: /^\/api\/parts\/(stats|analytics)\b/, ttl: 60_000 },
  { pattern: /^\/api\/parts\/attribute-values\b/, ttl: 60_000 },
  { pattern: /^\/api\/parts\b/, ttl: 30_000 },
];

function ttlFor(pathname: string): number {
  for (const rule of TTL_RULES) if (rule.pattern.test(pathname)) return rule.ttl;
  return DEFAULT_TTL_MS;
}

function pathnameOf(path: string): string {
  const i = path.indexOf("?");
  return i < 0 ? path : path.slice(0, i);
}

// クエリ順の違いで別キー扱いにならないよう、パラメータをソートして正規化する。
function cacheKey(path: string): string {
  const i = path.indexOf("?");
  if (i < 0) return path;
  const params = new URLSearchParams(path.slice(i + 1));
  params.sort();
  const query = params.toString();
  return query ? `${path.slice(0, i)}?${query}` : path.slice(0, i);
}

interface CacheEntry {
  data: unknown;
  freshUntil: number;
  staleUntil: number;
}

const cache = new Map<string, CacheEntry>();
// 同一GETの同時実行を1本に束ねる（request coalescing）。valid=false は
// 取得中に無効化されたことを示し、完了しても結果をキャッシュしない。
interface InflightRecord {
  promise: Promise<unknown>;
  valid: boolean;
}
const inflight = new Map<string, InflightRecord>();

function setCacheEntry(key: string, data: unknown, ttl: number): void {
  const now = Date.now();
  cache.set(key, { data, freshUntil: now + ttl, staleUntil: now + ttl + STALE_GRACE_MS });
}

function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  // 進行中のGETは無効化フラグを立てて破棄。無効化をまたいだ古い結果は保存しない。
  for (const [key, record] of inflight) {
    if (key.startsWith(prefix)) {
      record.valid = false;
      inflight.delete(key);
    }
  }
}

export function invalidateAllCache(): void {
  cache.clear();
  inflight.clear();
}

// --- Request helper ---

function formatApiError(body: ApiErrorBody | null): string {
  const error = body?.error;
  if (!error) return "API error";
  const issues = Array.isArray(error.issues)
    ? ` ${error.issues.map((issue) => {
        if (typeof issue !== "object" || issue === null) return "";
        const path = "path" in issue && Array.isArray(issue.path) ? issue.path.join(".") : "";
        const message = "message" in issue ? String(issue.message) : "";
        return [path, message].filter(Boolean).join(": ");
      }).filter(Boolean).join(" / ")}`
    : "";
  return `${error.message ?? "API error"}${issues}`;
}

// 実フェッチ＋キャッシュ保存。同一キーが進行中ならそのPromiseを共有する（coalescing）。
function fetchAndCache<TBody>(key: string, path: string, init: RequestInit): Promise<TBody> {
  const existing = inflight.get(key);
  if (existing) return existing.promise as Promise<TBody>;

  // promise は record 生成後に差し込む（非同期本体が record を参照するため）。
  const record: InflightRecord = { valid: true, promise: Promise.resolve() };
  record.promise = (async () => {
    const response = await fetch(path, init);
    const body = (await response.json().catch(() => null)) as (TBody & ApiErrorBody) | null;
    if (!response.ok) throw new Error(formatApiError(body));
    // 取得中に無効化されていなければ保存する。
    if (record.valid) setCacheEntry(key, body, ttlFor(pathnameOf(path)));
    return body as TBody;
  })();

  inflight.set(key, record);
  void record.promise.finally(() => {
    if (inflight.get(key) === record) inflight.delete(key);
  });
  return record.promise as Promise<TBody>;
}

/**
 * Core fetch helper. Returns the full response body (envelope or otherwise).
 * GETはリソース別TTL＋stale-while-revalidate＋request coalescingでキャッシュし、
 * ミューテーション時は関連セグメントを無効化する。
 */
async function requestBody<TBody>(path: string, init: RequestInit = {}): Promise<TBody> {
  const method = init.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const fetchInit = { ...init, headers };

  if (method !== "GET") {
    const response = await fetch(path, fetchInit);
    const body = (await response.json().catch(() => null)) as (TBody & ApiErrorBody) | null;
    if (!response.ok) throw new Error(formatApiError(body));
    // Mutation: invalidate the touched segment.
    const segment = path.replace(/^\/api\//, "").split(/[/?]/)[0];
    invalidateCache(`/api/${segment}`);
    // Parts summaries embed category/tag/location names, so any related mutation
    // (categories, tags, locations, import, …) can leave the parts list stale.
    if (segment !== "parts") invalidateCache("/api/parts");
    return body as TBody;
  }

  const key = cacheKey(path);
  const entry = cache.get(key);
  const now = Date.now();

  if (entry && now < entry.freshUntil) return entry.data as TBody;

  if (entry && now < entry.staleUntil) {
    // 古い値を即返しつつ、裏で再取得してキャッシュを更新する。
    void fetchAndCache<TBody>(key, path, fetchInit).catch(() => {});
    return entry.data as TBody;
  }

  return fetchAndCache<TBody>(key, path, fetchInit);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const body = await requestBody<ApiEnvelope<T>>(path, init);
  return body.data;
}

export const apiClient = {
  async listParts(search: URLSearchParams) {
    const url = `/api/parts?${search.toString()}`;
    const body = await requestBody<{ data: PartSummary[]; total: number; page: number; pageSize: number }>(url);
    return { items: body.data, total: body.total, page: body.page, pageSize: body.pageSize };
  },
  listAttributeValues(key: string) {
    return request<{ value: string; unit: string | null; count: number }[]>(`/api/parts/attribute-values?key=${encodeURIComponent(key)}`);
  },
  getPart(id: number) {
    return request<PartDetail>(`/api/parts/${id}`);
  },
  createPart(input: PartWriteInput) {
    return request<PartDetail>("/api/parts", { method: "POST", body: JSON.stringify(input) });
  },
  updatePart(id: number, input: PartWriteInput) {
    return request<PartDetail>(`/api/parts/${id}`, { method: "PUT", body: JSON.stringify(input) });
  },
  deletePart(id: number) {
    return request<{ ok: true }>(`/api/parts/${id}`, { method: "DELETE" });
  },
  bulkArchiveParts(ids: number[]) {
    return request<{ ok: true }>("/api/parts/bulk/archive", { method: "POST", body: JSON.stringify({ ids }) });
  },
  bulkUpdateParts(ids: number[], data: BulkUpdatePartsInput) {
    return request<{ ok: true }>("/api/parts/bulk/update", { method: "POST", body: JSON.stringify({ ids, data }) });
  },
  restorePart(id: number) {
    return request<{ ok: true }>(`/api/parts/${id}/restore`, { method: "POST" });
  },
  permanentlyDeletePart(id: number) {
    return request<{ ok: true }>(`/api/parts/${id}/permanent`, { method: "DELETE" });
  },
  changeStock(id: number, input: { type: "in" | "out" | "set" | "adjustment" | "use" | "dispose"; quantity: number; reason?: string; memo?: string }) {
    return request<PartDetail>(`/api/parts/${id}/stock`, { method: "POST", body: JSON.stringify(input) });
  },
  listCategories() {
    return request<Category[]>("/api/categories");
  },
  createCategory(input: { name: string; slug?: string }) {
    return request<Category>("/api/categories", { method: "POST", body: JSON.stringify(input) });
  },
  updateCategory(id: number, input: { name: string; slug?: string }) {
    return request<Category>(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify(input) });
  },
  deleteCategory(id: number) {
    return request<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE" });
  },
  listCategoryAttributes(id: number) {
    return request<AttributeDefinition[]>(`/api/categories/${id}/attributes`);
  },
  updateCategoryAttributes(id: number, input: Partial<AttributeDefinition>[]) {
    return request<{ ok: true }>(`/api/categories/${id}/attributes`, { method: "PUT", body: JSON.stringify(input) });
  },
  listCategoryHeaders(id: number) {
    return request<CategoryListHeader[]>(`/api/categories/${id}/headers`);
  },
  updateCategoryHeaders(id: number, input: Partial<CategoryListHeader>[]) {
    return request<{ ok: true }>(`/api/categories/${id}/headers`, { method: "PUT", body: JSON.stringify(input) });
  },
  listLocations() {
    return request<Location[]>("/api/locations");
  },
  createLocation(input: { name: string; code: string; description?: string | null }) {
    return request<Location>("/api/locations", { method: "POST", body: JSON.stringify(input) });
  },
  updateLocation(id: number, input: { name: string; code: string; description?: string | null }) {
    return request<Location>(`/api/locations/${id}`, { method: "PUT", body: JSON.stringify(input) });
  },
  deleteLocation(id: number) {
    return request<{ ok: true }>(`/api/locations/${id}`, { method: "DELETE" });
  },
  listTags() {
    return request<Tag[]>("/api/tags");
  },
  createTag(input: { name: string; slug?: string }) {
    return request<Tag>("/api/tags", { method: "POST", body: JSON.stringify(input) });
  },
  updateTag(id: number, input: { name: string; slug?: string }) {
    return request<Tag>(`/api/tags/${id}`, { method: "PUT", body: JSON.stringify(input) });
  },
  deleteTag(id: number) {
    return request<{ ok: true }>(`/api/tags/${id}`, { method: "DELETE" });
  },
  listProjects(partId?: number) {
    return request<ProjectSummary[]>(partId ? `/api/projects?partId=${partId}` : "/api/projects");
  },
  getProject(id: number) {
    return request<ProjectDetail>(`/api/projects/${id}`);
  },
  createProject(input: ProjectWriteInput) {
    return request<ProjectDetail>("/api/projects", { method: "POST", body: JSON.stringify(input) });
  },
  updateProject(id: number, input: ProjectWriteInput) {
    return request<ProjectDetail>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(input) });
  },
  addPartToProject(id: number, input: { partId: number; quantityRequired: number; memo?: string | null }) {
    return request<ProjectDetail>(`/api/projects/${id}/parts`, { method: "POST", body: JSON.stringify(input) });
  },
  deleteProject(id: number) {
    return request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" });
  },
  listStatuses() {
    return request<PartStatus[]>("/api/statuses");
  },
  createStatus(input: { name: string; slug?: string; color?: string; sortOrder?: number }) {
    return request<PartStatus>("/api/statuses", { method: "POST", body: JSON.stringify(input) });
  },
  updateStatus(id: number, input: { name: string; slug?: string; color?: string; sortOrder?: number }) {
    return request<PartStatus>(`/api/statuses/${id}`, { method: "PUT", body: JSON.stringify(input) });
  },
  deleteStatus(id: number) {
    return request<{ ok: true }>(`/api/statuses/${id}`, { method: "DELETE" });
  },
  importParts(rows: unknown[], mode: "skip" | "update" = "skip") {
    return request<{ batchId: number | null; created: number; updated: number; skipped: number; failed: number; errors: { row: number; error: string }[] }>(
      "/api/import/parts",
      { method: "POST", body: JSON.stringify({ rows, mode }) },
    );
  },
  listImportBatches() {
    return request<ImportBatchSummary[]>("/api/import/batches");
  },
  revertImportBatch(id: number) {
    return request<{ deleted: number; restored: number; failed: number }>(`/api/import/batches/${id}/revert`, { method: "POST" });
  },
  getPartsStats(search: URLSearchParams) {
    return request<{ totalValue: number; totalStock: number; count: number; valuedCount: number }>(
      `/api/parts/stats?${search.toString()}`,
    );
  },
  getPartsAnalytics(search: URLSearchParams) {
    return request<PartsAnalytics>(`/api/parts/analytics?${search.toString()}`);
  },
};
