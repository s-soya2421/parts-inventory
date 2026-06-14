# Electronics Inventory

電子部品の在庫をスマホ・PCから確認/編集するWebアプリです。無料運用を優先し、Cloudflare Workers + D1 + Hono + React/Vite + TypeScript + Tailwind CSS で構成しています。

## Documents

- [仕様概要](docs/specification.md)
- [アーキテクチャ](docs/architecture.md)
- [API仕様](docs/api.md)
- [DB設計](docs/database.md)
- [ローカル運用・デプロイ](docs/operations.md)
- [今後TODO](docs/todo.md)

## Stack

- Frontend: React + Vite + TypeScript
- Styling: Tailwind CSS
- Backend/API: Cloudflare Workers + Hono
- Database: Cloudflare D1
- Validation: zod
- Package Manager: pnpm

## Prerequisites

- Node.js（最近の LTS。例: 20 以上）
- pnpm@10（このリポジトリは `package.json` の `packageManager` で `pnpm@10.0.0` をピン留め）
- Cloudflare アカウント（D1作成・デプロイ用。下記「D1 Database」参照）

## Local Setup

```bash
cd electronics-inventory
pnpm install
cp .dev.vars.example .dev.vars
```

Windows (PowerShell) では `cp` の代わりに:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` は画面とAPI全体を保護するBasic認証です。本番ではCloudflare secretとして設定します。空の値は無効です。

## D1 Database

Cloudflare上にD1を作成します（自分のCloudflareアカウントが必要です。`pnpm wrangler login` でログインしてから実行）。

```bash
pnpm wrangler d1 create electronics_inventory
```

出力された `database_id` を `wrangler.toml` の `database_id` に設定します。

`pnpm dev:worker` はローカルD1を `.wrangler/state` に永続化します（このディレクトリはコミット不要）。

## Migration

ローカルD1へ適用:

```bash
pnpm db:migrate:local
```

Cloudflare上のD1へ適用:

```bash
pnpm db:migrate:remote
```

## Development

ターミナルを2つ開きます。

```bash
pnpm dev:worker
```

```bash
pnpm dev:web
```

Webは `http://localhost:5173`、Worker APIは `http://localhost:8787` で起動します。Vite dev server は `/api` を Worker にプロキシします。

## Build

```bash
pnpm build
```

## Test

```bash
pnpm test            # web ユニット + APIインプロセス統合
pnpm test:web        # フロント/共通ロジックのユニット
pnpm test:integration # Honoアプリを実D1(SQLite)で駆動する統合
```

`pnpm test:integration` は Node 組み込みの `node:sqlite` を使うため **Node 24+** が必要です（`@cloudflare/vitest-pool-workers`/workerd がこの環境で起動しないため、実マイグレーション済みSQLiteに対して実アプリを駆動する方式を採用）。

`test:api`（外部HTTP統合）は `API_BASE_URL` 未設定時にskipされます。Workerを起動して統合テストを実行する場合は `API_BASE_URL` とBasic認証値を指定します。

```bash
API_BASE_URL=http://localhost:8787 pnpm test:api
```

Windows (PowerShell) ではインライン環境変数が使えないため、先にセットします:

```powershell
$env:API_BASE_URL="http://localhost:8787"; pnpm test:api
```

## Deploy

```bash
pnpm wrangler login
pnpm build
pnpm db:migrate:remote
pnpm wrangler secret put BASIC_AUTH_USER
pnpm wrangler secret put BASIC_AUTH_PASSWORD
pnpm wrangler deploy
```

## API

- `GET /api/health`
- `GET /api/parts`
- `GET /api/parts/stats` （総在庫価格バー用の集計：フィルタ条件全体での合計金額・在庫数）
- `GET /api/parts/analytics`
- `GET /api/parts/attribute-values`
- `GET /api/parts/:id`
- `POST /api/parts`
- `PUT /api/parts/:id`
- `DELETE /api/parts/:id`
- `POST /api/parts/bulk/archive`
- `POST /api/parts/bulk/update`
- `POST /api/parts/:id/restore`
- `DELETE /api/parts/:id/permanent`
- `POST /api/parts/:id/stock`
- `GET /api/parts/:id/movements`
- `GET /api/categories`
- `POST /api/categories`
- `PUT /api/categories/:id`
- `DELETE /api/categories/:id`
- `GET /api/categories/:id/attributes`
- `PUT /api/categories/:id/attributes`
- `GET /api/categories/:id/headers`
- `PUT /api/categories/:id/headers`
- `GET /api/locations`
- `POST /api/locations`
- `PUT /api/locations/:id`
- `DELETE /api/locations/:id`
- `GET /api/tags`
- `POST /api/tags`
- `PUT /api/tags/:id`
- `DELETE /api/tags/:id`
- `GET /api/statuses`
- `POST /api/statuses`
- `PUT /api/statuses/:id`
- `DELETE /api/statuses/:id`
- `GET /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/import/parts` （既存はスキップ/更新を選択可。取り込みはバッチ記録され取り消し可能）
- `GET /api/import/batches` （取り込み履歴：7日以内は取り消し可）
- `POST /api/import/batches/:id/revert` （取り込みの取り消し：新規分は削除、更新分は取り込み前へ復元）
- `GET /api/export/parts`

画面とAPI全体はBasic認証で保護されます。`POST` / `PUT` / `DELETE` も Basic 認証で保護されます。

## Current MVP Scope

- 部品一覧、詳細、登録、編集
- 在庫数変更と履歴保存
- カテゴリ管理、タグ管理
- プロジェクト管理（使用部品・費用の登録、原価集計）
- JSON インポート
- JSON flat/raw エクスポート
- `.xlsx` エクスポート
- PDFエクスポート
- カテゴリ別エクスポートヘッダ定義のサービス分離

PDFはバイナリ生成済みですが、日本語フォント埋め込みは未対応です。

詳細な制約、API、DB、運用手順は `docs/` 配下を参照してください。
