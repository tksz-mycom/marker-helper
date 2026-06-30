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
const filterEl = document.getElementById("mm-filter");
const nomatchEl = document.getElementById("mm-nomatch");
const exportFormatEl = document.getElementById("mm-export-format");

let activeTabId = null;
// 撮影対象タブが属するウィンドウ。captureVisibleTab はこの windowId を明示して呼ぶ。
let activeWindowId = null;

// 別ウィンドウ表示モード（panel.html?window=1）。サイドパネルと違い対象ページの幅を
// 奪わないため、本来のレイアウトのまま撮影できる。対象タブの解決方法が変わる。
const WINDOW_MODE = new URLSearchParams(location.search).get("window") === "1";
// 別ウィンドウモードで対象にする「直近にフォーカスされた通常ウィンドウ」の id。
let lastNormalWindowId = null;

// 絞り込み文字列（小文字化して部分一致で照合する）。空なら全件表示。
let filterText = "";

function matchesFilter(mark) {
  if (!filterText) return true;
  const haystack = [mark.tag, selectorOf(mark), mark.text, mark.note, mark.group]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(filterText);
}

filterEl.addEventListener("input", () => {
  filterText = filterEl.value.trim().toLowerCase();
  // 絞り込みの再描画ではフェードイン（点滅）を抑止する
  suppressAnimOnce = true;
  render(currentMarks);
});

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

function acceptTab(tab) {
  if (!tab || !tab.id || !tab.url || UNSUPPORTED.test(tab.url)) {
    activeTabId = null;
    activeWindowId = null;
    return false;
  }
  activeTabId = tab.id;
  activeWindowId = tab.windowId;
  return true;
}

async function resolveActiveTab() {
  if (!WINDOW_MODE) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return acceptTab(tab);
  }
  // 別ウィンドウモード: 自分（ポップアップ）ではなく、直近にフォーカスされた
  // 通常ウィンドウのアクティブタブを対象にする。
  let winId = lastNormalWindowId;
  if (winId == null) {
    const normals = (await chrome.windows.getAll()).filter((w) => w.type === "normal");
    const win = normals.find((w) => w.focused) || normals[0];
    winId = win ? win.id : null;
    lastNormalWindowId = winId;
  }
  if (winId == null) {
    activeTabId = null;
    activeWindowId = null;
    return false;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId: winId });
  return acceptTab(tab);
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

// 要素の中身（textContent / outerHTML）を content から取得してコピーする。
async function copyElementContent(mark, kind) {
  const res = await sendToTab({ type: "MM_GET_ELEMENT_CONTENT", id: mark.id });
  if (!res || !res.ok) {
    showToast("対象が見つかりません（消失したマーカー）");
    return;
  }
  const value = kind === "html" ? res.html : res.text;
  const kindLabel = kind === "html" ? "HTML" : "テキスト";
  if (!value) {
    showToast(`コピーできる${kindLabel}がありません`);
    return;
  }
  const ok = await copyText(value);
  showToast(ok ? `#${mark.label} の${kindLabel}をコピーしました` : "コピーに失敗しました");
}

// インスペクト情報を <dl> に行（dt/dd）として描画する。
// コントラストは WCAG の合否目安（通常文 4.5、大きい文字 3.0）を併記する。
function renderInspect(box, info) {
  box.replaceChildren();
  const row = (label, value) => {
    if (value == null || value === "") return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    box.append(dt, dd);
  };
  row("サイズ", `${info.width} × ${info.height} px`);
  row("表示", info.display);
  // 文字色・背景色は見本スウォッチ付きで示す
  appendColorRow(box, "文字色", info.color);
  appendColorRow(box, "背景色", info.background);
  if (info.contrast != null) {
    const grade = info.contrast >= 4.5 ? "AA" : info.contrast >= 3 ? "AA(大)" : "不足";
    row("コントラスト", `${info.contrast.toFixed(2)} : 1（${grade}）`);
  }
  row("フォント", [info.fontFamily, info.fontSize, info.fontWeight].filter(Boolean).join(" / "));
  row("余白", `padding ${info.padding} / margin ${info.margin}`);
  row("role", info.role);
  row("aria-label", info.ariaLabel);
}

// 色の行は値の左に色見本（スウォッチ）を付ける
function appendColorRow(box, label, value) {
  if (!value) return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  const sw = document.createElement("span");
  sw.className = "mm-swatch";
  sw.style.background = value;
  dd.append(sw, document.createTextNode(value));
  box.append(dt, dd);
}

// セレクタ貼り替えの失敗理由（content の reason）に対応する日本語メッセージ
const SELECTOR_ERROR = {
  empty: "セレクタが空です",
  nomatch: "一致する要素が見つかりません",
  own: "拡張機能自身の要素は指定できません",
  notfound: "対象のマークが見つかりません",
};

// セレクタ表示の <code> を直接編集できるようにする。Enter / フォーカス外しで確定し、
// その文字列で要素を再特定して貼り替える。空・不一致・不正時は元の表示へ戻す。
function setupSelectorEdit(selector, mark) {
  const original = selectorOf(mark);
  selector.textContent = original;
  selector.setAttribute("contenteditable", "plaintext-only");
  selector.setAttribute("spellcheck", "false");
  selector.setAttribute("role", "textbox");
  selector.setAttribute("aria-label", "セレクタ（クリックで編集）");
  selector.title = "クリックして編集（Enterで確定／Escで取消）";

  let committing = false;
  const revert = () => {
    selector.textContent = original;
  };

  const commit = async () => {
    if (committing) return;
    const value = (selector.textContent || "").trim();
    // 変更なしは表示を整えるだけ（前後の空白や改行を取り除く）
    if (value === original) {
      selector.textContent = original;
      return;
    }
    if (!value) {
      revert();
      showToast(SELECTOR_ERROR.empty);
      return;
    }
    committing = true;
    const res = await sendToTab({
      type: "MM_SET_SELECTOR",
      id: mark.id,
      value,
      format: selectorFormat,
    });
    committing = false;
    if (res && res.ok) {
      // 成功時は content の broadcast による再描画で最新表示へ更新される
      showToast(`#${mark.label} の要素を貼り替えました`);
    } else {
      revert();
      showToast(SELECTOR_ERROR[res?.reason] || "セレクタを適用できません");
    }
  };

  selector.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      selector.blur(); // blur で commit
    } else if (e.key === "Escape") {
      e.preventDefault();
      revert();
      selector.blur();
    }
  });
  selector.addEventListener("blur", commit);
}

