---
name: flash-game-patcher
description: 修改、修复与增强经典 Flash 游戏（.swf / Flash 打包 .exe）的完整逆向工程工作流——识别并解包嵌套/平台包装（如 4399 三层壳）、反编译 AS1/AS2/AS3 脚本与时间轴、给无脚本按钮注入功能、编辑帧脚本、实现本地存读档系统、用 FFDec 重新编译、逐层回嵌生成成品，并用 Ruffle + Playwright 自动化实测验证。当用户要求给 Flash 游戏增加/修复存档（存读档）、修复点不动的按钮或失效界面、修改游戏逻辑数值文案、解包或提取 Flash 游戏资源、汉化 swf 时使用。
agent_created: true
---

# Flash 游戏修改器（Flash Game Patcher）

对经典 Flash 游戏做 **反编译 → 补丁 → 重编译 → 实测** 的通用工作流。
本技能沉淀自《美少女成长计划 4.9》存档补丁项目（完整案例见 `references/case-study-meishao49.md`），
同类游戏（4399 包装的 AS2 养成/换装/经营游戏）可直接套用。

## 与 `flash-swf-mod` 的分工

本仓库已有 `.agents/skills/flash-swf-mod/`，它做的是**等长字节级改数值**（无敌版/无限金币：翻 `Subtract↔Add2`、换 int32 常量）。
本技能处理**需要新增/重写逻辑、改界面、加存档**的场景——这类改动无法用等长字节完成，必须走"脚本编辑 + 重新编译 + 逐层回嵌"。
两者可叠加：先用本技能拿到游戏本体，再用 `flash-swf-mod` 的 `patch-swf.js` 做数值改动。

## 适用场景

- 给 Flash 游戏**增加本地存读档**（SharedObject 方案，含多槽位/自由选择）
- 修复游戏里**点不动的按钮 / 失效功能**
- 修改游戏逻辑、数值、界面文案；汉化 swf
- 解包嵌套包装（4399 / 平台壳）拿到游戏本体，或反向回嵌
- 用 Ruffle 自动化测试 Flash 游戏（点击、截图、跨会话存档验证）

## 环境准备

> 路径约定：`<repo>` = 本仓库根目录（本机为 `D:/my/flash-edit`，其他电脑 clone 后按实际位置）。
> 标「本机」的路径是开发机（zhou）示例，**换机器请按实际安装位置改**。

| 组件 | 位置/说明 |
|---|---|
| FFDec（JPEXS） | 本机 `D:/game/test/tools/ffdec/`（26.3.0；`ffdec-cli.jar` 命令行入口）。换机器到 GitHub jindrapetrik/jpexs-decompiler releases 下 zip 解压即用 |
| Java | 本机 `C:/Program Files/Java/jdk1.8.0_102/bin/java.exe`（FFDec 26.3 需 JDK8） |
| Python | 本机托管版 `C:/Users/zhou/.workbuddy/binaries/python/versions/3.13.12/python.exe`（需 `pip install pillow` 做截图分析） |
| Node | 本机托管版 `C:/Users/zhou/.workbuddy/binaries/node/versions/22.22.2-6/node.exe` |
| Ruffle 运行时 | **本项目自带**：`<repo>/src/renderer/public/ruffle/`（`npm install` 后由 `scripts/copy-ruffle.mjs` 复制） |
| playwright-core | **本项目自带**：`<repo>/node_modules/`（驱动系统 Edge：`channel:"msedge"`） |

> 本技能自带 `scripts/`（Python/Node 工具）与 `scripts/harness/`（Ruffle 测试页），可直接复制到工作目录使用。

## 核心工作流（5 阶段）

### 阶段 1 — 侦察与解包
1. `-header` 看版本/尺寸/帧率；判断是否嵌套包装（**体积大 + 主时间轴帧数极少(2~11) + 有 `loadBytes` 特征 → 是包装壳**）。
2. 投影 EXE：`-extract <exe> -o <out.swf> biggest`。
3. 嵌套层：`-export binaryData <outdir> <swf>` 拿到内嵌 SWF（最大那个 `.bin` 就是游戏本体），改后缀 `.swf`；重复直到出现中文变量名的 AS2 本体。
4. 命令细节见 `references/workflow.md`、`references/toolbox-ffdec.md`。

