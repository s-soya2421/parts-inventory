import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PartDetail } from "@shared/types";
import { StockAdjuster } from "../components/parts/StockAdjuster";
import { PartProjectsPanel } from "../components/parts/PartProjectsPanel";
import { Skeleton } from "../components/ui/Skeleton";
import { apiClient } from "../lib/api-client";
import { formatDate, formatPrice } from "../lib/format";

export function PartDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [part, setPart] = useState<PartDetail | null>(null);
  const [error, setError] = useState("");

  function load() {
    apiClient.getPart(id)
      .then(setPart)
      .catch((err) => setError(err instanceof Error ? err.message : "データの読み込みに失敗しました。"));
  }

  useEffect(load, [id]);

  if (error) return <div className="p-4 text-app-danger">{error}</div>;
  if (!part) return <PartDetailSkeleton />;

  async function archivePart() {
    if (!part || !confirm(`${part.modelNumber} をアーカイブしますか？`)) return;
    try {
      await apiClient.deletePart(part.id);
      navigate("/parts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "アーカイブに失敗しました。");
    }
  }

  async function restorePart() {
    if (!part) return;
    try {
      await apiClient.restorePart(part.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "復元に失敗しました。");
    }
  }

  async function permanentlyDeletePart() {
    if (!part || !confirm(`${part.modelNumber} を完全に削除しますか？この操作は元に戻せません。`)) return;
    try {
      await apiClient.permanentlyDeletePart(part.id);
      navigate("/parts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました。");
    }
  }

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="panel-card p-3 sm:p-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div className="min-w-0">
            <Link to={`/parts?categoryId=${part.categoryId}`} className="text-xs text-app-link hover:underline">{part.categoryName}</Link>
            <h1 className="break-words text-xl font-semibold text-slate-950 sm:text-2xl">{part.modelNumber}</h1>
            <p className="mt-1 max-w-3xl break-words text-sm text-slate-500">{part.description}</p>
          </div>
          <div className="flex w-full flex-wrap gap-1 sm:w-auto sm:justify-end">
            <Link to="/parts" className="btn">一覧へ戻る</Link>
            <Link to={`/parts/${part.id}/edit`} className="btn btn-primary">編集</Link>
            {part.archivedAt ? (
              <>
                <button className="btn" onClick={restorePart}>復元</button>
                <button className="btn text-app-danger" onClick={permanentlyDeletePart}>完全削除</button>
              </>
            ) : (
              <button className="btn text-app-danger" onClick={archivePart}>削除</button>
            )}
          </div>
        </div>

        {error && <div className="mt-3 rounded border border-app bg-app-soft px-3 py-2 text-sm text-app-danger">{error}</div>}

        <dl className="mt-4 grid min-w-0 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">状態</dt><dd>{part.archivedAt ? `アーカイブ済み（${formatDate(part.archivedAt)}）` : "有効"}</dd></div>
          <div>
            <dt className="text-slate-500">ステータス</dt>
            <dd>
              {part.status ? (
                <Link to={`/parts?statusId=${part.status.id}`} className="inline-flex items-center gap-1.5 text-app-link hover:underline">
                  <span className="size-2 rounded-full" style={{ backgroundColor: part.status.color }} />
                  {part.status.name}
                </Link>
              ) : (
                "-"
              )}
            </dd>
          </div>
          <div><dt className="text-slate-500">部品名</dt><dd className="break-words">{part.name && part.name !== part.modelNumber ? part.name : "-"}</dd></div>
          <div><dt className="text-slate-500">メーカー</dt><dd className="break-words">{part.manufacturer ? <Link to={`/parts?manufacturer=${encodeURIComponent(part.manufacturer)}`} className="text-app-link hover:underline">{part.manufacturer}</Link> : "-"}</dd></div>
          <div><dt className="text-slate-500">フットプリント</dt><dd className="break-words">{part.footprint || "-"}</dd></div>
          <div><dt className="text-slate-500">在庫</dt><dd className="font-semibold">{part.stockQuantity}</dd></div>
          <div><dt className="text-slate-500">最低在庫数</dt><dd>{part.lowStockThreshold}</dd></div>
          <div><dt className="text-slate-500">保管場所</dt><dd className="break-words">
            {part.locationId && part.locationName ? (
              <Link to={`/parts?locationId=${part.locationId}`} className="text-app-link hover:underline">{part.locationName}</Link>
            ) : (part.locationName || null)}
            {part.caseNumber ? `${part.locationName ? " / " : ""}${part.caseNumber}` : ""}
            {!part.locationName && !part.caseNumber ? "-" : ""}
          </dd></div>
          <div><dt className="text-slate-500">保管場所コード</dt><dd className="break-words">{part.locationCode || "-"}</dd></div>
          <div><dt className="text-slate-500">単価</dt><dd>{formatPrice(part.price)}</dd></div>
          <div><dt className="text-slate-500">更新日時</dt><dd className="break-words">{formatDate(part.updatedAt)}</dd></div>
          <div><dt className="text-slate-500">作成日時</dt><dd className="break-words">{formatDate(part.createdAt)}</dd></div>
          <div><dt className="text-slate-500">購入先URL</dt><dd>{part.purchaseUrl ? <a className="text-app-link underline" href={part.purchaseUrl}>開く</a> : "-"}</dd></div>
          <div><dt className="text-slate-500">データシートURL</dt><dd>{part.datasheetUrl ? <a className="text-app-link underline" href={part.datasheetUrl}>開く</a> : "-"}</dd></div>
        </dl>
      </section>

      <aside className="grid min-w-0 content-start gap-3">
        <StockAdjuster partId={part.id} onChanged={load} />
        <section className="panel-card p-3">
          <h2 className="mb-2 text-sm font-semibold">メモ</h2>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{part.memo || "メモなし"}</p>
        </section>
        <section className="panel-card p-3">
          <h2 className="mb-2 text-sm font-semibold">タグ</h2>
          {part.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {part.tags.map((tag) => (
                <span key={tag.id} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{tag.name}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">タグなし</p>
          )}
        </section>
        <section className="panel-card p-3">
          <h2 className="mb-2 text-sm font-semibold">代替候補</h2>
          {part.alternatives.length > 0 ? (
            <ul className="grid gap-1.5 text-sm">
              {part.alternatives.map((alt, index) => (
                <li key={`${alt.text}-${index}`} className="break-words">
                  {alt.linkedPartId ? (
                    <Link to={`/parts/${alt.linkedPartId}`} className="text-app-link hover:underline">{alt.text}</Link>
                  ) : (
                    <span className="text-slate-700">{alt.text}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">なし</p>
          )}
        </section>
      </aside>

      <PartProjectsPanel partId={part.id} />

      <section className="panel-card p-3 sm:p-4 lg:col-span-2">
        <h2 className="mb-3 text-sm font-semibold">仕様一覧</h2>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {part.attributes?.map((attribute) => (
            <div key={attribute.key} className="min-w-0 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
              <span className="break-words text-xs text-slate-500">{attribute.label || attribute.key}</span>
              <div className="break-words font-medium">{attribute.value} {attribute.unit}</div>
            </div>
          ))}
          {(!part.attributes || part.attributes.length === 0) && (
            <p className="text-sm text-slate-500 sm:col-span-3 lg:col-span-5">仕様なし</p>
          )}
        </div>
      </section>

      <section className="panel-card p-3 sm:p-4 lg:col-span-2">
        <h2 className="mb-3 text-sm font-semibold">在庫変動履歴</h2>
        <div className="overflow-auto">
          <table className="dense-table w-full min-w-[760px]">
            <thead><tr><th>作成日時</th><th>操作種別</th><th>変更前</th><th>変更数量</th><th>変更後</th><th>理由</th><th>メモ</th></tr></thead>
            <tbody>
              {part.movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.createdAt)}</td>
                  <td>{movement.movementType}</td>
                  <td>{movement.quantityBefore}</td>
                  <td>{movement.quantityDelta}</td>
                  <td>{movement.quantityAfter}</td>
                  <td>{movement.reason || "-"}</td>
                  <td>{movement.memo || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// 詳細本体と同じグリッド・高さで領域を予約し、読み込み時のシフトを抑える。
function PartDetailSkeleton() {
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="panel-card p-3 sm:p-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex w-full flex-wrap gap-1 sm:w-auto sm:justify-end">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
          </div>
        </div>
        <dl className="mt-4 grid min-w-0 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </dl>
      </section>

      <aside className="grid min-w-0 content-start gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <section key={index} className="panel-card space-y-2 p-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </section>
        ))}
      </aside>

      <section className="panel-card p-3 sm:p-4 lg:col-span-2">
        <Skeleton className="mb-3 h-4 w-24" />
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-1 rounded border border-slate-200 bg-slate-50 p-3">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