// 現在表示中のセレクタ（CSS/XPath）が壊れにくいかを簡易判定する。
// id 起点や安定属性は強い、単一クラスは普通、nth-of-type / 位置指定の連結は弱い。
// 厳密なテストではなく、編集を促すための目安として 3 段階で返す。
function selectorRobustness(mark) {
  const sel = selectorOf(mark);
  if (!sel) return "weak";
  if (selectorFormat === "xpath") {
    // //*[@id=...] 起点は強い。/html/body/... の位置指定（[n]）が多いほど弱い。
    if (/^\/\/\*\[@id=/.test(sel)) return "strong";
    const idx = (sel.match(/\[\d+\]/g) || []).length;
    if (idx === 0) return "strong";
    return idx <= 1 ? "medium" : "weak";
  }
  // CSS: #id 起点は強い。nth-of-type の段数で安定度を見る。
  if (sel.startsWith("#")) return "strong";
  const nth = (sel.match(/:nth-of-type\(/g) || []).length;
  if (nth === 0) return "strong"; // 安定属性・一意クラスのみ
  return nth <= 1 ? "medium" : "weak";
}

const ROBUST_LABEL = { strong: "安定", medium: "普通", weak: "不安定" };
const ROBUST_TITLE = {
  strong: "id・安定属性・一意クラスで特定でき、壊れにくいセレクタです",
  medium: "クラスや 1 段の位置指定に依存します。動的ページでは変わる可能性があります",
  weak: "位置指定（nth-of-type）の連結に依存し、ページ構造の変化で壊れやすいセレクタです",
};

// 行のセレクタ堅牢性チップを現在の表示形式に合わせて更新する。
function applyRobustness(node, mark) {
  const el = node.querySelector(".mm-robust");
  if (!el) return;
  const level = selectorRobustness(mark);
  el.hidden = false;
  el.textContent = ROBUST_LABEL[level];
  el.title = ROBUST_TITLE[level];
  el.classList.remove("mm-robust--strong", "mm-robust--medium", "mm-robust--weak");
  el.classList.add(`mm-robust--${level}`);
}

// グループ名から安定した色相を導く（同名は常に同色になる簡易ハッシュ）。
function groupHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

// グループ名チップの表示・色を更新する（未設定なら隠す）。
function applyGroupChip(node, mark) {
  const chip = node.querySelector(".mm-group-chip");
  if (!chip) return;
  const name = (mark.group || "").trim();
  if (!name) {
    chip.hidden = true;
    chip.textContent = "";
    return;
  }
  const hue = groupHue(name);
  chip.hidden = false;
  chip.textContent = name;
  chip.style.color = `hsl(${hue} 60% 32%)`;
  chip.style.background = `hsl(${hue} 70% 92%)`;
}

// number 入力を min/max でクランプして整数値を返す（範囲外入力の保険）。
function clampNumInput(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  let v = Math.round(Number(input.value));
  if (!Number.isFinite(v)) v = min;
  v = Math.max(min, Math.min(max, v));
  input.value = String(v);
  return v;
}

// 枠の詳細設定（吹き出し）の開閉と各コントロールを配線する。
// 各変更は MM_SET_MARK_STYLE の patch（変更分のみ）で content へ送る。content が
// 検証・即時反映し broadcast するため、再描画後は openStyleEditId 一致行で開き直す。
function wireStyleEditor(node, mark) {
  const toggle = node.querySelector(".mm-act-style-toggle");
  const pop = node.querySelector(".mm-style-pop");

  // 再描画をまたいでも、直前に開いていた行は開いたまま復元する
  const isOpen = openStyleEditId === mark.id;
  pop.hidden = !isOpen;
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.classList.toggle("is-active", isOpen);

  toggle.addEventListener("click", () => {
    const willOpen = pop.hidden;
    // 同時に複数の吹き出しが開かないよう、他の行の開いた吹き出しは閉じる
    if (willOpen) {
      for (const other of listEl.querySelectorAll(".mm-style-pop")) {
        if (other !== pop) {
          other.hidden = true;
          const t = other.parentElement.querySelector(".mm-act-style-toggle");
          if (t) {
            t.setAttribute("aria-expanded", "false");
            t.classList.remove("is-active");
          }
        }
      }
    }
    openStyleEditId = willOpen ? mark.id : null;
    pop.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
    toggle.classList.toggle("is-active", willOpen);
  });

  // 確定値を content へ送る。再描画のフェードイン（点滅）は抑止する。
  const sendPatch = (patch) => {
    suppressAnimOnce = true;
    sendToTab({ type: "MM_SET_MARK_STYLE", id: mark.id, patch });
  };

  // 線種セグメント（実線/破線/点線）。クリックで即時に確定する。
  const lineSeg = pop.querySelector(".mm-style-line");
  for (const btn of lineSeg.querySelectorAll("button")) {
    btn.classList.toggle("is-active", btn.dataset.value === mark.lineStyle);
    btn.addEventListener("click", () => {
      if (btn.classList.contains("is-active")) return;
      for (const b of lineSeg.querySelectorAll("button")) b.classList.toggle("is-active", b === btn);
      sendPatch({ lineStyle: btn.dataset.value });
    });
  }

  // 数値系（線幅/余白/角丸/透明度）。range と number を同期し、確定時（change）に送る。
  // ドラッグ中（input）は相方の数値表示だけ更新し、再描画を伴う送信は行わない。
  const bindNum = (rangeSel, numSel, field, value) => {
    const range = pop.querySelector(rangeSel);
    const num = pop.querySelector(numSel);
    range.value = String(value);
    num.value = String(value);
    range.addEventListener("input", () => {
      num.value = range.value;
    });
    num.addEventListener("input", () => {
      range.value = num.value;
    });
    range.addEventListener("change", () => sendPatch({ [field]: Number(range.value) }));
    num.addEventListener("change", () => {
      const v = clampNumInput(num);
      range.value = String(v);
      sendPatch({ [field]: v });
    });
  };

  bindNum(".mm-style-width", ".mm-style-width-num", "width", mark.width);
  bindNum(".mm-style-padding", ".mm-style-padding-num", "padding", mark.padding);
  bindNum(".mm-style-radius", ".mm-style-radius-num", "radius", mark.radius);
  bindNum(".mm-style-transparency", ".mm-style-transparency-num", "transparency", mark.transparency);

  // 連番ラベルの表示/非表示はマークごとに切り替える。枠スタイル（MM_SET_MARK_STYLE）
  // とは別管理のため専用メッセージ MM_SET_MARK_LABEL で送る。
  const showLabelEl = pop.querySelector(".mm-style-showlabel");
  // 継承(null)のときはグローバル既定の実効値を表示。チェック操作で明示的な上書きになる。
  showLabelEl.checked = MMShared.effectiveShowLabel(mark.showLabel, globalShowLabel);
  showLabelEl.addEventListener("change", () => {
    suppressAnimOnce = true;
    sendToTab({ type: "MM_SET_MARK_LABEL", id: mark.id, show: showLabelEl.checked });
  });
}

function buildItem(mark) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = String(mark.id);
  const badge = node.querySelector(".mm-badge");
  // 並べ替えは番号バッジ（ハンドル）からのみ開始する。
  // li 全体を draggable にするとメモ入力のテキスト選択ができなくなるため。
  // 絞り込み中は一部しか表示されず並べ替えが破綻するためハンドルを無効化する。
  badge.draggable = !filterText;
  const tag = node.querySelector(".mm-tag");
  const detached = node.querySelector(".mm-detached");
  const selector = node.querySelector(".mm-selector");
  const text = node.querySelector(".mm-text");

  badge.textContent = String(mark.label);
  badge.style.background = mark.color;
  // 連番ラベルを個別に非表示へ設定したマークは、一覧の番号バッジにも斜線を引いて
  // 「ページ上に番号が出ない」状態だと一目で分かるようにする。
  const labelHidden = mark.showLabel === false;
  badge.classList.toggle("is-label-off", labelHidden);
  // ドラッグの代替: 上下ボタンで並び順を調整する（端ボタンは最上段／最下段へ一気に移動）
  node.querySelector(".mm-act-move-top").addEventListener("click", () => moveItemToEdge(node, -1));
  node.querySelector(".mm-act-move-up").addEventListener("click", () => moveItem(node, -1));
  node.querySelector(".mm-act-move-down").addEventListener("click", () => moveItem(node, 1));
  node.querySelector(".mm-act-move-bottom").addEventListener("click", () => moveItemToEdge(node, 1));
  tag.textContent = mark.tag;
  // セレクタ文字列は直接編集できる。確定でその文字列により要素を貼り替える。
  setupSelectorEdit(selector, mark);
  // 表示中の形式に応じてセレクタの壊れにくさの目安を出す
  applyRobustness(node, mark);
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

  // 要素のインスペクト情報を開閉する。開いたときに content から取得して描画する。
  const inspectBtn = node.querySelector(".mm-act-inspect");
  const inspectBox = node.querySelector(".mm-inspect");
  inspectBtn.addEventListener("click", async () => {
    if (!inspectBox.hidden) {
      inspectBox.hidden = true;
      inspectBtn.setAttribute("aria-expanded", "false");
      return;
    }
    const res = await sendToTab({ type: "MM_INSPECT_ELEMENT", id: mark.id });
    if (!res || !res.ok) {
      showToast("対象が見つかりません（消失したマーカー）");
      return;
    }
    renderInspect(inspectBox, res.info);
    inspectBox.hidden = false;
    inspectBtn.setAttribute("aria-expanded", "true");
  });

  // 要素の中身（テキスト/HTML）をコピーする。content から都度取得する（再描画は伴わない）。
  node.querySelector(".mm-act-copy-text").addEventListener("click", () => {
    copyElementContent(mark, "text");
  });
  node.querySelector(".mm-act-copy-html").addEventListener("click", () => {
    copyElementContent(mark, "html");
  });

  // このマーカーの色を個別に変更する。確定時に content へ送り、即時反映させる。
  const colorEl = node.querySelector(".mm-act-color");
  colorEl.value = mark.color;
  colorEl.addEventListener("change", () => {
    // 変更通知による再描画でのフェードイン（点滅）を抑止する
    suppressAnimOnce = true;
    sendToTab({ type: "MM_SET_MARK_COLOR", id: mark.id, color: colorEl.value });
  });

  // 枠の詳細設定（線種・線幅・余白・角丸・透明度）を歯車ボタンで開閉する吹き出し。
  // 既定では非表示。色と同じく確定時に content へ送り、新規マークの既定スタイルには影響しない。
  wireStyleEditor(node, mark);

  // グループ名チップを表示し、入力で変更できるようにする。
  applyGroupChip(node, mark);
  const groupEl = node.querySelector(".mm-group");
  groupEl.value = mark.group || "";
  groupEl.addEventListener("change", () => {
    // content が broadcast で再描画するため、フェードイン（点滅）を抑止する
    suppressAnimOnce = true;
    sendToTab({ type: "MM_SET_GROUP", id: mark.id, group: groupEl.value });
  });

  // メモ（注釈）。content は再描画を伴わないため、確定時（change）に送って反映する。
  const noteEl = node.querySelector(".mm-note");
  noteEl.value = mark.note || "";
  noteEl.addEventListener("change", () => {
    sendToTab({ type: "MM_SET_NOTE", id: mark.id, note: noteEl.value });
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
// content の state.showLabel（連番表示のグローバル既定）。継承(null)マークの実効表示判定に使う。
let globalShowLabel = false;
// ドラッグ中は再描画を抑止し、掴んでいる要素が破棄されないようにする
let isDragging = false;
// 枠の詳細設定（吹き出し）が開いている行の id。再描画をまたいで開いたままにする。
let openStyleEditId = null;
// 前回の再描画で表示していたマークの id 集合。今回新たに現れた項目だけに
// スライドアップ演出（.mm-enter）を付け、既存項目の揺れを防ぐために使う。
let prevShownIds = new Set();

function render(marks) {
  // ドラッグ操作中の再描画は掴んだ要素を消してしまうため抑止する。
  // ドラッグ確定後は commitOrder の更新通知で改めて描画される。
  if (isDragging || reorderCtl.shouldSkipRender()) return;
  currentMarks = marks || [];
  // 一覧から消えたマークの上書き状態は破棄する（id の使い回しによる誤適用を防ぐ）
  const liveIds = new Set(currentMarks.map((m) => m.id));
  for (const id of [...shotInclOverrides.keys()]) {
    if (!liveIds.has(id)) shotInclOverrides.delete(id);
  }
  // 開いていた枠設定の対象が消えていたら開閉状態も破棄する
  if (openStyleEditId != null && !liveIds.has(openStyleEditId)) openStyleEditId = null;
  // 絞り込み後の表示対象。件数バッジは「表示/全体」で示す（絞り込み時のみ）。
  const shown = currentMarks.filter(matchesFilter);
  countEl.textContent = filterText
    ? `${shown.length}/${currentMarks.length}`
    : String(currentMarks.length);
  listEl.classList.toggle("mm-no-anim", suppressAnimOnce);
  suppressAnimOnce = false;
  listEl.replaceChildren();

  // マークが1件も無いときの案内と、絞り込みで0件になったときの案内を出し分ける
  emptyEl.hidden = currentMarks.length !== 0;
  nomatchEl.hidden = !(currentMarks.length > 0 && shown.length === 0);
  if (shown.length === 0) {
    prevShownIds = new Set();
    return;
  }

  const frag = document.createDocumentFragment();
  for (const mark of shown) {
    const node = buildItem(mark);
    // 前回表示に無かった（＝今回新しく現れた）項目だけスライドアップさせる
    if (!prevShownIds.has(mark.id)) node.classList.add("mm-enter");
    frag.appendChild(node);
  }
  listEl.appendChild(frag);
  prevShownIds = new Set(shown.map((m) => m.id));
  // 先頭/末尾の移動ボタンや絞り込み中の無効化を反映する
  updateMoveBoundaries();
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

// 上下移動ボタンによる並べ替え。ドラッグの代替として隣接行と入れ替え、表示番号を
// 調整する。枠が大きくてもクリック1回で確実に動かせる。
// 並べ替え確定のタイミング制御（#2対策）。即時commit→アニメ中はrender抑止→delay後に再同期。
// ロジックは shared/reorderController.js に集約し、単体テストで不変条件を固定している。
const reorderCtl = MMShared.createReorderController({
  commit: () => commitOrder(),
  sync: () => {
    suppressAnimOnce = true;
    reload(true); // 抑止中に取りこぼした他更新も含め権威状態へ再同期（アニメは抑止）
  },
});

// DOM の並べ替えを FLIP でスライド表示する共通処理。mutate() で実際の DOM 入替を行い、
// 並びが変わったら true を返す。旧位置→新位置へ全行を translateY で滑らかに動かす。
function animateReorder(mutate) {
  if (filterText || isDragging) return;
  const rows = [...listEl.querySelectorAll(".mm-item")];
  const firstTops = new Map(rows.map((el) => [el, el.getBoundingClientRect().top]));
  if (!mutate()) return; // 端で動かせない等、並びが変わらなければ何もしない
  relabelDom();
  updateMoveBoundaries();
  for (const el of rows) {
    const delta = firstTops.get(el) - el.getBoundingClientRect().top;
    if (!delta) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
  }
  requestAnimationFrame(() => {
    for (const el of rows) {
      if (!el.style.transform) continue;
      el.style.transition = "transform 200ms cubic-bezier(0.2, 0, 0, 1)";
      el.style.transform = "";
    }
  });

  // 並びは「今この瞬間」新順なので即座に確定する（タイミング制御は reorderCtl が担う）。
  reorderCtl.onMove();
}

// 隣の行と入れ替える（1つ上／1つ下）
function moveItem(li, dir) {
  animateReorder(() => {
    const target = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
    if (!target || !target.classList.contains("mm-item")) return false;
    if (dir < 0) listEl.insertBefore(li, target);
    else listEl.insertBefore(target, li);
    return true;
  });
}

// 一覧の端まで一気に移動する（最上段／最下段）
function moveItemToEdge(li, dir) {
  animateReorder(() => {
    if (dir < 0) {
      if (listEl.firstElementChild === li) return false;
      listEl.insertBefore(li, listEl.firstElementChild);
    } else {
      if (listEl.lastElementChild === li) return false;
      listEl.appendChild(li);
    }
    return true;
  });
}

// 先頭の「上系」・末尾の「下系」ボタンは押せないようにする（絞り込み中は両方無効）。
function updateMoveBoundaries() {
  const rows = [...listEl.querySelectorAll(".mm-item")];
  const lock = Boolean(filterText);
  const last = rows.length - 1;
  rows.forEach((li, i) => {
    const atTop = i === 0;
    const atBottom = i === last;
    for (const sel of [".mm-act-move-top", ".mm-act-move-up"]) {
      const btn = li.querySelector(sel);
      if (btn) btn.disabled = lock || atTop;
    }
    for (const sel of [".mm-act-move-down", ".mm-act-move-bottom"]) {
      const btn = li.querySelector(sel);
      if (btn) btn.disabled = lock || atBottom;
    }
  });
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
  // 既に正しい位置にあるなら DOM を動かさない。毎 dragover で無条件に再挿入すると、
  // 掴んだ要素がリスト内で場所を占めたまま測定される影響で挿入位置が境界付近で
  // 交互に振動し、カードが細かく揺れてしまうため。
  if (after == null) {
    if (listEl.lastElementChild !== dragging) listEl.appendChild(dragging);
  } else if (after !== dragging && after.previousElementSibling !== dragging) {
    listEl.insertBefore(dragging, after);
  }
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
async function reload(keepAnim = false) {
  // 実行中に届いた要求は1回だけ末尾で再実行する（タブ切替連打の多重実行を防ぐ）
  if (reloading) {
    reloadQueued = true;
    return;
  }
  reloading = true;
  // タブ切替・再読み込み由来の描画では並べ替えのアニメ抑制を持ち越さない
  // （ただし並べ替え直後の再同期では keepAnim=true で抑止を維持し、ちらつきを防ぐ）
  if (!keepAnim) suppressAnimOnce = false;
  try {
    const ok = await resolveActiveTab();
    if (!ok) {
      enabledEl.checked = false;
      enabledEl.disabled = true;
      render([]);
      return;
    }
    const state = await sendToTab({ type: "MM_GET_STATE" });
    globalShowLabel = Boolean(state?.showLabel);
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

// 任意のテキストをファイルとして保存する（CSV / Markdown 用）。
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
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

// 一覧の各行に出力する列（CSV / Markdown 共通）
const EXPORT_COLUMNS = ["番号", "タグ", "グループ", "CSSセレクタ", "XPath", "テキスト", "メモ"];
function exportRow(m) {
  return [m.label, m.tag, m.group || "", m.selector, m.xpath || "", m.text || "", m.note || ""];
}

// CSV の1セルをエスケープ（カンマ・引用符・改行を含む場合は引用符で囲む）
function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(marks) {
  const lines = [EXPORT_COLUMNS.map(csvCell).join(",")];
  for (const m of marks) lines.push(exportRow(m).map(csvCell).join(","));
  // Excel での文字化け回避のため BOM を先頭に付ける
  return `﻿${lines.join("\r\n")}\r\n`;
}

// Markdown 表のセル（パイプと改行をエスケープ）
function mdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function buildMarkdown(marks) {
  const head = `| ${EXPORT_COLUMNS.join(" | ")} |`;
  const sep = `| ${EXPORT_COLUMNS.map(() => "---").join(" | ")} |`;
  const rows = marks.map((m) => `| ${exportRow(m).map(mdCell).join(" | ")} |`);
  return [head, sep, ...rows].join("\n") + "\n";
}

// ---- テストコード出力（Playwright / Cypress） -------------------------
// 各マークのセレクタから locator を生成し、要素が表示されることを検証する雛形を出力する。
// 現在の表示形式（CSS/XPath）に従って locator を組む（XPath は対応構文で出す）。

// JS の単一引用符文字列リテラルとして値をエスケープする
function jsString(value) {
  return `'${String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

// コメント1行に収まるようラベル（メモ/テキスト/タグ）の改行を畳む
function commentLabel(m) {
  return String(m.note || m.text || m.tag || "").replace(/\r?\n/g, " ").trim();
}

// 現在の形式に応じた locator 式を返す。xpath は Playwright が `xpath=` 構文を解する。
function locatorSnippet(m) {
  if (selectorFormat === "xpath" && m.xpath) {
    return { pw: `page.locator(${jsString("xpath=" + m.xpath)})`, cy: `cy.xpath(${jsString(m.xpath)})` };
  }
  return { pw: `page.locator(${jsString(m.selector)})`, cy: `cy.get(${jsString(m.selector)})` };
}

function buildPlaywright(marks, url) {
  const lines = ["import { test, expect } from '@playwright/test';", "", "test('Marker:HELPER でマークした要素', async ({ page }) => {"];
  if (url) lines.push(`  await page.goto(${jsString(url)});`);
  for (const m of marks) {
    const label = commentLabel(m);
    lines.push(label ? `  // #${m.label} ${label}` : `  // #${m.label}`);
    lines.push(`  await expect(${locatorSnippet(m).pw}).toBeVisible();`);
  }
  lines.push("});", "");
  return lines.join("\n");
}

function buildCypress(marks, url) {
  const lines = [];
  // XPath 出力は cypress-xpath プラグインが前提になるため先頭で明示する
  if (selectorFormat === "xpath") {
    lines.push("// XPath を使うには cypress-xpath プラグインが必要です（npm i -D cypress-xpath）", "");
  }
  lines.push("describe('Marker:HELPER でマークした要素', () => {", "  it('要素が表示されている', () => {");
  if (url) lines.push(`    cy.visit(${jsString(url)});`);
  for (const m of marks) {
    const label = commentLabel(m);
    lines.push(label ? `    // #${m.label} ${label}` : `    // #${m.label}`);
    lines.push(`    ${locatorSnippet(m).cy}.should('be.visible');`);
  }
  lines.push("  });", "});", "");
  return lines.join("\n");
}

// 現在のマーク一覧（スタイル込み）を content から取得し、選択形式で保存する。
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
  const marks = res.marks || [];
  const format = exportFormatEl.value;
  const base = `marker-helper-marks-${todayStamp()}`;

  if (format === "csv") {
    downloadText(buildCsv(marks), `${base}.csv`, "text/csv");
  } else if (format === "md") {
    downloadText(buildMarkdown(marks), `${base}.md`, "text/markdown");
  } else if (format === "pw") {
    downloadText(buildPlaywright(marks, res.url), `${base}.spec.js`, "text/javascript");
  } else if (format === "cy") {
    downloadText(buildCypress(marks, res.url), `${base}.cy.js`, "text/javascript");
  } else {
    // JSON のみインポートで完全復元できる（スタイル・メモを含む）
    const data = {
      app: MARKS_FILE_APP,
      kind: MARKS_FILE_KIND,
      version: 1,
      exportedAt: new Date().toISOString(),
      url: res.url || "",
      marks,
    };
    downloadJson(data, `${base}.json`);
  }
  showToast(`${marks.length}件のマーカーをエクスポートしました`);
}

// 検証済みのマーク配列を content に渡して復元し、結果をトーストで通知する。
async function applyImportedMarks(marks) {
  const res = await sendToTab({ type: "MM_IMPORT_MARKS", marks });
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
}

// JSON テキストを検証し、マーカー一覧ファイルなら content に渡して復元する。
// ファイル読込・ドラッグ&ドロップ・クリップボード貼り付けの共通経路。
function importMarksFromText(text) {
  if (activeTabId == null) {
    showToast("このページでは利用できません");
    return;
  }
  let data;
  try {
    data = JSON.parse(text);
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
  applyImportedMarks(data.marks);
}

// 選択／ドロップされたファイルを読み込み、検証してから復元する。
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
  reader.onload = () => importMarksFromText(String(reader.result));
  reader.readAsText(file);
}

// ---- マーク部分のスクリーンショット ----------------------------------

// dataUrl から Image を読み込む。
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    im.src = dataUrl;
  });
}

// canvas を PNG Blob 化する。
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNGの生成に失敗しました"));
    }, "image/png");
  });
}

