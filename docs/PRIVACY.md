# Privacy Policy / プライバシーポリシー (Marker:HELPER)

**[English](#english)** | **[日本語](#日本語)**

> **[Fill in / 記入欄]** Replace before publishing / 公開前に差し替えてください:
> - Effective date / 発効日: `2026-07-01`
> - Contact email / 連絡先メール: `squikole@gmail.com`
> - Public URL / 公開URL: `https://tksz-mycom.github.io/marker-helper/PRIVACY` (after enabling GitHub Pages / GitHub Pages 有効化後)

**Last updated / 最終更新日: 2026-07-01**

---

<a id="english"></a>

# English

This Privacy Policy explains how the Chrome extension "Marker:HELPER" (the "Extension") handles user data.

## Summary

The Extension **does not collect, transmit, or sell any personal data**. All data handled by the Extension is **stored only on the user's own device (browser)** and is never sent to any third party, including the developer.

## 1. Information Handled

To provide its features, the Extension handles the following information **only on the user's device**. None of this is transmitted to any external server.

| Data | Contents | Storage location | Retention |
|---|---|---|---|
| Settings | Frame style (color, line style, width, padding, corner radius), label visibility and position, custom colors, capture defaults | `chrome.storage.local` | Until the user deletes it |
| Mark data | Selector, sequence number, note, group, color, etc. of marked elements (per page, within the tab) | `chrome.storage.session` | Cleared when the browser is closed |

The Extension reads information about elements on the page being viewed (CSS selectors, element dimensions, text/background colors, text content, etc.) **on the spot, solely to display, inspect, copy, and capture marks**, but it does not store or transmit this information (except when the user explicitly performs an export operation).

## 2. Data Output via Explicit User Actions

The following occur **only through the user's own actions**, and the output destinations are limited to files on the user's device or the clipboard. No external transmission occurs.

- **Export / Import**: Saving or loading the mark list as a file (e.g., JSON) on the user's device.
- **Screenshots**: Saving an image of a target element to the user's device, or copying it to the clipboard.
- **Report output**: Saving an HTML file summarizing mark information to the user's device.

This data remains under the user's control, and the developer cannot access it.

## 3. Purpose of Permissions

| Permission | Purpose |
|---|---|
| Host permission (`<all_urls>`) | To draw, inspect, and capture markers on elements of any page the user is viewing. Although this is broad access, it is not used to transmit page content externally. |
| `activeTab` | To read the content of the active tab and capture screenshots of the visible area. |
| `tabs` | To identify the active tab to operate on and send messages to it. |
| `storage` | To store the "Settings" and "Mark data" described above on the device. |
| `sidePanel` | To display the mark list in the side panel. |

## 4. Sharing and Sale to Third Parties

The Extension **does not provide, share, or sell** user data to third parties. It also does not use any external services for advertising, analytics, or tracking.

## 5. Data Deletion

- Settings (`chrome.storage.local`) are deleted by clearing the Extension's data or by uninstalling the extension.
- Mark data (`chrome.storage.session`) is automatically cleared when the browser is closed.

## 6. Children's Privacy

The Extension is not directed to any specific age group and does not collect personal data.

## 7. Changes to This Policy

This policy may be revised without prior notice. When material changes are made, the "Last updated" date on this page will be updated.

## 8. Contact

For inquiries regarding this policy or the Extension, please contact:

- Email: `squikole@gmail.com`

---

<a id="日本語"></a>

# 日本語

本プライバシーポリシーは、Chrome 拡張機能「Marker:HELPER」（以下「本拡張」）における利用者データの取り扱いについて説明するものです。

## 要約

本拡張は、**利用者の個人データを収集・送信・販売しません**。本拡張が扱うすべてのデータは、**利用者自身の端末（ブラウザ）内にのみ保存**され、開発者を含む第三者に送信されることは一切ありません。

## 1. 収集・取り扱う情報

本拡張は、機能の提供のために以下の情報を**利用者の端末内でのみ**取り扱います。これらが外部のサーバーへ送信されることはありません。

| データ | 内容 | 保存場所 | 保存期間 |
|---|---|---|---|
| 設定 | 枠のスタイル（色・線種・線幅・余白・角丸）、連番ラベルの表示・位置、マイカラー、撮影既定値 | `chrome.storage.local` | 利用者が削除するまで |
| マーク情報 | マークした要素のセレクタ・連番・メモ・グループ・色等（タブ内のページ単位） | `chrome.storage.session` | ブラウザを閉じると消去 |

本拡張は、閲覧中のページの要素情報（CSS セレクタ、要素の寸法・文字色・背景色・テキスト内容など）を**マークの表示・検査・コピー・撮影のためにその場で読み取ります**が、これらを保存・送信することはありません（利用者が明示的にエクスポート操作を行った場合を除く）。

## 2. 利用者が明示的に行う操作によるデータ出力

以下は、**利用者自身の操作によってのみ**発生し、出力先は利用者が指定する端末内のファイルやクリップボードに限られます。外部送信は行いません。

- **エクスポート / インポート**: マーク一覧を JSON 等のファイルとして利用者の端末に保存・読み込み
- **スクリーンショット**: 対象要素の画像を利用者の端末に保存、またはクリップボードへコピー
- **レポート出力**: マーク情報をまとめた HTML ファイルを利用者の端末に保存

これらのデータは利用者の管理下にあり、開発者がアクセスすることはできません。

## 3. 権限の利用目的

| 権限 | 利用目的 |
|---|---|
| ホスト権限（`<all_urls>`） | 利用者が閲覧している任意のページ上の要素にマーカーを描画・検査・撮影するため。広いアクセス権ですが、ページ内容を外部へ送信する目的では使用しません。 |
| `activeTab` | アクティブなタブの内容の読み取りと、表示領域のスクリーンショット取得のため。 |
| `tabs` | 操作対象のアクティブタブを特定し、メッセージを送るため。 |
| `storage` | 上記「設定」「マーク情報」を端末内に保存するため。 |
| `sidePanel` | マーク一覧をサイドパネルに表示するため。 |

## 4. 第三者への提供・販売

本拡張は、利用者データを**第三者に提供・共有・販売しません**。また、広告・分析・トラッキングのための外部サービスを一切利用しません。

## 5. データの削除

- 設定（`chrome.storage.local`）は、本拡張のデータをクリアする操作、または拡張機能のアンインストールにより削除されます。
- マーク情報（`chrome.storage.session`）は、ブラウザを閉じると自動的に消去されます。

## 6. 子どものプライバシー

本拡張は、特定の年齢層を対象としておらず、個人データを収集しません。

## 7. 本ポリシーの変更

本ポリシーは予告なく改定される場合があります。重要な変更がある場合は、本ページの「最終更新日」を更新します。

## 8. お問い合わせ

本ポリシーまたは本拡張に関するお問い合わせは、以下までご連絡ください。

- メール: `squikole@gmail.com`

---

> **Hosting example / 公開方法の例**: With GitHub Pages enabled, this page is served at `https://tksz-mycom.github.io/marker-helper/PRIVACY`. Register it under "Privacy" → "Privacy policy URL". / GitHub Pages 有効化後、本ページは `https://tksz-mycom.github.io/marker-helper/PRIVACY` で公開されます。「プライバシー」→「プライバシーポリシーの URL」に登録してください。
