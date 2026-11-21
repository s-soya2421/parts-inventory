import { beforeEach, describe, expect, it } from "vitest";
import { createTestClient, type TestClient } from "./harness";

let client: TestClient;

beforeEach(() => {
  client = createTestClient();
});

async function createCategory(name = "Catalog category") {
  const { response, body } = await client.request("/api/categories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return body.data;
}

async function createPart(categoryId: number, overrides: Record<string, unknown> = {}) {
  const { response, body } = await client.request("/api/parts", {
    method: "POST",
    body: JSON.stringify({
      categoryId,
      modelNumber: "CAT-1",
      name: "Catalog part",
      stockQuantity: 3,
      ...overrides,
    }),
  });
  expect(response.status).toBe(201);
  return body.data;
}

describe("catalog data", () => {
  it("rebuilds part search text when a linked tag is renamed or deleted", async () => {
    const category = await createCategory();
    const tag = await client.request("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "Resistor" }),
    });
    expect(tag.response.status).toBe(201);
    const part = await createPart(category.id, { tagIds: [tag.body.data.id] });

    const beforeRename = await client.request("/api/parts?q=Resistor");
    expect(beforeRename.body.data.map((item: { id: number }) => item.id)).toContain(part.id);

    const renamed = await client.request(`/api/tags/${tag.body.data.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Capacitor" }),
    });
    expect(renamed.response.status).toBe(200);

    const detail = await client.request(`/api/parts/${part.id}`);
    expect(detail.body.data.searchText).not.toContain("resistor");
    expect(detail.body.data.searchText).toContain("capacitor");

    const oldSearch = await client.request("/api/parts?q=Resistor");
    const newSearch = await client.request("/api/parts?q=Capacitor");
    expect(oldSearch.body.data.map((item: { id: number }) => item.id)).not.toContain(part.id);
    expect(newSearch.body.data.map((item: { id: number }) => item.id)).toContain(part.id);

    const deleted = await client.request(`/api/tags/${tag.body.data.id}`, { method: "DELETE" });
    expect(deleted.response.status).toBe(200);

    const afterDelete = await client.request("/api/parts?q=Capacitor");
    expect(afterDelete.body.data.map((item: { id: number }) => item.id)).not.toContain(part.id);
  });

  it("prevents deletion of a location that is assigned to a part", async () => {
    const location = await client.request("/api/locations", {
      method: "POST",
      body: JSON.stringify({ name: "Test shelf A", code: "TEST-LOC-A" }),
    });
    const category = await createCategory();
    await createPart(category.id, { locationId: location.body.data.id });

    const { response, body } = await client.request(`/api/locations/${location.body.data.id}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("LOCATION_IN_USE");
  });
});

describe("reporting and exports", () => {
  it("returns filtered inventory totals and exports the matching parts", async () => {
    const category = await createCategory("Reporting category");
    const part = await createPart(category.id, {
      modelNumber: "REPORT-1",
      name: "Reporting part",
      stockQuantity: 4,
      price: 12.5,
      lowStockThreshold: 5,
    });

    const stats = await client.request(`/api/parts/stats?categoryId=${category.id}`);
    expect(stats.response.status).toBe(200);
    expect(stats.body.data).toMatchObject({ count: 1, totalStock: 4, valuedCount: 1, totalValue: 50 });

    const rawExport = await client.request(`/api/export/parts?categoryId=${category.id}&format=json&mode=raw`);
    expect(rawExport.response.status).toBe(200);
    expect(rawExport.body).toMatchObject({ format: "raw" });
    expect(rawExport.body.parts.map((item: { id: number }) => item.id)).toEqual([part.id]);

    const csvExport = await client.raw(`/api/export/parts?categoryId=${category.id}&format=csv`);
    expect(csvExport.headers.get("content-type")).toContain("text/csv");
    expect(await csvExport.text()).toContain("REPORT-1");
  });
});

describe("bulk part operations", () => {
  it("updates selected parts and archives only those parts", async () => {
    const category = await createCategory();
    const location = await client.request("/api/locations", {
      method: "POST",
      body: JSON.stringify({ name: "Test shelf B", code: "TEST-LOC-B" }),
    });
    const status = await client.request("/api/statuses", {
      method: "POST",
      body: JSON.stringify({ name: "Reserved", color: "#0369a1", sortOrder: 10 }),
    });
    const first = await createPart(category.id, { modelNumber: "BULK-1" });
    const second = await createPart(category.id, { modelNumber: "BULK-2" });
    await createPart(category.id, { modelNumber: "BULK-3" });

    const updated = await client.request("/api/parts/bulk/update", {
      method: "POST",
      body: JSON.stringify({
        ids: [first.id, second.id],
        data: {
          manufacturer: "Acme",
          locationId: location.body.data.id,
          statusId: status.body.data.id,
          lowStockThreshold: 5,
        },
      }),
    });
    expect(updated.response.status).toBe(200);

    const filtered = await client.request(`/api/parts?manufacturer=Acme&locationId=${location.body.data.id}&statusId=${status.body.data.id}`);
    expect(filtered.body.data.map((item: { id: number }) => item.id).sort()).toEqual([first.id, second.id].sort());

    const archived = await client.request("/api/parts/bulk/archive", {
      method: "POST",
      body: JSON.stringify({ ids: [first.id, second.id] }),
    });
    expect(archived.response.status).toBe(200);

    const active = await client.request("/api/parts?manufacturer=Acme");
    const archivedParts = await client.request("/api/parts?manufacturer=Acme&archived=archived");
    expect(active.body.data).toHaveLength(0);
    expect(archivedParts.body.data.map((item: { id: number }) => item.id).sort()).toEqual([first.id, second.id].sort());
  });
});
