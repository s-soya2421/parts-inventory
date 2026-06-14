import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ProjectDetail } from "@shared/types";
import { Loading } from "../components/ui/Loading";
import { apiClient } from "../lib/api-client";
import { formatDate, formatPrice } from "../lib/format";

export function ProjectDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");

  function load() {
    apiClient.getProject(id)
      .then(setProject)
      .catch((err) => setError(err instanceof Error ? err.message : "データの読み込みに失敗しました。"));
  }

  useEffect(load, [id]);

  if (error) return <div className="p-4 text-app-danger">{error}</div>;
  if (!project) return <Loading />;

  async function removeProject() {
    if (!project || !confirm(`${project.name} を削除しますか？この操作は元に戻せません。`)) return;
    try {
      await apiClient.deleteProject(project.id);
      navigate("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました。");
    }
  }

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-3">
        <section className="panel-card p-3 sm:p-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
            <div className="min-w-0">
              <h1 className="break-words text-xl font-semibold text-slate-950 sm:text-2xl">{project.name}</h1>
              {project.description && <p className="mt-1 max-w-3xl break-words text-sm text-slate-500">{project.description}</p>}
            </div>
            <div className="flex w-full flex-wrap gap-1 sm:w-auto sm:justify-end">
              <Link to="/projects" className="btn">一覧へ戻る</Link>
              <Link to={`/projects/${project.id}/edit`} className="btn btn-primary">編集</Link>
              <button className="btn text-app-danger" onClick={removeProject}>削除</button>
            </div>
          </div>

          {error && <div className="mt-3 rounded border border-app bg-app-soft px-3 py-2 text-sm text-app-danger">{error}</div>}
        </section>

        <section className="panel-card p-3 sm:p-4">
          <h2 className="mb-3 text-sm font-semibold">使用部品</h2>
          {project.parts.length === 0 ? (
            <p className="text-sm text-slate-500">部品が登録されていません。</p>
          ) : (
            <div className="overflow-auto">
              <table className="dense-table w-full min-w-[760px]">
                <thead><tr><th>型番</th><th>部品名</th><th>カテゴリ</th><th>数量</th><th>単価</th><th>小計</th><th>メモ</th></tr></thead>
                <tbody>
                  {project.parts.map((line) => (
                    <tr key={line.id}>
                      <td><Link to={`/parts/${line.partId}`} className="text-app-link hover:underline">{line.modelNumber}</Link></td>
                      <td>{line.name}</td>
                      <td>{line.categoryName ?? "-"}</td>
                      <td>{line.quantityRequired}</td>
                      <td>{line.price == null ? <span className="text-app-danger">未設定</span> : formatPrice(line.price)}</td>
                      <td>{formatPrice(line.lineTotal)}</td>
                      <td>{line.memo || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel-card p-3 sm:p-4">
          <h2 className="mb-3 text-sm font-semibold">費用（加工代・その他）</h2>
          {project.costs.length === 0 ? (
            <p className="text-sm text-slate-500">費用行がありません。</p>
          ) : (
            <div className="overflow-auto">
              <table className="dense-table w-full min-w-[480px]">
                <thead><tr><th>名前</th><th>金額</th><th>メモ</th></tr></thead>
                <tbody>
                  {project.costs.map((cost) => (
                    <tr key={cost.id}>
                      <td>{cost.name}</td>
                      <td>{formatPrice(cost.amount)}</td>
                      <td>{cost.memo || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="grid min-w-0 content-start gap-3">
        <section className="panel-card p-3">
          <h2 className="mb-2 text-sm font-semibold">金額サマリ</h2>
          <dl className="grid gap-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">部品代</dt><dd>{formatPrice(project.totals.partsCost)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">費用</dt><dd>{formatPrice(project.totals.costsTotal)}</dd></div>
            <div className="my-2 border-t border-slate-200" />
            <div className="flex items-center justify-between"><dt className="font-semibold">総合金額</dt><dd className="text-lg font-bold">{formatPrice(project.totals.total)}</dd></div>
          </dl>
          {project.totals.unpricedCount > 0 && <p className="mt-2 text-xs text-app-danger">価格未設定の部品が{project.totals.unpricedCount}件あります（0円として計算）。</p>}
        </section>

        {(project.imageUrl || project.referenceUrl) && (
          <section className="panel-card p-3">
            <h2 className="mb-2 text-sm font-semibold">参考情報</h2>
            {project.imageUrl && <img src={project.imageUrl} alt="" className="w-full rounded border border-slate-200 object-contain" />}
            {project.referenceUrl && <a className="mt-2 block text-app-link underline" href={project.referenceUrl}>参考リンクを開く</a>}
          </section>
        )}

        <section className="panel-card p-3">
          <dl className="grid gap-2 text-sm">
            <div><dt className="text-slate-500">作成日時</dt><dd>{formatDate(project.createdAt)}</dd></div>
            <div><dt className="text-slate-500">更新日時</dt><dd>{formatDate(project.updatedAt)}</dd></div>
          </dl>
        </section>
      </aside>
    </div>
  );
}
