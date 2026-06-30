# テスト方針（Marker:HELPER）

拡張機能本体は **ビルドレスの素の JS** を維持する。テストは **dev 専用** の `package.json` /
`node_modules`（gitignore 済み）だけで動かし、出荷物には影響させない。

## 実行

```bash
npm install                      # 初回のみ（dev 依存: vitest / jsdom / @playwright/test）
npm test                         # 層1+2（vitest）を実行
npm run test:watch

npx playwright install chromium  # E2E 初回のみ（Chromium 取得）
npm run e2e                      # 層3（Playwright）。ヘッドフル既定。
PW_HEADLESS=1 xvfb-run -a npm run e2e   # ヘッドレス/CI（要 xvfb）
```

## 3層構成

| 層 | 何を担保 | ツール | 状態 |
|---|---|---|---|
| 1. 純粋ロジック単体 | 実効値・並べ替え確定タイミング等の純粋関数 | vitest (node) | ✅ |
| 2. DOM/結合 | `render`/`buildItem`/並べ替えDOM順/端ボタン無効化/レース抑止 | vitest + jsdom + `chrome`モック | ✅ |
| 3. E2E（実Chromium） | content注入・オーバーレイ生成・実レイアウト | Playwright（unpackedロード） | ✅ コードは完成（実行は環境依存・下記参照） |

## 設計：純粋ロジックは `shared/` の両対応モジュールへ

ファイルローカルな IIFE のままでは外から呼べずテスト不可。純粋ロジックは
`shared/*.js` に切り出し、**ブラウザでは `globalThis.MMShared` グローバル、Node では
`module.exports`** の両対応にする。出荷物に同梱しつつ、テストから `require` できる。

- `shared/label.js` … `effectiveShowLabel(mark, global)`（連番の3状態）
- `shared/reorderController.js` … 並べ替え確定のタイミング制御（`onMove`/`shouldSkipRender`/`reset`）

層2では **実際の `panel.html` を jsdom に流し込み、`panel.js` を読み込んで**内部関数を検証する。
そのため `panel.js` 末尾に**テストシーム**を入れてある: Node(`module` 定義時)では自動起動せず
内部関数を `module.exports` で公開し、ブラウザでは従来どおり `reload()` でブートストラップする。
`chrome.*` は `test/helpers/chromeMock.js` で最小モックする。

## 回帰テスト（バグ→テスト化済み）

| バグ | テスト | 層 |
|---|---|---|
| #1 グローバルトグルが個別設定を上書き | `test/label.test.js` | 1 |
| #3 旧データで連番が出ない | `test/label.test.js`（undefined=継承） | 1 |
| #2 並べ替えが無言で取り消される | `test/reorderController.test.js`（即時commit＋抑止＋再同期）/ `test/panel.dom.test.js`（DOMで抑止確認） | 1 / 2 |

**運用ルール: 今後バグを直すたびに、まず失敗する回帰テストを1本足してから直す。**

## E2E（層3）の実行環境について

`e2e/extension.spec.js` は persistent context に拡張を unpacked ロードし、
ローカル http ページ上で「SW経由でマーキングON → 要素クリック → `#mm-overlay-root .mm-mark-box`
が生成される」ことを検証する。**コードは完成**しているが、実行には実 Chromium が必要:

- **ヘッドフル**（既定）か、CIでは **`xvfb-run` + `PW_HEADLESS=1`** が必要。
- 一部のサンドボックス/非対応OSのフォールバック Chromium ビルドでは、ヘッドレスで MV3 の
  service worker が登録されず SW 取得に失敗することがある。その場合はヘッドフル(+xvfb)で実行する。

## 次の一手

1. 純粋関数をさらに `shared/` へ（`generateSelector`/`generateXPath`/`sanitizeStyle`/`selectorRobustness`）
2. 層2: メッセージ往復（`MM_MARKS_UPDATED` 受信→`render`、`MM_SET_*`送信）の検証を `emitMessage` で追加
3. 層3: 主要フロー（パネル表示→並べ替え→撮影）を追加。CI に xvfb を入れて実行
4. CI（GitHub Actions）: push で層1+2、PR/ナイトリーで層3
