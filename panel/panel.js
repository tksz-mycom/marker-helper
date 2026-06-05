// Marker HELP — side panel
// アクティブタブのマーク一覧を表示し、コピー・位置移動・削除を行う。

const listEl = document.getElementById("mm-list");
const emptyEl = document.getElementById("mm-empty");
const countEl = document.getElementById("mm-count");
const tpl = document.getElementById("mm-item-tpl");
const toastEl = document.getElementById("mm-toast");

let activeTabId = null;

const UNSUPPORTED = /^(chrome|edge|brave|about|chrome-extension|view-source|devtools|data):/i;

// ---- 通信 -------------------------------------------------------------

function sendToTab(message) {
  return new Promise((resolve) => {
    if (activeTabId == null) return resolve(null);
    chrome.tabs.sendMessage(activeTabId, message, (res) => {
      void chrome.runtime.lastError;
      resolve(res ?? null);
    });
  });
}

async function resolveActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url || UNSUPPORTED.test(tab.url)) {
    activeTabId = null;
    return false;
  }
  activeTabId = tab.id;
  return true;
}

// ---- 描画 -------------------------------------------------------------

function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  // reflow を挟んで表示アニメを起こす
  void toastEl.offsetWidth;
  toastEl.classList.add("is-show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove("is-show");
    setTimeout(() => (toastEl.hidden = true), 200);
  }, 1400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // クリップボード API が使えない場合のフォールバック
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function buildItem(mark) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  // ドラッグで連番（並び順）を入れ替えられるようにする
  node.draggable = true;
  node.dataset.id = String(mark.id);
  const badge = node.querySelector(".mm-badge");
  const tag = node.querySelector(".mm-tag");
  const detached = node.querySelector(".mm-detached");
  const selector = node.querySelector(".mm-selector");
  const text = node.querySelector(".mm-text");

  badge.textContent = String(mark.label);
  badge.style.background = mark.color;
  tag.textContent = mark.tag;
  selector.textContent = mark.selector;
  text.textContent = mark.text || "（テキストなし）";
  detached.hidden = !mark.detached;

  const copyBtn = node.querySelector(".mm-act-copy");
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(mark.selector);
    if (ok) {
      copyBtn.textContent = "コピー済";
      copyBtn.classList.add("is-done");
      showToast(`#${mark.label} のセレクタをコピーしました`);
      setTimeout(() => {
        copyBtn.textContent = "コピー";
        copyBtn.classList.remove("is-done");
      }, 1200);
    } else {
      showToast("コピーに失敗しました");
    }
  });

  node.querySelector(".mm-act-locate").addEventListener("click", () => {
    sendToTab({ type: "MM_SCROLL_TO", id: mark.id });
  });

  node.querySelector(".mm-act-delete").addEventListener("click", () => {
    sendToTab({ type: "MM_REMOVE_MARK", id: mark.id });
    // 応答の broadcast で再描画されるが、即時反映も行う
    node.remove();
  });

  return node;
}

let currentMarks = [];

function render(marks) {
  currentMarks = marks || [];
  countEl.textContent = String(currentMarks.length);
  listEl.replaceChildren();

  if (currentMarks.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const frag = document.createDocumentFragment();
  for (const mark of currentMarks) frag.appendChild(buildItem(mark));
  listEl.appendChild(frag);
}

// ---- ドラッグ並べ替え -------------------------------------------------

// ドラッグ中要素を、ポインタのY座標から見て「次に来る」項目を返す（無ければ末尾）
function getDragAfterElement(y) {
  const items = [...listEl.querySelectorAll(".mm-item:not(.mm-dragging)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}

// DOMの並び順からバッジ番号を即時更新（送信→broadcast到着までのちらつき低減）
function relabelDom() {
  listEl.querySelectorAll(".mm-item .mm-badge").forEach((b, i) => {
    b.textContent = String(i + 1);
  });
}

// 現在のDOM順を content へ通知して連番を確定する
function commitOrder() {
  const ids = [...listEl.querySelectorAll(".mm-item")].map((li) => Number(li.dataset.id));
  relabelDom();
  sendToTab({ type: "MM_REORDER_MARKS", ids });
}

listEl.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".mm-item");
  if (!li) return;
  li.classList.add("mm-dragging");
  e.dataTransfer.effectAllowed = "move";
  try {
    e.dataTransfer.setData("text/plain", li.dataset.id);
  } catch {
    /* 一部環境では setData が失敗するが並べ替え自体には不要 */
  }
});

listEl.addEventListener("dragover", (e) => {
  const dragging = listEl.querySelector(".mm-dragging");
  if (!dragging) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const after = getDragAfterElement(e.clientY);
  if (after == null) listEl.appendChild(dragging);
  else listEl.insertBefore(dragging, after);
});

listEl.addEventListener("drop", (e) => {
  if (listEl.querySelector(".mm-dragging")) e.preventDefault();
});

listEl.addEventListener("dragend", () => {
  const dragging = listEl.querySelector(".mm-dragging");
  if (!dragging) return;
  dragging.classList.remove("mm-dragging");
  commitOrder();
});

let reloading = false;
let reloadQueued = false;
async function reload() {
  // 実行中に届いた要求は1回だけ末尾で再実行する（タブ切替連打の多重実行を防ぐ）
  if (reloading) {
    reloadQueued = true;
    return;
  }
  reloading = true;
  try {
    const ok = await resolveActiveTab();
    if (!ok) {
      render([]);
      return;
    }
    const state = await sendToTab({ type: "MM_GET_STATE" });
    render(state?.marks ?? []);
  } finally {
    reloading = false;
    if (reloadQueued) {
      reloadQueued = false;
      reload();
    }
  }
}

// ---- ヘッダー操作 -----------------------------------------------------

document.getElementById("mm-copy-all").addEventListener("click", async () => {
  if (currentMarks.length === 0) {
    showToast("コピーするマークがありません");
    return;
  }
  const all = currentMarks.map((m) => m.selector).join("\n");
  const ok = await copyText(all);
  showToast(ok ? `${currentMarks.length}件のセレクタをコピーしました` : "コピーに失敗しました");
});

document.getElementById("mm-clear-all").addEventListener("click", async () => {
  await sendToTab({ type: "MM_CLEAR_ALL" });
  render([]);
});

// ---- 同期 -------------------------------------------------------------

// content からの更新通知（アクティブタブのもののみ反映）
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "MM_MARKS_UPDATED" && sender.tab?.id === activeTabId) {
    render(msg.marks);
  }
});

// タブ切替・遷移に追従
chrome.tabs.onActivated.addListener(() => reload());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === activeTabId && info.status === "complete") reload();
});
chrome.windows?.onFocusChanged?.addListener(() => reload());

reload();
