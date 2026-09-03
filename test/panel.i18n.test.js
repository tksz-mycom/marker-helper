// @vitest-environment jsdom
//
// 層2: 実際の panel.html を読み込み、言語切替トグルの存在と i18n 適用を検証する。
const fs = require("fs");
const path = require("path");
const i18n = require("../shared/i18n.js");

beforeAll(() => {
  const html = fs.readFileSync(path.join(__dirname, "../panel/panel.html"), "utf8");
  const inner = html.replace(/<!doctype[^>]*>/i, "").replace(/<\/?html[^>]*>/gi, "");
  document.documentElement.innerHTML = inner;
});

test("body にちらつき防止クラスが付いている", () => {
  // documentElement.innerHTML 経由では body の属性が保たれない場合があるためソースで見る
  const html = fs.readFileSync(path.join(__dirname, "../panel/panel.html"), "utf8");
  expect(html).toMatch(/<body[^>]*class="[^"]*mm-i18n-pending/);
});

test("JA / EN の切替トグルがある", () => {
  const box = document.getElementById("mm-lang");
  expect(box).not.toBeNull();
  const values = [...box.querySelectorAll("button")].map((b) => b.dataset.value);
  expect(values).toEqual(["ja", "en"]);
});

test("shared/i18n.js を panel.js より前に読み込んでいる", () => {
  const html = fs.readFileSync(path.join(__dirname, "../panel/panel.html"), "utf8");
  expect(html.indexOf("shared/i18n.js")).toBeGreaterThan(-1);
  expect(html.indexOf("shared/i18n.js")).toBeLessThan(html.indexOf("panel.js"));
});

test("applyDocumentLang で lang 属性が切り替わる", () => {
  i18n.setLang("en");
  i18n.applyDocumentLang(document);
  expect(document.documentElement.lang).toBe("en");
  i18n.setLang("ja");
});

describe("ヘッダーと空状態の英語表示", () => {
  beforeAll(() => {
    i18n.setLang("en");
    i18n.applyI18n(document);
  });

  afterAll(() => {
    i18n.setLang("ja");
    i18n.applyI18n(document);
  });

  test("見出しとマーキングモードが英語になる", () => {
    expect(document.querySelector(".mm-bar-title h1").textContent).toBe("Markers");
    expect(document.querySelector(".mm-toggle-text strong").textContent).toBe("Marking mode");
  });

  test("絞り込みの placeholder が英語になる", () => {
    expect(document.getElementById("mm-filter").getAttribute("placeholder")).toBe(
      "Filter (tag, selector, text, note)",
    );
  });

  test("エクスポート形式の JSON だけ補足付きで英語になる", () => {
    const opts = [...document.querySelectorAll("#mm-export-format option")].map((o) => o.textContent);
    expect(opts).toEqual(["JSON (restorable)", "CSV", "Markdown", "Playwright", "Cypress"]);
  });

  test("空状態の案内が英語になり、強調の <strong> が残る", () => {
    const p = document.getElementById("mm-empty");
    expect(p.querySelector("strong").textContent).toBe("Marking mode");
    expect(p.textContent).toContain("No markers yet.");
    expect(p.textContent).toContain("then click an element on the page.");
  });

  test("絞り込み無一致の案内が英語になる", () => {
    expect(document.getElementById("mm-nomatch").textContent).toBe("No markers match the filter.");
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

test("panel.html に data-i18n の無い日本語テキスト・属性が残っていない", () => {
  expect(untranslated(document)).toEqual([]);
});

test("行テンプレートの中にも日本語テキスト・属性が残っていない", () => {
  expect(untranslated(document.getElementById("mm-item-tpl").content)).toEqual([]);
});

describe("動的文言", () => {
  test("件数付きトーストが英語で単複を切り替える", () => {
    i18n.setLang("en");
    expect(i18n.t("panel.toast.copiedSelectors", { n: 1 })).toBe("Copied 1 selector");
    expect(i18n.t("panel.toast.copiedSelectors", { n: 3 })).toBe("Copied 3 selectors");
    i18n.setLang("ja");
    expect(i18n.t("panel.toast.copiedSelectors", { n: 3 })).toBe("3件のセレクタをコピーしました");
  });

  test("コントラストの表示に等級を差し込める", () => {
    i18n.setLang("en");
    expect(i18n.t("panel.inspect.contrastValue", { value: "4.51", grade: "AA" })).toBe("4.51 : 1 (AA)");
    i18n.setLang("ja");
  });
});
