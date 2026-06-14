import { useState } from "react";
import type {
  PartSummary,
  ProjectDetail,
  ProjectWriteInput,
} from "@shared/types";
import { Field, inputClass } from "../ui/Field";
import { formatPrice } from "../../lib/format";

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

  const partsCost = partRows.reduce((sum, row) => {
    if (row.partId === "") return sum;
    const part = parts.find((item) => item.id === row.partId);
    return sum + numericValue(row.quantityRequired, 1) * (part?.price ?? 0);
  }, 0);
  const unpricedCount = partRows.filter(
    (row) =>
      row.partId !== "" &&
      parts.find((part) => part.id === row.partId)?.price == null,
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
        <h2 className="font-semibold text-slate-950">使用部品</h2>
        {partRows.map((row, index) => (
          <div key={index} className="flex flex-wrap gap-2 items-start">
            <select
              className={inputClass}
              value={row.partId}
              onChange={(event) =>
                updatePartRow(index, {
                  partId:
                    event.target.value === "" ? "" : Number(event.target.value),
                })
              }
            >
              <option value="">部品を選択</option>
              {parts.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.modelNumber}（{part.name}）
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              className={inputClass}
              value={row.quantityRequired}
              onChange={(event) =>
                updatePartRow(index, { quantityRequired: event.target.value })
              }
            />
            <input
              className={inputClass}
              value={row.memo}
              onChange={(event) =>
                updatePartRow(index, { memo: event.target.value })
              }
              placeholder="メモ"
            />
            <button
              type="button"
              className="rounded-md border px-3"
              onClick={() =>
                setPartRows((current) => current.filter((_, i) => i !== index))
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
            setPartRows((current) => [
              ...current,
              { partId: "", quantityRequired: "1", memo: "" },
            ])
          }
        >
          部品を追加
        </button>
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
    </form>
  );
}
