// 層1相当: 並べ替え確定タイミングの不変条件（#2 のレース回帰防止）。
// schedule/cancel を差し替え、delay を手動で進めて決定論的に検証する。
const { createReorderController } = require("../shared/reorderController.js");

function setup() {
  const calls = { commit: 0, sync: 0 };
  let pending = null;
  const ctl = createReorderController({
    commit: () => calls.commit++,
    sync: () => calls.sync++,
    schedule: (fn) => {
      pending = fn;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  });
  return { ctl, calls, flush: () => pending && pending() };
}

describe("createReorderController（#2 のレース回帰防止）", () => {
  test("移動時は即座に commit する（遅延commitへ戻したら失敗する）", () => {
    const { ctl, calls } = setup();
    ctl.onMove();
    expect(calls.commit).toBe(1); // 即時確定。旧DOMを後から読む競合を防ぐ
    expect(calls.sync).toBe(0);
  });

  test("確定中は render を抑止し、delay 後に解除して再同期する", () => {
    const { ctl, calls, flush } = setup();
    ctl.onMove();
    expect(ctl.shouldSkipRender()).toBe(true); // この間の外部更新の再描画を無視
    flush(); // delay 経過
    expect(ctl.shouldSkipRender()).toBe(false);
    expect(calls.sync).toBe(1); // 権威状態へ再同期
  });

  test("連続移動はタイマを張り直し、同期は最後の1回だけ", () => {
    const { ctl, calls, flush } = setup();
    ctl.onMove();
    ctl.onMove();
    expect(calls.commit).toBe(2); // 各移動で確定
    flush();
    expect(calls.sync).toBe(1); // 同期は最後の1回
  });
});
