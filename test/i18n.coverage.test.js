// 層1: i18n の取りこぼし検出。
// popup / panel の JS に日本語の文字列リテラルが残っていないことを検査する。
// コメントは対象外。どうしても翻訳しない行（開発者向けログなど）は行末に // i18n-ignore を付ける。
const fs = require("fs");
const path = require("path");

const FILES = ["popup/popup.js", "panel/panel.js"];
// ひらがな・カタカナ・漢字（CJK統合漢字と拡張A）
const JA = /[぀-ヿ㐀-䶿一-鿿]/;

// ソースからコメントを取り除いた「コード部分だけ」の行配列を返す。
// 行コメントとブロックコメントは「先に現れた方」を優先する。panel.js には
// `// //*[@id=...] 起点は強い。` のように行コメントの中に /* を含む行があり、
// 単純に /* を先に探すとブロックコメントが開いたと誤認して以降を丸ごと読み飛ばしてしまう。
// 文字列リテラル中の // までは解釈しない（その行の残りを見落とす方向の近似）。
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split(/\r?\n/)) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      s = s.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const li = s.indexOf("//");
      const bi = s.indexOf("/*");
      if (li !== -1 && (bi === -1 || li < bi)) {
        s = s.slice(0, li);
        break;
      }
      if (bi === -1) break;
      const end = s.indexOf("*/", bi + 2);
      if (end === -1) {
        s = s.slice(0, bi);
        inBlock = true;
        break;
      }
      s = s.slice(0, bi) + s.slice(end + 2);
    }
    out.push(s);
  }
  return out;
}

for (const rel of FILES) {
  test(`${rel} に日本語の文字列リテラルが残っていない`, () => {
    const source = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const raw = source.split(/\r?\n/);
    const code = stripComments(source);
    const leftovers = [];
    code.forEach((line, i) => {
      // 意図的に翻訳しない行（開発者向けログなど）は除外する
      if (/i18n-ignore/.test(raw[i])) return;
      if (JA.test(line)) leftovers.push(`${rel}:${i + 1}: ${raw[i].trim()}`);
    });
    expect(leftovers).toEqual([]);
  });
}

test("stripComments が行コメントとブロックコメントを取り除く", () => {
  const src = ["const a = 1; // 日本語のコメント", "/* 日本語の", "   ブロックコメント */", "const b = 2;"].join("\n");
  const code = stripComments(src);
  expect(code.some((l) => JA.test(l))).toBe(false);
  expect(code).toHaveLength(4);
});

test("stripComments はコードの日本語リテラルを残す", () => {
  const code = stripComments(`const a = "日本語";`);
  expect(JA.test(code[0])).toBe(true);
});

test("行コメントの中の /* をブロックコメント開始と誤認しない", () => {
  // panel.js の XPath 判定にこの形の行が実在する。誤認すると以降を丸ごと読み飛ばし、
  // 取りこぼしを検出できないまま緑になってしまう。
  const src = ["// //*[@id=...] 起点は強い。", `const a = "日本語";`].join("\n");
  const code = stripComments(src);
  expect(JA.test(code[0])).toBe(false);
  expect(JA.test(code[1])).toBe(true);
});

test("複数行にわたるブロックコメントは読み飛ばし、終了後は検出を再開する", () => {
  const src = ["/* 日本語の", "   ブロックコメント", "*/ const a = \"日本語\";"].join("\n");
  const code = stripComments(src);
  expect(JA.test(code[0])).toBe(false);
  expect(JA.test(code[1])).toBe(false);
  expect(JA.test(code[2])).toBe(true);
});

// CSSの疑似要素 content: は textContent/setAttribute を見る applyI18n が原理的に届かない。
// JS/DOMの検査網からも漏れる盲点なので、CSS自体を専用に検査する。
for (const rel of ["panel/panel.css", "popup/popup.css"]) {
  test(`${rel} の content: に日本語の文字列が残っていない`, () => {
    const css = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const hits = [...css.matchAll(/content:\s*(["'])(.*?)\1/g)].map((m) => m[2]).filter((v) => JA.test(v));
    expect(hits).toEqual([]);
  });
}
