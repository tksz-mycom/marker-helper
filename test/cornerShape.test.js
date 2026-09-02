// 層1: 角の形式（CSS corner-shape）の値の検証・整形
const {
  sanitizeCornerShape,
  superellipse,
  superellipseParam,
  clampCornerK,
} = require("../shared/cornerShape.js");

describe("sanitizeCornerShape（角の形式の検証）", () => {
  test("プリセットのキーワードはそのまま通す", () => {
    for (const v of ["round", "squircle", "bevel", "scoop", "notch", "square"]) {
      expect(sanitizeCornerShape(v, "round")).toBe(v);
    }
  });

  test("superellipse(<number>) は小数1桁に丸めて通す", () => {
    expect(sanitizeCornerShape("superellipse(4)", "round")).toBe("superellipse(4)");
    expect(sanitizeCornerShape("superellipse(-1.5)", "round")).toBe("superellipse(-1.5)");
    expect(sanitizeCornerShape("superellipse( 2.34 )", "round")).toBe("superellipse(2.3)");
  });

  test("値域外の曲率は -5〜5 に丸める", () => {
    expect(sanitizeCornerShape("superellipse(99)", "round")).toBe("superellipse(5)");
    expect(sanitizeCornerShape("superellipse(-99)", "round")).toBe("superellipse(-5)");
  });

  test("不正値・非文字列は fallback に落ちる", () => {
    expect(sanitizeCornerShape("circle", "squircle")).toBe("squircle");
    // straight は corner-shape に無いキーワード（実装が黙って無視するため通してはいけない）
    expect(sanitizeCornerShape("straight", "round")).toBe("round");
    expect(sanitizeCornerShape("superellipse(abc)", "round")).toBe("round");
    expect(sanitizeCornerShape("url(javascript:alert(1))", "round")).toBe("round");
    expect(sanitizeCornerShape(undefined, "bevel")).toBe("bevel");
  });

  test("fallback 自体が不正なら round に落ちる（旧データ・未設定対策）", () => {
    expect(sanitizeCornerShape("circle", undefined)).toBe("round");
    expect(sanitizeCornerShape(null, "でたらめ")).toBe("round");
  });
});

describe("superellipse / superellipseParam / clampCornerK", () => {
  test("組み立ては曲率を値域内の小数1桁に丸めてから行う", () => {
    expect(superellipse(2.36)).toBe("superellipse(2.4)");
    expect(superellipse(99)).toBe("superellipse(5)");
    expect(superellipse("あ")).toBe("superellipse(2)");
  });

  test("superellipse(k) からは k を、キーワードからは null を返す", () => {
    expect(superellipseParam("superellipse(3.5)")).toBe(3.5);
    expect(superellipseParam("round")).toBe(null);
    expect(superellipseParam(undefined)).toBe(null);
  });

  test("曲率は値域内の小数1桁に丸め、数値化できなければ既定値", () => {
    expect(clampCornerK("2.36")).toBe(2.4);
    expect(clampCornerK(10)).toBe(5);
    expect(clampCornerK("あ")).toBe(2);
  });
});
