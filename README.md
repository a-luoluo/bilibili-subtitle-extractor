# B站字幕提取器 · Bilibili Subtitle Extractor

提取哔哩哔哩视频已经提供的 CC／AI 字幕，在浏览器侧栏或弹出窗口中阅读，点击时间戳跳转，并导出 SRT、TXT 或 JSON。适用于学习笔记、视频内容回顾和字幕归档。

这是浏览器扩展。**Chrome／Edge 在 Mac 与 Windows 上共用安装包；Safari 使用独立源码包。**它提取视频字幕，不提取弹幕，也不会为没有字幕的视频自行进行语音识别。

## 浏览器支持

| 浏览器 | 支持情况 |
| --- | --- |
| macOS / Windows 上的 Chrome | 116 或更新版本，建议使用当前稳定版 |
| macOS / Windows 上的 Microsoft Edge | 使用当前稳定版，需要支持 `chrome.sidePanel.open` |
| macOS Safari | 18.4+ 适配源码包；真实 Safari 功能待验证，详见 [Safari 安装说明](INSTALL-SAFARI.md) |
| Firefox | 当前版本不支持 |

侧栏入口使用 [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)，Edge 提供[对应的侧栏 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar)。Chrome／Edge 直接加载扩展文件，不需要 Rosetta；Safari 正式分发使用 Apple 要求的包含扩展的 App。

## 安装

### Chrome／Edge 安装 ZIP

1. 解压 `bilibili-subtitle-extractor-6.7.0.zip`，保留解压后的整个文件夹。不要直接选择 ZIP 文件。
2. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。
3. 开启「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择**直接包含 `manifest.json` 的文件夹**。
5. 在浏览器扩展菜单中固定「B站字幕提取器」，然后刷新已经打开的 B 站视频页面。

Mac 的详细安装与更新步骤见 [INSTALL-MAC.md](INSTALL-MAC.md)。加载后请勿删除或移动扩展文件夹，否则浏览器将找不到文件。

### Safari 临时测试

使用 `bilibili-subtitle-extractor-safari-6.7.0.zip` 或 `dist/safari-extension/`，在 Safari「设置 → 开发者 → 添加临时扩展」中加载。详细步骤、权限设置和限制见 [INSTALL-SAFARI.md](INSTALL-SAFARI.md)。

**Safari 源 ZIP 不是签名 App 安装包。** 临时扩展在 24 小时后或退出 Safari 时移除。持久安装与正式分发仍需 Apple 的 App 打包、签名和分发流程；当前 Safari 实际功能验证状态见安装说明。

### 从源码安装

```sh
git clone https://github.com/a-luoluo/bilibili-subtitle-extractor.git
```

Chrome／Edge 按上述步骤加载仓库根目录即可。Safari 先运行 `npm run package`，再加载 `dist/safari-extension/`；仓库根清单用于 Chrome。扩展运行不需要 Node.js，也不需要安装依赖。

## 使用

1. 在 B 站打开含 BV 号的视频页面并等待播放器加载。
2. 点击浏览器工具栏中的扩展图标：Chrome／Edge 打开侧栏，Safari 打开弹出窗口。
3. 检测到字幕后选择语言。若未出现，先在播放器中打开字幕，再点击「重新检测」。
4. 点击「开始阅读」查看全文，点击字幕时间戳跳转当前视频。
5. 选择 SRT、TXT 或 JSON，然后点击「下载」。Safari 若显示「保存 文件名」链接，再点击该链接完成保存。文件保存位置由浏览器下载设置决定。
6. 在 B 站播放器中切换视频或分 P 后，扩展会重新检测。

**部分字幕需要登录 B 站。** 扩展沿用当前浏览器中的 B 站登录状态，不要求提供密码。没有登录时能够提取的字幕取决于 B 站接口与视频权限，不能保证所有视频免登录可用。

## 常见问题

**没有检测到字幕怎么办？**

确认视频在播放器里有可选字幕；必要时登录 B 站，打开播放器字幕并刷新页面，再重新检测。没有提供字幕、接口失败、网络异常和登录要求是不同情况，可根据侧栏提示处理。扩展无法提取烧录在画面中的文字。

**切换分 P 后内容不对怎么办？**

先等待新分 P 的播放器加载完成，再点击「重新检测」。如果仍然出现问题，请在 Issue 中提供视频 BV 号、分 P、浏览器版本和侧栏错误提示，不要上传 Cookie 或登录凭据。

**为什么 Safari 无法加载 Chrome 包？**

Chrome 包使用侧栏入口，Safari 包使用弹出窗口，并移除 Safari 不使用的后台与权限。请加载带 `safari` 的独立包。Safari 临时加载只用于开发测试，退出后需重新添加。

**会上传字幕或收集账号信息吗？**

扩展会请求 B 站的视频／字幕接口及字幕 CDN，登录相关请求可能带上浏览器已有的 B 站登录状态。字幕在本地扩展界面显示或下载到本地；代码没有独立的上传服务、分析统计或账号密码采集功能。

## 开发与打包

以下命令在 Git 源码仓库中运行；扩展 ZIP 不包含构建脚本。开发工具需要 Node.js 20 或更新版本；无 npm 依赖，不需要执行 `npm install`。

```sh
npm run check
npm test
npm run package
```

- `check`：检查运行脚本语法、版本号、Chrome／Safari 两份 manifest 的引用和 ZIP 文件目录／内容。
- `test`：运行 Node.js 行为回归测试；测试不依赖真实 B 站账号。
- `package`：生成 Chrome ZIP、Safari 源 ZIP 和 `dist/safari-extension/` 文件夹。
- `package:safari-app`：提供完整 Xcode 下的 Safari 未签名开发 App 构建入口；当前本机仅有命令行工具，App 编译仍待 CI／完整 Xcode 验证，不是签名／公证发行流程。

打包只包含扩展运行文件、图标与使用文档。文件顺序、时间戳和权限固定，同一份源码产生相同的 ZIP；测试、Git 数据及未使用的旧浮窗代码不进入安装包。

GitHub Actions 会运行检查和测试，分别提供 Chrome 与 Safari 源 ZIP 构建产物，并在 macOS 作业中尝试编译未签名的 Safari 开发 App。该 App 构建尚待 CI 实际验证，成功后也只用于开发测试；不会自动创建 Release。自动化测试不能替代真实视频验证；发布前应分别在 Mac Chrome／Edge 和 Safari 中检查有字幕视频、无字幕视频、登录要求、分 P 切换、语言切换、阅读跳转及三种格式下载。

## 项目结构

```text
manifest.json           扩展配置
background.js           侧栏入口
capture-main.js         播放器页面中的字幕捕获
capture.js              隔离环境中的字幕缓存与通信
sidepanel.html          侧栏／Safari 弹出窗口界面
sidepanel.js            检测、阅读、跳转与导出
icons/                  扩展图标
scripts/package.mjs     检查与可复现打包
scripts/build-safari.mjs Xcode 未签名开发 App 构建
tests/                  行为回归测试
```

更新内容见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

原项目 README 标注：MIT © a-luoluo。仓库目前未附独立 LICENSE 文件。
