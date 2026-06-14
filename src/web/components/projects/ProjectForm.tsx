import { useMemo, useState } from "react";
import type {
  PartSummary,
  ProjectDetail,
  ProjectWriteInput,
} from "@shared/types";
import { Field, inputClass } from "../ui/Field";
import { formatPrice } from "../../lib/format";
import { PartPickerModal } from "./PartPickerModal";

type ProjectFormProps = {
  parts: PartSummary[];
  initialProject?: ProjectDetail;
  onSubmit: (input: ProjectWriteInput) => Promise<void>;
};

function numericValue(value: string, fallback = 0): number {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ProjectForm({
  parts,
  initialProject,
  onSubmit,
}: ProjectFormProps) {
  const [name, setName] = useState(initialProject?.name ?? "");
  const [description, setDescription] = useState(
    initialProject?.description ?? "",
  );
  const [imageUrl, setImageUrl] = useState(initialProject?.imageUrl ?? "");
  const [referenceUrl, setReferenceUrl] = useState(
    initialProject?.referenceUrl ?? "",
  );
  const [partRows, setPartRows] = useState<
    { partId: number | ""; quantityRequired: string; memo: string }[]
  >(
    initialProject?.parts.map((part) => ({
      partId: part.partId,
      quantityRequired: String(part.quantityRequired),
      memo: part.memo ?? "",
    })) ?? [],
  );
  const [costRows, setCostRows] = useState<
    { name: string; amount: string; memo: string }[]
  >(
    initialProject?.costs.map((cost) => ({
      name: cost.name,
      amount: String(cost.amount),
      memo: cost.memo ?? "",
    })) ?? [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableParts, setAvailableParts] = useState(parts);
  const [isPartPickerOpen, setIsPartPickerOpen] = useState(false);

  function updatePartRow(
    index: number,
    patch: Partial<{
      partId: number | "";
      quantityRequired: string;
      memo: string;
    }>,
  ) {
    setPartRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function updateCostRow(
    index: number,
    patch: Partial<{ name: string; amount: string; memo: string }>,
  ) {
    setCostRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  const selectedPartIds = useMemo(
    () =>
      new Set(
        partRows
          .filter((row) => row.partId !== "")
          .map((row) => Number(row.partId)),
      ),
    [partRows],
  );

  const partsCost = partRows.reduce((sum, row) => {
    if (row.partId === "") return sum;
    const part = availableParts.find((item) => item.id === row.partId);
    return sum + numericValue(row.quantityRequired, 1) * (part?.price ?? 0);
  }, 0);
  const unpricedCount = partRows.filter(
    (row) =>
      row.partId !== "" &&
      availableParts.find((part) => part.id === row.partId)?.price == null,
  ).length;
  const costsTotal = costRows.reduce(
    (sum, row) => sum + numericValue(row.amount, 0),
    0,
  );
  const total = partsCost + costsTotal;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        name,
        description: description.trim() ? description : null,
        imageUrl: imageUrl.trim() ? imageUrl : null,
        referenceUrl: referenceUrl.trim() ? referenceUrl : null,
        parts: partRows
          .filter((row) => row.partId !== "")
          .map((row) => ({
            partId: Number(row.partId),
            quantityRequired: Math.max(
              1,
              Math.trunc(numericValue(row.quantityRequired, 1)),
            ),
            memo: row.memo.trim() || null,
          })),
        costs: costRows
          .filter((row) => row.name.trim() !== "")
          .map((row) => ({
            name: row.name.trim(),
            amount: numericValue(row.amount, 0),
            memo: row.memo.trim() || null,
          })),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <Field label="名前">
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label="説明">
          <textarea
            className={inputClass}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="画像URL">
          <input
            className={inputClass}
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
          />
        </Field>
        <Field label="参考URL">
          <input
            className={inputClass}
            value={referenceUrl}
            onChange={(event) => setReferenceUrl(event.target.value)}
          />
        </Field>
      </section>

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">使用部品</h2>
            <p className="mt-1 text-xs text-slate-500">
              型番や仕様で検索し、情報を確認してから追加できます。
            </p>
          </div>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            onClick={() => setIsPartPickerOpen(true)}
          >
            部品を検索して追加
          </button>
        </div>
        {partRows.length === 0 && (
          <button
            type="button"
            className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 hover:border-slate-500 hover:bg-slate-50"
            onClick={() => setIsPartPickerOpen(true)}
          >
            使用部品はまだありません。クリックして部品を追加してください。
          </button>
        )}
        {partRows.map((row, index) => (
          <SelectedPartRow
            key={`${row.partId}-${index}`}
            part={
              row.partId === ""
                ? undefined
                : availableParts.find((part) => part.id === row.partId)
            }
            quantityRequired={row.quantityRequired}
            memo={row.memo}
            onQuantityChange={(value) =>
              updatePartRow(index, { quantityRequired: value })
            }
            onMemoChange={(value) => updatePartRow(index, { memo: value })}
            onRemove={() =>
              setPartRows((current) => current.filter((_, i) => i !== index))
            }
          />
        ))}
      </section>

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-950">費用(加工代・その他)</h2>
        {costRows.map((row, index) => (
          <div key={index} className="flex flex-wrap gap-2 items-start">
            <input
              className={inputClass}
              value={row.name}
              onChange={(event) =>
                updateCostRow(index, { name: event.target.value })
              }
              placeholder="名前"
            />
            <input
              type="number"
              min="0"
              className={inputClass}
              value={row.amount}
              onChange={(event) =>
                updateCostRow(index, { amount: event.target.value })
              }
            />
            <input
              className={inputClass}
              value={row.memo}
              onChange={(event) =>
                updateCostRow(index, { memo: event.target.value })
              }
              placeholder="メモ"
            />
            <button
              type="button"
              className="rounded-md border px-3"
              onClick={() =>
                setCostRows((current) => current.filter((_, i) => i !== index))
              }
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          onClick={() =>
            setCostRows((current) => [
              ...current,
              { name: "", amount: "0", memo: "" },
            ])
          }
        >
          費用を追加
        </button>
      </section>

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <div className="flex justify-between text-sm">
          <span>部品代</span>
          <span>{formatPrice(partsCost)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>費用</span>
          <span>{formatPrice(costsTotal)}</span>
        </div>
        <div className="flex justify-between font-semibold text-slate-950">
          <span>総合金額</span>
          <span>{formatPrice(total)}</span>
        </div>
        {unpricedCount > 0 && (
          <p className="text-xs text-app-danger">
            価格未設定の部品が{unpricedCount}件あります(0円として計算)。
          </p>
        )}
      </section>

      <button
        disabled={isSubmitting}
        className="rounded-md bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-60"
      >
        保存
      </button>

      {isPartPickerOpen && (
        <PartPickerModal
          initialParts={availableParts}
          selectedIds={selectedPartIds}
          onClose={() => setIsPartPickerOpen(false)}
          onAdd={(part) => {
            setAvailableParts((current) =>
              current.some((item) => item.id === part.id)
                ? current
                : [...current, part],
            );
            setPartRows((current) =>
              current.some((row) => row.partId === part.id)
                ? current
                : [
                    ...current,
                    { partId: part.id, quantityRequired: "1", memo: "" },
                  ],
            );
          }}
        />
      )}
    </form>
  );
}

function SelectedPartRow({
  part,
  quantityRequired,
  memo,
  onQuantityChange,
  onMemoChange,
  onRemove,
}: {
  part?: PartSummary;
  quantityRequired: string;
  memo: string;
  onQuantityChange: (value: string) => void;
  onMemoChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_110px_minmax(160px,0.7fr)_auto] sm:items-end">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-950">
          {part?.modelNumber ?? "部品情報を取得できません"}
        </p>
        <p className="truncate text-sm text-slate-600">{part?.name ?? ""}</p>
        {part && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{part.categoryName}</span>
            <span>在庫 {part.stockQuantity}</span>
            <span>{part.price == null ? "単価未設定" : `単価 ${formatPrice(part.price)}`}</span>
          </div>
        )}
      </div>
      <label className="grid gap-1">
        <span className="text-xs font-medium text-slate-600">必要数</span>
        <input
          type="number"
          min="1"
          className={inputClass}
          value={quantityRequired}
          onChange={(event) => onQuantityChange(event.target.value)}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs font-medium text-slate-600">メモ</span>
        <input
          className={inputClass}
          value={memo}
          onChange={(event) => onMemoChange(event.target.value)}
          placeholder="用途など"
        />
      </label>
      <button
        type="button"
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        onClick={onRemove}
      >
        削除
      </button>
    </div>
  );
}
