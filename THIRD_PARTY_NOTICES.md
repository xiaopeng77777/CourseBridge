# 第三方许可声明

课桥自行编写的代码适用根目录 [MIT LICENSE](LICENSE)。本声明不替代第三方许可证，也不把它们重新许可为课桥原创代码。

## 源码内置材料

- **Typr.js / Typr.U.js** — Copyright (c) 2016 Photopea，MIT。源码位于 `desktop/vendor/`；完整许可见 [`Typr.LICENSE`](desktop/vendor/Typr.LICENSE)。
- **字形映射表** — 作者 wyn665817，元数据版本 `20220515.1`，声明 MIT；来源 `https://cdn.ocsjs.com/resources/font/table.json`。完整许可见 [`FontTable.LICENSE`](desktop/vendor/FontTable.LICENSE)，原始元数据保留。
- **README 指南模板** — MIT，Copyright (c) 2026 Leonardo Flores；参考 `softaworks/agent-toolkit` 的 crafting-effective-readmes，许可保留在 [`docs/licenses/README-guides.txt`](docs/licenses/README-guides.txt)。

## 安装包依赖

- **Electron 44.8.0** — Electron 本身 MIT。打包保留 Electron 运行时的 `LICENSE.electron.txt`、`LICENSES.chromium.html`，其中包括 Chromium、Node.js、编解码器及其他组件的独立声明。
- **playwright-core 1.64.1** — Apache-2.0。包内 `LICENSE`、`NOTICE`、`ThirdPartyNotices.txt` 随运行依赖原样分发；发行清单见 `docs/licenses/dependencies.json`。
- **安装器构建** — electron-builder 为 MIT；NSIS 分发的完整 COPYING 保留在 [`docs/licenses/NSIS-COPYING.txt`](docs/licenses/NSIS-COPYING.txt)。其构建工具及插件保留上游许可，构建工具不作为课桥源码重新授权。锁文件保留精确依赖版本及完整性散列。

Chrome for Testing 由用户点击确认后从上游分发源下载，**不在公开课桥安装包中重新分发**。管理脚本的开源许可不代表 Google Chrome 二进制整体许可；使用前查看 [浏览器组件说明](docs/GETTING_STARTED.md#浏览器组件与许可)。

OCS Desktop / OCSJS 的调研关系、UI 方法参考、文档工具以及不再分发的题库材料，完整列在 [来源与借鉴](docs/ATTRIBUTION.md)。第三方网站、API、课程数据和商标由各自权利人管理，不因本软件开源而被授予使用或再分发许可。
