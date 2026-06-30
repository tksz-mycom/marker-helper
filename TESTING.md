# テスト方針（Marker:HELPER）

拡張機能本体は **ビルドレスの素の JS** を維持する。テストは **dev 専用** の `package.json` /
`node_modules`（gitignore 済み）だけで動かし、出荷物には一切影響させない。

## 実行

```bash
npm install      # 初回のみ（dev 依存: vitest）
npm test         # 層1テストを実行
npm run test:watch
```

## 3層構成

| 層 | 何を担保 | ツール | 状態 |
|---|---|---|---|
| 1. 純粋ロジック単体 | 実効値・並べ替え確定タイミング等の純粋関数 | vitest (node) | ✅ 導入済み |
| 2. DOM/メッセージ結合 | `render`/`buildItem`/メッセージ往復 | vitest + jsdom + `chrome`モック | 🚧 未（土台のみ） |
| 3. E2E（実Chromium） | content注入・実レイアウト・コンテキスト間連携 | Playwright（unpackedロード） | 🚧 未 |

## 設計：純粋ロジックは `shared/` の両対応モジュールへ

ファイルローカルな IIFE のままでは外から呼べずテスト不可。純粋ロジックは
`shared/*.js` に切り出し、**ブラウザでは `globalThis.MMShared` グローバル、Node では
`module.exports`** の両対応にする。出荷物に同梱（manifest / panel.html で読み込み）しつつ、
テストから `require` できる。

- `shared/label.js` … `effectiveShowLabel(mark, global)`（連番の3状態）→ content/panel が使用
- `shared/reorderController.js` … 並べ替え確定のタイミング制御 → panel が使用

## 回帰テスト（バグ→テスト化済み）

| バグ | テスト | 層 |
|---|---|---|
| #1 グローバルトグルが個別設定を上書き | `test/label.test.js`（明示falseがグローバルONでも保たれる） | 1 |
| #3 旧データで連番が出ない | `test/label.test.js`（undefined=継承） | 1 |
| #2 並べ替えが無言で取り消される | `test/reorderController.test.js`（即時commit＋抑止＋再同期） | 1 |

**運用ルール: 今後バグを直すたびに、まず失敗する回帰テストを1本足してから直す。**

## 次の一手

1. 純粋関数をさらに `shared/` へ（`generateSelector`/`generateXPath`/`sanitizeStyle`/`selectorRobustness`）
2. 層2: `test/helpers/chromeMock.js` を使い、panel の `render`/並べ替えDOM順/`updateMoveBoundaries` を jsdom で検証
   （panel.js は読み込み時の自動 `reload()` をテスト時にガードする小改修が前提）
3. 層3: Playwright で「マーク作成→パネル表示→並べ替え→撮影」の主要フロー1〜2本
4. CI（GitHub Actions）: push で層1+2、PR/ナイトリーで層3
