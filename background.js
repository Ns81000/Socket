/* =====================================================================
   Socket — background.js  (Manifest V3 service worker)

   Socket is entirely keyboard/mouse driven via the content script, so
   the service worker is intentionally minimal. It exists to satisfy the
   MV3 background entry and to log lifecycle events. No popup, no action.

   Others load. Socket unloads.
   ===================================================================== */

// Fired once when the extension is installed or updated.
chrome.runtime.onInstalled.addListener((details) => {
  // Keep this lightweight; the content script does all the real work.
  console.log(
    "[Socket] installed:",
    details.reason,
    "— press T on any http(s) page to ignite the torch, then S for shooter mode."
  );
});

// The content script is declared in manifest.json and auto-injected at
// document_idle on http/https pages. Nothing further is required here,
// but we keep a no-op message channel for future extensibility.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "socket:ping") {
    sendResponse({ ok: true, ts: Date.now() });
  }
  if (message && message.type === "socket:open_game") {
    chrome.tabs.create({ url: chrome.runtime.getURL("game.html") });
    sendResponse({ ok: true });
  }
  return false;
});
