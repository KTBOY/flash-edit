# Ruffle 自动化测试手册

用 Ruffle（WASM 网页版）+ Playwright 驱动系统 Edge，实现 Flash 游戏的"点击-截图-断言"自动化，用于验证补丁。

## 一、环境搭建

```bash
REPO="D:/my/flash-edit"          # 本仓库根（Ruffle 运行时与 playwright-core 均来自这里）
SKILL="$REPO/.agents/skills/flash-game-patcher"

# 1. 测试目录结构
mkdir -p <workdir>/ruffle_test/ruffle
cp "$REPO/src/renderer/public/ruffle/"*.* <workdir>/ruffle_test/ruffle/   # Ruffle 运行时（本项目自带）
cp <你的游戏>.swf <workdir>/ruffle_test/game.swf
cp "$SKILL/scripts/harness/index.html" <workdir>/ruffle_test/

# 2. 起本地 HTTP 服务（wasm 加载需要 http，不能用 file://）
cd <workdir>/ruffle_test && python -m http.server 8321 --bind 127.0.0.1

# 3. Playwright（用本项目现成的 playwright-core + 系统 Edge）
NODE_PATH="$REPO/node_modules" node "$SKILL/scripts/harness/run.js" ...
```

index.html 要点：
```html
<script src="ruffle/ruffle.js"></script>
<script>
  RufflePlayer.config = { autoplay:"on", unmuteOverlay:"hidden", letterbox:"on", splashScreen:false };
  const player = RufflePlayer.newest().createPlayer();
  document.getElementById("container").appendChild(player);
  player.ruffle().load("game.swf");
</script>
```
容器宽高设 640x480，页面 viewport 用 700x540（画布水平居中 → **画布偏移 x=30，y=0**）。

## 二、坐标系统（血泪总结）

| 坐标系 | 换算 |
|---|---|
| **SWF 舞台坐标** | FFDec XML 的矩阵值：twips/20 = px |
| **页面坐标（playwright 用）** | `page = stage + (30, 0)`（画布在页面中的偏移） |
| 面板局部坐标 | `局部 = 舞台 - 面板位置`（如面板 attach 于 (55,77) 时，鼠标局部 y = `_root._ymouse - 77`） |

**永远不要靠"看截图估坐标"**（截图会被工具缩放显示，极易错 30~50px）。正确做法（按优先级）：
1. **从 SWF 数据算**：`stage = 容器变换 ∘ 放置矩阵 ∘ 形状 bounds`（用 `swf_xml_chain.py`）
2. **给目标加临时标记实测**：把若干按钮临时改成 `_root.版本.text = "B160";` 之类，然后用**网格扫描**确定每个按钮真实命中区（扫描脚本 + 截图哈希分析）
3. **像素检测**：PIL 在截图里找按钮的特征色/文字像素，取质心
4. **诊断打印**：`_root.onMouseDown/onMouseMove` 写一个可见文本框，实时显示 SWF 收到的鼠标坐标（可立刻发现"页面-舞台偏移"这类问题）

## 三、点击方法论（Ruffle 特有）

### 3.1 轨迹点击（必须）

```js
async function trailClick(page, x, y, fromY) {
  const y0 = fromY == null ? Math.max(40, y - 20) : fromY;
  for (let yy = y0; yy <= y; yy += 6) {            // 模拟真实鼠标轨迹进入
    await page.mouse.move(x, yy);
    await page.waitForTimeout(30);
  }
  await page.mouse.move(x, y);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
}
```

- `page.mouse.click()` 的直接瞬移点击**大概率不触发**（按钮悬停状态未建立）。必须"移动→停顿→按下→抬起"。
- 轨迹从目标上方 20px 开始往下移动最稳。

### 3.2 会话首次点击会被吞

每次新开浏览器（或页面内第一次点击）会被用于聚焦/激活，**不触发任何按钮**。对策：
- 先对空白区域（如 `(60,60)`）做一次轨迹点击"预热"；
- 或对关键目标连点两次（对幂等操作安全：分栏切换、存档覆盖）。

### 3.3 扫描方法论（找命中区）

网格逐点点击 + 每次截图 + **哈希分组**：

```js
for (const x of cols) for (let y = 180; y <= 300; y += 4) {
  await trailClick(page, x, y, y - 20);
  await page.waitForTimeout(...);
  await page.screenshot({ path: `s_${x}_${y}.png` });
}
```
```python
# 分析：按区域哈希分组，不同哈希 = 不同状态（命中不同按钮）
from PIL import Image; import hashlib, glob
for f in sorted(glob.glob("s_*.png")):
    img = Image.open(f).convert("RGB")
    h = hashlib.md5(img.crop((560,470,700,500)).tobytes()).hexdigest()[:6]  # 观察区域
    print(f, h)
```

## 三点五、Ruffle 中「运行时自绘按钮」点不动（系统性）

**症状**：用 `createEmptyMovieClip` + 绘图 API（`beginFill`/`lineTo`）在运行时画出来的"按钮"，
视觉正常、坐标也正确，但 `onRelease` **永远不触发**。用 `attachMovie("某按钮符号")` 也常失败（命中区未随内容建立）。

**根因**：Ruffle 的命中测试基于**图形形状的已渲染 bounds**；AS2 运行时通过绘图 API 产生的内容，
其 `hitArea`/按钮语义在 Ruffle 下不被事件系统采纳（Flash Player 原版则可用）。
这是**系统性差异**，不是脚本写错——不要反复调坐标或改 `onRelease` 写法。

