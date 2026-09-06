import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Category, CategoryListHeader, PartStatus, PartSummary, Tag } from "@shared/types";
import { PartsSearchInput } from "../components/parts/PartsSearchInput";
import { Skeleton } from "../components/ui/Skeleton";
import { apiClient, type BulkUpdatePartsInput } from "../lib/api-client";
import { getColumnOrderScope, getStoredColumnOrder, getStoredHiddenColumns, hasStoredHiddenColumns, removeStoredColumnOrder, setStoredColumnOrder, setStoredHiddenColumns } from "../lib/column-order-storage";
import { formatDate, formatPrice } from "../lib/format";
import { clearSearchParamValues, toggleSearchParamValue } from "../lib/url-filters";

type SortDirection = "asc" | "desc";
type SortType = "string" | "number" | "date";
type ColumnKey = string;
type SpecFilterOperator = "eq" | "contains" | "gte" | "gt" | "lte" | "lt";
type SpecFilterValue = string | number | { op: SpecFilterOperator; val: string | number };
type SortState = {
  key: ColumnKey | null;
  direction: SortDirection | null;
};
// サーバー側で全体ソートをサポートする列。これ以外（attr_xxx 等）のみクライアント側で補助ソートする。
const SERVER_SORT_KEYS = new Set([
  "modelNumber",
  "manufacturer",
  "categoryName",
  "status",
  "stockQuantity",
  "location",
  "price",
  "footprint",
  "lowStockThreshold",
  "createdAt",
  "updatedAt",
]);
type ColumnDefinition = {
  key: ColumnKey;
  label: string;
  description?: string;
  sortable: boolean;
  type: SortType;
  width: string;
  visibleOnMobile: boolean;
  render: (part: PartSummary) => ReactNode;
  sortValue: (part: PartSummary) => string | number | null | undefined;
};

// 既定で非表示にする任意列。領域を取らないよう初期は隠し、「列を追加」から出す。
const DEFAULT_HIDDEN_COLUMNS: ColumnKey[] = [
  "footprint",
  "lowStockThreshold",
  "purchaseUrl",
  "datasheetUrl",
  "memo",
  "tags",
  "createdAt",
  "updatedAt",
];

const numberSpecFilterOperators: SpecFilterOperator[] = ["eq", "gte", "gt", "lte", "lt"];
const textSpecFilterOperators: SpecFilterOperator[] = ["eq", "contains", "gte", "gt", "lte", "lt"];

const tabs: { label: string; archived?: string; stockStatus?: string; q?: string }[] = [
  { label: "パーツ", archived: "active" },
  { label: "在庫あり", stockStatus: "in_stock" },
  { label: "アーカイブ済み", archived: "archived" },
];

function stockBadge(part: PartSummary) {
  return <span>{part.stockQuantity}</span>;
}

function statusBadge(status: PartStatus | null | undefined) {
  if (!status) return <span className="text-slate-400">未設定</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
      <span className="truncate">{status.name}</span>
    </span>
  );
}

// ソート用：数値として解釈できれば数値を返す。空・非数値は null。
function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function isLowStock(part: PartSummary) {
  return part.lowStockThreshold > 0 && part.stockQuantity <= part.lowStockThreshold;
}

function storageLocation(part: PartSummary) {
  return [part.locationName, part.caseNumber].filter(Boolean).join(" / ") || "-";
}

// Keep column-key lists unique so duplicate keys can never render twice (the
// "duplicated columns" bug) or get persisted to localStorage.
function dedupeKeys<T extends string>(keys: T[]): T[] {
  const seen = new Set<T>();
  return keys.filter((key) => (seen.has(key) ? false : (seen.add(key), true)));
}

function parseSpecFilters(raw: string | null): Record<string, SpecFilterValue> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, SpecFilterValue>;
  } catch {
    return {};
  }
}

function readSpecFilterValue(raw: SpecFilterValue | undefined): { op: SpecFilterOperator; val: string } {
  if (raw && typeof raw === "object" && "op" in raw) {
    return { op: raw.op, val: String(raw.val ?? "") };
  }
  return { op: "eq", val: String(raw ?? "") };
}

