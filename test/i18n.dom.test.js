// @vitest-environment jsdom
//
// 層2: applyI18n が data-i18n 系の属性を textContent / 属性へ適用することを検証する。
const i18n = require("../shared/i18n.js");

// 辞書に依存しないよう、キーをそのまま英訳に見立てるスタブ翻訳関数を渡す
const stub = (key) => `T:${key}`;

test("data-i18n は textContent へ適用する", () => {
  document.body.innerHTML = `<h2 data-i18n="a.b">元の文言</h2>`;
  i18n.applyI18n(document, stub);
  expect(document.querySelector("h2").textContent).toBe("T:a.b");
});

test("title / aria-label / placeholder の各属性へ適用する", () => {
  document.body.innerHTML = `
    <button data-i18n-title="a.title" data-i18n-aria-label="a.aria"></button>
    <input data-i18n-placeholder="a.ph" />`;
  i18n.applyI18n(document, stub);
  const btn = document.querySelector("button");
  expect(btn.getAttribute("title")).toBe("T:a.title");
  expect(btn.getAttribute("aria-label")).toBe("T:a.aria");
  expect(document.querySelector("input").getAttribute("placeholder")).toBe("T:a.ph");
});

test("root 自身に付いた data-i18n も適用する", () => {
  document.body.innerHTML = `<span id="s" data-i18n="a.self">元</span>`;
  i18n.applyI18n(document.getElementById("s"), stub);
  expect(document.getElementById("s").textContent).toBe("T:a.self");
});

test("DocumentFragment を渡せる", () => {
  document.body.innerHTML = `<template id="tpl"><li><span data-i18n="a.in"></span></li></template>`;
  const node = document.getElementById("tpl").content.firstElementChild.cloneNode(true);
  i18n.applyI18n(node, stub);
  expect(node.querySelector("span").textContent).toBe("T:a.in");
});

test("子要素を持つ要素の textContent 置換で子が壊れないよう、対象は葉に限る前提を確認する", () => {
  // data-i18n は「テキストだけを持つ要素」に付ける規約。付け方を誤ると子が消えることを明示しておく。
  document.body.innerHTML = `<p data-i18n="a.p">文言<br /><strong>強調</strong></p>`;
  i18n.applyI18n(document, stub);
  expect(document.querySelector("p").querySelector("strong")).toBeNull();
});
