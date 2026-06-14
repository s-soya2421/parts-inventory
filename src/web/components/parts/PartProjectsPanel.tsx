import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectSummary } from "@shared/types";
import { apiClient } from "../../lib/api-client";
import { formatPrice } from "../../lib/format";
import { inputClass } from "../ui/Field";

export function PartProjectsPanel({ partId }: { partId: number }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [linkedProjects, setLinkedProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [quantityRequired, setQuantityRequired] = useState("1");
  const [memo, setMemo] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [all, linked] = await Promise.all([
        apiClient.listProjects(),
        apiClient.listProjects(partId),
      ]);
      setProjects(all);
      setLinkedProjects(linked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "プロジェクトの読み込みに失敗しました。");
    }
  }, [partId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const linkedIds = useMemo(
    () => new Set(linkedProjects.map((project) => project.id)),
    [linkedProjects],
  );
  const candidates = projects.filter((project) => !linkedIds.has(project.id));

  async function addToProject(event: React.FormEvent) {
    event.preventDefault();
    if (projectId === "") return;
    setIsSaving(true);
    setError("");
    try {
      await apiClient.addPartToProject(projectId, {
        partId,
        quantityRequired: Math.max(1, Math.trunc(Number(quantityRequired) || 1)),
        memo: memo.trim() || null,
      });
      setProjectId("");
      setQuantityRequired("1");
      setMemo("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "プロジェクトへの追加に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="panel-card p-3 sm:p-4 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">関連プロジェクト</h2>
          <p className="mt-1 text-xs text-slate-500">この部品を使用しているプロジェクトです。</p>
        </div>
        <Link to="/projects/new" className="btn">新規プロジェクト</Link>
      </div>

      {linkedProjects.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {linkedProjects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-slate-400"
            >
              <p className="font-medium text-slate-950">{project.name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                {project.description || "説明なし"}
              </p>
              <div className="mt-2 flex gap-3 text-xs text-slate-500">
                <span>部品 {project.partsCount}件</span>
                <span>{formatPrice(project.total)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          この部品に紐づくプロジェクトはありません。
        </p>
      )}

      <form onSubmit={addToProject} className="mt-4 grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(180px,1fr)_100px_minmax(160px,1fr)_auto] sm:items-end">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-slate-600">既存プロジェクトに追加</span>
          <select
            className={inputClass}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value ? Number(event.target.value) : "")}
          >
            <option value="">プロジェクトを選択</option>
            {candidates.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-slate-600">必要数</span>
          <input className={inputClass} type="number" min="1" value={quantityRequired} onChange={(event) => setQuantityRequired(event.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-slate-600">メモ</span>
          <input className={inputClass} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="用途など" />
        </label>
        <button
          disabled={projectId === "" || isSaving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSaving ? "追加中..." : "追加"}
        </button>
      </form>
      {candidates.length === 0 && projects.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">すべてのプロジェクトに紐づいています。</p>
      )}
      {error && <p className="mt-2 text-sm text-app-danger">{error}</p>}
    </section>
  );
}
