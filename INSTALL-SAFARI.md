# 在 Mac Safari 中测试 B站字幕提取器

6.7.0 提供 Safari Web Extension 源码包，工具栏图标打开字幕弹出窗口。这个 ZIP **不是签名的 Mac App 安装包**，也不会永久安装扩展。

当前状态：Safari 适配代码和打包检查已准备，真实 Safari 中的字幕提取、阅读跳转、下载仍待验证；Node／Chromium 测试不能替代 Safari 验收。

## 环境要求

- macOS Safari 18.4 或更新版本，建议使用当前稳定版。
- Safari 允许此扩展访问 `bilibili.com` 与 `hdslb.com` 字幕 CDN。
- 部分视频字幕需要在 Safari 中登录 B 站。

本项目以 18.4 为最低目标：`content_scripts.world` 的[兼容性数据](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#browser_compatibility)标注 Safari 18 起提供支持，WebKit 官方确认[临时加载扩展自 Safari 18.4 引入](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/#temporary-extension-installation)。这仅说明所用 API 的版本要求，不等同于已在所有版本实测。

## 临时安装

1. 准备 `bilibili-subtitle-extractor-safari-6.7.0.zip`，或者运行 `npm run package` 后使用 `dist/safari-extension/` 文件夹。
2. 打开 Safari →「设置」→「高级」，开启「显示网页开发者功能」。
3. 在「设置」→「开发者」中点击「添加临时扩展…」（Add Temporary Extension…）。
4. 按 Safari 提示自行完成系统授权，再选择 Safari ZIP 或直接含 `manifest.json` 的 Safari 文件夹。不要选择仓库根目录或 Chrome ZIP。
5. 在「设置」→「扩展」中启用「B站字幕提取器」，按提示允许访问 B 站及字幕 CDN。若下载提示访问权限不足，检查扩展的站点权限设置。
6. 刷新原本打开的 B 站视频页，点击工具栏里的扩展图标。若出现「允许访问 B站和字幕」按钮，点击并完成 Safari 的站点授权；授权后会自动重新检测。

Safari 的弹出窗口会在你点击其他位置后关闭；再次点击图标会重新读取当前视频。不要在字幕加载或文件导出期间关闭窗口。

导出时选择 SRT、TXT 或 JSON 并点击「下载」；若正文尚在加载，准备完成后会显示「保存 文件名」链接，再点击一次即可交给 Safari 保存。未授权时可先使用窗口内的「允许访问 B站和字幕」按钮。

根据 [Apple 官方运行说明](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)，临时扩展会在 **24 小时后或退出 Safari 时被移除**。「允许未签名扩展」也会在退出后复位；下次测试需要重新加载并确认权限。

## 更新测试版本

1. 重新生成 Safari 包或替换 Safari 扩展文件夹内容。
2. 在 Safari 的临时扩展设置中重新加载扩展；若已退出 Safari，需要重新添加。
3. 检查站点权限，然后刷新 B 站视频页。

## 正式安装与分发

持久安装需要把 Web Extension 打包成包含扩展的 Mac App；正式分发还需要相应的 Apple 开发者身份、签名，以及 App Store 或 Developer ID／公证流程。详见 [Apple 的 Safari Web Extension 文档](https://developer.apple.com/documentation/safariservices/safari-web-extensions)。

仓库提供 `npm run package:safari-app` 开发构建入口，需要完整 Xcode（仅 Command Line Tools 不够）。运行步骤：

```sh
npm run package
npm run package:safari-app
```

脚本使用 Apple 的打包工具创建工程，再通过 `xcodebuild` 编译并验证 App／扩展资源。**本机目前只有命令行工具，App 编译尚待 CI／完整 Xcode 环境验证**；生成源文件或通过 Node 检查不代表 App 构建成功。

构建成功时，产物为 `dist/bilibili-subtitle-extractor-6.7.0-safari-development.app.zip`、对应 `.sha256` 和 `dist/safari-build/build-report.json`。这是未签名的开发 App，只供测试，并非可直接分发给普通用户的已签名／已公证发行版。脚本不会操作 Apple 凭据或自动发布。
