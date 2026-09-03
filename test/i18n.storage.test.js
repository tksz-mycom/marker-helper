// @vitest-environment jsdom
//
// 層2: mm:lang の読み書きと、他コンテキストの切替への追従を検証する。
const { installChromeMock } = require("./helpers/chromeMock.js");
const i18n = require("../shared/i18n.js");

let mock;

beforeEach(() => {
  mock = installChromeMock();
  i18n.setLang("ja");
  document.documentElement.lang = "";
  document.body.className = "";
});

test("LANG_KEY は mm: 接頭辞に揃える", () => {
  expect(i18n.LANG_KEY).toBe("mm:lang");
});

test("保存値が無いときはブラウザ言語から判定し、保存はしない", async () => {
  // jsdom の navigator.language は既定で en-US
  const lang = await i18n.loadLang();
  expect(lang).toBe("en");
  const stored = await new Promise((r) => chrome.storage.local.get("mm:lang", r));
  expect(stored["mm:lang"]).toBeUndefined();
});

test("保存値があればブラウザ言語より優先する", async () => {
  await new Promise((r) => chrome.storage.local.set({ "mm:lang": "ja" }, r));
  expect(await i18n.loadLang()).toBe("ja");
});

test("保存値が不正なら自動判定にフォールバックする", async () => {
  await new Promise((r) => chrome.storage.local.set({ "mm:lang": "fr" }, r));
  expect(await i18n.loadLang()).toBe("en");
});

test("saveLang は現在言語を更新して保存する", async () => {
  i18n.saveLang("en");
  expect(i18n.getLang()).toBe("en");
  const stored = await new Promise((r) => chrome.storage.local.get("mm:lang", r));
  expect(stored["mm:lang"]).toBe("en");
});

test("watchLang は他コンテキストの変更で呼ばれ、現在言語を更新する", () => {
  const seen = [];
  i18n.watchLang((lang) => seen.push(lang));
  mock.emitStorageChange({ "mm:lang": { newValue: "en" } }, "local");
  expect(i18n.getLang()).toBe("en");
  expect(seen).toEqual(["en"]);
});

test("watchLang は同じ言語・別領域・不正値では呼ばない", () => {
  const seen = [];
  i18n.setLang("ja");
  i18n.watchLang((lang) => seen.push(lang));
  mock.emitStorageChange({ "mm:lang": { newValue: "ja" } }, "local");
  mock.emitStorageChange({ "mm:lang": { newValue: "en" } }, "session");
  mock.emitStorageChange({ "mm:lang": { newValue: "fr" } }, "local");
  mock.emitStorageChange({ "mm:other": { newValue: "en" } }, "local");
  expect(seen).toEqual([]);
});

test("applyDocumentLang は lang 属性を更新し、ちらつき防止クラスを外す", () => {
  document.body.classList.add("mm-i18n-pending");
  i18n.setLang("en");
  i18n.applyDocumentLang(document);
  expect(document.documentElement.lang).toBe("en");
  expect(document.body.classList.contains("mm-i18n-pending")).toBe(false);
});

describe("wireLangToggle", () => {
  function setup() {
    document.body.innerHTML = `
      <div id="mm-lang">
        <button type="button" data-value="ja">JA</button>
        <button type="button" data-value="en">EN</button>
      </div>`;
    return document.getElementById("mm-lang");
  }

  test("現在言語のボタンに is-active を付ける", () => {
    const box = setup();
    i18n.setLang("en");
    i18n.wireLangToggle(box);
    expect(box.querySelector('[data-value="en"]').classList.contains("is-active")).toBe(true);
    expect(box.querySelector('[data-value="ja"]').classList.contains("is-active")).toBe(false);
  });

  test("押下で保存・選択状態の更新・コールバックが起きる", () => {
    const box = setup();
    i18n.setLang("ja");
    const seen = [];
    i18n.wireLangToggle(box, (lang) => seen.push(lang));
    box.querySelector('[data-value="en"]').click();
    expect(i18n.getLang()).toBe("en");
    expect(seen).toEqual(["en"]);
    expect(box.querySelector('[data-value="en"]').classList.contains("is-active")).toBe(true);
  });

  test("同じ言語を押しても何も起きない", () => {
    const box = setup();
    i18n.setLang("ja");
    const seen = [];
    i18n.wireLangToggle(box, (lang) => seen.push(lang));
    box.querySelector('[data-value="ja"]').click();
    expect(seen).toEqual([]);
  });
});
