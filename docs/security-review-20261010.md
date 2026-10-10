# 電子部品在庫アプリ セキュリティレビュー（2026-10-10）

対象: `s-soya2421/parts-inventory`、基準コミット `8d123be9c9509482abeb79559f82224ed8ca4b9c`。
認証・静的ファイル配信・API更新処理・SQL・入力検証・インポート/エクスポート・ブラウザキャッシュ・依存関係・関連ドキュメントを確認した。

## 結果

修正前の `pnpm audit` は79件（high 28 / moderate 38 / low 13）。修正後はhigh 1件、その他0件。`pnpm audit --prod` は0件。
残る1件は開発依存 `tailwindcss → braces 3.0.3`。現時点で修正版が公開されていない。監査の除外やseverityの引き下げはしていない。
この結果は既知の依存アドバイザリと今回のコード確認の範囲であり、未知の脆弱性が存在しないことを保証しない。

| 指摘 | 影響・根拠 | 対応 |
|---|---|---|
| 静的ファイルがWorker認証を迂回する設定 | `assets.run_worker_first` 未指定時は一致した静的ファイルを先に配信する。APIは認証済みでも画面・バンドルが公開される可能性。実際の本番公開状態は未確認 | `run_worker_first = true`。認証前にASSETSを呼ばないことを確認 |
| Basic認証だけではCSRFを防げない | ブラウザが資格情報を自動送信する。JSONをtext/plainフォームで送ることも可能 | 更新リクエストのOrigin/Fetch Metadataをチェック。ボディ付きAPIはJSONのみ。403/415とDB未更新を検証 |
| 保護レスポンスのキャッシュ方針が未指定 | ログアウト後にHTTPキャッシュから画面・出力データを再利用する懸念 | 全レスポンスをno-store、Vary: Authorization。ASSETSのimmutableなレスポンスを複製してからヘッダー付与 |
| CSV数式注入 | 型番・メモ・カテゴリ名や属性ヘッダーが数式で始まる場合、表計算ソフトが評価する。CSVの引用符だけでは防げない | 先頭の空白/制御文字に続く `= + - @` を含む文字列にアポストロフィを付加。数値型は保持。CSVのテキスト値に接頭辞が増える場合がある |
| prototype由来のキーでエラー | `sort=__proto__` / `constructor` とカテゴリ名 `__proto__` が通常オブジェクトの継承プロパティと衝突する | ソート辞書をown-propertyで確認。カテゴリ別出力の辞書をnull-prototypeに変更 |
| APIボディサイズが無制限 | 行数検証前のJSON展開によるメモリ消費 | 5 MiBの上限、Content-Lengthなしも413になることを検証 |
| セキュリティヘッダー未設定 | フレームへの埋め込み・スクリプト実行先・MIME解釈が未制限 | CSP、frame-ancestors none、X-Frame-Options DENY、nosniff、HSTS。Referrer-Policyはsame-origin（no-referrerはPOSTフォームのOriginをnullにしログアウトを拒否してしまう） |
| エラーログにURLクエリを含む | 検索内容などがログに残る | pathのみに変更。Authorizationやパスワードをリクエストログへ追加していない |
| 既知の依存脆弱性 | SheetJS、Hono、React Router、Vite、Vitest、PostCSS、Wranglerと推移依存に監査指摘 | 対応する更新を適用。SheetJSは公式CDNの0.20.3をintegrity付きlockfileで固定。postcss-selector-parserを7.1.6以降へoverride |

SQLの値はbindされ、ソート列・比較演算子・一括更新列には許可リストを使用している。今回確認した範囲で値のSQL直接埋め込みによる注入経路は見つからなかった。
Reactの通常の文字列レンダリングを使用し、アプリソースにdangerouslySetInnerHTML/evalの利用は見つからなかった。
追跡済みソースのAWS/GitHubトークン・秘密鍵パターン検査は該当0件。Git全履歴、Cloudflareの実secret値、アカウント権限は今回の確認範囲外。

