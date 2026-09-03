// 層1: i18n の機構（純粋関数と DOM 適用）の単体テスト。
// 辞書の中身に依存しないよう、translate / applyI18n はテスト用の辞書を渡して検証する。
const i18n = require("../shared/i18n.js");

const DICT = {
  ja: {
    "t.plain": "こんにちは",
    "t.vars": "{n}件の{what}",
    "t.count.one": "{n}件",
    "t.count.other": "{n}件",
  },
  en: {
    "t.plain": "Hello",
    "t.vars": "{n} {what}",
    "t.count.one": "{n} marker",
    "t.count.other": "{n} markers",
  },
};

describe("normalizeLang", () => {
  test("ja / en はそのまま返す", () => {
    expect(i18n.normalizeLang("ja")).toBe("ja");
    expect(i18n.normalizeLang("en")).toBe("en");
  });

  test("未対応の値は null を返す", () => {
    for (const v of ["fr", "", null, undefined, "JA", 1]) {
      expect(i18n.normalizeLang(v)).toBeNull();
    }
  });
});

describe("detectLang", () => {
  test("ja 始まりは ja", () => {
    expect(i18n.detectLang("ja")).toBe("ja");
    expect(i18n.detectLang("ja-JP")).toBe("ja");
  });

  test("それ以外は en", () => {
    expect(i18n.detectLang("en-US")).toBe("en");
    expect(i18n.detectLang("fr")).toBe("en");
    expect(i18n.detectLang(undefined)).toBe("en");
  });
});

describe("translate", () => {
  test("言語ごとの文言を返す", () => {
    expect(i18n.translate(DICT, "ja", "t.plain")).toBe("こんにちは");
    expect(i18n.translate(DICT, "en", "t.plain")).toBe("Hello");
  });

  test("{name} を vars で置換する", () => {
    expect(i18n.translate(DICT, "en", "t.vars", { n: 3, what: "marks" })).toBe("3 marks");
  });

  test("vars.n があり .one が定義されたキーは単複を選ぶ", () => {
    expect(i18n.translate(DICT, "en", "t.count", { n: 1 })).toBe("1 marker");
    expect(i18n.translate(DICT, "en", "t.count", { n: 2 })).toBe("2 markers");
    expect(i18n.translate(DICT, "en", "t.count", { n: 0 })).toBe("0 markers");
  });

  test("未定義のキーはキー文字列を返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(i18n.translate(DICT, "en", "t.missing")).toBe("t.missing");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("setLang / getLang / t", () => {
  test("設定した言語で MESSAGES を引く", () => {
    i18n.setLang("en");
    expect(i18n.getLang()).toBe("en");
    i18n.setLang("ja");
    expect(i18n.getLang()).toBe("ja");
  });

  test("不正な言語を設定したら ja に落とす", () => {
    i18n.setLang("fr");
    expect(i18n.getLang()).toBe("ja");
  });
});

describe("辞書", () => {
  test("ja と en のキー集合が完全に一致する", () => {
    const ja = Object.keys(i18n.MESSAGES.ja).sort();
    const en = Object.keys(i18n.MESSAGES.en).sort();
    // 差分をそのまま出して、どのキーが欠けているか分かるようにする
    expect(ja.filter((k) => !i18n.MESSAGES.en[k] && i18n.MESSAGES.en[k] !== "")).toEqual([]);
    expect(en.filter((k) => !i18n.MESSAGES.ja[k] && i18n.MESSAGES.ja[k] !== "")).toEqual([]);
    expect(ja).toEqual(en);
  });

  test("文言が空文字でない", () => {
    for (const lang of ["ja", "en"]) {
      for (const [key, value] of Object.entries(i18n.MESSAGES[lang])) {
        expect(typeof value, `${lang}.${key}`).toBe("string");
        expect(value.length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
