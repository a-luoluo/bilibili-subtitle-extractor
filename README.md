# ⚡ B站字幕提取器 — 哔哩哔哩视频字幕一键提取 / Bilibili Subtitle Extractor

> 一个轻量、高效的 Chrome 浏览器扩展，用于提取和下载哔哩哔哩（Bilibili / B站）视频字幕。支持 CC 字幕及 AI 生成字幕，提供阅读模式和时间戳跳转功能。

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)](https://github.com/a-luoluo/bilibili-subtitle-extractor)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://github.com/a-luoluo/bilibili-subtitle-extractor)
[![License](https://img.shields.io/badge/license-MIT-orange)](https://github.com/a-luoluo/bilibili-subtitle-extractor)

---

## 📖 简介 / Introduction

**B站字幕提取器** 是一款专为哔哩哔哩设计的 Chrome 扩展程序，帮助用户一键提取 B 站视频中的字幕文本。无论视频使用的是 CC 字幕、AI 自动生成字幕，还是上传者手动添加的字幕，本工具都能轻松捕获并呈现。

适用于：字幕下载、字幕阅读、学习笔记、翻译对照、视频内容归档、二创素材整理等场景。

**Bilibili Subtitle Extractor** is a Chrome extension that extracts subtitles from Bilibili (B站) videos with one click. Supports CC subtitles, AI-generated subtitles, and user-uploaded subtitles — including timestamp navigation and reading mode.

---

## ✨ 核心功能 / Features

- 🔍 **一键提取字幕** — 点击扩展图标即可抓取当前 B 站视频的全部字幕内容
- 📖 **阅读模式** — 以纯文本方式浏览字幕，适合学习、笔记和内容回顾
- ⏱️ **时间戳跳转** — 点击任意字幕行即可跳转到视频对应时间位置
- 💾 **字幕下载** — 支持将字幕导出保存到本地
- 🚀 **免登录** — 无需登录 B 站账号即可使用
- 🧩 **Manifest V3** — 基于 Chrome 最新扩展规范开发，安全高效

---

## 📦 安装方法 / Installation

### Chrome 浏览器

1. 克隆或下载本仓库代码：
   ```bash
   git clone https://github.com/a-luoluo/bilibili-subtitle-extractor.git
   ```
2. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
3. 开启右上角「**开发者模式**」
4. 点击「**加载已解压的扩展程序**」
5. 选择本仓库所在文件夹，完成安装
6. 打开任意 B 站视频页面，点击工具栏中的扩展图标即可使用

### Edge 浏览器

与 Chrome 安装步骤完全一致（Edge 基于 Chromium）。

---

## 🔧 技术实现 / Tech Stack

| 技术 | 说明 |
|------|------|
| Manifest V3 | Chrome 扩展最新规范 |
| Side Panel API | 使用侧边栏面板展示字幕内容 |
| Content Scripts | 注入 B 站页面捕获字幕数据 |
| Service Worker | 后台处理字幕提取逻辑 |
| Vanilla JavaScript | 无框架依赖，极致轻量 |

---

## 📁 项目结构

```
bilibili-subtitle-extractor/
├── manifest.json          # 扩展配置文件
├── background.js          # Service Worker 后台脚本
├── content.js             # 页面注入脚本
├── capture.js             # 字幕捕获核心逻辑
├── floating.js            # 浮动窗口交互
├── sidepanel.html         # 侧边栏面板界面
├── sidepanel.js           # 侧边栏面板逻辑
├── icons/                 # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## ❓ 常见问题 / FAQ

**Q: 为什么有些 B 站视频提取不到字幕？**

A: 部分视频可能没有 CC 字幕或 AI 字幕。本扩展依赖 B 站页面中实际存在的字幕数据，若视频本身无字幕则无法提取。

**Q: 支持哪些类型的字幕？**

A: 支持 CC 字幕（Closed Caption）、AI 自动生成字幕，以及上传者手动添加的字幕。

**Q: 会收集用户数据吗？**

A: 不会。本扩展仅在本地浏览器中运行，不向任何服务器发送数据。

---

## 📄 许可证 / License

MIT © a-luoluo

---

## ⭐ 如果觉得好用，请给个 Star！

欢迎 Fork 和改进，也欢迎提交 Issue 和 PR。
