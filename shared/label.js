// 連番ラベルの実効表示値を求める唯一の関数（content / panel / テストで共有）。
// マークの個別設定が継承(null/undefined)ならグローバル既定に従い、明示値(true/false)は尊重する。
// ブラウザでは globalThis.MMShared に生やし、Node(テスト)では module.exports する両対応モジュール。
(function (root) {
  "use strict";

  // markShowLabel: true=常に表示 / false=常に非表示 / null|undefined=継承
  // globalShowLabel: グローバル既定（boolean）
  function effectiveShowLabel(markShowLabel, globalShowLabel) {
    return (markShowLabel ?? globalShowLabel) === true;
  }

  const api = { effectiveShowLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.MMShared = root.MMShared || {}), Object.assign(root.MMShared, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
