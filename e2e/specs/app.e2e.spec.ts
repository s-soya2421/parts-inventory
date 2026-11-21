import { expect, test, type APIRequestContext } from "@playwright/test";

const uniq = () => "E2E-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

async function getCategory(request: APIRequestContext) {
  const response = await request.get("/api/categories");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.data.length).toBeGreaterThan(0);
  return payload.data[0] as { id: number; name: string };
}

async function seedPart(request: APIRequestContext, modelNumber: string, overrides: Record<string, unknown> = {}) {
  const category = await getCategory(request);
  const response = await request.post("/api/parts", {
    data: {
      categoryId: category.id,
      modelNumber,
      name: "Display name for " + modelNumber,
      stockQuantity: 10,
      lowStockThreshold: 2,
      ...overrides,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data as { id: number; modelNumber: string };
}

async function partDetails(request: APIRequestContext, id: number) {
  const response = await request.get("/api/parts/" + id);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

test("Basic Auth protects both the SPA shell and the API", async ({ playwright, page }) => {
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:8787",
    // Explicitly override credentials inherited from Playwright's global
    // httpCredentials config. Otherwise the "anonymous" probe can retry a
    // 401 with the valid E2E account and incorrectly appear to bypass auth.
    httpCredentials: {
      username: "not-the-e2e-user",
      password: "intentionally-invalid-password",
      send: "always",
    },
  });
  try {
    // Non-navigation requests for an unknown SPA path may be rejected by
    // the asset router as 404 before reaching Worker Basic Auth.
    const shell = await anonymous.get("/parts", {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
    });
    expect([401, 404]).toContain(shell.status());
    expect(await shell.text()).not.toContain('<div id="root"');
    expect((await anonymous.get("/api/parts")).status()).toBe(401);
    const authorizedIndex = await page.request.get("/");
    expect(authorizedIndex.ok()).toBeTruthy();
    const match = (await authorizedIndex.text()).match(/src="(\/assets\/[^"]+\.js)"/);
    if (!match) throw new Error("Built asset script missing from index.html");
    expect((await anonymous.get(match[1])).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  await page.goto("/parts");
  await expect(page.getByRole("heading", { name: "部品一覧" })).toBeVisible();
});

test("responsive navigation reaches part creation", async ({ page }, testInfo) => {
  await page.goto("/parts");
  await expect(page.getByRole("heading", { name: "部品一覧" })).toBeVisible();
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "新規作成" }).click();
  } else {
    await page.getByRole("link", { name: "新規作成" }).click();
  }
  await expect(page.getByRole("heading", { name: "部品登録" })).toBeVisible();
  await expect(page.getByLabel("型番")).toBeVisible();
});

test("creating and editing preserves the independent name and nullable price", async ({ page, request }) => {
  const model = uniq();
  await page.goto("/parts/new");
  await expect(page.getByRole("heading", { name: "部品登録" })).toBeVisible();
  await page.getByLabel("型番", { exact: true }).fill(model);
  await page.getByLabel("部品名", { exact: true }).fill("表示名を維持する");
  await page.getByLabel("在庫数", { exact: true }).fill("7");
  await page.getByLabel("説明", { exact: true }).fill("画面E2E");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/parts\/\d+$/);
  const id = Number(new URL(page.url()).pathname.split("/").at(-1));
  const created = await partDetails(request, id);
  expect(created.name).toBe("表示名を維持する");
  expect(created.price).toBeNull();

  await page.getByRole("link", { name: "編集", exact: true }).click();
  await expect(page.getByLabel("価格")).toHaveValue("");
  await page.getByLabel("メモ", { exact: true }).fill("編集後も名称とNULL価格を保持");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/parts/" + id + "$"));
  const edited = await partDetails(request, id);
  expect(edited.name).toBe("表示名を維持する");
  expect(edited.price).toBeNull();
  expect(edited.memo).toBe("編集後も名称とNULL価格を保持");
  expect(edited.stockQuantity).toBe(7);
});

test("stock form updates the DB and shows an error for negative stock", async ({ page, request }) => {
  const item = await seedPart(request, uniq());
  await page.goto("/parts/" + item.id);
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "在庫数変更" }) });
  await expect(form).toBeVisible();

  await form.locator("select").selectOption("out");
  await form.locator('input[type="number"]').fill("4");
  await form.getByRole("button", { name: "反映" }).click();
  await expect.poll(async () => (await partDetails(request, item.id)).stockQuantity).toBe(6);

  await form.locator('input[type="number"]').fill("99");
  await form.getByRole("button", { name: "反映" }).click();
  await expect(form.getByText(/stock|在庫|negative/i).first()).toBeVisible();
  expect((await partDetails(request, item.id)).stockQuantity).toBe(6);
  const history = await partDetails(request, item.id);
  expect(history.movements.some((movement: { movementType: string; quantityDelta: number }) =>
    movement.movementType === "out" && movement.quantityDelta === -4)).toBeTruthy();
});

test("part search filters results by model number", async ({ page, request }) => {
  const model = uniq();
  await seedPart(request, model);
  await page.goto("/parts");
  await expect(page.getByRole("heading", { name: "部品一覧" })).toBeVisible();
  await page.getByPlaceholder("型番・メーカー・メモ・属性を検索").fill(model);
  await expect(page).toHaveURL(new RegExp("q=" + model));
  await expect(page.getByRole("link", { name: model, exact: true }).first()).toBeVisible();
});

test("JSON import from the screen persists a row and permits undo", async ({ page, request }) => {
  const model = uniq();
  const category = await getCategory(request);
  await page.goto("/import");
  await page.getByRole("button", { name: "JSON取り込み" }).click();
  await page.getByLabel("JSONインポート").fill(JSON.stringify([
    { category: category.name, model_number: model, name: "E2E imported part", stock_quantity: 8 },
  ]));
  await expect(page.getByText("1件の行を認識")).toBeVisible();
  await page.getByRole("button", { name: "インポート", exact: true }).click();
  await expect(page.getByText(/新規 1 件/)).toBeVisible();
  const listResponse = await request.get("/api/parts?q=" + encodeURIComponent(model));
  expect(listResponse.ok()).toBeTruthy();
  expect((await listResponse.json()).total).toBe(1);

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "元に戻す" }).first().click();
  await expect(page.getByText(/取り消しました/)).toBeVisible();
  const after = await request.get("/api/parts?q=" + encodeURIComponent(model));
  expect((await after.json()).total).toBe(0);
});

test("JSON export displays a created part in the rendered screen", async ({ page, request }) => {
  const model = uniq();
  await seedPart(request, model);
  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "エクスポート" })).toBeVisible();
  await page.getByRole("button", { name: "エクスポート開始" }).click();
  await expect(page.getByRole("heading", { name: "JSON 出力" })).toBeVisible();
  await expect(page.locator("textarea[readonly]")).toHaveValue(new RegExp(model));
});

test("an unrecognized API path returns JSON 404 instead of the SPA shell", async ({ request }) => {
  const response = await request.get("/api/not-a-real-route-" + uniq());
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(body.error.code).toBe("NOT_FOUND");
});
