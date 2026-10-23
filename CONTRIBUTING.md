# 贡献指南

感谢帮助改进课桥。这个仓库公开桌面、插件、测试和打包源码；请使用虚构资料或明确授权的数据复现问题，不上传真实考试、学生资料或第三方题库转储。

## 开发

Windows x64、Node.js 24+：

```powershell
npm ci
npm run browser:install
npm start
npm test
```

浏览器测试需要 `COURSEBRIDGE_CHROME` 指向已经下载的课程浏览器 `chrome.exe`。可用下面的命令选择项目的组件路径：

```powershell
$env:COURSEBRIDGE_CHROME = node -e "console.log(require('./desktop/browser.cjs').findChromium(require('path').resolve('runtime/browsers')))"
npm run test:editor-input
npm run test:multichoice
npm run test:exam
npm run test:ui-refresh
npm run test:desktop
```

测试页面通过本地合成页面和拦截响应提供，无需真实学校账号、言溪 Token 或 DeepSeek Key。`work/`、`outputs/`、`data/` 均忽略，不应提交。不要在未保存的真实考试上运行调试或替换浏览器文件。

## 构建安装包

```powershell
npm run package:win
npm ci --prefix packaging
npm run installer:win
```

便携目录输出到 `outputs/CourseBridge-Windows`，安装包输出到 `outputs/installers/`。构建采用白名单复制源码与运行依赖，不复制 `data`、浏览器登录资料、离线数据库或缓存；公开安装包的浏览器组件在首次使用时下载。已有输出目录时构建会停止，请自行归档或删除明确的构建输出，避免覆盖正在运行的应用。

`npm run audit:release` 检查公开文件边界、版本、特殊用量试验代码及许可证。`node scripts/verify-bundle.cjs` 在生成便携目录后比对源码与发行文件。安装包附件必须来自公开 tag 的同一份源码，生成 SHA-256 校验值。未签名和未经真实平台验证的事项应在发行说明写清楚，不使用虚假测试徽章或保证性表述。

## 提交修改

1. 描述触发条件、实际行为和预期行为；截图去除个人资料和 URL 参数。
2. 保持改动聚焦。页面适配修复优先使用合成 DOM / 编辑器夹具验证，不依赖学校页面。
3. 代码或资源来自第三方时，列出上游链接、具体文件、版本、许可证和修改范围，更新来源清单并保留许可。
4. 本地 / 第三方 / AI 答案来源和核验状态必须可辨认；未知状态不可当作完成。
5. 不引入隐藏统计、账号窃取、凭证上传、伪造学习记录或绕过验证码的实现。

贡献者需有权提交内容；提交的课桥代码按项目 MIT 许可分发，第三方内容保留各自许可。安全问题不要公开复现细节，见 [SECURITY.md](SECURITY.md)。
