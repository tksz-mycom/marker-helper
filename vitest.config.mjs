import { defineConfig } from "vitest/config";

// 層1（純粋ロジック単体）は DOM 不要なので environment は node。
// 層2（jsdom + chrome モック）を追加する際は per-file の // @vitest-environment jsdom か
// 別 config で environment を切り替える。
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
