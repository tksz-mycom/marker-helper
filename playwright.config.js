// Layer 3（E2E）。拡張機能を実 Chromium にロードして検証する。
// 拡張のロードには persistent context が必須なので、各 spec が自前で context を作る。
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  expect: { timeout: 7000 },
});