// ビューポート画像(dataUrl)を rect(CSS px)×dpr で切り出して PNG Blob にする。
// ビューポート外へはみ出す分はクランプする（縦長要素の見切れは仕様として許容）。
async function cropToBlob(dataUrl, rect, dpr, viewport) {
  const img = await loadImage(dataUrl);
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
  return canvasToBlob(canvas);
}

// 縦長要素をスクロールしながら複数回撮影し、1枚の PNG に縦結合する。
// page はページ座標の切り出し矩形。各スライスを content に依頼したスクロール位置で
// 撮影し、要素相当の帯を切り出して大きな canvas に積み上げる。
// 横方向が画面幅を超える分の見切れは許容する（既存の単発撮影と同じ方針）。
const MAX_CANVAS_PX = 32000; // ブラウザの canvas 寸法上限の安全側
const CAPTURE_THROTTLE_MS = 350; // captureVisibleTab の呼び出し制限を避ける間隔

// 対象タブが属するウィンドウのビューポートを撮影する。別ウィンドウモードでは
// 自分（ポップアップ）ではなく対象ページのウィンドウを明示する必要がある。
function captureViewport() {
  if (activeWindowId != null) {
    return chrome.tabs.captureVisibleTab(activeWindowId, { format: "png" });
  }
  return chrome.tabs.captureVisibleTab({ format: "png" });
}

