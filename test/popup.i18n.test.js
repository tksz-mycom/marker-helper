// @vitest-environment jsdom
//
// 層2: 実際の popup.html を読み込み、言語切替トグルの存在と i18n 適用を検証する。
const fs = require("fs");
const path = require("path");
const i18n = require("../shared/i18n.js");

beforeAll(() => {
  const html = fs.readFileSync(path.join(__dirname, "../popup/popup.html"), "utf8");
  const inner = html.replace(/<!doctype[^>]*>/i, "").replace(/<\/?html[^>]*>/gi, "");
  document.documentElement.innerHTML = inner;
});

test("body にちらつき防止クラスが付いている", () => {
  // documentElement.innerHTML 経由では body の属性が保たれない場合があるためソースで見る
  const html = fs.readFileSync(path.join(__dirname, "../popup/popup.html"), "utf8");
  expect(html).toMatch(/<body[^>]*class="[^"]*mm-i18n-pending/);
});

test("JA / EN の切替トグルがある", () => {
  const box = document.getElementById("mm-lang");
  expect(box).not.toBeNull();
  const values = [...box.querySelectorAll("button")].map((b) => b.dataset.value);
  expect(values).toEqual(["ja", "en"]);
});

test("shared/i18n.js を popup.js より前に読み込んでいる", () => {
  const html = fs.readFileSync(path.join(__dirname, "../popup/popup.html"), "utf8");
  expect(html.indexOf("shared/i18n.js")).toBeGreaterThan(-1);
  expect(html.indexOf("shared/i18n.js")).toBeLessThan(html.indexOf("popup.js"));
});

test("applyDocumentLang で lang 属性が切り替わる", () => {
  i18n.setLang("en");
  i18n.applyDocumentLang(document);
  expect(document.documentElement.lang).toBe("en");
  i18n.setLang("ja");
  i18n.applyDocumentLang(document);
  expect(document.documentElement.lang).toBe("ja");
});

describe("英語表示", () => {
  beforeAll(() => {
    i18n.setLang("en");
    i18n.applyI18n(document);
  });

  afterAll(() => {
    i18n.setLang("ja");
    i18n.applyI18n(document);
  });

  test("見出しが英語になる", () => {
    const headings = [...document.querySelectorAll("main h2")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Marker color",
      "Display",
      "Transparency",
      "Line style",
      "Line width",
      "Padding",
      "Corner radius",
      "Corner shape",
    ]);
  });

  test("マーキングモードのラベルが英語になる", () => {
    expect(document.querySelector(".mm-toggle-text strong").textContent).toBe("Marking mode");
  });

  test("線種のボタンが英語になる", () => {
    const labels = [...document.querySelectorAll("#mm-line button")].map((b) => b.textContent);
    expect(labels).toEqual(["Solid", "Dashed", "Dotted"]);
  });

  test("角の形式のボタンが英語になる", () => {
    const labels = [...document.querySelectorAll("#mm-corner button")].map((b) => b.textContent);
    expect(labels).toEqual(["Round", "Smooth", "Bevel", "Scoop", "Notch", "Square", "Custom"]);
  });

  test("非対応ページの注意書きが英語になり、<br> が残る", () => {
    const p = document.getElementById("mm-unsupported");
    expect(p.querySelector("br")).not.toBeNull();
    expect(p.textContent).toContain("Not available on this page.");
  });

  test("アイコンボタンの title / aria-label が英語になる", () => {
    const btn = document.getElementById("mm-open-panel");
    expect(btn.getAttribute("title")).toBe("Open the list panel");
    expect(btn.getAttribute("aria-label")).toBe("Open the list panel");
  });
});

// 行ではなく DOM で見る。要素と文言が別の行に分かれていても正しく判定できる。
const JA_TEXT = /[぀-ヿ㐀-鿿]/;
const I18N_ATTRS = [
  ["title", "data-i18n-title"],
  ["aria-label", "data-i18n-aria-label"],
  ["placeholder", "data-i18n-placeholder"],
];

function untranslated(scope) {
  const bad = [];
  for (const el of scope.querySelectorAll("*")) {
    // 自分が直接持つテキストノードだけを見る（子要素のテキストはその子で判定する）
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join("");
    if (JA_TEXT.test(own) && !el.hasAttribute("data-i18n")) {
      bad.push(`text: ${el.outerHTML.slice(0, 100)}`);
    }
    for (const [attr, marker] of I18N_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && JA_TEXT.test(value) && !el.hasAttribute(marker)) {
        bad.push(`${attr}: ${el.outerHTML.slice(0, 100)}`);
      }
    }
  }
  return bad;
}

test("popup.html に data-i18n の無い日本語テキスト・属性が残っていない", () => {
  expect(untranslated(document)).toEqual([]);
});

describe("マイカラーの動的文言", () => {
  test("英語で色コードを差し込める", () => {
    i18n.setLang("en");
    expect(i18n.t("popup.myColor.remove", { color: "#ff3b30" })).toBe("Remove #ff3b30");
    expect(i18n.t("popup.myColor.slotAria", { color: "#ff3b30" })).toBe(
      "My color #ff3b30 (double-click to change)",
    );
    i18n.setLang("ja");
    expect(i18n.t("popup.myColor.remove", { color: "#ff3b30" })).toBe("#ff3b30 を削除");
  });
});
