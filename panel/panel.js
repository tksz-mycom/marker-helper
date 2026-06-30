// Marker:HELPER — side panel
// アクティブタブのマーク一覧を表示し、コピー・位置移動・削除を行う。

const listEl = document.getElementById("mm-list");
const emptyEl = document.getElementById("mm-empty");
const countEl = document.getElementById("mm-count");
const tpl = document.getElementById("mm-item-tpl");
const toastEl = document.getElementById("mm-toast");
const includeMarksEl = document.getElementById("mm-shot-marks");
const enabledEl = document.getElementById("mm-enabled");
const selFormatEl = document.getElementById("mm-selformat");

let activeTabId = null;

// 表示・コピーするセレクタ形式（"css" | "xpath"）。panel 専用の UI 設定として永続化する。
const SELFORMAT_KEY = "mm:selectorFormat";
let selectorFormat = "css";

function loadSelectorFormat() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(SELFORMAT_KEY, (data) => {
        void chrome.runtime.lastError;
        const v = data && data[SELFORMAT_KEY];
        if (v === "css" || v === "xpath") selectorFormat = v;
        applySelectorFormatUI();
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function saveSelectorFormat() {
  try {
    chrome.storage.local.set({ [SELFORMAT_KEY]: selectorFormat });
  } catch {
    /* storage 権限が無い等は無視 */
  }
}

// セグメントボタンの選択状態を現在の selectorFormat に合わせる
function applySelectorFormatUI() {
  for (const btn of selFormatEl.children) {
    btn.classList.toggle("is-active", btn.dataset.value === selectorFormat);
  }
}

// マークから現在の形式に応じたセレクタ文字列を取り出す（xpath 欠落時は CSS にフォールバック）
function selectorOf(mark) {
  if (selectorFormat === "xpath" && mark.xpath) return mark.xpath;
  return mark.selector;
}

selFormatEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-value]");
  if (!btn) return;
  const next = btn.dataset.value;
  if (next !== "css" && next !== "xpath") return;
  if (next === selectorFormat) return;
  selectorFormat = next;
  applySelectorFormatUI();
  saveSelectorFormat();
  // 表示中のセレクタ文字列を切り替えるため再描画（点滅は抑止）
  suppressAnimOnce = true;
  render(currentMarks);
});

const UNSUPPORTED = /^(chrome|edge|brave|about|chrome-extension|view-source|devtools|data):/i;

// ---- スクショ設定の永続化 ---------------------------------------------
// 「スクリーンショットにマーカー・連番ラベルを含める」トグルの状態を保存する。
// content には関与させず panel 専用の UI 設定として chrome.storage.local に保存する。
const SHOT_MARKS_KEY = "mm:shotMarks";

function loadShotMarks() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(SHOT_MARKS_KEY, (data) => {
        void chrome.runtime.lastError;
        includeMarksEl.checked = !!(data && data[SHOT_MARKS_KEY]);
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function saveShotMarks() {
  try {
    chrome.storage.local.set({ [SHOT_MARKS_KEY]: includeMarksEl.checked });
  } catch {
    /* storage 権限が無い等は無視 */
  }
}

// 各マーカー個別の「マーカー込み」上書き状態（mark.id → bool）。
// マーク本体と同じくタブ内メモリのみで保持し、リロードで消える（永続化しない）。
// 未登録のマークはヘッダーの全体トグル（既定値）に従う。
const shotInclOverrides = new Map();

includeMarksEl.addEventListener("change", () => {
  saveShotMarks();
  // 未上書きの行を新しい既定値に追従させるため再描画する。
  // 既定値の切替だけでフェードイン（点滅）が走らないようアニメを1回抑制する。
  suppressAnimOnce = true;
  render(currentMarks);
});

// ---- マーキングモード -------------------------------------------------
// ポップアップと同じく content の状態を唯一の真実とし、パネルは指示と表示のみ。
// 切替は MM_SET_ENABLED で content に伝え、状態は MM_GET_STATE / 更新通知で同期する。
enabledEl.addEventListener("change", () => {
  sendToTab({ type: "MM_SET_ENABLED", enabled: enabledEl.checked });
});

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
  selector.textContent = selectorOf(mark);
  text.textContent = mark.text || "（テキストなし）";
  detached.hidden = !mark.detached;

  // アイコンボタンのためテキストは差し替えず、成功時は緑のチェック状態（is-done）で示す
  const copyBtn = node.querySelector(".mm-act-copy");
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(selectorOf(mark));
    if (ok) {
      copyBtn.classList.add("is-done");
      showToast(`#${mark.label} のセレクタをコピーしました`);
      setTimeout(() => copyBtn.classList.remove("is-done"), 1200);
    } else {
      showToast("コピーに失敗しました");
    }
  });

  node.querySelector(".mm-act-locate").addEventListener("click", () => {
    sendToTab({ type: "MM_SCROLL_TO", id: mark.id });
  });

  // 行ごとの「マーカー込み」チェック。上書きがあればそれを、無ければ全体トグル（既定）を初期値にする。
  const shotIncl = node.querySelector(".mm-act-shot-incl");
  shotIncl.checked = shotInclOverrides.has(mark.id)
    ? shotInclOverrides.get(mark.id)
    : includeMarksEl.checked;
  shotIncl.addEventListener("change", () => {
    shotInclOverrides.set(mark.id, shotIncl.checked);
  });

  node.querySelector(".mm-act-shot").addEventListener("click", () => {
    // チェックON = マーカー・連番ラベルを含める = clean(素のみ) を false にする
    saveImage(mark, !shotIncl.checked);
  });

  node.querySelector(".mm-act-shot-copy").addEventListener("click", () => {
    copyImage(mark, !shotIncl.checked);
  });

  node.querySelector(".mm-item-close").addEventListener("click", () => {
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
  // 一覧から消えたマークの上書き状態は破棄する（id の使い回しによる誤適用を防ぐ）
  const liveIds = new Set(currentMarks.map((m) => m.id));
  for (const id of [...shotInclOverrides.keys()]) {
    if (!liveIds.has(id)) shotInclOverrides.delete(id);
  }
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
      enabledEl.checked = false;
      enabledEl.disabled = true;
      render([]);
      return;
    }
    const state = await sendToTab({ type: "MM_GET_STATE" });
    enabledEl.disabled = false;
    enabledEl.checked = Boolean(state?.enabled);
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
    showToast("コピーするマーカーがありません");
    return;
  }
  const all = currentMarks.map((m) => selectorOf(m)).join("\n");
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

