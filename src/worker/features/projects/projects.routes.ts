import { Hono } from "hono";
import { getDb } from "../../db/client";
import type { Env } from "../../types";
import { ProjectsRepository } from "./projects.repository";
import { ProjectsService } from "./projects.service";
import { projectPartInputSchema, projectWriteSchema } from "./projects.schemas";

export const projectsRoutes = new Hono<Env>();

function createService(db: D1Database): ProjectsService {
  return new ProjectsService(new ProjectsRepository(db));
}

projectsRoutes.get("/", async (c) => {
  const service = createService(getDb(c.env));
  const rawPartId = c.req.query("partId");
  const partId = rawPartId ? Number(rawPartId) : undefined;
  return c.json({ data: await service.list(partId) });
});

projectsRoutes.post("/", async (c) => {
  const input = projectWriteSchema.parse(await c.req.json());
  const service = createService(getDb(c.env));
  return c.json({ data: await service.create(input) }, 201);
});

projectsRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const service = createService(getDb(c.env));
  return c.json({ data: await service.getDetail(id) });
});

projectsRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const input = projectWriteSchema.parse(await c.req.json());
  const service = createService(getDb(c.env));
  return c.json({ data: await service.update(id, input) });
});

projectsRoutes.post("/:id/parts", async (c) => {
  const id = Number(c.req.param("id"));
  const input = projectPartInputSchema.parse(await c.req.json());
  const service = createService(getDb(c.env));
  return c.json({ data: await service.addPart(id, input) });
});

projectsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const service = createService(getDb(c.env));
  await service.delete(id);
  return c.json({ data: { ok: true } });
});
