import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectSummary } from "@shared/types";
import { Loading } from "../components/ui/Loading";
import { apiClient } from "../lib/api-client";
import { formatDate, formatPrice } from "../lib/format";

export function ProjectsListPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    apiClient.listProjects()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : "プロジェクトの読み込みに失敗しました"))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  if (isLoading) return <Loading />;

  return (
    <div className="grid gap-3">
      <section className="panel-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-950">プロジェクト</h1>
            <p className="mt-1 text-xs text-slate-500">プロジェクトごとの使用部品と費用を管理します。</p>
          </div>
          <Link to="/projects/new" className="btn btn-primary">新規作成</Link>
        </div>
      </section>

      {error && <p className="rounded bg-app-soft p-2 text-xs text-app-danger">{error}</p>}

      <section className="panel-card min-w-0 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">一覧</h2>
          <span className="text-xs text-slate-500">{projects.length}件</span>
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-slate-500">プロジェクトがありません。</p>
        ) : (
          <>
            <div className="hidden overflow-auto md:block">
              <table className="dense-table w-full min-w-[720px]">
                <thead><tr><th>名前</th><th>説明</th><th>部品点数</th><th>費用点数</th><th>総額</th><th>更新日時</th></tr></thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td><Link to={`/projects/${p.id}`} className="text-app-link hover:underline font-medium">{p.name}</Link></td>
                      <td className="max-w-[280px] truncate">{p.description || "-"}</td>
                      <td>{p.partsCount}</td>
                      <td>{p.costsCount}</td>
                      <td>
                        {formatPrice(p.total)}
                        {p.unpricedCount > 0 && <span className="block text-xs text-app-danger">価格未設定{p.unpricedCount}件</span>}
                      </td>
                      <td>{formatDate(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2 md:hidden">
              {projects.map((p) => (
                <article key={p.id} className="rounded-md border border-slate-200 bg-white p-3">
                  <Link to={`/projects/${p.id}`} className="block text-base font-semibold text-app-link hover:underline">{p.name}</Link>
                  {p.description && <p className="mt-1 truncate text-xs text-slate-500">{p.description}</p>}
                  <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
                    <div className="min-w-0">
                      <dt className="text-slate-500">部品点数</dt>
                      <dd className="mt-0.5 text-slate-900">{p.partsCount}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-slate-500">費用点数</dt>
                      <dd className="mt-0.5 text-slate-900">{p.costsCount}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-slate-500">総額</dt>
                      <dd className="mt-0.5 text-slate-900">
                        {formatPrice(p.total)}
                        {p.unpricedCount > 0 && <span className="block text-app-danger">価格未設定{p.unpricedCount}件</span>}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-slate-500">更新日時</dt>
                      <dd className="mt-0.5 text-slate-900">{formatDate(p.updatedAt)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link className="btn" to={`/projects/${p.id}`}>詳細</Link>
                    <Link className="btn" to={`/projects/${p.id}/edit`}>編集</Link>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
