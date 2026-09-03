// panel を jsdom で動かすための共通フィクスチャ（panel.dom / panel.bootI18n で共有）。
const fs = require("fs");
const path = require("path");
const { installChromeMock } = require("./chromeMock.js");

// 一覧の1行ぶんのマーク。content の serializeMarks が返す形に揃えてある。
// フィールドを増やすときはここだけを直せば両テストに載る。
function makeMark(id, over) {
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

// 実 panel.html を jsdom に流し込み、content/panel と同じ前提で
// chrome と MMShared をグローバルに用意する（panel.js の require は呼び出し側で行う）。
function bootPanelDom() {
  const html = fs.readFileSync(path.join(__dirname, "../../panel/panel.html"), "utf8");
  const inner = html.replace(/<!doctype[^>]*>/i, "").replace(/<\/?html[^>]*>/gi, "");
  document.documentElement.innerHTML = inner;

  installChromeMock();
  globalThis.MMShared = Object.assign(
    {},
    require("../../shared/label.js"),
    require("../../shared/reorderController.js"),
    require("../../shared/cornerShape.js"),
    require("../../shared/i18n.js"),
  );
}

module.exports = { makeMark, bootPanelDom };
