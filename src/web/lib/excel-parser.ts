import * as XLSX from "xlsx";
import type { ImportRow } from "./import-parser";

// このExcelは「1シート＝大カテゴリ」「シート内に複数の小テーブルが横並び」という不規則構造。
// ブロック(小テーブル)を自動検出し、ヘッダ→アプリ項目のマッピングは画面側で行う。

export type FieldTarget =
  | "ignore"
  | "model_number"
  | "identifier" // 複数列を結合して型番(識別子)にする（R/Cの 定数＋大きさ 等）
  | "name"
  | "stock_quantity"
  | "price"
  | "footprint"
  | "manufacturer"
  | "case_number"
  | "memo"
  | "low_stock_threshold"
  | "attribute"; // 属性(key=ヘッダ名)として保存

export const FIELD_TARGET_LABELS: Record<FieldTarget, string> = {
  ignore: "取り込まない",
  model_number: "型番",
  identifier: "型番に結合(識別子)",
  name: "名称",
  stock_quantity: "在庫数",
  price: "単価",
  footprint: "フットプリント/大きさ",
  manufacturer: "メーカー",
  case_number: "ケース番号",
  memo: "メモ",
  low_stock_threshold: "低在庫しきい値",
  attribute: "属性",
};

export type ExcelBlock = {
  id: string;
  sheetName: string; // = カテゴリ名
  blockTitle: string; // 小テーブルの見出し（実装形式など）
  status: string; // ステータス表記（使用OK / ディスコン 等）
  headers: string[];
  rows: string[][];
  signature: string; // マッピング保存・再利用のキー（シート名＋ヘッダ構成）
};

const META_SHEETS = new Set(["変更履歴", "記載規則"]);
// ブロック先頭(識別子)列に現れるヘッダ語
const IDENTITY_TOKENS = ["定数", "アイテム名", "型番", "品番", "品名"];

