# 补丁技术手册（AS2/AVM1 为主）

本文件记录实战验证的补丁模式。AS3（AVM2）游戏可复用"脚本编辑 + importScript"部分，XML 注入思路同样适用（但按钮模型是 SimpleButton/Sprite，注入点是 AS3 类文件）。

## 一、AVM1/AS2 基础知识（打补丁必备）

1. **内存模型**：时间轴脚本里不带 `var` 的赋值、`function 名(){}` 全部挂到 `_root`（影片剪辑对象）。中文标识符很好认——游戏自己的全局变量和函数。
2. **脚本作用域链**：按钮动作里 `gotoAndStop(3)` 实际作用于按钮的父级；`_root` 始终可解析到影片根（含被 loadBytes 加载的 AS2 影片）。
3. **执行时序**（实测 Ruffle/Flash 一致）：
   - **帧动作（DoAction）在**同一帧的 **PlaceObject 显示对象创建之前**执行 → 在同一帧脚本里 `getInstanceAtDepth` 拿不到本帧新放置的对象；
   - 对策：`setTimeout(绑定函数, 100~300)` 或 `setInterval` 轮询，直到对象出现。
4. **`gotoAndStop(N)` 会触发目标帧全部脚本**（包括游戏的初始化/重置逻辑）→ 补丁代码要预判"重置"，详见存档范式。
5. **`attachMovie` 的宿主跟随 `this`**：函数被 `_parent.系统()` 这样调用时，函数内 `attachMovie` 挂在父级而非 `_root`。补丁若依赖 `_root.某面板` 访问，需把调用改为 `_root.attachMovie(...)` 或改用相对访问。
6. **鼠标**：`_root._xmouse/_ymouse` 即全局鼠标（可换算到面板局部坐标，比取按钮实例更可靠）。

## 二、四种补丁手段（按优先级）

| 手段 | 适用 | 工具 |
|---|---|---|
| 改帧脚本 | 追加逻辑、覆盖函数、加全局函数 | importScript |
| 改按钮动作 | 已有动作的按钮（替换/增强） | importScript 或 XML 注入 |
| XML 注入按钮动作 | **无动作按钮**、精确替换 | harvest + inject_action.py |
| XML 改标签 | 加实例名、改矩阵（挪位置/放大） | 手工编辑 XML |

### 修改帧脚本示例（追加全局函数）

```as2
// frame_1/DoAction.as 末尾追加（原有代码保留）
function 我的新函数()
{
   var so = SharedObject.getLocal("my_save");
   // ...
}
```

### 无动作按钮注入（完整流程）

```bash
# ① 采集：目标语句编译进"借用按钮"（选任一有 on(release) 的按钮，如查看排行）
python scripts/harvest_action.py --java <java> --ffdec <ffdec目录> \
    --base game.swf --donor 164 --stmt "_root.我的处理函数();" --outdir tmp
# → 得到 actionBytes hex

# ② 注入：对 -swf2xml 产物操作，把目标按钮的 <actions/> 换成带动作的块
python scripts/inject_action.py game.xml 159 <hex> game_patched.xml

# ③ 回编 + 验证（importScript 补脚本后再次导出确认按钮反编译出 on(release)）
```

### 槽位/多实例按钮的区分技巧

同一按钮定义被放多次（3 个槽位）时，注入的动作对每个实例相同。区分实例：
- **按鼠标坐标**（推荐）：注入 `_root.处理点击();`（无参），函数里 `面板内局部y = _root._ymouse - 面板y偏移`，按 y 区间判槽位。面板用固定坐标 `attachMovie(...,{_x,y})` 挂着最稳。
- 按深度/`this._y`（依赖运行时取实例的稳定性，跨播放器易翻车，不推荐）。

## 三、存档系统完整范式（SharedObject）

针对"游戏进入主玩法帧会重置状态"的情况，验证可行的整体结构：

### 3.1 载体与命名

```as2
var 存档_存储名 = "游戏标识_local_save";   // SharedObject 名（用户机器上按 SWF 路径隔离）
var 存档_数组表 = ["所有衣服", "商店的衣服"];  // 需要整体存的数组（标量兜底遍历存不了它们）
// 槽位: so.data["槽位1..3"], so.data.最后槽位
```

### 3.2 状态枚举（关键步骤）

1. 找到游戏的**状态初始化函数**（如 `初始女儿状态()`），把它定义的变量名全部收集 → 这是"存档变量表"的地基；
2. 补充：初始化函数之外设置的标志（事件标志、开关）、运行时选项（游戏速度）、创建流程数据（名字/生日等）；
3. **务必单独建"数组表"**：状态里不只有标量，还有**数组**（换装游戏的衣柜 `所有衣服`、在售商品 `商店的衣服` 等）。
   `typeof(arr) == "object"`，会绕过下面的标量过滤 → 必须显式遍历并存数组（见 3.3）；