// 日時を YYYYMMDD-HHMMSS でファイル名に使う（同一日に複数保存しても重複しにくくする）
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${todayStamp()}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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
    showToast("エクスポートするマーカーがありません");
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
  showToast(`${data.marks.length}件のマーカーをエクスポートしました`);
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
      showToast("マーカー一覧のファイルではありません");
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
      showToast(`${res.restored}件のマーカーを復元しました`);
    }
  };
  reader.readAsText(file);
}

// ---- マーク部分のスクリーンショット ----------------------------------

// ビューポート画像(dataUrl)を rect(CSS px)×dpr で切り出して PNG Blob にする。
// ビューポート外へはみ出す分はクランプする（縦長要素の見切れは仕様として許容）。
async function cropToBlob(dataUrl, rect, dpr, viewport) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    im.src = dataUrl;
  });
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);
  if (right - left < 1 || bottom - top < 1) {
    throw new Error("offscreen");
  }
  const sx = Math.round(left * dpr);
  const sy = Math.round(top * dpr);
  const sw = Math.max(1, Math.round(right * dpr) - sx);
  const sh = Math.max(1, Math.round(bottom * dpr) - sy);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNGの生成に失敗しました"));
    }, "image/png");
  });
}

// 対象マークのビューポート画像を取得し、要素部分を切り出した Blob を返す。
// clean=true なら枠・番号を含めない。撮影後は必ず content の表示を復帰させる。
// 「マーカー込み」が未チェックの行の id を集める。撮影時に枠・番号を隠す対象。
// 1枚の画像に複数マークが写り込むため、各マークの設定を個別に反映させる。
function excludedMarkIds() {
  const ids = [];
  listEl.querySelectorAll(".mm-item").forEach((li) => {
    const cb = li.querySelector(".mm-act-shot-incl");
    if (cb && !cb.checked) ids.push(Number(li.dataset.id));
  });
  return ids;
}

async function captureMarkBlob(mark, clean) {
  if (activeTabId == null) return { ok: false, reason: "unsupported" };
  const prep = await sendToTab({
    type: "MM_CAPTURE_PREPARE",
    id: mark.id,
    clean,
    hideIds: excludedMarkIds(),
  });
  if (!prep || !prep.ok) {
    return { ok: false, reason: prep?.reason || "prepare" };
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const blob = await cropToBlob(dataUrl, prep.rect, prep.dpr, prep.viewport);
    return { ok: true, blob };
  } catch (err) {
    const reason = err && err.message === "offscreen" ? "offscreen" : "capture";
    return { ok: false, reason };
  } finally {
    await sendToTab({ type: "MM_CAPTURE_RESTORE" });
  }
}

// 撮影失敗時の理由に応じたトースト文言
function captureErrorText(reason) {
  if (reason === "detached") return "対象が見つかりません（消失したマーカー）";
  if (reason === "unsupported") return "このページでは利用できません";
  if (reason === "offscreen") return "対象が画面外のため撮影できません";
  return "画像の撮影に失敗しました";
}

// 対象マークの画像を PNG ファイルとして保存する。
async function saveImage(mark, clean) {
  const res = await captureMarkBlob(mark, clean);
  if (!res.ok) {
    showToast(captureErrorText(res.reason));
    return;
  }
  const url = URL.createObjectURL(res.blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `marker-helper-shot-${nowStamp()}-${mark.label}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  showToast(`#${mark.label} の画像を保存しました`);
}

// 対象マークの画像をクリップボードへコピーする。
async function copyImage(mark, clean) {
  const res = await captureMarkBlob(mark, clean);
  if (!res.ok) {
    showToast(captureErrorText(res.reason));
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": res.blob })]);
    showToast(`#${mark.label} の画像をコピーしました`);
  } catch {
    showToast("画像のコピーに失敗しました");
  }
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
    // ポップアップ側のトグル操作などで変わった enabled をパネルへ反映する
    if (typeof msg.enabled === "boolean") enabledEl.checked = msg.enabled;
    render(msg.marks);
  }
});

// タブ切替・遷移に追従
chrome.tabs.onActivated.addListener(() => reload());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === activeTabId && info.status === "complete") reload();
});
chrome.windows?.onFocusChanged?.addListener(() => reload());

loadShotMarks();
loadSelectorFormat();
reload();
