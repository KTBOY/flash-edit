# Flash 游戏修改完整工作流

以命令为单位的分阶段流程。命令变量先设好（`<repo>` = 本仓库根，即 `D:/my/flash-edit`）：

```
FFDEC="java -jar <ffdec目录>/ffdec-cli.jar"     # ffdec 目录如 D:/game/test/tools/ffdec
JAVA="C:/Program Files/Java/jdk1.8.0_102/bin/java.exe"
PY="C:/Users/zhou/.workbuddy/binaries/python/versions/3.13.12/python.exe"
NODE="C:/Users/zhou/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
REPO="D:/my/flash-edit"                          # Ruffle 运行时与 playwright-core 来源
```

---

## 阶段 0 — 侦察

```bash
# 文件头信息：版本号(决定 AS1/2/3)、尺寸、帧率、压缩方式
"$JAVA" -jar ffdec-cli.jar -header game.swf
```

判断依据：
- `version<=9` 且帧数多 → 可能是 AS2（AVM1）；`version>=9` 且帧数少(1~2) → 可能是 AS3（AVM2）
- 12MB 却只有 2~11 帧 → **嵌套包装壳**（真正内容在内嵌资源里）
- 反编译后出现 `loadBytes` / `LoadVars` / 4399 字样 → 平台包装

---

## 阶段 1 — 解包（逐层剥离）

### 1a. 从投影 EXE 提取 SWF

```bash
"$JAVA" -jar ffdec-cli.jar -extract "game.exe" -o "out/queen.swf" biggest
# -o 为文件路径时（配合 biggest/first）；目录需预先存在
```

### 1b. 剥离嵌套层（包装壳 → 真游戏）

```bash
# 列出所有内嵌二进制资源（看 chid 和类名，分清哪个是游戏本体）
"$JAVA" -jar ffdec-cli.jar -export binaryData "decompiled/inner_bin" "wrapper.swf"
# 产出示例: 3_L4399Main_gamefile.bin（12.7MB，最大那个就是游戏本体）
cp 3_L4399Main_gamefile.bin inner_game.swf
"$JAVA" -jar ffdec-cli.jar -header inner_game.swf    # 确认是有效 SWF（CWS/FWS）
```

重复本步骤直到拿到 **AS2/AS3 游戏本体**（脚本出现中文变量名、出现游戏逻辑）。

**典型 4399 三层结构**（本案例实测）：
```
外层 System4399Manager（加载 4399 ctrl 后创建 L4399Main）
 └─ L4399Main_gamefile (chid 3) = 第二层 DressUp_4399_Main
     └─ DressUp_4399_Main_gamefile (chid 3) = 游戏本体 AS2 SWF
```

---

## 阶段 2 — 分析

### 2a. 脚本全量导出

```bash
"$JAVA" -jar ffdec-cli.jar -export script "decompiled/game" "game.swf"
```

要点：
- 中文标识符 = 全局（挂 `_root`）；`_locN_` = 反编译出的局部变量——**靠这个区分状态变量与临时变量**
- `frame_N/DoAction*.as` = 主时间轴各帧脚本（一个帧多个脚本时按 DoAction、DoAction_2… 顺序执行）
- `DefineButton2_<id>/BUTTONCONDACTION on(release).as` = 按钮动作；**目录没有 .as 文件的按钮 = 空动作按钮**

### 2b. 标签/结构分析

```bash
"$JAVA" -jar ffdec-cli.jar -dumpSWF "game.swf" > dump.txt           # 快速找 chid/帧边界
"$JAVA" -jar ffdec-cli.jar -swf2xml "game.swf" "game.xml"            # 完整结构（可编辑、可回编）
```

- dump 的缩进规则见 `toolbox-ffdec.md`；
- XML 是给按钮注入动作、查坐标变换的唯一可靠数据源：
  - `<item type="PlaceObject2Tag" characterId="X" depth="Y">` + `<matrix ...>` = 放置与矩阵
  - `<item type="DefineButton2Tag" buttonId="X">` + `<actions>` = 按钮定义与动作
  - `<item type="ExportAssetsTag">` = 导出名（attachMovie 用的字符串）

### 2c. 定位关键点（以"补存档"为例）

| 要找的东西 | 搜索方法 |
|---|---|
| 无脚本的"读档"按钮 | `grep -rn "读取\|读档" text导出` 定位文本 → 在 XML 找同名/邻近 chid 的按钮 → 无动作即目标 |
| 状态变量全集 | 搜 `function 初始化`/`初始*状态` 类函数；或扫所有赋值目标（中文标识符过滤器，见案例） |
| 界面帧号 | dump 顶层 ShowFrame 序号（宽度5缩进那档）逐帧对应内容 |
| 存档 UI 槽位 | 在面板 sprite 的定义里找对称排列的按钮（深度/坐标规律） |
| 按钮命中区 | 由放置矩阵 + 按钮记录里的 HitTest 状态图形 bounds 计算（1440 twips = 72px 等） |

