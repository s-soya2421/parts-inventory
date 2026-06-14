export type Env = {
  Bindings: {
    DB: D1Database;
    BASIC_AUTH_USER?: string;
    BASIC_AUTH_PASSWORD?: string;
    ASSETS?: Fetcher;
  };
};

export type DbCategoryRow = {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  part_count?: number;
  out_of_stock_count?: number;
  low_stock_count?: number;
  created_at: string;
  updated_at: string;
};

export type DbTagRow = DbCategoryRow;

export type DbPartStatusRow = {
  id: number;
  name: string;
  slug: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DbLocationRow = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type DbPartRow = {
  id: number;
  category_id: number;
  category_name: string;
  category_slug: string;
  model_number: string;
  name: string;
  description: string | null;
  manufacturer: string | null;
  footprint: string | null;
  stock_quantity: number;
  price: number | null;
  location_id: number | null;
  location_name: string | null;
  location_code: string | null;
  case_number: string | null;
  purchase_url: string | null;
  datasheet_url: string | null;
  memo: string | null;
  low_stock_threshold: number;
  search_text: string;
  archived_at: string | null;
  status_id: number | null;
  status_name: string | null;
  status_slug: string | null;
  status_color: string | null;
  created_at: string;
  updated_at: string;
};

export type DbPartAttributeRow = {
  id: number;
  part_id: number;
  key: string;
  label: string | null;
  value: string;
  unit: string | null;
  normalized_value: string | null;
  created_at: string;
  updated_at: string;
};

export type DbAttributeDefinitionRow = {
  id: number;
  category_id: number;
  key: string;
  label: string;
  data_type: "text" | "number" | "boolean" | "date";
  unit: string | null;
  group_name: string | null;
  is_searchable: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DbPartAttributeValueRow = {
  id: number;
  part_id: number;
  attribute_definition_id: number;
  key: string;
  label: string;
  value_text: string | null;
  value_number: number | null;
  unit: string | null;
  display_value: string | null;
};

export type DbCategoryListHeaderRow = {
  id: number;
  category_id: number;
  attribute_definition_id: number | null;
  field_key: string | null;
  label: string;
  sort_order: number;
  is_visible: number;
  created_at: string;
  updated_at: string;
  definition_key: string | null;
  definition_label: string | null;
  definition_data_type: "text" | "number" | "boolean" | "date" | null;
  definition_unit: string | null;
  definition_group_name: string | null;
  definition_is_searchable: number | null;
  definition_sort_order: number | null;
  definition_created_at: string | null;
  definition_updated_at: string | null;
};

export type DbPartAlternativeRow = {
  id: number;
  part_id: number;
  text: string;
  sort_order: number;
  created_at: string;
};

export type DbStockMovementRow = {
  id: number;
  part_id: number;
  movement_type: "initial" | "in" | "out" | "set" | "adjustment" | "use" | "dispose";
  quantity_before: number;
  quantity_delta: number;
  quantity_after: number;
  reason: string | null;
  memo: string | null;
  created_at: string;
};

export type DbProjectRow = {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  reference_url: string | null;
  created_at: string;
  updated_at: string;
  parts_count?: number;
  costs_count?: number;
  parts_cost?: number;
  costs_total?: number;
  unpriced_count?: number;
};

export type DbProjectPartRow = {
  id: number;
  project_id: number;
  part_id: number;
  quantity_required: number;
  memo: string | null;
  model_number: string;
  part_name: string;
  price: number | null;
  category_name: string | null;
};

export type DbProjectCostRow = {
  id: number;
  project_id: number;
  name: string;
  amount: number;
  memo: string | null;
  sort_order: number;
};
