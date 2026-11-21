import { describe, expect, it } from "vitest";
import { createTestClient, authHeader } from "./harness";
import { app } from "../../src/worker/app";

const sample = { categoryId: 2, modelNumber: "AUDIT-1", name: "監査用部品", stockQuantity: 10 };
async function post(client: ReturnType<typeof createTestClient>, path: string, data: unknown) {
  return client.request(path, { method: "POST", body: JSON.stringify(data) });
}
async function get(client: ReturnType<typeof createTestClient>, path: string) {
  return client.request(path);
}

describe("data integrity and production-limit regressions", () => {
  it("does not leave an orphaned part after duplicate attributes make a create fail", async () => {
    const c = createTestClient();
    const response = await post(c, "/api/parts", {
      ...sample, modelNumber: "AUDIT-DUP",
      attributes: [{ key: "duplicate", value: "one" }, { key: "duplicate", value: "two" }],
    });
    expect(response.response.status).toBeGreaterThanOrEqual(400);
    const items = await get(c, "/api/parts?q=AUDIT-DUP");
    expect(items.body.total).toBe(0);
  });

  it("does not wipe unrelated fields when an import updates a matching part", async () => {
    const c = createTestClient();
    const created = await post(c, "/api/parts", {
      ...sample, modelNumber: "IMPORT-PRESERVE",
      description: "Keep description", locationId: 1, purchaseUrl: "https://example.com/buy",
      datasheetUrl: "https://example.com/spec", statusId: 1,
      alternatives: ["PART-ALTERNATIVE"], price: null,
    });
    expect(created.response.status).toBe(201);
    const imported = await post(c, "/api/import/parts", {
      mode: "update",
      rows: [{ category: "受動部品", model_number: "IMPORT-PRESERVE", name: "更新名", stock_quantity: 14, price: 9 }],
    });
    expect(imported.response.status).toBe(200);
    expect(imported.body.data.updated).toBe(1);
    const after = await get(c, "/api/parts/" + created.body.data.id);
    expect(after.body.data).toMatchObject({
      description: "Keep description", locationId: 1, statusId: 1,
      purchaseUrl: "https://example.com/buy", datasheetUrl: "https://example.com/spec",
      stockQuantity: 14, price: 9,
    });
    expect(after.body.data.alternatives.map((a: { text: string }) => a.text)).toEqual(["PART-ALTERNATIVE"]);
  });

  it("keeps 50-item list hydration inside the 50-query Cloudflare Free budget", async () => {
    const c = createTestClient();
    await c.db.exec(
      Array.from({ length: 50 }, (_, i) =>
        "INSERT INTO parts (category_id, model_number, name, stock_quantity) VALUES (2, 'QCOUNT-" + i + "', 'QCOUNT-" + i + "', 1)",
      ).join(";\n") + ";",
    );
    let calls = 0;
    const original = c.db.prepare.bind(c.db);
    c.db.prepare = (sql: string) => {
      calls++;
      if (calls > 50) throw new Error("Cloudflare Free D1 request exceeded 50 queries");
      return original(sql);
    };
    const result = await get(c, "/api/parts?pageSize=50");
    expect(result.response.status).toBe(200);
    expect(result.body.data).toHaveLength(50);
    expect(calls).toBeLessThanOrEqual(50);
  });

  it("never loses a stock increment when several authenticated writes overlap", async () => {
    const c = createTestClient();
    const created = await post(c, "/api/parts", sample);
    const id = created.body.data.id;
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        post(c, "/api/parts/" + id + "/stock", { type: "in", quantity: 1, reason: "parallel" }),
      ),
    );
    expect(responses.map(x => x.response.status)).toEqual(Array(20).fill(200));
    const final = await get(c, "/api/parts/" + id);
    expect(final.body.data.stockQuantity).toBe(30);
    const history = await get(c, "/api/parts/" + id + "/movements");
    expect(history.body.data).toHaveLength(21);
    const deltas = history.body.data.filter((m: { movementType: string }) => m.movementType === "in");
    expect(deltas.reduce((n: number, m: { quantityDelta: number }) => n + m.quantityDelta, 0)).toBe(20);
  });

  it("rolls back project creation when its dependent inserts fail", async () => {
    const c = createTestClient();
    const original = c.db.batch.bind(c.db);
    c.db.batch = async (...args: Parameters<typeof original>) => {
      throw new Error("injected batch failure");
    };
    const res = await post(c, "/api/projects", { name: "MUST-ROLLBACK", costs: [{ name: "labor", amount: 50 }] });
    expect(res.response.status).toBeGreaterThanOrEqual(400);
    c.db.batch = original;
    const check = await get(c, "/api/projects");
    expect(check.body.data.some((p: { name: string }) => p.name === "MUST-ROLLBACK")).toBe(false);
  });

  it("rejects an import revert after a newer manual stock change", async () => {
    const c = createTestClient();
    const created = await post(c, "/api/parts", { ...sample, modelNumber: "ROLLBACK-CONFLICT" });
    const id = created.body.data.id;
    const imported = await post(c, "/api/import/parts", {
      mode: "update",
      rows: [{ category: "受動部品", model_number: "ROLLBACK-CONFLICT", name: "imported", stock_quantity: 14 }],
    });
    expect(imported.body.data.updated).toBe(1);
    const edited = await post(c, "/api/parts/" + id + "/stock", { type: "in", quantity: 3 });
    expect(edited.response.status).toBe(200);
    const reverted = await post(c, "/api/import/batches/" + imported.body.data.batchId + "/revert", {});
    expect(reverted.response.status).toBe(409);
    const stillThere = await get(c, "/api/parts/" + id);
    expect(stillThere.body.data.stockQuantity).toBe(17);
  });

  it("preflights all import revert entries before changing even one", async () => {
    const c = createTestClient();
    const a = await post(c, "/api/parts", { ...sample, modelNumber: "REV-PREFLIGHT-A" });
    const b = await post(c, "/api/parts", { ...sample, modelNumber: "REV-PREFLIGHT-B" });
    const imported = await post(c, "/api/import/parts", {
      mode: "update", rows: [
        { category: "受動部品", model_number: "REV-PREFLIGHT-A", name: "A", stock_quantity: 20 },
        { category: "受動部品", model_number: "REV-PREFLIGHT-B", name: "B", stock_quantity: 20 },
      ],
    });
    expect(imported.body.data.updated).toBe(2);
    await post(c, "/api/parts/" + a.body.data.id + "/stock", { type: "in", quantity: 1 });
    const reverted = await post(c, "/api/import/batches/" + imported.body.data.batchId + "/revert", {});
    expect(reverted.response.status).toBe(409);
    const remainingB = await get(c, "/api/parts/" + b.body.data.id);
    expect(remainingB.body.data.stockQuantity).toBe(20);
  });

  it("searches by current storage location name, even after a rename", async () => {
    const c = createTestClient();
    const created = await post(c, "/api/parts", {
      ...sample, modelNumber: "LOCATION-SEARCH", locationId: 1,
    });
    const updated = await c.request("/api/locations/1", {
      method: "PUT",
      body: JSON.stringify({ name: "Audit Warehouse West", code: "A-01" }),
    });
    expect(updated.response.status).toBe(200);
    const results = await get(c, "/api/parts?q=" + encodeURIComponent("Audit Warehouse West"));
    expect(results.body.data.some((p: { id: number }) => p.id === created.body.data.id)).toBe(true);
  });

  it("rejects irreversible deletion of a part linked to a project", async () => {
    const c = createTestClient();
    const part = await post(c, "/api/parts", { ...sample, modelNumber: "BOM-GUARD" });
    const project = await post(c, "/api/projects", {
      name: "Protected BOM",
      parts: [{ partId: part.body.data.id, quantityRequired: 2 }],
    });
    expect(project.response.status).toBe(201);
    const deleted = await c.request("/api/parts/" + part.body.data.id + "/permanent", { method: "DELETE" });
    expect(deleted.response.status).toBe(409);
    const stillThere = await get(c, "/api/projects/" + project.body.data.id);
    expect(stillThere.body.data.parts).toHaveLength(1);
  });

  it("clears a location via bulk update instead of making an empty location", async () => {
    const c = createTestClient();
    const part = await post(c, "/api/parts", {
      ...sample, modelNumber: "CLEAR-LOCATION", locationId: 1,
    });
    const updated = await post(c, "/api/parts/bulk/update", {
      ids: [part.body.data.id], data: { locationName: "" },
    });
    expect(updated.response.status).toBe(200);
    const current = await get(c, "/api/parts/" + part.body.data.id);
    expect(current.body.data.locationId).toBeNull();
    const locations = await get(c, "/api/locations");
    expect(locations.body.data.some((v: { name: string }) => v.name === "")).toBe(false);
  });

  it("does not create an import category when the same row fails attribute parsing", async () => {
    const c = createTestClient();
    const imported = await post(c, "/api/import/parts", {
      mode: "skip", rows: [{
        category: "AuditInvalidCategory", model_number: "P-1", name: "Broken",
        attributes_json: "{not-json",
      }],
    });
    expect(imported.response.status).toBe(200);
    expect(imported.body.data.failed).toBe(1);
    const categories = await get(c, "/api/categories");
    expect(categories.body.data.some((v: { name: string }) => v.name === "AuditInvalidCategory")).toBe(false);
  });

  it("chunks bulk operations so each D1 statement binds at most 100 values", async () => {
    const c = createTestClient();
    const original = c.db.prepare.bind(c.db);
    let maximum = 0;
    c.db.prepare = (sql: string) => {
      const stmt = original(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...args: unknown[]) => {
        maximum = Math.max(maximum, args.length);
        if (args.length > 100) throw new Error("D1_SQLITE_MAX_VARIABLE_NUMBER exceeded");
        return bind(...args);
      };
      return stmt;
    };
    const ids = Array.from({ length: 220 }, (_, i) => i + 1);
    const changed = await post(c, "/api/parts/bulk/update", {
      ids, data: { manufacturer: "Audit Co.", memo: "200+ parts" },
    });
    expect(changed.response.status).toBe(200);
    expect(maximum).toBeLessThanOrEqual(100);
  });

  it("does not serve SPA HTML to an unrecognized API endpoint when ASSETS exists", async () => {
    const c = createTestClient();
    const env = {
      DB: c.db as unknown as D1Database,
      BASIC_AUTH_USER: "inventory",
      BASIC_AUTH_PASSWORD: "inventory-pass",
      ASSETS: { fetch: async () => new Response("<html>SPA</html>", { status: 200 }) },
    };
    const response = await app.fetch(
      new Request("http://localhost/api/unknown", { headers: { authorization: authHeader() } }),
      env as Parameters<typeof app.fetch>[1],
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("records all stock before/after values in a consistent contiguous sequence", async () => {
    const c = createTestClient();
    const p = await post(c, "/api/parts", { ...sample, modelNumber: "STOCK-HISTORY-ORDER" });
    const id = p.body.data.id;
    const updates = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        post(c, "/api/parts/" + id + "/stock", { type: "in", quantity: 1, reason: String(i) }),
      ),
    );
    expect(updates.every(u => u.response.status === 200)).toBe(true);
    const history = await get(c, "/api/parts/" + id + "/movements");
    const sorted = [...history.body.data].sort((a: {id:number},b: {id:number})=>a.id-b.id);
    let quantity = 0;
    for (const entry of sorted) {
      expect(entry.quantityBefore).toBe(quantity);
      quantity = entry.quantityAfter;
    }
    expect(quantity).toBe(22);
  });
});
