import { Hono } from "hono";
import { getDb } from "../../db/client";
import type { Env } from "../../types";
import { parseJsonBody } from "../../middleware/request-body";
import { ImportService } from "./import.service";
import { importPartsSchema } from "./import.schemas";

export const importRoutes = new Hono<Env>();

importRoutes.post("/parts", async (c) => {
  const input = importPartsSchema.parse(await parseJsonBody(c));
  const service = new ImportService(getDb(c.env));
  return c.json({ data: await service.importRows(input.rows, input.mode) });
});

importRoutes.get("/batches", async (c) => {
  const service = new ImportService(getDb(c.env));
  return c.json({ data: await service.listBatches() });
});

importRoutes.post("/batches/:id/revert", async (c) => {
  const service = new ImportService(getDb(c.env));
  return c.json({ data: await service.revertBatch(Number(c.req.param("id"))) });
});
