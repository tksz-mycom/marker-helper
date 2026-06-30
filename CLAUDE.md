# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

「Marker:HELPER」は、Webページ上の要素をホバーで強調・クリックで番号付きマークとして固定し、サイドパネルでCSSセレクタを確認・コピーできるER Chrome 拡張機能（Manifest V3）です。

## ビルド・テスト・実行

- **ビルドステップは無い**。バニラ JS / HTML / CSS で、トランスパイルもバンドルも依存パッケージもありません（`package.json` 無し）。ファイルを直接編集すれば反映されます。
- **動作確認**: `chrome://extensions` →「デベロッパー モード」ON →「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択。コード変更後は拡張機能カードの再読み込みボタンを押す。content script の変更は対象ページのリロードも必要。
- **自動テストは無い**。検証はブラウザでの手動確認で行う。
- **アイコン**: `icons/icon.svg` が元データ。PNG（16/48/128）は手動で書き出す。

## アーキテクチャ

3つの独立した実行コンテキストがメッセージパッシングで連携する。**マーク状態の唯一の保持者（source of truth）は content script** であり、永続化はしない（タブ内メモリのみ。リロード・タブクローズで消える）。

**設定（スタイル・ラベル表示）は永続化する**。マーク状態とは別扱いで、`style`（色・線種・線幅・余白・角丸）・`showLabel`・`labelPos`（連番バッジの表示位置 tl/tr/bl/br）は `chrome.storage.local`（キー `mm:settings`）に保存する。content は注入時に `restoreSettings` で復元し、`MM_SET_STYLE` / `MM_SET_LABELS` / `MM_SET_LABEL_POS` 受信時に `persistSettings` で保存する。popup は既存の `MM_GET_STATE` 経由で復元済みの値を反映するため、永続化ロジックを持たない。`manifest.json` の `storage` 権限が必要。

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
| `MM_GET_STATE` | popup/panel → content | `enabled` / `style` / `showLabel` / `labelPos` / `marks` を取得 |
| `MM_SET_ENABLED` | popup → content | マークモード ON/OFF |
| `MM_SET_STYLE` | popup → content | 新規マークの色・線種・線幅・余白・角丸 |
| `MM_SET_LABELS` | popup → content | 連番バッジの表示/非表示（既定OFF） |
| `MM_SET_LABEL_POS` | popup → content | 連番バッジの表示位置（tl/tr/bl/br、既定tl） |
| `MM_CLEAR_ALL` | popup/panel → content | 全マーク削除 |
| `MM_REMOVE_MARK` | panel → content | 指定IDのマーク削除 |
| `MM_REORDER_MARKS` | panel → content | 指定ID順にマークを並べ替え（連番ラベルを入替え） |
| `MM_SCROLL_TO` | panel → content | 指定IDの要素へスクロール＆点滅 |
| `MM_EXPORT_MARKS` | panel → content | 復元用にマーク一覧（全スタイル）と `location.href` を取得（保存は panel が実施） |
| `MM_IMPORT_MARKS` | panel → content | JSONのマーク一覧を渡して復元。各 selector で要素を再特定し `{ok,restored,skipped}` を返す |
| `MM_CAPTURE_PREPARE` | panel → content | 撮影下準備。対象を中央へスクロールし、`hideIds`（未チェックのマーク）の枠/番号だけを一時非表示にして矩形(`rect`/`dpr`/`viewport`)を返す |
| `MM_CAPTURE_RESTORE` | panel → content | 撮影後にオーバーレイの一時非表示を解除する |
| `MM_MARKS_UPDATED` | content → broadcast | マーク更新通知（popup=件数、panel=一覧を再描画） |

（注: README のメッセージ表は `MM_SET_LABELS` が未記載で古い。コードを正とすること。）

