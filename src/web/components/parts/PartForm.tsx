import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { AttributeDefinition, Category, PartAttribute, PartDetail, PartStatus, PartWriteInput, Tag } from "@shared/types";
import { Field, inputClass } from "../ui/Field";
import { apiClient } from "../../lib/api-client";

type PartFormProps = {
  categories: Category[];
  tags: Tag[];
  statuses: PartStatus[];
  initialPart?: PartDetail;
  onSubmit: (input: PartWriteInput) => Promise<void>;
};

const emptyAttribute: PartAttribute = { key: "", label: "", value: "", unit: "" };

function numericValue(value: string, fallback = 0): number {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function PartForm({ categories, tags, statuses, initialPart, onSubmit }: PartFormProps) {
  const [categoryId, setCategoryId] = useState(initialPart?.categoryId ?? categories[0]?.id ?? 0);
  const [statusId, setStatusId] = useState<number | "">(initialPart?.statusId ?? "");
  const [modelNumber, setModelNumber] = useState(initialPart?.modelNumber ?? "");
  const [name, setName] = useState(initialPart?.name ?? "");
  const [description, setDescription] = useState(initialPart?.description ?? "");
  const [manufacturer, setManufacturer] = useState(initialPart?.manufacturer ?? "");
  const [footprint, setFootprint] = useState(initialPart?.footprint ?? "");
  const [stockQuantity, setStockQuantity] = useState(String(initialPart?.stockQuantity ?? 0));
  const [price, setPrice] = useState(initialPart?.price == null ? "" : String(initialPart.price));
  const [locationName, setLocationName] = useState(initialPart?.locationName ?? "");
  const [caseNumber, setCaseNumber] = useState(initialPart?.caseNumber ?? "");
  const [purchaseUrl, setPurchaseUrl] = useState(initialPart?.purchaseUrl ?? "");
  const [datasheetUrl, setDatasheetUrl] = useState(initialPart?.datasheetUrl ?? "");
  const [memo, setMemo] = useState(initialPart?.memo ?? "");
  const [lowStockThreshold, setLowStockThreshold] = useState(String(initialPart?.lowStockThreshold ?? 0));
  const [attributes, setAttributes] = useState<PartAttribute[]>(initialPart?.attributes ?? [emptyAttribute]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(initialPart?.tags.map((tag) => tag.id) ?? []);
  const [newTags, setNewTags] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>(initialPart?.alternatives?.map((a) => a.text) ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Category attribute definitions
  const [attrDefs, setAttrDefs] = useState<AttributeDefinition[]>([]);
  const [definedValues, setDefinedValues] = useState<Record<string, { value: string; unit: string }>>({});

  useEffect(() => {
    if (!categoryId && categories[0]) setCategoryId(categories[0].id);
  }, [categories, categoryId]);

  // Fetch attribute definitions when category changes
  useEffect(() => {
    let active = true;
    if (!categoryId) {
      setAttrDefs([]);
      setDefinedValues({});
      return () => { active = false; };
    }
    apiClient.listCategoryAttributes(categoryId).then((defs) => {
      if (!active) return;
      setAttrDefs(defs);
      // Initialize defined values from existing part attributes (for edit mode)
      const existingAttrs = initialPart?.attributes ?? [];
      const initial: Record<string, { value: string; unit: string }> = {};
      for (const def of defs) {
        const existing = existingAttrs.find((a) => a.key === def.key);
        initial[def.key] = {
          value: existing?.value ?? "",
          unit: existing?.unit ?? def.unit ?? "",
        };
      }
      setDefinedValues(initial);
    }).catch(() => {
      if (active) setAttrDefs([]);
    });
    return () => { active = false; };
  }, [categoryId, initialPart]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      // Merge defined attribute values with free-form attributes
      const definedAttrs: PartAttribute[] = attrDefs
        .filter((def) => definedValues[def.key]?.value)
        .map((def) => ({
          key: def.key,
          label: def.label,
          value: definedValues[def.key].value,
          unit: definedValues[def.key].unit || def.unit || "",
        }));

      // Free-form attributes (exclude keys already covered by definitions)
      const definedKeys = new Set(attrDefs.map((d) => d.key));
      const freeAttrs = attributes.filter((a) => a.key && a.value && !definedKeys.has(a.key));

      await onSubmit({
        categoryId,
        modelNumber,
        name: name.trim() || modelNumber.trim(),
        description,
        manufacturer,
        footprint,
        stockQuantity: numericValue(stockQuantity),
        price: price.trim() === "" ? null : numericValue(price),
        locationName,
        caseNumber,
        purchaseUrl,
        datasheetUrl,
        memo,
        lowStockThreshold: numericValue(lowStockThreshold),
        statusId: statusId === "" ? null : statusId,
        attributes: [...definedAttrs, ...freeAttrs],
        tagIds: selectedTagIds,
        tagNames: newTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        alternatives: alternatives.map((s) => s.trim()).filter(Boolean),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateAttribute(index: number, patch: Partial<PartAttribute>) {
    setAttributes((current) => current.map((attribute, i) => (i === index ? { ...attribute, ...patch } : attribute)));
  }

  function updateDefinedValue(key: string, patch: Partial<{ value: string; unit: string }>) {
    setDefinedValues((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <Field label="カテゴリ">
          <select className={inputClass} value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="型番">
            <input className={inputClass} value={modelNumber} onChange={(event) => setModelNumber(event.target.value)} required />
          </Field>
          <Field label="部品名">
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="例：抵抗 10kΩ" />
          </Field>
          <Field label="ステータス">
            <select className={inputClass} value={statusId} onChange={(event) => setStatusId(event.target.value ? Number(event.target.value) : "")}>
              <option value="">未設定</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="説明">
          <input className={inputClass} value={description ?? ""} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="メーカー">
            <input className={inputClass} value={manufacturer ?? ""} onChange={(event) => setManufacturer(event.target.value)} />
          </Field>
          <Field label="フットプリント">
            <input className={inputClass} value={footprint ?? ""} onChange={(event) => setFootprint(event.target.value)} />
          </Field>
          <Field label="保管場所">
            <input className={inputClass} value={locationName ?? ""} onChange={(event) => setLocationName(event.target.value)} placeholder="例: 棚A-01" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="在庫数">
            <input className={inputClass} type="number" inputMode="numeric" min={0} value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} placeholder="例: 120" />
          </Field>
          <Field label="価格">
            <input className={inputClass} type="number" inputMode="decimal" min={0} step="0.0001" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="例: 12.3456" />
          </Field>
          <Field label="低在庫しきい値">
            <input className={inputClass} type="number" inputMode="numeric" min={0} value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} placeholder="例: 10" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="購入先URL">
            <input className={inputClass} value={purchaseUrl ?? ""} onChange={(event) => setPurchaseUrl(event.target.value)} />
          </Field>
          <Field label="データシートURL">
            <input className={inputClass} value={datasheetUrl ?? ""} onChange={(event) => setDatasheetUrl(event.target.value)} />
          </Field>
        </div>
        <Field label="ケース番号">
          <input className={inputClass} value={caseNumber ?? ""} onChange={(event) => setCaseNumber(event.target.value)} />
        </Field>
        <Field label="メモ">
          <textarea className={inputClass} rows={4} value={memo} onChange={(event) => setMemo(event.target.value)} />
        </Field>
      </section>

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-950">仕様・電気的特性</h2>

        {attrDefs.length > 0 && (
          <div className="grid gap-2">
            {attrDefs.map((def) => (
              <div key={def.key} className="grid gap-2 sm:grid-cols-3">
                <div className="flex items-center text-sm text-slate-700">
                  <span className="font-medium">{def.label}</span>
                  <span className="ml-1 text-xs text-slate-400">({def.key})</span>
                </div>
                <input
                  className={inputClass}
                  type={def.dataType === "number" ? "number" : "text"}
                  step={def.dataType === "number" ? "any" : undefined}
                  placeholder={`値を入力`}
                  value={definedValues[def.key]?.value ?? ""}
                  onChange={(e) => updateDefinedValue(def.key, { value: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="単位"
                  value={definedValues[def.key]?.unit ?? ""}
                  onChange={(e) => updateDefinedValue(def.key, { unit: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        {attrDefs.length > 0 && attributes.length > 0 && (
          <div className="border-t border-slate-200 pt-3">
            <p className="mb-2 text-xs text-slate-500">追加の特性（自由入力）</p>
          </div>
        )}

        {attributes.map((attribute, index) => (
          <AttributeRow
            key={index}
            attribute={attribute}
            onChange={(patch) => updateAttribute(index, patch)}
            onRemove={() => setAttributes((current) => current.filter((_, i) => i !== index))}
          />
        ))}
        <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={() => setAttributes((current) => [...current, emptyAttribute])}>
          特性を追加
        </button>
      </section>

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-950">タグ</h2>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <label key={tag.id} className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={selectedTagIds.includes(tag.id)}
                onChange={(event) =>
                  setSelectedTagIds((current) =>
                    event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id),
                  )
                }
              />
              {tag.name}
            </label>
          ))}
        </div>
        <Field label="新規タグ（カンマ区切り）">
          <input className={inputClass} value={newTags} onChange={(event) => setNewTags(event.target.value)} />
        </Field>
      </section>

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-950">代替候補</h2>
        <p className="text-xs text-slate-500">替えがきく部品の型番や部品名を入力します。登録済みの部品と一致すると詳細へのリンクを表示します。</p>
        {alternatives.map((value, index) => (
          <AlternativeRow
            key={index}
            value={value}
            currentPartId={initialPart?.id}
            onChange={(next) => setAlternatives((current) => current.map((v, i) => (i === index ? next : v)))}
            onRemove={() => setAlternatives((current) => current.filter((_, i) => i !== index))}
          />
        ))}
        <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={() => setAlternatives((current) => [...current, ""])}>
          候補を追加
        </button>
      </section>

      <button disabled={isSubmitting} className="rounded-md bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-60">
        保存
      </button>
    </form>
  );
}

type AlternativeRowProps = {
  value: string;
  currentPartId?: number;
  onChange: (value: string) => void;
  onRemove: () => void;
};

function AlternativeRow({ value, currentPartId, onChange, onRemove }: AlternativeRowProps) {
  const [matchId, setMatchId] = useState<number | null>(null);

  // デバウンスして既存部品との完全一致（型番/部品名）を探し、リンクを表示する。
  useEffect(() => {
    const text = value.trim();
    if (!text) {
      setMatchId(null);
      return;
    }
    const timer = setTimeout(() => {
      apiClient
        .listParts(new URLSearchParams({ q: text, pageSize: "5", archived: "all" }))
        .then(({ items }) => {
          const hit = items.find((p) => (p.modelNumber === text || p.name === text) && p.id !== currentPartId);
          setMatchId(hit?.id ?? null);
        })
        .catch(() => setMatchId(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [value, currentPartId]);

  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder="型番または部品名"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="rounded-md border px-3" onClick={onRemove}>
          削除
        </button>
      </div>
      {matchId !== null && (
        <p className="text-xs text-slate-500">
          登録済み →{" "}
          <Link to={`/parts/${matchId}`} target="_blank" className="text-app-link underline">
            詳細
          </Link>
        </p>
      )}
    </div>
  );
}

type AttributeRowProps = {
  attribute: PartAttribute;
  onChange: (patch: Partial<PartAttribute>) => void;
  onRemove: () => void;
};

function AttributeRow({ attribute, onChange, onRemove }: AttributeRowProps) {
  const [suggestions, setSuggestions] = useState<{ value: string; unit: string | null; count: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastFetchedKey = useRef("");

  function fetchSuggestions(key: string) {
    if (!key || key === lastFetchedKey.current) {
      if (key) setShowSuggestions(true);
      return;
    }
    lastFetchedKey.current = key;
    apiClient.listAttributeValues(key).then((data) => {
      setSuggestions(data);
      setShowSuggestions(true);
    });
  }

  function selectSuggestion(suggestion: { value: string; unit: string | null }) {
    onChange({ value: suggestion.value, unit: suggestion.unit ?? "" });
    setShowSuggestions(false);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="grid gap-2 sm:grid-cols-3">
      <input className={inputClass} placeholder="項目名（例: 周波数、電圧、インターフェース）" value={attribute.key} onChange={(event) => onChange({ key: event.target.value })} />
      <div className="relative">
        <input
          className={inputClass}
          placeholder="値（例: 2.4、3.3）"
          value={attribute.value}
          onChange={(event) => onChange({ value: event.target.value })}
          onFocus={() => fetchSuggestions(attribute.key)}
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <li key={`${s.value}-${s.unit}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  onClick={() => selectSuggestion(s)}
                >
                  <span>{s.value}{s.unit ? ` ${s.unit}` : ""}</span>
                  <span className="text-xs text-slate-400">{s.count}件</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="単位（例: GHz、V）" value={attribute.unit ?? ""} onChange={(event) => onChange({ unit: event.target.value })} />
        <button type="button" className="rounded-md border px-3" onClick={onRemove}>
          削除
        </button>
      </div>
    </div>
  );
}
