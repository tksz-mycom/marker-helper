// 層1: 連番ラベルの実効表示ロジック（#1 の3状態 / #3 の旧データ継承の回帰防止）
const { effectiveShowLabel } = require("../shared/label.js");

describe("effectiveShowLabel（連番ラベルの3状態）", () => {
  test("明示 true は常に表示", () => {
    expect(effectiveShowLabel(true, false)).toBe(true);
    expect(effectiveShowLabel(true, true)).toBe(true);
  });

  test("明示 false はグローバルONでも非表示を保つ（#1 の回帰防止）", () => {
    expect(effectiveShowLabel(false, true)).toBe(false);
    expect(effectiveShowLabel(false, false)).toBe(false);
  });

  test("継承 null はグローバル既定に従う", () => {
    expect(effectiveShowLabel(null, true)).toBe(true);
    expect(effectiveShowLabel(null, false)).toBe(false);
  });

  test("旧データ undefined も継承扱い（#3 の回帰防止）", () => {
    expect(effectiveShowLabel(undefined, true)).toBe(true);
    expect(effectiveShowLabel(undefined, false)).toBe(false);
  });
});
