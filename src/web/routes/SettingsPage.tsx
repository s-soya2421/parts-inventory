import { Link } from "react-router-dom";
import { useState } from "react";

export function SettingsPage() {
  const [pageSize, setPageSize] = useState(localStorage.getItem("parts_page_size") ?? "50");
  const [message, setMessage] = useState("");

  function savePreferences() {
    localStorage.setItem("parts_page_size", pageSize);
    setMessage("表示設定を保存しました");
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="panel-card p-4 lg:col-span-2">
        <h1 className="text-base font-semibold text-slate-950">設定</h1>
        <p className="mt-1 text-xs text-slate-500">表示密度、一覧の既定値、入出力導線を設定します。</p>
      </section>

      <section className="panel-card grid gap-3 p-4">
        <h2 className="text-sm font-semibold">表示設定</h2>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          一覧の標準表示件数
          <select className="rounded border border-slate-300 px-3 py-2 text-sm" value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
            <option value="25">25件</option>
            <option value="50">50件</option>
            <option value="100">100件</option>
            <option value="200">200件</option>
          </select>
        </label>
        <button className="btn btn-primary justify-self-start" onClick={savePreferences}>保存</button>
      </section>

      <section className="panel-card grid gap-3 p-4">
        <h2 className="text-sm font-semibold">サポート</h2>
        <p className="text-xs leading-5 text-slate-500">不具合を見つけた場合は、再現手順を添えて報告できます。</p>
        <Link className="btn justify-self-start" to="/bug-report">不具合を報告</Link>
      </section>

      <section className="panel-card grid gap-3 p-4">
        <h2 className="text-sm font-semibold">データ入出力</h2>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" to="/import">JSONインポート</Link>
          <Link className="btn" to="/export">CSV/Excelエクスポート</Link>
        </div>
        <p className="text-xs leading-5 text-slate-500">カテゴリやタグの管理は、それぞれ専用ページへ移動しました。</p>
      </section>

      <section className="panel-card grid gap-3 p-4">
        <h2 className="text-sm font-semibold">マスタ管理</h2>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" to="/categories">カテゴリ・タグ</Link>
          <Link className="btn" to="/statuses">ステータス</Link>
        </div>
      </section>

      {message && <p className="rounded bg-app-soft p-3 text-sm text-app-link lg:col-span-2">{message}</p>}
    </div>
  );
}
