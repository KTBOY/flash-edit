# Flash 游戏逆向与改造

对经典 Flash 游戏（`.swf` / Flash 打包 `.exe`）做 **解包 → 分析 → 补丁 → 重编译 → 实测** 的方法论。
本文是**可公用知识**（不依赖具体游戏），配套的可执行工具与完整案例在项目 Skill
[`.agents/skills/flash-game-patcher/`](../.agents/skills/flash-game-patcher/SKILL.md) 里。

> 本仓库的 Skill 面板（侧边栏「项目 Skill」）会列出 `.agents/skills/*/SKILL.md`，
> 选中 `flash-game-patcher` 即可看到正文与目录路径。

## 一、两类改造的分工

| 类型 | 特征 | 手段 | 对应 Skill |
|---|---|---|---|
| **等长字节改数值** | 只改常量/翻运算符（无限金币、无敌、去广告） | 在动作字节里**等长替换** | `flash-swf-mod` |
| **新增/重写逻辑** | 加存档、修失效按钮、改界面、汉化 | 反编译脚本 → 编辑 → `importScript` → 逐层回嵌 | `flash-game-patcher`（本文） |

需要"加功能"时只能走第二类：Flash 的动作字节里**新增**指令会让后续偏移全变，等长替换做不到。

## 二、五阶段流水线

```
① 侦察    -header 看版本/尺寸/帧率；体积大 + 主时间轴帧数极少(2~11) ⇒ 平台包装壳
② 解包    -export binaryData 逐层剥离（最大那个 .bin 就是本体）；投影 EXE 用 -extract ... biggest
③ 分析    -export script 导出全部 .as（中文标识符 = 全局变量）；-swf2xml 拿完整结构
④ 补丁    改脚本用 -importScript（只能替换已存在脚本）；
          无动作按钮用 XML 注入（harvest 采集字节码 → inject_action 写入 <actions>）
⑤ 回嵌    -replace <容器> <输出> <chid> <新内容>，从最内层往外逐层替换
⑥ 实测    Ruffle(WASM) + Playwright：轨迹点击 / 截图 / persistent context 跨会话存档验证
```

## 三、必背事实（每条都来自实战踩坑）

### 容器与结构
- 文件头前 3 字节：`FWS` 未压缩 / `CWS` zlib / `ZWT` LZMA；第 4 字节 = SWF 版本。
  **有 `DoABC`(tag 72/82) ⇒ AS3/AVM2**，本文的 AVM1 字节级配方不适用。
- **12MB 却只有 2~11 帧** = 嵌套包装壳（4399 常见三层）。真游戏在内嵌 `DefineBinaryData` 里。
- `-dumpSWF` 的缩进只有**两档**（宽 5 = 顶层，宽 7 = 任何嵌套），**区分嵌套深度必须用 XML**。

### 脚本与补丁
- `-importScript` **只能替换目标 SWF 中已存在的脚本**；给无脚本按钮塞新文件会被静默忽略。
- 给"无动作按钮"加功能只能**编辑 XML 的 `<actions>`**（`-swf2xml` → 改 → `-xml2swf`）。
- 手写动作字节码不可行 —— 用**"借用编译"法**：把目标语句写进某个已有动作的按钮，
  `-importScript` 回编后从 XML 读出 `actionBytes`（本技能 `harvest_action.py` 自动化了这一步）。
- ⚠️ FFDec 的 `BUTTONCONDACTION` 有一个**双 d 拼写** `condOverUpToIddle`；属性名写错会让
  `-xml2swf` 抛 `NoSuchFieldException`，**但仍会写出一个残缺 swf 且不报非零退出码** —— 必须 grep 输出里的 `SEVERE`。

### 运行时（AS2）
- **帧动作在**同帧的 **PlaceObject 显示对象创建之前**执行 → 同帧脚本里 `getInstanceAtDepth` 拿不到本帧新放置的对象。
- `gotoAndStop(N)` 会触发目标帧的**全部脚本**（包括游戏自己的状态重置）→ 读档必须"先跳帧、再延时覆盖"。
- 不带 `var` 的赋值、`function 名(){}` 全部挂到 `_root`（这就是为什么中文全局变量那么多）。

### 跨文件名的坑
- FFDec 处理**中文长文件名**时 `-replace` 可能报 `I/O error during reading`；
  对策：中间步骤一律用**纯 ASCII 短名**，最后再把成品改回中文名交付。

## 四、存档系统（最常被要求的功能）

完整范式（状态枚举 + 数组表 + 延时应用 + 槽位 UI）见
[`patching-techniques.md`](../.agents/skills/flash-game-patcher/references/patching-techniques.md)，
要点：

1. **找到游戏的状态初始化函数**（如 `初始女儿状态()`），收集它定义的全部变量 → 存档变量表；
   再补事件标志 / 运行时选项 / 创建流程数据；最后用 `for (var k in _root)` **兜底遍历**（剧情进度靠它兜住）。
2. **数组类状态要单独存**：`typeof(arr) == "object"` 会绕过标量过滤，
   换装游戏的衣柜 `所有衣服`、商店在售 `商店的衣服` 都会漏 → 建独立的"数组表"。
3. **读档用延时轮询**：`gotoAndStop(主玩法帧)` → `setInterval` 等游戏初始化完成 → 再 `for-in` 覆盖。
4. **应用后必须调用游戏自己的 UI 刷新函数**（如 `_root.主面板.更新()`），否则 HUD 显示 `undefined`。
5. **外观帧要显式恢复**：人物/衣服/背景用的是 `gotoAndStop(帧)`，`_currentframe` 不是 `_root` 变量，兜底遍历存不到
   → 按年龄阶段 / 衣服 / 季节显式恢复。
6. **多槽位自由选择**：槽位按钮常是同一 chid 被放置多次、注入动作对每个实例相同
   → 用**鼠标局部坐标** `局部y = _root._ymouse - 面板._y` 判槽位（动态算，别硬编码挂载偏移）。

## 五、Ruffle 测试的关键约束

- **点击必须"轨迹式"**（move→停顿→down→up）；`page.mouse.click()` 的瞬移点击在 Ruffle 中大概率不触发。
- **会话首次点击会被吞**（用于聚焦）→ 先对空白区预热一次，或对幂等目标连点两次。
- **坐标换算**：页面坐标 = 舞台坐标 + 画布偏移（本仓库 harness 偏移 `(30, 0)`）；舞台坐标从 XML 矩阵算（20 twips = 1px）。
- ⚠️ **Ruffle 中"运行时自绘 MC 按钮"不响应点击（系统性）** →
  不要用 `createEmptyMovieClip` + 绘图做按钮；改用**游戏自带的按钮符号/面板**，
  或干脆用鼠标坐标判定（注入无参函数 `_root.处理点击();`）。
- **设备字体文本在 Ruffle 不可见** → 运行时文本用游戏内嵌字体；内嵌字体是子集，
  消息串写"中文 + 小写 ASCII"兜底（大写字母/括号/连字符不一定在子集里）。
- SharedObject 存进 localStorage，key 每经过一层 `loadBytes` 加一级 `[[DYNAMIC]]/1`；
  跨会话测试用 `launchPersistentContext` 并保持 SWF 路径一致。

## 六、交付与回归

- **永远不覆盖原版**：所有产物写新文件名（`原名_无敌版.swf` / `原名(带存档).swf`）。
- 中间产物按 stage 编号命名（`stage1.swf` / `stageF.swf` / `inner_patched.swf`），便于回退与 md5 校验。
- 回归清单：重编译后再 `-export script` 对比 diff（只有预期改动）；原版路径逐项回归；控制台无新增报错。