function BulkEditModal({
  selectedCount,
  categories,
  statuses,
  onClose,
  onSave,
}: {
  selectedCount: number;
  categories: Category[];
  statuses: PartStatus[];
  onClose: () => void;
  onSave: (data: BulkUpdatePartsInput) => void;
}) {
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [statusId, setStatusId] = useState<number | "" | "none">("");
  const [manufacturer, setManufacturer] = useState<string | undefined>(undefined);
  const [footprint, setFootprint] = useState<string | undefined>(undefined);
  const [locationName, setLocationName] = useState<string | undefined>(undefined);
  const [caseNumber, setCaseNumber] = useState<string | undefined>(undefined);
  const [lowStockThreshold, setLowStockThreshold] = useState<number | undefined>(undefined);

  function handleSave() {
    const data: BulkUpdatePartsInput = {};
    if (categoryId !== "") data.categoryId = categoryId;
    if (statusId === "none") data.statusId = null;
    else if (statusId !== "") data.statusId = statusId;
    if (manufacturer !== undefined) data.manufacturer = manufacturer;
    if (footprint !== undefined) data.footprint = footprint;
    if (locationName !== undefined) data.locationName = locationName;
    if (caseNumber !== undefined) data.caseNumber = caseNumber;
    if (lowStockThreshold !== undefined) data.lowStockThreshold = lowStockThreshold;

    if (Object.keys(data).length === 0) {
      alert("変更内容を入力してください。");
      return;
    }
    onSave(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 p-4">
          <h3 className="text-lg font-bold text-slate-900">{selectedCount} 件の部品を一括編集</h3>
          <p className="mt-1 text-xs text-slate-500">入力した項目のみが更新されます。空欄の項目は変更されません。</p>
        </div>
        <div className="grid gap-4 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-slate-700">カテゴリ</span>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">変更なし</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-slate-700">ステータス</span>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value === "none" ? "none" : e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">変更なし</option>
              <option value="none">未設定に変更</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-slate-700">メーカー</span>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="変更なし"
                value={manufacturer ?? ""}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-slate-700">フットプリント</span>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="変更なし"
                value={footprint ?? ""}
                onChange={(e) => setFootprint(e.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-slate-700">保管場所</span>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="変更なし"
                value={locationName ?? ""}
                onChange={(e) => setLocationName(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-slate-700">ケース番号</span>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="変更なし"
                value={caseNumber ?? ""}
                onChange={(e) => setCaseNumber(e.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-slate-700">低在庫しきい値</span>
            <input
              type="number"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="変更なし"
              value={lowStockThreshold ?? ""}
              onChange={(e) => setLowStockThreshold(e.target.value ? Number(e.target.value) : undefined)}
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 rounded-b-xl bg-slate-50 p-4">
          <button className="btn px-4" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn btn-primary px-6" onClick={handleSave}>
            一括更新を適用
          </button>
        </div>
      </div>
    </div>
  );
}

export function PartsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [parts, setParts] = useState<PartSummary[]>([]);
  const [recentParts, setRecentParts] = useState<PartSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<{ totalValue: number; totalStock: number; count: number; valuedCount: number } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customHeaders, setCustomHeaders] = useState<CategoryListHeader[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [statuses, setStatuses] = useState<PartStatus[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const sortState: SortState = {
    key: searchParams.get("sort") || null,
    direction: (searchParams.get("direction") as SortDirection) || null,
  };
  const selectedCategoryId = searchParams.get("categoryId");
  const columnOrderScope = useMemo(() => getColumnOrderScope(selectedCategoryId), [selectedCategoryId]);
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => dedupeKeys(getStoredColumnOrder(columnOrderScope) ?? []));
  const [hiddenColumns, setHiddenColumns] = useState<ColumnKey[]>(() =>
    hasStoredHiddenColumns(columnOrderScope) ? getStoredHiddenColumns(columnOrderScope) : DEFAULT_HIDDEN_COLUMNS,
  );
  const [draggingColumn, setDraggingColumn] = useState<ColumnKey | null>(null);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [showLowStockOnly, setShowLowStockOnly] = useState(searchParams.get("stockStatus") === "low_stock");
  const [specFilterErrors, setSpecFilterErrors] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    Promise.all([apiClient.listCategories(), apiClient.listTags(), apiClient.listStatuses()]).then(([categoryData, tagData, statusData]) => {
      setCategories(categoryData);
      setTags(tagData);
      setStatuses(statusData);
    });
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setError("");
    const next = new URLSearchParams(searchParams);
    if (!next.get("pageSize")) next.set("pageSize", localStorage.getItem("parts_page_size") ?? "50");

    const categoryId = next.get("categoryId");
    const headerPromise = categoryId
      ? apiClient.listCategoryHeaders(Number(categoryId))
      : Promise.resolve([]);

    Promise.all([apiClient.listParts(next), headerPromise])
      .then(([partData, headerData]) => {
        setParts(partData.items);
        setTotalCount(partData.total);
        setCustomHeaders(headerData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));

    const recentParams = new URLSearchParams(next);
    recentParams.set("sort", "updatedAt");
    recentParams.set("direction", "desc");
    recentParams.set("page", "1");
    recentParams.set("pageSize", "5");
    apiClient.listParts(recentParams).then((data) => setRecentParts(data.items)).catch(() => setRecentParts([]));

    // 総在庫価格(ベータ): 現在のフィルタ条件全体での集計（ページ単位ではない）
    apiClient.getPartsStats(next).then(setStats).catch(() => setStats(null));
  }, [searchParams]);

  useEffect(() => {
    setColumnOrder(dedupeKeys(getStoredColumnOrder(columnOrderScope) ?? []));
    setHiddenColumns(
      hasStoredHiddenColumns(columnOrderScope) ? getStoredHiddenColumns(columnOrderScope) : DEFAULT_HIDDEN_COLUMNS,
    );
  }, [columnOrderScope]);

  useEffect(() => {
    setShowLowStockOnly(searchParams.get("stockStatus") === "low_stock");
  }, [searchParams]);

  const selectedTagIds = searchParams.getAll("tagId");
  const selectedTagIdSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);
  const selectedStatusId = searchParams.get("statusId") ?? "";
  const outOfStock = parts.filter((part) => part.stockQuantity === 0);
  const lowStock = parts.filter(isLowStock);
  const reorderCandidatesCount = new Set([...outOfStock, ...lowStock].map((part) => part.id)).size;

  const applySort = useCallback((key: ColumnKey | null, direction: SortDirection | null) => {
    const next = new URLSearchParams(searchParams);
    if (key && direction) {
      next.set("sort", key);
      next.set("direction", direction);
    } else {
      next.delete("sort");
      next.delete("direction");
    }
    next.delete("page");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const sortByKey = useCallback((key: ColumnKey) => {
    // asc → desc → 解除 の3段階トグル
    if (sortState.key !== key) applySort(key, "asc");
    else if (sortState.direction === "asc") applySort(key, "desc");
    else applySort(null, null);
  }, [applySort, sortState]);

  const columns = useMemo<ColumnDefinition[]>(() => {
    const defaultColumns: ColumnDefinition[] = [
      {
        key: "modelNumber",
        label: "型番・部品名",
        sortable: true,
        type: "string",
        width: "w-64",
        visibleOnMobile: true,
        render: (part) => (
          <div className="flex flex-col">
            <Link className="font-semibold text-app-link hover:underline" to={`/parts/${part.id}`} onClick={(event) => event.stopPropagation()}>
              {part.modelNumber}
            </Link>
            {part.name && part.name !== part.modelNumber && (
              <span className="text-xs text-slate-500 truncate">{part.name}</span>
            )}
            {part.archivedAt && <span className="mt-1 text-[10px] font-bold uppercase tracking-tight text-app-danger">アーカイブ済み</span>}
          </div>
        ),
        sortValue: (part) => part.modelNumber,
      },
      {
        key: "description",
        label: "説明",
        sortable: false,
        type: "string",
        width: "w-48",
        visibleOnMobile: false,
        render: (part) => (
          <span className="truncate text-slate-600">{part.description || "-"}</span>
        ),
        sortValue: (part) => part.description ?? "",
      },
      {
        key: "manufacturer",
        label: "メーカー",
        sortable: true,
        type: "string",
        width: "w-36",
        visibleOnMobile: false,
        render: (part) => (
          <button
            type="button"
            className="text-left text-slate-700 hover:text-app-link hover:underline"
            onClick={(e) => { e.stopPropagation(); sortByKey("manufacturer"); }}
            title="メーカーで並び替え"
          >
            {part.manufacturer || "-"}
          </button>
        ),
        sortValue: (part) => part.manufacturer ?? "",
      },
      {
        key: "categoryName",
        label: "カテゴリ",
        sortable: true,
        type: "string",
        width: "w-36",
        visibleOnMobile: true,
        render: (part) => (
          <button
            type="button"
            className="text-left text-slate-700 hover:text-app-link hover:underline"
            onClick={(e) => { e.stopPropagation(); sortByKey("categoryName"); }}
            title="カテゴリで並び替え"
          >
            {part.categoryName}
          </button>
        ),
        sortValue: (part) => part.categoryName,
      },
      {
        key: "status",
        label: "ステータス",
        sortable: true,
        type: "string",
        width: "w-32",
        visibleOnMobile: true,
        render: (part) => statusBadge(part.status),
        sortValue: (part) => part.status?.name ?? "",
      },
      {
        key: "stockQuantity",
        label: "在庫数",
        sortable: true,
        type: "number",
        width: "w-28",
        visibleOnMobile: true,
        render: stockBadge,
        sortValue: (part) => part.stockQuantity,
      },
      {
        key: "location",
        label: "保管場所",
        sortable: true,
        type: "string",
        width: "w-40",
        visibleOnMobile: true,
        render: (part) => (
          <button
            type="button"
            className="text-left text-slate-700 hover:text-app-link hover:underline"
            onClick={(e) => { e.stopPropagation(); sortByKey("location"); }}
            title="保管場所で並び替え"
          >
            {storageLocation(part)}
          </button>
        ),
        sortValue: storageLocation,
      },
      {
        key: "price",
        label: "単価",
        sortable: true,
        type: "number",
        width: "w-28",
        visibleOnMobile: false,
        render: (part) => formatPrice(part.price),
        sortValue: (part) => part.price ?? 0,
      },
      {
        key: "footprint",
        label: "フットプリント",
        sortable: true,
        type: "string",
        width: "w-32",
        visibleOnMobile: false,
        render: (part) => <span className="text-slate-700">{part.footprint || "-"}</span>,
        sortValue: (part) => part.footprint ?? "",
      },
      {
        key: "lowStockThreshold",
        label: "低在庫しきい値",
        sortable: true,
        type: "number",
        width: "w-28",
        visibleOnMobile: false,
        render: (part) => <span className="text-slate-700">{part.lowStockThreshold}</span>,
        sortValue: (part) => part.lowStockThreshold,
      },
      {
        key: "purchaseUrl",
        label: "購入先",
        sortable: false,
        type: "string",
        width: "w-28",
        visibleOnMobile: false,
        render: (part) =>
          part.purchaseUrl ? (
            <a className="text-app-link hover:underline" href={part.purchaseUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>リンク</a>
          ) : (
            "-"
          ),
        sortValue: (part) => part.purchaseUrl ?? "",
      },
      {
        key: "datasheetUrl",
        label: "データシート",
        sortable: false,
        type: "string",
        width: "w-28",
        visibleOnMobile: false,
        render: (part) =>
          part.datasheetUrl ? (
            <a className="text-app-link hover:underline" href={part.datasheetUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>リンク</a>
          ) : (
            "-"
          ),
        sortValue: (part) => part.datasheetUrl ?? "",
      },
      {
        key: "memo",
        label: "メモ",
        sortable: false,
        type: "string",
        width: "w-48",
        visibleOnMobile: false,
        render: (part) => <span className="truncate text-slate-600">{part.memo || "-"}</span>,
        sortValue: (part) => part.memo ?? "",
      },
      {
        key: "tags",
        label: "タグ",
        sortable: false,
        type: "string",
        width: "w-40",
        visibleOnMobile: false,
        render: (part) =>
          part.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {part.tags.map((tag) => (
                <span key={tag.id} className="badge border border-slate-200 bg-white text-slate-500">{tag.name}</span>
              ))}
            </span>
          ) : (
            "-"
          ),
        sortValue: (part) => part.tags.map((tag) => tag.name).join(", "),
      },
      {
        key: "createdAt",
        label: "作成日",
        sortable: true,
        type: "date",
        width: "w-28",
        visibleOnMobile: false,
        render: (part) => <span className="text-slate-600">{formatDate(part.createdAt)}</span>,
        sortValue: (part) => part.createdAt,
      },
      {
        key: "updatedAt",
        label: "更新日",
        sortable: true,
        type: "date",
        width: "w-28",
        visibleOnMobile: false,
        render: (part) => <span className="text-slate-600">{formatDate(part.updatedAt)}</span>,
        sortValue: (part) => part.updatedAt,
      },
      {
        key: "actions",
        label: "操作",
        sortable: false,
        type: "string",
        width: "w-40",
        visibleOnMobile: true,
        render: (part) => (
          <div className="flex flex-wrap gap-1">
            <Link className="text-app-link hover:underline" to={`/parts/${part.id}`}>詳細</Link>
            <Link className="text-app-link hover:underline" to={`/parts/${part.id}/edit`}>編集</Link>
            <button className="text-app-link hover:underline" onClick={() => duplicatePart(part)}>複製</button>
            {part.archivedAt ? (
              <>
                <button className="text-app-link hover:underline" onClick={() => restorePart(part)}>復元</button>
                <button className="text-app-danger hover:underline" onClick={() => permanentlyDeletePart(part)}>完全削除</button>
              </>
            ) : (
              <button className="text-app-danger hover:underline" onClick={() => archivePart(part)}>削除</button>
            )}
          </div>
        ),
        sortValue: () => "",
      },
    ];

    if (customHeaders.length === 0) {
      return defaultColumns;
    }

    // Map custom headers to ColumnDefinitions
    return customHeaders.filter((header) => header.fieldKey !== "archived").map((header) => {
      if (header.fieldKey) {
        const found = defaultColumns.find((c) => c.key === header.fieldKey);
        if (found) return { ...found, label: header.label };
      }

      if (header.attributeDefinitionId && header.attributeDefinition) {
        const ad = header.attributeDefinition;
        return {
          key: `attr_${ad.key}`,
          label: header.label,
          sortable: true,
          type: ad.dataType === "number" ? "number" : "string",
          width: "w-32",
          visibleOnMobile: false,
          render: (part) => {
            const val = part.attributeValues?.find((v) => v.attributeDefinitionId === ad.id);
            return val?.displayValue || "-";
          },
          sortValue: (part) => {
            const val = part.attributeValues?.find((v) => v.attributeDefinitionId === ad.id);
            return ad.dataType === "number" ? val?.valueNumber : val?.valueText;
          },
        };
      }

      return {
        key: `custom_${header.id}`,
        label: header.label,
        sortable: false,
        type: "string",
        width: "w-32",
        visibleOnMobile: false,
        render: () => "-",
        sortValue: () => "",
      };
    });
  }, [customHeaders, sortByKey]);

  const orderedColumns = useMemo(() => {
    const defaultKeys = dedupeKeys(columns.map((column) => column.key));
    const savedKeys = columnOrder.filter((key) => defaultKeys.includes(key));
    const missingKeys = defaultKeys.filter((key) => !savedKeys.includes(key));
    const orderedKeys = savedKeys.length === 0 ? defaultKeys : [...savedKeys, ...missingKeys];
    return dedupeKeys(orderedKeys).map((key) => columns.find((column) => column.key === key)!);
  }, [columnOrder, columns]);
  const visibleColumns = useMemo(
    () => orderedColumns.filter((column) => !hiddenColumns.includes(column.key)),
    [orderedColumns, hiddenColumns],
  );
  const mobileDetailColumns = useMemo(
    () => visibleColumns.filter((column) => !["modelNumber", "categoryName", "actions"].includes(column.key)),
    [visibleColumns],
  );

  const filteredParts = useMemo(() => showLowStockOnly ? parts.filter(isLowStock) : parts, [parts, showLowStockOnly]);
  const sortedParts = useMemo(() => {
    if (!sortState.key || !sortState.direction) return filteredParts;
    // サーバーが全体ソート済みの列はサーバー順をそのまま信頼する。
    if (SERVER_SORT_KEYS.has(sortState.key)) return filteredParts;
    const column = columns.find((item) => item.key === sortState.key);
    if (!column) return filteredParts;

    const collator = new Intl.Collator("ja-JP", { numeric: true, sensitivity: "base" });
    return [...filteredParts].sort((a, b) => {
      const left = column.sortValue(a);
      const right = column.sortValue(b);
      let result = 0;

      if (column.type === "number") {
        result = Number(left ?? 0) - Number(right ?? 0);
      } else if (column.type === "date") {
        result = new Date(String(left ?? "")).getTime() - new Date(String(right ?? "")).getTime();
      } else {
        // 文字列列でも、両辺が数値なら数値として比較する（"0.25" < "0.9" を正しく扱う）。
        // Intl.Collator({numeric:true}) は小数を誤って整数列扱いするため、数値判定を優先する。
        const leftNum = toFiniteNumber(left);
        const rightNum = toFiniteNumber(right);
        if (leftNum !== null && rightNum !== null) {
          result = leftNum - rightNum;
        } else {
          result = collator.compare(String(left ?? ""), String(right ?? ""));
        }
      }

      return sortState.direction === "asc" ? result : -result;
    });
  }, [columns, filteredParts, sortState]);

  function toggleSelectAll() {
    if (selectedIds.size === sortedParts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedParts.map((p) => p.id)));
    }
  }

  function toggleSelect(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function bulkArchive() {
    if (selectedIds.size === 0) return;
    if (!confirm(`選択された ${selectedIds.size} 件の部品をアーカイブしますか？`)) return;
    try {
      await apiClient.bulkArchiveParts([...selectedIds]);
      const next = new URLSearchParams(searchParams);
      const partData = await apiClient.listParts(next);
      setParts(partData.items);
      setTotalCount(partData.total);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "一括アーカイブに失敗しました。");
    }
  }

  async function bulkUpdate(data: BulkUpdatePartsInput) {
    if (selectedIds.size === 0) return;
    try {
      await apiClient.bulkUpdateParts([...selectedIds], data);
      const next = new URLSearchParams(searchParams);
      const partData = await apiClient.listParts(next);
      setParts(partData.items);
      setTotalCount(partData.total);
      setSelectedIds(new Set());
      setIsBulkEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "一括編集に失敗しました。");
    }
  }

  const currentPage = Number(searchParams.get("page") ?? "1");
  const currentPageSize = Number(searchParams.get("pageSize") ?? localStorage.getItem("parts_page_size") ?? "50");
  const totalPages = Math.max(1, Math.ceil(totalCount / currentPageSize));

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    setSearchParams(next);
    // ページ送り(クエリのみ変化)では先頭へ戻らないため、明示的にスクロールする。
    window.scrollTo({ top: 0 });
  }

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  }

  function toggleTagFilter(tagId: number) {
    setSearchParams(toggleSearchParamValue(searchParams, "tagId", String(tagId)));
  }

  function clearTagFilter() {
    setSearchParams(clearSearchParamValues(searchParams, "tagId"));
  }

  async function archivePart(part: PartSummary) {
    if (!confirm(`${part.modelNumber} をアーカイブしますか？`)) return;
    await apiClient.deletePart(part.id);
    setParts((current) => current.filter((item) => item.id !== part.id));
  }

  async function restorePart(part: PartSummary) {
    if (!confirm(`${part.modelNumber} を復元しますか？`)) return;
    try {
      await apiClient.restorePart(part.id);
      const next = new URLSearchParams(searchParams);
      const data = await apiClient.listParts(next);
      setParts(data.items);
      setTotalCount(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "復元に失敗しました。");
    }
  }

  async function permanentlyDeletePart(part: PartSummary) {
    if (!confirm(`${part.modelNumber} を完全に削除しますか？この操作は元に戻せません。`)) return;
    await apiClient.permanentlyDeletePart(part.id);
    setParts((current) => current.filter((item) => item.id !== part.id));
  }

  function duplicatePart(part: PartSummary) {
    navigate(`/parts/new?duplicate=${part.id}`);
  }

  function toggleSort(column: ColumnDefinition) {
    if (!column.sortable) return;
    sortByKey(column.key);
  }

  function sortIcon(column: ColumnDefinition) {
    if (sortState.key !== column.key) return "↕";
    if (sortState.direction === "asc") return "↑";
    if (sortState.direction === "desc") return "↓";
    return "↕";
  }

  function moveColumn(key: ColumnKey, direction: -1 | 1) {
    const keys = orderedColumns.map((column) => column.key);
    const index = keys.indexOf(key);
    if (index < 0) return;
    // 表示中の列だけで並べ替える（間に非表示列があっても見た目どおり動かす）。
    let target = index + direction;
    while (target >= 0 && target < keys.length && hiddenColumns.includes(keys[target])) {
      target += direction;
    }
    if (target < 0 || target >= keys.length) return;
    const reordered = [...keys];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const next = dedupeKeys(reordered);
    setColumnOrder(next);
    setStoredColumnOrder(columnOrderScope, next);
  }

  function handleColumnDrop(event: DragEvent<HTMLTableCellElement>, targetKey: ColumnKey) {
    event.preventDefault();
    if (!draggingColumn || draggingColumn === targetKey) return;
    const keys = orderedColumns.map((column) => column.key);
    const from = keys.indexOf(draggingColumn);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const reordered = [...keys];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const next = dedupeKeys(reordered);
    setColumnOrder(next);
    setStoredColumnOrder(columnOrderScope, next);
    setDraggingColumn(null);
  }

  function resetColumnSettings() {
    removeStoredColumnOrder(columnOrderScope);
    setStoredHiddenColumns(columnOrderScope, DEFAULT_HIDDEN_COLUMNS);
    setColumnOrder([]);
    setHiddenColumns(DEFAULT_HIDDEN_COLUMNS);
    setColumnWidths({});
  }

  function toggleColumnVisibility(key: ColumnKey) {
    const isHiding = !hiddenColumns.includes(key);
    // 最低1列は残す（全部非表示で表が消えるのを防ぐ）。実在する表示列で判定する。
    if (isHiding && visibleColumns.length <= 1) return;
    const next = isHiding ? [...hiddenColumns, key] : hiddenColumns.filter((k) => k !== key);
    setHiddenColumns(next);
    setStoredHiddenColumns(columnOrderScope, next);
  }

  const handleResizeStart = useCallback((key: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const th = (event.target as HTMLElement).closest("th");
    if (!th) return;
    resizingRef.current = { key, startX: event.clientX, startWidth: th.offsetWidth };
    function onMouseMove(e: MouseEvent) {
      if (!resizingRef.current) return;
      const delta = e.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [resizingRef.current!.key]: newWidth }));
    }
    function onMouseUp() {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  function applyLowStockFilter() {
    const next = new URLSearchParams(searchParams);
    next.set("stockStatus", "low_stock");
    next.delete("page");
    setShowLowStockOnly(true);
    setSearchParams(next);
  }

  function clearLowStockFilter() {
    const next = new URLSearchParams(searchParams);
    if (next.get("stockStatus") === "low_stock") next.set("stockStatus", "all");
    setShowLowStockOnly(false);
    setSearchParams(next);
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0 panel-card">
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold text-slate-950">部品一覧</h1>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Link to="/parts/new" className="btn btn-primary">＋ 作成</Link>
              <Link to="/export" className="btn">エクスポート</Link>
            </div>
          </div>
          {stats && (
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-app/40 bg-app-soft px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-app-link">
                総在庫価格
                <span className="rounded bg-app-link/10 px-1 py-0.5 text-[10px] font-bold uppercase tracking-tight text-app-link">Beta</span>
              </span>
              <span className="text-base font-bold text-slate-900">{formatPrice(stats.totalValue)}</span>
              <span className="text-slate-500">総在庫数 {stats.totalStock.toLocaleString()}</span>
              <span className="text-slate-500">対象 {stats.count.toLocaleString()}件（単価あり {stats.valuedCount.toLocaleString()}件）</span>
              {stats.valuedCount < stats.count && <span className="text-app-danger">※単価未設定の部品は0円として集計</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.label}
                className={`btn ${searchParams.get("archived") === tab.archived || (!searchParams.get("archived") && tab.archived === "active") ? "border-app bg-app-soft text-app-link" : ""}`}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  if (tab.archived) next.set("archived", tab.archived);
                  else next.delete("archived");
                  if (tab.stockStatus) next.set("stockStatus", tab.stockStatus);
                  else next.delete("stockStatus");
                  if (tab.q) next.set("q", tab.q);
                  else next.delete("q");
                  setSearchParams(next);
                }}
              >
                {tab.label}
              </button>
            ))}
            <PartsSearchInput value={searchParams.get("q") ?? ""} onValueChange={(value) => updateFilter("q", value)} />
            <select className="h-8 rounded border border-slate-300 px-2 text-xs" value={searchParams.get("categoryId") ?? ""} onChange={(event) => updateFilter("categoryId", event.target.value)}>
              <option value="">全カテゴリ</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select className="h-8 rounded border border-slate-300 px-2 text-xs" value={selectedStatusId} onChange={(event) => updateFilter("statusId", event.target.value)}>
              <option value="">全ステータス</option>
              {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
            <select className="h-8 rounded border border-slate-300 px-2 text-xs" value={searchParams.get("stockStatus") ?? "all"} onChange={(event) => updateFilter("stockStatus", event.target.value)}>
              <option value="all">在庫すべて</option>
              <option value="in_stock">在庫あり</option>
              <option value="out_of_stock">在庫切れ</option>
              <option value="low_stock">低在庫</option>
            </select>
            <div className="flex w-full items-center gap-1.5 md:hidden">
              <select className="h-8 min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs" value={sortState.key ?? ""} onChange={(event) => applySort(event.target.value ? (event.target.value as ColumnKey) : null, event.target.value ? (sortState.direction ?? "asc") : null)}>
                <option value="">並び替えなし</option>
                {visibleColumns.filter((column) => column.sortable).map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
              </select>
              <button
                className={`btn shrink-0 ${sortState.direction === "asc" ? "border-app bg-app-soft text-app-link" : ""}`}
                disabled={!sortState.key}
                onClick={() => sortState.key && applySort(sortState.key, "asc")}
              >
                昇順
              </button>
              <button
                className={`btn shrink-0 ${sortState.direction === "desc" ? "border-app bg-app-soft text-app-link" : ""}`}
                disabled={!sortState.key}
                onClick={() => sortState.key && applySort(sortState.key, "desc")}
              >
                降順
              </button>
              <button className="btn shrink-0" disabled={!sortState.key} onClick={() => applySort(null, null)}>解除</button>
            </div>
            {showLowStockOnly && <button className="btn border-app bg-app-soft text-app-link" onClick={clearLowStockFilter}>低在庫フィルタ解除</button>}
            <label className="inline-flex items-center gap-1 text-xs text-slate-600">
              表示件数
              <select
                className="h-8 rounded border border-slate-300 px-2 text-xs"
                value={searchParams.get("pageSize") ?? localStorage.getItem("parts_page_size") ?? "50"}
                onChange={(event) => {
                  const value = event.target.value;
                  localStorage.setItem("parts_page_size", value);
                  const next = new URLSearchParams(searchParams);
                  next.set("pageSize", value);
                  next.delete("page");
                  setSearchParams(next);
                }}
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </label>
            <button className="btn" onClick={() => setShowColumnSettings((current) => !current)}>表示列</button>
          </div>
          {searchParams.get("categoryId") && customHeaders.some(h => h.attributeDefinitionId) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
              <span className="font-medium text-slate-700">仕様フィルタ:</span>
              {customHeaders.filter(h => h.attributeDefinitionId).map(header => {
                const ad = header.attributeDefinition!;
                const attrs = parseSpecFilters(searchParams.get("attrs"));
                const raw = attrs[ad.key];
                const isNumber = ad.dataType === "number";
                const validOps = isNumber ? numberSpecFilterOperators : textSpecFilterOperators;
                const current = readSpecFilterValue(raw);
                const currentOp = validOps.includes(current.op) ? current.op : "eq";
                const currentVal = current.val;

                function setFilter(op: SpecFilterOperator, val: string) {
                  const isComparison = op !== "eq" && op !== "contains";
                  const invalid = !!val && isComparison && !Number.isFinite(Number(val.trim()));
                  setSpecFilterErrors((prev) => {
                    const next = { ...prev };
                    if (invalid) next[ad.key] = "比較条件には数値を入力してください";
                    else delete next[ad.key];
                    return next;
                  });
                  const nextAttrs = { ...attrs };
                  if (val) {
                    nextAttrs[ad.key] = op === "eq" ? val : { op, val };
                  } else {
                    delete nextAttrs[ad.key];
                  }
                  updateFilter("attrs", Object.keys(nextAttrs).length > 0 ? JSON.stringify(nextAttrs) : "");
                }

                const fieldError = specFilterErrors[ad.key];
                return (
                  <div key={ad.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <label className="text-slate-500">{header.label}</label>
                      <select
                        className="h-6 rounded border border-slate-300 px-0.5 text-[10px]"
                        value={currentOp}
                        onChange={(e) => setFilter(e.target.value as SpecFilterOperator, currentVal)}
                      >
                        <option value="eq">等しい (=)</option>
                        <option value="gte">以上 (≥)</option>
                        <option value="gt">より大きい ({">"})</option>
                        <option value="lte">以下 (≤)</option>
                        <option value="lt">未満 ({"<"})</option>
                        {!isNumber && <option value="contains">含む</option>}
                      </select>
                      <input
                        className={`h-6 w-20 rounded border px-1 text-[10px] ${fieldError ? "border-red-500" : "border-slate-300"}`}
                        placeholder="値..."
                        value={currentVal}
                        onChange={(e) => setFilter(currentOp, e.target.value)}
                      />
                    </div>
                    {fieldError && <span className="text-[10px] text-red-600">{fieldError}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {showColumnSettings && (
            <div className="mt-2 grid gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs md:max-w-xl">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">表示中の列</span>
                <button className="text-app-link underline" onClick={resetColumnSettings}>列設定をリセット</button>
              </div>
              <p className="text-[11px] text-slate-500">×で列を削除、←→で並び替えできます（最低1列は表示）。</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {visibleColumns.map((column, index) => (
                  <div key={column.key} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                    <span className="truncate">{column.label}</span>
                    <span className="flex gap-1">
                      <button className="toolbar-icon !size-6" disabled={index === 0} onClick={() => moveColumn(column.key, -1)} aria-label={`${column.label}を左へ`}>←</button>
                      <button className="toolbar-icon !size-6" disabled={index === visibleColumns.length - 1} onClick={() => moveColumn(column.key, 1)} aria-label={`${column.label}を右へ`}>→</button>
                      <button className="toolbar-icon !size-6 text-app-danger" disabled={visibleColumns.length <= 1} onClick={() => toggleColumnVisibility(column.key)} aria-label={`${column.label}を削除`}>×</button>
                    </span>
                  </div>
                ))}
              </div>
              {orderedColumns.some((column) => hiddenColumns.includes(column.key)) && (
                <div className="grid gap-1 border-t border-slate-200 pt-2">
                  <span className="font-medium text-slate-700">列を追加</span>
                  <div className="flex flex-wrap gap-1">
                    {orderedColumns
                      .filter((column) => hiddenColumns.includes(column.key))
                      .map((column) => (
                        <button
                          key={column.key}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:border-app hover:text-app-link"
                          onClick={() => toggleColumnVisibility(column.key)}
                          aria-label={`${column.label}を追加`}
                        >
                          ＋ {column.label}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium text-slate-500">ステータス</span>
            {statuses.map((status) => {
              const selected = selectedStatusId === String(status.id);
              return (
                <button
                  key={status.id}
                  className={`badge border ${selected ? "border-app bg-app-soft text-app-link" : "border-slate-200 bg-white text-slate-500"}`}
                  onClick={() => updateFilter("statusId", selected ? "" : String(status.id))}
                >
                  <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: status.color }} />
                  {status.name}
                </button>
              );
            })}
            {selectedStatusId && <button className="text-xs text-slate-500 underline" onClick={() => updateFilter("statusId", "")}>解除</button>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium text-slate-500">タグ</span>
            {tags.map((tag) => {
              const selected = selectedTagIdSet.has(String(tag.id));
              return <button key={tag.id} className={`badge border ${selected ? "border-app bg-app-soft text-app-link" : "border-slate-200 bg-white text-slate-500"}`} onClick={() => toggleTagFilter(tag.id)}>{tag.name}</button>;
            })}
            {selectedTagIds.length > 0 && <button className="text-xs text-slate-500 underline" onClick={clearTagFilter}>解除</button>}
          </div>
        </div>

        {error && <div className="m-3 rounded border border-app bg-app-soft px-3 py-2 text-sm text-app-danger">{error}</div>}
        {/* 初回ロード等でデータ未取得のときだけスケルトン。再取得中は前データを保持して点滅を防ぐ。 */}
        {isLoading && parts.length === 0 ? (
          <PartsListSkeleton columnCount={visibleColumns.length} mobileMetaCount={mobileDetailColumns.length} />
        ) : sortedParts.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">条件に一致する部品はありません。</div>
        ) : (
          <>
          {/* 再取得中はレイアウトに影響しない控えめな更新バーを表示。 */}
          {isLoading && <div className="h-0.5 animate-pulse bg-app/40" />}
          <div className="hidden max-h-[calc(100vh-180px)] overflow-auto md:block">
            <table className="dense-table w-full min-w-[1040px] border-separate border-spacing-0" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 40 }} />
                {visibleColumns.map((column) => (
                  <col key={column.key} style={columnWidths[column.key] ? { width: columnWidths[column.key] } : undefined} className={columnWidths[column.key] ? undefined : column.width} />
                ))}
              </colgroup>
              <thead className="bg-white">
                <tr>
                  <th className="!p-0 !text-center !align-middle">
                    <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === sortedParts.length} onChange={toggleSelectAll} />
                  </th>
                  <th></th>
                  {visibleColumns.map((column) => (
                    <th
                      key={column.key}
                      draggable
                      onDragStart={() => setDraggingColumn(column.key)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleColumnDrop(event, column.key)}
                      className={`relative ${draggingColumn === column.key ? "opacity-60" : ""}`}
                    >
                      <button
                        className={`flex w-full items-center justify-between gap-1 text-left ${column.sortable ? "cursor-pointer" : "cursor-grab"}`}
                        onClick={() => toggleSort(column)}
                        title={column.sortable ? "クリックで昇順、降順、解除を切り替え" : "ドラッグで列順変更"}
                      >
                        <span className="truncate">{column.label}</span>
                        {column.sortable && <span className={sortState.key === column.key ? "text-app-link" : "text-slate-400"}>{sortIcon(column)}</span>}
                      </button>
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-slate-300"
                        onMouseDown={(e) => handleResizeStart(column.key, e)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedParts.map((part) => (
                  <Fragment key={part.id}>
                    <tr onClick={() => navigate(`/parts/${part.id}`)} className={`cursor-pointer ${selectedIds.has(part.id) ? "bg-app-soft/30" : ""}`}>
                      <td className="text-center" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(part.id)} onChange={() => toggleSelect(part.id)} />
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <button className="toolbar-icon !size-6" onClick={() => setExpandedId(expandedId === part.id ? null : part.id)}>{expandedId === part.id ? "−" : "+"}</button>
                      </td>
                      {visibleColumns.map((column) => (
                        <td key={column.key} className="overflow-hidden text-ellipsis whitespace-nowrap" onClick={column.key === "actions" ? (event) => event.stopPropagation() : undefined}>{column.render(part)}</td>
                      ))}
                    </tr>
                    {expandedId === part.id && (
                      <tr>
                        <td colSpan={visibleColumns.length + 2} className="bg-app-soft">
                          <div className="grid gap-3 p-2 text-xs lg:grid-cols-5">
                            <div><b>メモ</b><p className="mt-1 text-slate-600">{part.memo || "-"}</p></div>
                            <div><b>属性</b><p className="mt-1 text-slate-600">{part.attributes.map((a) => `${a.key}: ${a.value}${a.unit ?? ""}`).join(" / ") || "-"}</p></div>
                            <div><b>在庫履歴</b><p className="mt-1 text-slate-600">直近3件は詳細画面で確認できます</p></div>
                            <div><b>データシート</b><p className="mt-1">{part.datasheetUrl ? <a className="text-app-link underline" href={part.datasheetUrl}>リンクを開く</a> : "-"}</p></div>
                            <div><b>関連プロジェクト</b><p className="mt-1 text-slate-600">登録なし</p></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 md:hidden">
            {sortedParts.map((part) => (
              <article key={part.id} className={`relative rounded-md border border-slate-200 bg-white p-3 ${selectedIds.has(part.id) ? "border-app ring-1 ring-app" : ""}`} onClick={() => navigate(`/parts/${part.id}`)}>
                <div className="absolute left-3 top-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(part.id)} onChange={() => toggleSelect(part.id)} />
                </div>
                <div className="flex min-w-0 items-start justify-between gap-2 pl-7">
                  <div className="min-w-0 flex-1">
                    <Link className="mobile-part-title block text-base font-semibold text-app-link" to={`/parts/${part.id}`} onClick={(event) => event.stopPropagation()}>{part.modelNumber}</Link>
                    <p className="mobile-part-meta mt-1 text-xs text-slate-500">{part.categoryName}</p>
                  </div>
                  {isLowStock(part) && <span className="badge shrink-0 bg-app-soft text-app-danger">低在庫</span>}
                </div>
                <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
                  {mobileDetailColumns.map((column) => (
                    <div key={column.key} className="min-w-0">
                      <dt className="mobile-part-meta text-slate-500">{column.label}</dt>
                      <dd className="mobile-part-value mt-0.5 text-slate-900">{column.render(part)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                  <Link className="btn" to={`/parts/${part.id}`}>詳細</Link>
                  <Link className="btn" to={`/parts/${part.id}/edit`}>編集</Link>
                  <button className="btn" onClick={() => duplicatePart(part)}>複製</button>
                  {part.archivedAt ? (
                    <>
                      <button className="btn text-app-link" onClick={() => restorePart(part)}>復元</button>
                      <button className="btn text-app-danger" onClick={() => permanentlyDeletePart(part)}>完全削除</button>
                    </>
                  ) : (
                    <button className="btn text-app-danger" onClick={() => archivePart(part)}>削除</button>
                  )}
                </div>
              </article>
            ))}
          </div>
          </>
        )}
        {totalPages > 1 && (
          <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span className="text-slate-500">全 {totalCount} 件中 {(currentPage - 1) * currentPageSize + 1}〜{Math.min(currentPage * currentPageSize, totalCount)} 件</span>
            <div className="flex flex-wrap items-center gap-1">
              <button className="btn" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>前へ</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce<(number | "...")[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] ?? 0) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-slate-400">...</span>
                  ) : (
                    <button key={p} className={`min-w-[32px] rounded px-2 py-1.5 ${p === currentPage ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`} onClick={() => goToPage(p)}>
                      {p}
                    </button>
                  ),
                )}
              <button className="btn" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>次へ</button>
            </div>
          </div>
        )}
      </section>

      <aside className="grid content-start gap-2">
        <section className="panel-card p-3">
          <h2 className="mb-2 text-sm font-semibold">最近の変更</h2>
          <div className="grid gap-2 text-xs">
            {recentParts.map((part) => <Link key={part.id} to={`/parts/${part.id}`} className="flex justify-between gap-2 border-b border-slate-100 pb-1"><span>{part.modelNumber}</span><span className="text-slate-500">{formatDate(part.updatedAt)}</span></Link>)}
          </div>
        </section>
        <section className="panel-card p-3">
          <h2 className="mb-2 text-sm font-semibold">低在庫アラート</h2>
          <div className="grid gap-2 text-xs">
            <button className="rounded bg-app-soft p-2 text-left text-app-danger hover:underline" onClick={() => updateFilter("stockStatus", "out_of_stock")}>在庫切れ: {outOfStock.length}件</button>
            <button className="rounded bg-app-soft p-2 text-left text-app-link hover:underline" onClick={applyLowStockFilter}>低在庫アラート: {lowStock.length}件</button>
          </div>
        </section>
      </aside>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-full border border-slate-200 bg-white/90 px-6 py-3 shadow-xl backdrop-blur-md">
          <span className="text-sm font-bold text-slate-700">{selectedIds.size} 件選択中</span>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" onClick={() => setIsBulkEditing(true)}>一括編集</button>
            <button className="btn text-app-danger hover:bg-red-50" onClick={bulkArchive}>一括削除</button>
            <button className="btn" onClick={() => setSelectedIds(new Set())}>解除</button>
          </div>
        </div>
      )}

      {isBulkEditing && (
        <BulkEditModal
          selectedCount={selectedIds.size}
          categories={categories}
          statuses={statuses}
          onClose={() => setIsBulkEditing(false)}
          onSave={bulkUpdate}
        />
      )}
    </div>
  );
}

// 一覧本体と同じ容器・寸法で領域を予約する。列数・行数を実データに合わせてシフトを抑える。
function PartsListSkeleton({ columnCount, mobileMetaCount }: { columnCount: number; mobileMetaCount: number }) {
  const colSpan = columnCount + 2;
  return (
    <>
      <div className="hidden max-h-[calc(100vh-180px)] overflow-auto md:block">
        <table className="dense-table w-full min-w-[1040px] border-separate border-spacing-0" style={{ tableLayout: "fixed" }}>
          <thead className="bg-white">
            <tr>
              {Array.from({ length: colSpan }).map((_, index) => (
                <th key={index}><Skeleton className="h-4 w-16" /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, row) => (
              <tr key={row}>
                {Array.from({ length: colSpan }).map((_, col) => (
                  <td key={col}><Skeleton className="h-4 w-full" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 p-3 md:hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <article key={index} className="rounded-md border border-slate-200 bg-white p-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-1 h-3 w-24" />
            <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              {Array.from({ length: Math.max(mobileMetaCount, 2) }).map((_, meta) => (
                <div key={meta} className="space-y-1">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-7 w-12" />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
