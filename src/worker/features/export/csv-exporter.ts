import type { ExportRow } from "./export-row-builder";

const BOM = "﻿";

export class CsvExporter {
  export(rowsByCategory: Record<string, ExportRow[]>): Response {
    // 各カテゴリのスキーマには既に「カテゴリ」列(categoryName)が含まれるため、
    // ここではカテゴリ列を付け足さず、全行のヘッダのunionをそのまま出力する。
    const rows = Object.values(rowsByCategory).flat();
    const columns = this.collectColumns(rows);

    const lines = [this.toCsvLine(columns)];
    for (const row of rows) {
      lines.push(this.toCsvLine(columns.map((column) => row[column] ?? "")));
    }

    const body = BOM + lines.join("\r\n") + "\r\n";

    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="parts-export.csv"',
      },
    });
  }

  private collectColumns(rows: ExportRow[]): string[] {
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
    return columns;
  }

  private toCsvLine(values: Array<string | number | null>): string {
    return values.map((value) => this.escapeCell(value)).join(",");
  }

  private escapeCell(value: string | number | null): string {
    const raw = value == null ? "" : String(value);
    // Quoting alone does not stop spreadsheet programs evaluating formulas.
    // Keep genuine numeric cells numeric, but neutralize untrusted text/headers.
    // eslint-disable-next-line no-control-regex -- spreadsheet importers may ignore leading control characters
    const text = typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/u.test(raw) ? `'${raw}` : raw;
    if (/["\n\r,]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }
}
