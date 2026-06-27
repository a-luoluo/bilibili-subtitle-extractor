// 悬浮按钮 → 打开侧边栏
(function() {
  if (document.getElementById('bili-sub-ext-float')) return;

  const css = document.createElement('style');
  css.textContent = `
    #bili-sub-ext-float {
      position: fixed; bottom: 160px; right: 16px; z-index: 9999;
      width: 40px; height: 40px; border-radius: 50%;
      background: #fb7299; color: #fff; border: none; cursor: pointer;
      font-size: 18px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 12px rgba(251,114,153,0.35); transition: all 0.2s;
    }
    #bili-sub-ext-float:hover { transform: scale(1.12); }
  `;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.id = 'bili-sub-ext-float'; btn.title = '提取字幕'; btn.textContent = '📝';
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openSidePanel' });
  });
  document.body.appendChild(btn);
})();
