# 闪电Flash —— 交付说明

工作目录：`E:\work\gogogogo\flash-edit` ｜ 分支 `main`

---

## 本轮完成内容

### 2. 打包程序名称 → 中文
- `package.json`：`productName: "闪电Flash"`，新增 `artifactName: "闪电Flash-v${version}-${arch}.${ext}"`
- 窗口标题（`src/main/index.ts`）与 `<title>`（`src/renderer/index.html`）同步为「闪电Flash」
- `appId` 保持 ASCII（`dev.flash.trainer`），避免安装器兼容问题

### 3. 侧边栏默认隐藏 + 标题栏折叠按钮
- 新增 `src/renderer/src/store/useModeStore.ts`：`siderOpen` 默认 `false`，持久化到 localStorage（key `fgt.mode.v1`）
- `AppLayout.tsx`：`<aside className="panel">` 条件渲染（不用 Sider width:0，避免 0 宽占位残边）
- 标题栏新增折叠按钮（网络加载右侧、窗口控制左侧），状态记忆，下次启动保持

### 4. 按钮顺序调整
标题栏现为：**打开 SWF → 打包 EXE → 网络加载 → 下载游戏（完整模式） → 折叠按钮**

### 5. 变速齿轮拖动 → Tab 栏滑动异常（已修）
根因有两层：
1. `AppShell` 订阅了 `speed`，滑块每帧 onChange 都重渲染整棵树（含 Tabs）
2. rc-tabs 在 nav 三层挂 resize-observer；旧布局把 Tab 栏和内容包进**同一个滚动容器**，滚动条显隐改变容器宽度 → tab 偏移重算 → `.ant-tabs-nav-list` transform 跳变 + `.ant-tabs-ink-bar-animated`（0.3s transition）金色下划线滑动

修复（三处）：
- 新增 `ProfileAutoSaver.tsx`：把自动保存副作用从 AppShell 抽出，AppShell 不再订阅 speed
- `global.css` 新增 `.panel-tabs`：滚动容器**下沉到 Tab 内容区**，nav 固定不参与滚动，宽度恒定
- `HudSlider.tsx`：内部本地 state 保证跟手，rAF 合并对外回调，一帧最多触发一次

### 6. 启动闪烁卡顿（已修）
根因：`ready-to-show` 只保证文档首帧，而 React 挂载 + antd v5 cssinjs **运行时注入上百条样式**会阻塞主线程数百毫秒，期间窗口是空的 → 「空窗 → UI 啪地弹出」。

修复：
- `src/renderer/index.html`：内联静态首屏骨架 `#boot`（内联样式，不依赖 global.css / antd；配色沿用 `#14161a` 底 + `#c9ac67` 金），是 `#root` 的**兄弟节点**，React 不接管
- `src/renderer/src/main.tsx`：`createRoot().render()` 后**双 rAF**（确保样式注入且完成一次绘制）再加淡出并移除骨架，异常时兜底强制移除

### 8 + 9 + 10. 打包模式（统一开关）
默认进入**打包模式（精简）**，输入密令 `test` 后永久解锁为完整模式：

| 能力 | 打包模式 | 完整模式 |
|---|---|---|
| 标题栏「下载游戏」 | 隐藏 | 显示 |
| 游戏库「下载新游戏」 | 隐藏 | 显示 |
| 侧边栏「数值扫描」Tab | 隐藏 | 显示 |
| 侧边栏「修改列表」Tab | 隐藏 | 显示 |
| 打开 SWF / 打包 EXE / 网络加载 | 保留 | 保留 |
| 侧边栏「游戏库」「设置」 | 保留 | 保留 |

- 状态机在 `useModeStore`，localStorage 持久化，读写 try/catch（被禁用/被清 → 回退打包模式，密令仍可用）
- 密令入口：**设置 → 关于区最底部**低调输入框（`UnlockInput.tsx`），回车校验，成功后替换为灰色说明文字
- **代码未删除**，扫描/修改列表只是按模式过滤 Tab；Tabs 受控 `activeKey`，避免 Tab 被过滤后 rc-tabs 自动回退跳 Tab
- 状态栏在打包模式下隐藏「候选地址 / 修改项」两项指标
- 游戏库从标题栏下拉**迁移到侧边栏 Tab**（`GameLibraryPanel` 新增 `embedded` 内嵌态）

