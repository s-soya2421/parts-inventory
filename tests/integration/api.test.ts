import { beforeEach, describe, expect, it } from "vitest";
import { createTestClient, type TestClient } from "./harness";

let client: TestClient;

beforeEach(() => {
  // Fresh migrated in-memory DB (with seed data) per test.
  client = createTestClient();
});

describe("auth", () => {
  it("returns 401 without credentials", async () => {
    const response = await client.raw("/api/health", { headers: { authorization: "" } });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/Basic realm="electronics-inventory"/);
  });

  it("returns 401 with a wrong password", async () => {
    const response = await client.raw("/api/health", {
      headers: { authorization: `Basic ${Buffer.from("inventory:nope").toString("base64")}` },
    });
    expect(response.status).toBe(401);
  });

  it("allows authenticated health checks", async () => {
    const { response, body } = await client.request("/api/health");
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

describe("parts CRUD", () => {
  it("creates, reads, and reports an initial stock movement", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "TestCat" }),
    });
    expect(category.response.status).toBe(201);

    const created = await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({
        categoryId: category.body.data.id,
        modelNumber: "RF-1",
        name: "Module",
        stockQuantity: 4,
        attributes: [{ key: "freq", label: "Freq", value: "2.4", unit: "GHz" }],
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data.stockQuantity).toBe(4);
    expect(created.body.data.movements.length).toBeGreaterThan(0);

    const detail = await client.request(`/api/parts/${created.body.data.id}`);
    expect(detail.response.status).toBe(200);
    expect(detail.body.data.modelNumber).toBe("RF-1");
  });

  it("returns 404 for a missing part", async () => {
    const { response } = await client.request("/api/parts/999999");
    expect(response.status).toBe(404);
  });

  it("returns 400 on validation failure (empty model number)", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "ValidCat" }),
    });
    const { response, body } = await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({ categoryId: category.body.data.id, modelNumber: "", name: "x", stockQuantity: 1 }),
    });
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("stock movements", () => {
  it("applies an 'in' change and records the movement with correct math", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "StockCat" }),
    });
    const created = await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({ categoryId: category.body.data.id, modelNumber: "S-1", name: "p", stockQuantity: 10 }),
    });
    const partId = created.body.data.id;

    const changed = await client.request(`/api/parts/${partId}/stock`, {
      method: "POST",
      body: JSON.stringify({ type: "in", quantity: 7, reason: "restock" }),
    });
    expect(changed.response.status).toBe(200);
    expect(changed.body.data.stockQuantity).toBe(17);

    const movements = await client.request(`/api/parts/${partId}/movements`);
    expect(movements.response.status).toBe(200);
    const inMovement = movements.body.data.find((m: any) => m.movementType === "in");
    expect(inMovement).toMatchObject({ quantityBefore: 10, quantityDelta: 7, quantityAfter: 17 });
  });

  it("rejects an 'out' change that would go negative", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "NegCat" }),
    });
    const created = await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({ categoryId: category.body.data.id, modelNumber: "N-1", name: "p", stockQuantity: 2 }),
    });
    const { response, body } = await client.request(`/api/parts/${created.body.data.id}/stock`, {
      method: "POST",
      body: JSON.stringify({ type: "out", quantity: 5, reason: "use" }),
    });
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("NEGATIVE_STOCK");
  });
});