## ログアウト

ヘッダーとスマホメニューにフォームのログアウトボタンを設置。認証済みの同origin `POST /api/logout` に対して次を返す。

```http
HTTP/1.1 303 See Other
Location: /
Clear-Site-Data: "cookies"
Cache-Control: no-store
```

トップもBasic認証対象。GETではログアウトせず404、外部originのPOSTは403、未認証POSTは401。クエリの遷移先を採用せず、常に `/` に戻す。
localStorage/sessionStorageと保存済みテーマ・列順・インポート設定は削除しない。Cookieの消去指示は認証情報だけに限定できない。

**制約:** Basic認証キャッシュはブラウザ管理であり、アプリから完全消去を保証できない。仕様上はcookies指示にHTTP認証情報を含むが、Chromiumには未対応旨のメッセージがある。今回のChromium 153.0.8010.0のローカルHTTPS検証では、認証キャッシュ利用中のリロード→ログアウト→新しい認証要求・トップの401を観測し、Cookie消去を確認した。localStorage/sessionStorageは保持する。ただし内部の認証キャッシュが完全に消えた証明とは扱わない。
全ブラウザで確実に失効させる要件を満たすには、サーバー側で失効可能なセッション認証への変更が必要。保存済みパスワードそのものは削除しない。別タブに既に表示された画面を自動的に隠す機能は含まない。

## 残件・運用確認

- **high: braces / CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm。** 深くネストしたbraceパターンによるスタック枯渇。npm最新版も3.0.3で修正版なし。現在はTailwindのファイル探索・監視で使用され、本番Worker/画面のコードから直接呼ぶ経路は見つからなかった。信頼できないglob設定をビルドに渡さない。上流の修正版またはTailwind更新時に再確認する。
- **認証試行のレート制限。** ソース内にはBasic認証の試行回数制限がない。CloudflareのWAF・rate limit設定は未確認。公開ホストの入口で制限し、十分な強度のsecretを使用することを運用確認項目とする。
- **ブラウザ差・本番配信。** Safari/Firefox/Android実機と公開ホストでの動作は未確認。本番のDB・secret・Cloudflare設定は変更していない。公開後は未認証のHTML、JS/CSS、API、exportが401になることを確認する。
- **インポート/エクスポートの資源消費。** 修正版SheetJSでも任意の巨大・圧縮ファイルに対するブラウザの資源上限を保証しない。今回のサイズ制限はAPIのJSONボディ対象。大量データでのexport負荷試験は未実施。

## 検証

- `pnpm test`: web 76件 + integration 47件 = **123件成功**。
- `pnpm build`: 型チェック・本番ビルド成功。約797 kBの単一JSに対する既存のchunk size警告あり。
- `pnpm lint`: errors 0。既存のany/React hooks等のwarnings 31件。
- `pnpm peers check`: peer依存問題なし。
- `pnpm audit --prod`: 0件。`pnpm audit`: 開発依存のhigh 1件。
- ローカルD1に全10マイグレーション適用、Wrangler/workerdで実際のASSETS・APIを起動。
- Chromium 153.0.8010.0、ローカルHTTPS、1440×900 / 390×844。PCヘッダーとスマホメニューのボタン表示、横方向のoverflowなし、ログアウトPOST/303、トップの再認証要求、Cookie消去とlocalStorage/sessionStorageの保持を確認。アプリのpageerrorは0。検証環境には日本語フォントがなく、スクリーンショットの日本語グリフは確認できていない。
- 本番DBの書き換え、デプロイ、PRのマージは実施していない。

## 参照

- [Cloudflare: Workerを静的ファイルより先に実行する設定](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [W3C: Clear Site Data](https://www.w3.org/TR/clear-site-data/)
- [Chromium: Clear-Site-Data処理とHTTP認証キャッシュの制限](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/browsing_data/clear_site_data_handler.cc)
- [SheetJS: CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533)
- [SheetJS: CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363)
- [braces: GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
