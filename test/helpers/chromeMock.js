// 将来の層2(jsdom)テスト用の chrome.* 最小モック。
// 現在の純粋ロジックテスト（層1）では未使用だが、メッセージ往復やストレージを
// 伴う panel/content のテストを書くときの土台として用意しておく。
"use strict";

function memStore() {
  const data = {};
  return {
    get: (keys, cb) => {
      const out =
        typeof keys === "string"
          ? { [keys]: data[keys] }
          : Array.isArray(keys)
            ? Object.fromEntries(keys.map((k) => [k, data[k]]))
            : { ...data };
      cb(out);
    },
    set: (obj, cb) => {
      Object.assign(data, obj);
      cb && cb();
    },
    remove: (k, cb) => {
      delete data[k];
      cb && cb();
    },
  };
}

function installChromeMock() {
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: () => {},
      onMessage: { addListener: (f) => listeners.push(f) },
      lastError: null,
    },
    tabs: { sendMessage: () => {}, query: () => {} },
    storage: { local: memStore(), session: memStore() },
  };
  // テストから content/panel の onMessage ハンドラへメッセージを流し込むための補助
  return { emit: (msg, sender) => listeners.forEach((f) => f(msg, sender || {}, () => {})) };
}

module.exports = { installChromeMock, memStore };