**マーク一覧のエクスポート／インポート（panel 専用）**。panel の「エクスポート／インポート」で、現在のマーク一覧を1つのJSON（`{app:"marker-helper", kind:"marks", version, exportedAt, url, marks}`）として**PCに保存・復元**できる。マーク本体は永続化しない方針のままで、入出力はユーザー操作時のファイル経由でのみ行う。エクスポートは content が `serializeMarksForExport`（`padding`/`radius`/`transparency` を含む復元用の全スタイル。表示用 `serializeMarks` とは別）とページURLを返し、panel が `Blob`+アンカー `download` で保存する（`downloads` 権限不要）。インポートは隠し `#mm-import-file` でファイルを読み、サイズ上限（2MB）・`app`/`kind` 識別子・配列形を検証してから `MM_IMPORT_MARKS` で content に渡す。content の `importMarks` は **既存マークを置き換える方式**で、各 `item.selector` を `document.querySelector` で再特定し、見つかった要素のみ `buildMark`（`addMark` と共用の生成関数）で復元、スタイルは `sanitizeStyle` でクランプする。見つからない／不正セレクタ／重複は除外し、復元/除外件数を panel のトーストで通知する。`buildMark` は `addMark` から抽出した共通生成関数で、後処理（`relabel`/`ensureLoop`/`syncPositions`/`broadcast`）は呼び出し側が行う。

**マーク部分のスクリーンショット（panel 専用）**。マーク一覧の各項目から「画像保存」「画像コピー」で、その要素部分だけを PNG として取得できる。panel が content に `MM_CAPTURE_PREPARE` を送って対象を中央へスクロールし、`chrome.tabs.captureVisibleTab` でビューポート画像を取得、panel 側 `<canvas>` で content が返す矩形×`devicePixelRatio` で切り出す。**1枚の画像に複数マークが写り込むため、枠/番号の表示は各マークの「マーカー込み」設定を個別に反映する**。panel は未チェックの行 id を `excludedMarkIds()` で集めて `hideIds` として送り、content の `prepareCapture` は**そのマークの枠ボックス・連番バッジだけ `visibility:hidden`** にして残り（チェック済み）は表示のまま写す（オーバーレイ全体は隠さない）。撮影後は隠した要素を `restoreHidden` で個別復帰する。切り出し矩形は content の `captureRect` が決め、対象が `clean=true`（=未チェック・枠なし）なら素の `mark.el.getBoundingClientRect()`、`clean=false`（=チェック済み・枠あり）は**枠ボックスと連番バッジの実矩形を含む union 矩形**を返す（枠・バッジは要素の外側に描かれるため、要素ぴったりだと切り落とされて写らない）。撮影後は `MM_CAPTURE_RESTORE` で表示を戻す（content 側にも保険のタイマー復帰あり）。枠・番号を写し込むかは **ヘッダーのトグル `#mm-shot-marks`（既定値）と各マーク行の「マーカー込み」チェック（`.mm-act-shot-incl`、行ごとの上書き）** の2段階で決まる。各行の撮影は**その行のチェックの実値**（対象は `!shotIncl.checked` を `clean` に、写り込む他マークは `hideIds` に反映）に従う。行の初期値は、上書きがあればそれ・無ければヘッダー既定値。**ヘッダー既定値は永続化する**が、**行ごとの上書きはタブ内メモリのみ**（`shotInclOverrides` Map、`mark.id` キー）でマーク本体と同じ寿命とし永続化しない（リロードで消える）。一覧から消えたマークの上書きは `render` で破棄する（id 使い回しによる誤適用防止）。ヘッダー既定値はマイカラー同様 **panel 専用のUI設定** で content には関与させず、`chrome.storage.local`（キー `mm:shotMarks`）に panel が `loadShotMarks` / `saveShotMarks` で直接読み書きする（`change` で保存し未上書き行へ反映するため再描画、起動時に復元）。出力は保存（Blob+アンカー download）とコピー（`ClipboardItem`）の両対応。`captureVisibleTab` には `activeTab` 権限を使う。**制限**: ビューポートより大きい縦長要素は見切れる（スクロール継ぎ合わせは未実装）。`detached` のマークは撮影不可。

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
