# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

「Marker HELP」は、Webページ上の要素をホバーで強調・クリックで番号付きマークとして固定し、サイドパネルでCSSセレクタを確認・コピーできる Chrome 拡張機能（Manifest V3）です。

## ビルド・テスト・実行

- **ビルドステップは無い**。バニラ JS / HTML / CSS で、トランスパイルもバンドルも依存パッケージもありません（`package.json` 無し）。ファイルを直接編集すれば反映されます。
- **動作確認**: `chrome://extensions` →「デベロッパー モード」ON →「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択。コード変更後は拡張機能カードの再読み込みボタンを押す。content script の変更は対象ページのリロードも必要。
- **自動テストは無い**。検証はブラウザでの手動確認で行う。
- **アイコン**: `icons/icon.svg` が元データ。PNG（16/48/128）は手動で書き出す。

## アーキテクチャ

3つの独立した実行コンテキストがメッセージパッシングで連携する。**マーク状態の唯一の保持者（source of truth）は content script** であり、永続化はしない（タブ内メモリのみ。リロード・タブクローズで消える）。

**設定（スタイル・ラベル表示）は永続化する**。マーク状態とは別扱いで、`style`（色・線種・線幅・余白・角丸）と `showLabel` は `chrome.storage.local`（キー `mm:settings`）に保存する。content は注入時に `restoreSettings` で復元し、`MM_SET_STYLE` / `MM_SET_LABELS` 受信時に `persistSettings` で保存する。popup は既存の `MM_GET_STATE` 経由で復元済みの値を反映するため、永続化ロジックを持たない。`manifest.json` の `storage` 権限が必要。

**マイカラー（カスタムパレット）も永続化する**。ユーザーが「枠の色」の「マイカラー」で登録した色（最大18・9列×2行・HEX形式検証あり）は `chrome.storage.local`（キー `mm:customColors`）に保存する。これは **popup 専用のUI設定** であり content には関与させない（popup が `loadCustomColors` / `saveCustomColors` で直接読み書きし、空き枠の「＋」で現在色を追加、登録済みスロットの **ダブルクリックで色を変更**、ホバーで出る「×」で削除する）。追加・変更には共用の隠しカラーピッカー（`#mm-add-color`）を使い、`editingIndex`（-1=追加／0以上=変更）で用途を分岐する。任意色用の「カスタム」ピッカーはマイカラーに統合したため廃止した。

| コンテキスト | ファイル | 役割 |
|---|---|---|
| content script | `content/content.js`, `content/content.css` | マーク状態を保持。ホバー/クリック検出、オーバーレイ描画、セレクタ生成 |
| popup | `popup/popup.{html,css,js}` | スタイル選択・マークモード切替・サイドパネル起動。状態は持たず content へ転送 |
| side panel | `panel/panel.{html,css,js}` | アクティブタブのマーク一覧表示・コピー・移動・削除 |
| service worker | `background.js` | `setPanelBehavior({openPanelOnActionClick:false})` のみ。パネルは popup から明示的に開く |

### データフロー（メッセージプロトコル）

popup / panel は `chrome.tabs.sendMessage` でアクティブタブの content に指示を出し、content は更新を `chrome.runtime.sendMessage` でブロードキャストする。受信側は **`sender.tab?.id === activeTabId`** で自タブのものだけを反映する（複数タブの混線防止）。

| type | 方向 | 用途 |
|---|---|---|
| `MM_GET_STATE` | popup/panel → content | `enabled` / `style` / `showLabel` / `marks` を取得 |
| `MM_SET_ENABLED` | popup → content | マークモード ON/OFF |
| `MM_SET_STYLE` | popup → content | 新規マークの色・線種・線幅・余白・角丸 |
| `MM_SET_LABELS` | popup → content | 連番バッジの表示/非表示（既定OFF） |
| `MM_CLEAR_ALL` | popup/panel → content | 全マーク削除 |
| `MM_REMOVE_MARK` | panel → content | 指定IDのマーク削除 |
| `MM_SCROLL_TO` | panel → content | 指定IDの要素へスクロール＆点滅 |
| `MM_MARKS_UPDATED` | content → broadcast | マーク更新通知（popup=件数、panel=一覧を再描画） |

（注: README のメッセージ表は `MM_SET_LABELS` が未記載で古い。コードを正とすること。）

## 重要な実装上の不変条件

- **ページDOMは書き換えない**。枠とバッジはオーバーレイ層（`#mm-overlay-root`, `pointer-events:none`）に描画し、`requestAnimationFrame` のループ（`runLoop`）で対象要素の `getBoundingClientRect()` に追従させる。位置は `transform: translate()` で当てる。
- **追従ループは必要時のみ回す**。マークが無く・マークモードもOFFのアイドル時は `runLoop` を停止して CPU を消費しない（`ensureLoop` / `loopId`）。
- **マークは要素参照（`mark.el`）で保持**し、セレクタ文字列では追跡しない。SPA再描画等で要素が消えると `serializeMarks` が `detached: true` を返し、一覧に「消失」表示。
- **連番（`label`）は配列の並び順から都度振り直す**（`relabel()`）。内部ID（`mark.id`, 単調増加カウンタ）とは別物で、削除後も 1 から連番を維持する。badge表示・panel一覧はこの `label` を使う。
- **マークはトグル**。同一要素を再クリックすると `addMark` が既存マークを解除する。
- **クリックは capture フェーズで `preventDefault`/`stopPropagation`** し、ページ本来の遷移・送信を抑止してマーク操作に充てる。自前のオーバーレイ要素は `isOwnNode` で除外する。
- **二重注入ガード**: content は `window.__manualMarkerLoaded` で多重評価を防ぐ。
- **非対応ページの扱い**: popup/panel は `UNSUPPORTED` 正規表現（`chrome:`/`chrome-extension:`/`view-source:` 等）と content からの応答有無で判定し、応答が無ければ非対応UIを表示する。

## セレクタ生成（content.js `generateSelector`）

一意な `id` があれば `#id` を最優先。無ければ `tag:nth-of-type(n)` を `body` まで遡って ` > ` 連結。動的ページでは安定しないことがある（README「制限事項」参照）。

## コード規約

既存コードは日本語コメント・`(() => { "use strict" })()` IIFE（content）・`els` オブジェクトへの DOM 参照集約・スタイル更新時のイミュータブル更新（`style = { ...style, ... }`）といった慣習に従う。新規コードもこれに合わせること。