async function stitchTallBlob(page, dpr, viewport) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(page.width * dpr)));
  canvas.height = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(page.height * dpr)));
  const ctx = canvas.getContext("2d");

  let filled = 0; // 要素の上端からの埋め済み高さ（CSS px）
  let guard = 0;
  while (filled < page.height - 0.5 && guard < 256) {
    guard++;
    const sc = await sendToTab({ type: "MM_CAPTURE_SCROLL", y: page.y + filled });
    if (!sc || !sc.ok) break;
    await delay(CAPTURE_THROTTLE_MS);
    const dataUrl = await captureViewport();
    const img = await loadImage(dataUrl);

    const viewTopPage = sc.scrollY;
    const bandTopPage = page.y + filled;
    // ページ末尾でスクロールが頭打ちでも、見えている範囲だけ確実に取り込む
    const visibleBottomPage = Math.min(page.y + page.height, viewTopPage + viewport.height);
    const sliceH = visibleBottomPage - bandTopPage;
    if (sliceH <= 0.5) break;

    let sxImg = Math.round((page.x - sc.scrollX) * dpr);
    let swImg = Math.round(page.width * dpr);
    const syImg = Math.round((bandTopPage - viewTopPage) * dpr);
    const shImg = Math.round(sliceH * dpr);
    const dyImg = Math.round(filled * dpr);
    // 横方向のクランプ（画面外へはみ出す分は捨てる）
    let dxImg = 0;
    if (sxImg < 0) {
      dxImg = -sxImg;
      swImg += sxImg;
      sxImg = 0;
    }
    if (sxImg + swImg > img.width) swImg = img.width - sxImg;
    if (swImg > 0 && shImg > 0) {
      ctx.drawImage(img, sxImg, syImg, swImg, shImg, dxImg, dyImg, swImg, shImg);
    }
    filled += sliceH;
  }
  return canvasToBlob(canvas);
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