### 11. 主标题 → 闪电Flash
- 界面标题栏：中文主标题「闪电Flash」+ 英文副标 `SHAN DIAN FLASH`
- 英文副标由 `FLASH GAME TRAINER` 改为 `SHAN DIAN FLASH`（品牌一致；如需保留原副标，改 `locales/zh.ts` 的 `latin.appTitle` 一处即可）

### 12. 关于区新文案
三行排版（`AboutSection.tsx`）：
- 开发：舒克开发
- 运行时：Electron x.x.x（取 `appInfo.electron` **动态**拼接，不会写死过期）
- 个人网站：https://ktboy.github.io/sh-design/ ——可点击，走新增 IPC `SHELL_OPEN_EXTERNAL` 在**系统默认浏览器**打开；主进程强制 **http/https 白名单**，非白名单协议静默丢弃

---

## 验证结果

| 检查 | 结果 |
|---|---|
| `npm run typecheck`（node + web 两套 tsconfig） | ✅ 通过 |
| `npm run lint`（eslint 全仓） | ✅ 通过 |
| `npm run test`（vitest 9 个文件 67 用例） | ✅ 全部通过 |
| `npm run build`（electron-vite 三端构建） | ✅ 通过，产物 `out/renderer/index.html` 已含骨架与中文标题 |
| `npm run dist`（NSIS 安装包） | ✅ 通过，产物 **`dist/build/闪电Flash-v0.1.0-x64.exe`**（125MB），解包版主程序 `dist/build/win-unpacked/闪电Flash.exe` |

### 关于打包被锁问题的追加修复（第二轮）

首轮 `npm run dist` 因 `dist/win-unpacked/resources/app.asar` 被系统占用而失败
（electron-builder 每次打包都会**整个清空重建**输出目录，目录里只要有一个文件被锁就整体报 Go 堆栈）。
该锁持续存在且系统中并无相关进程（排除「程序还在运行」后仍锁，属资源管理器预览窗格 / 杀毒扫描类的隐形占用）。
已做两处修复：

1. **输出目录迁到 `dist/build`**（`package.json` → `build.directories.output`）
   —— 全新目录不含被锁文件，`EnsureEmptyDir` 不再撞锁；`dist/` 已在 .gitignore，无额外影响
2. **新增 `scripts/clean-dist.mjs`** 并挂到 `predist` / `clean` 脚本：
   - 结束「可执行文件位于本项目 dist 内」的旧版进程（只按路径匹配，不误伤其他程序）
   - 对输出目录做带重试删除（`fs.rm maxRetries: 6`，对杀毒软件瞬时锁有效）
   - 仍失败时列出具体被锁文件并给出中文排查指引，不再刷 Go 堆栈
   - 旧的 `dist/win-unpacked` 作为遗留目录尽力清理，锁住则跳过（不再影响打包）

> 旧 `dist/win-unpacked` 目前仍被锁，重启电脑后可手动删除；它已不参与打包流程。

### 需要你手工验收的点（无法在无界面会话中自动化）
- [ ] 冷启动：无空窗/白闪，标题直接出现骨架再淡入 UI
- [ ] 安装包名 / 开始菜单快捷方式 / 卸载项均为「闪电Flash」
- [ ] 拖变速齿轮：Tab 栏下划线不再滑动、Tab 行不再跳位
- [ ] 侧边栏默认收起，点折叠按钮展开；重开应用保持上次状态
- [ ] 打包模式精简形态正确；设置→关于底部输入 `test` 回车解锁，重启后仍保持
- [ ] 关于区点网址在默认浏览器打开
- [ ] 侧边栏展开/收起后 Ruffle 画面自适应正常

---

## 新增 / 修改文件清单

**新增**
- `src/renderer/src/store/useModeStore.ts` — 打包模式 + 侧边栏状态
- `src/renderer/src/components/layout/ProfileAutoSaver.tsx` — 自动保存副作用隔离
- `src/renderer/src/components/settings/AboutSection.tsx` — 关于区三行排版
- `src/renderer/src/components/settings/UnlockInput.tsx` — 密令解锁入口
- `scripts/clean-dist.mjs` — 打包前清理（结束 dist 内进程 + 带重试删输出目录 + 中文诊断）
- `build/installer.nsh` — NSIS 完成页定制（「安装完成」标题 + 默认勾选「运行 闪电Flash」）

