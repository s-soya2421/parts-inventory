# Operations

## Prerequisites

- Node.js
- pnpm
- Cloudflare account
- Wrangler login for remote deploy

## Local Setup

```bash
cd electronics-inventory
pnpm install
cp .dev.vars.example .dev.vars
```

`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` は画面とAPI全体を保護するBasic認証用。Vite proxyは認証情報を自動付与しないため、Vite経由では先に `http://localhost:5173/api/health` を開き、ブラウザのBasic認証でログインする。未設定または空の場合は `BASIC_AUTH_NOT_CONFIGURED` を返す。Cloudflare宛のsecret値は空にしないでください。

## D1 Creation

Cloudflare上にD1を作成する。

```bash
pnpm wrangler d1 create electronics_inventory
```

出力された `database_id` を `wrangler.toml` の `database_id` に設定する。

## Migration

ローカルD1:

```bash
pnpm db:migrate:local
```

Cloudflare上のD1:

```bash
pnpm db:migrate:remote
```

## Local Development

ターミナルを2つ使う。

```bash
pnpm dev:worker
```

```bash
pnpm dev:web
```

- Web: `http://localhost:5173`
- Worker API: `http://localhost:8787`

Vite dev server は `/api` を Worker にプロキシする。

## Build

```bash
pnpm build
```

このコマンドはTypeScriptの型チェックとVite buildを実行する。

## Test

```bash
pnpm test:web
pnpm test:api
pnpm test
```

`test:web` はフロントのロジックと worker service の軽量ユニットテストを実行する。`test:api` は `API_BASE_URL` が未設定の場合 skip される。API統合テストを実行する場合は Worker を起動し、Basic認証の値とURLを指定する。

```bash
API_BASE_URL=http://127.0.0.1:8787 BASIC_AUTH_USER=inventory BASIC_AUTH_PASSWORD=inventory-pass pnpm test:api
```

現状の自動テストは API CRUD/export/属性検索、import parser、URL filter、API client cache、PartsService の主要分岐を中心に確認する。locations/statuses/import revert/bulk update/analytics は追加テスト対象。

## Deploy

```bash
pnpm wrangler login
pnpm build
pnpm db:migrate:remote
pnpm wrangler secret put BASIC_AUTH_USER
pnpm wrangler secret put BASIC_AUTH_PASSWORD
pnpm wrangler deploy
```

`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` はsecretとして登録し、リポジトリには保存しない。

CIなどで環境変数が注入されていることを事前確認する場合は、以下を実行する。

```bash
pnpm verify:cloudflare-secrets
```

## Smoke Test

Worker起動後に疎通を確認する。

```bash
curl -u inventory:inventory-pass http://localhost:8787/api/health
```

Basic認証なしでは `401` になり、正しいBasic認証付きで `GET` が成功することを確認する。

## Operational Notes

- 画面と閲覧APIはBasic認証で保護する。本格ログインは未実装。
- D1のバックアップ用途として `GET /api/export/parts?format=json&mode=raw` を使う。
- PDFの日本語フォント埋め込みは未対応。日本語を含む外部提出用帳票では出力確認を行う。

## Logout and Security Checks

- `assets.run_worker_first = true` を維持する。静的ファイル・SPAの画面遷移もWorkerの認証処理を通すために必須。
- ヘッダーとスマホメニューのログアウトは `POST /api/logout` をフォーム送信する。レスポンスの `Clear-Site-Data: "cookies"` が認証情報とCookieの消去を指示し、`303 Location: /` でトップへ戻す。トップにもBasic認証があるため、対応ブラウザでは再度認証ダイアログが表示される。
- 認証情報消去にはHTTPSと対応ブラウザが必要。Basic認証キャッシュをJavaScriptで直接消すAPIはなく、すべてのブラウザでの消去を保証するものではない。Chromium 153のローカル検証では再認証要求を確認したが、HTTP認証キャッシュ消去が未対応とのコンソールメッセージも出たため、完全消去の証明とは扱わない。未対応・旧ブラウザではサイトデータの手動削除が必要。全ブラウザで確実なログアウトが必要なら失効可能なサーバーセッション認証へ移行する。
- 保存済みテーマ・列順・インポート設定とlocalStorage/sessionStorageは残す。`cookies` 指示はブラウザによって登録可能ドメイン内のCookieにも及ぶため、他アプリとCookieを共有しない専用ホストで運用する。別タブに既に表示中の画面を自動的に隠す機能は含まない。
- 認証済みレスポンス、エクスポート、認証エラーは `Cache-Control: no-store`。HTMLにはCSP・クリックジャッキング対策・`nosniff` を付与する。外部画像はHTTPSのみ許可する。
- 更新APIでは別originの `Origin`、`Sec-Fetch-Site: cross-site/same-site` を拒否する。ボディ付きAPIはJSONを要求し、5 MiBまでに制限する（logoutの同originフォームは例外）。ヘッダーなしの認証済みCLIリクエストは利用可能。
- 本番ホストで未認証の `/`、`/parts`、`/assets/...`、`/api/health` がすべて401になることを確認する。本番に対する確認は読取リクエストだけにする。
- `pnpm audit` は開発依存も含める。`pnpm audit --prod` も確認する。残る開発依存の問題は `docs/security-review-20261010.md` に記録する。
- SheetJSは公式CDNの固定バージョンを使用する。`pnpm-lock.yaml` のintegrityを維持し、`pnpm install --frozen-lockfile` で再現する。脆弱なnpm版 `xlsx 0.18.5` に戻さない。
