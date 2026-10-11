# 架构说明

## 技术栈

- **Electron 37 + electron-vite 3 + Vite 6**：桌面壳，main/preload/renderer 三进程工程化
- **React 18 + Zustand 5 + Ant Design 5**：渲染层 UI 与状态
- **TypeScript 5 strict**：全仓库严格模式，`@shared` 单一事实来源
- **Vitest 3**：核心算法单元测试（25 例）
- **@ruffle-rs/ruffle**：Flash 运行时（WASM），postinstall 复制到 renderer public

## 目录结构

```
src/
├─ shared/                    # 跨进程共享层（唯一事实来源）
│  ├─ types.ts                #   领域类型：ValueType/ScanRequest/CheatProfile/GameRecord…
│  ├─ ipc.ts                  #   IPC 通道常量 + IpcApi 契约（preload 实现、renderer 依赖）
│  ├─ download.ts             #   多站点下载共用：任务标识（来源:游戏ID）/文件名清洗
│  ├─ oldswf.ts               #   oldswf 输入解析/页面取源/分片清单
│  ├─ gamebox.ts              #   gamebox.tw 输入解析/对象存储地址解析
│  └─ protocol.ts             #   swf-file:// 自定义协议 URL 构造/解析
├─ main/                      # 主进程
│  ├─ index.ts                #   生命周期：单实例锁 → 协议注册 → 窗口 → IPC 装配
│  ├─ ipc-register.ts         #   IPC 处理器集中注册（依赖注入 services）
│  ├─ infra/
│  │  ├─ logger.ts            #   结构化日志
│  │  └─ protocol.ts          #   swf-file:// 特权注册与 handler（net.fetch 流式回源）
│  └─ services/
│     ├─ dialog.service.ts    #   文件选择
│     ├─ storage.service.ts   #   JsonStore：临时文件 + rename 原子写
│     ├─ game.service.ts      #   游戏库（最近游玩）
│     ├─ library-watcher.service.ts #  下载目录 fs.watch：外部文件变化 → 推送游戏库刷新
│     ├─ profile.service.ts   #   修改配置（按游戏哈希）
│     ├─ skill.service.ts     #   项目 Agent Skill 扫描（.agents|.qoder/skills，读 SKILL.md）
│     ├─ download/            #   多站点下载队列（站点无关的一层）
│     │  ├─ provider.ts       #    SwfSourceProvider 契约：输入解析 + 把游戏页变成 SWF 字节
│     │  └─ download-manager.ts #  并发排队/取消重试/进度节流/SWF 头校验/落盘命名/入库回调
│     ├─ oldswf/              #   oldswf.com 站点 provider
│     │  ├─ oldswf-provider.ts #   驱动系统浏览器读地址→直连，分片重组/IndexedDB 兜底
│     │  ├─ chunk-assembler.ts #   分片重组/Content-Range/SWF 头（纯逻辑，可单测）
│     │  └─ __tests__/        #    重组器单测
│     └─ gamebox/             #   gamebox.tw 站点 provider（Node 直连 + Referer 取对象存储）
│        └─ gamebox-provider.ts
├─ preload/
│  └─ index.ts                # contextBridge 白名单暴露 IpcApi（sandbox 开启）
└─ renderer/
   ├─ public/ruffle/          # Ruffle 运行时资产（postinstall 生成，gitignore）
   └─ src/
      ├─ core/                # ★ 与 UI 无关的核心引擎层
      │  ├─ runtime.ts        #   单例装配：必须在一切之前导入（补丁时序保证）
      │  ├─ wasm/
      │  │  ├─ tracker.ts     #   WebAssembly.Memory/Instance 构造器补丁 + 内存登记 + Provider
      │  │  └─ time-scaler.ts #   变速齿轮（performance.now / Date.now 缩放）
      │  ├─ scan/
      │  │  ├─ engine.ts      #   扫描引擎（纯逻辑，MemoryProvider 抽象，可完整单测）
      │  │  └─ freeze.ts      #   数值锁定（50ms 写回）
      │  ├─ ruffle/
      │  │  ├─ loader.ts      #   按需注入 ruffle.js（保证补丁先于播放器安装）
      │  │  └─ player-controller.ts # 播放器生命周期/控制/截图
      │  └─ hash.ts           #   SHA-256（游戏内容指纹）
      ├─ services/            # 应用服务层
      │  ├─ ipc.service.ts    #   window.api 类型安全取用
      │  ├─ game-launcher.ts  #   四条加载入口的统一编排（见下）
      │  └─ app-services.tsx  #   Context 注入 controller/launcher
      ├─ store/               # Zustand 状态层（纯数据，不含引擎引用）
      │  ├─ useGameStore.ts   #   游戏会话/游戏库/速度
      │  ├─ useScanStore.ts   #   扫描会话状态机（首扫/再扫/撤销/重置）
      │  ├─ useCheatStore.ts  #   修改列表（冻结引擎的唯一事实来源）
      │  └─ useSkillStore.ts  #   本地 Skill 列表缓存（首次挂载拉取，手动刷新才重扫）
      ├─ components/          # UI 组件（layout / player / scan / cheat / settings / library / download / skill）
      ├─ hooks/ useTick.ts    # 非响应式数据驱动刷新
      └─ locales/ zh.ts       # 文案集中管理
```

