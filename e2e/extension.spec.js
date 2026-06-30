// Layer 3: 実 Chromium に拡張機能を unpacked ロードし、content script の実挙動
// （マーキング有効化→要素クリック→オーバーレイにマーク生成）をエンドツーエンドで検証する。
//
// 実行前に: npm install && npx playwright install chromium
//   npm run e2e
//
// 注意: 拡張のロードには persistent context が必要。新ヘッドレスでも MV3 拡張は動くが、
// 環境によっては headless:false + xvfb-run が必要になる場合がある。
const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const http = require("http");

const EXT_DIR = path.resolve(__dirname, "..");

// content_scripts は <all_urls> 対象だが data:/about: には注入されないため、
// ローカル http サーバの実ページへアクセスする。
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <button id="target" style="position:absolute;left:60px;top:60px;width:140px;height:44px">Target</button>
</body></html>`;

let server;
let baseURL;
let context;

// service worker は起動タイミングがまちまちなので、出現するまで短く待つ。
async function getServiceWorker(ctx) {
  for (let i = 0; i < 50; i++) {
    const [sw] = ctx.serviceWorkers();
    if (sw) return sw;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE_HTML);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  baseURL = `http://localhost:${server.address().port}/`;

  // 既定はヘッドフル（拡張SWが安定）。CI等では PW_HEADLESS=1 + xvfb-run で実行する。
  context = await chromium.launchPersistentContext("", {
    headless: process.env.PW_HEADLESS === "1",
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
});

test("マーキング有効化→要素クリックでオーバーレイにマークが作られる", async () => {
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: "load" });

  // background(service worker) を取得し、対象タブへマーキングONを送る
  const sw = await getServiceWorker(context);
  expect(sw, "service worker が見つかりません").toBeTruthy();
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "MM_SET_ENABLED", enabled: true });
  });

  // 対象要素をクリック → content script が capture フェーズでマーク生成
  await page.click("#target");

  // オーバーレイにマーク枠が1つ作られることを確認
  await expect(page.locator("#mm-overlay-root .mm-mark-box")).toHaveCount(1);
});