function cellStr(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function parseWorkbook(buffer: ArrayBuffer): ExcelBlock[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const blocks: ExcelBlock[] = [];

  for (const sheetName of wb.SheetNames) {
    if (META_SHEETS.has(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
    blocks.push(...parseSheet(sheetName, grid));
  }

  return blocks;
}

function parseSheet(sheetName: string, grid: unknown[][]): ExcelBlock[] {
  const headerRowIndex = grid.findIndex((row) => row.some((cell) => IDENTITY_TOKENS.includes(cellStr(cell))));
  if (headerRowIndex < 0) return [];

  const headerRow = grid[headerRowIndex].map(cellStr);
  const columnGroups = detectColumnGroups(headerRow);

  return columnGroups.map((group, index) => {
    const headers = headerRow.slice(group.start, group.end + 1);

    // ブロック見出し・ステータスはヘッダ行より上、同じ列範囲にある非空セルから拾う
    const above: string[] = [];
    for (let r = headerRowIndex - 1; r >= 0; r -= 1) {
      const slice = (grid[r] ?? []).slice(group.start, group.end + 1).map(cellStr).filter(Boolean);
      if (slice.length > 0) above.push(slice.join(" "));
    }
    const blockTitle = above[0] ?? sheetName;
    const status = above.slice(1).join(" / ");

    const rows: string[][] = [];
    for (let r = headerRowIndex + 1; r < grid.length; r += 1) {
      const cells = headers.map((_, i) => cellStr(grid[r]?.[group.start + i]));
      if (!cells[0]) continue; // 識別子列が空の行はスキップ
      // 縦に並ぶサブグループの「繰り返しヘッダ行」を除外
      if (IDENTITY_TOKENS.includes(cells[0]) || cells[0] === headers[0]) continue;
      // セクション見出し行（先頭列だけ埋まっていて他は空）を除外（列が3つ以上のブロックのみ）
      if (headers.length >= 3 && cells.slice(1).every((c) => c === "")) continue;
      rows.push(cells);
    }

    return {
      id: `${sheetName}#${index}`,
      sheetName,
      blockTitle,
      status,
      headers,
      rows,
      signature: `${sheetName}|${headers.join("")}`,
    } satisfies ExcelBlock;
  }).filter((block) => block.rows.length > 0);
}

// ヘッダ行を見て、連続した非空セル＝1ブロック、空セルが区切り
function detectColumnGroups(headerRow: string[]): { start: number; end: number }[] {
  const groups: { start: number; end: number }[] = [];
  let start = -1;
  for (let c = 0; c < headerRow.length; c += 1) {
    const filled = headerRow[c] !== "";
    if (filled && start < 0) start = c;
    if (!filled && start >= 0) {
      groups.push({ start, end: c - 1 });
      start = -1;
    }
  }
  if (start >= 0) groups.push({ start, end: headerRow.length - 1 });
  return groups;
}

// ヘッダ文字からマッピング先を推測
export function guessTarget(header: string, headers: string[]): FieldTarget {
  const h = header.replace(/\s+/g, "");
  const hasItemName = headers.some((x) => ["アイテム名", "型番", "品番", "品名"].includes(x.trim()));

  if (["アイテム名", "型番", "品番", "品名"].includes(h)) return "model_number";
  if (["名称", "部品名"].includes(h)) return "name";
  if (h === "定数") return hasItemName ? "attribute" : "identifier";
  if (h === "大きさ" || h === "サイズ") return hasItemName ? "footprint" : "identifier";
  if (["量", "量・特性", "在庫", "在庫数", "数", "数量"].includes(h)) return "stock_quantity";
  if (["価格", "単価", "金額"].includes(h)) return "price";
  if (["パッケージ", "フットプリント", "実装形式"].includes(h)) return "footprint";
  if (["備考", "メモ", "注記"].includes(h)) return "memo";
  if (["メーカー", "製造元", "ブランド"].includes(h)) return "manufacturer";
  return "attribute";
}

export type BlockMapping = Record<number, FieldTarget>;

export function defaultMapping(headers: string[]): BlockMapping {
  const mapping: BlockMapping = {};
  headers.forEach((header, i) => {
    mapping[i] = guessTarget(header, headers);
  });
  return mapping;
}

export type BuildOptions = {
  blockTitleAsTag: boolean;
  statusAsTag: boolean;
  lowStockThreshold: number;
};

function extractNumber(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function splitTags(value: string): string[] {
  return value
    .split(/[\s,、／/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// 1ブロック＋マッピング＋オプションから取り込み用の行を生成
export function buildRowsForBlock(block: ExcelBlock, mapping: BlockMapping, options: BuildOptions): ImportRow[] {
  const result: ImportRow[] = [];
  const mappedTargets = new Set(Object.values(mapping));

  for (const cells of block.rows) {
    const identifierParts: string[] = [];
    const attributes: Record<string, { value: string; label: string }> = {};
    let modelNumber = "";
    let name = "";
    let stockQuantity = 0;
    let stockRaw = "";
    let price: number | null = null;
    let footprint: string | null = null;
    let manufacturer: string | null = null;
    let caseNumber: string | null = null;
    let memo = "";
    let lowStockThreshold = options.lowStockThreshold;

    block.headers.forEach((header, i) => {
      const target = mapping[i] ?? "ignore";
      const value = cells[i] ?? "";
      if (!value || target === "ignore") return;

      switch (target) {
        case "model_number":
          modelNumber = value;
          break;
        case "identifier":
          identifierParts.push(value);
          attributes[header] = { value, label: header };
          break;
        case "name":
          name = value;
          break;
        case "stock_quantity": {
          stockRaw = value;
          const num = extractNumber(value);
          stockQuantity = num != null && num >= 0 ? Math.round(num) : 0;
          break;
        }
        case "price": {
          const num = extractNumber(value);
          if (num != null && num >= 0) price = num;
          break;
        }
        case "footprint":
          footprint = value;
          break;
        case "manufacturer":
          manufacturer = value;
          break;
        case "case_number":
          caseNumber = value;
          break;
        case "memo":
          memo = memo ? `${memo} / ${value}` : value;
          break;
        case "low_stock_threshold": {
          const num = extractNumber(value);
          if (num != null && num >= 0) lowStockThreshold = Math.round(num);
          break;
        }
        case "attribute":
          attributes[header] = { value, label: header };
          break;
      }
    });

    const finalModel = modelNumber || identifierParts.join(" ");
    if (!finalModel) continue;
    const finalName = name || finalModel;

    // 在庫列が数値でなかった場合は原文をメモに残す
    if (stockRaw && extractNumber(stockRaw) == null) {
      memo = memo ? `${memo} / 量:${stockRaw}` : `量:${stockRaw}`;
    }

    const tags: string[] = [];
    if (options.blockTitleAsTag && block.blockTitle && block.blockTitle !== block.sheetName) {
      tags.push(...splitTags(block.blockTitle));
    }
    if (options.statusAsTag && block.status) tags.push(...splitTags(block.status));

    result.push({
      category: block.sheetName,
      model_number: finalModel,
      name: finalName,
      stock_quantity: stockQuantity,
      price: mappedTargets.has("price") ? price : undefined,
      footprint: mappedTargets.has("footprint") ? footprint : undefined,
      manufacturer: mappedTargets.has("manufacturer") ? manufacturer : undefined,
      case_number: mappedTargets.has("case_number") ? caseNumber : undefined,
      memo: memo || (mappedTargets.has("memo") ? null : undefined),
      low_stock_threshold: lowStockThreshold,
      tags: tags.length > 0 ? [...new Set(tags)].join(",") : undefined,
      attributes_json: Object.keys(attributes).length > 0 ? attributes : undefined,
    });
  }

  return result;
}
