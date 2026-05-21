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
  color: document.getElementById("mm-color"),
  line: document.getElementById("mm-line"),
  width: document.getElementById("mm-width"),
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
let style = { color: "#ff3b30", lineStyle: "solid", width: 3, padding: 8, radius: 8 };
let showLabel = false;

// マーカーの余白・角丸は 0〜40px（1px刻み）
const MAX_SPACING = 40;
const clampSpacing = (n) =>
  Math.min(MAX_SPACING, Math.max(0, Math.round(Number(n) || 0)));

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
  els.color.value = /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#ff3b30";
  updatePreview();
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
  style = { ...style, width: Number(value) };
  reflectSegmented(els.width, value);
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

  els.color.addEventListener("input", () => setColor(els.color.value));

  els.line.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (btn) setLineStyle(btn.dataset.value);
  });

  els.width.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (btn) setWidth(btn.dataset.value);
  });

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
  reflectSlider(els.padding, els.paddingNum, clampSpacing(style.padding));
  reflectSlider(els.radius, els.radiusNum, clampSpacing(style.radius));
  setCount(state.marks?.length ?? 0);

  wireEvents();
}

init();
