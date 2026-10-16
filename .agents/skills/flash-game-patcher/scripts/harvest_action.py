#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
harvest_action.py —— 采集一段 ActionScript 2 语句编译后的 SWF 动作字节码（actionBytes hex）。

原理：FFDec 不能"凭空新增"按钮动作，但可以让它**替一个已有动作的按钮(donor)**重新编译。
做法：把 donor 按钮的动作文件写成我们要的语句 -> importScript -> swf2xml -> 从 XML 里读出
该按钮的 actionBytes。这样拿到的字节码与目标 SWF 的编译环境完全兼容（不要手写字节码）。

用法：
  python harvest_action.py --java <java.exe> --ffdec <ffdec目录> \
      --base game.swf --donor 164 --stmt "_root.读取记忆首页();" --outdir tmp_harvest

参数：
  --java    java 可执行文件（建议 JDK8）
  --ffdec   ffdec 目录（含 ffdec-cli.jar）
  --base    目标游戏 SWF（用它的版本来编字节码）
  --donor   任一**已有 on(release) 动作**的按钮 id（临时借用；可从导出目录
            DefineButton2_<id>/BUTTONCONDACTION on(release).as 里找）
  --stmt    要采集的语句（写裸函数调用最稳，作用域沿链解析到 _root）
  --outdir  临时工作目录（须可写）

输出：stdout 打印一行纯 hex（actionBytes），可直接喂给 inject_action.py。
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
import shutil


def run(cmd, cwd=None):
    """执行外部命令，失败即抛错（回显 stderr 便于定位）。"""
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout or "")
        sys.stderr.write(proc.stderr or "")
        raise SystemExit("命令失败(%d)：%s" % (proc.returncode, " ".join(map(str, cmd))))
    return proc.stdout


def java_jar(java, ffdec):
    return [java, "-jar", os.path.join(ffdec, "ffdec-cli.jar")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--java", required=True)
    ap.add_argument("--ffdec", required=True)
    ap.add_argument("--base", required=True)
    ap.add_argument("--donor", required=True, help="已有 on(release) 动作的按钮 id")
    ap.add_argument("--stmt", required=True, help="要采集的 AS2 语句，如 _root.读取记忆首页();")
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()

    work = os.path.abspath(args.outdir)
    os.makedirs(work, exist_ok=True)
    swf = os.path.join(work, "donor.swf")
    shutil.copyfile(args.base, swf)          # 不碰原文件

    # 1) 先把 donor 的动作导出成目录结构，改写成目标语句
    exp = os.path.join(work, "exp")
    if os.path.isdir(exp):
        shutil.rmtree(exp)
    os.makedirs(exp)
    run(java_jar(args.java, args.ffdec) + ["-export", "script", exp, swf])

    sub = "DefineButton2_%s" % args.donor
    d = None
    for name in os.listdir(exp):
        if name.startswith(sub):
            d = os.path.join(exp, name)
            break
    if d is None:
        raise SystemExit("在导出目录里找不到 %s（donor 可能没有动作）" % sub)

    # donor 的动作文件（形如 "BUTTONCONDACTION on(release).as"）
    asfile = None
    for name in os.listdir(d):
        if name.endswith(".as") and "BUTTONCONDACTION" in name:
            asfile = os.path.join(d, name)
            break
    if asfile is None:
        raise SystemExit("%s 里没有 BUTTONCONDACTION 动作文件" % sub)

    stmt = args.stmt.strip()
    if not stmt.endswith(";"):
        stmt += ";"
    body = "on(release)\n{\n   %s\n}\n" % stmt
    with open(asfile, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(body)

    # 2) importScript 回编 -> swf2xml -> 从 XML 读 actionBytes
    patched = os.path.join(work, "donor_patched.swf")
    run(java_jar(args.java, args.ffdec) + ["-importScript", swf, patched, exp])

    xml = os.path.join(work, "donor.xml")
    run(java_jar(args.java, args.ffdec) + ["-swf2xml", patched, xml])

    with open(xml, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    # 定位 donor 按钮块，取其 <actions> 内第一个 actionBytes
    m = re.search(
        r'buttonId="%s".*?<actions>(.*?)</actions>' % re.escape(args.donor),
        text, re.S)
    if not m:
        raise SystemExit("XML 里找不到 buttonId=%s 的 actions" % args.donor)
    ab = re.search(r'actionBytes="([0-9a-fA-F]*)"', m.group(1))
    if not ab:
        raise SystemExit("该按钮的 actions 里没有 actionBytes")

    print(ab.group(1))


if __name__ == "__main__":
    main()
