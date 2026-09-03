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
