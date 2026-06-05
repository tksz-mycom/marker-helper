// Marker HELP — popup
// 色・線種・線幅の選択、マークモードの切替、サイドパネルの起動を担当する。

const PRESET_COLORS = [
  "#ff3b30", // red
  "#c30052", // magenta
  "#ff9500", // orange
  "#ffcc00", // yellow
  "#34c759", // green
  "#007aff", // blue
  "#af52de", // purple
  "#1d1b1a", // ink
  "#ffffff", // white
];

const els = {
  unsupported: document.getElementById("mm-unsupported"),
  main: document.getElementById("mm-main"),
  enabled: document.getElementById("mm-enabled"),
  swatches: document.getElementById("mm-swatches"),
  mypalette: document.getElementById("mm-mypalette"),
  addColor: document.getElementById("mm-add-color"),
  line: document.getElementById("mm-line"),
  width: document.getElementById("mm-width"),
  widthRange: document.getElementById("mm-width-range"),
  widthNum: document.getElementById("mm-width-num"),
  padding: document.getElementById("mm-padding"),
  paddingNum: document.getElementById("mm-padding-num"),
  radius: document.getElementById("mm-radius"),
  radiusNum: document.getElementById("mm-radius-num"),
  labels: document.getElementById("mm-labels"),
  previewBox: document.getElementById("mm-preview-box"),
  previewBadge: document.getElementById("mm-preview-badge"),
  openPanel: document.getElementById("mm-open-panel"),
  count: document.getElementById("mm-count"),
};

let activeTabId = null;
let style = { color: "#ff3b30", lineStyle: "solid", width: 4, padding: 8, radius: 8 };
let showLabel = false;

// マイカラー（ユーザーが登録するカスタムパレット）。最大18色まで（9列×2行）。
// content には関与させず popup 専用の UI 設定として chrome.storage.local に保存する。
const MAX_CUSTOM_COLORS = 18;
const CUSTOM_COLORS_KEY = "mm:customColors";
const HEX_RE = /^#[0-9a-f]{6}$/i;
let customColors = [];
// 隠しカラーピッカーの用途を区別する。-1 = 新規追加、0以上 = そのインデックスの色を変更
let editingIndex = -1;

// マーカーの余白・角丸は 0〜40px（1px刻み）
const MAX_SPACING = 40;
const clampSpacing = (n) =>
  Math.min(MAX_SPACING, Math.max(0, Math.round(Number(n) || 0)));

// 線幅は 1〜20px（1px刻み）。細/中/太のプリセットと共通の値域
const MIN_WIDTH = 1;
const MAX_WIDTH = 20;
const clampWidth = (n) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(Number(n) || MIN_WIDTH)));

const UNSUPPORTED = /^(chrome|edge|brave|about|chrome-extension|view-source|devtools|data):/i;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTab(message) {
  return new Promise((resolve) => {
    if (activeTabId == null) return resolve(null);
    chrome.tabs.sendMessage(activeTabId, message, (res) => {
      // content script 未注入時は lastError になる
      void chrome.runtime.lastError;
      resolve(res ?? null);
    });
  });
}

function showUnsupported() {
  els.unsupported.hidden = false;
  els.main.hidden = true;
}

// ---- UI 構築 ----------------------------------------------------------

function buildSwatches() {
  for (const color of PRESET_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mm-swatch";
    btn.style.background = color;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-label", color);
    btn.setAttribute("aria-checked", "false");
    btn.dataset.color = color;
    btn.addEventListener("click", () => setColor(color));
    els.swatches.appendChild(btn);
  }
}

function reflectColor() {
  for (const btn of els.swatches.children) {
    btn.setAttribute("aria-checked", btn.dataset.color === style.color ? "true" : "false");
  }
  // マイカラーの選択ハイライトも同期
  for (const slot of els.mypalette.querySelectorAll(".mm-myslot[data-color]")) {
    slot.classList.toggle("is-selected", slot.dataset.color.toLowerCase() === style.color.toLowerCase());
  }
  updatePreview();
}

// ---- マイカラー（カスタムパレット） ----------------------------------

function loadCustomColors() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(CUSTOM_COLORS_KEY, (data) => {
        void chrome.runtime.lastError;
        const saved = data && data[CUSTOM_COLORS_KEY];
        customColors = Array.isArray(saved)
          ? saved.filter((c) => typeof c === "string" && HEX_RE.test(c)).slice(0, MAX_CUSTOM_COLORS)
          : [];
        resolve();
      });
    } catch {
      customColors = [];
      resolve();
    }
  });
}

function saveCustomColors() {
  try {
    chrome.storage.local.set({ [CUSTOM_COLORS_KEY]: customColors });
  } catch {
    /* storage 権限が無い等は無視 */
  }
}

