import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { THEME_PALETTES, applyMode, applyPalette, getStoredMode, getStoredPalette, type ThemeMode, type ThemePalette } from "../../lib/theme";

const navItems = [
  { to: "/parts", label: "在庫一覧" },
  { to: "/find", label: "カテゴリ一覧/電気的特性" },
  { to: "/analytics", label: "統計・分析" },
  { to: "/projects", label: "プロジェクト" },
  { to: "/parts/new", label: "新規作成" },
  { to: "/parts?stockStatus=low_stock", label: "低在庫アラート" },
  { to: "/settings", label: "設定" },
];

const settingsItems = [
  { to: "/categories", label: "カテゴリ・タグ管理" },
  { to: "/import", label: "JSONインポート" },
  { to: "/export", label: "エクスポート" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  function isNavActive(to: string) {
    const [path, query = ""] = to.split("?");
    const currentParams = new URLSearchParams(location.search);

    if (query) {
      // クエリ付きリンク（例: 低在庫アラート）はパスとクエリの両方が一致したときだけアクティブ
      if (location.pathname !== path) return false;
      for (const [key, value] of new URLSearchParams(query)) {
        if (currentParams.get(key) !== value) return false;
      }
      return true;
    }

    // 在庫一覧(/parts)は低在庫アラート(/parts?stockStatus=...)と区別する
    if (path === "/parts") {
      return location.pathname === "/parts" && !currentParams.has("stockStatus");
    }

    // それ以外は完全一致のみ（親パスでは光らせない）
    return location.pathname === path;
  }
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  function submitSearch() {
    const query = searchValue.trim();
    setIsSearchOpen(false);
    setSearchValue("");
    navigate(query ? `/parts?q=${encodeURIComponent(query)}` : "/parts");
  }
  const [theme, setTheme] = useState<ThemeMode>(getStoredMode);
  const [palette, setPalette] = useState<ThemePalette>(getStoredPalette);
  const [isThemeOpen, setIsThemeOpen] = useState(false);

  useEffect(() => {
    applyMode(theme);
  }, [theme]);

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="fixed left-0 right-0 top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-11 items-center justify-between gap-2 px-6 md:px-12 lg:px-16">
          <div className="flex min-w-0 items-center gap-4">
            <Link to="/parts" className="flex min-w-0 items-center gap-2 font-semibold text-slate-950">
              <img src="/favicon.ico" alt="Logo" className="h-5 w-5 object-contain" />
              <span className="truncate">電子部品台帳</span>
            </Link>
            <nav className="hidden items-center gap-1 overflow-x-auto lg:flex">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={[
                    "whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium",
                    isNavActive(item.to) ? "nav-active" : "text-slate-600 hover:bg-slate-100",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-slate-500">
            <button className="toolbar-icon lg:hidden" title="メニュー" aria-label="メニューを開く" onClick={() => setIsMenuOpen(true)}>☰</button>
            <button className="toolbar-icon" title="検索" aria-label="検索" onClick={() => setIsSearchOpen(true)}>⌕</button>
            <button
              className="toolbar-icon"
              title="ライト/ダーク切り替え"
              aria-label={`ライト/ダーク切り替え: 現在は${theme === "dark" ? "ダーク" : "ライト"}モード`}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀︎" : "◐"}
            </button>
            <div className="relative">
              <button
                className="toolbar-icon"
                title="配色テーマ"
                aria-label="配色テーマを選択"
                aria-haspopup="true"
                aria-expanded={isThemeOpen}
                onClick={() => setIsThemeOpen((open) => !open)}
              >
                ◑
              </button>
              {isThemeOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" aria-label="テーマ選択を閉じる" onClick={() => setIsThemeOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 grid w-40 gap-0.5 rounded-md border border-slate-200 bg-white p-1 shadow-xl" role="menu">
                    <span className="px-2 py-1 text-[11px] font-semibold text-slate-400">配色テーマ</span>
                    {THEME_PALETTES.map((item) => (
                      <button
                        key={item.id}
                        role="menuitemradio"
                        aria-checked={palette === item.id}
                        className={[
                          "flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                          palette === item.id ? "nav-active" : "text-slate-700 hover:bg-slate-100",
                        ].join(" ")}
                        onClick={() => { setPalette(item.id); setIsThemeOpen(false); }}
                      >
                        <span
                          className="size-3.5 shrink-0 rounded-full border border-black/10"
                          style={{ background: item.swatch }}
                        />
                        <span className="flex-1">{item.label}</span>
                        {palette === item.id && <span aria-hidden>✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <Link className="toolbar-icon" title="設定" aria-label="設定" to="/settings">{"⚙︎"}</Link>
            <button className="toolbar-icon" title="ヘルプ" aria-label="ヘルプ" onClick={() => setIsHelpOpen(true)}>?</button>
          </div>
        </div>
      </header>
      {isMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 h-full w-full bg-slate-950/30" aria-label="メニューを閉じる" onClick={() => setIsMenuOpen(false)} />
          <aside className="absolute right-0 top-0 grid h-full w-[min(82vw,320px)] content-start gap-2 border-l border-slate-200 bg-white p-3 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-slate-950">メニュー</span>
              <button className="toolbar-icon" aria-label="メニューを閉じる" onClick={() => setIsMenuOpen(false)}>×</button>
            </div>
            {navItems
              .filter((item) => item.to !== "/settings")
              .map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setIsMenuOpen(false)}
                  className={[
                    "rounded px-3 py-2 text-sm font-medium",
                    isNavActive(item.to) ? "nav-active" : "text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              ))}
            <button
              type="button"
              className="flex items-center justify-between rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
              aria-expanded={isSettingsOpen}
              onClick={() => setIsSettingsOpen((open) => !open)}
            >
              <span>設定</span>
              <span className="text-xs text-slate-400">{isSettingsOpen ? "▾" : "▸"}</span>
            </button>
            {isSettingsOpen && (
              <div className="grid gap-1 pl-3">
                {settingsItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setIsMenuOpen(false)}
                    className={[
                      "rounded px-3 py-2 text-sm font-medium",
                      isNavActive(item.to) ? "nav-active" : "text-slate-600 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24" role="dialog" aria-modal="true" aria-label="部品を検索">
          <button className="absolute inset-0 h-full w-full bg-slate-950/30" aria-label="検索を閉じる" onClick={() => setIsSearchOpen(false)} />
          <div className="relative w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl">
            <label className="mb-2 block text-sm font-semibold text-slate-950">部品を検索</label>
            <div className="flex gap-2">
              <input
                autoFocus
                className="h-9 flex-1 rounded border border-slate-300 px-3 text-sm"
                placeholder="型番・メーカー・メモ・属性で検索"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitSearch();
                  if (event.key === "Escape") setIsSearchOpen(false);
                }}
              />
              <button className="btn btn-primary h-9 px-4" onClick={submitSearch}>検索</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">在庫一覧をキーワードで絞り込みます。</p>
          </div>
        </div>
      )}
      {isHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="ヘルプ">
          <button className="absolute inset-0 h-full w-full bg-slate-950/30" aria-label="ヘルプを閉じる" onClick={() => setIsHelpOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-base font-semibold text-slate-950">ヘルプ</span>
              <button className="toolbar-icon" aria-label="ヘルプを閉じる" onClick={() => setIsHelpOpen(false)}>×</button>
            </div>
            <ul className="grid gap-2 text-sm text-slate-700">
              <li><span className="font-medium">在庫一覧</span>：登録済みの部品を一覧・検索・絞り込み。</li>
              <li><span className="font-medium">カテゴリ一覧/電気的特性</span>：ジャンルや仕様から部品を探索。</li>
              <li><span className="font-medium">新規作成</span>：部品を1件ずつ登録。</li>
              <li><span className="font-medium">低在庫アラート</span>：しきい値を下回った部品を表示。</li>
              <li><span className="font-medium">設定</span>：カテゴリ・タグ管理、JSONインポート、エクスポート。</li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">仕様フィルタでは <code>=</code> のほか数値項目で <code>&gt; ≧ &lt; ≦</code> による比較ができます。</p>
          </div>
        </div>
      )}
      <main className="px-6 md:px-12 lg:px-16 pb-3 pt-[82px]">{children}</main>
    </div>
  );
}