## 关键设计决策

### 1. 补丁时序（正确性的根基）

`main.tsx` 第一行导入 `core/runtime`，模块求值时同步完成：

```
TimeScaler.install()  → 包装 performance.now / Date.now
WasmMemoryTracker.install() → 替换 WebAssembly.Memory / Instance 构造器，
                              并兜底包装 instantiate / instantiateStreaming
```

Ruffle 由 `loader.ts` **按需**注入（用户选游戏时才加载），因此播放器的 WASM 内存
必然在补丁之后创建，100% 被捕获。补丁保留原生 `prototype`，`instanceof` 语义不变，
对宿主页面零破坏。

### 2. 防内存 detach

非共享 `WebAssembly.Memory` 在 `grow()` 后旧 ArrayBuffer 会被 detach。
因此 `MemoryProvider` **每次调用都读取 `memory.buffer` 最新引用，禁止缓存**；
扫描按 4MB 分片，每片重新取 buffer，游戏在扫描中途 grow 也安全。
快照（未知初始值流程）用 `buffer.slice(0)` 拷贝为静态副本，与活动内存解耦。

### 3. 扫描引擎的可测试性

引擎只依赖 `MemoryProvider` 接口（`listMemories` / `getBuffer`），不接触 WebAssembly。
单测里用普通 `ArrayBuffer` 构造假内存即可覆盖全部扫描语义；tracker 的测试则用
Node 原生 WebAssembly + 隔离宿主对象验证补丁行为（含手工构造的最小 wasm 模块）。

### 4. 类型安全的 IPC 链

```
shared/ipc.ts(IpcApi) ── preload 实现 ── window.api ── renderer 调用
```

通道名常量化、preload 白名单暴露（不透传任意 channel）、renderer 侧无 `any`。

### 5. 游戏身份与配置持久化

游戏 = 内容 SHA-256（URL 场景 = `url:<sha256(url)>`）。
修改配置（cheat table + 速度）按此哈希存于 `userData/data/profiles.json`，
加载游戏时自动恢复并**逐条校验地址可读性**，不可读的条目标记 `stale` 并自动停锁。
写入走 JsonStore（临时文件 + rename）保证崩溃安全。

### 6. 加载编排

四条入口（对话框选文件 / 拖拽 / URL / 游戏库重开）统一收敛到
`GameLauncher.finalize()`：扫描会话重置 → cheat 上下文切换 → 播放器加载 →
游戏库记录 → 配置恢复。新增入口只需复用，不会漏步骤。

