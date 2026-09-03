// data-i18n の付け忘れ検出。popup / panel の両テストで共有する。
// 行ではなく DOM で見る。要素と文言が別の行に分かれていても正しく判定できる。
const JA_TEXT = /[぀-ヿ㐀-鿿]/;
const I18N_ATTRS = [
  ["title", "data-i18n-title"],
  ["aria-label", "data-i18n-aria-label"],
  ["placeholder", "data-i18n-placeholder"],
];

// scope 配下から「日本語を含むのに data-i18n* が無い」テキスト・属性を集める。
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

module.exports = { JA_TEXT, I18N_ATTRS, untranslated };
