# API Specification

Base path: `/api`

Response success format:

```json
{
  "data": {}
}
```

一部エンドポイントは追加メタデータを返す。例: `GET /api/parts` は `data` に加えて `total`, `page`, `pageSize` を返す。`GET /api/health` は疎通確認用に `ok`, `service`, `timestamp` を返す。

Response error format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "issues": []
  }
}
```

## Auth

画面とAPI全体はBasic認証で保護する。Worker環境変数 `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` と一致しない場合は `401` を返す。

```http
Authorization: Basic <base64(user:password)>
```

画面とAPI全体がBasic認証の対象です。認証情報が未設定または空の場合は `BASIC_AUTH_NOT_CONFIGURED` を返します。

## Health

### GET `/api/health`

Workerの疎通確認。

## Parts

### GET `/api/parts`

Query:

- `q`: キーワード
- `categoryId`: カテゴリID
- `categorySlug`: カテゴリslug
- `tagId`: タグID。複数指定可能
- `caseNumber`: ケース番号
- `stockStatus`: `all`, `in_stock`, `out_of_stock`, `low_stock`
- `manufacturer`: メーカー完全一致
- `footprint`: フットプリント完全一致
- `locationId`: 保管場所ID
- `statusId`: ステータスID
- `archived`: `active`, `archived`, `all`
- `sort`: `modelNumber`, `manufacturer`, `categoryName`, `status`, `stockQuantity`, `location`, `price`, `footprint`, `lowStockThreshold`, `createdAt`, `updatedAt`, `name`, `category`
- `direction`: `asc`, `desc`
- `page`: 1以上
- `pageSize`: 1以上200以下
- `attrs`: 属性条件JSON。例: `{"resistance":{"op":"gte","val":"1000"}}`

### GET `/api/parts/stats`

一覧フィルタ条件に一致する合計金額、合計在庫数、件数、価格設定済み件数を返す。

### GET `/api/parts/analytics`

カテゴリ別、ステータス別、メーカー別、保管場所別、在庫状態、月別/年別追加数などの集計を返す。

### GET `/api/parts/attribute-values`

Query:

- `key`: 属性キー

指定属性の既存値候補を返す。

### GET `/api/parts/:id`

部品詳細を返す。基本情報、属性、タグ、在庫履歴を含む。

### POST `/api/parts`

部品を作成する。Basic認証必須。

Body:

```json
{
  "categoryId": 1,
  "modelNumber": "RFM95W",
  "name": "LoRa Transceiver",
  "stockQuantity": 10,
  "price": 520,
  "description": "検証用モジュール",
  "manufacturer": "Semtech",
  "footprint": "SMD",
  "locationId": 1,
  "caseNumber": "A-01",
  "purchaseUrl": "https://example.com/item",
  "datasheetUrl": "https://example.com/ds.pdf",
  "memo": "検証用",
  "lowStockThreshold": 2,
  "statusId": 1,
  "attributes": [{ "key": "frequency", "label": "周波数", "value": "920", "unit": "MHz" }],
  "tagIds": [1],
  "tagNames": ["rf"],
  "alternatives": ["RFM95"]
}
```

作成時は `stock_movements` に `initial` を記録する。

### PUT `/api/parts/:id`

部品を更新する。Basic認証必須。Bodyは作成と同じ。

在庫数が変わった場合は `stock_movements` に `set` を記録する。

### DELETE `/api/parts/:id`

部品をアーカイブする。

### POST `/api/parts/:id/restore`

アーカイブ済み部品を復元する。

### DELETE `/api/parts/:id/permanent`

部品を物理削除する。

### POST `/api/parts/bulk/archive`

複数部品をアーカイブする。

```json
{ "ids": [1, 2, 3] }
```

### POST `/api/parts/bulk/update`

複数部品のカテゴリ、メーカー、フットプリント、保管場所、ケース番号、低在庫しきい値、ステータス、メモを一括更新する。

### POST `/api/parts/:id/stock`

在庫数を変更する。Basic認証必須。

Body:

```json
{
  "type": "in",
  "quantity": 5,
  "memo": "補充"
}
```

`type` は `in`, `out`, `set`, `adjustment`, `use`, `dispose`。`adjustment` は符号付き差分、`set` は0以上の指定数。結果が負数になる変更は拒否する。

### GET `/api/parts/:id/movements`

在庫変更履歴を返す。

## Categories

### GET `/api/categories`

カテゴリ一覧を返す。

### POST `/api/categories`

カテゴリを作成する。Basic認証必須。

```json
{
  "name": "抵抗",
  "slug": "resistor"
}
```

### PUT `/api/categories/:id`

カテゴリを更新する。Basic認証必須。

### DELETE `/api/categories/:id`

カテゴリを削除する。アクティブな部品が紐づくカテゴリは `409 CATEGORY_IN_USE` を返す。アクティブな部品はないがアーカイブ(削除)済みの部品が残っているカテゴリは `409 CATEGORY_HAS_ARCHIVED_PARTS` を返し、レスポンスには `error.details.archivedParts` として残存するアーカイブ済み部品の `id` / `name` / `modelNumber` の配列が含まれる。`?force=true` を付けると、アーカイブ済み部品を完全削除した上でカテゴリを削除する。ただしアクティブな部品がある場合は `force` でも `CATEGORY_IN_USE` でブロックされる。

### GET `/api/categories/:id/attributes`

カテゴリ別の仕様項目定義を返す。

### PUT `/api/categories/:id/attributes`

カテゴリ別の仕様項目定義を更新する。

### GET `/api/categories/:id/headers`

カテゴリ別の一覧表示ヘッダを返す。

### PUT `/api/categories/:id/headers`

カテゴリ別の一覧表示ヘッダを更新する。

## Locations

### GET `/api/locations`

保管場所一覧を返す。

### POST `/api/locations`

保管場所を作成する。

### PUT `/api/locations/:id`

保管場所を更新する。

### DELETE `/api/locations/:id`

保管場所を削除する。使用中の場合は `409 LOCATION_IN_USE` を返す。

## Tags

### GET `/api/tags`

タグ一覧を返す。

### POST `/api/tags`

タグを作成する。Basic認証必須。

```json
{
  "name": "検証済み",
  "slug": "verified"
}
```

### PUT `/api/tags/:id`

タグを更新する。Basic認証必須。

### DELETE `/api/tags/:id`

タグを削除する。Basic認証必須。

## Statuses

### GET `/api/statuses`

ステータス一覧を返す。

### POST `/api/statuses`

ステータスを作成する。

### PUT `/api/statuses/:id`

ステータスを更新する。

### DELETE `/api/statuses/:id`

ステータスを削除する。

## Import

### POST `/api/import/parts`

部品を一括登録する。フロント側はJSON/CSV/Excelを読み取り、APIへ正規化済み行配列を送る。

Body:

```json
{
  "rows": [
    {
      "category": "RFトランシーバ",
      "model_number": "RFM95W",
      "name": "LoRa Transceiver",
      "stock_quantity": 10,
      "price": 520,
      "case_number": "A-01",
      "tags": "rf,lora",
      "memo": "検証用",
      "low_stock_threshold": 2,
      "attributes_json": {
        "frequency": { "label": "周波数", "value": "920", "unit": "MHz" }
      }
    }
  ]
}
```

`attributes_json` は文字列JSONまたはオブジェクトを受け付け、`part_attributes` とカテゴリ定義に合う `part_attribute_values` へ展開する。

### GET `/api/import/batches`

直近の取り込み履歴を返す。

### POST `/api/import/batches/:id/revert`

取り込みを取り消す。新規作成分は削除し、更新分は取り込み前のスナップショットへ戻す。失敗がある場合は batch を取り消し済みにしない。

## Export

### GET `/api/export/parts`

Query:

- `format`: `json`, `excel`, `pdf`, `csv`
- `mode`: JSONのみ。`flat`, `raw`
- `categoryId`: 任意
- `categorySlug`: 任意

`excel` は `.xlsx` バイナリを返す。`pdf` はPDFバイナリを返す。PDFの日本語フォント埋め込みは未対応。
