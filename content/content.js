// Marker HELP — content script
// ホバーで要素をハイライトし、クリックで番号付きマークを固定する。
// マーク状態はこのスクリプトのメモリ内に保持する（セッション内のみ。リロードで消える）。

(() => {
  "use strict";

  // 二重注入ガード（SPA の再評価などに備える）
  if (window.__manualMarkerLoaded) return;
  window.__manualMarkerLoaded = true;

  /** @typedef {{id:number,label:number,selector:string,tag:string,text:string,color:string,lineStyle:string,width:number,el:Element,box:HTMLElement,badge:HTMLElement}} Mark */

  const state = {
    enabled: false,
    /** 新規マークに適用する現在のスタイル。padding は縁と枠線のすき間、radius は角丸(px) */
    style: { color: "#ff3b30", lineStyle: "solid", width: 3, padding: 8, radius: 8 },
    /** 番号ラベル（連番バッジ）を表示するか（既定OFF） */
    showLabel: false,
    /** 番号バッジの表示位置: "tl" | "tr" | "bl" | "br" */
    labelPos: "tl",
    /** @type {Mark[]} */
    marks: [],
    counter: 0,
    hoverTarget: /** @type {Element|null} */ (null),
  };

  // ---- 設定の永続化 -----------------------------------------------------
  // 最後に選んだスタイルとラベル表示は chrome.storage.local に保存し、
  // 次回の content 注入時（新規ページ・リロード）に復元する。
  // マーク自体は従来どおり永続化しない（タブ内メモリのみ）。
  const SETTINGS_KEY = "mm:settings";

  function persistSettings() {
    try {
      chrome.storage.local.set({
        [SETTINGS_KEY]: { style: state.style, showLabel: state.showLabel },
      });
    } catch {
      /* storage 権限が無い等は無視 */
    }
  }

  function restoreSettings() {
    try {
      chrome.storage.local.get(SETTINGS_KEY, (data) => {
        if (chrome.runtime.lastError) return;
        const saved = data && data[SETTINGS_KEY];
        if (!saved) return;
        if (saved.style) {
          state.style = {
            color: saved.style.color ?? state.style.color,
            lineStyle: saved.style.lineStyle ?? state.style.lineStyle,
            width: saved.style.width ?? state.style.width,
            padding: saved.style.padding ?? state.style.padding,
            radius: saved.style.radius ?? state.style.radius,
          };
        }
        if (typeof saved.showLabel === "boolean") {
          state.showLabel = saved.showLabel;
        }
        // 既にホバー枠やマークが描画されていれば見た目へ反映
        syncPositions();
      });
    } catch {
      /* 無視 */
    }
  }

  // ---- オーバーレイ構築 -------------------------------------------------

  let root = null;
  let hoverBox = null;

  function ensureOverlay() {
    if (root && document.documentElement.contains(root)) return;
    root = document.createElement("div");
    root.id = "mm-overlay-root";
    root.setAttribute("aria-hidden", "true");

    hoverBox = document.createElement("div");
    hoverBox.className = "mm-hover-box";
    hoverBox.style.display = "none";
    root.appendChild(hoverBox);

    document.documentElement.appendChild(root);
  }

  function isOwnNode(node) {
    return root && node instanceof Node && root.contains(node);
  }

  // ---- 位置同期 ---------------------------------------------------------

  function applyRect(el, rect) {
    el.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    el.style.width = `${Math.max(0, rect.width)}px`;
    el.style.height = `${Math.max(0, rect.height)}px`;
  }

  // 矩形を余白分だけ外側へ広げる（枠線と対象要素のすき間を作る）
  function padRect(rect, pad) {
    return {
      left: rect.left - pad,
      top: rect.top - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };
  }

  function styleBox(box, mark) {
    box.style.borderStyle = mark.lineStyle;
    box.style.borderWidth = `${mark.width}px`;
    box.style.borderColor = mark.color;
    box.style.borderRadius = `${mark.radius}px`;
    box.style.boxShadow = `0 0 0 1px ${mark.color}55, 0 0 12px ${mark.color}40`;
  }

  function syncPositions() {
    if (!root) return;

    // ホバー枠（現在の余白設定を反映）
    if (state.enabled && state.hoverTarget && document.contains(state.hoverTarget)) {
      const r = padRect(state.hoverTarget.getBoundingClientRect(), state.style.padding);
      hoverBox.style.display = "block";
      applyRect(hoverBox, r);
      hoverBox.style.borderColor = state.style.color;
      hoverBox.style.borderRadius = `${state.style.radius}px`;
    } else {
      hoverBox.style.display = "none";
    }

    // マーク枠とバッジ（各マークが保持する余白を反映）
    for (const mark of state.marks) {
      if (!document.contains(mark.el)) {
        mark.box.style.display = "none";
        mark.badge.style.display = "none";
        continue;
      }
      const r = padRect(mark.el.getBoundingClientRect(), mark.padding);
      mark.box.style.display = "block";
      mark.badge.style.display = state.showLabel ? "flex" : "none";
      applyRect(mark.box, r);
      // バッジの中心を（余白を含めた）枠の左上角に合わせる。
      // 後段の translate(-50%,-50%) はバッジ自身のサイズ基準で半分戻すため、
      // 角を中心に縦横半分ずつはみ出して重なる（プレビューと同じ見え方）。
      mark.badge.style.transform = `translate(${r.left}px, ${r.top}px) translate(-50%, -50%)`;
    }
  }

  // マークがある／マークモード中だけ位置追従ループを回す。
  // 対象が無いアイドル時は requestAnimationFrame を止め、CPU を消費しない。
  let loopId = null;
  function runLoop() {
    if (!state.enabled && state.marks.length === 0) {
      loopId = null;
      return;
    }
    syncPositions();
    loopId = requestAnimationFrame(runLoop);
  }
  function ensureLoop() {
    if (loopId == null) loopId = requestAnimationFrame(runLoop);
  }

  // ---- CSS セレクタ生成 -------------------------------------------------

  function uniqueById(id) {
    try {
      return document.querySelectorAll(`#${CSS.escape(id)}`).length === 1;
    } catch {
      return false;
    }
  }

  function nthOfType(node) {
    let n = 1;
    let sib = node;
    while ((sib = sib.previousElementSibling)) {
      if (sib.nodeName === node.nodeName) n++;
    }
    return n;
  }

  function generateSelector(el) {
    if (!(el instanceof Element)) return "";
    if (el.id && uniqueById(el.id)) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      if (node.id && uniqueById(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        node = null;
        break;
      }
      const tag = node.nodeName.toLowerCase();
      parts.unshift(`${tag}:nth-of-type(${nthOfType(node)})`);
      node = node.parentElement;
    }
    const selector = parts.join(" > ");
    return selector || el.nodeName.toLowerCase();
  }

  function describeTag(el) {
    let s = el.nodeName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    if (typeof el.className === "string" && el.className.trim()) {
      const first = el.className.trim().split(/\s+/)[0];
      if (first) s += `.${first}`;
    }
    return s;
  }

  const WHITESPACE_RE = /\s+/g;
  function snippet(el) {
    const t = (el.textContent || "").replace(WHITESPACE_RE, " ").trim();
    return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  }

  // ---- マーク操作 -------------------------------------------------------

  function findMarkByElement(el) {
    return state.marks.find((m) => m.el === el) || null;
  }

  function addMark(el) {
    ensureOverlay();
    const existing = findMarkByElement(el);
    if (existing) {
      // 同じ要素を再クリックしたら解除（トグル）
      removeMark(existing.id);
      return;
    }

    const id = ++state.counter;

    const box = document.createElement("div");
    box.className = "mm-mark-box";

    const badge = document.createElement("div");
    badge.className = "mm-mark-badge";
    badge.style.background = state.style.color;

    const mark = {
      id,
      label: 0, // 表示用の連番は relabel() が配列の並び順から割り当てる
      selector: generateSelector(el),
      tag: describeTag(el),
      text: snippet(el),
      color: state.style.color,
      lineStyle: state.style.lineStyle,
      width: state.style.width,
      padding: state.style.padding,
      radius: state.style.radius,
      el,
      box,
      badge,
    };
    styleBox(box, mark);
    root.appendChild(box);
    root.appendChild(badge);

    state.marks.push(mark);
    relabel();
    ensureLoop();
    syncPositions();
    broadcast();
  }

  // 表示用の連番を配列の並び順から振り直す（削除後も番号を飛ばさず1から連番にする）
  function relabel() {
    state.marks.forEach((mark, i) => {
      mark.label = i + 1;
      mark.badge.textContent = String(mark.label);
    });
  }

  function removeMark(id) {
    const i = state.marks.findIndex((m) => m.id === id);
    if (i === -1) return;
    const [mark] = state.marks.splice(i, 1);
    mark.box.remove();
    mark.badge.remove();
    relabel();
    broadcast();
  }

  function clearAll() {
    for (const mark of state.marks) {
      mark.box.remove();
      mark.badge.remove();
    }
    state.marks = [];
    state.counter = 0;
    broadcast();
  }

  function scrollToMark(id) {
    const mark = state.marks.find((m) => m.id === id);
    if (!mark || !document.contains(mark.el)) return;
    mark.el.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.box.classList.remove("mm-flash");
    // 再トリガのため reflow を挟む
    void mark.box.offsetWidth;
    mark.box.classList.add("mm-flash");
  }

  // ---- 状態の直列化と通知 ----------------------------------------------

  function serializeMarks() {
    return state.marks.map((m) => ({
      id: m.id,
      label: m.label,
      selector: m.selector,
      tag: m.tag,
      text: m.text,
      color: m.color,
      lineStyle: m.lineStyle,
      width: m.width,
      detached: !document.contains(m.el),
    }));
  }

  function broadcast() {
    try {
      chrome.runtime.sendMessage({ type: "MM_MARKS_UPDATED", marks: serializeMarks() });
    } catch {
      /* 受信側がいない場合は無視 */
    }
  }

  // ---- 入力ハンドラ -----------------------------------------------------

  function onMouseMove(e) {
    if (!state.enabled) return;
    const target = e.target;
    if (!(target instanceof Element) || isOwnNode(target)) return;
    if (state.hoverTarget === target) return;
    state.hoverTarget = target;
    // 反映は追従ループ（runLoop）が次フレームで行う
  }

  function onClickCapture(e) {
    if (!state.enabled) return;
    const target = e.target;
    if (!(target instanceof Element) || isOwnNode(target)) return;
    // ページ本来の挙動（リンク遷移・ボタン送信など）を抑止してマークに使う
    e.preventDefault();
    e.stopPropagation();
    addMark(target);
  }

  // capture フェーズで先取りしてページのハンドラより先に処理する
  document.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
  document.addEventListener("click", onClickCapture, { capture: true });

  function setEnabled(enabled) {
    state.enabled = enabled;
    document.documentElement.classList.toggle("mm-marking", enabled);
    if (!enabled) {
      state.hoverTarget = null;
    } else {
      ensureOverlay();
      ensureLoop();
    }
    syncPositions();
  }

  function setShowLabel(show) {
    state.showLabel = Boolean(show);
    syncPositions();
  }

  // ---- メッセージ受信 ---------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "MM_GET_STATE":
        sendResponse({
          enabled: state.enabled,
          style: state.style,
          showLabel: state.showLabel,
          marks: serializeMarks(),
        });
        break;
      case "MM_SET_LABELS":
        setShowLabel(msg.show);
        persistSettings();
        sendResponse({ ok: true, showLabel: state.showLabel });
        break;
      case "MM_SET_ENABLED":
        setEnabled(Boolean(msg.enabled));
        sendResponse({ ok: true, enabled: state.enabled });
        break;
      case "MM_SET_STYLE":
        if (msg.style) {
          state.style = {
            color: msg.style.color ?? state.style.color,
            lineStyle: msg.style.lineStyle ?? state.style.lineStyle,
            width: msg.style.width ?? state.style.width,
            padding: msg.style.padding ?? state.style.padding,
            radius: msg.style.radius ?? state.style.radius,
          };
        }
        persistSettings();
        sendResponse({ ok: true, style: state.style });
        break;
      case "MM_CLEAR_ALL":
        clearAll();
        sendResponse({ ok: true });
        break;
      case "MM_REMOVE_MARK":
        removeMark(msg.id);
        sendResponse({ ok: true });
        break;
      case "MM_SCROLL_TO":
        scrollToMark(msg.id);
        sendResponse({ ok: true });
        break;
      default:
        return false;
    }
    return true; // 非同期応答の可能性に備える
  });

  // 保存済みの設定（スタイル・ラベル表示）を復元する
  restoreSettings();
})();
