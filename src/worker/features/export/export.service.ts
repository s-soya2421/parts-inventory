import type { PartSummary } from "@shared/types";
import type { PartListFilters, PartsRepository } from "../parts/parts.repository";
import { CsvExporter } from "./csv-exporter";
import { ExcelExporter } from "./excel-exporter";
import { getExportSchema } from "./export-schemas";
import { ExportRowBuilder, type ExportRow } from "./export-row-builder";
import { JsonExporter } from "./json-exporter";
import { PdfExporter } from "./pdf-exporter";

export type ExportFormat = "excel" | "pdf" | "json" | "csv";
export type JsonMode = "flat" | "raw";

export class ExportService {
  private readonly rowBuilder = new ExportRowBuilder();
  private readonly excelExporter = new ExcelExporter();
  private readonly csvExporter = new CsvExporter();
  private readonly pdfExporter = new PdfExporter();
  private readonly jsonExporter = new JsonExporter();

  constructor(private readonly partsRepository: PartsRepository) {}

  async exportParts(filters: PartListFilters, format: ExportFormat, jsonMode: JsonMode): Promise<Response> {
    const parts = await this.partsRepository.listAll(filters);

    if (format === "json" && jsonMode === "raw") return this.jsonExporter.exportRaw(parts);

    const rowsByCategory = this.buildRowsByCategory(parts);
    if (format === "pdf") return this.pdfExporter.export(rowsByCategory);
    if (format === "csv") return this.csvExporter.export(rowsByCategory);
    if (format === "json") return this.jsonExporter.exportFlat(rowsByCategory);
    return this.excelExporter.export(rowsByCategory);
  }

  private buildRowsByCategory(parts: PartSummary[]): Record<string, ExportRow[]> {
    return parts.reduce<Record<string, ExportRow[]>>((acc, part) => {
      const schema = getExportSchema(part.categorySlug, part.categoryName);
      acc[schema.sheetName] ??= [];
      acc[schema.sheetName].push(this.rowBuilder.build(part, schema));
      return acc;
    }, Object.create(null) as Record<string, ExportRow[]>);
  }
}
