import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("primary pages smoke", () => {
  it("registers all primary routes", () => {
    const app = read("src/web/App.tsx");

    expect(app).toContain('path="/parts"');
    expect(app).toContain('path="/parts/new"');
    expect(app).toContain('path="/parts/:id"');
    expect(app).toContain('path="/parts/:id/edit"');
    expect(app).toContain('path="/projects"');
    expect(app).toContain('path="/projects/new"');
    expect(app).toContain('path="/projects/:id"');
    expect(app).toContain('path="/projects/:id/edit"');
    expect(app).toContain('path="/find"');
    expect(app).toContain('path="/categories"');
    expect(app).toContain('path="/categories/:id/settings"');
    expect(app).toContain('path="/import"');
    expect(app).toContain('path="/export"');
    expect(app).toContain('path="/settings"');
  });

  it("keeps user-facing page headings in place", () => {
    expect(read("src/web/routes/PartsListPage.tsx")).toContain("部品一覧");
    expect(read("src/web/routes/FindPage.tsx")).toContain("部品を探す");
    expect(read("src/web/routes/CategorySettingsPage.tsx")).toContain("カテゴリ設定");
    expect(read("src/web/routes/PartCreatePage.tsx")).toContain("部品登録");
    expect(read("src/web/routes/ProjectCreatePage.tsx")).toContain("プロジェクト登録");
    expect(read("src/web/routes/ImportPage.tsx")).toContain("JSONインポート");
    expect(read("src/web/routes/ExportPage.tsx")).toContain("エクスポート");
    expect(read("src/web/routes/SettingsPage.tsx")).toContain("管理");
  });

  it("keeps import and multi-tag filtering controls wired", () => {
    expect(read("src/web/routes/ImportPage.tsx")).toContain("parseJsonRows");
    expect(read("src/web/routes/ImportPage.tsx")).toContain("apiClient.importParts");
    expect(read("src/web/routes/PartsListPage.tsx")).toContain('getAll("tagId")');
    expect(read("src/web/routes/PartsListPage.tsx")).toContain("toggleSearchParamValue");
  });
});
