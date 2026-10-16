#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
swf_xml_chain.py —— 解析 FFDec `-swf2xml` 产物，还原某个显示对象的**真实嵌套链**与坐标变换。

为什么需要：`-dumpSWF` 的缩进只有两档（宽5=顶层 / 宽7=任何嵌套），**无法区分嵌套深度**，
所以判断一个按钮/精灵到底放在哪、它的最终舞台坐标是多少，只能靠 XML 的标签嵌套 + 矩阵累乘。

用法：
  python swf_xml_chain.py <game.xml> <查询>
  # 查询写法（任选一种）：
  python swf_xml_chain.py game.xml "buttonId=159"        # 按钮定义
  python swf_xml_chain.py game.xml "spriteId=1052"       # 精灵定义
  python swf_xml_chain.py game.xml "characterId=617"     # 它在时间轴上的放置点

输出：
  - 目标定义标签与**容器祖先链**（只列 DefineSprite / PlaceObject 这类有意义的容器）
  - 目标放置点的每级 MATRIX（twips，20 twips = 1px）与累乘后的**最终舞台坐标(px)**

依赖：仅标准库（正则 + 手写标签栈）。针对 30MB 级 XML 做了单遍扫描优化。
"""
import re
import sys


ITEM_OPEN = re.compile(r'<item\s+type="(\w+)"([^>]*)>')
ATTR = re.compile(r'([\w:]+)="([^"]*)"')

# 只把这些类型视为"有意义的容器祖先"（其余是形状/字体等叶子记录，不入链）
CONTAINER_TYPES = {"DefineSpriteTag", "DefineButton2Tag", "DefineButtonTag", "DefineMorphShapeTag"}
PLACEMENT_TYPES = {"PlaceObject2Tag", "PlaceObject3Tag"}


def attrs_of(s):
    return dict(ATTR.findall(s or ""))


def num(s, default=0.0):
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def matrix_of(block):
    """取一段 XML 里最内层 <matrix .../> 的 scale/translate（缺省=单位矩阵）。"""
    m = re.search(r"<matrix\b([^>]*?)/?>", block)
    if not m:
        return (1.0, 1.0, 0.0, 0.0)
    a = attrs_of(m.group(1))
    return (num(a.get("scaleX"), 1.0), num(a.get("scaleY"), 1.0),
            num(a.get("translateX"), 0.0), num(a.get("translateY"), 0.0))


def stream_items(text):
    """单遍流式产出 (type, attrs, inner_slice, container_ancestors, pos)。

    用**单个正则一次性切出所有 <item ...> / </item> token** 再顺序处理，O(n)——
    避免 text.find 反复回扫造成的 O(n²) 卡死（30MB+ XML 必需）。

    inner_slice = (start, end) 元组（**不复制字符串**）；需要内容时调用方自行切片。
    """
    token_re = re.compile(r'<item\s+type="(\w+)"([^>]*)>|</item>')
    stack = []          # [(type, attrs, inner_start)]
    for m in token_re.finditer(text):
        if m.group(0) == "</item>":
            if stack:
                t, a, st = stack.pop()
                yield (t, a, (st, m.start()), stack, m.start())
            continue
        stack.append((m.group(1), attrs_of(m.group(2)), m.end()))
    while stack:
        t, a, st = stack.pop()
        yield (t, a, (st, len(text)), stack, len(text))


def main():
    if len(sys.argv) != 3:
        sys.exit("用法: swf_xml_chain.py <game.xml> <buttonId=X | spriteId=X | characterId=X>")
    xml_path, query = sys.argv[1], sys.argv[2]
    if "=" not in query:
        sys.exit("查询须形如 key=value")
    key, val = [s.strip() for s in query.split("=", 1)]

    with open(xml_path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    def containers_of(stack):
        return [(t, a, st) for (t, a, st) in stack if t in CONTAINER_TYPES]

    def container_names(stack):
        return [t for (t, a, st) in stack if t in CONTAINER_TYPES]

    def_type = {"buttonId": "DefineButton2Tag", "spriteId": "DefineSpriteTag"}.get(key)
    found_def = False
    found_place = False

    # 单遍扫描，同时找"定义"与"放置点"
    for t, a, (istart, iend), stack, _pos in stream_items(text):
        if def_type and not found_def and a.get(key) == val:
            found_def = True
            inner = text[istart:iend]          # 只在命中时切片
            print("== 定义 %s %s=%s ==" % (t, key, val))
            names = container_names(stack)
            print("  容器祖先链: %s" % (" > ".join(names) if names else "(顶层)"))
            if t == "DefineSpriteTag":
                print("  frameCount=%s" % a.get("frameCount"))
            print("  含 <actions>: %s" % ("是" if "<actions>" in inner else "否（空动作按钮！）"))

        if key == "characterId" and not found_place:
            if t in PLACEMENT_TYPES and a.get("characterId") == val:
                found_place = True
                own = matrix_of(text[istart:iend])
                # 累乘容器祖先的放置矩阵
                x = y = 0.0
                sx = sy = 1.0
                conts = containers_of(stack)
                for ct, ca, cst in conts:
                    seg = text[cst:cst + 500]
                    msx, msy, mtx, mty = matrix_of(seg)
                    x += mtx / 20.0 * sx
                    y += mty / 20.0 * sy
                    sx *= msx
                    sy *= msy
                osx, osy, otx, oty = own
                x += otx / 20.0 * sx
                y += oty / 20.0 * sy
                sx *= osx
                sy *= osy
                print("== 放置点 characterId=%s（%s）==" % (val, t))
                for idx, (at, aa, _) in enumerate(conts):
                    brief = {k: aa[k] for k in ("characterId", "depth", "name") if k in aa}
                    print("  祖先[%d] %s  %s" % (idx, at, brief))
                print("  自身矩阵 twips: translateX=%s translateY=%s scaleX=%s scaleY=%s" % own)
                print("  最终舞台坐标(px): x=%.2f y=%.2f  scale=(%.3f, %.3f)" % (x, y, sx, sy))
                print("  → Playwright 页面坐标 ≈ (%.0f, %.0f)   [舞台 + 画布偏移(30,0)]" % (x + 30, y))

    if not found_def and def_type:
        print("未找到 %s=%s 的定义" % (key, val))
    if key == "characterId" and not found_place:
        print("未找到 characterId=%s 的放置点（可能仅在库中定义、未被直接放置）" % val)


if __name__ == "__main__":
    main()