function buildMyPalette() {
  els.mypalette.textContent = "";

  // 9列×2行（MAX_CUSTOM_COLORS マス）の固定グリッドを常に描画する。
  // 登録済み=色見本、先頭の空き枠=「＋」（追加）、残り=空きプレースホルダ。
  for (let i = 0; i < MAX_CUSTOM_COLORS; i++) {
    if (i < customColors.length) {
      els.mypalette.appendChild(createColorSlot(customColors[i], i));
    } else if (i === customColors.length) {
      els.mypalette.appendChild(createAddSlot());
    } else {
      els.mypalette.appendChild(createEmptySlot());
    }
  }

  reflectColor();
}

function createColorSlot(color, index) {
  // 「枠の色」スウォッチと同一構造: グリッドセル直下の単一要素に aspect-ratio:1 を当てる
  const slot = document.createElement("button");
  slot.type = "button";
  slot.className = "mm-myslot";
  slot.style.background = color;
  slot.dataset.color = color;
  slot.title = "クリックで選択／ダブルクリックで色を変更";
  slot.setAttribute("aria-label", `マイカラー ${color}（ダブルクリックで色変更）`);
  slot.addEventListener("click", () => setColor(color));
  // ダブルクリックで既存スロットの色を後から変更できる
  slot.addEventListener("dblclick", (e) => {
    e.preventDefault();
    openEditColor(index);
  });

  // 削除ボタンはマス内に重ねて配置（button のネストを避けるため span を使う）
  const del = document.createElement("span");
  del.className = "mm-myslot-del";
  del.textContent = "×";
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", `${color} を削除`);
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    removeCustomColor(index);
  });

  slot.appendChild(del);
  return slot;
}

function createAddSlot() {
  const add = document.createElement("button");
  add.type = "button";
  add.className = "mm-myslot-add";
  add.textContent = "＋";
  add.setAttribute("aria-label", "色を選んでマイカラーに追加");
  add.addEventListener("click", openAddColor);
  return add;
}

function createEmptySlot() {
  const empty = document.createElement("div");
  empty.className = "mm-myslot-empty";
  empty.setAttribute("aria-hidden", "true");
  return empty;
}

// 「＋」: 現在の色を初期値に隠しカラーピッカーを開く（新規追加）
function openAddColor() {
  editingIndex = -1;
  els.addColor.value = HEX_RE.test(style.color) ? style.color : "#ff3b30";
  els.addColor.click();
}

// 既存スロット: その色を初期値に隠しカラーピッカーを開く（色変更）
function openEditColor(index) {
  if (index < 0 || index >= customColors.length) return;
  editingIndex = index;
  els.addColor.value = HEX_RE.test(customColors[index]) ? customColors[index] : "#ff3b30";
  els.addColor.click();
}

// 隠しピッカーで色を確定したときの分岐（新規追加 or 既存スロットの変更）
function onPickerChange() {
  const color = els.addColor.value;
  if (editingIndex >= 0) {
    updateCustomColor(editingIndex, color);
  } else {
    addCustomColor(color);
  }
  editingIndex = -1;
}

function updateCustomColor(index, color) {
  if (!HEX_RE.test(color)) return;
  if (index < 0 || index >= customColors.length) return;
  // 他スロットと重複する色なら登録は変えず選択だけにする
  const dup = customColors.some((c, i) => i !== index && c.toLowerCase() === color.toLowerCase());
  if (dup) {
    setColor(color);
    return;
  }
  customColors = customColors.map((c, i) => (i === index ? color : c));
  saveCustomColors();
  buildMyPalette();
  setColor(color); // 変更後の色を即適用
}

function addCustomColor(color) {
  if (!HEX_RE.test(color)) return;
  const exists = customColors.some((c) => c.toLowerCase() === color.toLowerCase());
  if (exists) {
    // 既に登録済みなら選択だけして重複させない
    setColor(color);
    return;
  }
  if (customColors.length >= MAX_CUSTOM_COLORS) return;
  customColors = [...customColors, color];
  saveCustomColors();
  buildMyPalette();
  setColor(color); // 追加した色を即適用
}

function removeCustomColor(index) {
  customColors = customColors.filter((_, i) => i !== index);
  saveCustomColors();
  buildMyPalette();
}

function reflectSegmented(group, value) {
  for (const btn of group.children) {
    btn.classList.toggle("is-active", btn.dataset.value === String(value));
  }
}

