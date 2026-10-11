---
name: flash-swf-mod
description: Modify local Flash .swf game files — make 无敌版/无限金币/一击必杀/去广告 variants, locate and change game logic (money, HP, cooldown, spawn, timers), and assess whether a title can be 汉化. Use when the user asks to cheat, patch, decompile, or translate an .swf / Flash game file, or mentions 改金币、无敌版、修改游戏、卡关、汉化 swf, or references ffdec / JPEXS / AVM1 / ActionScript 2 bytecode.
---

# Flash SWF modification

Change game behaviour by patching **equal-length bytes** in the SWF's action bytecode, then prove the result by decompiling before/after. Never edit the original file in place.

## Non-negotiable gates

1. **Always write a new file** (`原名_无敌版.swf`) next to the original. The original is the only rollback.
2. **Every patch must be equal length.** If the change alters size, do it as an int32/opcode byte swap instead — never insert or delete bytes.
3. **Assert the hit count.** A pattern that matches more times than expected means several unrelated systems share a constant. `patch-swf.js` refuses on mismatch — that refusal is the safety net, not a bug to work around.
4. **Verification is part of the task**, not an optional extra: byte diff **and** re-decompile + `diff -r`. Both must show only the intended change.
5. **Say what you did not verify.** These files cannot be played here (no Flash runtime is drivable), so report "static + decompiled verified, not playtested".

## Workflow

```
- [ ] 1. Identify the file: compression, AVM1 vs AVM2, size
- [ ] 2. Export readable source with ffdec
- [ ] 3. Find the mechanic by the game's own vocabulary
- [ ] 4. Get exact bytes with a pcodehex export
- [ ] 5. Enumerate ALL call sites before choosing a strategy
- [ ] 6. Patch with a spec file (equal length + asserted counts)
- [ ] 7. Verify: byte diff, then decompile-and-diff
```

**Step 1 — identify.** `E:/AI/swfide/ffdec-cli.jar` is installed here (run with the system JDK; `ffdec-cli.exe` is the same build). Bytes 0–2 of the file say the container: `CWS`/`ZWT` = zlib, `FWS` = uncompressed. No tag 72/82 (`DoABC`) ⇒ AS1/AS2 (AVM1) ⇒ this workflow applies; a `DoABC` blob ⇒ AS3, needs different handling.

**Step 2 — export source.**
```bash
FF="E:/AI/swfide/ffdec-cli.jar"
java -jar $FF -export script /tmp/as_orig "<game.swf"      # one .as per script
java -jar $FF -dumpSWF "<file.swf" > /tmp/dump.txt          # tags, chids, instance names (nm: "...")
```
A 6000-script title takes ~5 s. A `SEVERE: Decompilation timeout` on one giant `DoAction` is harmless — the file is still written.

