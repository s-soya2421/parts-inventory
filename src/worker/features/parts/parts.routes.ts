import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client";
import type { Env } from "../../types";
import { CategoriesRepository } from "../categories/categories.repository";
import { TagsRepository } from "../tags/tags.repository";
import { PartsRepository, type PartListFilters } from "./parts.repository";
import { PartsService } from "./parts.service";
import { bulkDeleteSchema, bulkUpdateSchema, partWriteSchema, stockChangeSchema } from "./parts.schemas";

export const partsRoutes = new Hono<Env>();

const filtersSchema = z.object({
  q: z.string().trim().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  categorySlug: z.string().trim().min(1).optional(),
  caseNumber: z.string().trim().min(1).optional(),
  manufacturer: z.string().trim().min(1).optional(),
  footprint: z.string().trim().min(1).optional(),
  locationId: z.coerce.number().int().positive().optional(),
  statusId: z.coerce.number().int().positive().optional(),
  archived: z.enum(["active", "archived", "all"]).default("active"),
  stockStatus: z.enum(["all", "in_stock", "out_of_stock", "low_stock"]).default("all"),
  // 既知の列に加え、カテゴリ属性（電気的特性・仕様）の列 attr_<key> もソート対象になる。
  // 値はリポジトリ側のホワイトリスト(buildOrderBy)で解決し、未知キーは既定順にフォールバックするため、
  // ここでは任意の文字列を許容する（厳格な enum だと attr_xxx が弾かれてソート時にエラーになる）。
  sort: z.string().trim().min(1).optional(),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  tagId: z.array(z.coerce.number().int().positive()).default([]),
  attrs: z.string().trim().min(1).optional(),
});

function createService(db: D1Database): PartsService {
  return new PartsService(new PartsRepository(db), new CategoriesRepository(db), new TagsRepository(db));
}

function getFilters(url: string): PartListFilters {
  const params = new URL(url).searchParams;
  const query = filtersSchema.parse({
    q: params.get("q") || undefined,
    categoryId: params.get("categoryId") || undefined,
    categorySlug: params.get("categorySlug") || undefined,
    caseNumber: params.get("caseNumber") || undefined,
    manufacturer: params.get("manufacturer") || undefined,
    footprint: params.get("footprint") || undefined,
    locationId: params.get("locationId") || undefined,
    statusId: params.get("statusId") || undefined,
    archived: params.get("archived") || undefined,
    stockStatus: params.get("stockStatus") || undefined,
    sort: params.get("sort") || undefined,
    direction: params.get("direction") || undefined,
    page: params.get("page") || undefined,
    pageSize: params.get("pageSize") || undefined,
    tagId: params.getAll("tagId"),
    attrs: params.get("attrs") || undefined,
  });
  return {
    keyword: query.q,
    categoryId: query.categoryId,
    categorySlug: query.categorySlug,
    caseNumber: query.caseNumber,
    manufacturer: query.manufacturer,
    footprint: query.footprint,
    locationId: query.locationId,
    statusId: query.statusId,
    archived: query.archived,
    stockStatus: query.stockStatus,
    sort: query.sort,
    direction: query.direction,
    page: query.page,
    pageSize: query.pageSize,
    tagIds: query.tagId,
    attrs: query.attrs,
  };
}

partsRoutes.get("/", async (c) => {
  const service = createService(getDb(c.env));
  const filters = getFilters(c.req.url);
  const result = await service.list(filters);
  return c.json({ data: result.items, total: result.total, page: filters.page ?? 1, pageSize: filters.pageSize ?? 50 });
});

partsRoutes.get("/stats", async (c) => {
  const service = createService(getDb(c.env));
  const filters = getFilters(c.req.url);
  return c.json({ data: await service.getStats(filters) });
});

partsRoutes.get("/analytics", async (c) => {
  const service = createService(getDb(c.env));
  const filters = getFilters(c.req.url);
  return c.json({ data: await service.getAnalytics(filters) });
});

partsRoutes.get("/attribute-values", async (c) => {
  const key = new URL(c.req.url).searchParams.get("key");
  if (!key) return c.json({ data: [] });
  const service = createService(getDb(c.env));
  return c.json({ data: await service.listDistinctAttributeValues(key) });
});

partsRoutes.get("/:id", async (c) => {
  const service = createService(getDb(c.env));
  return c.json({ data: await service.getDetail(Number(c.req.param("id"))) });
});

partsRoutes.post("/bulk/archive", async (c) => {
  const { ids } = bulkDeleteSchema.parse(await c.req.json());
  console.log(JSON.stringify({ event: "bulk_archive", ids }));
  const service = createService(getDb(c.env));
  await service.bulkArchive(ids);
  return c.json({ data: { ok: true } });
});

partsRoutes.post("/bulk/update", async (c) => {
  const { ids, data } = bulkUpdateSchema.parse(await c.req.json());
  console.log(JSON.stringify({ event: "bulk_update", ids, data }));
  const service = createService(getDb(c.env));
  await service.bulkUpdate(ids, data);
  return c.json({ data: { ok: true } });
});

partsRoutes.post("/", async (c) => {
  const input = partWriteSchema.parse(await c.req.json());
  const service = createService(getDb(c.env));
  return c.json({ data: await service.create(input) }, 201);
});

partsRoutes.put("/:id", async (c) => {
  const input = partWriteSchema.parse(await c.req.json());
  const service = createService(getDb(c.env));
  return c.json({ data: await service.update(Number(c.req.param("id")), input) });
});

partsRoutes.delete("/:id", async (c) => {
  const service = createService(getDb(c.env));
  await service.archive(Number(c.req.param("id")));
  return c.json({ data: { ok: true } });
});

partsRoutes.post("/:id/restore", async (c) => {
  const service = createService(getDb(c.env));
  await service.restore(Number(c.req.param("id")));
  return c.json({ data: { ok: true } });
});

partsRoutes.delete("/:id/permanent", async (c) => {
  const service = createService(getDb(c.env));
  await service.delete(Number(c.req.param("id")));
  return c.json({ data: { ok: true } });
});

partsRoutes.post("/:id/stock", async (c) => {
  const input = stockChangeSchema.parse(await c.req.json());
  const service = createService(getDb(c.env));
  return c.json({ data: await service.changeStock(Number(c.req.param("id")), input) });
});

partsRoutes.get("/:id/movements", async (c) => {
  const service = createService(getDb(c.env));
  return c.json({ data: await service.listMovements(Number(c.req.param("id"))) });
});
