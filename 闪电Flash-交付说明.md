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
| `npm run dist`（NSIS 安装包） | ⚠️ 配置解析通过（electron-builder 已成功 `loaded configuration file=package.json` 并进入 packaging 阶段）；最终卡在本机环境：旧 `dist/win-unpacked` 文件被系统占用无法清理 |

> **本会话内打包受阻的原因（与代码无关）**：
> 1. `dist/win-unpacked` 里部分文件（`icudtl.dat` / `app.asar` / `v8_context_snapshot.bin`）显示 `Device or resource busy`，但系统中并无 electron 进程在运行，属文件被占用锁定；
> 2. 改用临时输出目录重跑时，electron-builder 在本会话沙箱内长时间无输出（疑似下载/子进程被拦截），已终止。
>
> **你本机出包的步骤**：
> ```bash
> # 1. 确认没有正在运行的旧版程序（任务管理器搜 闪电Flash / Flash Game Trainer）
> # 2. 删除旧产物
> rm -rf dist/win-unpacked
> # 3. 出包
> npm run dist
> # 产物：dist/闪电Flash-v0.1.0-x64.exe
> ```

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

**修改**
- `package.json`、`src/main/index.ts`、`src/main/ipc-register.ts`、`src/shared/ipc.ts`、`src/preload/index.ts`
- `src/renderer/index.html`、`src/renderer/src/main.tsx`
- `src/renderer/src/components/layout/AppLayout.tsx`（布局重构 + 模式过滤）、`layout/StatusBar.tsx`
- `src/renderer/src/components/library/GameLibraryPanel.tsx`（embedded 内嵌态）
- `src/renderer/src/components/settings/SettingsPanel.tsx`、`components/common/HudSlider.tsx`
- `src/renderer/src/styles/global.css`、`src/renderer/src/locales/zh.ts`

---

## 遗留事项
- **第 7 条「打包程序速度过慢」按你的要求跳过**，分析结论已留存：
  - 应用内 SWF→EXE：10.7MB projector 每次都 `readFileSync` 无缓存、字节经 IPC 传两趟、一次性分配双倍内存；可改进程内缓存 + 流式写盘
  - electron-builder：`files` 未排除 `*.map`、未配 `compression`/`asar` 策略；`dist/` 里还有陈旧的 portable zip 可清理
  需要优化时说一声即可单独开一轮。
- 英文副标 `SHAN DIAN FLASH` 如想换回 `FLASH GAME TRAINER`，改 `src/renderer/src/locales/zh.ts` 的 `latin.appTitle` 一处即可。