Paths handed to ffdec must be **ASCII**: these games live under `%APPDATA%\flash-game-trainer\games\` with Chinese file names, and the launcher reports `Input SWF file does not exist!` for them. Copy to a temp ASCII path, run, copy back.

**Step 3 — find the mechanic by the game's own words.** Chinese titles use Chinese identifiers (`主角.金钱`); English portal titles use terse ones (`lifebar1`, `hearts`, `bloodoff`). Grep the export for the domain word, then read the whole enclosing script. Do not guess from the variable name alone — read what the clip's frames actually do.

**Step 4 — get exact bytes.**
```bash
java -jar $FF -format script:pcodehex -export script /tmp/hex "<file.swf"
```
The p-code dump carries the action hex — that is the patch pattern. No hand-written disassembler needed.

**Step 5 — enumerate every call site (this is where patches go wrong).**
```bash
node scripts/find-const.js "<file.swf>" prevFrame
```
It lists all occurrences with the sprite/frame path and the *neighbouring* token (the receiver), grouping them for you. Sites sharing one `ConstantPool` entry **patch together**. If the same constant serves several systems, a whole-file rename is wrong — see the hazards below.

**Step 6 — patch.** Write a spec, then run it:
```json
{ "patches": [
  { "name": "money -= -> +=", "find": "96 02 00 0b", "replace": "96 02 00 47", "expect": 1 },
  { "name": "death target -> harmless frame", "offsets": [2712212, 2712271], "writeInt32": 1, "expect": 2 }
] }
```
```bash
node scripts/patch-swf.js "<in.swf>" "<out.swf>" spec.json
```
It inflates, validates every rule, applies, re-deflates, keeps the header's `FileLength`, and exits non-zero without writing if anything is off.

**Step 7 — verify.**
```bash
node scripts/verify-swf.js "<in.swf>" "<out.swf>"     # lengths, header, changed runs + hex
java -jar $FF -export script /tmp/as_new "<out.swf>"
diff -r /tmp/as_orig /tmp/as_new                       # must contain ONLY the intended lines
```
Also compare *counts* of the pattern you did **not** touch (e.g. `grep -c skills1.prevFrame`) to prove the blast radius.

## Hazards (each one cost a real bug)

| Hazard | What it looks like | Rule |
|---|---|---|
| **Duplicate pattern** | a constant appears 5× in one script; patching "the" one hits all | anchor by `offsets`, assert `expect` |
| **Shared constant name** | `prevFrame` used by health bar *and* skill/upgrade bar *and* menu buttons | run `find-const.js`, decide per **receiver**, never blanket-rename |
| **Inline vs pool** | some scripts `Push` the string inline instead of via `ConstantPool` | a pool-only scan silently misses sites; grep both |
| **Inferred direction** | flipping `prevFrame`→`nextFrame` "so hits heal" | **prefer neutralising the consequence over inverting a mechanic you inferred.** A bar parked on frame 1 that gets `nextFrame` walked straight into the death frame and killed the player on touch |
| **Frame-band layouts** | health *is* the clip's playhead: floor frame = death, ceiling frame = `stop(); prevFrame();` clamp | read the clip's own frames before touching anything |
| **Unequal-length edit** | renaming to a longer/shorter string | shifts every later offset ⇒ broken file. Refused by the script |
| **FFDec aborts the whole title** | one malformed `DefineEditText` inside a `DefineSprite` throws `EmptyStackException` at `getTextWithStyle` while the `SWF` object is still being built ⇒ `-export script` writes **zero** files, no partial output | not a flag problem — do not re-run with other `-export` arguments. Fall back to `-dumpSWF` plus a raw constant-pool / `DoAction` byte scan |

## Fetching a title and making it show up in the trainer

- `games/` under `%APPDATA%\flash-game-trainer\` is storage, **not** the library. The list reads `data\games.json` records only (`GameService.list`); nothing ever `readdir`s `games/`. A file placed there by `curl` stays invisible, silently.
- Record shape: `{hash, name, size, lastPlayed, source, path}`. `hash` = SHA-256 of the **whole file's bytes** (`sha256Hex` in the renderer, `createHash('sha256')` in the download service — same value), so get it from the bytes, not the path. `lastPlayed` must be an ISO **string** (`list()` sorts with `localeCompare`); 50-record cap, oldest trimmed on the next write.
- Two ways in: let the app register it — 「打开 SWF」or drag onto the player runs `GameLauncher.finalize`, which writes the record and keeps the original absolute path (no copy into `games/`, no directory restriction); or append the record **while the app is closed** and restart — `JsonStore` caches after the first read and overwrites the file from that cache on its next write.
- Manual saves use the pipeline's naming, `清洗后标题_页面ID.swf` (`src/main/services/download/download-manager.ts`), not the CDN filename.
- gamebox.tw: its game page carries exactly one `.swf`, an `nbg1.your-objectstorage.com/gamebox/...` link (the page builds it in `getGameSwfUrl()` → `ensureStorageUrl("/swf/<dir>/<timestamp>.swf")`, prefix declared in the same script). **As of 2026-10-11 the bucket enforces hotlink protection: a plain `GET`/`HEAD` — and any `Range` request — returns 403 with a ~259-byte XML body. It answers only when `Referer` starts with `https://www.gamebox.tw/`** (bare `gamebox.tw` still 403s). With that header a full `GET` works and Range returns 206. The page HTML itself needs no token, plain `curl -A <UA>` gets 200.
- Both sites are built into the app: 侧边栏「网络下载」has one entry per site (own input + own task list). Prefer it over hand-rolled `curl` — the download lands in the configured directory **and** registers in `data\games.json` in the same step. Settings → 下载设置 has 「打开位置」 to open that directory.
- Integrity proof without a player: inflated body length == header `FileLength − 8`, and the main-timeline tag walk must land on the `End` tag at exactly EOF. Both hold for a complete download; either failing means truncation.

