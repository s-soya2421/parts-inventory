import type { AttributeDefinition, Category, CategoryListHeader, Location, PartAttribute, PartAttributeValue, PartStatus, PartSummary, ProjectCost, ProjectPartLine, ProjectSummary, StockMovement, Tag } from "@shared/types";
import type {
  DbAttributeDefinitionRow,
  DbCategoryRow,
  DbCategoryListHeaderRow,
  DbLocationRow,
  DbPartAttributeRow,
  DbPartAttributeValueRow,
  DbPartRow,
  DbPartStatusRow,
  DbProjectCostRow,
  DbProjectPartRow,
  DbProjectRow,
  DbStockMovementRow,
  DbTagRow,
} from "./types";

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug) return slug;

  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `item-${hash.toString(36)}`;
}

export function toSearchText(input: {
  modelNumber: string;
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  footprint?: string | null;
  caseNumber?: string | null;
  locationName?: string | null;
  memo?: string | null;
  categoryName?: string;
  tagNames?: string[];
  attributes?: Array<{ key: string; label?: string | null; value: string; unit?: string | null }>;
}): string {
  return [
    input.modelNumber,
    input.name,
    input.description,
    input.manufacturer,
    input.footprint,
    input.caseNumber,
    input.locationName,
    input.memo,
    input.categoryName,
    ...(input.tagNames ?? []),
    ...(input.attributes ?? []).flatMap((attribute) => [
      attribute.key,
      attribute.label ?? "",
      attribute.value,
      attribute.unit ?? "",
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function mapCategory(row: DbCategoryRow): Category {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order ?? 0,
    partCount: row.part_count ?? 0,
    outOfStockCount: row.out_of_stock_count ?? 0,
    lowStockCount: row.low_stock_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTag(row: DbTagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPartStatus(row: DbPartStatusRow): PartStatus {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapLocation(row: DbLocationRow): Location {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAttribute(row: DbPartAttributeRow): PartAttribute {
  return {
    id: row.id,
    partId: row.part_id,
    key: row.key,
    label: row.label,
    value: row.value,
    unit: row.unit,
    normalizedValue: row.normalized_value,
  };
}

export function mapAttributeDefinition(row: DbAttributeDefinitionRow): AttributeDefinition {
  return {
    id: row.id,
    categoryId: row.category_id,
    key: row.key,
    label: row.label,
    dataType: row.data_type,
    unit: row.unit,
    groupName: row.group_name,
    isSearchable: Boolean(row.is_searchable),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPartAttributeValue(row: DbPartAttributeValueRow): PartAttributeValue {
  return {
    id: row.id,
    partId: row.part_id,
    attributeDefinitionId: row.attribute_definition_id,
    key: row.key,
    label: row.label,
    valueText: row.value_text,
    valueNumber: row.value_number,
    unit: row.unit,
    displayValue: row.display_value,
  };
}

export function mapCategoryListHeader(row: DbCategoryListHeaderRow): CategoryListHeader {
  const definition = row.attribute_definition_id && row.definition_key && row.definition_label && row.definition_data_type
    ? {
        id: row.attribute_definition_id,
        categoryId: row.category_id,
        key: row.definition_key,
        label: row.definition_label,
        dataType: row.definition_data_type,
        unit: row.definition_unit,
        groupName: row.definition_group_name,
        isSearchable: Boolean(row.definition_is_searchable),
        sortOrder: row.definition_sort_order ?? 0,
        createdAt: row.definition_created_at ?? row.created_at,
        updatedAt: row.definition_updated_at ?? row.updated_at,
      }
    : null;

  return {
    id: row.id,
    categoryId: row.category_id,
    attributeDefinitionId: row.attribute_definition_id,
    fieldKey: row.field_key as CategoryListHeader["fieldKey"],
    label: row.label,
    sortOrder: row.sort_order,
    isVisible: Boolean(row.is_visible),
    attributeDefinition: definition,
  };
}

export function mapMovement(row: DbStockMovementRow): StockMovement {
  return {
    id: row.id,
    partId: row.part_id,
    movementType: row.movement_type,
    quantityBefore: row.quantity_before,
    quantityDelta: row.quantity_delta,
    quantityAfter: row.quantity_after,
    type: row.movement_type,
    quantity: row.quantity_delta,
    beforeQuantity: row.quantity_before,
    afterQuantity: row.quantity_after,
    reason: row.reason,
    memo: row.memo,
    createdAt: row.created_at,
  };
}

export function mapPart(row: DbPartRow, attributes: PartAttribute[], tags: Tag[], attributeValues: PartAttributeValue[] = []): PartSummary {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    modelNumber: row.model_number,
    name: row.name,
    description: row.description,
    manufacturer: row.manufacturer,
    footprint: row.footprint,
    stockQuantity: row.stock_quantity,
    price: row.price,
    locationId: row.location_id,
    locationName: row.location_name,
    locationCode: row.location_code,
    caseNumber: row.case_number,
    purchaseUrl: row.purchase_url,
    datasheetUrl: row.datasheet_url,
    memo: row.memo,
    lowStockThreshold: row.low_stock_threshold,
    searchText: row.search_text,
    archivedAt: row.archived_at,
    statusId: row.status_id,
    status:
      row.status_id && row.status_name
        ? { id: row.status_id, name: row.status_name, slug: row.status_slug ?? "", color: row.status_color ?? "#64748b", sortOrder: 0, createdAt: row.created_at, updatedAt: row.updated_at }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attributes,
    attributeValues,
    tags,
  };
}

export function mapProjectSummary(row: DbProjectRow): ProjectSummary {
  const partsCost = row.parts_cost ?? 0;
  const costsTotal = row.costs_total ?? 0;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    referenceUrl: row.reference_url,
    partsCount: row.parts_count ?? 0,
    costsCount: row.costs_count ?? 0,
    total: partsCost + costsTotal,
    unpricedCount: row.unpriced_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapProjectPartLine(row: DbProjectPartRow): ProjectPartLine {
  const price = row.price;
  return {
    id: row.id,
    partId: row.part_id,
    quantityRequired: row.quantity_required,
    memo: row.memo,
    modelNumber: row.model_number,
    name: row.part_name,
    price: price,
    categoryName: row.category_name,
    lineTotal: row.quantity_required * (price ?? 0),
  };
}

export function mapProjectCost(row: DbProjectCostRow): ProjectCost {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    memo: row.memo,
    sortOrder: row.sort_order,
  };
}
