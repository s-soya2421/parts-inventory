import { Hono } from "hono";
import { getDb } from "../../db/client";
import type { Env } from "../../types";
import { parseJsonBody } from "../../middleware/request-body";
import { LocationsRepository } from "./locations.repository";
import { locationWriteSchema } from "./locations.schemas";

export const locationsRoutes = new Hono<Env>();

locationsRoutes.get("/", async (c) => {
  const repository = new LocationsRepository(getDb(c.env));
  return c.json({ data: await repository.list() });
});

locationsRoutes.post("/", async (c) => {
  const input = locationWriteSchema.parse(await parseJsonBody(c));
  const repository = new LocationsRepository(getDb(c.env));
  return c.json({ data: await repository.create(input) }, 201);
});

locationsRoutes.put("/:id", async (c) => {
  const input = locationWriteSchema.parse(await parseJsonBody(c));
  const repository = new LocationsRepository(getDb(c.env));
  return c.json({ data: await repository.update(Number(c.req.param("id")), input) });
});

locationsRoutes.delete("/:id", async (c) => {
  const repository = new LocationsRepository(getDb(c.env));
  await repository.delete(Number(c.req.param("id")));
  return c.json({ data: { ok: true } });
});