**修改**
- `package.json`、`src/main/index.ts`、`src/main/ipc-register.ts`、`src/shared/ipc.ts`、`src/preload/index.ts`
- `src/renderer/index.html`、`src/renderer/src/main.tsx`
- `src/renderer/src/components/layout/AppLayout.tsx`（布局重构 + 模式过滤）、`layout/StatusBar.tsx`
- `src/renderer/src/components/library/GameLibraryPanel.tsx`（embedded 内嵌态）
- `src/renderer/src/components/settings/SettingsPanel.tsx`、`components/common/HudSlider.tsx`
- `src/renderer/src/styles/global.css`、`src/renderer/src/locales/zh.ts`

---

## 追加：安装向导（可指定安装目录）

最初 `package.json` 里没有任何 `nsis` 配置，electron-builder 走默认 **`oneClick=true`** = 一键安装、
不询问、直接装进 `%LOCALAPPDATA%\Programs\闪电Flash`。已改为带向导的安装界面（`build.nsis`）：

| 配置 | 值 | 效果 |
|---|---|---|
| `oneClick` | `false` | 由一键安装改为**向导式安装**（会有「下一步 / 安装 / 完成」按钮） |
| `perMachine` + `selectPerMachineByDefault` | `false` / `false` | 默认选中「**仅为我安装**」，直接下一步即可，**全程不弹 UAC、不需要管理员** |
| `allowElevation` | `true` | 想装到 `C:\Program Files` 等受保护目录时，可勾「为所有用户安装」申请提权 |
| `allowToChangeInstallationDirectory` | `true` | **出现「选择安装位置」页**，默认 `%LOCALAPPDATA%\Programs\闪电Flash`，可改成 `D:\游戏\闪电Flash` 等任意目录；所选目录末尾不含程序名时会自动补 `闪电Flash` 子目录 |
| `installerLanguages` / `displayLanguageSelector` | `["zh_CN"]` / `false` | 安装向导为**中文**界面 |
| `createDesktopShortcut` / `createStartMenuShortcut` | `true` / `true` | 桌面 + 开始菜单快捷方式 |
| `runAfterFinish` | `true` | 装完可勾选立即运行 |
| `deleteAppDataOnUninstall` | `false` | 卸载**保留用户数据**（已下载的游戏、修改配置） |

> 说明：`oneClick:false` 且 `perMachine:false` 时，electron-builder 的向导**必然**包含一页
> 「安装模式」（为所有用户 / 仅为我）——框架只有 `perMachine:true` 才会跳过这一页。
> 默认已选「仅为我」，一路下一步就是每用户安装，不会弹管理员授权。

**完成页「运行程序」提示（追加）**：新增 `build/installer.nsh`（electron-builder 自动 include 的
buildResources 自定义脚本），把完成页定制为标准软件安装的收尾体验——

- 标题改为 **「安装完成」**；
- 正文提示：*闪电Flash 已安装到本机。「运行 闪电Flash」已默认勾选，点击「完成」即可立即打开程序。*
- 勾选框文案 **「运行 闪电Flash」**，且**默认已勾选**（NSIS MUI2 原生行为）→ 点「完成」即启动程序。

**验证**：electron-builder 会把完整生成的 .nsi 写进 `dist/build/builder-debug.yml`，已确认其中包含
`!include "…\build\installer.nsh"`（位置在主安装流程之前，定义生效）以及
`!insertmacro MUI_LANGUAGE "SimpChinese"`（且仅此一种语言）。

文档：`docs/USAGE.md` 新增「安装与卸载」一节。

---

## 遗留事项
- **第 7 条「打包程序速度过慢」按你的要求跳过**，分析结论已留存：
  - 应用内 SWF→EXE：10.7MB projector 每次都 `readFileSync` 无缓存、字节经 IPC 传两趟、一次性分配双倍内存；可改进程内缓存 + 流式写盘
  - electron-builder：`files` 未排除 `*.map`、未配 `compression`/`asar` 策略；`dist/` 里还有陈旧的 portable zip 可清理
  需要优化时说一声即可单独开一轮。
- 英文副标 `SHAN DIAN FLASH` 如想换回 `FLASH GAME TRAINER`，改 `src/renderer/src/locales/zh.ts` 的 `latin.appTitle` 一处即可。
