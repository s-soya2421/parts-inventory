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

`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` は画面とAPI全体を保護するBasic認証用。ローカル開発ではVite proxyが `.dev.vars` の値を使ってWorkerへ認証ヘッダーを付与する。未設定または空の場合、APIは `BASIC_AUTH_NOT_CONFIGURED` を返す。Cloudflare宛のsecret値は空にしないでください。

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
pnpm wrangler secret put GITHUB_TOKEN
pnpm wrangler secret put GITHUB_REPOSITORY
pnpm wrangler secret put GITHUB_ISSUE_ASSIGNEE
pnpm wrangler deploy
```

`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` はsecretとして登録し、リポジトリには保存しない。

不具合報告をGitHub Issueとして作成する場合も、以下をCloudflare Secretとして設定する。

- `GITHUB_TOKEN`: 対象リポジトリに限定したfine-grained token（Issues: Read and write）
- `GITHUB_REPOSITORY`: `owner/repository` 形式
- `GITHUB_ISSUE_ASSIGNEE`: Issueの担当者にするGitHubユーザー名

トークン未設定でも報告内容はD1へ保存される。GitHubの通知設定で担当Issueのメール通知を有効にすると、別のメール送信サービスは不要。

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
