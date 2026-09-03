// 層1: manifest の __MSG_*__ 参照と _locales の整合を検証する。
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const manifest = readJson("manifest.json");
const locales = { ja: readJson("_locales/ja/messages.json"), en: readJson("_locales/en/messages.json") };

test("default_locale が ja になっている", () => {
  expect(manifest.default_locale).toBe("ja");
});

test("manifest が参照する __MSG_*__ が両ロケールに存在する", () => {
  const refs = [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]);
  expect(refs.length).toBeGreaterThan(0);
  for (const lang of ["ja", "en"]) {
    for (const key of refs) {
      expect(locales[lang][key], `${lang}.${key}`).toBeDefined();
      expect(typeof locales[lang][key].message).toBe("string");
      expect(locales[lang][key].message.length).toBeGreaterThan(0);
    }
  }
});

test("ja と en のキー集合が一致する", () => {
  expect(Object.keys(locales.ja).sort()).toEqual(Object.keys(locales.en).sort());
});

test("説明とショートカット説明が __MSG_*__ になっている", () => {
  expect(manifest.description).toMatch(/^__MSG_[A-Za-z0-9_]+__$/);
  for (const cmd of Object.values(manifest.commands)) {
    expect(cmd.description).toMatch(/^__MSG_[A-Za-z0-9_]+__$/);
  }
});

test("拡張名は固有名なので置き換えない", () => {
  expect(manifest.name).toBe("Marker:HELPER");
});
