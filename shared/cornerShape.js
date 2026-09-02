// 角の形式（CSS corner-shape）の値を扱う唯一の場所（content / popup / panel / テストで共有）。
// border-radius と組み合わせて角の曲率を変える。プリセットのキーワードに加えて
// superellipse(k) を数値で指定できる。k は指数そのものではなく 2 を底とする対数で、
// 大きいほど角ばり負値でえぐれる（Chrome の算出値で確認した対応）:
//   superellipse(0)=bevel / superellipse(1)=round / superellipse(2)=squircle
//   superellipse(-1)=scoop / superellipse(infinity)=square
// corner-shape 未対応のブラウザでは無視され round（通常の角丸）と同じ見た目になる。
// ブラウザでは globalThis.MMShared に生やし、Node(テスト)では module.exports する両対応モジュール。
(function (root) {
  "use strict";

  const CORNER_SHAPES = ["round", "squircle", "bevel", "scoop", "notch", "square"];
  const SUPERELLIPSE_RE = /^superellipse\(\s*(-?\d+(?:\.\d+)?)\s*\)$/;
  const CORNER_K_MIN = -5;
  const CORNER_K_MAX = 5;
  const CORNER_K_DEFAULT = 2; // squircle 相当

  // superellipse(k) なら k を返す。キーワード（round 等）や不正値なら null。
  function superellipseParam(value) {
    const m = SUPERELLIPSE_RE.exec(String(value ?? "").trim());
    return m ? Number(m[1]) : null;
  }

  // 曲率 k を値域内の小数1桁に丸める。数値化できなければ既定値。
  function clampCornerK(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return CORNER_K_DEFAULT;
    return Math.round(Math.min(CORNER_K_MAX, Math.max(CORNER_K_MIN, n)) * 10) / 10;
  }

  // 曲率 k から corner-shape の値を組み立てる（この文字列を作るのはここだけにする）
  function superellipse(k) {
    return `superellipse(${clampCornerK(k)})`;
  }

  // 角の形式を検証する。キーワードか superellipse(<number>) だけを通し、
  // それ以外は fallback（未指定なら round）に落とす。
  function sanitizeCornerShape(value, fallback) {
    const base = CORNER_SHAPES.includes(fallback) || superellipseParam(fallback) != null ? fallback : "round";
    if (typeof value !== "string") return base;
    const v = value.trim();
    if (CORNER_SHAPES.includes(v)) return v;
    const k = superellipseParam(v);
    return k == null ? base : superellipse(k);
  }

  const api = {
    CORNER_SHAPES,
    CORNER_K_DEFAULT,
    superellipse,
    superellipseParam,
    clampCornerK,
    sanitizeCornerShape,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.MMShared = root.MMShared || {}), Object.assign(root.MMShared, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
