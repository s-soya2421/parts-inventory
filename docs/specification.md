# Specification

## Purpose

友人向けに電子部品の在庫をスマホ・PCから確認/編集する。MVPでは本格ログインを作らず、画面とAPI全体をBasic認証で保護する。

## MVP Scope

実装対象:

- 部品一覧、詳細、登録、編集
- 在庫数変更と履歴表示
- カテゴリ管理、タグ管理
- JSON/CSV/ExcelインポートUI
- JSON形式の部品インポートAPI
- エクスポートAPIのサービス分離
- JSON flat/raw 出力
- `.xlsx` 出力
- PDF出力
- Basic認証による画面/API全体の保護

今回作らないもの:

- 発注管理
- QRコード
- 本格ログイン
- 画像添付
- export schema のDB管理
- PDFの日本語フォント埋め込み

## Data Model

カテゴリごとに異なる電気的特性をDBカラムとして増やさない。共通項目は `parts`、カテゴリは `categories`、電気的特性は `part_attributes` に `key/value/unit` 形式で保存する。

主要テーブル:

- `categories`: 部品カテゴリ
- `parts`: 型番、部品名、在庫数、価格、ケース番号、メモ、低在庫しきい値、検索用テキスト
- `part_attributes`: 部品ごとの電気的特性
- `tags`: タグマスタ
- `part_tags`: 部品とタグの中間テーブル
- `stock_movements`: 在庫変更履歴
- `locations`: 保管場所
- `part_statuses`: 部品ステータス
- `attribute_definitions` / `part_attribute_values`: カテゴリ別仕様項目と型付き属性値
- `category_list_headers`: カテゴリ別一覧ヘッダ
- `import_batches` / `import_batch_entries`: インポート取り消し用履歴
- `part_alternatives`: 代替候補

## API Design

Hono route は feature ごとに分離する。Route層は入力検証とレスポンスに集中し、D1アクセスはRepository、業務ロジックはServiceへ寄せる。

編集系API:

- `POST`
- `PUT`
- `DELETE`

上記は Basic認証で保護する。

## Export Design

保存構造は `parts + part_attributes` で統一する。出力時にカテゴリ別ヘッダを吸収する。

- `ExportService`: カテゴリ別スキーマ取得と出力形式振り分け
- `ExportRowBuilder`: 縦持ち属性を横持ち表形式へ変換
- `ExcelExporter`: `.xlsx` 出力
- `PdfExporter`: PDF系出力
- `JsonExporter`: `flat` と `raw`

MVPではカテゴリ別ヘッダを `export-schemas.ts` でコード管理する。将来 `export_schemas` / `export_schema_columns` テーブルへ移行しやすいよう責務を分けている。

## Import Design

フロントはJSON貼り付け、CSV、Excelを読み取り、正規化した行を `POST /api/import/parts` へ渡す。APIは行配列を受け取り、`attributes_json` を `part_attributes` と `part_attribute_values` へ展開する。

`attributes_json` は以下のような構造を `part_attributes` へ展開する。

```json
{
  "frequency": { "value": "2.4", "unit": "GHz" },
  "voltage": { "value": "3.3", "unit": "V" },
  "interface": { "value": "UART", "unit": "" }
}
```

## Frontend

React Router を利用し、検索条件はURLクエリに持たせる。Basic認証情報はブラウザが送信し、APIクライアントには保存しない。

画面:

- 部品一覧
- 部品詳細
- 部品登録
- 部品編集
- インポート
- エクスポート
- 管理（カテゴリ/タグ/保管場所/ステータス/カテゴリ別仕様項目）

## Search and Filter

部品一覧は以下を検索・絞り込み対象にする。

- キーワード: `parts.search_text` と `part_attributes` の `key/label/value/unit`
- カテゴリ: `categoryId` または `categorySlug`
- タグ: `tagId` を複数指定可能
- ケース番号: 完全一致
- メーカー、フットプリント、保管場所、ステータス
- 在庫状態: `all`, `in_stock`, `out_of_stock`, `low_stock`
- 属性条件: `attrs` JSONで `eq`, `contains`, `gt`, `gte`, `lt`, `lte`

`search_text` は部品の共通項目、カテゴリ名、タグ名、属性値から組み立てる。属性の詳細検索は `part_attributes` への `EXISTS` 条件で吸収する。

## Auth and Permission

MVPでは本格ログインは作らず、Basic認証で閲覧を制限する。

- 画面/API全体: Basic認証必須
- `GET` 系API: 閲覧は Basic 認証でアクセス可能
- `POST` / `PUT` / `DELETE`: Basic認証で保護
- Basic認証の正値: Workers環境変数 `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`
- 認証情報が未設定または空の場合、APIは `BASIC_AUTH_NOT_CONFIGURED` を返す
- 静的ファイルを含めてWorkerを先に実行し、未認証アクセスを拒否する
- 更新APIは同originのみ。JSONボディ上限5 MiB（logoutフォームはJSON要件の例外）
- ログアウトボタンは `POST /api/logout` にフォーム送信し、`Clear-Site-Data` で認証情報・Cookie消去を指示して `303` で `/` へ戻す。HTTPSと対応ブラウザが前提で、Basic認証キャッシュの消去はブラウザ実装に依存する
- 認証済みレスポンスは `no-store`。CSPとフレーム埋め込み防止ヘッダーを付与する

本格ログインに移行する場合も、Route層へmiddlewareを差し替える構成にしておく。