4. 兜底：保存时再遍历 `for (var k in _root)`，把所有 number/string/boolean 类型且不在敏感名单（`_`/`$` 开头、补丁自身变量）的变量一并存入 → 防止遗漏。
   **⚠️ 用户要求"只要数据发生变化都应该可以保存，包括剧情进度"时，兜底遍历是必须的**——它天然覆盖了剧情标志、事件开关这些容易漏的项。

### 3.3 保存

```as2
function 存档_生成()
{
   var d = new Object();
   var i, n, v;
   for (i = 0; i < 存档_变量表.length; i++)
   {
      n = 存档_变量表[i]; v = _root[n];
      if (v != undefined && (typeof(v) == "number" || typeof(v) == "string" || typeof(v) == "boolean"))
      { d[n] = v; }
   }
   for (i = 0; i < 存档_数组表.length; i++)   // ★ 数组整体存（复制成普通 Array）
   {
      v = _root[存档_数组表[i]];
      if (v != undefined && typeof(v) == "object")
      {
         var cp = new Array();
         for (var j = 0; j < v.length; j++) cp.push(v[j]);
         d[存档_数组表[i]] = cp;
      }
   }
   for (var k in _root)   // 兜底：剧情标志/事件开关等一律不漏
   {
      if (k.substr(0,1) == "_" || k.substr(0,1) == "$" || k.substr(0,3) == "存档_") continue;
      var v2 = _root[k]; var t2 = typeof(v2);
      if ((t2 == "number" || t2 == "string" || t2 == "boolean") && d[k] == undefined) d[k] = v2;
   }
   d.__标题 = _root.角色名 + " ...";   // __ 前缀 = 元信息，应用时跳过
   d.__时间 = 时间串;
   return d;
}
function 存档_写入(槽位)
{
   var so = SharedObject.getLocal(存档_存储名);
   so.data["槽位" + 槽位] = 存档_生成();
   so.data.最后槽位 = 槽位;
   so.flush();
}
```

### 3.4 读取（延时应用 —— 最重要的一步）

```as2
function 执行读档(槽位)
{
   var d = 存档_读数据(槽位);
   if (d == null) { 反馈("没有存档"); return; }
   _root.存档_待应用数据 = d;
   if (_root.系统设置 != undefined) _root.系统设置.removeMovieClip();   // 清掉打开的面板
   _root.gotoAndStop(主玩法帧);      // 进入会触发游戏自己的重置
   存档_等待应用();                   // 延时轮询，等初始化完成后覆盖
}
function 存档_等待应用()
{
   var 次数 = 0;
   var 检查 = function ()
   {
      次数++;
      if (_root._currentframe == 主玩法帧 && typeof(_root.更新数值) == "function")
      {
         clearInterval(_root.存档_应用轮询);
         存档_应用(_root.存档_待应用数据);   // for-in 覆盖 + 调用游戏刷新函数
         反馈("读档成功");
      }
      else if (次数 > 60) clearInterval(_root.存档_应用轮询);
   };
   _root.存档_应用轮询 = setInterval(检查, 100);
}
function 存档_应用(d)
{
   for (var k in d)
   {
      if (k.substr(0,2) == "__") continue;   // 跳过元信息
      _root[k] = d[k];
   }
   // ★ 让 UI 反映恢复后的数据。名字/数值要换成游戏自己的刷新函数（grep 游戏源码找）：
   if (typeof(_root.主面板.更新) == "function") _root.主面板.更新();   // ★ HUD 名字/数值——不调就显示 undefined
   _root.游戏时间(); _root.更新数值(); _root.身材函数(); _root.说话情况();
   // ★ 换装游戏：显式恢复外观帧（这些是 _currentframe，不是变量，for-in 覆盖不到）
   if (_root.女儿人物 != undefined && _root.衣服 != undefined)
   {
      if (_root.年 >= 1768) _root.女儿人物.gotoAndStop(3);       // 年龄阶段决定人物帧
      else if (_root.年 >= 1766) _root.女儿人物.gotoAndStop(2);
      else _root.女儿人物.gotoAndStop(1);
      _root.女儿人物.人.gotoAndStop(_root.衣服);                  // 当前穿着决定衣服帧
   }
   if (_root.背景1 != undefined) { /* 按季节恢复 背景1..4 的帧 */ }
}
```

> **两个"显示类"状态必须手动恢复，别指望 for-in**：
> - **HUD 文本**：HUD 文本是在进入房间时由游戏刷新函数写入的，早于存档数据恢复 → 存档应用后**再调一次刷新函数**，否则显示 `undefined`。
> - **外观帧**：人物/衣服/背景用的是 `gotoAndStop(帧)`，`_currentframe` 不是 `_root` 上的变量，兜底遍历存不到 → 显式按年龄阶段/衣服/季节恢复。

### 3.5 UI 挂接