---

## 阶段 3 — 补丁

### 3a. 修改已有脚本（frame / 按钮 / 函数）

```bash
# 1. 复制导出目录中要改的文件，编辑（保持 CRLF 行尾为安全做法）
# 2. 只保留改动文件的原目录结构 → scripts_patch/
"$JAVA" -jar ffdec-cli.jar -importScript stage1.swf stage2.swf scripts_patch
```

- 帧脚本追加代码：直接在对应 `frame_N/DoAction*.as` 末尾加（注意执行顺序按文件序号）
- 覆盖函数：整段替换 `function 名(){...}`（比如此案例中把 `系统()` 内的 attachMovie 指向 `_root`）
- **无法用此法给"无动作按钮"加动作**（文件不存在 → 被忽略）

### 3b. 给无动作按钮注入功能（XML 注入法）

```bash
# ① 采集字节码（把目标语句编译到某个"借用按钮"上，再从 XML 里读出 actionBytes）
"$PY" scripts/harvest_action.py --java "$JAVA" --ffdec <ffdec目录> \
      --base game.swf --donor <有动作的按钮id> \
      --stmt "_root.读取记忆首页();" --outdir tmp_harvest
# 输出 actionBytes 十六进制串

# ② 注入到目标按钮（对 l3_full.xml 操作）
"$PY" scripts/inject_action.py game.xml <目标按钮id> <actionBytes> game_patched.xml

# ③ 回编
"$JAVA" -jar ffdec-cli.jar -xml2swf game_patched.xml stage1.swf
```

要点：
- `harvest_action.py` 的 `--donor` 任选一个有 `on(release)` 动作的按钮（临时借用，harvest 产物是废件，不影响正式版）
- 目标语句尽量写成**裸函数调用**（`读取记忆首页();`），作用域沿链到 `_root` 可解析
- 无参数版本（`_root.处理槽位点击();`）比传 `this` 更稳：不依赖按钮 `this` 语义，槽位区分改用鼠标坐标
- 已有动作的按钮也可以直接 XML 注入替换（比 importScript 更精确控制）

### 3c. 存档系统范式

见 `patching-techniques.md` 的「存档系统完整范式」——可直接改造复用。

---

## 阶段 4 — 回嵌与重编译

```bash
# 逐层回嵌（从最内层往外替换）:
"$JAVA" -jar ffdec-cli.jar -replace "inner_game.swf" "inner_patched.swf" 3 "stageF.swf"
"$JAVA" -jar ffdec-cli.jar -replace "原版外层.swf" "最终成品.swf" 3 "inner_patched.swf"

# 验证替换正确（提取出来与源文件比对 md5）:
"$JAVA" -jar ffdec-cli.jar -export binaryData "verify" "inner_patched.swf"
md5sum verify/3_*.bin stageF.swf
```

注意事项：
- **永远不要覆盖原版**：`-replace` 的输出写到新文件名
- 中间产物按 stage 编号命名（stage1/swf2xml 后、stageF/脚本后），便于回退
- 最终交付文件放用户工作目录，原版保留供对照
- ⚠️ **中文长文件名会让 `-replace` 报 `I/O error during reading`**（FFDec/JVM 在中文路径 + 长名下的偶发失败）。
  对策：**先把输入/输出都换成纯 ASCII 短名**（`orig_outer.swf` / `inner_t5.swf` / `out.swf`）再跑 `-replace`，
  成功后再把最终产物改回中文名交付。命令内所有路径都用正斜杠或双引号包裹。
- ⚠️ `-replace` 的 `<chid>` 必须与容器里实际的内嵌资源编号一致——用 `-export binaryData` 的产物文件名确认（形如 `3_L4399Main_xxx.bin` ⇒ chid=3）。

---

## 阶段 5 — 实测验证

见 `testing-with-ruffle.md`。最小闭环：

1. 起本地服务：`python -m http.server 8321 --bind 127.0.0.1`（在 harness 目录）
2. 起 Playwright（`channel:"msedge"`）加载 `http://127.0.0.1:8321/index.html`
3. 等待 → 轨迹点击 → 截图 → PIL 分析（哈希分组/局部裁剪）
4. 存档类功能：persistent context 做「保存 → 关浏览器 → 重开 → 读取」的跨会话测试
5. 回归：确认未改动区域行为与原版一致（对照原版 SWF 跑同样脚本）

---

## 交付清单模板

- [ ] 最终成品 SWF（新文件名，含版本/补丁标识）
- [ ] 原版文件未改动
- [ ] 补丁工程归档（脚本补丁、patched XML、各 stage swf）
- [ ] 实测证据（关键界面截图：保存成功、读取成功、跨会话恢复）
- [ ] 说明：改了什么、怎么用、已知限制
