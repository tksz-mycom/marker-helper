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
    },
    en: {
      "common.language": "Language",
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
