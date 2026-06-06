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
