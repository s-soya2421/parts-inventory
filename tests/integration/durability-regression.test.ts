import { describe, expect, it } from "vitest";
import { createTestClient } from "./harness";

type Client = ReturnType<typeof createTestClient>;
const write = (c: Client, path: string, method: "POST" | "PUT", data: unknown) =>
  c.request(path, { method, body: JSON.stringify(data) });
const read = (c: Client, path: string) => c.request(path);

async function createCategory(c: Client, label: string) {
  const x = await write(c, "/api/categories", "POST", { name: label, slug: label.toLowerCase() });
  expect(x.response.status).toBe(201);
  return x.body.data.id as number;
}
async function createPart(c: Client, categoryId: number, model: string, attributes = [{ key: "ohms", value: "10", unit: "Ω" }]) {
  const x = await write(c, "/api/parts", "POST", {
    categoryId, modelNumber: model, name: model, stockQuantity: 10, attributes,
  });
  expect(x.response.status).toBe(201);
  return x.body.data.id as number;
}
async function definitions(c: Client, categoryId: number) {
  return (await read(c, "/api/categories/" + categoryId + "/attributes")).body.data as Array<{
    id: number; key: string; label: string; dataType: string; unit: string | null;
    groupName: string | null; isSearchable: boolean; sortOrder: number
  }>;
}
const def = (key: string) => ({ key, label: key, dataType: "number", isSearchable: true, sortOrder: 1 });

describe("safe migration: atomic import rollback", () => {
  it("reverts multiple imported updates and the revert marker in ONE D1 batch", async () => {
    const c = createTestClient();
    const a = await createPart(c, 2, "ATOMIC-A", []);
    const b = await createPart(c, 2, "ATOMIC-B", []);
    const imported = await write(c, "/api/import/parts", "POST", {
      mode: "update", rows: [
        { category: "受動部品", model_number: "ATOMIC-A", name: "changed A", stock_quantity: 19 },
        { category: "受動部品", model_number: "ATOMIC-B", name: "changed B", stock_quantity: 18 },
      ],
    });
    expect(imported.body.data.updated).toBe(2);
    const orig = c.db.batch.bind(c.db);
    let batches = 0;
    c.db.batch = async (...args: Parameters<typeof orig>) => {
      batches++;
      return orig(...args);
    };
    const revert = await write(c, "/api/import/batches/" + imported.body.data.batchId + "/revert", "POST", {});
    expect(revert.response.status).toBe(200);
    expect(batches).toBe(1);
    expect((await read(c, "/api/parts/" + a)).body.data.stockQuantity).toBe(10);
    expect((await read(c, "/api/parts/" + b)).body.data.stockQuantity).toBe(10);
  });

  it("rolls back ALL rows and marker if the final SQL statement fails", async () => {
    const c = createTestClient();
    const a = await createPart(c, 2, "ATOMIC-FAIL-A", []);
    const b = await createPart(c, 2, "ATOMIC-FAIL-B", []);
    const imported = await write(c, "/api/import/parts", "POST", {
      mode: "update", rows: [
        { category: "受動部品", model_number: "ATOMIC-FAIL-A", name: "new A", stock_quantity: 20 },
        { category: "受動部品", model_number: "ATOMIC-FAIL-B", name: "new B", stock_quantity: 30 },
      ],
    });
    expect(imported.body.data.updated).toBe(2);
    const orig = c.db.batch.bind(c.db);
    c.db.batch = async (statements) => orig([
      ...statements,
      // Simulate a fault at the end of the transaction, after all revert SQL.
      c.db.prepare("INSERT INTO categories (name, slug) VALUES ('unreachable', 'passives')"),
    ]);
    // An injected native SQLite fault may propagate before an HTTP response
    // is produced by the local adapter. What matters: no partial DB changes.
    try {
      const result = await write(c, "/api/import/batches/" + imported.body.data.batchId + "/revert", "POST", {});
      expect(result.response.status).toBeGreaterThanOrEqual(400);
    } catch (error) {
      expect(String(error)).toMatch(/UNIQUE constraint failed/);
    } finally {
      c.db.batch = orig;
    }
    expect((await read(c, "/api/parts/" + a)).body.data.stockQuantity).toBe(20);
    expect((await read(c, "/api/parts/" + b)).body.data.stockQuantity).toBe(30);
    const batches = (await read(c, "/api/import/batches")).body.data;
    expect(batches.find((x: { id: number }) => x.id === imported.body.data.batchId).revertedAt).toBeNull();
  });

  it("refuses a batch if a later manual change would be overwritten", async () => {
    const c = createTestClient();
    const id = await createPart(c, 2, "ATOMIC-CHANGED", []);
    const imported = await write(c, "/api/import/parts", "POST", {
      mode: "update", rows: [{ category: "受動部品", model_number: "ATOMIC-CHANGED", name: "changed", stock_quantity: 15 }],
    });
    await write(c, "/api/parts/" + id + "/stock", "POST", { type: "in", quantity: 3 });
    const result = await write(c, "/api/import/batches/" + imported.body.data.batchId + "/revert", "POST", {});
    expect(result.response.status).toBe(409);
    expect((await read(c, "/api/parts/" + id)).body.data.stockQuantity).toBe(18);
  });
});

