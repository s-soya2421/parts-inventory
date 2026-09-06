import { beforeEach, describe, expect, it } from "vitest";
import { createTestClient, type TestClient } from "./harness";
import type { Category, PartAttribute, PartDetail, StockMovement } from "../../src/shared/types";
import { PartsService } from "../../src/worker/features/parts/parts.service";
import { PartsRepository } from "../../src/worker/features/parts/parts.repository";
import { CategoriesRepository } from "../../src/worker/features/categories/categories.repository";
import { TagsRepository } from "../../src/worker/features/tags/tags.repository";
import { partWriteSchema } from "../../src/worker/features/parts/parts.schemas";
import { parseImportJson } from "../../src/web/lib/import-parser";
import { buildRowsForBlock } from "../../src/web/lib/excel-parser";

let client: TestClient;

beforeEach(() => {
  client = createTestClient();
});

const baseInput = {
  categoryId: 1, // Seeded 半導体, whose slug is semiconductors.
  modelNumber: "INTEGRITY-1",
  name: "Integrity test part",
  stockQuantity: 10,
};

async function createPart(overrides: Record<string, unknown> = {}) {
  const { response, body } = await client.request("/api/parts", {
    method: "POST",
    body: JSON.stringify({ ...baseInput, ...overrides }),
  });
  expect(response.status).toBe(201);
  return body.data;
}

async function getPart(id: number) {
  const { response, body } = await client.request(`/api/parts/${id}`);
  expect(response.status).toBe(200);
  return body.data;
}

function stock(id: number, quantity: number) {
  return client.request(`/api/parts/${id}/stock`, {
    method: "POST", body: JSON.stringify({ type: "out", quantity }),
  });
}

function importRow(extra: Record<string, unknown> = {}, mode = "update") {
  return client.request("/api/import/parts", {
    method: "POST",
    body: JSON.stringify({ mode, rows: parseImportJson(JSON.stringify([{
      category: "半導体", model_number: baseInput.modelNumber,
      name: "Imported name", stock_quantity: 6, ...extra,
    }])) }),
  });
}

describe("inventory write integrity", () => {
  it("applies both concurrent withdrawals and records a continuous history", async () => {
    const part = await createPart();
    const results = await Promise.all([stock(part.id, 3), stock(part.id, 3)]);
    expect(results.map((r) => r.response.status)).toEqual([200, 200]);
    const after = await getPart(part.id);
    expect(after.stockQuantity).toBe(4);
    expect(after.movements.map((m: StockMovement) => [m.quantityBefore, m.quantityAfter]))
      .toEqual([[7, 4], [10, 7], [0, 10]]);
  });

  it("rejects a competing withdrawal when the remaining stock is insufficient", async () => {
    const part = await createPart({ stockQuantity: 3 });
    const results = await Promise.all([stock(part.id, 2), stock(part.id, 2)]);
    expect(results.map((r) => r.response.status).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.response.status === 400)?.body.error.code).toBe("NEGATIVE_STOCK");
    const after = await getPart(part.id);
    expect(after.stockQuantity).toBe(1);
    expect(after.movements).toHaveLength(2); // No movement for the rejected request.
  });

  it.each([
    { tagIds: [999999] },
    { attributes: [{ key: "duplicate", value: "a" }, { key: "duplicate", value: "b" }] },
  ])("rolls back an edit and its movement when related rows fail: %j", async (invalidRelations) => {
    const part = await createPart({
      tagIds: [1], attributes: [{ key: "voltage", value: "5", unit: "V" }], alternatives: ["ALT-1"],
    });
    const db = client.db as unknown as D1Database;
    const service = new PartsService(new PartsRepository(db), new CategoriesRepository(db), new TagsRepository(db));
    await expect(service.update(part.id, partWriteSchema.parse({
      ...baseInput, name: "Should roll back", stockQuantity: 20, ...invalidRelations,
    }))).rejects.toThrow(/constraint/i);
    expect(await getPart(part.id)).toEqual(part);
  });

  it("keeps edit history consistent when an edit overlaps a stock operation", async () => {
    const part = await createPart();
    const results = await Promise.all([
      stock(part.id, 3),
      client.request(`/api/parts/${part.id}`, {
        method: "PUT", body: JSON.stringify({ ...baseInput, stockQuantity: 20 }),
      }),
    ]);
    expect(results.map((r) => r.response.status)).toEqual([200, 200]);
    const after = await getPart(part.id);
    const movements = [...after.movements].reverse();
    expect(movements).toHaveLength(3);
    for (let i = 1; i < movements.length; i += 1) {
      expect(movements[i].quantityBefore).toBe(movements[i - 1].quantityAfter);
    }
    expect(after.stockQuantity).toBe(movements.at(-1).quantityAfter);
  });
});

