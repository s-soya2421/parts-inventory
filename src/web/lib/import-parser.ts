export type ImportPreviewRow = {
  category: string;
  model_number: string;
  name: string;
  stock_quantity: number;
  price?: number | null;
  case_number?: string | null;
  footprint?: string | null;
  manufacturer?: string | null;
  tags?: string;
  memo?: string | null;
  low_stock_threshold?: number;
  attributes_json?: string | Record<string, { value: string | number; unit?: string; label?: string }>;
};

export type ImportRow = ImportPreviewRow & Record<string, unknown>;

const headerAliases: Record<keyof ImportPreviewRow, string[]> = {
  category: ["category", "category_name", "categoryName", "カテゴリ"],
  model_number: ["model_number", "modelNumber", "型番"],
  name: ["name", "part_name", "部品名", "名称"],
  stock_quantity: ["stock_quantity", "stockQuantity", "stock", "在庫数"],
  price: ["price", "価格"],
  case_number: ["case_number", "caseNumber", "case", "ケース番号"],
  footprint: ["footprint", "フットプリント", "大きさ", "サイズ", "パッケージ"],
  manufacturer: ["manufacturer", "maker", "メーカー", "製造元"],
  tags: ["tags", "tag", "タグ"],
  memo: ["memo", "note", "notes", "メモ"],
  low_stock_threshold: ["low_stock_threshold", "lowStockThreshold", "低在庫しきい値"],
  attributes_json: ["attributes_json", "attributes", "属性JSON", "特性JSON"],
};

export function parseImportJson(text: string): ImportRow[] {
  const parsed = JSON.parse(text) as unknown;
  const rows = extractRows(parsed);
  if (!rows) throw new Error('JSONは配列、または raw エクスポートの {"parts": [...]} 形式で指定してください');
  return normalizeRows(rows);
}

// Accept a bare array, or the JSON export envelopes ({ parts: [...] } from raw / { rows: [...] }).
function extractRows(parsed: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === "object") {
    const envelope = parsed as Record<string, unknown>;
    if (Array.isArray(envelope.parts)) return envelope.parts as Record<string, unknown>[];
    if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
  }
  return null;
}

export const parseJsonRows = parseImportJson;

function normalizeRows(rows: Record<string, unknown>[]): ImportRow[] {
  return rows
    .map((row) => ({
      category: readString(row, "category"),
      model_number: readString(row, "model_number"),
      name: readString(row, "name"),
      stock_quantity: readNumber(row, "stock_quantity", 0),
      price: readOptionalNumber(row, "price"),
      case_number: readNullableString(row, "case_number"),
      footprint: readNullableString(row, "footprint"),
      manufacturer: readNullableString(row, "manufacturer"),
      tags: readTags(row),
      memo: readNullableString(row, "memo"),
      low_stock_threshold: readValue(row, "low_stock_threshold") === undefined ? undefined : readNumber(row, "low_stock_threshold", 0),
      attributes_json: readAttributes(row),
    }))
    .filter((row) => row.category && row.model_number && row.name);
}

function readString(row: Record<string, unknown>, key: keyof ImportPreviewRow): string {
  return String(readValue(row, key) ?? "").trim();
}

function readNullableString(row: Record<string, unknown>, key: keyof ImportPreviewRow): string | null | undefined {
  if (readValue(row, key) === undefined) return undefined;
  const value = readString(row, key);
  return value ? value : null;
}

function readNumber(row: Record<string, unknown>, key: keyof ImportPreviewRow, fallback: number): number {
  const value = readValue(row, key);
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readOptionalNumber(row: Record<string, unknown>, key: keyof ImportPreviewRow): number | null | undefined {
  const value = readValue(row, key);
  if (value === undefined) return undefined;
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// tags may be a comma-separated string, or the raw export's Tag[] (array of { name }).
function readTags(row: Record<string, unknown>): string | undefined {
  const value = readValue(row, "tags");
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((tag) =>
        typeof tag === "string"
          ? tag
          : tag && typeof tag === "object" && "name" in tag
            ? String((tag as { name: unknown }).name)
            : "",
      )
      .filter(Boolean)
      .join(",");
  }
  return readNullableString(row, "tags") ?? "";
}

function readAttributes(row: Record<string, unknown>): ImportPreviewRow["attributes_json"] {
  const value = readValue(row, "attributes_json");

  // raw export shape: attributes is an array of { key, value, unit, label }.
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((attr): attr is Record<string, unknown> => !!attr && typeof attr === "object" && "key" in attr)
        .map((attr) => [
          String(attr.key),
          {
            value: (attr.value as string | number | undefined) ?? "",
            ...(attr.unit ? { unit: String(attr.unit) } : {}),
            ...(attr.label ? { label: String(attr.label) } : {}),
          },
        ]),
    );
  }

  if (typeof value !== "string") return value as ImportPreviewRow["attributes_json"];
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed) as ImportPreviewRow["attributes_json"];
  } catch {
    return trimmed;
  }
}

function readValue(row: Record<string, unknown>, key: keyof ImportPreviewRow): unknown {
  const aliases = headerAliases[key];
  const entry = Object.entries(row).find(([header]) => aliases.includes(header.trim()));
  return entry?.[1];
}
