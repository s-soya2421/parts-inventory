import { Hono } from "hono";
import { getDb } from "../../db/client";
import type { Env } from "../../types";
import { parseJsonBody } from "../../middleware/request-body";
import { PartsRepository } from "../parts/parts.repository";
import { TagsRepository } from "./tags.repository";
import { tagWriteSchema } from "./tags.schemas";

export const tagsRoutes = new Hono<Env>();

tagsRoutes.get("/", async (c) => {
  const repository = new TagsRepository(getDb(c.env));
  return c.json({ data: await repository.list() });
});

tagsRoutes.post("/", async (c) => {
  const input = tagWriteSchema.parse(await parseJsonBody(c));
  const repository = new TagsRepository(getDb(c.env));
  return c.json({ data: await repository.create(input) }, 201);
});

tagsRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const input = tagWriteSchema.parse(await parseJsonBody(c));
  const db = getDb(c.env);
  const repository = new TagsRepository(db);
  const tag = await repository.update(id, input);
  const partsRepository = new PartsRepository(db);
  await partsRepository.rebuildSearchTextForParts(await partsRepository.listPartIdsByTag(id));
  return c.json({ data: tag });
});

tagsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const repository = new TagsRepository(db);
  const partsRepository = new PartsRepository(db);
  const affectedPartIds = await partsRepository.listPartIdsByTag(id);
  await repository.delete(id);
  await partsRepository.rebuildSearchTextForParts(affectedPartIds);
  return c.json({ data: { ok: true } });
});