### 7. 网络下载链路（获取游戏的第零步，多站点）

两个站点对「非真实浏览器/无来源页」的请求都不放行，所以「网络加载」到不了这些游戏——
内置下载器是它们进入应用的唯一入口。站点差异全部收在 provider 里，队列与落盘只有一份：

```
侧边栏「网络下载」→ 选站点（oldswf / gamebox，各自独立输入框与任务列表）
  → IPC download:swf(source, input) → DownloadManager（主进程，≤3 并发，可取消/重试）
    → 按 source 取 provider：
       oldswf  playwright-core 无头驱动系统 Edge/Chrome 打开游戏页取资源地址
               → Node 直连全量拉取；失败退回监听站点分片（Content-Range 重组）
               → 再兜底 page 内 IndexedDB（swfFiles/blobs）提取
       gamebox Node 直连取游戏页 HTML → 解析页内对象存储地址
               → 带 Referer（游戏页地址）全量拉取，无需浏览器
    → SWF 头校验（FWS/CWS/ZWS）→ 按「清洗后标题_游戏ID.swf」写入下载目录
    → 任务快照经 download:swf-task 事件推送；成功即登记游戏库（source = 'download'）
  → 面板「打开」用 GameLauncher.loadDownloadedFile 复用 finalize 链自动载入
```

设计要点：任务标识是 `来源:游戏 ID`，两个站点的同号游戏不会互相覆盖；新增站点只需
实现一个 provider 并注册进 DownloadManager，不动队列/落盘/渲染层。playwright-core 不
携带浏览器内核（走系统浏览器，安装包零增量）；纯逻辑（输入解析 `@shared/oldswf`、
`@shared/gamebox`、分片重组）与浏览器 IO 分离，前者完整单测；main/preload 通过
`externalizeDepsPlugin` 保持依赖运行时 require，避免把 playwright-core 的可选依赖
动态 import 打进 bundle。

### 8. 项目 Skill 面板（看清流程有没有被读到）

```
侧边栏「Skill」→ useSkillStore（首次挂载拉取，手动刷新才重扫）
  → IPC skill:list / skill:read → SkillService（主进程）
    → 扫描根：仓库 .agents/skills 与 .qoder/skills（开发取 cwd，安装版取 exe 同级）
    → 每个子目录读 SKILL.md → @shared/skill 解析 frontmatter（无 YAML 依赖）
  → 按名称排序，两个根里同名的条目标为重复
```

设计要点：只看当前项目，全局与插件自带的 skill 不进列表，避免几十个不相干条目淹没仓库自己的流程；
渲染层 sandbox 无 fs，扫描与读文件全在主进程，`skill:read` 用 `isInsideDir` 把可读路径限制在扫描根内，
避免这条通道变成任意文件读取；重名不自动「择优」——谁生效是 Qoder 的事，面板只把冲突暴露出来。

## 变速齿轮的实现边界

`performance.now` 被 Ruffle 用于帧循环与 `getTimer`，包装后生效；
AS 的 `Date` 类在 Ruffle 内部走 OS 时钟，不受影响。对以帧驱动的绝大多数
Flash 游戏可完整实现加速/减速。

## 质量门禁

| 门禁 | 命令 | 状态 |
| --- | --- | --- |
| 类型检查（node + web 两个 project） | `npm run typecheck` | ✅ 0 error |
| 单元测试 | `npm run test` | ✅ 67/67 |
| 生产构建 | `npm run build` | ✅ main/preload 外部化依赖 + renderer 2.3MB |
| 下载链路端到端 | 真机 oldswf.com 下载 | ✅ 分片重组 SHA-256 与原脚本一致 |
| EXE 打包/还原往返 | 真实 projector + 3MB SWF | ✅ SHA-256 一致 |
| Lint / 格式化 | `npm run lint` / `npm run format` | ESLint9 flat + Prettier |
