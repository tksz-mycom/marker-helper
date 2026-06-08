// Marker:HELPER — side panel
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
// 並べ替え直後の再描画ではフェードイン（点滅）を1回だけ抑制する
let suppressAnimOnce = false;
// ドラッグ中は再描画を抑止し、掴んでいる要素が破棄されないようにする
let isDragging = false;

function render(marks) {
  // ドラッグ操作中の再描画は掴んだ要素を消してしまうため抑止する。
  // ドラッグ確定後は commitOrder の更新通知で改めて描画される。
  if (isDragging) return;
  currentMarks = marks || [];
  countEl.textContent = String(currentMarks.length);
  listEl.classList.toggle("mm-no-anim", suppressAnimOnce);
  suppressAnimOnce = false;
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
  // この直後に届く更新通知の再描画ではアニメを抑制する
  suppressAnimOnce = true;
  sendToTab({ type: "MM_REORDER_MARKS", ids });
}

listEl.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".mm-item");
  if (!li) return;
  isDragging = true;
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
  isDragging = false;
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
  // タブ切替・再読み込み由来の描画では並べ替えのアニメ抑制を持ち越さない
  suppressAnimOnce = false;
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

// ---- マーク一覧の入出力（PCへのエクスポート／インポート） -------------

// マーク一覧ファイルの識別子と上限サイズ
const MARKS_FILE_APP = "marker-helper";
const MARKS_FILE_KIND = "marks";
const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2MB

// 日付を YYYYMMDD でファイル名に使う
function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 現在のマーク一覧（スタイル込み）を content から取得し JSON ファイルに保存する。
async function exportMarks() {
  if (activeTabId == null) {
    showToast("このページでは利用できません");
    return;
  }
  if (currentMarks.length === 0) {
    showToast("エクスポートするマークがありません");
    return;
  }
  const res = await sendToTab({ type: "MM_EXPORT_MARKS" });
  if (!res || !res.ok) {
    showToast("エクスポートに失敗しました");
    return;
  }
  const data = {
    app: MARKS_FILE_APP,
    kind: MARKS_FILE_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    url: res.url || "",
    marks: res.marks || [],
  };
  downloadJson(data, `marker-helper-marks-${todayStamp()}.json`);
  showToast(`${data.marks.length}件のマークをエクスポートしました`);
}

// 選択されたファイルを読み込み、検証してから content に渡してマークを復元する。
function importMarksFromFile(file) {
  if (!file) return;
  if (activeTabId == null) {
    showToast("このページでは利用できません");
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    showToast("ファイルが大きすぎます");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showToast("ファイルの読み込みに失敗しました");
  reader.onload = async () => {
    let data;
    try {
      data = JSON.parse(String(reader.result));
    } catch {
      showToast("読み込みに失敗しました（JSON形式エラー）");
      return;
    }
    if (
      !data ||
      typeof data !== "object" ||
      data.app !== MARKS_FILE_APP ||
      data.kind !== MARKS_FILE_KIND ||
      !Array.isArray(data.marks)
    ) {
      showToast("マーク一覧のファイルではありません");
      return;
    }
    const res = await sendToTab({ type: "MM_IMPORT_MARKS", marks: data.marks });
    if (!res || !res.ok) {
      showToast("インポートに失敗しました");
      return;
    }
    // 一覧は content からの更新通知で再描画される。ここでは結果だけ通知する
    if (res.skipped > 0) {
      showToast(`${res.restored}件を復元（${res.skipped}件は対象が見つからず除外）`);
    } else {
      showToast(`${res.restored}件のマークを復元しました`);
    }
  };
  reader.readAsText(file);
}

const importFileEl = document.getElementById("mm-import-file");
document.getElementById("mm-export").addEventListener("click", exportMarks);
document.getElementById("mm-import").addEventListener("click", () => importFileEl.click());
importFileEl.addEventListener("change", () => {
  const file = importFileEl.files && importFileEl.files[0];
  importMarksFromFile(file);
  // 同じファイルを連続で選べるよう値をリセット
  importFileEl.value = "";
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
