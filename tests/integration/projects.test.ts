import { beforeEach, describe, expect, it } from "vitest";
import { createTestClient, type TestClient } from "./harness";

let client: TestClient;

describe("projects CRUD", () => {
  beforeEach(() => {
    client = createTestClient();
  });

  it("creates a project and calculates totals", async () => {
    const categoryId = await createCategory("ProjectCat");
    const partA = await createPart({
      categoryId,
      modelNumber: "P-A",
      name: "Part A",
      stockQuantity: 10,
      price: 100,
    });
    const partB = await createPart({
      categoryId,
      modelNumber: "P-B",
      name: "Part B",
      stockQuantity: 10,
      price: 50,
    });

    const { response, body } = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "P1",
        parts: [
          { partId: partA, quantityRequired: 2 },
          { partId: partB, quantityRequired: 3 },
        ],
        costs: [{ name: "加工代", amount: 500 }],
      }),
    });
    expect(response.status).toBe(201);
    const data = body.data;
    expect(data.totals.partsCost).toBe(350);
    expect(data.totals.costsTotal).toBe(500);
    expect(data.totals.total).toBe(850);
    expect(data.totals.unpricedCount).toBe(0);
    expect(data.partsCount).toBe(2);
    expect(data.costsCount).toBe(1);
    expect(data.total).toBe(850);

    const detail = await client.request(`/api/projects/${data.id}`);
    expect(detail.response.status).toBe(200);
    expect(detail.body.data.totals.partsCost).toBe(350);
    expect(detail.body.data.totals.costsTotal).toBe(500);
    expect(detail.body.data.totals.total).toBe(850);
    expect(detail.body.data.partsCount).toBe(2);
    expect(detail.body.data.costsCount).toBe(1);
    expect(detail.body.data.total).toBe(850);
  });

  it("counts parts without prices", async () => {
    const categoryId = await createCategory("UnpricedCat");
    const partId = await createPart({
      categoryId,
      modelNumber: "NULL-PRICE",
      name: "Unpriced Part",
      stockQuantity: 5,
    });

    const { body } = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "P2",
        parts: [{ partId, quantityRequired: 5 }],
      }),
    });
    expect(body.data.parts[0].lineTotal).toBe(0);
    expect(body.data.unpricedCount).toBe(1);
    expect(body.data.totals.partsCost).toBe(0);
  });

  it("deduplicates the same part", async () => {
    const categoryId = await createCategory("DedupeCat");
    const partId = await createPart({
      categoryId,
      modelNumber: "DEDUP-A",
      name: "Part A",
      stockQuantity: 10,
      price: 100,
    });

    const { body } = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "PDedupe",
        parts: [
          { partId, quantityRequired: 2 },
          { partId, quantityRequired: 3 },
        ],
      }),
    });
    expect(body.data.parts.length).toBe(1);
    expect(body.data.parts[0].quantityRequired).toBe(5);
    expect(body.data.partsCount).toBe(1);
  });

  it("returns 400 for a missing part", async () => {
    const { response, body } = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "PMissing",
        parts: [{ partId: 999999, quantityRequired: 1 }],
      }),
    });
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("PART_NOT_FOUND");
  });

  it("replaces parts and costs on update", async () => {
    const categoryId = await createCategory("UpdateCat");
    const partA = await createPart({
      categoryId,
      modelNumber: "UPD-A",
      name: "Part A",
      stockQuantity: 10,
      price: 100,
    });
    const partB = await createPart({
      categoryId,
      modelNumber: "UPD-B",
      name: "Part B",
      stockQuantity: 10,
      price: 50,
    });
    const created = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "PUpd",
        parts: [{ partId: partA, quantityRequired: 1 }],
        costs: [{ name: "x", amount: 100 }],
      }),
    });
    expect(created.body.data.total).toBe(200);

    const { response, body } = await client.request(
      `/api/projects/${created.body.data.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: "PUpd2",
          parts: [{ partId: partB, quantityRequired: 4 }],
          costs: [{ name: "y", amount: 50 }],
        }),
      },
    );
    expect(response.status).toBe(200);
    const data = body.data;
    expect(data.parts.length).toBe(1);
    expect(data.parts[0].partId).toBe(partB);
    expect(data.totals.partsCost).toBe(200);
    expect(data.totals.costsTotal).toBe(50);
    expect(data.total).toBe(250);

    const detail = await client.request(
      `/api/projects/${created.body.data.id}`,
    );
    expect(detail.body.data.total).toBe(250);
  });

  it("lists projects with totals", async () => {
    const categoryId = await createCategory("ListCat");
    const partId = await createPart({
      categoryId,
      modelNumber: "LIST-A",
      name: "Part A",
      stockQuantity: 10,
      price: 100,
    });
    const created = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "PList",
        parts: [{ partId, quantityRequired: 1 }],
      }),
    });

    const { response, body } = await client.request("/api/projects");
    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(
      body.data.some(
        (project: { id: number }) => project.id === created.body.data.id,
      ),
    ).toBe(true);
    const item = body.data.find(
      (project: { id: number }) => project.id === created.body.data.id,
    );
    expect(typeof item.total).toBe("number");
  });

  it("links a part from the part detail workflow and filters related projects", async () => {
    const categoryId = await createCategory("RelatedProjectCat");
    const partId = await createPart({
      categoryId,
      modelNumber: "RELATED-A",
      name: "Related Part",
      stockQuantity: 10,
      price: 25,
    });
    const created = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Related Project" }),
    });
    const projectId = created.body.data.id;

    const linked = await client.request(`/api/projects/${projectId}/parts`, {
      method: "POST",
      body: JSON.stringify({ partId, quantityRequired: 4, memo: "main board" }),
    });
    expect(linked.response.status).toBe(200);
    expect(linked.body.data.parts[0].partId).toBe(partId);
    expect(linked.body.data.parts[0].quantityRequired).toBe(4);
    expect(linked.body.data.totals.partsCost).toBe(100);

    const related = await client.request(`/api/projects?partId=${partId}`);
    expect(related.response.status).toBe(200);
    expect(related.body.data.map((project: { id: number }) => project.id)).toContain(projectId);
  });

  it("returns 404 for a missing project", async () => {
    const get = await client.request("/api/projects/999999");
    expect(get.response.status).toBe(404);

    const update = await client.request("/api/projects/999999", {
      method: "PUT",
      body: JSON.stringify({ name: "x" }),
    });
    expect(update.response.status).toBe(404);
    expect(update.body.error.code).toBe("PROJECT_NOT_FOUND");

    const deleted = await client.request("/api/projects/999999", {
      method: "DELETE",
    });
    expect(deleted.response.status).toBe(404);
    expect(deleted.body.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("deletes a project and cascades related rows", async () => {
    const categoryId = await createCategory("DeleteCat");
    const partId = await createPart({
      categoryId,
      modelNumber: "DEL-A",
      name: "Part A",
      stockQuantity: 10,
      price: 100,
    });
    const created = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "PDel",
        parts: [{ partId, quantityRequired: 2 }],
        costs: [{ name: "c", amount: 10 }],
      }),
    });
    const id = created.body.data.id;

    const deleted = await client.request(`/api/projects/${id}`, {
      method: "DELETE",
    });
    expect(deleted.response.status).toBe(200);
    const detail = await client.request(`/api/projects/${id}`);
    expect(detail.response.status).toBe(404);

    const pp = (await client.db
      .prepare("SELECT COUNT(*) AS n FROM project_parts WHERE project_id = ?")
      .bind(id)
      .first<{ n: number }>())!;
    const pc = (await client.db
      .prepare("SELECT COUNT(*) AS n FROM project_costs WHERE project_id = ?")
      .bind(id)
      .first<{ n: number }>())!;
    expect(pp.n).toBe(0);
    expect(pc.n).toBe(0);
  });

  it("returns 400 on validation failure", async () => {
    const { response, body } = await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

async function createCategory(name: string): Promise<number> {
  const { body } = await client.request("/api/categories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return body.data.id;
}

async function createPart({
  categoryId,
  modelNumber,
  name,
  stockQuantity,
  price,
}: {
  categoryId: number;
  modelNumber: string;
  name: string;
  stockQuantity: number;
  price?: number;
}): Promise<number> {
  const input = {
    categoryId,
    modelNumber,
    name,
    stockQuantity,
    ...(price === undefined ? {} : { price }),
  };
  const { body } = await client.request("/api/parts", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.data.id;
}
