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

// キーボードショートカットでマーキングモードを切り替える。
// content が enabled の唯一の保持者なので、background は「反転して」とだけ伝える。
chrome.commands?.onCommand.addListener((command) => {
  if (command !== "toggle-marking") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "MM_TOGGLE_ENABLED" }, () => {
      // 非対応ページ（chrome:// 等）では content が居らずエラーになるため握り潰す
      void chrome.runtime.lastError;
    });
  });
});
