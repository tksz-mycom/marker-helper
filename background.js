// Marker:HELPER — service worker
// 役割: サイドパネルの開閉挙動を設定する。アクションクリックはポップアップを開くため、
// 自動でのサイドパネル展開は無効化し、ポップアップ内のボタンから明示的に開く。

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch((err) => console.debug("[Marker:HELPER] setPanelBehavior:", err));
  }
});

// content script からマーク自動保存に chrome.storage.session を使えるようにする。
// 既定では session 領域は信頼コンテキスト限定のため、明示的にアクセスレベルを広げる。
function allowSessionStorageForContent() {
  try {
    chrome.storage.session
      ?.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
      .catch((err) => console.debug("[Marker:HELPER] setAccessLevel:", err));
  } catch (err) {
    console.debug("[Marker:HELPER] setAccessLevel:", err);
  }
}

chrome.runtime.onInstalled.addListener(allowSessionStorageForContent);
chrome.runtime.onStartup.addListener(allowSessionStorageForContent);
// サービスワーカー起動時にも一度設定しておく（onStartup が来ない再起動に備える）
allowSessionStorageForContent();

// ツールバーアイコンにマーク件数のバッジを表示する。
// バッジはタブ単位で設定するため、通知元タブ（sender.tab.id）にだけ反映する。
// テーマカラー（赤）を一度だけ設定しておく。
function setupBadgeStyle() {
  try {
    chrome.action?.setBadgeBackgroundColor?.({ color: "#ff3b30" });
    chrome.action?.setBadgeTextColor?.({ color: "#ffffff" });
  } catch (err) {
    console.debug("[Marker:HELPER] setupBadgeStyle:", err);
  }
}
chrome.runtime.onInstalled.addListener(setupBadgeStyle);
chrome.runtime.onStartup.addListener(setupBadgeStyle);
setupBadgeStyle();

function updateBadge(tabId, count) {
  if (tabId == null) return;
  const text = count > 0 ? String(count) : "";
  chrome.action?.setBadgeText?.({ tabId, text }, () => void chrome.runtime.lastError);
}

// content からのマーク更新通知を受け、件数をアイコンバッジへ反映する。
// panel/popup も同じ通知を受け取るが、それぞれ自前の判定で取捨選択するため影響しない。
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "MM_MARKS_UPDATED" && sender.tab?.id != null) {
    updateBadge(sender.tab.id, Array.isArray(msg.marks) ? msg.marks.length : 0);
  }
});

// キーボードショートカットを content へ転送する。
// マーキングモードの切替（content が enabled の唯一の保持者）と、
// 次/前のマーカーへのスクロール移動をアクティブタブの content に伝える。
const COMMAND_MESSAGE = {
  "toggle-marking": { type: "MM_TOGGLE_ENABLED" },
  "jump-next-mark": { type: "MM_JUMP", dir: 1 },
  "jump-prev-mark": { type: "MM_JUMP", dir: -1 },
};

chrome.commands?.onCommand.addListener((command) => {
  const message = COMMAND_MESSAGE[command];
  if (!message) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, message, () => {
      // 非対応ページ（chrome:// 等）では content が居らずエラーになるため握り潰す
      void chrome.runtime.lastError;
    });
  });
});
