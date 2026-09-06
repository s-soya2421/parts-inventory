import { describe, expect, it } from "vitest";
import { CsvExporter } from "../../src/worker/features/export/csv-exporter";
import type { ExportRow } from "../../src/worker/features/export/export-row-builder";
import { ExportRowBuilder } from "../../src/worker/features/export/export-row-builder";
import type { CategoryExportSchema } from "../../src/worker/features/export/export-schemas";
import type { PartSummary } from "../../src/shared/types";

const BOM = "﻿";

// Response.text() may strip a leading BOM when decoding, so read raw bytes
// and decode without BOM-stripping for the body assertions.
async function csvText(rowsByCategory: Record<string, ExportRow[]>): Promise<string> {
  const buffer = await new CsvExporter().export(rowsByCategory).arrayBuffer();
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer);
}

describe("CsvExporter", () => {
  it("prepends a BOM, uses CRLF line endings, and a trailing CRLF", async () => {
    const text = await csvText({ a: [{ name: "x" }] });
    expect(text.startsWith(BOM)).toBe(true);
    expect(text).toBe(`${BOM}name\r\nx\r\n`);
  });

  it("sets a UTF-8 CSV content type and attachment disposition", async () => {
    const response = new CsvExporter().export({ a: [{ name: "x" }] });
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("parts-export.csv");
  });

  it("quotes values containing comma, double-quote, or newline and doubles inner quotes", async () => {
    const text = await csvText({
      a: [{ comma: "a,b", quote: 'he said "hi"', newline: "line1\nline2", crlf: "x\r\ny" }],
    });
    const [, dataLine] = text.replace(BOM, "").split("\r\n");
    // CRLF inside a quoted field is preserved, so split on the visible columns instead.
    expect(text).toContain('"a,b"');
    expect(text).toContain('"he said ""hi"""');
    expect(text).toContain('"line1\nline2"');
    expect(text).toContain('"x\r\ny"');
    expect(dataLine.startsWith('"a,b"')).toBe(true);
  });

  it("does not quote plain values", async () => {
    const text = await csvText({ a: [{ plain: "hello" }] });
    expect(text).toBe(`${BOM}plain\r\nhello\r\n`);
  });

  it("neutralizes spreadsheet formula prefixes", async () => {
    const text = await csvText({ a: [{ formula: "=HYPERLINK(\"https://example.com\")", plus: "+1", minus: "-1", at: "@name" }] });
    const lines = text.replace(BOM, "").trimEnd().split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""https://example.com"")",'+1,'-1,'@name`);
  });

  it("unions columns across rows and fills missing cells with empty strings", async () => {
    const text = await csvText({
      cat1: [{ a: "1", b: "2" }],
      cat2: [{ b: "3", c: "4" }],
    });
    const lines = text.replace(BOM, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("a,b,c"); // first-seen order, union of all keys
    expect(lines[1]).toBe("1,2,"); // row 1 has no c
    expect(lines[2]).toBe(",3,4"); // row 2 has no a
  });

  it("renders null and numeric cells correctly", async () => {
    const text = await csvText({ a: [{ price: 320, empty: null }] });
    const lines = text.replace(BOM, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("price,empty");
    expect(lines[1]).toBe("320,");
  });
});

function makePart(overrides: Partial<PartSummary> = {}): PartSummary {
  return {
    id: 1,
    categoryId: 1,
    categoryName: "抵抗",
    categorySlug: "resistor",
    modelNumber: "R-001",
    name: "10kΩ",
    description: null,
    manufacturer: "Yageo",
    footprint: "0603",
    stockQuantity: 25,
    price: 320,
    locationId: 10,
    locationName: "棚A",
    locationCode: "shelf-a",
    caseNumber: "A-01",
    purchaseUrl: null,
    datasheetUrl: null,
    memo: null,
    lowStockThreshold: 3,
    searchText: "",
    archivedAt: null,
    statusId: null,
    status: null,
    createdAt: "2026-05-28T00:00:00Z",
    updatedAt: "2026-05-28T00:00:00Z",
    attributes: [],
    attributeValues: [],
    tags: [],
    ...overrides,
  } as PartSummary;
}

describe("ExportRowBuilder", () => {
  const builder = new ExportRowBuilder();

  it("renders part-sourced columns and stringifies missing fields as empty", () => {
    const schema: CategoryExportSchema = {
      categorySlug: "resistor",
      sheetName: "抵抗",
      columns: [
        { key: "modelNumber", header: "型番", source: "part" },
        { key: "memo", header: "メモ", source: "part" },
      ],
    };

    const row = builder.build(makePart({ memo: null }), schema);
    expect(row).toEqual({ 型番: "R-001", メモ: "" });
  });

  it("joins value and unit for attribute columns and blanks missing attributes", () => {
    const schema: CategoryExportSchema = {
      categorySlug: "resistor",
      sheetName: "抵抗",
      columns: [
        { key: "resistance", header: "抵抗値", source: "attribute" },
        { key: "tolerance", header: "許容差", source: "attribute" },
      ],
    };
    const part = makePart({
      attributes: [
        { id: 1, partId: 1, key: "resistance", label: "抵抗値", value: "10", unit: "kΩ", normalizedValue: "10" },
      ],
    });

    const row = builder.build(part, schema);
    expect(row).toEqual({ 抵抗値: "10 kΩ", 許容差: "" });
  });

  it("joins tag names with comma-space for the tags computed column", () => {
    const schema: CategoryExportSchema = {
      categorySlug: "resistor",
      sheetName: "抵抗",
      columns: [{ key: "tags", header: "タグ", source: "computed" }],
    };
    const part = makePart({
      tags: [
        { id: 1, name: "smd", slug: "smd", createdAt: "", updatedAt: "" },
        { id: 2, name: "0603", slug: "0603", createdAt: "", updatedAt: "" },
      ],
    });

    expect(builder.build(part, schema)).toEqual({ タグ: "smd, 0603" });
  });

  it("combines locationName and caseNumber for the location computed column", () => {
    const schema: CategoryExportSchema = {
      categorySlug: "resistor",
      sheetName: "抵抗",
      columns: [{ key: "location", header: "保管場所", source: "computed" }],
    };

    expect(builder.build(makePart(), schema)).toEqual({ 保管場所: "棚A / A-01" });
    expect(builder.build(makePart({ locationName: null }), schema)).toEqual({ 保管場所: "A-01" });
  });

  it("summarizes up to 6 attributes for the primaryAttributes computed column", () => {
    const schema: CategoryExportSchema = {
      categorySlug: "default",
      sheetName: "Parts",
      columns: [{ key: "primaryAttributes", header: "主要特性", source: "computed" }],
    };
    const attributes = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      partId: 1,
      key: `k${i}`,
      label: i === 0 ? null : `L${i}`,
      value: `v${i}`,
      unit: i === 0 ? "U" : null,
      normalizedValue: null,
    }));

    const row = builder.build(makePart({ attributes }), schema);
    const parts = String(row["主要特性"]).split(" / ");
    expect(parts).toHaveLength(6); // capped at 6
    expect(parts[0]).toBe("k0: v0U"); // label falls back to key, unit appended, null unit -> ""
    expect(parts[1]).toBe("L1: v1");
  });
});