describe("safe migration: category and typed attribute consistency", () => {
  it("rejects removing or renaming a definition while parts depend on it", async () => {
    const c = createTestClient();
    const cat = await createCategory(c, "ATTR-GUARD");
    await write(c, "/api/categories/" + cat + "/attributes", "PUT", [def("ohms")]);
    const id = await createPart(c, cat, "GUARDED");
    const [existing] = await definitions(c, cat);
    expect(existing.key).toBe("ohms");
    for (const body of [[], [{ ...existing, key: "new-ohms" }]]) {
      const response = await write(c, "/api/categories/" + cat + "/attributes", "PUT", body);
      expect(response.response.status).toBe(409);
      expect((await definitions(c, cat))[0].key).toBe("ohms");
      const item = (await read(c, "/api/parts/" + id)).body.data;
      expect(item.attributes.some((a: { key: string }) => a.key === "ohms")).toBe(true);
      expect(item.attributeValues.some((a: { key: string }) => a.key === "ohms")).toBe(true);
    }
  });

  it("backfills typed values from existing raw attributes on addition of a definition", async () => {
    const c = createTestClient();
    const cat = await createCategory(c, "ATTR-BACKFILL");
    const id = await createPart(c, cat, "RAW-ONLY");
    const before = (await read(c, "/api/parts/" + id)).body.data;
    expect(before.attributeValues).toHaveLength(0);
    const response = await write(c, "/api/categories/" + cat + "/attributes", "PUT", [def("ohms")]);
    expect(response.response.status).toBe(200);
    const after = (await read(c, "/api/parts/" + id)).body.data;
    expect(after.attributeValues).toMatchObject([{ key: "ohms", valueText: "10", valueNumber: 10 }]);
  });

  it("bulk category change remaps matching typed attributes and keeps all raw attributes", async () => {
    const c = createTestClient();
    const src = await createCategory(c, "ATTR-SOURCE");
    const dest = await createCategory(c, "ATTR-DEST");
    await write(c, "/api/categories/" + src + "/attributes", "PUT", [def("ohms"), def("volts")]);
    await write(c, "/api/categories/" + dest + "/attributes", "PUT", [def("ohms")]);
    const id = await createPart(c, src, "CATEGORY-MOVE", [
      { key: "ohms", value: "12", unit: "Ω" }, { key: "volts", value: "9", unit: "V" },
    ]);
    const response = await write(c, "/api/parts/bulk/update", "POST", {
      ids: [id], data: { categoryId: dest },
    });
    expect(response.response.status).toBe(200);
    const moved = (await read(c, "/api/parts/" + id)).body.data;
    expect(moved.categoryId).toBe(dest);
    expect(moved.attributes.map((a: { key: string }) => a.key).sort()).toEqual(["ohms", "volts"]);
    expect(moved.attributeValues.map((a: { key: string }) => a.key)).toEqual(["ohms"]);
  });
});
