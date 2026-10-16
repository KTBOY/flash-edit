# FFDec（JPEXS Free Flash Decompiler）CLI 全配方

命令格式统一为：`java -jar ffdec-cli.jar [全局选项] <命令> [参数]`。
本文件记录实战验证过的命令与坑。FFDec 版本 26.3.0（Java 8 兼容）。

## 目录

1. [常用命令速查](#常用命令速查)
2. [本技能自带脚本](#本技能自带脚本)
3. [dumpSWF 缩进规则（重要）](#dumpswf-缩进规则重要)
4. [swf2xml / xml2swf 与 XML 结构](#swf2xml--xml2swf-与-xml-结构)
5. [importScript 的替换限制与字节码采集](#importscript-的替换限制)
6. [按钮动作字节码格式](#按钮动作字节码格式)
7. [坐标与矩阵解读](#坐标与矩阵解读)
8. [二进制检查技巧](#二进制检查技巧)

---

## 本技能自带脚本

以下脚本均在 `scripts/`（本技能目录内），可直接复制到工作目录使用：

```bash
PY="C:/Users/zhou/.workbuddy/binaries/python/versions/3.13.12/python.exe"
NODE="C:/Users/zhou/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
JAVA="C:/Program Files/Java/jdk1.8.0_102/bin/java.exe"
FFDEC="D:/game/test/tools/ffdec"
SKILL="D:/my/flash-edit/.agents/skills/flash-game-patcher"

# 1) 采集一段语句的 actionBytes（借用某个已有动作的按钮编译）
"$PY" "$SKILL/scripts/harvest_action.py" --java "$JAVA" --ffdec "$FFDEC" \
    --base game.swf --donor 164 --stmt "_root.读取记忆首页();" --outdir tmp_harvest
# -> 打印纯 hex

# 2) 把 actionBytes 注入 XML 的某个按钮
"$PY" "$SKILL/scripts/inject_action.py" l3_full.xml 159 <hex> l3_patched.xml

# 3) 回编 xml
"$JAVA" -jar "$FFDEC/ffdec-cli.jar" -xml2swf l3_patched.xml stage1.swf

# 4) 解析嵌套链 / 坐标（30MB XML 约 1.7s）
"$PY" "$SKILL/scripts/swf_xml_chain.py" l3_full.xml "buttonId=159"
"$PY" "$SKILL/scripts/swf_xml_chain.py" l3_full.xml "characterId=159"   # 给舞台坐标

# 5) Ruffle + Playwright 自动化测试（见 testing-with-ruffle.md）
NODE_PATH="D:/my/flash-edit/node_modules" "$NODE" "$SKILL/scripts/harness/run.js" \
    --url http://127.0.0.1:8321/index.html --script clicks.json --wait 45000 --outdir _run
```

> 实测注意：`inject_action.py` 注入后用 `-xml2swf` 回编时，**必须 grep 输出里的 `SEVERE`**
> （FFDec 即便遇到属性名错误也会写出一个残缺 swf，不会以非零码退出）。

---

## 常用命令速查

| 命令 | 用途 | 示例 |
|---|---|---|
| `-header <in>` | 读文件头（版本/尺寸/帧数/压缩） | `-header game.swf` |
| `-extract <in> -o <out> biggest` | 从 EXE/ZIP 提取最大 SWF；`-o` 带扩展名=文件 | 见 workflow |
| `-export script <dir> <in>` | 导出全部脚本（.as） | |
| `-export binaryData <dir> <in>` | 导出内嵌二进制（嵌套揭层） | |
| `-export text <dir> <in>` | 导出静态文本（找界面文案） | |
| `-export shape <dir> <in>` | 导出形状（SVG/PNG，看按钮外观） | |
| `-export frame <dir> <in>` | 导出主时间轴每帧图像（看界面） | |
| `-export sprite <dir> <in>` | 导出所有 sprite 图像 | |
| `-dumpSWF <in>` | 标签列表（结构+chid+depth） | 输出重定向到文件再 grep |
| `-dumpAS2 <in>` | AS1/2 脚本清单 | |
| `-swf2xml <in> <out.xml>` | 转 XML（可编辑回编） | ⚠️ 输入在前 |
| `-xml2swf <in.xml> <out.swf>` | XML 回编 SWF | |
| `-importScript <in> <out> <dir>` | 批量导入脚本（替换已存在的） | |
| `-replace <in> <out> <chid> <file> [format]` | 替换 BinaryData/图片/字体等 | chid=3 换内嵌 SWF |
| `-decompress <in> <out>` / `-compress` | 解压/压缩 SWF | 二进制检查前先解压 |
| `-swf2exe / -swf2swc / -doc / -linkReport` | 其他导出 | 少用 |

通用提醒：
- 大多数命令的 `-o`/输出目录**必须已存在**
- 处理 20MB 级 SWF，`-swf2xml` 约 10~30s、`-export script` 数秒
- FFDec 的命令区分方向：`-swf2xml <in> <out>`（输入在前）、`-importScript <in> <out> <dir>`、`-replace <in> <out> ...`

---

## dumpSWF 缩进规则（重要）

`-dumpSWF` 的每一行格式：`文件偏移: <缩进><标签序号>. <标签名> tagId=... len=... <原始字节>`

**缩进只有两档**（不是逐层增加！）：
- **宽度 5**（如 `  208.`、`    0.`、` 1000.`）→ **顶层**（主时间轴/文件级标签）
- **宽度 7**（如 `    325.`、`      0.`）→ **嵌套**（任何 sprite 内部，无法区分嵌套深度）
- 序号：顶层是**全文件连续序号**；进入每个 sprite 重置为 0 开始

因此：dump 适合快速找"顶层帧边界/顶层事件"，**判断嵌套归属必须用 XML**（见下）。

```bash
# 例：列出顶层 ShowFrame（主时间轴帧）
grep -nE '^[0-9a-f]+:( *)(\d+)\. ShowFrame' dump.txt
# 配合 awk 过滤宽度=5 的行（空格数+数字位数==5）
```

## swf2xml / xml2swf 与 XML 结构

XML 是**唯一可靠的完整结构数据源**，也是按钮注入/坐标计算的载体。

关键标签：
```xml
<!-- 资源定义 -->
<item type="DefineSpriteTag" spriteId="1052" frameCount="8"> <subTags>...</subTags> </item>
<item type="DefineButton2Tag" buttonId="159" ...>
  <characters> <item type="BUTTONRECORD" buttonStateUp="true" characterId="156">...</item> ... </characters>
  <actions> <item type="BUTTONCONDACTION" actionBytes="..." condOverDownToOverUp="true" .../> </actions>
</item>
<item type="ExportAssetsTag" ...> <tags><item>210</item></tags> <names><item>FocusManager</item></names> </item>

<!-- 时间轴上的放置 -->
<item type="PlaceObject2Tag" characterId="159" depth="17" placeFlagHasMatrix="true">
  <matrix type="MATRIX" hasScale="true" scaleX="1.1975555" translateX="5537" translateY="4195"/>
</item>
<item type="DoActionTag" actionBytes="0700"/>  <!-- 帧动作，字节码 hex -->
<item type="ShowFrameTag"/>                    <!-- 帧边界 -->
```

XML 中每个动作都以 `actionBytes`（**FFDec 格式的十六进制字节码**）呈现；`xml2swf` 会将其转成 SWF 内真实字节（往返验证：重导出后反编译结果与源一致即为成功）。

**嵌套链 + 坐标变换分析**：用 `scripts/swf_xml_chain.py`：
```bash
python swf_xml_chain.py game.xml "characterId=617 depth=668"
# 输出: 该放置的祖先 sprite 链、每级矩阵(twips)、可据此手算最终舞台坐标
```

**给标签加实例名**（可选技巧）：编辑 PlaceObject 标签加 `name="xxx" placeFlagHasName="true"` —— 之后运行时可 `_root.xxx` 按名访问（比 getInstanceAtDepth 可靠）。

## importScript 的替换限制

- **只能替换目标 SWF 中已存在的脚本**；给无脚本按钮/新帧塞新文件会被静默忽略。
- 提供的目录只需包含**要改的文件**（其余自动保留），但目录层级要与导出结构一致，如：
  ```
  scripts_patch/
    frame_1/DoAction.as                       # 主时间轴第1帧第1个脚本
    frame_11/DoAction_10.as
    DefineButton2_1013/BUTTONCONDACTION on(release).as
  ```
- 编译失败常见原因：语法错误（AS2 的 `==`/`===` 兼容、中文标识符没问题）、编码（用 **UTF-8 无 BOM + CRLF**）、把 `stop()` 之类原样覆盖时的格式细节。
- 验证：对输出 SWF 再 `-export script`，diff 确认。

## 按钮动作字节码格式

`actionBytes` 是**完整 SWF 动作流**（FFDec 直接读写的真实字节），特征：
- 简单动作 = 单字节 opcode，如 `04`=nextFrame、`07`=stop、`00`=End
- 多字节动作 = opcode + **U16 长度** + 载荷：
  - `96 <len:2> <type:1> <data...>`：PUSH（type 0=裸字符串 NUL 结尾、7=int32、8=常数池引用…）
  - `88 <len:2> <count:2> <字符串们>`：常数池
- 一次 `on(release){ 函数(); }` 的典型编译产物（实测）：
  ```
  8815 00 0100 <utf8字符串+00>          常数池(1个: "读取记忆首页")
  960500 0700000000                       push int 0
  960200 0800                             push 常数池[0]
  3d                                      CallFunction
  17                                      Pop（丢弃返回值）
  00                                      End
  ```
- **不要手写**：一律用"采集编译"法（改一个已有按钮的动作→importScript→swf2xml→读 actionBytes），保证格式与目标 SWF 兼容。

### ⚠️ BUTTONCONDACTION 属性名有历史拼写坑

FFDec 的 BUTTONCONDACTION 条件属性里有一个**双 d 拼写**：`condOverUpToIddle`（不是 `condOverUpToIdle`）。
用错会让 `-xml2swf` 抛 `java.lang.NoSuchFieldException: condOverUpToIdle`（**它会继续跑并写出一个残缺 swf，别被骗**——务必 grep 输出里的 `SEVERE`）。

正确的一组属性（照抄，`condOverDownToOverUp="true"` 即 on(release) 语义）：
```xml
<item type="BUTTONCONDACTION" actionBytes="..." condIdleToOverDown="false"
  condIdleToOverUp="false" condKeyPress="0" condOutDownToIdle="false"
  condOutDownToOverDown="false" condOverDownToIdle="false" condOverDownToOutDown="false"
  condOverDownToOverUp="true" condOverUpToIddle="false" condOverUpToOverDown="false"/>
```
（本技能 `scripts/inject_action.py` 已内置正确属性集，直接用它即可。）

## 坐标与矩阵解读

- 矩阵值单位 = **twips（1px = 20 twips）**：`translateX=5537 → 276.85px`
- 舞台坐标计算：`stage = Π(祖先容器矩阵) ∘ 自身放置矩阵 ∘ 形状bounds`
  - 常见按钮命中区 = HitTest 状态图形 bounds（如 1440×472 twips = 72×23.6px）乘放置缩放
  - 若 HitTest 状态未定义，用 Up 状态图形当命中区
- Ruffle 页面像素坐标 = 舞台坐标 + 画布偏移（本案例画布在页面 `(30, 0)`，即 `page = stage + (30,0)`）

## 二进制检查技巧

```bash
# 1. 先解压（CWS→FWS），否则文件里全是压缩流搜不到字符串
java -jar ffdec-cli.jar -decompress game.swf game_uncompressed.swf
# 2. Python 搜 UTF-8 字符串并 dump 前后 30 字节
python - <<'EOF'
target = '读取记忆首页'.encode('utf-8')
data = open('game_uncompressed.swf','rb').read()
i = data.find(target)
print(hex(i), data[max(0,i-30):i].hex(), '|', data[i+len(target):i+len(target)+30].hex())
EOF
```
- 用途：确认注入的字节真的写进了 SWF、对比原版/改版的差异区域、定位定义位置
- 注意 find 到的可能是"常数池/字符串表"而非动作本体——用上下文（前后字节）判断
