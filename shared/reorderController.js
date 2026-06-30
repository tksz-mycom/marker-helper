// 並べ替え確定のタイミング制御（panel とテストで共有）。バグ#2対策の不変条件を集約する:
//   1) 並べ替えは即座に commit する（DOMが新順の今のうちに送る＝旧DOMを後から読む競合を防ぐ）
//   2) アニメ中は shouldSkipRender()=true で render を抑止し、スライド中断と旧順での再構築を防ぐ
//   3) delay 後に sync() で権威状態へ再同期する（抑止中に取りこぼした更新を回収）
// schedule/cancel を差し替え可能にして、テストからフェイクタイマで決定論的に検証できるようにする。
(function (root) {
  "use strict";

  function createReorderController(opts) {
    const commit = opts.commit;
    const sync = opts.sync;
    const delay = opts.delay != null ? opts.delay : 220;
    const schedule = opts.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    const cancel = opts.cancel || function (id) { clearTimeout(id); };

    let timer = null;
    let reordering = false;

    return {
      // render 側はこれが true の間、再描画をスキップする
      shouldSkipRender: function () {
        return reordering;
      },
      // 並べ替え直後に呼ぶ。即時 commit し、delay 後に再同期する。
      onMove: function () {
        reordering = true;
        commit();
        if (timer !== null) cancel(timer);
        timer = schedule(function () {
          timer = null;
          reordering = false;
          sync();
        }, delay);
      },
    };
  }

  const api = { createReorderController };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.MMShared = root.MMShared || {}), Object.assign(root.MMShared, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
