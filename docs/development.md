# 開発ガイド

keito を手元で動かす・直す・ビルドするための情報です。使い方は [使い方ガイド](guide.md) を見てください。

## コマンド

```bash
npm install
npm run dev      # http://localhost:5183
npm run build    # dist/ に静的ファイル（base は相対パス）
npm test         # テスト（コメントのピン留め・ラベル配置・表・YAML・削除したボードの復元など）
npm run app      # デスクトップアプリ（Tauri）を開発モードで起動（Rust が必要）
npm run app:build  # デスクトップアプリをビルド（src-tauri/target/release/bundle/ に .app と .dmg）
npm run app:release  # 署名・公証済みの .dmg を作る（人に配るとき。下の「配布用のビルド」）
```

## 構成

```
src/model/     データモデル・配線ルーティング・自動レイアウト・YAML・リスト生成・状態管理（UI 非依存）
src/canvas/    SVG 描画（画面とエクスポートで共通）とキャンバス操作
src/export/    PNG / SVG / PDF / Excel
src/ui/        ツールバー・インスペクタ・各パネル
src/platform/  保存先とファイル入出力の境界（ブラウザ版とデスクトップアプリで差し替える）
server/        ボードのフォルダの読み書き（store.ts: 開発サーバーと CLI で共通）と、開発サーバーの保存 API・変更通知
cli/           コマンドライン（npm run keito）
.claude/       Claude Code 向けの使い方（skills/keito）
```

## 配布用のビルド

ほかの Mac でも警告なしに開けるように、Developer ID で署名し、Apple の公証を通した `.dmg` を作ります。

1. 最初に一度だけ、公証用の認証情報をキーチェーンに保存します。App 用パスワードは account.apple.com で作ります。

   ```sh
   xcrun notarytool store-credentials keito --apple-id <Apple ID> --team-id <チーム ID>
   ```

2. `npm run app:release` を実行します。署名、公証、staple（公証の記録を .dmg と .app に添付）まで行い、`src-tauri/target/release/bundle/dmg/` に `.dmg` ができます。公証の待ち時間は数分です。

- 署名には、キーチェーンにある「Developer ID Application」証明書を使います。複数あるときはどれを使うか決めないと止まるので、`KEITO_SIGNING_TEAM=<チーム ID> npm run app:release` で選びます（証明書の名前ごと `APPLE_SIGNING_IDENTITY` で指定してもかまいません）。公証の認証情報も、同じチームのものを保存します。
- 公証に使うプロファイル名は `KEITO_NOTARY_PROFILE` で変えられます（既定は `keito`）。
- 署名だけで公証しないときは `KEITO_SKIP_NOTARIZE=1 npm run app:release` です。この Mac で使うだけなら、これで足ります。
- アイコンの元データは `design/icon.svg` です。変えたら `npx tauri icon <1024px の PNG> -o src-tauri/icons` で各サイズを作り直します（android/ と ios/ は使わないので消します）。
