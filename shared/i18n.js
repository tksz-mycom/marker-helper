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
    ja: {},
    en: {},
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

  const api = { MESSAGES, normalizeLang, detectLang, translate, setLang, getLang, t, applyI18n };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.MMShared = root.MMShared || {}), Object.assign(root.MMShared, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
