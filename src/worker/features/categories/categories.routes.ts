import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client";
import { AppError } from "../../middleware/error-handler";
import type { Env } from "../../types";
import { slugify } from "../../utils";
import { PartsRepository } from "../parts/parts.repository";
import { CategoriesRepository } from "./categories.repository";
import { attributeDefinitionSchema, categoryListHeaderSchema, categoryWriteSchema } from "./categories.schemas";

export const categoriesRoutes = new Hono<Env>();

categoriesRoutes.get("/", async (c) => {
  const repository = new CategoriesRepository(getDb(c.env));
  return c.json({ data: await repository.list() });
});

categoriesRoutes.post("/", async (c) => {
  const input = categoryWriteSchema.parse(await c.req.json());
  const repository = new CategoriesRepository(getDb(c.env));
  return c.json({ data: await repository.create(input) }, 201);
});

categoriesRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const input = categoryWriteSchema.parse(await c.req.json());
  const db = getDb(c.env);
  const repository = new CategoriesRepository(db);
  const category = await repository.update(id, input);
  await new PartsRepository(db).rebuildSearchTextForCategory(id);
  return c.json({ data: category });
});

categoriesRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const repository = new CategoriesRepository(getDb(c.env));
  const force = new URL(c.req.url).searchParams.get("force") === "true";
  await repository.delete(id, { force });
  return c.json({ data: { ok: true } });
});

categoriesRoutes.get("/:id/attributes", async (c) => {
  const id = Number(c.req.param("id"));
  const repository = new CategoriesRepository(getDb(c.env));
  return c.json({ data: await repository.listAttributeDefinitions(id) });
});

categoriesRoutes.put("/:id/attributes", async (c) => {
  const id = Number(c.req.param("id"));
  const input = z.array(attributeDefinitionSchema).parse(await c.req.json());
  const db = getDb(c.env);
  const repository = new CategoriesRepository(db);

  // Auto-generate keys: for existing items without key, preserve DB key; for new items, slugify label
  const existing = await repository.listAttributeDefinitions(id);
  const usedKeys = new Set<string>();
  for (const item of input) {
    if (!item.key) {
      if (item.id) {
        const found = existing.find((e) => e.id === item.id);
        item.key = found?.key ?? slugify(item.label);
      } else {
        item.key = slugify(item.label);
      }
    }
    // Deduplicate keys within the batch
    let key = item.key;
    if (usedKeys.has(key)) {
      let suffix = 2;
      while (usedKeys.has(`${key}-${suffix}`)) suffix++;
      key = `${key}-${suffix}`;
      item.key = key;
    }
    usedKeys.add(key);
  }

  try {
    await repository.updateAttributeDefinitions(id, input);
    return c.json({ data: { ok: true } });
  } catch (error) {
    console.error("Failed to update attribute definitions:", error);
    if (error instanceof Error) {
      throw new AppError("DB_ERROR", "仕様項目の保存中にエラーが発生しました。", 500);
    }
    throw error;
  }
});

categoriesRoutes.get("/:id/headers", async (c) => {
  const id = Number(c.req.param("id"));
  const repository = new CategoriesRepository(getDb(c.env));
  return c.json({ data: await repository.listHeaders(id) });
});

categoriesRoutes.put("/:id/headers", async (c) => {
  const id = Number(c.req.param("id"));
  const input = z.array(categoryListHeaderSchema).parse(await c.req.json());
  const db = getDb(c.env);
  const repository = new CategoriesRepository(db);

  try {
    await repository.updateHeaders(id, input);
    return c.json({ data: { ok: true } });
  } catch (error) {
    console.error("Failed to update headers:", error);
    if (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed")) {
      throw new AppError(
        "FK_CONSTRAINT",
        "一覧表示列が参照している仕様項目が見つかりません。削除された仕様項目を参照していないか確認してください。",
        400,
      );
    }
    if (error instanceof Error) {
      throw new AppError("DB_ERROR", `ヘッダーの保存中にエラーが発生しました。`, 500);
    }
    throw error;
  }
});
