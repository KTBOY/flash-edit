# 美少女成长计划 4.9（无限金钱版）—— 游戏档案

> 本目录是《美少女成长计划 4.9 版本_无限金钱版》的**专属逆向档案**，
> 集中存放该游戏的逆向分析、补丁工程与成品，供下次继续修改/维护时快速上手。
>
> 通用方法论（不限具体游戏）在项目 Skill
> [`.agents/skills/flash-game-patcher/`](../../.agents/skills/flash-game-patcher/SKILL.md)。

## 一、这是什么

- 4399 平台的经典 **AS2 养成游戏**（换装/养成/多结局），SWF v10、640×480、26fps、主时间轴 11 帧。
- 原版**没有存档功能**，首页「读取记忆」按钮是空的（点了没反应）。
- 本次工作：给游戏**补全本地存读档系统**（SharedObject，3 槽位自由选择），并修复了一系列衍生问题。

## 二、目录结构

```
games/美少女成长计划4.9/
├── README.md                 ← 本文件（总索引）
├── 成品/
│   └── 美少女成长计划4.9版本_无限金钱版(带存档).swf   # 最终成品（原版 + 存档补丁）
├── 分析/
│   ├── 01-游戏结构.md         # 三层包装拆解 + 主时间轴帧地图
│   ├── 02-界面按钮与坐标.md   # 首页按钮 chid 表 + 系统面板 + 槽位坐标
│   ├── 03-状态变量清单.md     # 存档变量表（200 项）+ 事件标志 + 数组表
│   └── 04-存档补丁方案.md     # 补丁设计 + 注入字节码 + 关键坑
└── 补丁/
    ├── scripts_final2/        # 最终补丁脚本（importScript 用，保持目录结构）
    │   ├── frame_1/DoAction.as                    # 完整存档系统（约 6600 字符）
    │   ├── frame_11/DoAction_10.as                # 系统()改_root + 跳过开场
    │   ├── DefineButton2_1013/...                 # 存档标签 → 延迟刷新标题
    │   ├── DefineButton2_1014/...                 # 读档标签 → 延迟刷新标题
    │   └── DefineButton2_158/...                  # 开始记忆 → 先移除首页面板
    ├── 回编管线.md            # 从脚本重建成品的完整命令
    └── 验证记录.md            # Ruffle 实测结果 + 追加修复轮次
```

## 三、快速上手（下次要改这个游戏时）

1. 读 `分析/01-游戏结构.md` 了解三层包装与帧地图；
2. 需要改存档逻辑 → 看 `分析/03-状态变量清单.md`（存哪些）和 `分析/04-存档补丁方案.md`（怎么改）；
3. 需要重新构建 → 按 `补丁/回编管线.md` 的命令跑（脚本已在 `补丁/scripts_final2/`）；
4. 通用命令/坑 → 参考项目 Skill `flash-game-patcher`。

## 四、环境依赖（本机路径）

| 组件 | 路径 |
|---|---|
| FFDec（JPEXS 26.3.0） | `D:/game/test/tools/ffdec/`（`ffdec-cli.jar`） |
| Java | `C:/Program Files/Java/jdk1.8.0_102/bin/java.exe` |
| Python | `C:/Users/zhou/.workbuddy/binaries/python/versions/3.13.12/python.exe` |
| Node | `C:/Users/zhou/.workbuddy/binaries/node/versions/22.22.2-6/node.exe` |
| Ruffle 运行时 | `D:/my/flash-edit/src/renderer/public/ruffle/` |
| playwright-core | `D:/my/flash-edit/node_modules/` |

## 五、重要状态说明

- **原版 SWF（不带存档）已不存**：`D:/game/test` 下仅剩「带存档」成品。
  成品 = 原版 + 存档补丁，如需还原原版，用 FFDec 反向去掉 `补丁/scripts_final2/` 里的补丁即可（或直接用成品当基础）。
- **原版补丁工程**仍完整保留在 `D:/game/test/tools/`（`patch/` 含全部中间 stage SWF、`decompiled/` 含反编译产物与 `l3_full.xml`）。
  本目录只迁入了**最终脚本与成品**，中间产物体积大（数百 MB）未迁移，需要时可回源取。
