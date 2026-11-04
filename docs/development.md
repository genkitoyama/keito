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
npm run app:release:windows  # Windows 版のインストーラーを Mac でクロスビルドする（下の「Windows 版」）
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

macOS 版は、ほかの Mac でも警告なしに開けるように、Developer ID で署名し、Apple の公証を通した `.dmg` を作ります。Windows 版は同じ Mac でクロスビルドします（下の「Windows 版」）。リリースに上げるファイルは、どちらも `src-tauri/target/release-files/v<バージョン>/` に集まります。

1. 最初に一度だけ、公証用の認証情報をキーチェーンに保存します。App 用パスワードは account.apple.com で作ります。

   ```sh
   xcrun notarytool store-credentials keito --apple-id <Apple ID> --team-id <チーム ID>
   ```

2. 同じく最初に一度だけ、アプリ内アップデート用の署名鍵を作ります。パスワードを聞かれるので決めて入力します。

   ```sh
   npx tauri signer generate -w ~/.tauri/keito.key
   ```

   できた公開鍵 `~/.tauri/keito.key.pub` の中身（1 行）を、`src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に入れます。秘密鍵 `~/.tauri/keito.key` とパスワードは、パスワードマネージャーなどに控えておきます。アプリは、この鍵で署名したアップデートしか受け付けません。鍵かパスワードをなくすと、それまでの版からはアプリ内でアップデートできなくなり、使っている人に一度 dmg から入れ替えてもらうことになります。

3. `npm run app:release` を実行します。最初にアップデート用の署名鍵のパスワードを聞かれます。署名、公証、staple（公証の記録を .dmg と .app に添付）まで行い、続けてアプリ内アップデート用のファイルを作ります。公証の待ち時間は数分です。`src-tauri/target/release-files/v<バージョン>/` に次のものができます。

   - `keito_<バージョン>_aarch64.dmg`: 手でダウンロードして入れる人向け
   - `keito_<バージョン>_aarch64.app.tar.gz`: アプリが自分でダウンロードする本体（staple 済みの .app を固めて、署名鍵で署名したもの）
   - `latest.json`: 最新版のバージョンと、OS ごとのアップデートの URL と署名

4. 続けて `npm run app:release:windows` で Windows 版を作ります（下の「Windows 版」）。同じフォルダに `keito_<バージョン>_x64-setup.exe` が加わり、`latest.json` に Windows の分が足されます。どちらを先に作ってもかまいません。

5. フォルダの中身をすべて GitHub のリリース（タグ `v<バージョン>`）に上げます。終わりに `gh release create` の例が出ます。アプリは `https://github.com/genkitoyama/keito/releases/latest/download/latest.json` を見て新しい版を探すので、リリースは下書きやプレリリースにせず、最新（Latest）として公開します。片方の OS だけ先に出したときは、もう片方を作ってから `gh release upload v<バージョン> <フォルダ>/* --clobber` で `latest.json` ごと上げ直します。

- 署名には、キーチェーンにある「Developer ID Application」証明書を使います。複数あるときはどれを使うか決めないと止まるので、`KEITO_SIGNING_TEAM=<チーム ID> npm run app:release` で選びます（証明書の名前ごと `APPLE_SIGNING_IDENTITY` で指定してもかまいません）。公証の認証情報も、同じチームのものを保存します。
- 公証に使うプロファイル名は `KEITO_NOTARY_PROFILE` で変えられます（既定は `keito`）。
- 署名だけで公証しないときは `KEITO_SKIP_NOTARIZE=1 npm run app:release` です。この Mac で使うだけなら、これで足ります。このときは、アップデート用の署名鍵がなければアップデート用のファイルを作らずに終わります。
- アップデート用の署名鍵の場所は `TAURI_SIGNING_PRIVATE_KEY_PATH`（既定は `~/.tauri/keito.key`）、パスワードは `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` で渡せます。`tauri.conf.json` の公開鍵がこの鍵のものでなければ、ビルドの前に止まります。
- アプリは起動したときと、開いている間は 6 時間ごとに新しい版を探します（ネットワークにつながっていなければ何も言いません）。開発モード（`npm run app`）では探しません。
- `latest.json` には、同じバージョンの OS の分だけが並びます。別のバージョンのフォルダの `latest.json` は混ざりません。
- アイコンの元データは `design/icon.svg` です。変えたら `npx tauri icon <1024px の PNG> -o src-tauri/icons` で各サイズを作り直します（android/ と ios/ は使わないので消します）。

### Windows 版

Windows 版（x64）は、この Mac で [cargo-xwin](https://github.com/rust-cross/cargo-xwin) を使ってクロスビルドし、NSIS でインストーラーにします。Tauri ではまだ試験的な方法です。動くかどうかは Windows の実機で確かめてください。

1. 最初に一度だけ、ビルドに要るものを入れます。cargo-xwin は、最初のビルドのときに Microsoft の Windows SDK と CRT をダウンロードします（そのライセンスに同意したことになります）。

   ```sh
   rustup target add x86_64-pc-windows-msvc
   cargo install --locked cargo-xwin
   brew install nsis llvm
   ```

2. `npm run app:release:windows` を実行します。macOS 版と同じく、最初にアップデート用の署名鍵のパスワードを聞かれます。`src-tauri/target/release-files/v<バージョン>/` に `keito_<バージョン>_x64-setup.exe` ができ、`latest.json` に Windows の分が足されます。インストーラーが、そのままアプリ内アップデートの本体にもなります。

- インストーラーにはコード署名（Authenticode）をしていません。初めて開くとき、SmartScreen が「Windows によって PC が保護されました」と出します（「詳細情報」→「実行」で進めます）。証明書を用意したら、`tauri.conf.json` の `bundle > windows > signCommand` で署名のコマンドを指定します。アップデート用の署名は、コード署名した後のファイルに対して行う必要があります（スクリプトはビルドの後に署名するので、この順になります）。
- インストール先は使う人ごとのフォルダ（`%LOCALAPPDATA%`）なので、インストールにもアップデートにも管理者の権限は要りません。インストーラーの言葉は、Windows が日本語なら日本語、それ以外は英語です。
- WebView2 がない Windows では、インストーラーがダウンロードして入れます（Windows 11 と最近の Windows 10 には最初からあります）。
- Windows では、WebView2 に入力したキーがメニューに届きません。メニューのショートカット（Ctrl+R、Ctrl+Q、Ctrl+,）はページの側でも受けています（`src/platform/tauri.ts`）。WebView2 自身のショートカット（F5 や Ctrl+R での再読み込み、Ctrl+P の印刷など）は止めています（`src-tauri/src/lib.rs`）。
- PDF は WebView2 の PrintToPdf で書き出します（`src-tauri/src/pdf.rs`）。