// マークの「マーカー込み」実効値（行の上書き優先、無ければヘッダー既定）。
// 絞り込みで DOM に無い行でも参照できるよう、状態から直接求める。
function shotInclOf(id) {
  return shotInclOverrides.has(id) ? shotInclOverrides.get(id) : includeMarksEl.checked;
}

// 全マークから、撮影時に枠・番号を隠す（未チェックの）id を集める。
function hideIdsFromState() {
  return currentMarks.filter((m) => !shotInclOf(m.id)).map((m) => m.id);
}

async function captureMarkBlob(mark, clean, hideIds = excludedMarkIds()) {
  if (activeTabId == null) return { ok: false, reason: "unsupported" };
  const prep = await sendToTab({
    type: "MM_CAPTURE_PREPARE",
    id: mark.id,
    clean,
    hideIds,
  });
  if (!prep || !prep.ok) {
    return { ok: false, reason: prep?.reason || "prepare" };
  }
  try {
    // ビューポートより縦に大きい要素はスクロール撮影して継ぎ合わせる
    if (prep.tall && prep.pageRect) {
      const blob = await stitchTallBlob(prep.pageRect, prep.dpr, prep.viewport);
      return { ok: true, blob };
    }
    const dataUrl = await captureViewport();
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

// Blob を指定ファイル名でダウンロードする。
function downloadBlob(blob, filename) {
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

// 対象マークの画像を PNG ファイルとして保存する。
async function saveImage(mark, clean) {
  const res = await captureMarkBlob(mark, clean);
  if (!res.ok) {
    showToast(captureErrorText(res.reason));
    return;
  }
  downloadBlob(res.blob, `marker-helper-shot-${nowStamp()}-${mark.label}.png`);
  showToast(`#${mark.label} の画像を保存しました`);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 表示中（絞り込み後）の全マーカーを順に撮影し、それぞれ PNG として保存する。
// 各行の「マーカー込み」設定を個別に反映し、写り込む他マークも状態から判定する。
async function saveAllImages() {
  if (activeTabId == null) {
    showToast("このページでは利用できません");
    return;
  }
  const list = currentMarks.filter(matchesFilter);
  if (list.length === 0) {
    showToast("保存するマーカーがありません");
    return;
  }
  const hideIds = hideIdsFromState();
  let ok = 0;
  let fail = 0;
  showToast(`${list.length}件の画像を保存しています…`);
  for (const mark of list) {
    if (mark.detached) {
      fail++;
      continue;
    }
    const res = await captureMarkBlob(mark, !shotInclOf(mark.id), hideIds);
    if (!res.ok) {
      fail++;
      continue;
    }
    downloadBlob(res.blob, `marker-helper-shot-${nowStamp()}-${mark.label}.png`);
    ok++;
    // 連続ダウンロードのスロットリング・撮影間の描画安定のため少し待つ
    await delay(300);
  }
  showToast(fail > 0 ? `${ok}件を保存（${fail}件は失敗/対象なし）` : `${ok}件の画像を保存しました`);
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

// ---- 注釈付きレポート出力（HTML / 印刷で PDF 化） ----------------------
// 表示中の全マーカーを、番号・グループ・セレクタ・メモ・スクショ込みの自己完結 HTML に
// まとめて保存する。外部依存は持たず、PDF はブラウザの印刷（PDFで保存）で得る想定。

// Blob を dataURL 文字列にする（レポートへ画像を埋め込むため）。
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(blob);
  });
}

// レポートに差し込む値の HTML エスケープ（ページ由来テキストの混入に備える）。
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// マーク1件分のカード HTML。img は埋め込み用 dataURL（無ければ「画像なし」）。
function reportCard(mark, img) {
  const group = mark.group ? `<span class="grp">${escapeHtml(mark.group)}</span>` : "";
  const detached = mark.detached ? `<span class="det">消失</span>` : "";
  const note = mark.note ? `<p class="note">${escapeHtml(mark.note)}</p>` : "";
  const text = mark.text ? `<p class="txt">${escapeHtml(mark.text)}</p>` : "";
  const xpath = mark.xpath ? `<dt>XPath</dt><dd><code>${escapeHtml(mark.xpath)}</code></dd>` : "";
  const figure = img
    ? `<img src="${img}" alt="#${mark.label} のスクリーンショット" />`
    : `<p class="noimg">画像なし</p>`;
  return `
    <article class="card">
      <div class="head">
        <span class="num" style="background:${escapeHtml(mark.color)}">${mark.label}</span>
        ${group}
        <span class="tag">${escapeHtml(mark.tag)}</span>
        ${detached}
      </div>
      ${note}
      ${text}
      <dl class="sel">
        <dt>CSS</dt><dd><code>${escapeHtml(mark.selector)}</code></dd>
        ${xpath}
      </dl>
      <div class="shot">${figure}</div>
    </article>`;
}

// レポート全体の HTML を組み立てる。スタイルはインラインで自己完結させ、
// 画面では一覧、印刷時は各カードを途中で割らないよう page-break を効かせる。
function buildReportHtml(items, meta) {
  const cards = items.map(({ mark, img }) => reportCard(mark, img)).join("\n");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(meta.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #f5f3f1; color: #1d1b1a;
    font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  .rpt-head { max-width: 900px; margin: 0 auto 16px; }
  .rpt-head h1 { font-size: 20px; margin: 0 0 4px; }
  .rpt-head p { margin: 2px 0; color: #6b635e; font-size: 13px; word-break: break-all; }
  .rpt-head .src { font-size: 13px; }
  .printbtn { margin-top: 10px; padding: 8px 14px; border: 1px solid #d8d2cd; border-radius: 8px;
    background: #fff; color: #1d1b1a; font: inherit; font-weight: 600; cursor: pointer; }
  .printbtn:hover { border-color: #ff3b30; color: #ff3b30; }
  .cards { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .card { background: #fff; border: 1px solid #ece7e3; border-radius: 12px; padding: 14px 16px;
    box-shadow: 0 1px 2px rgba(20,14,10,0.05); }
  .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .num { flex: none; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; color: #fff;
    font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .grp { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px;
    color: #5a463f; background: #efe7e2; }
  .tag { font-size: 13px; font-weight: 600; word-break: break-all; }
  .det { font-size: 10px; font-weight: 700; color: #b25000; background: #ff950022; padding: 1px 6px; border-radius: 6px; }
  .note { margin: 4px 0; font-size: 13px; }
  .txt { margin: 4px 0; font-size: 12px; color: #6b635e; }
  .sel { margin: 8px 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  .sel dt { color: #6b635e; font-size: 11px; font-weight: 700; }
  .sel dd { margin: 0; }
  .sel code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11.5px; word-break: break-all; }
  .shot { margin-top: 8px; }
  .shot img { max-width: 100%; height: auto; border: 1px solid #ece7e3; border-radius: 8px; display: block; }
  .noimg { font-size: 12px; color: #9a928c; }
  @media print {
    body { background: #fff; padding: 0; }
    .noprint { display: none !important; }
    .card { break-inside: avoid; page-break-inside: avoid; box-shadow: none; }
  }
</style>
</head>
<body>
  <header class="rpt-head">
    <h1>${escapeHtml(meta.title)}</h1>
    ${meta.url ? `<p class="src">${escapeHtml(meta.url)}</p>` : ""}
    <p>${escapeHtml(meta.date)} ・ ${items.length}件</p>
    <button type="button" class="printbtn noprint" onclick="window.print()">印刷 / PDFで保存</button>
  </header>
  <div class="cards">
${cards}
  </div>
</body>
</html>`;
}

// 表示中（絞り込み後）の全マーカーを撮影しながら HTML レポートを生成して保存する。
async function generateReport() {
  if (activeTabId == null) {
    showToast("このページでは利用できません");
    return;
  }
  const list = currentMarks.filter(matchesFilter);
  if (list.length === 0) {
    showToast("レポートにするマーカーがありません");
    return;
  }
  // ページURLを取得（撮影前に1回）。全画像保存と同じく状態から hideIds を求める。
  const ex = await sendToTab({ type: "MM_EXPORT_MARKS" });
  const url = (ex && ex.url) || "";
  const hideIds = hideIdsFromState();
  showToast(`${list.length}件のレポートを作成しています…`);
  const items = [];
  for (const mark of list) {
    let img = null;
    if (!mark.detached) {
      const res = await captureMarkBlob(mark, !shotInclOf(mark.id), hideIds);
      if (res.ok) {
        try {
          img = await blobToDataUrl(res.blob);
        } catch {
          img = null;
        }
      }
    }
    items.push({ mark, img });
    // 撮影間の描画安定・captureVisibleTab のスロットリング回避
    await delay(200);
  }
  const meta = { title: "Marker:HELPER レポート", url, date: new Date().toLocaleString("ja-JP") };
  downloadText(buildReportHtml(items, meta), `marker-helper-report-${nowStamp()}.html`, "text/html");
  showToast(`${items.length}件のレポートを保存しました`);
}

const importFileEl = document.getElementById("mm-import-file");
document.getElementById("mm-shot-all").addEventListener("click", saveAllImages);
document.getElementById("mm-report").addEventListener("click", generateReport);
document.getElementById("mm-export").addEventListener("click", exportMarks);
document.getElementById("mm-import").addEventListener("click", () => importFileEl.click());
importFileEl.addEventListener("change", () => {
  const file = importFileEl.files && importFileEl.files[0];
  importMarksFromFile(file);
  // 同じファイルを連続で選べるよう値をリセット
  importFileEl.value = "";
});

// ---- ドラッグ&ドロップ／クリップボードでのインポート ------------------
// ボタンからのファイル選択に加え、JSON ファイルのドロップとクリップボード貼り付けでも
// 取り込めるようにする。一覧の並べ替え（内部 D&D）は Files を運ばないため衝突しない。

// 外部ファイルのドラッグかどうか（並べ替えの内部 D&D と区別する）
function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

// dragenter/leave の入れ子で表示がちらつかないよう深度で管理する
let fileDragDepth = 0;
function setDropActive(active) {
  document.body.classList.toggle("mm-drop-active", active);
}

document.addEventListener("dragenter", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  fileDragDepth++;
  setDropActive(true);
});
document.addEventListener("dragover", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (e) => {
  if (!isFileDrag(e)) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) setDropActive(false);
});
document.addEventListener("drop", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  fileDragDepth = 0;
  setDropActive(false);
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  importMarksFromFile(file);
});

// クリップボード貼り付け。入力欄・編集中の貼り付けは妨げず、マーカー一覧 JSON
// らしきテキスト（識別子を含む）のときだけ取り込む。
document.addEventListener("paste", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  const text = e.clipboardData?.getData("text/plain");
  if (!text || !text.includes(MARKS_FILE_APP)) return;
  e.preventDefault();
  importMarksFromText(text);
});

// ---- 同期 -------------------------------------------------------------

// content からの更新通知（アクティブタブのもののみ反映）
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "MM_MARKS_UPDATED" && sender.tab?.id === activeTabId) {
    // ポップアップ側のトグル操作などで変わった enabled をパネルへ反映する
    if (typeof msg.enabled === "boolean") enabledEl.checked = msg.enabled;
    // 連番表示のグローバル既定も同期し、継承マークの実効表示判定を最新化する
    if (typeof msg.showLabel === "boolean") globalShowLabel = msg.showLabel;
    render(msg.marks);
  }
});

// タブ切替・遷移に追従
chrome.tabs.onActivated.addListener(() => reload());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === activeTabId && info.status === "complete") reload();
});
chrome.windows?.onFocusChanged?.addListener(async (winId) => {
  // 別ウィンドウモードでは、フォーカスされた通常ウィンドウを撮影対象として記憶する
  // （自分のポップアップウィンドウがフォーカスされたときは対象を変えない）。
  if (WINDOW_MODE && winId != null && winId !== chrome.windows.WINDOW_ID_NONE) {
    try {
      const w = await chrome.windows.get(winId);
      if (w && w.type === "normal") lastNormalWindowId = winId;
    } catch {
      /* ウィンドウ消失等は無視 */
    }
  }
  reload();
});

// テスト用フック: Node(jsdom)では自動起動せず内部関数を公開する。
// ブラウザ実行時(module 未定義)は従来どおりブートストラップする。
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    render,
    moveItem,
    moveItemToEdge,
    updateMoveBoundaries,
    commitOrder,
    relabelDom,
    __test: {
      setActiveTabId: (id) => {
        activeTabId = id;
      },
      resetReorder: () => reorderCtl.reset(),
    },
  };
} else {
  loadShotMarks();
  loadSelectorFormat();
  reload();
}