### 阶段 2 — 分析
1. 导出全部脚本：`-export script <outdir> <swf>`（**中文标识符 = 全局变量**，`_locN_` = 局部变量）。
2. `-dumpSWF` 看标签结构（注意其**两档缩进规则**，见 toolbox）；`-swf2xml` 导出完整结构 → 用 `scripts/swf_xml_chain.py` 解析嵌套层级与坐标变换。
3. 定位目标：失效按钮（找 `DefineButton2` 里**没有 `<actions>`** 的）、状态变量（找初始化函数）、界面帧（主时间轴帧号）。

### 阶段 3 — 补丁
- **改已有脚本**：编辑导出的 `.as` → `-importScript <in.swf> <out.swf> <脚本文件夹>`
  （⚠️ **只能替换已存在的脚本，不能新增**；只需放改动过的文件，目录结构保持一致）。
- **给空动作按钮注入功能**：必须走 XML 注入 —— `scripts/harvest_action.py` 采集目标语句字节码，`scripts/inject_action.py` 写进 `<actions/>`。
- **存档系统**：完整范式（状态枚举、延时应用、槽位 UI、反馈文本）见 `references/patching-techniques.md`。

### 阶段 4 — 回嵌与重编译
```
swf2xml 原SWF → 编辑XML → xml2swf → stage1.swf
importScript stage1 → stageF.swf（脚本补丁）
-replace 内层容器 3 stageF        → inner_patched.swf
-replace 外层容器 3 inner_patched → 最终成品.swf
```
`-replace <容器swf> <输出swf> <chid> <新内容文件>`；内嵌资源通常 chid=3（先用 `-export binaryData` 确认编号）。

### 阶段 5 — 实测验证（Ruffle + Playwright）
- 用 `scripts/harness/` 搭本地测试页（index.html + 本项目 Ruffle 运行时 + 8321 端口 http 服务）。
- 点击必须用**轨迹式**（move→等待→down→up）；会话首次点击会被吞；坐标 = 舞台坐标 + 画布偏移。
- 存档验证用 **persistent context** 做跨会话测试。
- 详细方法与全部坑见 `references/testing-with-ruffle.md`。

## 关键陷阱速查

| 陷阱 | 对策 |
|---|---|
| importScript 不能给按钮"新增"动作 | XML 注入 actionBytes（harvest 采集） |
| 帧脚本执行早于同帧显示对象创建 | `setTimeout`/轮询延迟绑定 |
| Ruffle 中"运行时自绘 MC 按钮"点不动（系统性） | **不要**用 `createEmptyMovieClip`+绘图做按钮，改用游戏自带的导出按钮符号/面板 |
| 进入某帧会重置全部状态（游戏自己的初始化） | 读档：`gotoAndStop(目标帧)` 后**延时轮询**再应用数据 |
| 运行时文本在 Ruffle 不可见（设备字体缺失） | TextFormat 用游戏内嵌字体；消息串加小写 ASCII 兜底 |
| 内嵌字体子集缺字形 → 静默丢字 | 消息只写"数字 + 小写字母"，避开大写/括号/连字符 |
| 只存了"当前值"漏了"列表/数组" | 状态里既有标量也有数组（衣柜、商店），需**单独的数组表** |
| 应用存档后 UI 不刷新（显示 undefined） | 应用后**调用游戏自己的 UI 刷新函数**（如 `主面板.更新()`） |
| 回编后外观不恢复（换装游戏） | 显式恢复 `人物.gotoAndStop(年龄阶段)` + `人.gotoAndStop(衣服)` + 背景季帧 |
| Ruffle SharedObject 命名空间带 `[[DYNAMIC]]/N`（每层 loadBytes 加一级） | 同路径下保存/读取一致即可；跨版本测试须同环境 |
| `-dumpSWF` 缩进只有两档（宽5=顶层，宽7=嵌套） | 用 xml + `swf_xml_chain.py` 得到真实嵌套 |

## 资源索引

- `references/workflow.md` — 五阶段完整流程（命令级步骤）
- `references/toolbox-ffdec.md` — FFDec CLI 全命令配方 + XML/dumpSWF 分析技巧
- `references/patching-techniques.md` — AS2/AVM1 补丁技术与存档系统范式
- `references/testing-with-ruffle.md` — Ruffle 自动化测试环境与坐标/字体/点击方法论
- `references/case-study-meishao49.md` — 《美少女成长计划4.9》完整实战案例（具体 chid/坐标/证据）
- `scripts/harvest_action.py` — 采集按钮动作字节码
- `scripts/inject_action.py` — 注入按钮动作到 XML
- `scripts/swf_xml_chain.py` — 解析 XML 嵌套链与坐标变换
- `scripts/harness/` — Ruffle 测试页（index.html）与轨迹点击脚本（run.js）
