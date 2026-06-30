// Marker:HELPER — content script
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
    /** 新規マークに適用する現在のスタイル。padding は縁と枠線のすき間、radius は角丸(px)、transparency は透明度(%) */
    style: { color: "#ff3b30", lineStyle: "solid", width: 4, padding: 8, radius: 8, transparency: 0 },
    /** 番号ラベル（連番バッジ）を表示するか（既定OFF） */
    showLabel: false,
    /** 番号バッジの表示位置: "tl" | "tr" | "bl" | "br"（既定は左上） */
    labelPos: "tl",
    /** @type {Mark[]} */
    marks: [],
    counter: 0,
    hoverTarget: /** @type {Element|null} */ (null),
  };

  // ---- スタイル値のサニタイズ -------------------------------------------
  // 外部（chrome.storage や popup からのメッセージ）由来のスタイル値を、
  // 受信側でも値域に丸めて取り込む（多層防御）。popup 側でもクランプ済みだが、
  // ストレージ改変や将来の送信元追加に備えて content 側を信頼境界として扱う。
  const LINE_STYLES = ["solid", "dashed", "dotted"];
  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  // n を [min, max] に丸めた整数にする。数値化できなければ fallback を返す。
  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // 部分的なスタイル入力を現在値ベースで検証・クランプして新しいスタイルを返す。
  function sanitizeStyle(input, base) {
    if (!input || typeof input !== "object") return { ...base };
    return {
      color: HEX_COLOR_RE.test(input.color) ? input.color : base.color,
      lineStyle: LINE_STYLES.includes(input.lineStyle) ? input.lineStyle : base.lineStyle,
      width: clampInt(input.width, 1, 20, base.width),
      padding: clampInt(input.padding, 0, 40, base.padding),
      radius: clampInt(input.radius, 0, 40, base.radius),
      transparency: clampInt(input.transparency, 0, 100, base.transparency),
    };
  }

  // ---- 設定の永続化 -----------------------------------------------------
  // 最後に選んだスタイルとラベル表示は chrome.storage.local に保存し、
  // 次回の content 注入時（新規ページ・リロード）に復元する。
  // マーク自体は従来どおり永続化しない（タブ内メモリのみ）。
  const SETTINGS_KEY = "mm:settings";

  function persistSettings() {
    try {
      chrome.storage.local.set({
        [SETTINGS_KEY]: {
          style: state.style,
          showLabel: state.showLabel,
          labelPos: state.labelPos,
        },
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
          state.style = sanitizeStyle(saved.style, state.style);
        }
        if (typeof saved.showLabel === "boolean") {
          state.showLabel = saved.showLabel;
        }
        if (["tl", "tr", "bl", "br"].includes(saved.labelPos)) {
          state.labelPos = saved.labelPos;
        }
        // 既にホバー枠やマークが描画されていれば見た目へ反映
        syncPositions();
      });
    } catch {
      /* 無視 */
    }
  }

  // ---- マークの自動保存（セッション） -----------------------------------
  // マーク本体は従来「タブ内メモリのみ」だったが、誤リロードでの消失を防ぐため
  // chrome.storage.session に URL 単位で自動保存し、再注入時に同一 URL なら復元する。
  // session 領域はブラウザ終了で消えるため「セッション中だけ生存」の性質は保たれる。
  // （content から session を使うため background で setAccessLevel 済み。未許可環境では
  //  例外を握り潰して従来どおりメモリのみで動作する。）
  const AUTOSAVE_PREFIX = "mm:auto:";
  const AUTOSAVE_DEBOUNCE_MS = 400;

  function autosaveKey() {
    return AUTOSAVE_PREFIX + location.href;
  }

  function saveMarks() {
    try {
      const session = chrome.storage.session;
      if (!session) return;
      const key = autosaveKey();
      const marks = serializeMarksForExport();
      if (marks.length === 0) {
        session.remove(key, () => void chrome.runtime.lastError);
        return;
      }
      session.set({ [key]: { url: location.href, marks } }, () => void chrome.runtime.lastError);
    } catch {
      /* session 未許可など。メモリのみで継続する */
    }
  }

  let autosaveTimer = null;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveMarks, AUTOSAVE_DEBOUNCE_MS);
  }

  // 再注入（リロード・SPA再評価）時に、同一 URL の保存があれば復元する。
  function restoreMarks() {
    try {
      const session = chrome.storage.session;
      if (!session) return;
      session.get(autosaveKey(), (data) => {
        if (chrome.runtime.lastError) return;
        const saved = data && data[autosaveKey()];
        if (!saved || !Array.isArray(saved.marks) || saved.marks.length === 0) return;
        // まだ何もマークしていないときだけ復元する（ユーザー操作を上書きしない）
        if (state.marks.length > 0) return;
        importMarks(saved.marks);
      });
    } catch {
      /* 無視 */
    }
  }

  // ---- オーバーレイ構築 -------------------------------------------------

  let root = null;
  let hoverBox = null;
  // 撮影中はマーキングモードのホバー強調枠を一時的に抑止する（スクショへの写り込み防止）。
  // state.enabled 自体は変えないため popup のトグル状態には影響しない。
  let capturing = false;

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

  // バッジを重ねる枠の角座標を labelPos（tl/tr/bl/br）から求める
  function badgeCorner(r, pos) {
    const x = pos === "tr" || pos === "br" ? r.left + r.width : r.left;
    const y = pos === "bl" || pos === "br" ? r.top + r.height : r.top;
    return { x, y };
  }

  function styleBox(box, mark) {
    box.style.borderStyle = mark.lineStyle;
    box.style.borderWidth = `${mark.width}px`;
    box.style.borderColor = mark.color;
    box.style.borderRadius = `${mark.radius}px`;
    // 透明度(%) を不透明度(opacity)に変換して適用（0%=不透明, 100%=完全透明）
    box.style.opacity = String(1 - (mark.transparency || 0) / 100);
  }

  function syncPositions() {
    if (!root) return;

    // ホバー枠（現在の余白設定を反映）
    if (state.enabled && !capturing && state.hoverTarget && document.contains(state.hoverTarget)) {
      const r = padRect(state.hoverTarget.getBoundingClientRect(), state.style.padding);
      hoverBox.style.display = "block";
      applyRect(hoverBox, r);
      hoverBox.style.borderColor = state.style.color;
      hoverBox.style.borderRadius = `${state.style.radius}px`;
      hoverBox.style.opacity = String(1 - (state.style.transparency || 0) / 100);
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
      // バッジの中心を（余白を含めた）枠の指定角に合わせる。
      // 後段の translate(-50%,-50%) はバッジ自身のサイズ基準で半分戻すため、
      // 角を中心に縦横半分ずつはみ出して重なる（プレビューと同じ見え方）。
      const c = badgeCorner(r, state.labelPos);
      mark.badge.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -50%)`;
    }
  }

  // マークがある／マーキングモード中だけ位置追従ループを回す。
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

  // 動的ページでも壊れにくい安定属性。これらが一意なら nth-of-type より優先する。
  const STABLE_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa", "data-id", "name", "aria-label"];

  function isUniqueSelector(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  }

  // 属性セレクタ用に値をダブルクォート文字列としてエスケープする
  function cssAttrValue(value) {
    return `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
  }

  // 要素単体で一意になる安定セレクタ（属性／クラス）を探す。無ければ null。
  function uniqueAttrSelector(el) {
    const tag = el.nodeName.toLowerCase();
    for (const attr of STABLE_ATTRS) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (!v) continue;
      const sel = `${tag}[${attr}=${cssAttrValue(v)}]`;
      if (isUniqueSelector(sel)) return sel;
    }
    // 単一クラスで一意になるならそれも候補にする
    if (typeof el.className === "string" && el.className.trim()) {
      for (const cls of el.className.trim().split(/\s+/)) {
        const sel = `${tag}.${CSS.escape(cls)}`;
        if (isUniqueSelector(sel)) return sel;
      }
    }
    return null;
  }

  function generateSelector(el) {
    if (!(el instanceof Element)) return "";
    if (el.id && uniqueById(el.id)) return `#${CSS.escape(el.id)}`;
    // id が無くても安定属性で一意になるならそれを使う（動的ページで壊れにくい）
    const attrSel = uniqueAttrSelector(el);
    if (attrSel) return attrSel;

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

  // ---- XPath 生成 -------------------------------------------------------

  // XPath の文字列リテラル化（引用符を含む値は concat() で表現する）
  function xpathLiteral(s) {
    const str = String(s);
    if (!str.includes('"')) return `"${str}"`;
    if (!str.includes("'")) return `'${str}'`;
    return `concat("${str.replace(/"/g, '",\'"\',"')}")`;
  }

  // 一意な id があれば //*[@id=...] を起点に、無ければ /html/body/... の位置指定で組む。
  function generateXPath(el) {
    if (!(el instanceof Element)) return "";
    const segs = [];
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.id && uniqueById(node.id)) {
        segs.unshift(`*[@id=${xpathLiteral(node.id)}]`);
        return `//${segs.join("/")}`;
      }
      if (node === document.documentElement) {
        segs.unshift("html");
        break;
      }
      let idx = 1;
      let sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName === node.nodeName) idx++;
      }
      segs.unshift(`${node.nodeName.toLowerCase()}[${idx}]`);
      node = node.parentElement;
    }
    return `/${segs.join("/")}`;
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

  // メモ（注釈）は自由記述。長すぎる値は保存・通信コストのため上限で切り詰める。
  const NOTE_MAX = 500;
  function sanitizeNote(value) {
    if (typeof value !== "string") return "";
    return value.length > NOTE_MAX ? value.slice(0, NOTE_MAX) : value;
  }

  // グループ名は分類用の短いラベル（自由記述）。前後空白を除き上限で切り詰める。
  const GROUP_MAX = 30;
  function sanitizeGroup(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed.length > GROUP_MAX ? trimmed.slice(0, GROUP_MAX) : trimmed;
  }

  // 要素と確定済みスタイルからマーク本体を生成して state へ積む（描画要素も作る）。
  // 後処理（relabel / ループ起動 / 位置同期 / 通知）は呼び出し側で行う。
  function buildMark(el, st, note, group) {
    const id = ++state.counter;

    const box = document.createElement("div");
    box.className = "mm-mark-box";

    const badge = document.createElement("div");
    badge.className = "mm-mark-badge";
    badge.style.background = st.color;

    const mark = {
      id,
      label: 0, // 表示用の連番は relabel() が配列の並び順から割り当てる
      selector: generateSelector(el),
      xpath: generateXPath(el),
      tag: describeTag(el),
      text: snippet(el),
      note: sanitizeNote(note),
      group: sanitizeGroup(group),
      color: st.color,
      lineStyle: st.lineStyle,
      width: st.width,
      padding: st.padding,
      radius: st.radius,
      transparency: st.transparency,
      el,
      box,
      badge,
    };
    styleBox(box, mark);
    root.appendChild(box);
    root.appendChild(badge);

    state.marks.push(mark);
    return mark;
  }

  function addMark(el) {
    ensureOverlay();
    const existing = findMarkByElement(el);
    if (existing) {
      // 同じ要素を再クリックしたら解除（トグル）
      removeMark(existing.id);
      return;
    }

    buildMark(el, state.style);
    relabel();
    ensureLoop();
    syncPositions();
    broadcast();
    scheduleAutosave();
  }

  // 一覧（エクスポートしたJSON）からマークを復元する。
  // 各 item の selector で現在のページの要素を再特定し、見つかったものだけ復元する。
  // 既存マークは置き換える（保存した一覧をそのまま読み込む想定）。
  // 戻り値: { ok, restored, skipped }
  function importMarks(items) {
    if (!Array.isArray(items)) return { ok: false, restored: 0, skipped: 0 };
    ensureOverlay();
    clearAll(); // 置き換え方式: 既存マークを一旦すべて消す

    let restored = 0;
    let skipped = 0;
    for (const item of items) {
      if (!item || typeof item.selector !== "string") {
        skipped++;
        continue;
      }
      let el = null;
      try {
        el = document.querySelector(item.selector);
      } catch {
        el = null; // 不正なセレクタは無視
      }
      // 要素が見つからない／既に同一要素をマーク済みなら除外
      if (!(el instanceof Element) || findMarkByElement(el)) {
        skipped++;
        continue;
      }
      // スタイルは content 側の値域で検証・クランプしてから採用する
      buildMark(el, sanitizeStyle(item, state.style), item.note, item.group);
      restored++;
    }

    relabel();
    ensureLoop();
    syncPositions();
    broadcast();
    scheduleAutosave();
    return { ok: true, restored, skipped };
  }

  // 表示用の連番を配列の並び順から振り直す（削除後も番号を飛ばさず1から連番にする）
  function relabel() {
    state.marks.forEach((mark, i) => {
      mark.label = i + 1;
      mark.badge.textContent = String(mark.label);
    });
  }

  // 指定された id 順に marks を並べ替える（panel のドラッグ操作で連番を入れ替える）
  function reorderMarks(ids) {
    if (!Array.isArray(ids)) return;
    const byId = new Map(state.marks.map((m) => [m.id, m]));
    const next = [];
    for (const id of ids) {
      const m = byId.get(id);
      if (m) {
        next.push(m);
        byId.delete(id);
      }
    }
    // ids に載らなかったマークは元の順序で末尾に残す（取りこぼし防止）
    for (const m of state.marks) {
      if (byId.has(m.id)) next.push(m);
    }
    if (next.length !== state.marks.length) return;
    state.marks = next;
    relabel();
    syncPositions();
    broadcast();
    scheduleAutosave();
  }

  // 既存マークの色だけを変更する（新規マークの既定スタイルには影響しない）。
  // 枠・バッジへ即時反映し、panel の一覧へも通知する。
  function setMarkColor(id, color) {
    if (!HEX_COLOR_RE.test(color)) return;
    const mark = state.marks.find((m) => m.id === id);
    if (!mark) return;
    mark.color = color;
    mark.badge.style.background = color;
    styleBox(mark.box, mark);
    broadcast();
    scheduleAutosave();
  }

  // 既存マークの枠スタイル（色以外も含む）を個別に変更する。patch には
  // color/lineStyle/width/padding/radius/transparency のうち変更分だけを渡す。
  // 与えられなかった項目・不正値は現在値を維持する（sanitizeStyle のフォールバック）。
  // 新規マークの既定スタイル（state.style）には影響しない。
  function setMarkStyle(id, patch) {
    if (!patch || typeof patch !== "object") return;
    const mark = state.marks.find((m) => m.id === id);
    if (!mark) return;
    const current = {
      color: mark.color,
      lineStyle: mark.lineStyle,
      width: mark.width,
      padding: mark.padding,
      radius: mark.radius,
      transparency: mark.transparency,
    };
    const next = sanitizeStyle({ ...current, ...patch }, current);
    mark.color = next.color;
    mark.lineStyle = next.lineStyle;
    mark.width = next.width;
    mark.padding = next.padding;
    mark.radius = next.radius;
    mark.transparency = next.transparency;
    mark.badge.style.background = next.color;
    styleBox(mark.box, mark);
    // padding は枠の寸法に影響するため、追従ループの次フレームを待たず即時に反映する
    syncPositions();
    broadcast();
    scheduleAutosave();
  }

  function removeMark(id) {
    const i = state.marks.findIndex((m) => m.id === id);
    if (i === -1) return;
    const [mark] = state.marks.splice(i, 1);
    mark.box.remove();
    mark.badge.remove();
    relabel();
    broadcast();
    scheduleAutosave();
  }

  function clearAll() {
    for (const mark of state.marks) {
      mark.box.remove();
      mark.badge.remove();
    }
    state.marks = [];
    state.counter = 0;
    broadcast();
    scheduleAutosave();
  }

  // 指定マークのメモ（注釈）を更新する。表示要素には影響しないため再描画は不要。
  // 編集中の panel の再描画・フォーカス喪失を避けるため broadcast はしない
  // （content が source of truth なのでエクスポート/永続化には反映される）。
  function setNote(id, note) {
    const mark = state.marks.find((m) => m.id === id);
    if (!mark) return;
    mark.note = sanitizeNote(note);
    scheduleAutosave();
  }

  // 指定マークのグループ名を更新する。一覧のチップ表示・色分けを更新するため
  // broadcast する（入力は change=確定時に届くため再描画でフォーカスは失わない）。
  function setGroup(id, group) {
    const mark = state.marks.find((m) => m.id === id);
    if (!mark) return;
    mark.group = sanitizeGroup(group);
    broadcast();
    scheduleAutosave();
  }

  // セレクタ文字列で要素を再特定する。CSS は querySelector、XPath は evaluate。
  // 不正なセレクタは例外になるため null を返す（呼び出し側で失敗扱いにする）。
  function resolveBySelector(value, isXPath) {
    try {
      if (isXPath) {
        const r = document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return r.singleNodeValue instanceof Element ? r.singleNodeValue : null;
      }
      const el = document.querySelector(value);
      return el instanceof Element ? el : null;
    } catch {
      return null;
    }
  }

  // 指定マークのセレクタ（CSS/XPath）を編集し、その文字列で要素を再特定して貼り替える。
  // タグ・テキスト・追従位置は新要素に合わせ直す。編集した形式の文字列はそのまま採用し、
  // もう一方の形式は新要素から生成し直して整合させる。見つからない／不正なセレクタや
  // 拡張機能自身の要素は貼り替えず、理由付きで失敗を返す（panel が元の表示へ戻す）。
  function setMarkSelector(id, value, format) {
    const mark = state.marks.find((m) => m.id === id);
    if (!mark) return { ok: false, reason: "notfound" };
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return { ok: false, reason: "empty" };
    const isXPath = format === "xpath";
    const el = resolveBySelector(raw, isXPath);
    if (!el) return { ok: false, reason: "nomatch" };
    if (isOwnNode(el)) return { ok: false, reason: "own" };

    mark.el = el;
    mark.tag = describeTag(el);
    mark.text = snippet(el);
    if (isXPath) {
      mark.xpath = raw;
      mark.selector = generateSelector(el);
    } else {
      mark.selector = raw;
      mark.xpath = generateXPath(el);
    }
    ensureLoop();
    syncPositions();
    broadcast();
    scheduleAutosave();
    return { ok: true };
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

  // 指定マークの要素の文字列内容（textContent / outerHTML）を返す。
  // ページDOMは読むだけで書き換えない。通信コストのため上限で切り詰める。
  const ELEMENT_CONTENT_MAX = 50000;
  function getElementContent(id) {
    const mark = state.marks.find((m) => m.id === id);
    if (!mark || !document.contains(mark.el)) return { ok: false, reason: "detached" };
    const text = (mark.el.textContent || "").slice(0, ELEMENT_CONTENT_MAX);
    const html = (mark.el.outerHTML || "").slice(0, ELEMENT_CONTENT_MAX);
    return { ok: true, text, html };
  }

  // ---- 要素インスペクト（computed style / コントラスト比など） ----------
  // ページDOMは読むだけ。色は getComputedStyle の rgb(a) 文字列を解析して扱う。

  function parseRgb(str) {
    const m = /rgba?\(([^)]+)\)/i.exec(String(str || ""));
    if (!m) return null;
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 ? parts[3] : 1 };
  }

  function rgbToHex(c) {
    if (!c) return "";
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  }

  // WCAG の相対輝度。0..1 に正規化した各チャンネルにガンマ補正を施す。
  function relLuminance(c) {
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }

  function contrastRatio(fg, bg) {
    if (!fg || !bg) return null;
    const l1 = relLuminance(fg);
    const l2 = relLuminance(bg);
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }

  // 背景色は透明なことが多いため、祖先を辿って最初の不透明な背景色を採用する。
  // 見つからなければ白とみなす（一般的なページ背景の近似）。
  function effectiveBackground(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const c = parseRgb(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  // フォント指定の先頭ファミリだけを取り出す（引用符を除去）
  function primaryFont(family) {
    const first = String(family || "").split(",")[0].trim();
    return first.replace(/^["']|["']$/g, "");
  }

  function inspectElement(id) {
    const mark = state.marks.find((m) => m.id === id);
    if (!mark || !document.contains(mark.el)) return { ok: false, reason: "detached" };
    const el = mark.el;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const fg = parseRgb(cs.color);
    const bg = effectiveBackground(el);
    const ratio = contrastRatio(fg, bg);
    return {
      ok: true,
      info: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        color: rgbToHex(fg) || cs.color,
        background: rgbToHex(bg),
        contrast: ratio != null ? Math.round(ratio * 100) / 100 : null,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontFamily: primaryFont(cs.fontFamily),
        padding: cs.padding,
        margin: cs.margin,
        display: cs.display,
        role: (el.getAttribute && el.getAttribute("role")) || "",
        ariaLabel: (el.getAttribute && el.getAttribute("aria-label")) || "",
      },
    };
  }

  // キーボードショートカットで次/前のマーカーへ順送りにスクロールする。
  // 直近にジャンプしたマークの並び位置を起点に dir(+1/-1) で移動し、端は巻き戻す。
  // detached（DOM から消えた）マークは対象から外す。
  let lastJumpId = null;
  function jumpToMark(dir) {
    const live = state.marks.filter((m) => document.contains(m.el));
    if (live.length === 0) return;
    const from = live.findIndex((m) => m.id === lastJumpId);
    // 起点が無ければ、次へ=先頭/前へ=末尾から始める
    const base = from === -1 ? (dir > 0 ? -1 : 0) : from;
    const next = (base + dir + live.length) % live.length;
    const mark = live[next];
    lastJumpId = mark.id;
    scrollToMark(mark.id);
  }

  // ---- スクショ撮影の下準備（panel から呼ばれる） ----------------------
  // panel は「下準備 → captureVisibleTab → 復帰」の順で呼ぶ。撮影画像に同時に
  // 写り込む各マークの枠・番号は、panel の「マーカー込み」設定（=hideIds に列挙
  // された未チェックのマーク）だけを一時的に隠し、チェック済みは表示のまま写す。
  let captureRestoreTimer = null;
  // 撮影のため一時的に visibility:hidden にした要素（復帰時に元へ戻す）
  let hiddenForCapture = [];
  // 撮影開始時のスクロール位置。縦長要素のスクロール撮影後に元へ戻すため保持する。
  let captureOriginScroll = null;

  // スクロール後にレイアウト・描画が落ち着くのを待つ時間
  const CAPTURE_SETTLE_MS = 250;
  // 縦長スクロール撮影は時間がかかるため、保険タイマーは長めに取る
  const CAPTURE_SAFETY_MS = 8000;
  // requestAnimationFrame + タイマーで再描画の落ち着きを待つ
  function waitForSettle() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, CAPTURE_SETTLE_MS));
    });
  }

  // panel が復帰メッセージを送れなかった場合に備え、一定時間後に必ず復帰する保険を張り直す
  function armRestoreTimer() {
    clearTimeout(captureRestoreTimer);
    captureRestoreTimer = setTimeout(restoreCapture, CAPTURE_SAFETY_MS);
  }

  async function prepareCapture(id, clean, hideIds) {
    const mark = state.marks.find((m) => m.id === id);
    if (!mark || !document.contains(mark.el)) {
      return { ok: false, reason: "detached" };
    }
    // 撮影シーケンス開始時の元スクロール位置を記録（復帰時に戻す）
    if (!capturing) {
      captureOriginScroll = { x: window.scrollX, y: window.scrollY };
    }
    // 対象をビューポート中央へ（撮影のため瞬時にスクロール。smooth は使わない）
    mark.el.scrollIntoView({ block: "center", inline: "center" });
    // 撮影中はホバー強調枠を抑止する（マーキングモードのオーバーレイ写り込み防止）
    capturing = true;
    // 直前の撮影で隠した要素が残っていれば先に復帰してから隠し直す
    restoreHidden();
    // 未チェック（hideIds に列挙）のマークだけ枠・番号を隠す。後方互換として
    // hideIds 未指定で clean のときは対象のみ隠す（従来の単体撮影と同等）。
    const hideSet = new Set(Array.isArray(hideIds) ? hideIds : []);
    if (!Array.isArray(hideIds) && clean) hideSet.add(id);
    for (const m of state.marks) {
      if (!hideSet.has(m.id)) continue;
      for (const el of [m.box, m.badge]) {
        if (el && el.style.visibility !== "hidden") {
          hiddenForCapture.push(el);
          el.style.visibility = "hidden";
        }
      }
    }
    // panel が復帰メッセージを送れなかった場合の保険（一定時間後に必ず戻す）
    armRestoreTimer();
    await waitForSettle();
    // 待機中に対象が外れた場合は復帰して中止
    if (!document.contains(mark.el)) {
      restoreCapture();
      return { ok: false, reason: "detached" };
    }
    const vrect = captureRect(mark, clean);
    // ビューポートより縦に大きい要素は1枚に収まらないため、panel 側でスクロール
    // 撮影して継ぎ合わせる。そのためページ座標の矩形（スクロール非依存）を返す。
    const pageRect = {
      x: vrect.x + window.scrollX,
      y: vrect.y + window.scrollY,
      width: vrect.width,
      height: vrect.height,
    };
    return {
      ok: true,
      rect: vrect,
      pageRect,
      tall: pageRect.height > window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  // 縦長要素の継ぎ合わせ撮影用。指定のページ Y までスクロールし、落ち着いてから
  // 現在のスクロール位置・ビューポート・dpr を返す（panel が各スライスを切り出す）。
  async function scrollForCapture(y) {
    window.scrollTo(0, Math.max(0, Math.round(y)));
    // 撮影が長引くので保険タイマーを延長し直す
    armRestoreTimer();
    await waitForSettle();
    return {
      ok: true,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      dpr: window.devicePixelRatio || 1,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  // 撮影の切り出し矩形を求める。clean=true は素の要素のみ。clean=false は
  // 枠・連番バッジが要素の外側に描かれるため、それらの実矩形を含む範囲へ広げる
  // （要素ぴったりだと枠・番号が切り落とされて写らないため）。
  function captureRect(mark, clean) {
    const base = mark.el.getBoundingClientRect();
    if (clean) {
      return { x: base.left, y: base.top, width: base.width, height: base.height };
    }
    let left = base.left;
    let top = base.top;
    let right = base.right;
    let bottom = base.bottom;
    // box は常時表示。badge は showLabel=OFF のとき display:none で 0 矩形になる。
    for (const el of [mark.box, mark.badge]) {
      if (!el || el.style.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  // 撮影のため隠した要素を元の表示状態へ戻す
  function restoreHidden() {
    for (const el of hiddenForCapture) {
      if (el) el.style.visibility = "";
    }
    hiddenForCapture = [];
  }

  function restoreCapture() {
    clearTimeout(captureRestoreTimer);
    captureRestoreTimer = null;
    restoreHidden();
    // ホバー強調枠の抑止を解除（次フレームの syncPositions で必要なら再表示）
    capturing = false;
    // 撮影で動かしたスクロール位置を元へ戻す
    if (captureOriginScroll) {
      window.scrollTo(captureOriginScroll.x, captureOriginScroll.y);
      captureOriginScroll = null;
    }
  }

  // ---- 状態の直列化と通知 ----------------------------------------------

  function serializeMarks() {
    return state.marks.map((m) => ({
      id: m.id,
      label: m.label,
      selector: m.selector,
      xpath: m.xpath,
      tag: m.tag,
      text: m.text,
      note: m.note,
      group: m.group,
      color: m.color,
      lineStyle: m.lineStyle,
      width: m.width,
      padding: m.padding,
      radius: m.radius,
      transparency: m.transparency,
      detached: !document.contains(m.el),
    }));
  }

  // エクスポート用: 復元に必要なスタイル（padding/radius/transparency 含む）を全て出す。
  // 表示用の serializeMarks とは別物（内部 id は端末固有のため含めない）。
  function serializeMarksForExport() {
    return state.marks.map((m) => ({
      label: m.label,
      selector: m.selector,
      xpath: m.xpath,
      tag: m.tag,
      text: m.text,
      note: m.note,
      group: m.group,
      color: m.color,
      lineStyle: m.lineStyle,
      width: m.width,
      padding: m.padding,
      radius: m.radius,
      transparency: m.transparency,
      detached: !document.contains(m.el),
    }));
  }

  function broadcast() {
    try {
      chrome.runtime.sendMessage({
        type: "MM_MARKS_UPDATED",
        enabled: state.enabled,
        marks: serializeMarks(),
      });
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
    // popup / panel 双方のマーキングモードトグルを同期させる
    broadcast();
  }

  function setShowLabel(show) {
    state.showLabel = Boolean(show);
    syncPositions();
  }

  function setLabelPos(pos) {
    if (pos === "tl" || pos === "tr" || pos === "bl" || pos === "br") {
      state.labelPos = pos;
      syncPositions();
    }
  }

  // ---- メッセージ受信 ---------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "MM_GET_STATE":
        sendResponse({
          enabled: state.enabled,
          style: state.style,
          showLabel: state.showLabel,
          labelPos: state.labelPos,
          marks: serializeMarks(),
        });
        break;
      case "MM_SET_LABELS":
        setShowLabel(msg.show);
        persistSettings();
        sendResponse({ ok: true, showLabel: state.showLabel });
        break;
      case "MM_SET_LABEL_POS":
        setLabelPos(msg.pos);
        persistSettings();
        sendResponse({ ok: true, labelPos: state.labelPos });
        break;
      case "MM_SET_ENABLED":
        setEnabled(Boolean(msg.enabled));
        sendResponse({ ok: true, enabled: state.enabled });
        break;
      case "MM_TOGGLE_ENABLED":
        // ショートカット用。現在の状態を反転する（broadcast で popup/panel も同期）
        setEnabled(!state.enabled);
        sendResponse({ ok: true, enabled: state.enabled });
        break;
      case "MM_SET_STYLE":
        if (msg.style) {
          state.style = sanitizeStyle(msg.style, state.style);
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
      case "MM_SET_NOTE":
        setNote(msg.id, msg.note);
        sendResponse({ ok: true });
        break;
      case "MM_SET_GROUP":
        setGroup(msg.id, msg.group);
        sendResponse({ ok: true });
        break;
      case "MM_SET_MARK_COLOR":
        setMarkColor(msg.id, msg.color);
        sendResponse({ ok: true });
        break;
      case "MM_SET_MARK_STYLE":
        setMarkStyle(msg.id, msg.patch);
        sendResponse({ ok: true });
        break;
      case "MM_SET_SELECTOR":
        sendResponse(setMarkSelector(msg.id, msg.value, msg.format));
        break;
      case "MM_REORDER_MARKS":
        reorderMarks(msg.ids);
        sendResponse({ ok: true });
        break;
      case "MM_SCROLL_TO":
        scrollToMark(msg.id);
        sendResponse({ ok: true });
        break;
      case "MM_JUMP":
        jumpToMark(msg.dir === -1 ? -1 : 1);
        sendResponse({ ok: true });
        break;
      case "MM_GET_ELEMENT_CONTENT":
        sendResponse(getElementContent(msg.id));
        break;
      case "MM_INSPECT_ELEMENT":
        sendResponse(inspectElement(msg.id));
        break;
      case "MM_CAPTURE_PREPARE":
        prepareCapture(msg.id, Boolean(msg.clean), msg.hideIds).then(sendResponse);
        break;
      case "MM_CAPTURE_SCROLL":
        scrollForCapture(msg.y).then(sendResponse);
        break;
      case "MM_CAPTURE_RESTORE":
        restoreCapture();
        sendResponse({ ok: true });
        break;
      case "MM_EXPORT_MARKS":
        // 復元用に全スタイルとページURLを返す（保存は panel 側で行う）
        sendResponse({ ok: true, url: location.href, marks: serializeMarksForExport() });
        break;
      case "MM_IMPORT_MARKS":
        sendResponse(importMarks(msg.marks));
        break;
      default:
        return false;
    }
    return true; // 非同期応答の可能性に備える
  });

  // 保存済みの設定（スタイル・ラベル表示）を復元する
  restoreSettings();
  // 同一 URL に自動保存されたマークがあれば復元する（誤リロードからの復帰）
  restoreMarks();
})();
