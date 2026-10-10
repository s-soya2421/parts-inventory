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
- ヘッダーとスマホメニューのログアウトは、認証画面で「キャンセル」を選ぶ案内を表示してから `POST /api/logout` をフォーム送信する。通常ログインと同じrealmの `401 WWW-Authenticate` を返し、認証キャッシュの無効化を促す。正しいID・パスワードを再入力しても401になるため、再入力せずキャンセルする。401のHTMLが読み込まれた後、meta refreshで固定の `/` へ戻る。トップでも認証が必要なので再度ダイアログが出ることがある。
- Basic認証キャッシュをJavaScriptから直接削除するAPIはない。401後のキャッシュ無効化・認証画面のキャンセル・HTMLの読み込みはブラウザに依存する。Linux上のPlaywright WebKitはSafari実機ではないため、公開後は対象Safariでも下記手順を確認する。旧方式の `Clear-Site-Data: "cookies"` と303だけではSafariでログアウトしないとの実機報告があり、この方式へ置き換えた。
- Cookie・localStorage/sessionStorage・保存済みテーマ・列順・インポート設定は保持する。`Clear-Site-Data` と `Set-Cookie` を送らず、DBへもアクセスしない。サーバーのID・パスワードとパスワードマネージャーの保存内容は変更しない。別タブに表示済みの画面を自動的に隠す機能は含まない。
- 認証済みレスポンス、エクスポート、認証エラーは `Cache-Control: no-store`。HTMLにはCSP・クリックジャッキング対策・`nosniff` を付与する。外部画像はHTTPSのみ許可する。
- 更新APIでは別originの `Origin`、`Sec-Fetch-Site: cross-site/same-site` を拒否する。ボディ付きAPIはJSONを要求し、5 MiBまでに制限する（logoutの同originフォームは例外）。ヘッダーなしの認証済みCLIリクエストは利用可能。
- 本番ホストで未認証の `/`、`/parts`、`/assets/...`、`/api/health` がすべて401になることを確認する。本番に対する確認は読取リクエストだけにする。
- `pnpm audit` は開発依存も含める。`pnpm audit --prod` も確認する。残る開発依存の問題は `docs/security-review-20261010.md` に記録する。
- SheetJSは公式CDNの固定バージョンを使用する。`pnpm-lock.yaml` のintegrityを維持し、`pnpm install --frozen-lockfile` で再現する。脆弱なnpm版 `xlsx 0.18.5` に戻さない。

### Safariでのログアウト確認

1. ログインし、在庫一覧を再読み込みして表示できることを確認する。
2. ログアウトボタンを押し、最初の案内では「OK」を選ぶ。
3. 続くブラウザの認証画面ではID・パスワードを入力せず「キャンセル」を選ぶ。トップでも認証画面が出たら同じくキャンセルする。
4. トップの再読み込みと `/api/health` へのアクセスで認証が必要になることを確認する。認証なしで一覧やAPI結果が出る場合は、キャッシュが残っているため成功扱いにしない。
5. 再ログイン後、在庫データと保存済み設定が保持されていることを確認する。

HTTP 401はこのログアウト処理の意図した応答。HTTP 401が返ったことだけではキャッシュ消去成功とは判断しない。確認するのは、その後の通信で以前の認証情報が自動送信されないこと。iOS/macOSとSafariのバージョンも記録する。