describe("import data preservation", () => {
  it("matches seeded category names for update and skip without duplicating parts", async () => {
    const part = await createPart();
    const updated = await importRow();
    expect(updated.body.data).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(await getPart(part.id)).toMatchObject({ stockQuantity: 6, categoryId: 1 });
    const skipped = await importRow({}, "skip");
    expect(skipped.body.data).toMatchObject({ created: 0, updated: 0, skipped: 1, failed: 0 });
    const categories = await client.request("/api/categories");
    expect(categories.body.data.filter((c: Category) => c.name === "半導体")).toHaveLength(1);
    const parts = await client.request(`/api/parts?q=${baseInput.modelNumber}`);
    expect(parts.body.data.map((p: PartDetail) => p.id)).toEqual([part.id]);
  });

  it("preserves metadata absent from an import and restores the snapshotted status", async () => {
    const metadata = {
      description: "Keep description", locationId: 1, statusId: 1,
      purchaseUrl: "https://example.com/buy", datasheetUrl: "https://example.com/data",
      alternatives: ["ALT-1"], manufacturer: "Maker", footprint: "DIP", caseNumber: "A-1",
      price: 15, memo: "Keep memo", lowStockThreshold: 3, tagIds: [1], attributes: [{ key: "voltage", value: "5", unit: "V" }],
    };
    const part = await createPart(metadata);
    const result = await importRow();
    expect(result.body.data).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const after = await getPart(part.id);
    for (const key of ["description", "locationId", "statusId", "purchaseUrl", "datasheetUrl",
      "alternatives", "manufacturer", "footprint", "caseNumber", "price", "memo", "lowStockThreshold", "tags"]) {
      expect(after[key]).toEqual(part[key]);
    }
    const attributeData = ({ key, label, value, unit, normalizedValue }: PartAttribute) => ({ key, label, value, unit, normalizedValue });
    expect(after.attributes.map(attributeData)).toEqual(part.attributes.map(attributeData));
    // Prove status is in the saved snapshot, rather than merely retained by the update.
    await client.db.prepare("UPDATE parts SET status_id = NULL WHERE id = ?").bind(part.id).run();
    const reverted = await client.request(`/api/import/batches/${result.body.data.batchId}/revert`, { method: "POST" });
    expect(reverted.response.status).toBe(200);
    const restored = await getPart(part.id);
    expect(restored).toMatchObject({ name: part.name, stockQuantity: 10, statusId: 1 });
    expect(restored.alternatives).toEqual(part.alternatives);
    expect(restored.tags).toEqual(part.tags);
  });

  it("preserves optional fields that are not mapped in an Excel import", async () => {
    const part = await createPart({ price: 25, manufacturer: "Maker", footprint: "DIP", caseNumber: "A", memo: "Keep" });
    const rows = buildRowsForBlock({
      id: "review-block", signature: "review-signature",
      sheetName: "半導体", blockTitle: "", status: "", headers: ["型番", "在庫数"],
      rows: [[baseInput.modelNumber, "6"]],
    }, { 0: "model_number", 1: "stock_quantity" }, {
      blockTitleAsTag: false, statusAsTag: false, lowStockThreshold: 0,
    });
    const result = await client.request("/api/import/parts", {
      method: "POST", body: JSON.stringify({ mode: "update", rows }),
    });
    expect(result.body.data).toMatchObject({ updated: 1, failed: 0 });
    expect(await getPart(part.id)).toMatchObject({
      stockQuantity: 6, price: 25, manufacturer: "Maker", footprint: "DIP", caseNumber: "A", memo: "Keep",
    });
  });

  it("still clears supported optional fields when explicitly requested", async () => {
    const part = await createPart({ price: 15, memo: "old", tagIds: [1], attributes: [{ key: "v", value: "5" }] });
    const result = await importRow({ price: null, memo: null, tags: [], attributes_json: {} });
    expect(result.body.data.updated).toBe(1);
    expect(await getPart(part.id)).toMatchObject({ price: null, memo: null, tags: [], attributes: [] });
  });

  it("reports ambiguous duplicate category names instead of updating an arbitrary part", async () => {
    const part = await createPart();
    await client.request("/api/categories", {
      method: "POST", body: JSON.stringify({ name: "半導体", slug: "duplicate-semiconductors" }),
    });
    const result = await importRow();
    expect(result.body.data).toMatchObject({ created: 0, updated: 0, failed: 1, batchId: null });
    expect(await getPart(part.id)).toEqual(part);
  });
});
