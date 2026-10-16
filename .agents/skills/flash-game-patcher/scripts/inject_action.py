#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inject_action.py —— 把一段动作字节码(actionBytes hex)注入 SWF 的 XML（-swf2xml 产物）里某个按钮。

背景：FFDec 的 importScript **只能替换已存在的脚本**，无法给"无动作按钮"新增动作。
唯一可靠的办法是编辑 XML：找到 `<item type="DefineButton2Tag" buttonId="X">` 的 `<actions>`，
把它替换成带 actionBytes 的 BUTTONCONDACTION 块，再用 `-xml2swf` 回编。

用法：
  python inject_action.py <in.xml> <buttonId> <actionBytesHex> <out.xml>

示例：
  python inject_action.py l3_full.xml 159 <hex> l3_patched.xml

说明：
- 命令按钮的 BUTTONCONDACTION 需要 `condOverDownToOverUp="true"`（即 on(release) 语义）。
- 若目标按钮原本已有 <actions>（如已有动作），本脚本会**整体替换**它——这是"精确覆盖"的推荐做法。
- 生成的 XML 用 `-xml2swf` 回编；再 `-export script` 复核应能反编译出 on(release){ ... }。
"""
import re
import sys


def main():
    if len(sys.argv) != 5:
        sys.exit("用法: inject_action.py <in.xml> <buttonId> <actionBytesHex> <out.xml>")
    in_xml, bid, hexs, out_xml = sys.argv[1:5]
    hexs = hexs.strip().lower()
    if not re.fullmatch(r"[0-9a-f]*", hexs):
        sys.exit("actionBytes 必须是纯十六进制串")

    with open(in_xml, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    # 匹配 buttonId="X" 的 DefineButton2Tag，直到它的 </item> 收尾（非贪婪 + 平衡不了嵌套，
    # 因此改为定位该 tag 的起始，再在其范围内替换/插入 <actions>）
    pat = re.compile(
        r'(<item\s+type="DefineButton2Tag"\s+buttonId="%s"[^>]*>)' % re.escape(bid))
    m = pat.search(text)
    if not m:
        sys.exit("找不到 buttonId=%s 的 DefineButton2Tag" % bid)
    start = m.end()

    # 用 <item/</item> token 流做深度计数，定位该按钮 tag 的完整范围。
    # 自闭合 <item .../> 不计入深度（FFDec 里偶见）。
    tok = re.compile(r"<item\b[^>]*?/>|<item\b[^>]*>|</item>")
    depth = 1
    block_end = None
    for m in tok.finditer(text, start):
        g = m.group(0)
        if g == "</item>":
            depth -= 1
            if depth == 0:
                block_end = m.start()
                break
        elif g.endswith("/>"):
            pass                      # 自闭合，不改变深度
        else:
            depth += 1
    if block_end is None:
        sys.exit("buttonId=%s 的标签没有闭合" % bid)
    block = text[start:block_end]

    # 注意：FFDec 的 BUTTONCONDACTION 属性名有历史拼写——`condOverUpToIddle`（双 d），
    # 用错（如 condOverUpToIdle）会让 xml2swf 抛 NoSuchFieldException。此串照抄真实产物。
    action_block = (
        '<actions>\n'
        '        <item type="BUTTONCONDACTION" actionBytes="%s" '
        'condIdleToOverDown="false" condIdleToOverUp="false" condKeyPress="0" '
        'condOutDownToIdle="false" condOutDownToOverDown="false" '
        'condOverDownToIdle="false" condOverDownToOutDown="false" '
        'condOverDownToOverUp="true" condOverUpToIddle="false" '
        'condOverUpToOverDown="false"/>\n'
        '      </actions>' % hexs
    )

    if re.search(r"<actions\s*/>", block):
        # 自闭合空动作 <actions/> -> 替换
        block_new = re.sub(r"<actions\s*/>", action_block, block, count=1)
    elif "<actions>" in block:
        # 已有 actions（含内容）-> 整体替换
        block_new = re.sub(r"<actions>.*?</actions>", action_block, block, count=1, flags=re.S)
    else:
        # 完全没有 actions -> 追加到该 tag 的末尾
        block_new = block + "\n      " + action_block

    out = text[:start] + block_new + text[block_end:]
    with open(out_xml, "w", encoding="utf-8") as f:
        f.write(out)
    print("已注入 buttonId=%s，输出 %s" % (bid, out_xml))


if __name__ == "__main__":
    main()
