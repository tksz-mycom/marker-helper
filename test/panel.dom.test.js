// @vitest-environment jsdom
//
// 層2: 実際の panel.html を jsdom に流し込み、panel.js の内部関数を直接呼んで
// render の描画順・連番・並べ替え・端ボタンの無効化・並べ替え中の再描画抑止(#2)を検証する。
const fs = require("fs");
const path = require("path");
const { installChromeMock } = require("./helpers/chromeMock.js");

let panel, listEl;

const order = () => [...listEl.querySelectorAll(".mm-item")].map((li) => Number(li.dataset.id));
const badges = () => [...listEl.querySelectorAll(".mm-item .mm-badge")].map((b) => b.textContent);

function mark(id, over) {
  return Object.assign(
    {
      id,
      label: id,
      selector: `#e${id}`,
      xpath: `//*[@id="e${id}"]`,
      tag: "div",
      text: `t${id}`,
      note: "",
      group: "",
      color: "#ff0000",
      lineStyle: "solid",
      width: 2,
      padding: 2,
      radius: 4,
      cornerShape: "round",
      transparency: 0,
      showLabel: null,
      detached: false,
    },
    over || {},
  );
}

beforeAll(() => {
  // 実 panel.html を読み込み、要素とテンプレートを用意する
  const html = fs.readFileSync(path.join(__dirname, "../panel/panel.html"), "utf8");
  const inner = html.replace(/<!doctype[^>]*>/i, "").replace(/<\/?html[^>]*>/gi, "");
  document.documentElement.innerHTML = inner;
  // content/panel と同じ前提で chrome と MMShared をグローバルに用意
  installChromeMock();
  globalThis.MMShared = Object.assign(
    {},
    require("../shared/label.js"),
    require("../shared/reorderController.js"),
    require("../shared/cornerShape.js"),
    require("../shared/i18n.js"),
  );
  // panel.js を読み込む（module.exports 経由で内部関数取得、bootstrap は走らない）
  panel = require("../panel/panel.js");
  listEl = document.getElementById("mm-list");
});

afterEach(() => {
  panel.__test.resetReorder();
  panel.render([]);
});

describe("panel render / 並べ替え（層2: jsdom）", () => {
  test("render はマークを順番どおり描画し連番を振る", () => {
    panel.render([mark(1), mark(2), mark(3)]);
    expect(order()).toEqual([1, 2, 3]);
    expect(badges()).toEqual(["1", "2", "3"]);
  });

  test("moveItem(上) は隣と入れ替え連番を位置基準で振り直す", () => {
    panel.render([mark(1), mark(2), mark(3)]);
    panel.moveItem(listEl.querySelector('[data-id="2"]'), -1);
    expect(order()).toEqual([2, 1, 3]);
    expect(badges()).toEqual(["1", "2", "3"]);
  });

  test("moveItemToEdge(下) は末尾へ一気に移動する", () => {
    panel.render([mark(1), mark(2), mark(3)]);
    panel.moveItemToEdge(listEl.querySelector('[data-id="1"]'), 1);
    expect(order()).toEqual([2, 3, 1]);
  });

  test("updateMoveBoundaries は端の対応ボタンを無効化する", () => {
    panel.render([mark(1), mark(2), mark(3)]);
    const items = [...listEl.querySelectorAll(".mm-item")];
    const dis = (li, sel) => li.querySelector(sel).disabled;
    expect(dis(items[0], ".mm-act-move-up")).toBe(true);
    expect(dis(items[0], ".mm-act-move-top")).toBe(true);
    expect(dis(items[0], ".mm-act-move-down")).toBe(false);
    expect(dis(items[2], ".mm-act-move-down")).toBe(true);
    expect(dis(items[2], ".mm-act-move-bottom")).toBe(true);
    expect(dis(items[1], ".mm-act-move-up")).toBe(false);
  });

  test("角の形式は歯車の吹き出しのセレクトに反映される（未指定は標準）", () => {
    panel.render([mark(1, { cornerShape: "squircle" }), mark(2, { cornerShape: undefined })]);
    const corner = (id) => listEl.querySelector(`[data-id="${id}"] .mm-style-corner`).value;
    expect(corner(1)).toBe("squircle");
    expect(corner(2)).toBe("round");
  });

  test("superellipse(k) は「数値指定」として曲率の行に展開される", () => {
    panel.render([mark(1, { cornerShape: "superellipse(3.5)" }), mark(2)]);
    const row = (id) => listEl.querySelector(`[data-id="${id}"] .mm-style-corner-k`);
    const sel = (id) => listEl.querySelector(`[data-id="${id}"] .mm-style-corner`).value;
    expect(sel(1)).toBe("superellipse");
    expect(row(1).hidden).toBe(false);
    expect(listEl.querySelector('[data-id="1"] .mm-style-corner-k-range').value).toBe("3.5");
    // プリセット選択のマークでは曲率の行を出さない
    expect(sel(2)).toBe("round");
    expect(row(2).hidden).toBe(true);
  });

  test("並べ替え確定中の外部更新(render)は抑止されDOM順が保たれる（#2）", () => {
    vi.useFakeTimers();
    try {
      panel.render([mark(1), mark(2), mark(3)]);
      panel.moveItem(listEl.querySelector('[data-id="2"]'), -1);
      expect(order()).toEqual([2, 1, 3]);
      panel.render([mark(1), mark(2), mark(3)]); // 旧順の割り込み再描画
      expect(order()).toEqual([2, 1, 3]); // 抑止され維持される
    } finally {
      vi.useRealTimers();
    }
  });
});
