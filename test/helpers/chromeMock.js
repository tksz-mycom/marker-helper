// 層2(jsdom)テスト用の chrome.* 最小モック。panel.js / content.js が読み込み時に
// 触れる API（onMessage/onActivated/onUpdated/windows、storage）を一通り用意する。
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
      cb && cb(out);
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

function evt() {
  const ls = [];
  return { addListener: (f) => ls.push(f), emit: (...a) => ls.forEach((f) => f(...a)) };
}

// globalThis.chrome を組み立てて返す。emitMessage で onMessage ハンドラへ流し込める。
function installChromeMock() {
  const onMessage = evt();
  globalThis.chrome = {
    runtime: {
      sendMessage: () => {},
      onMessage: { addListener: onMessage.addListener },
      lastError: null,
      getURL: (p) => p,
      id: "test-ext",
    },
    tabs: {
      sendMessage: (id, msg, cb) => {
        if (typeof cb === "function") cb(null);
      },
      query: (q, cb) => {
        const r = [];
        return cb ? cb(r) : Promise.resolve(r);
      },
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      captureVisibleTab: () => Promise.resolve(""),
    },
    storage: { local: memStore(), session: memStore() },
    windows: {
      onFocusChanged: { addListener: () => {} },
      WINDOW_ID_NONE: -1,
      get: () => Promise.resolve({ type: "normal" }),
      getLastFocused: () => Promise.resolve({ id: 1 }),
    },
  };
  return { emitMessage: (msg, sender) => onMessage.emit(msg, sender || {}, () => {}) };
}

module.exports = { installChromeMock };