## AS3 / AVM2 titles: text lives in the ABC constant pool

`DoABC` (tag 72/82) ⇒ AS3, so the equal-length AVM1 recipe above does not apply. The string pool stores entries as `[U30 length][UTF8 bytes]` — **no kind byte**, deduplicated, referenced by *index*. That means a string may grow or shrink freely; nothing else has to move.

```bash
node scripts/abc-splice.js "<in.swf>" "<out.swf>" map.json
# map.json: [{ "find": "New Game 原文", "replace": "译文", "tag": "frame1" }]
```
It rewrites the DoABC tag length, re-deflates as CWS, fixes `FileLength`, and **refuses any rule matching more than one pool entry**.

- **Always set `tag`** (the DoABC name, usually `frame1` = game logic, later frames = shells). A plain display word is very often also a class name in the other blob: renaming `Class` broke `getDefinitionByName(...) as Class` in the preloader and was caught only by the re-decompile diff.
- **Verification for this class of patch is `diff -rq`, not `verify-swf.js`** (that one asserts equal length and fails by design here). Re-export both builds and require *only* the text-bearing classes to differ, then screenshot the running game.
- Prove the machinery first with a no-op rule: `find == replace` must reproduce the original body byte for byte.

## 汉化 feasibility (check this before promising a translation)

1. Find where text lives: AS3 `TextField` + a string pool ⇒ translatable. Text baked into `DefineBits*` images ⇒ not.
2. **Check the embedded font's code table.** DefineFont2/3 layout: `FontId U16, Flags U16, nameLen U8, name bytes, …`; the code table is UI16 per glyph and is easiest to find where `A B C` appear consecutively. Portal games ship Latin+Cyrillic subsets — **zero CJK glyphs**.
3. **With `embedFonts = true`, Ruffle does not fall back for missing glyphs** — the text renders *blank* (verified on Tentacle Wars: a patched 「更多游戏」 simply vanished from the level wheel). Two exits:
   - cheap: rename the `embedFonts` pool constant to another property of the **same byte length** that the code already assigns harmlessly (e.g. `selectable`). The assignment becomes a no-op, `embedFonts` keeps its default `false`, and text renders with device fonts → Chinese works. Cost: the game's own typography is replaced by a system font.
   - proper: re-embed CJK glyph outlines into the DefineFont3 tags (SWF glyphs are straight-edge polygons) to keep the look.
4. Report the trade-off rather than silently shipping the cheap variant.

## Local conventions

- Output naming: `原名_无敌版.swf`, `原名_无限金币版.swf`, placed in the same `games/` directory.
- The flash-game-trainer records games by **hash + size** in `%APPDATA%/flash-game-trainer/data/games.json`, so a patched file must be re-imported (drag it in) — tell the user.
- Prefer the smallest honest change: 16 bytes that kill one command beats 324 bytes that invert a mechanic.
- For 汉化 (translation) requests, first check where the text lives: `DefineText`/`DefineEditText` with embedded subset fonts means the fonts carry no CJK glyphs and must be re-embedded; text baked into bitmaps means image editing.

## Deeper reference

Encoding details (Flash 4 vs Flash 5 action layout, constant types, tag IDs, header math, AS3 differences, useful opcode swaps): [reference.md](reference.md)