**对策（按推荐度）**：
1. **复用游戏自带的面板/按钮**（最稳）：如果游戏内部已有"系统设置/存档"之类面板，直接
   `_root.attachMovie("系统设置","系统设置",220,{_x:55,_y:77}); _root.系统设置.gotoAndStop(4);`
   ——面板内部的按钮是**作者时按钮记录**，点击可靠。首页读档按钮就用这招挂出系统的读档页。
2. **复用游戏某个导出按钮符号**：`_root.attachMovie("工作名称","我的按钮",深度,{_x,y})`，
   再改它的文本子对象（如 `我的按钮.岗位.text = "X close"`）。比自绘可靠。
3. **不用按钮，用坐标判定**：注入 `_root.处理点击();`（无参），函数内用
   `_root._xmouse`/`_root._ymouse` 减去面板偏移算局部坐标，按 y 区间分发。**完全不依赖命中测试**，最保险。

> 实测教训：首页读档选择面板最初用自绘 MC 按钮 → 点了没反应；改 `attachMovie("工作名称")` → 仍不稳；
> 最终改为**直接挂出游戏自带的"系统设置"面板并切到读档页（gotoAndStop(4)）**，一次成功。

## 四、SharedObject 与持久化测试

- Ruffle 网页版把 SharedObject 存进 **localStorage**，key 形如：
  `域名/文件名/存档名`，**每经过一层 loadBytes 会插入一级 `[[DYNAMIC]]/1`**，例如：
  `127.0.0.1/game.swf/[[DYNAMIC]]/1/[[DYNAMIC]]/1/meishao49_local_save`
- **同一 SWF 路径下保存/读取的命名空间一致**——游戏功能不受影响；但"在 A 环境保存、B 环境读取"的测试要注意命名空间必须一致。
- 跨会话测试：`chromium.launchPersistentContext(userDataDir, {channel:"msedge"})`，两次运行用同一 `userDataDir`（并保证 SWF 文件名/路径相同）。测试完可删除 profile 目录。
- 检查存档是否写入：
  ```js
  const keys = await page.evaluate(() => Object.keys(Object.fromEntries(Object.entries(localStorage))));
  ```

## 五、文字与输入的限制

| 现象 | 原因/对策 |
|---|---|
| 运行时设置的文字（对话框等）看不见 | Ruffle-web 无系统字体，**设备字体文本不可渲染**；改用游戏内嵌字体（见 patching-techniques 3.6） |
| 内嵌字体部分字消失 | 字体子集缺字形，静默丢弃；消息串写"小写 ASCII"兜底 |
| 游戏内"输入名字"打不进字 | 游戏用老 mx FocusManager（Ruffle 报 `Unable to attach 'FocusManager'`），**非补丁问题**；测试时可用补丁给确认按钮加"空名字走默认值"分支绕过 |
| 静态界面文字（DefineText）正常显示 | 它们用内嵌字体，不受影响 |

## 六、常用诊断脚本片段

```js
// 控制台全量捕获（找报错/警告）
page.on("console", m => console.log("[console]", m.text().slice(0, 300)));
page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0, 300)));
```

```python
# 截图局部放大 + 真实坐标刻度（阅读像素级细节的可靠方式）
from PIL import Image, ImageDraw
img = Image.open("shot.png"); crop = img.crop((x0, y0, x1, y1))
crop = crop.resize((crop.width*3, crop.height*3), Image.LANCZOS)
d = ImageDraw.Draw(crop)
for i in range(0, crop.width, 60):
    d.line([(i,0),(i,10)], fill=(255,0,0), width=2); d.text((i+1,11), str(x0+i//3), fill=(255,0,0))
for j in range(0, crop.height, 60):
    d.line([(0,j),(10,j)], fill=(0,120,255), width=2); d.text((12,j+1), str(y0+j//3), fill=(0,120,255))
crop.save("zoom.png")
```

等页面稳定的等待时间：简单 SWF 20~25s，三层嵌套包装（12MB 级）需 **40~45s** 才能到首页。

## 七、测试用例模板（存档功能）

```
[ ] 首页点击读档按钮（无存档）→ 出现"没有存档"提示
[ ] 进入游戏 → 系统 → 存档页 → 点击槽位1 → 出现"保存成功"提示 + 槽位标题更新
[ ] 存档页槽位标题显示 名字/日期/时间
[ ] 提示条 2 秒后**自动消失**（整条文本框 _visible=false，不是只清文字）
[ ] 提示条旁边的 ✕ 关闭按钮可点，点击立即消失
[ ] 槽位2/3 同样可存 → 三槽独立
[ ] 切到读档页 → 槽位标题可见 → **自由选择**任一槽位读取 → 对应存档恢复（不是只能读最新）
[ ] 读档后 HUD 名字**不显示 undefined**（存档应用后调过游戏 UI 刷新函数）
[ ] 换装游戏：存档前换一套衣服 → 读档后**外观帧恢复**（人物阶段帧 + 衣服帧 + 背景季帧）
[ ] 衣柜/商店等**数组类状态**也随存档恢复
[ ] 关浏览器 → 重开 → 首页读档 → 成功进入游戏（跨会话，persistent context）
[ ] 控制台无新增报错
```

> 三槽位 + 自由选择的实现要点：**槽位按钮是同一个 chid 被放置三次**，
> 注入的动作对每个实例相同 → 用**鼠标局部坐标**判槽位：`局部y = _root._ymouse - 面板._y`，
> 按 y 区间（含各自行高）分发到槽位 1/2/3。

