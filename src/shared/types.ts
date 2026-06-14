export type Category = {
  id: number;
  parentId?: number | null;
  name: string;
  slug: string;
  description?: string | null;
  sortOrder: number;
  partCount?: number;
  outOfStockCount?: number;
  lowStockCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type Tag = {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export type PartStatus = {
  id: number;
  name: string;
  slug: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PartAttribute = {
  id?: number;
  partId?: number;
  key: string;
  label?: string | null;
  value: string;
  unit?: string | null;
  normalizedValue?: string | null;
};

export type AttributeDefinition = {
  id: number;
  categoryId: number;
  key: string;
  label: string;
  dataType: "text" | "number" | "boolean" | "date";
  unit?: string | null;
  groupName?: string | null;
  isSearchable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PartAttributeValue = {
  id: number;
  partId: number;
  attributeDefinitionId: number;
  key: string;
  label: string;
  valueText?: string | null;
  valueNumber?: number | null;
  unit?: string | null;
  displayValue?: string | null;
};

export type CategoryListHeader = {
  id?: number;
  categoryId: number;
  attributeDefinitionId?: number | null;
  fieldKey?: "modelNumber" | "name" | "description" | "manufacturer" | "categoryName" | "status" | "location" | "stockQuantity" | "archived" | "actions" | null;
  label: string;
  sortOrder: number;
  isVisible: boolean;
  attributeDefinition?: AttributeDefinition | null;
};

export type StockMovement = {
  id: number;
  partId: number;
  movementType: "initial" | "in" | "out" | "adjustment" | "use" | "dispose" | "set";
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  type?: "initial" | "in" | "out" | "adjustment" | "use" | "dispose" | "set";
  quantity?: number;
  beforeQuantity?: number;
  afterQuantity?: number;
  reason?: string | null;
  memo?: string | null;
  createdAt: string;
};

export type PartSummary = {
  id: number;
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  modelNumber: string;
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  footprint?: string | null;
  stockQuantity: number;
  price?: number | null;
  locationId?: number | null;
  locationName?: string | null;
  locationCode?: string | null;
  caseNumber?: string | null;
  purchaseUrl?: string | null;
  datasheetUrl?: string | null;
  memo?: string | null;
  lowStockThreshold: number;
  searchText: string;
  archivedAt?: string | null;
  statusId?: number | null;
  status?: PartStatus | null;
  createdAt: string;
  updatedAt: string;
  attributes: PartAttribute[];
  attributeValues?: PartAttributeValue[];
  tags: Tag[];
};

export type PartAlternative = { text: string; linkedPartId?: number | null };

export type PartDetail = PartSummary & {
  movements: StockMovement[];
  alternatives: PartAlternative[];
};

export type PartWriteInput = {
  categoryId: number;
  modelNumber: string;
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  footprint?: string | null;
  stockQuantity: number;
  price?: number | null;
  locationId?: number | null;
  locationName?: string | null;
  caseNumber?: string | null;
  purchaseUrl?: string | null;
  datasheetUrl?: string | null;
  memo?: string | null;
  lowStockThreshold?: number;
  statusId?: number | null;
  attributes?: PartAttribute[];
  tagIds?: number[];
  tagNames?: string[];
  alternatives?: string[];
};

export type PartFilters = {
  keyword?: string;
  categoryId?: number;
  categorySlug?: string;
  tagIds?: number[];
  statusId?: number;
  caseNumber?: string;
  manufacturer?: string;
  footprint?: string;
  locationId?: number;
  archived?: "active" | "archived" | "all";
  stockStatus?: "all" | "in_stock" | "out_of_stock" | "low_stock";
  sort?: string;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

// 統計・分析（ベータ）。現在のフィルタ条件全体に対するサーバ側集計。
export type PartsAnalytics = {
  totals: { totalValue: number; totalStock: number; count: number; valuedCount: number };
  byCategory: { name: string; count: number; stock: number; value: number }[];
  byStatus: { id: number | null; name: string; color: string; count: number; stock: number; value: number }[];
  byManufacturer: { name: string; count: number }[];
  byLocation: { name: string; count: number }[];
  topValueParts: { id: number; modelNumber: string; price: number; stock: number; value: number }[];
  stockHealth: { healthy: number; low: number; out: number };
  monthlyAdditions: { month: string; count: number }[];
  yearlyAdditions: { year: string; count: number }[];
};

export type Location = {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectPartLine = {
  id: number;
  partId: number;
  quantityRequired: number;
  memo?: string | null;
  modelNumber: string;
  name: string;
  price?: number | null;
  categoryName?: string | null;
  lineTotal: number;
};

export type ProjectCost = {
  id: number;
  name: string;
  amount: number;
  memo?: string | null;
  sortOrder: number;
};

export type ProjectTotals = {
  partsCost: number;
  costsTotal: number;
  total: number;
  unpricedCount: number;
};

export type ProjectSummary = {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  referenceUrl?: string | null;
  partsCount: number;
  costsCount: number;
  total: number;
  unpricedCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = ProjectSummary & {
  parts: ProjectPartLine[];
  costs: ProjectCost[];
  totals: ProjectTotals;
};

export type ProjectPartInput = {
  partId: number;
  quantityRequired: number;
  memo?: string | null;
};

export type ProjectCostInput = {
  name: string;
  amount: number;
  memo?: string | null;
};

export type ProjectWriteInput = {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  referenceUrl?: string | null;
  parts?: ProjectPartInput[];
  costs?: ProjectCostInput[];
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    issues?: unknown;
  };
};
