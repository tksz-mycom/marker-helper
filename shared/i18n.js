// 文言の辞書と適用機構（popup / panel / テストで共有）。
// ブラウザでは globalThis.MMShared に生やし、Node(テスト)では module.exports する両対応モジュール。
// content script は日本語のユーザー向け文字列を持たないため読み込まない。
(function (root) {
  "use strict";

  const LANGS = ["ja", "en"];
  const FALLBACK = "ja";

  // 文言辞書。キーはフラットな文字列（例: "panel.toast.copied"）。
  // 件数を含む文言は ".one" / ".other" のサフィックスで単複を分ける。
  const MESSAGES = {
    ja: {
      "common.language": "言語",
      "common.markingMode.title": "マーキングモード",
      "common.markingMode.desc": "ホバーで強調・クリックで固定",
      "common.transparency": "透明度",
      "common.transparencyPct": "透明度(%)",
      "common.lineStyle": "線種",
      "common.line.solid": "実線",
      "common.line.dashed": "破線",
      "common.line.dotted": "点線",
      "common.lineWidth": "線幅",
      "common.lineWidthPx": "線幅(px)",
      "common.padding": "余白",
      "common.paddingPx": "余白(px)",
      "common.radius": "角丸",
      "common.radiusPx": "角丸(px)",
      "common.cornerShape": "角の形式",
      "common.corner.round": "標準",
      "common.corner.squircle": "なめらか",
      "common.corner.bevel": "面取り",
      "common.corner.scoop": "えぐり",
      "common.corner.notch": "切り欠き",
      "common.corner.square": "直角",
      "common.corner.superellipse": "数値指定",
      "common.cornerK": "曲率",
      "common.cornerKNum": "曲率(superellipse)",
      "common.pos.tl": "左上",
      "common.pos.tr": "右上",
      "common.pos.bl": "左下",
      "common.pos.br": "右下",
      "popup.openWindow.title": "一覧を別ウィンドウで開く（撮影時にページ幅を保てる）",
      "popup.openWindow.aria": "一覧を別ウィンドウで開く",
      "popup.openPanel.label": "一覧パネルを開く",
      "popup.unsupported.line1": "このページでは利用できません。",
      "popup.unsupported.line2": "通常のWebページ（http / https）で開いてください。",
      "popup.color.heading": "マーカーの色",
      "popup.color.myHeading": "マーカーの色（マイカラー）",
      "popup.color.myAria": "マイカラー（自分で登録した色）",
      "popup.preview.label": "プレビュー",
      "popup.display.heading": "表示",
      "popup.labels.title": "連番ラベル",
      "popup.labels.desc": "枠に番号バッジを表示",
      "popup.labelPos.aria": "ラベル位置",
      "popup.width.thin": "細",
      "popup.width.medium": "中",
      "popup.width.thick": "太",
      "popup.corner.round.title": "round: 通常の円弧の角丸",
      "popup.corner.squircle.title": "squircle: Mac風のなめらかな角",
      "popup.corner.bevel.title": "bevel: 直線で切り落とした角",
      "popup.corner.scoop.title": "scoop: 内側にえぐった角",
      "popup.corner.notch.title": "notch: 四角く切り欠いた角",
      "popup.corner.square.title": "square: 角丸なし（直角）",
      "popup.corner.superellipse.title": "superellipse(k): 曲率を数値で指定（0=面取り, 1=標準, 2=なめらか）",
      "popup.corner.hint": "このブラウザは角の形式に未対応のため「標準」で表示されます",
      "popup.myColor.slotTitle": "クリックで選択／ダブルクリックで色を変更",
      "popup.myColor.slotAria": "マイカラー {color}（ダブルクリックで色変更）",
      "popup.myColor.remove": "{color} を削除",
      "popup.myColor.add": "色を選んでマイカラーに追加",
      "panel.docTitle": "Marker:HELPER — 一覧",
      "panel.heading": "マーカー",
      "panel.opt.selector": "セレクタ",
      "panel.selformat.aria": "セレクタ形式",
      "panel.copyAll.title": "表示中の全セレクタをこの形式でコピー",
      "panel.copyAll.aria": "全セレクタをコピー",
      "panel.clearAll.label": "すべてクリア",
      "panel.opt.exportFormat": "出力形式",
      "panel.exportFormat.aria": "エクスポート形式",
      "panel.exportOption.json": "JSON（復元可）",
      "panel.export.title": "選択した形式でマーカー一覧を保存（エクスポート）",
      "panel.export.aria": "エクスポート",
      "panel.import.title": "JSONファイルからマーカー一覧を復元（インポート）",
      "panel.import.aria": "インポート",
      "panel.filter.placeholder": "絞り込み（タグ・セレクタ・テキスト・メモ）",
      "panel.filter.aria": "マーカーを絞り込み",
      "panel.shotAll.title": "表示中の全マーカーの画像をまとめて保存",
      "panel.shotAll.aria": "全マーカーの画像を保存",
      "panel.report.title": "番号・セレクタ・メモ・スクショをまとめたHTMLレポートを保存（印刷でPDF化できます）",
      "panel.report.aria": "レポートを保存",
      "panel.shotMarks.title": "各マーカーの既定値。行ごとの「マーカー込み」で個別に上書きできる",
      "panel.shotMarks.label": "スクショに枠・連番ラベルを含める（既定）",
      "panel.empty.line1": "まだマーカーがありません。",
      "panel.empty.line2a": "ポップアップかこのパネルで",
      "panel.empty.line2b": "をオンにして、",
      "panel.empty.line3": "ページ上の要素をクリックしてください。",
      "panel.nomatch": "条件に一致するマーカーがありません。",
      "common.save": "保存",
      "common.copy": "コピー",
      "panel.item.move.aria": "並び順の移動",
      "panel.item.move.top": "最上段へ移動",
      "panel.item.move.up": "1つ上へ移動",
      "panel.item.move.down": "1つ下へ移動",
      "panel.item.move.bottom": "最下段へ移動",
      "panel.item.detached": "消失",
      "panel.item.copySelector": "セレクタをコピー",
      "panel.item.locate": "要素の位置へ移動",
      "panel.item.elementActions": "要素の操作",
      "panel.item.copyText": "テキスト",
      "panel.item.inspect.label": "情報",
      "panel.item.inspect.aria": "要素の情報を表示",
      "panel.item.inspect.title": "要素の情報を表示（サイズ・色・コントラスト・role）",
      "panel.item.group.placeholder": "グループ名（任意）…",
      "panel.item.group.aria": "グループ名",
      "panel.item.note.placeholder": "メモを追加…",
      "panel.item.note.aria": "メモ",
      "panel.item.color.title": "このマーカーの色を変更",
      "panel.item.color.aria": "マーカーの色",
      "panel.item.style.title": "枠の詳細設定（線種・線幅・余白・角丸・透明度）",
      "panel.item.style.aria": "枠の詳細設定",
      "panel.item.style.cornerShort": "角の形",
      "panel.item.style.cornerTitle": "角の形式（CSS corner-shape）",
      "panel.item.showLabel.title": "このマーカーの連番ラベルの表示/非表示を切り替える",
      "panel.item.showLabel.label": "連番ラベルを表示",
      "panel.item.shot.aria": "スクリーンショット",
      "panel.item.shotIncl.title": "このマーカーのスクリーンショットにマーカー・連番ラベルを含める",
      "panel.item.shotIncl.label": "マーカー込み",
      "panel.item.close.label": "このマーカーをクリア",
      "common.unsupported": "このページでは利用できません",
      "panel.inspect.size": "サイズ",
      "panel.inspect.display": "表示",
      "panel.inspect.color": "文字色",
      "panel.inspect.background": "背景色",
      "panel.inspect.contrast": "コントラスト",
      "panel.inspect.contrastValue": "{value} : 1（{grade}）",
      "panel.inspect.contrastAALarge": "AA(大)",
      "panel.inspect.contrastFail": "不足",
      "panel.inspect.font": "フォント",
      "panel.inspect.spacing": "余白",
      "panel.selector.aria": "セレクタ（クリックで編集）",
      "panel.selector.title": "クリックして編集（Enterで確定／Escで取消）",
      "panel.selectorError.empty": "セレクタが空です",
      "panel.selectorError.nomatch": "一致する要素が見つかりません",
      "panel.selectorError.own": "拡張機能自身の要素は指定できません",
      "panel.selectorError.notfound": "対象のマークが見つかりません",
      "panel.selectorError.unknown": "セレクタを適用できません",
      "panel.robust.strong": "安定",
      "panel.robust.medium": "普通",
      "panel.robust.weak": "不安定",
      "panel.robust.strong.title": "id・安定属性・一意クラスで特定でき、壊れにくいセレクタです",
      "panel.robust.medium.title": "クラスや 1 段の位置指定に依存します。動的ページでは変わる可能性があります",
      "panel.robust.weak.title": "位置指定（nth-of-type）の連結に依存し、ページ構造の変化で壊れやすいセレクタです",
      "panel.toast.detached": "対象が見つかりません（消失したマーカー）",
      "panel.toast.noContent": "コピーできる{kind}がありません",
      "panel.toast.copiedContent": "#{n} の{kind}をコピーしました",
      "panel.toast.copyFailed": "コピーに失敗しました",
      "panel.toast.selectorApplied": "#{n} の要素を貼り替えました",
      "panel.toast.noMarksToCopy": "コピーするマーカーがありません",
      "panel.toast.copiedSelectors.one": "{n}件のセレクタをコピーしました",
      "panel.toast.copiedSelectors.other": "{n}件のセレクタをコピーしました",
      "panel.toast.copiedSelector": "#{n} のセレクタをコピーしました",
      "panel.item.noText": "（テキストなし）",
    },
    en: {
      "common.language": "Language",
      "common.markingMode.title": "Marking mode",
      "common.markingMode.desc": "Hover to highlight, click to pin",
      "common.transparency": "Transparency",
      "common.transparencyPct": "Transparency (%)",
      "common.lineStyle": "Line style",
      "common.line.solid": "Solid",
      "common.line.dashed": "Dashed",
      "common.line.dotted": "Dotted",
      "common.lineWidth": "Line width",
      "common.lineWidthPx": "Line width (px)",
      "common.padding": "Padding",
      "common.paddingPx": "Padding (px)",
      "common.radius": "Corner radius",
      "common.radiusPx": "Corner radius (px)",
      "common.cornerShape": "Corner shape",
      "common.corner.round": "Round",
      "common.corner.squircle": "Smooth",
      "common.corner.bevel": "Bevel",
      "common.corner.scoop": "Scoop",
      "common.corner.notch": "Notch",
      "common.corner.square": "Square",
      "common.corner.superellipse": "Custom",
      "common.cornerK": "Curvature",
      "common.cornerKNum": "Curvature (superellipse)",
      "common.pos.tl": "Top left",
      "common.pos.tr": "Top right",
      "common.pos.bl": "Bottom left",
      "common.pos.br": "Bottom right",
      "popup.openWindow.title": "Open the list in a separate window (keeps the page width when capturing)",
      "popup.openWindow.aria": "Open the list in a separate window",
      "popup.openPanel.label": "Open the list panel",
      "popup.unsupported.line1": "Not available on this page.",
      "popup.unsupported.line2": "Please open a regular web page (http / https).",
      "popup.color.heading": "Marker color",
      "popup.color.myHeading": "Marker color (My colors)",
      "popup.color.myAria": "My colors (colors you saved)",
      "popup.preview.label": "Preview",
      "popup.display.heading": "Display",
      "popup.labels.title": "Number label",
      "popup.labels.desc": "Show a number badge on the box",
      "popup.labelPos.aria": "Label position",
      "popup.width.thin": "Thin",
      "popup.width.medium": "Medium",
      "popup.width.thick": "Thick",
      "popup.corner.round.title": "round: standard circular corner",
      "popup.corner.squircle.title": "squircle: smooth Mac-like corner",
      "popup.corner.bevel.title": "bevel: corner cut off with a straight line",
      "popup.corner.scoop.title": "scoop: corner scooped inward",
      "popup.corner.notch.title": "notch: square notch cut out of the corner",
      "popup.corner.square.title": "square: no rounding (right angle)",
      "popup.corner.superellipse.title": "superellipse(k): set curvature numerically (0=bevel, 1=round, 2=smooth)",
      "popup.corner.hint": "This browser does not support corner shapes, so Round is used.",
      "popup.myColor.slotTitle": "Click to select, double-click to change the color",
      "popup.myColor.slotAria": "My color {color} (double-click to change)",
      "popup.myColor.remove": "Remove {color}",
      "popup.myColor.add": "Pick a color to add to My colors",
      "panel.docTitle": "Marker:HELPER — List",
      "panel.heading": "Markers",
      "panel.opt.selector": "Selector",
      "panel.selformat.aria": "Selector format",
      "panel.copyAll.title": "Copy all visible selectors in this format",
      "panel.copyAll.aria": "Copy all selectors",
      "panel.clearAll.label": "Clear all",
      "panel.opt.exportFormat": "Export format",
      "panel.exportFormat.aria": "Export format",
      "panel.exportOption.json": "JSON (restorable)",
      "panel.export.title": "Save the marker list in the selected format (export)",
      "panel.export.aria": "Export",
      "panel.import.title": "Restore the marker list from a JSON file (import)",
      "panel.import.aria": "Import",
      "panel.filter.placeholder": "Filter (tag, selector, text, note)",
      "panel.filter.aria": "Filter markers",
      "panel.shotAll.title": "Save images of all visible markers at once",
      "panel.shotAll.aria": "Save all marker images",
      "panel.report.title": "Save an HTML report with numbers, selectors, notes and screenshots (print it to make a PDF)",
      "panel.report.aria": "Save report",
      "panel.shotMarks.title": "Default for every marker. Each row can override it with \"With marker\".",
      "panel.shotMarks.label": "Include box and number label in screenshots (default)",
      "panel.empty.line1": "No markers yet.",
      "panel.empty.line2a": "Turn on ",
      "panel.empty.line2b": " in the popup or this panel,",
      "panel.empty.line3": "then click an element on the page.",
      "panel.nomatch": "No markers match the filter.",
      "common.save": "Save",
      "common.copy": "Copy",
      "panel.item.move.aria": "Reorder",
      "panel.item.move.top": "Move to top",
      "panel.item.move.up": "Move up",
      "panel.item.move.down": "Move down",
      "panel.item.move.bottom": "Move to bottom",
      "panel.item.detached": "Lost",
      "panel.item.copySelector": "Copy selector",
      "panel.item.locate": "Scroll to element",
      "panel.item.elementActions": "Element actions",
      "panel.item.copyText": "Text",
      "panel.item.inspect.label": "Info",
      "panel.item.inspect.aria": "Show element info",
      "panel.item.inspect.title": "Show element info (size, colors, contrast, role)",
      "panel.item.group.placeholder": "Group name (optional)…",
      "panel.item.group.aria": "Group name",
      "panel.item.note.placeholder": "Add a note…",
      "panel.item.note.aria": "Note",
      "panel.item.color.title": "Change this marker's color",
      "panel.item.color.aria": "Marker color",
      "panel.item.style.title": "Box settings (line style, width, padding, corner radius, transparency)",
      "panel.item.style.aria": "Box settings",
      "panel.item.style.cornerShort": "Corner",
      "panel.item.style.cornerTitle": "Corner shape (CSS corner-shape)",
      "panel.item.showLabel.title": "Toggle the number label for this marker",
      "panel.item.showLabel.label": "Show number label",
      "panel.item.shot.aria": "Screenshot",
      "panel.item.shotIncl.title": "Include the box and number label in this marker's screenshot",
      "panel.item.shotIncl.label": "With marker",
      "panel.item.close.label": "Clear this marker",
      "common.unsupported": "Not available on this page",
      "panel.inspect.size": "Size",
      "panel.inspect.display": "Display",
      "panel.inspect.color": "Text color",
      "panel.inspect.background": "Background",
      "panel.inspect.contrast": "Contrast",
      "panel.inspect.contrastValue": "{value} : 1 ({grade})",
      "panel.inspect.contrastAALarge": "AA (large)",
      "panel.inspect.contrastFail": "Fail",
      "panel.inspect.font": "Font",
      "panel.inspect.spacing": "Spacing",
      "panel.selector.aria": "Selector (click to edit)",
      "panel.selector.title": "Click to edit (Enter to apply, Esc to cancel)",
      "panel.selectorError.empty": "Selector is empty",
      "panel.selectorError.nomatch": "No element matches",
      "panel.selectorError.own": "The extension's own elements cannot be targeted",
      "panel.selectorError.notfound": "Marker not found",
      "panel.selectorError.unknown": "Cannot apply the selector",
      "panel.robust.strong": "Stable",
      "panel.robust.medium": "Fair",
      "panel.robust.weak": "Fragile",
      "panel.robust.strong.title": "Identified by an id, a stable attribute or a unique class. Unlikely to break.",
      "panel.robust.medium.title": "Depends on a class or one positional step. It may change on dynamic pages.",
      "panel.robust.weak.title": "Depends on chained positional steps (nth-of-type). It breaks easily when the page structure changes.",
      "panel.toast.detached": "The target element is gone (lost marker)",
      "panel.toast.noContent": "No {kind} to copy",
      "panel.toast.copiedContent": "Copied the {kind} of #{n}",
      "panel.toast.copyFailed": "Copy failed",
      "panel.toast.selectorApplied": "Re-targeted #{n}",
      "panel.toast.noMarksToCopy": "No markers to copy",
      "panel.toast.copiedSelectors.one": "Copied {n} selector",
      "panel.toast.copiedSelectors.other": "Copied {n} selectors",
      "panel.toast.copiedSelector": "Copied the selector of #{n}",
      "panel.item.noText": "(no text)",
    },
  };

  // 受け取った値が対応言語かを検証する。信頼境界（storage の値・DOM の値）で必ず通す。
  function normalizeLang(value) {
    return LANGS.includes(value) ? value : null;
  }

  // ブラウザの言語から既定の表示言語を決める（ja 始まりだけ日本語、他は英語）。
  function detectLang(navLang) {
    return String(navLang || "").toLowerCase().startsWith("ja") ? "ja" : "en";
  }

  // 辞書・言語・キー・変数から文言を組み立てる純粋関数。
  // 現在言語に依存しないのでテストしやすく、t() はこれに現在言語を渡すだけの薄い包み。
  function translate(messages, lang, key, vars) {
    const table = (messages && messages[lang]) || {};
    let lookup = key;
    // 単複: vars.n があり ".one" が定義されているキーだけ分岐する
    if (vars && typeof vars.n === "number" && table[key + ".one"] !== undefined) {
      lookup = vars.n === 1 ? key + ".one" : key + ".other";
    }
    const template = table[lookup];
    if (template === undefined) {
      // 画面が空にならないようキー文字列を返し、開発時に取りこぼしへ気づけるよう警告する
      console.warn("[Marker:HELPER] 未定義の文言キー:", key);
      return key;
    }
    return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
      vars && vars[name] !== undefined ? String(vars[name]) : whole,
    );
  }

  let current = FALLBACK;

  function setLang(lang) {
    current = normalizeLang(lang) || FALLBACK;
  }

  function getLang() {
    return current;
  }

  function t(key, vars) {
    return translate(MESSAGES, current, key, vars);
  }

  // data-i18n 系の属性名と適用先の属性の対応
  const ATTR_MAP = {
    "data-i18n-title": "title",
    "data-i18n-aria-label": "aria-label",
    "data-i18n-placeholder": "placeholder",
  };

  // root 自身と子孫から属性 attr を持つ要素を集める（root が Element のときは自身も対象）。
  function collect(root_, attr) {
    const found = Array.from(root_.querySelectorAll("[" + attr + "]"));
    if (root_.nodeType === 1 && root_.hasAttribute(attr)) found.unshift(root_);
    return found;
  }

  // data-i18n 系の属性を走査して文言を当てる。
  // innerHTML は使わず textContent と setAttribute だけで書き換えるため、
  // data-i18n は「テキストだけを持つ要素」に付けること（子要素があると消える）。
  function applyI18n(root_, translator) {
    const tr = translator || t;
    const scope = root_ || document;
    for (const el of collect(scope, "data-i18n")) {
      el.textContent = tr(el.getAttribute("data-i18n"));
    }
    for (const attr of Object.keys(ATTR_MAP)) {
      for (const el of collect(scope, attr)) {
        el.setAttribute(ATTR_MAP[attr], tr(el.getAttribute(attr)));
      }
    }
  }

  // ---- 言語の永続化 ----------------------------------------------------
  // popup / panel 専用の UI 設定として chrome.storage.local に保存する
  // （マイカラーやスクショ既定値と同じ扱いで、content には関与させない）。
  const LANG_KEY = "mm:lang";

  // 保存値があればそれを、無ければブラウザ言語からの自動判定を使う。
  // 自動判定の結果は保存しない（ユーザーが切替 UI を押したときに初めて保存し、以後それを優先する）。
  function loadLang() {
    const auto = () => detectLang(typeof navigator !== "undefined" ? navigator.language : "");
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(LANG_KEY, (data) => {
          void chrome.runtime.lastError;
          setLang(normalizeLang(data && data[LANG_KEY]) || auto());
          resolve(getLang());
        });
      } catch {
        setLang(auto());
        resolve(getLang());
      }
    });
  }

  function saveLang(lang) {
    setLang(lang);
    try {
      chrome.storage.local.set({ [LANG_KEY]: getLang() });
    } catch {
      /* storage 権限が無い等は無視 */
    }
  }

  // 他コンテキスト（popup ↔ panel）での切替に追従する。
  function watchLang(onChange) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes || !changes[LANG_KEY]) return;
        const next = normalizeLang(changes[LANG_KEY].newValue);
        if (!next || next === getLang()) return;
        setLang(next);
        onChange && onChange(next);
      });
    } catch {
      /* onChanged が無い環境では追従しない */
    }
  }

  // 文書全体へ現在言語を反映する。ちらつき防止クラスもここで外す。
  function applyDocumentLang(doc) {
    const d = doc || document;
    d.documentElement.lang = getLang();
    applyI18n(d);
    d.body && d.body.classList.remove("mm-i18n-pending");
  }

  // JA/EN セグメントの配線。押下で保存し、返り値で選択状態を後から再反映できる。
  function wireLangToggle(container, onChange) {
    const reflect = () => {
      for (const btn of container.children) {
        btn.classList.toggle("is-active", btn.dataset.value === getLang());
      }
    };
    container.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn || !normalizeLang(btn.dataset.value) || btn.dataset.value === getLang()) return;
      saveLang(btn.dataset.value);
      reflect();
      onChange && onChange(getLang());
    });
    reflect();
    return reflect;
  }

  // 保険: JS 側で例外が起きても画面が隠れたままにならないよう必ず解除する。
  if (typeof document !== "undefined") {
    setTimeout(() => document.body && document.body.classList.remove("mm-i18n-pending"), 1000);
  }

  const api = {
    MESSAGES, normalizeLang, detectLang, translate, setLang, getLang, t, applyI18n,
    LANG_KEY, loadLang, saveLang, watchLang, applyDocumentLang, wireLangToggle,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.MMShared = root.MMShared || {}), Object.assign(root.MMShared, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
