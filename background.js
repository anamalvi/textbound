chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SNAKE_CABINET" }).catch(() => {
    // Content script may not be injected yet (e.g. chrome:// pages) — ignore.
  });
});
