# 来源、借鉴与版权边界

核对范围：0.1.25 公开源码快照及由其构建的安装包。核对日期：2026-10-24。本文分别列出行为 / 结构研究、实际分发材料、方法参考和外部服务，不以一条“致谢”代替组件许可证。

## OCS 调研与课桥的关系

开发起点是用户希望理解 OCS Desktop 的桌面端与脚本协作方式，之后选择参考功能与结构、独立重写。早期调研检查了本地 OCS Desktop 2.9.24 的可读程序文件与公开仓库，并据此研究浏览器控制、通信、课程切换和查题模式。

| 资料 | 参考版本 | 用途与分发情况 |
| --- | --- | --- |
| [OCS Desktop](https://github.com/ocsjs/ocs-desktop) | [2.9.24 对应提交](https://github.com/ocsjs/ocs-desktop/tree/0fd51b473d733c9655b8ca386d32ec46d2809f11) | 行为和架构调研；其 `package.json` 声明 MIT。课桥不分发 OCS 安装目录、应用 UI、标志、安装程序或完整源码树 |
| [OCSJS](https://github.com/ocsjs/ocsjs) | [调研快照](https://github.com/ocsjs/ocsjs/tree/8b25a3f44523a0d4b7373878488056f4aa478cf6) | 网页适配、任务与查题流程的研究参考。上游 MIT，Copyright © enncy；课桥未嵌入完整 OCS userscript 或依赖其运行时 |
| OCS CDN 字形表 | `20220515.1` | 实际随源码分发的第三方数据，详见下一节；不能因课桥重写就省略该来源 |

课桥自己的桌面 / 扩展连接协议、界面、状态聚合、题库管理、查题路由与页面适配代码在本仓库中公开。它不是由 OCS 官方发布或认可的项目。独立重写描述的是应用实现方式，不表示所有依赖、资料和设计方法均为原创。

## 实际随源码分发的第三方材料

| 材料 | 作者 / 来源 | 许可与本地文件 | 使用方式 |
| --- | --- | --- | --- |
| Typr.js、Typr.U.js | [Photopea / Typr.js](https://github.com/photopea/Typr.js) | MIT；[`Typr.LICENSE`](../desktop/vendor/Typr.LICENSE) | `desktop/font.cjs` 在本地解析字体轮廓；保留上游文件与许可 |
| 字形映射表 | 作者 wyn665817；[原始下载地址](https://cdn.ocsjs.com/resources/font/table.json)，由 OCS CDN 托管 | 文件元数据声明 MIT；[`FontTable.LICENSE`](../desktop/vendor/FontTable.LICENSE) | `desktop/vendor/font-glyph-table.json`；用于字体映射参考，不含课程字体原文件 |

字形表的作者、版本及许可元数据保持原样。OCS CDN 是下载来源，不将其误写为数据原创作者。记录的 SHA-256 为 `fbc6ae3c795a46ca2bd0994e68e7cb90ca4d9a046f335512657760d9a4fdf875`；后续替换须重新核对来源及许可。

Typr 调研时记录的 Git blob 为：`Typr.js` → `aaf8acd92ed0c748eae49993faf2bf09b6ddb7d5`，`Typr.U.js` → `5af45011b9c584ae21fa20e4d4fa0a2860adbecf`。公开版还通过 [`scripts/audit-release.cjs`](../scripts/audit-release.cjs) 检查许可证与发行文件边界。

## 应用依赖与构建工具

| 组件 | 本版锁定版本 | 用途 | 许可 |
| --- | --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 44.8.0 | 桌面容器，包含 Chromium / Node.js 等组件 | Electron MIT，内含组件另有声明；安装包保留 `LICENSE.electron.txt` 和 `LICENSES.chromium.html` |
| [Playwright Core](https://github.com/microsoft/playwright) | 1.64.1 | 浏览器控制与输入 | Apache-2.0；保留包内 LICENSE / NOTICE / 第三方声明 |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 26.15.3 | 安装包构建 | MIT；仅构建使用，依赖各自许可见锁文件与包内声明 |
| [NSIS](https://nsis.sourceforge.io/License) | 由 electron-builder 下载的构建组件 | Windows 安装器 | NSIS 的 zlib/libpng 等组件许可，构建时保留上游声明 |
| [GitHub CLI](https://github.com/cli/cli) | 发布环境使用，不是运行依赖 | 创建仓库、上传发行附件 | MIT；不随课桥应用分发 |

开发依赖的精确版本、下载地址及散列在根目录和 `packaging/` 的 `package-lock.json` 中。完整安装包的依赖许可清单由构建流程生成，见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。Chrome for Testing 由用户首次使用时从上游下载，本项目不重新分发其二进制，也不声称它整体适用 MIT。

## 界面与仓库文档的方法参考

以下用于阅读设计 / 文档指导，没有作为桌面运行时代码或在线字体引入。课桥保留现有桥形标志，本地 SVG 与布局代码在仓库中公开。

| 项目 | 作者 / 许可 | 借鉴范围 |
| --- | --- | --- |
| [Impeccable](https://github.com/pbakaus/impeccable) | Paul Bakaus；Apache-2.0 | 信息层级、视觉审查与界面打磨方法 |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Next Level Builder；MIT | 间距、色彩、一致性和可访问性检查方法 |
| [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Anthropic；该 skill 附 Apache-2.0 许可 | 简约界面的排版和视觉取舍指导 |
| [crafting-effective-readmes](https://github.com/softaworks/agent-toolkit/tree/main/skills/crafting-effective-readmes) | Leonardo Flores / softaworks；MIT | 按开源项目读者组织介绍、安装、使用、贡献与许可证；模板许可保留在 [`docs/licenses/README-guides.txt`](licenses/README-guides.txt) |
| [Best-README-Template](https://github.com/othneildrew/Best-README-Template) | Othneil Drew；当前 `LICENSE.txt` 为 Unlicense | 页首导航、简洁展示和文档分层参考；未复制项目截图或标志 |

## 外部服务、商标与数据

学习通 / 超星是被适配的第三方平台；OCS、言溪、DeepSeek、Google Chrome、Electron 和 GitHub 等名称分别归其权利人所有。名称用于说明兼容性、来源和服务关系，不代表关联或背书。

言溪通过其公开服务接口提供查题和额度查询；DeepSeek 通过官方 API 提供生成与余额查询。用户自己配置账号与凭证，相关收费、使用条款及数据政策由服务方管理。第三方的 API 可访问不代表题库数据获准整体抓取或重新发布。

本地开发阶段曾研究 [SwaggyMacro/QuestionBank](https://github.com/SwaggyMacro/QuestionBank) 的公开历史数据，但没有确认其题目数据的明确再分发许可。**0.1.25 的公开仓库与安装包不包含这份数据库、SQL 转储、个人题库或真实试卷。** 通用导入 / 本地读取代码保留，用户应只导入有权使用的材料。

开源软件许可证不自动授予平台账号使用权、课程版权、数据库权利、商标或生成结果的全部权利。本清单依据可核对的来源整理，不构成对所有权利问题的法律保证。

## 版权反馈

若认为代码、资源或归属说明有遗漏，请在[版权反馈 Issue](https://github.com/xiaopeng77777/CourseBridge/issues/new?template=rights.yml)中提供文件路径、原始来源链接、权利依据和希望的处理方式，不要公开提交账号凭证或敏感材料。维护者会核实后补充归属、替换或移除争议材料；必要时暂停对应发行附件。
