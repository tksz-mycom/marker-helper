// @vitest-environment jsdom
//
// I-1 回帰テスト: bootI18n が「言語確定(loadLang解決)より前に描かれた行」を、
// 確定直後の再描画で必ず正しい言語に作り直すことを検証する。
// panel.dom.test.js 等と異なり、Node の CommonJS では module.exports が常に
// truthy でテストシームの bootstrap 分岐が走らないことを逆手に取り、
// bootI18n をテストシームで直接呼び出して配線そのものを叩く
// （render/i18n を個別に叩くだけでは bootI18n の配線自体は検証できないため）。
const { makeMark: mark, bootPanelDom } = require("./helpers/panelFixture.js");

test("storage.local.get の解決が遅れても、確定直後の再描画で英語になる", async () => {
  // 実 panel.html を jsdom に流し込み、panel.dom.test.js と同じ前提を用意する
  bootPanelDom();

  // mm:lang=en を保存済みにしつつ、get の解決だけを意図的に遅らせる
  // （実運用での再現条件: storage.get が tabs.query/sendMessage より遅い）
  chrome.storage.local.set({ "mm:lang": "en" }, () => {});
  let releaseGate;
  const gate = new Promise((r) => (releaseGate = r));
  const realGet = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (keys, cb) => {
    gate.then(() => realGet(keys, cb));
  };

  // panel.js を読み込む（module.exports 経由で内部関数取得、bootstrap は走らない）
  const panel = require("../panel/panel.js");
  // このテストでは現在言語がまだ既定(ja)である前提を明示する
  MMShared.setLang("ja");

  try {
    // reload() 相当: loadLang 解決前に、堅牢性チップを持つ行が「日本語」で描かれる
    // #e1 は id 起点セレクタなので堅牢性は「安定」(strong) になる
    panel.render([mark(1)]);
    const robust = () => document.querySelector(".mm-robust");
    expect(robust().textContent).toBe("安定");

    // bootI18n を直接叩く（await はまだしない = gate で内部の loadLang が止まっている）
    const booted = panel.bootI18n();

    // 言語確定前: 行はまだ日本語のまま（＝バグが再現される状態）
    expect(robust().textContent).toBe("安定");

    // storage.get の解決を許可し、bootI18n の完了を待つ
    releaseGate();
    await booted;

    // 確定直後の再描画で英語になっていること（＝I-1修正の効果そのもの）
    expect(robust().textContent).toBe("Stable");
  } finally {
    // 他テストへ影響しないよう chrome.storage.local.get を元に戻す
    chrome.storage.local.get = realGet;
    panel.render([]);
  }
});