- **槽位按钮**：注入 `_root.处理槽位点击();`，内部：① 用**鼠标局部坐标**判槽位（⚠️ 用 `面板._y` **动态**算，别硬编码挂载偏移——面板挂载点一变就全错）② 用 `面板._currentframe` 判"存档页/读档页"。
  ```as2
  function 处理槽位点击()
  {
     var 面板 = _root.系统设置;
     if (面板 == undefined) return;
     // 首页保护：未开始游戏时只放行读档页（否则拦掉首页读档）
     if (_root.年 == undefined && 面板._currentframe != 4)
     { 存档_反馈("先开始游戏后才能存档 start a game first"); return; }
     var 局部y = _root._ymouse - 面板._y;      // ★ 动态，不硬编码
     var 槽位 = (局部y < 121) ? 1 : ((局部y < 194) ? 2 : 3);
     if (面板._currentframe == 3) 存档_写入(槽位);   // 存档页
     else if (面板._currentframe == 4) 执行读档(槽位); // 读档页（自由选择）
  }
  ```
- **槽位标题**：`面板.createTextField("槽位标题"+i, 500+i, x, y, w, h)` 动态创建文本，轮询到面板切到对应帧后填充（"名字 年龄y 年/月/日 + 时间"）。
  标签按钮（切存档/读档页）的动作用 importScript 追加 `_root.延迟刷新标题();`，保证切页后标题被重建。
- **反馈提示**：`_root.createTextField` 建提示条，**2 秒后整条 `_visible=false` 自动隐藏**。⚠️ 三个坑：① 只清空文字不够（border/background 永久残留，用户看到空框），必须整条 `_visible=false`；② `selectable` 要设 `false`，否则文本框挡住其覆盖区域的点击；③ 用 `setInterval` 计时，并在下次显示时先 `clearInterval` 旧计时器，否则连续点击会提前消失。消息文本用内嵌字体 + 小写 ASCII 兜底。
  ```as2
  存档提示文本.selectable = false;
  存档提示文本._visible = true; 存档提示文本.text = 文本;
  if (_root.存档_提示计时器 != undefined) clearInterval(_root.存档_提示计时器);
  _root.存档_提示计时器 = setInterval(function(){ clearInterval(_root.存档_提示计时器); _root.存档_隐藏提示(); }, 2000);
  ```
- **关闭按钮**：⚠️ **不要用 `createEmptyMovieClip` + 绘图 API 画按钮**——Ruffle 中这类运行时绘制的 MC **不响应 `onRelease`**（系统性，见 testing 文档第三节五）。正确做法：用游戏**自带的导出按钮符号**：
  ```as2
  _root.存档提示关闭 = _root.attachMovie("工作名称", "存档提示关闭", 20012, {_x:440, _y:402});
  _root.存档提示关闭.岗位.text = "X close";     // 改按钮内的文本子对象
  _root.存档提示关闭.onRelease = function(){ _root.存档_隐藏提示(); };
  ```
  深度设为提示文本框 +1 保证在其上层。（若游戏无可用按钮符号，退而用注入的鼠标坐标判定。）
- **首页读档按钮**：注入 `_root.读取记忆首页();`。⚠️ **不要自绘选择面板**——改为挂出游戏自带的系统面板并切到读档页：
  ```as2
  function 读取记忆首页()
  {
     _root.attachMovie("系统设置", "系统设置", 220, {_x:0, _y:0});
     _root.系统设置.gotoAndStop(4);   // 4 = 读档页（帧号按游戏实测）
     _root.延迟刷新标题();             // 等面板切帧后填槽位标题
  }
  ```
  这样槽位按钮是**作者时按钮记录**，点击可靠，且天然支持"自由选择任一槽位"。

### 3.6 文本字体（跨播放器可见性，必做）

Ruffle 等现代模拟器**设备字体文本不可见**，必须用游戏内嵌字体 + 兜底：

```as2
var 格式 = new TextFormat();
格式.font = "游戏内嵌字体名";   // 在 XML 里 grep fontName="..." 找（如 FZCuQian-M17S）
格式.size = 13;
文本field.setNewTextFormat(格式);
```

内嵌字体是**子集**（只含游戏用过的字形），缺失字形会**静默丢字**：
- 消息字符串写成"中文 + 小写 ASCII"混合，如 `"存档成功 save ok  slot1: xxx"` —— 缺字环境自动只显示 ASCII 部分
- 经验证可靠的字符：数字、小写字母、空格、`/`、`:`；**大写字母、连字符、括号等不一定在子集里，避免使用**

## 四、补丁后自检清单

- [ ] 对重编译产物再次 `-export script`，确认修改都在、未误伤其他脚本
- [ ] 对 `-dumpSWF`/XML 确认注入的按钮有了 `<actions>`（非空）
- [ ] 运行原版路径（未改动的操作）逐项回归
- [ ] 存档：保存 → 重启 → 读取 完整回路（含"没有存档"分支）
- [ ] **反馈提示 2 秒自动整条隐藏**（不是只清文字），✕ 按钮可点
- [ ] 读档 HUD **无 undefined**（存档应用后调了游戏刷新函数）
- [ ] 换装游戏：**衣服/外观帧 + 数组类状态**（衣柜/商店）都随存档恢复
- [ ] 首页读档支持**自由选择槽位**（不是只能读最新）
- [ ] 检查控制台无新报错（对比原版运行日志）
