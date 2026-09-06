import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Category, PartSummary, Tag } from "@shared/types";
import { Loading } from "../components/ui/Loading";
import { apiClient, ApiError } from "../lib/api-client";
import { formatDate } from "../lib/format";

export function CategoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "tags" ? "tags" : "categories";

  function switchTab(tab: "categories" | "tags") {
    const next = new URLSearchParams();
    if (tab === "tags") next.set("tab", "tags");
    setSearchParams(next);
  }

  return (
    <div className="grid gap-3">
      <section className="panel-card p-4">
        <h1 className="text-lg font-bold text-slate-950">カテゴリ・タグ</h1>
        <p className="mt-1 text-xs text-slate-500">部品の分類カテゴリとタグを管理します。</p>
        <div className="mt-3 flex gap-1">
          <button
            className={`rounded px-3 py-1.5 text-xs font-medium ${activeTab === "categories" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            onClick={() => switchTab("categories")}
          >
            カテゴリ
          </button>
          <button
            className={`rounded px-3 py-1.5 text-xs font-medium ${activeTab === "tags" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            onClick={() => switchTab("tags")}
          >
            タグ
          </button>
        </div>
      </section>

      {activeTab === "categories" ? <CategoryTab /> : <TagTab />}
    </div>
  );
}

function CategoryTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    apiClient.listCategories().then(setCategories);
  }

  useEffect(() => {
    apiClient.listCategories().then(setCategories).finally(() => setIsLoading(false));
  }, []);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiClient.createCategory({ name: categoryName });
      setCategoryName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "カテゴリの追加に失敗しました");
    }
  }

  async function updateCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setError("");
    try {
      await apiClient.updateCategory(editingId, { name: editingName });
      setEditingId(null);
      setEditingName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "カテゴリの更新に失敗しました");
    }
  }

  function startEditing(category: Category) {
    setEditingId(category.id);
    setEditingName(category.name);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  async function deleteCategory(category: Category) {
    if (!confirm(`${category.name} を削除しますか？`)) return;
    setError("");
    try {
      await apiClient.deleteCategory(category.id);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "CATEGORY_HAS_ARCHIVED_PARTS") {
        const details = err.details as { archivedParts?: { name: string; modelNumber: string }[] } | undefined;
        const parts = details?.archivedParts ?? [];
        const list = parts.map((p) => `・${p.name}（${p.modelNumber}）`).join("\n");
        const ok = confirm(
          `「${category.name}」には以下のアーカイブ済み部品が残っています。\nカテゴリと一緒に完全に削除されます。元に戻せません。\n\n${list}\n\n削除してよろしいですか？`,
        );
        if (!ok) return;
        try {
          await apiClient.deleteCategory(category.id, { force: true });
          load();
        } catch (forceErr) {
          setError(forceErr instanceof Error ? forceErr.message : "カテゴリの削除に失敗しました");
        }
        return;
      }
      setError(err instanceof Error ? err.message : "カテゴリの削除に失敗しました");
    }
  }

  if (isLoading) return <Loading />;

  return (
    <section className="panel-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{editingId ? "カテゴリ名を編集" : "カテゴリ一覧"}</h2>
      </div>
      <form onSubmit={editingId ? updateCategory : addCategory} className={`mb-6 grid gap-2 sm:grid-cols-[1fr_auto_auto] p-3 rounded-lg ${editingId ? "bg-amber-50 border border-amber-200" : ""}`}>
        <input
          ref={inputRef}
          className="min-w-0 rounded border border-slate-300 px-3 py-2 text-sm focus:border-app-link focus:outline-none focus:ring-1 focus:ring-app-link"
          value={editingId ? editingName : categoryName}
          onChange={(event) => editingId ? setEditingName(event.target.value) : setCategoryName(event.target.value)}
          placeholder="カテゴリ名を入力..."
          required
        />
        <button className="btn btn-primary h-[38px] px-4">{editingId ? "更新" : "カテゴリを追加"}</button>
        {editingId && <button type="button" className="btn h-[38px] px-4" onClick={() => { setEditingId(null); setEditingName(""); }}>キャンセル</button>}
      </form>
      {error && <p className="mb-4 rounded bg-app-soft p-2 text-xs text-app-danger border border-app">{error}</p>}
      <div className="overflow-auto rounded-lg border border-slate-200">
        <table className="dense-table w-full min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left">カテゴリ名</th>
              <th>登録部品数</th>
              <th>在庫状況</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id} className="hover:bg-slate-50 transition-colors">
                <td className="font-semibold text-slate-900">{category.name}</td>
                <td className="text-center font-medium text-slate-600">{category.partCount ?? 0}</td>
                <td>
                  <div className="flex flex-col gap-0.5 text-[11px]">
                    <span className={category.outOfStockCount ? "text-app-danger font-bold" : "text-slate-400"}>在庫切れ: {category.outOfStockCount ?? 0}</span>
                    <span className={category.lowStockCount ? "text-app-link font-bold" : "text-slate-400"}>低在庫: {category.lowStockCount ?? 0}</span>
                  </div>
                </td>
                <td>
                  <div className="flex justify-end gap-3 text-sm">
                    <Link className="flex items-center gap-1 font-medium text-app-link hover:underline" to={`/categories/${category.id}/settings`}>
                      <span>⚙</span><span>設定</span>
                    </Link>
                    <button className="font-medium text-app-danger hover:underline" onClick={() => deleteCategory(category)}>削除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TagTab() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagName, setTagName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");

  function load() {
    apiClient.listTags().then(setTags);
  }

  useEffect(load, []);

  async function addTag(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiClient.createTag({ name: tagName });
      setTagName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "タグの追加に失敗しました");
    }
  }

  async function updateTag(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setError("");
    try {
      await apiClient.updateTag(editingId, { name: editingName });
      setEditingId(null);
      setEditingName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "タグの更新に失敗しました");
    }
  }

  async function deleteTag(tag: Tag) {
    if (!confirm(`${tag.name} を削除しますか？`)) return;
    setError("");
    try {
      await apiClient.deleteTag(tag.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "タグの削除に失敗しました");
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="panel-card p-4">
        <h2 className="text-sm font-semibold">タグ追加</h2>
        <p className="mt-1 text-xs text-slate-500">よく使う部品、発注候補、用途などのラベルを管理します。</p>
        <form onSubmit={editingId ? updateTag : addTag} className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            タグ名
            <input
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={editingId ? editingName : tagName}
              onChange={(event) => editingId ? setEditingName(event.target.value) : setTagName(event.target.value)}
              required
            />
          </label>
          {error && <p className="rounded bg-app-soft p-2 text-xs text-app-danger">{error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary">{editingId ? "更新" : "追加"}</button>
            {editingId && <button type="button" className="btn" onClick={() => { setEditingId(null); setEditingName(""); }}>キャンセル</button>}
          </div>
        </form>
      </section>

      <section className="panel-card min-w-0 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">登録済みタグ</h2>
          <span className="text-xs text-slate-500">{tags.length}件</span>
        </div>
        <div className="overflow-auto">
          <table className="dense-table w-full min-w-[560px]">
            <thead><tr><th>タグ名</th><th>slug</th><th>作成日時</th><th>操作</th></tr></thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id}>
                  <td className="font-medium">{tag.name}</td>
                  <td className="font-mono text-xs">{tag.slug}</td>
                  <td>{formatDate(tag.createdAt)}</td>
                  <td>
                    <div className="flex gap-2">
                      <button className="text-app-link hover:underline" onClick={() => { setEditingId(tag.id); setEditingName(tag.name); }}>編集</button>
                      <button className="text-app-danger hover:underline" onClick={() => deleteTag(tag)}>削除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
