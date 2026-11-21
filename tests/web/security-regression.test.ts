import { describe, expect, it } from "vitest";
import { CsvExporter } from "../../src/worker/features/export/csv-exporter";
import { partWriteSchema, stockChangeSchema } from "../../src/worker/features/parts/parts.schemas";
import { projectWriteSchema } from "../../src/worker/features/projects/projects.schemas";
import { importPartsSchema } from "../../src/worker/features/import/import.schemas";
import { readFileSync } from "node:fs";

async function csv(rows: Record<string, string | number | null>[]) {
  const b = await new CsvExporter().export({ category: rows }).arrayBuffer();
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);
}

describe("CSV formula injection regression", () => {
  const malicious = [
    "=1+1", "+SUM(1,2)", "-SUM(1,2)", "@SUM(A1:A2)",
    "\t=1+1", "\r=1+1", "\n=1+1", " =1+1",
    "  @SUM(1)", "\uFEFF=1+1", "\t -CMD", "\r\n+SUM(1,2)",
  ];
  it.each(malicious)("neutralizes untrusted cell %j", async value => {
    const text = await csv([{ value }]);
    expect(text).toContain("'" + value);
  });
  it.each(["hello", "100", "C3", "user@example.com", "foo=bar", "2026-11-21"])(
    "preserves harmless cell %j", async value => {
      expect(await csv([{ value }])).toContain("\r\n" + value + "\r\n");
    },
  );
  it("preserves genuine negative numeric values", async () => {
    expect(await csv([{ value: -42 }])).toContain("\r\n-42\r\n");
  });
  it("neutralizes attacker-controlled column headers too", async () => {
    expect(await csv([{ "=1+1": "value" }])).toContain("\uFEFF'=1+1\r\n");
  });
  it("keeps BOM and CRLF when escaping", async () => {
    const text = await csv([{ value: "=2+2" }]);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
  });
});

const part = { categoryId: 1, modelNumber: "R-001", name: "Resistor", stockQuantity: 10 };
const project = { name: "Project" };
const row = { category: "Resistors", model_number: "R-001", name: "Resistor", stock_quantity: 5 };
describe("schema boundary regression corpus", () => {
  it.each([
    ["categoryId", -1], ["categoryId", 0], ["categoryId", 1.5],
    ["modelNumber", ""], ["modelNumber", " "],
    ["name", ""], ["name", " "],
    ["stockQuantity", -1], ["stockQuantity", 1.25], ["price", -0.01],
    ["lowStockThreshold", -1], ["lowStockThreshold", 3.2],
    ["locationId", -1], ["statusId", 0],
    ["attributes", [{ key: "", value: "x" }]],
    ["attributes", [{ key: "k", value: "" }]],
    ["tagIds", [-1]], ["tagNames", [""]], ["alternatives", [""]],
  ] as const)("rejects invalid part %s=%j", (field, value) => {
    expect(partWriteSchema.safeParse({ ...part, [field]: value }).success).toBe(false);
  });
  it.each([
    ["categoryId", "2", 2], ["stockQuantity", "7", 7],
    ["price", "0.5", 0.5], ["lowStockThreshold", "3", 3],
  ] as const)("coerces numeric %s", (field, value, expected) => {
    const parsed = partWriteSchema.parse({ ...part, [field]: value });
    expect((parsed as Record<string, unknown>)[field]).toBe(expected);
  });
  it.each([
    ["in", 0], ["out", -1], ["use", 0], ["dispose", -3],
    ["set", -1], ["adjustment", 0], ["change", 1], ["in", 0.1],
  ] as const)("rejects invalid stock %s(%s)", (type, quantity) => {
    expect(stockChangeSchema.safeParse({ type, quantity }).success).toBe(false);
  });
  it.each([
    ["name", ""], ["name", " "],
    ["parts", [{ partId: 0, quantityRequired: 1 }]],
    ["parts", [{ partId: 1, quantityRequired: 0 }]],
    ["parts", [{ partId: 1, quantityRequired: -1 }]],
    ["costs", [{ name: "Labor", amount: -1 }]],
    ["costs", [{ name: "", amount: 10 }]],
  ] as const)("rejects invalid project %s", (field, value) => {
    expect(projectWriteSchema.safeParse({ ...project, [field]: value }).success).toBe(false);
  });
  it.each([
    ["category", ""], ["model_number", ""], ["name", ""],
    ["stock_quantity", -1], ["stock_quantity", 0.5],
    ["price", -1], ["low_stock_threshold", -1],
  ] as const)("rejects invalid import %s", (field, value) => {
    expect(importPartsSchema.safeParse({ rows: [{ ...row, [field]: value }] }).success).toBe(false);
  });
  it("rejects zero rows and 1001 rows but accepts 1000", () => {
    expect(importPartsSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(importPartsSchema.safeParse({ rows: Array.from({ length: 1001 }, () => row) }).success).toBe(false);
    expect(importPartsSchema.safeParse({ rows: Array.from({ length: 1000 }, () => row) }).success).toBe(true);
  });
});

describe("Cloudflare deployment security invariants", () => {
  const config = readFileSync("wrangler.toml", "utf8");
  const assets = config.match(/\[assets\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  it("runs Worker auth before static assets", () => {
    expect(assets).toMatch(/^\s*run_worker_first\s*=\s*true\s*$/m);
  });
  it("does not enable asset-level SPA fallback that can override Basic Auth 401 responses", () => {
    expect(assets).not.toContain('not_found_handling = "single-page-application"');
  });
  it("binds D1 to Worker rather than frontend", () => {
    expect(config).toContain('binding = "DB"');
  });
});
