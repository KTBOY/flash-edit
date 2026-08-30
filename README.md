<p align="center">
  <b>⚡ Flash Game Trainer</b><br/>
  通用 Flash 游戏修改器 · 基于 Ruffle(WASM) 内存扫描<br/>
  数值修改 · 数值锁定 · 变速齿轮 · 游戏库 · 配置存档
</p>

---

Flash Game Trainer 是一个开源的桌面工具，把 Cheat Engine 的数值扫描工作流
带进 Flash 游戏：内置 Ruffle 模拟器运行 SWF，直接对其 WASM 内存做
扫描 / 修改 / 锁定，**无需针对单个游戏做任何配置**，对绝大多数以变量存值的
Flash 游戏通用（AVM1/AS2 与 AVM2/AS3 均支持）。

> ⚠️ 仅供本地单机游戏学习研究使用，请勿用于任何破坏游戏公平性的场景。

## 功能

- **游戏运行**：本地文件（对话框/拖拽）、网络 URL、游戏库一键重开；播放/暂停/重启/音量/全屏
- **游戏下载**：内置 oldswf.com 下载器——驱动本机 Edge/Chrome 监听游戏分片下载并重组
  （绕过其 TLS 指纹反爬），完成后自动载入并计入游戏库
- **数值扫描**：精确值 / 介于 / 未知初始值 / 增大 / 减小 / 变动 / 未变动，撤销 5 步、候选上限保护
- **游戏库**：下载 → 收藏 → 重玩 → 修改 → 打包的游戏中枢
- **数值修改与锁定**：单地址写入、批量写入、锁定持续写回（无敌/不减金币）
- **写入 SWF**：把运行时修改固化为离线常量补丁，另存永久修改版 Flash 文件（AS3 常量池 / AS2 字节匹配）
- **打包 / 还原 EXE**：Flash ⇄ EXE 双向——SWF 附加到 Flash 独立播放器末尾生成双击即玩单文件 EXE（移植自 cali.so，支持当前游戏或任意本地 SWF、内置/自定义播放器）；也能按 projector 页脚从这类 EXE 中提取回原始 SWF
- **变速齿轮**：0.1x–10x 全局时间缩放
- **配置存档**：按游戏内容 SHA-256 自动保存/恢复修改列表，失效地址自动标记
- **值类型覆盖**：f64（AVM Number）/ i32 / f32 / i16 / i8，"自动"模式覆盖绝大多数游戏

## 快速开始

```bash
npm install      # 自动复制 Ruffle 运行时
npm run dev      # 开发模式
```

打包 Windows 安装包：

```bash
npm run dist
```

## 使用方法

见 [docs/USAGE.md](docs/USAGE.md)（四步修改血量/金钱、伤害抓取技巧、FAQ）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/FEASIBILITY.md](docs/FEASIBILITY.md) | 可行性分析：四条技术路线对比、逐项可行性、已知限制 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构：补丁时序、内存 detach 防护、引擎可测试性、类型安全 IPC |
| [docs/USAGE.md](docs/USAGE.md) | 操作教程与常见问题 |

## 技术栈

Electron 37 · React 18 · Zustand · Ant Design 5 · TypeScript strict ·
Vitest · [Ruffle](https://ruffle.rs)（WASM Flash 模拟器）·
playwright-core（驱动系统 Edge/Chrome 做游戏下载）

界面采用 [Resonance HUD](https://github.com/KTBOY/resonance-hud) 深色金调游戏 HUD
设计语言：近黑基底、单一品牌金、发丝级描边、纯直角、L 形四角角标、中英双语区块标题、
菱形节点与点阵括号装饰（技能定义见 `.agents/skills/resonance-hud/`）。

## 开发

```bash
npm run typecheck   # 双 project 严格类型检查
npm run test        # 核心引擎单元测试
npm run lint        # ESLint 9 flat config
npm run format      # Prettier
```

## License

[MIT](LICENSE) · Ruffle 运行时遵循 Apache-2.0 / MIT 双许可