describe("import flow", () => {
  const baseRow = (overrides: Record<string, unknown> = {}) => ({
    category: "ImportCat",
    model_number: "IMP-1",
    name: "Imported",
    stock_quantity: 5,
    low_stock_threshold: 0,
    ...overrides,
  });

  it("imports new rows and dedups existing ones in skip mode", async () => {
    const first = await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "skip", rows: [baseRow(), baseRow({ model_number: "IMP-2" })] }),
    });
    expect(first.response.status).toBe(200);
    expect(first.body.data.created).toBe(2);
    expect(first.body.data.batchId).toBeTruthy();

    // Re-import the same key with skip mode -> skipped, not duplicated.
    const second = await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "skip", rows: [baseRow({ name: "Changed" })] }),
    });
    expect(second.body.data.created).toBe(0);
    expect(second.body.data.skipped).toBe(1);
  });

  it("updates existing rows in update mode and dedups by model + category", async () => {
    await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "skip", rows: [baseRow({ stock_quantity: 5 })] }),
    });
    const update = await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "update", rows: [baseRow({ name: "Updated Name", stock_quantity: 9 })] }),
    });
    expect(update.body.data.updated).toBe(1);
    expect(update.body.data.created).toBe(0);

    // Same model in a different category is a distinct part.
    const otherCat = await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "skip", rows: [baseRow({ category: "OtherImportCat" })] }),
    });
    expect(otherCat.body.data.created).toBe(1);
  });

  it("rejects more than 1000 rows with a 400 (the .max(1000) cap)", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => baseRow({ model_number: `BULK-${i}` }));
    const { response, body } = await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "skip", rows }),
    });
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("lists batches and reverts: created parts removed, updated parts restored", async () => {
    // Create a part to be updated later.
    const createBatch = await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "skip", rows: [baseRow({ model_number: "REV-NEW" })] }),
    });
    const createdPartId = await findPartId(client, "ImportCat", "REV-NEW");
    expect(createdPartId).toBeTruthy();
    expect(createBatch.body.data.created).toBe(1);

    // Seed a part then update it via import (captures a before-snapshot).
    await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({ mode: "skip", rows: [baseRow({ model_number: "REV-UPD", stock_quantity: 3 })] }),
    });
    const updatedPartId = await findPartId(client, "ImportCat", "REV-UPD");
    const updateBatch = await client.request("/api/import/parts", {
      method: "POST",
      body: JSON.stringify({
        mode: "update",
        rows: [baseRow({ model_number: "REV-UPD", name: "After", stock_quantity: 99 })],
      }),
    });
    expect(updateBatch.body.data.updated).toBe(1);

    const batches = await client.request("/api/import/batches");
    expect(batches.response.status).toBe(200);
    expect(batches.body.data.length).toBeGreaterThanOrEqual(2);
    expect(batches.body.data.every((b: any) => b.revertable)).toBe(true);

    // Revert the CREATE batch -> the new part is deleted.
    const revertCreate = await client.request(`/api/import/batches/${createBatch.body.data.batchId}/revert`, {
      method: "POST",
    });
    expect(revertCreate.body.data.deleted).toBe(1);
    const goneResponse = await client.raw(`/api/parts/${createdPartId}`);
    expect(goneResponse.status).toBe(404);

    // Revert the UPDATE batch -> the updated part is restored to its prior name/stock.
    const revertUpdate = await client.request(`/api/import/batches/${updateBatch.body.data.batchId}/revert`, {
      method: "POST",
    });
    expect(revertUpdate.body.data.restored).toBe(1);
    const restored = await client.request(`/api/parts/${updatedPartId}`);
    expect(restored.body.data.name).toBe("Imported");
    expect(restored.body.data.stockQuantity).toBe(3);
  });
});

describe("attribute filter operators", () => {
  it("filters parts by eq / gt / lte operators against real SQL", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "AttrCat" }),
    });
    const categoryId = category.body.data.id;

    // Attribute filters resolve against the normalized part_attribute_values table,
    // which is only populated for attributes that have a category definition.
    await client.request(`/api/categories/${categoryId}/attributes`, {
      method: "PUT",
      body: JSON.stringify([
        { key: "resistance", label: "Resistance", dataType: "number", unit: "Ω", isSearchable: true, sortOrder: 10 },
      ]),
    });

    await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({
        categoryId,
        modelNumber: "A-LOW",
        name: "low",
        stockQuantity: 1,
        attributes: [{ key: "resistance", value: "1000", unit: "Ω" }],
      }),
    });
    await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({
        categoryId,
        modelNumber: "A-HIGH",
        name: "high",
        stockQuantity: 1,
        attributes: [{ key: "resistance", value: "4700", unit: "Ω" }],
      }),
    });

    const eq = await client.request(
      `/api/parts?categoryId=${categoryId}&attrs=${encodeURIComponent(JSON.stringify({ resistance: 1000 }))}`,
    );
    expect(eq.body.data.map((p: any) => p.modelNumber)).toEqual(["A-LOW"]);

    const gt = await client.request(
      `/api/parts?categoryId=${categoryId}&attrs=${encodeURIComponent(JSON.stringify({ resistance: { op: "gt", val: "1000" } }))}`,
    );
    expect(gt.body.data.map((p: any) => p.modelNumber)).toEqual(["A-HIGH"]);

    const lte = await client.request(
      `/api/parts?categoryId=${categoryId}&attrs=${encodeURIComponent(JSON.stringify({ resistance: { op: "lte", val: "1000" } }))}`,
    );
    expect(lte.body.data.map((p: any) => p.modelNumber)).toEqual(["A-LOW"]);
  });
});

