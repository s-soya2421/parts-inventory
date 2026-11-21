import { Hono } from "hono";
import { getDb } from "../../db/client";
import type { Env } from "../../types";
import { parseJsonBody } from "../../middleware/request-body";
import { StatusesRepository } from "./statuses.repository";
import { statusWriteSchema } from "./statuses.schemas";

export const statusesRoutes = new Hono<Env>();

statusesRoutes.get("/", async (c) => {
  const repository = new StatusesRepository(getDb(c.env));
  return c.json({ data: await repository.list() });
});

statusesRoutes.post("/", async (c) => {
  const input = statusWriteSchema.parse(await parseJsonBody(c));
  const repository = new StatusesRepository(getDb(c.env));
  return c.json({ data: await repository.create(input) }, 201);
});

statusesRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const input = statusWriteSchema.parse(await parseJsonBody(c));
  const repository = new StatusesRepository(getDb(c.env));
  return c.json({ data: await repository.update(id, input) });
});

statusesRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const repository = new StatusesRepository(getDb(c.env));
  await repository.delete(id);
  return c.json({ data: { ok: true } });
});