function updatePreview() {
  els.previewBox.style.borderColor = style.color;
  els.previewBox.style.borderStyle = style.lineStyle;
  els.previewBox.style.borderWidth = `${style.width}px`;
  // 余白を文字と枠線のすき間として可視化する
  els.previewBox.style.padding = `${8 + style.padding}px ${18 + style.padding}px`;
  els.previewBox.style.borderRadius = `${style.radius}px`;
  els.previewBadge.style.background = style.color;
  els.previewBadge.hidden = !showLabel;
}

// ---- 状態更新 ---------------------------------------------------------

function pushStyle() {
  sendToTab({ type: "MM_SET_STYLE", style });
}

function setColor(color) {
  style = { ...style, color };
  reflectColor();
  pushStyle();
}

function setLineStyle(value) {
  style = { ...style, lineStyle: value };
  reflectSegmented(els.line, value);
  updatePreview();
  pushStyle();
}

function setWidth(value) {
  const v = clampWidth(value);
  style = { ...style, width: v };
  // セグメント（細/中/太）とスライダー・数値入力を相互に同期
  reflectSegmented(els.width, v);
  reflectSlider(els.widthRange, els.widthNum, v);
  updatePreview();
  pushStyle();
}

function reflectSlider(range, num, value) {
  range.value = String(value);
  num.value = String(value);
}

function setPadding(value) {
  const v = clampSpacing(value);
  style = { ...style, padding: v };
  reflectSlider(els.padding, els.paddingNum, v);
  updatePreview();
  pushStyle();
}

function setRadius(value) {
  const v = clampSpacing(value);
  style = { ...style, radius: v };
  reflectSlider(els.radius, els.radiusNum, v);
  updatePreview();
  pushStyle();
}

function setShowLabel(show) {
  showLabel = Boolean(show);
  els.labels.checked = showLabel;
  updatePreview();
  sendToTab({ type: "MM_SET_LABELS", show: showLabel });
}

function setCount(n) {
  els.count.textContent = String(n);
  els.count.hidden = n === 0;
}

// ---- イベント ---------------------------------------------------------

function wireEvents() {
  els.enabled.addEventListener("change", () => {
    sendToTab({ type: "MM_SET_ENABLED", enabled: els.enabled.checked });
  });

  // 隠しピッカーで色を確定したら、新規追加または既存スロットの色変更を行う
  els.addColor.addEventListener("change", onPickerChange);

  els.line.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (btn) setLineStyle(btn.dataset.value);
  });

  els.width.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (btn) setWidth(btn.dataset.value);
  });

  // 線幅: スライダーは即時、数値入力は確定時に反映（px直接指定）
  els.widthRange.addEventListener("input", () => setWidth(els.widthRange.value));
  els.widthNum.addEventListener("change", () => setWidth(els.widthNum.value));

  // 余白: スライダーは即時、数値入力は確定時に反映（どちらも4pxにスナップ）
  els.padding.addEventListener("input", () => setPadding(els.padding.value));
  els.paddingNum.addEventListener("change", () => setPadding(els.paddingNum.value));

  // 角丸
  els.radius.addEventListener("input", () => setRadius(els.radius.value));
  els.radiusNum.addEventListener("change", () => setRadius(els.radiusNum.value));

  els.labels.addEventListener("change", () => setShowLabel(els.labels.checked));

  els.openPanel.addEventListener("click", async () => {
    try {
      await chrome.sidePanel.open({ tabId: activeTabId });
      window.close();
    } catch (err) {
      console.error("[Marker HELP] サイドパネルを開けません:", err);
    }
  });

  // content からのマーク更新通知で件数を同期
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === "MM_MARKS_UPDATED" && sender.tab?.id === activeTabId) {
      setCount(msg.marks.length);
    }
  });
}

// ---- 初期化 -----------------------------------------------------------

async function init() {
  buildSwatches();
  await loadCustomColors();
  buildMyPalette();

  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url || UNSUPPORTED.test(tab.url)) {
    showUnsupported();
    return;
  }
  activeTabId = tab.id;

  const state = await sendToTab({ type: "MM_GET_STATE" });
  if (!state) {
    // content script が応答しない（権限外ページ等）
    showUnsupported();
    return;
  }

  style = { ...style, ...state.style };
  showLabel = state.showLabel !== false;
  els.enabled.checked = Boolean(state.enabled);
  els.labels.checked = showLabel;
  reflectColor();
  reflectSegmented(els.line, style.lineStyle);
  reflectSegmented(els.width, style.width);
  reflectSlider(els.widthRange, els.widthNum, clampWidth(style.width));
  reflectSlider(els.padding, els.paddingNum, clampSpacing(style.padding));
  reflectSlider(els.radius, els.radiusNum, clampSpacing(style.radius));
  setCount(state.marks?.length ?? 0);

  wireEvents();
}

init();
