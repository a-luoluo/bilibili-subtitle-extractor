# B站字幕提取器 · Bilibili Subtitle Extractor

提取哔哩哔哩视频已经提供的 CC／AI 字幕，在浏览器侧栏阅读，点击时间戳跳转，并导出 SRT、TXT 或 JSON。适用于学习笔记、视频内容回顾和字幕归档。

这是浏览器扩展，**Mac 与 Windows 共用同一个安装包**。它提取视频字幕，不提取弹幕，也不会为没有字幕的视频自行进行语音识别。

## 浏览器支持

| 浏览器 | 支持情况 |
| --- | --- |
| macOS / Windows 上的 Chrome | 116 或更新版本，建议使用当前稳定版 |
| macOS / Windows 上的 Microsoft Edge | 使用当前稳定版，需要支持 `chrome.sidePanel.open` |
| Safari、Firefox | 当前版本不支持 |

侧栏入口使用 [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)，Edge 提供[对应的侧栏 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar)。本项目没有独立 Mac App，也不需要安装 Rosetta。

## 安装

### 安装已打包的 ZIP

1. 解压 `bilibili-subtitle-extractor-6.6.0.zip`，保留解压后的整个文件夹。不要直接选择 ZIP 文件。
2. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。
3. 开启「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择**直接包含 `manifest.json` 的文件夹**。
5. 在浏览器扩展菜单中固定「B站字幕提取器」，然后刷新已经打开的 B 站视频页面。

Mac 的详细安装与更新步骤见 [INSTALL-MAC.md](INSTALL-MAC.md)。加载后请勿删除或移动扩展文件夹，否则浏览器将找不到文件。

### 从源码安装

```sh
git clone https://github.com/a-luoluo/bilibili-subtitle-extractor.git
```

按上述步骤加载仓库根目录即可。扩展运行不需要 Node.js，也不需要安装依赖。

## 使用

1. 在 B 站打开含 BV 号的视频页面并等待播放器加载。
2. 点击浏览器工具栏中的扩展图标，打开侧栏。
3. 检测到字幕后选择语言。若未出现，先在播放器中打开字幕，再点击「重新检测」。
4. 点击「开始阅读」查看全文，点击字幕时间戳跳转当前视频。
5. 选择 SRT、TXT 或 JSON，然后点击「下载」。文件保存位置由浏览器下载设置决定。
6. 在 B 站播放器中切换视频或分 P 后，扩展会重新检测。

**部分字幕需要登录 B 站。** 扩展沿用当前浏览器中的 B 站登录状态，不要求提供密码。没有登录时能够提取的字幕取决于 B 站接口与视频权限，不能保证所有视频免登录可用。

## 常见问题

**没有检测到字幕怎么办？**

确认视频在播放器里有可选字幕；必要时登录 B 站，打开播放器字幕并刷新页面，再重新检测。没有提供字幕、接口失败、网络异常和登录要求是不同情况，可根据侧栏提示处理。扩展无法提取烧录在画面中的文字。

**切换分 P 后内容不对怎么办？**

先等待新分 P 的播放器加载完成，再点击「重新检测」。如果仍然出现问题，请在 Issue 中提供视频 BV 号、分 P、浏览器版本和侧栏错误提示，不要上传 Cookie 或登录凭据。

**为什么 Safari 无法安装？**

此版本依赖 Chromium 扩展的侧栏和脚本 API；Safari 需要单独适配，不能直接加载本安装包。

**会上传字幕或收集账号信息吗？**

扩展会请求 B 站的视频／字幕接口及字幕 CDN，登录相关请求可能带上浏览器已有的 B 站登录状态。字幕在本地侧栏显示或下载到本地；代码没有独立的上传服务、分析统计或账号密码采集功能。

## 开发与打包

开发工具需要 Node.js 20 或更新版本；无 npm 依赖，不需要执行 `npm install`。

```sh
npm run check
npm test
npm run package
```

- `check`：检查运行脚本语法、版本号、manifest 引用和 ZIP 文件目录／内容。
- `test`：运行 Node.js 行为回归测试；测试不依赖真实 B 站账号。
- `package`：生成 `dist/bilibili-subtitle-extractor-6.6.0.zip`。

打包只包含扩展运行文件、图标与使用文档。文件顺序、时间戳和权限固定，同一份源码产生相同的 ZIP；测试、Git 数据及未使用的旧浮窗代码不进入安装包。

GitHub Actions 会运行检查和测试并提供 ZIP 构建产物，不会自动创建 Release。自动化测试不能替代真实视频验证；发布前应在 Mac Chrome／Edge 中检查有字幕视频、无字幕视频、登录要求、分 P 切换、语言切换、阅读跳转及三种格式下载。

## 项目结构

```text
manifest.json           扩展配置
background.js           侧栏入口
capture-main.js         播放器页面中的字幕捕获
capture.js              隔离环境中的字幕缓存与通信
sidepanel.html          侧栏界面
sidepanel.js            检测、阅读、跳转与导出
icons/                  扩展图标
scripts/package.mjs     检查与可复现打包
tests/                  行为回归测试
```

更新内容见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

原项目 README 标注：MIT © a-luoluo。仓库目前未附独立 LICENSE 文件。
