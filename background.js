chrome.action.onClicked.addListener(tab => {
  // Call open directly inside the click gesture; do not await other APIs first.
  const feedback = (text, title) => {
    try {
      Promise.resolve(chrome.action.setBadgeText({ tabId: tab.id, text })).catch(() => {});
      Promise.resolve(chrome.action.setTitle({ tabId: tab.id, title })).catch(() => {});
    } catch (_) { /* The tab may have closed before feedback is shown. */ }
  };
  try {
    chrome.sidePanel.open({ windowId: tab.windowId }).then(
      () => feedback('', 'B站字幕提取器'),
      () => feedback('!', '侧边栏打开失败，请更新 Chrome / Edge 后重试')
    );
  } catch (_) {
    feedback('!', '需要支持侧边栏的 Chrome / Edge 116 或更新版本');
  }
});