describe("category deletion", () => {
  it("deletes a category with no parts", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "DelEmptyCat" }),
    });
    const categoryId = category.body.data.id;

    const { response } = await client.request(`/api/categories/${categoryId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);

    const categories = await client.request("/api/categories");
    expect(categories.body.data.some((c: any) => c.id === categoryId)).toBe(false);
  });

  it("blocks deletion with an active part (409 CATEGORY_IN_USE)", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "DelActiveCat" }),
    });
    const categoryId = category.body.data.id;
    await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({ categoryId, modelNumber: "S-1", name: "p", stockQuantity: 1 }),
    });

    const { response, body } = await client.request(`/api/categories/${categoryId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CATEGORY_IN_USE");
  });

  it("blocks deletion when only archived parts remain (409 CATEGORY_HAS_ARCHIVED_PARTS)", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "DelArchivedCat" }),
    });
    const categoryId = category.body.data.id;
    const part = await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({ categoryId, modelNumber: "S-1", name: "p", stockQuantity: 1 }),
    });
    const partId = part.body.data.id;
    await client.request(`/api/parts/${partId}`, {
      method: "DELETE",
    });

    const { response, body } = await client.request(`/api/categories/${categoryId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CATEGORY_HAS_ARCHIVED_PARTS");
  });

  it("force=true deletes a category along with its archived parts", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "DelForceArchivedCat" }),
    });
    const categoryId = category.body.data.id;
    const part = await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({ categoryId, modelNumber: "S-1", name: "p", stockQuantity: 1 }),
    });
    const partId = part.body.data.id;
    await client.request(`/api/parts/${partId}`, {
      method: "DELETE",
    });

    const { response, body } = await client.request(`/api/categories/${categoryId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CATEGORY_HAS_ARCHIVED_PARTS");
    expect(Array.isArray(body.error.details.archivedParts)).toBe(true);
    expect(body.error.details.archivedParts.length).toBeGreaterThanOrEqual(1);
    expect(body.error.details.archivedParts[0]).toHaveProperty("name");
    expect(body.error.details.archivedParts[0]).toHaveProperty("modelNumber");

    const force = await client.request(`/api/categories/${categoryId}?force=true`, {
      method: "DELETE",
    });
    expect(force.response.status).toBe(200);

    const categories = await client.request("/api/categories");
    expect(categories.body.data.some((c: any) => c.id === categoryId)).toBe(false);

    const archivedParts = await client.request(`/api/parts?categoryId=${categoryId}&archived=archived`);
    expect(archivedParts.body.data.length).toBe(0);
  });

  it("force=true still blocks deletion when an active part exists (409 CATEGORY_IN_USE)", async () => {
    const category = await client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "DelForceActiveCat" }),
    });
    const categoryId = category.body.data.id;
    await client.request("/api/parts", {
      method: "POST",
      body: JSON.stringify({ categoryId, modelNumber: "S-1", name: "p", stockQuantity: 1 }),
    });

    const { response, body } = await client.request(`/api/categories/${categoryId}?force=true`, {
      method: "DELETE",
    });
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CATEGORY_IN_USE");

    const parts = await client.request(`/api/parts?categoryId=${categoryId}`);
    expect(parts.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

async function findPartId(client: TestClient, categoryName: string, modelNumber: string): Promise<number> {
  const row = await client.db
    .prepare(
      `SELECT p.id AS id FROM parts p JOIN categories c ON c.id = p.category_id
       WHERE c.name = ? AND p.model_number = ? LIMIT 1`,
    )
    .bind(categoryName, modelNumber)
    .first<{ id: number }>();
  return row?.id ?? 0;
}
