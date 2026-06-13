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
          <div className="overflow-auto">
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
        )}
      </section>
    </div>
  );
}
