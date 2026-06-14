import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PartSummary } from "@shared/types";
import { apiClient } from "../../lib/api-client";
import { formatPrice } from "../../lib/format";

type PartPickerModalProps = {
  initialParts: PartSummary[];
  selectedIds: Set<number>;
  onAdd: (part: PartSummary) => void;
  onClose: () => void;
};

function partLocation(part: PartSummary) {
  return [part.locationName, part.caseNumber].filter(Boolean).join(" / ") || "未設定";
}

export function PartPickerModal({
  initialParts,
  selectedIds,
  onAdd,
  onClose,
}: PartPickerModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(initialParts.slice(0, 30));
  const [focusedId, setFocusedId] = useState<number | null>(
    initialParts[0]?.id ?? null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError("");
      try {
        const search = new URLSearchParams({
          pageSize: "30",
          archived: "active",
          sort: "updatedAt",
          direction: "desc",
        });
        if (query.trim()) search.set("q", query.trim());
        const response = await apiClient.listParts(search);
        setResults(response.items);
        setFocusedId((current) =>
          response.items.some((part) => part.id === current)
            ? current
            : (response.items[0]?.id ?? null),
        );
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "部品の検索に失敗しました。",
        );
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const focusedPart = useMemo(
    () => results.find((part) => part.id === focusedId) ?? null,
    [focusedId, results],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="部品を選択"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="border-b border-slate-200 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">部品を追加</h2>
              <p className="mt-1 text-sm text-slate-500">
                型番、名前、メーカー、仕様、タグなどから検索できます。
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              onClick={onClose}
            >
              閉じる
            </button>
          </div>
          <div className="relative mt-4">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              ⌕
            </span>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-300 py-3 pl-9 pr-20 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例: ESP32、10kΩ、村田、SOT-23"
            />
            {isLoading && (
              <span className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-500">
                検索中...
              </span>
            )}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-slate-200 p-3 sm:p-4">
            {error && (
              <p className="rounded-md bg-red-50 p-3 text-sm text-app-danger">{error}</p>
            )}
            {!error && !isLoading && results.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-12 text-center">
                <p className="font-medium text-slate-700">該当する部品がありません</p>
                <p className="mt-1 text-sm text-slate-500">
                  検索語を短くするか、別の型番・仕様で検索してください。
                </p>
              </div>
            )}
            <div className="grid gap-2">
              {results.map((part) => {
                const selected = selectedIds.has(part.id);
                return (
                  <button
                    type="button"
                    key={part.id}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      focusedId === part.id
                        ? "border-slate-500 bg-slate-50 ring-2 ring-slate-200"
                        : "border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                    }`}
                    onClick={() => setFocusedId(part.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">
                          {part.modelNumber}
                        </p>
                        <p className="truncate text-sm text-slate-600">{part.name}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                          selected
                            ? "bg-slate-900 text-white"
                            : part.stockQuantity > 0
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                        }`}
                      >
                        {selected ? "追加済み" : `在庫 ${part.stockQuantity}`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{part.categoryName}</span>
                      {part.manufacturer && <span>{part.manufacturer}</span>}
                      {part.footprint && <span>{part.footprint}</span>}
                      <span>{partLocation(part)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="hidden min-h-0 overflow-y-auto bg-slate-50 p-5 lg:block">
            {focusedPart ? (
              <PartPreview
                part={focusedPart}
                selected={selectedIds.has(focusedPart.id)}
                onAdd={() => onAdd(focusedPart)}
              />
            ) : (
              <p className="text-sm text-slate-500">部品を選択すると情報を確認できます。</p>
            )}
          </aside>
        </div>

        {focusedPart && (
          <div className="border-t border-slate-200 bg-white p-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{focusedPart.modelNumber}</p>
                <p className="truncate text-xs text-slate-500">{focusedPart.name}</p>
              </div>
              <button
                type="button"
                disabled={selectedIds.has(focusedPart.id)}
                className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
                onClick={() => onAdd(focusedPart)}
              >
                {selectedIds.has(focusedPart.id) ? "追加済み" : "この部品を追加"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PartPreview({
  part,
  selected,
  onAdd,
}: {
  part: PartSummary;
  selected: boolean;
  onAdd: () => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {part.categoryName}
      </p>
      <h3 className="mt-1 break-words text-xl font-semibold text-slate-950">
        {part.modelNumber}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{part.name}</p>
      {part.description && (
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{part.description}</p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <PreviewItem label="在庫" value={`${part.stockQuantity}`} />
        <PreviewItem label="単価" value={part.price == null ? "未設定" : formatPrice(part.price)} />
        <PreviewItem label="メーカー" value={part.manufacturer || "未設定"} />
        <PreviewItem label="フットプリント" value={part.footprint || "未設定"} />
        <PreviewItem label="保管場所" value={partLocation(part)} wide />
      </dl>

      {part.attributes.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-500">主な仕様</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {part.attributes.slice(0, 8).map((attribute) => (
              <span
                key={`${attribute.key}-${attribute.value}`}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
              >
                {attribute.label || attribute.key}: {attribute.value}
                {attribute.unit || ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-2">
        <button
          type="button"
          disabled={selected}
          className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
          onClick={onAdd}
        >
          {selected ? "追加済み" : "この部品を追加"}
        </button>
        <Link
          to={`/parts/${part.id}`}
          target="_blank"
          className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          部品の詳細を別タブで開く
        </Link>
      </div>
    </div>
  );
}

function PreviewItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-md border border-slate-200 bg-white p-2.5 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-slate-800">{value}</dd>
    </div>
  );
}
