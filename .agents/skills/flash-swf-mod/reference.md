# Reference — SWF / AVM1 details

## ffdec CLI (`E:/AI/swfide/ffdec-cli.jar`, run with the system JDK)

```bash
FF="E:/AI/swfide/ffdec-cli.jar"
java -jar $FF -export script /out "<f.swf>"                        # AS1/AS2/AS3 source, one .as per script
java -jar $FF -format script:pcodehex -export script /out "<f.swf>" # same + action HEX (patch patterns)
java -jar $FF -dumpSWF "<f.swf>"                                    # tag list: chid, nm: "instance", raw hex
java -jar $FF -export image /out "<f.swf>"                          # bitmaps (for 汉化 of baked text)
java -jar $FF -export font /out "<f.swf>"                           # embedded fonts as TTF
java -jar $FF -listconfigs                                          # toggle: -config showScriptPosition=1
```
- For SWF version ≤ 5 Chinese titles the source may be mojibake — pass `-charset gbk` (or `cp936`) as a pre-option.
- `SEVERE: Decompilation timeout in: \frame N\DoAction_M` on one huge script is harmless; the export still completes.
- The dump's raw hex lines are the fastest way to confirm an opcode sequence byte-for-byte.

## Container / header math

- Bytes 0–2: `FWS` = uncompressed, `CWS` = zlib, `ZWT` = LZMA. Byte 3 = SWF version. Bytes 4–7 = `FileLength` = **whole uncompressed file** length (8-byte header + body). It can be a few bytes larger than reality — leave the header exactly as found.
- After the 8-byte header: `RECT` (stage), `FrameRate` (UI16, 8.8 fixed), `FrameCount` (UI16).
- Inside the inflated body, the first tag is at `rectBytes + 4` where `rectBytes = ceil((5 + 4*n) / 8)` and `n = body[0] >> 3`. FrameRate is 2 bytes — assuming 3 is the classic off-by-one that makes a tag walk find nothing.
- Tag header: `UI16 (type << 6 | length)`; length `0x3f` means a following `UI32` length. `DefineSprite` (39) body = `UI16 id`, `UI16 frameCount`, then nested tags terminated by `End`.

## Tag IDs that matter

| id | tag | why |
|---|---|---|
| 12 / 59 | `DoAction` / `DoInitAction` | AVM1 script containers — where patches go |
| 72 / 82 | `DoABC` / `DoABC2` | present ⇒ AS3/AVM2, this workflow's opcode table does not apply |
| 87 | `DefineBinaryData` | AS3 sometimes ships `.swf`/assets inside |
| 39 | `DefineSprite` | movie clip; recurse to find per-frame scripts |
| 11 / 33 / 37 | `DefineText` / `DefineText2` / `DefineEditText` | text objects (translation surface) |
| 48 / 75 / 88 | `DefineFont2` / `DefineFont3` / `DefineFontName` | embedded fonts; glyph subsets ⇒ no CJK |
| 6 / 21 / 35 / 20 / 36 | bitmaps | text baked into images ⇒ image editing needed |
| 7 | `DefineButton` / 34 `DefineButton2` | menu buttons, often carry their own pools |

## AVM1 quick opcode table (the useful swaps)

`00` End · `04/05` Next/PrevFrame · `07` Stop · `09` StopSounds · `0a` Add · **`0b` Subtract** · `0c` Multiply · `0d` Divide · `0f` Less · `12` Not · `17` Pop · `1c` GetVariable · `1d` SetVariable · `22/23` Get/SetProperty · `26` Trace · `30` Random · `3c` DefineLocal · `3d` CallFunction · `3e` Return · `47` **Add2** · `48` Less2 · `49` Equals2 · `4e` GetMember · `4f` SetMember · `52` CallMethod · `81` GotoFrame · `87` StoreRegister · `88` ConstantPool · `8b` SetTarget · `8e` DefineFunction2 · `96` Push · `99` Jump · `9a` GetUrl2 · `9b` DefineFunction · `9d` If · `9f` GotoFrame2

Equal-length behaviour flips that work well: `0b`↔`47` (subtract↔add, "cost becomes gain"), `11`↔`10` (or↔and), `0f`↔`67` (less↔greater), `12` (Not) removal, and rewriting a pushed `int32`/`float` constant in place.

## Push constant types

`00` CString · `01` Float(4) · `02` Null · `03` Undefined · `04` Register(1) · `05` Boolean(1) · `06` Double(8) · `07` Integer(4) · `08` **pool string index (1)** · `09` pool index (2)

## Flash 4 vs Flash 5 action encoding

Old portal titles (and anything authored from a legacy FLA, even inside a SWF9 container) use the **Flash 4** forms. Assuming Flash 5 silently desyncs the whole script:

| | Flash 5 | Flash 4 (seen here) |
|---|---|---|
| `Push` (0x96) | `UI8 count` then constants | `UI16 byteLength` then constants |
| `ConstantPool` (0x88) | `UI16 count`, then per string `UI16 len` + bytes | `UI16 byteLength` (**covering the count field**), `UI16 count`, then null-terminated strings |
| `If`/`Jump` (0x9d/0x99) | `SI16 offset` | `SI16 offset` **+ `UI8 skipCount`** |
| pool refs | `08 <idx>` inside Push | same |

Also: `End` (`0x00`) closes *nested* blocks (function bodies, clip-event bodies) — keep scanning past it rather than stopping, or you lose every later site.

## Reading a HUD clip before patching it

In many Flash games health/mana **is the clip's playhead**, not a variable. Dump the clip's own `DoAction` frames (see `barframes`-style walk: recurse `DefineSprite`, count `ShowFrame` to number frames) and look for:
- a *floor* frame that sends the character to its death animation,
- a *ceiling* frame doing `stop(); prevFrame();` (a clamp),
- a frame-1 refill/branch driven by upgrade flags.

Then patch the **consequence** (the death command's target argument) rather than inverting the damage direction. Inverting `prevFrame`→`nextFrame` looks elegant and is a trap: a clip resting on frame 1 that receives `nextFrame` steps into the floor/death frame, which is how "invincibility" turned into instant death on the first hit.

## AS3 / AVM2 titles

`DoABC` present ⇒ strings live in the ABC constant pool (UTF-8, length-prefixed, inside the `DoABC`/`DefineBinaryData` payload) and behaviour is in ABC method bodies. Equal-length string swaps still work for text; logic changes need ABC opcode awareness (`pushbyte`/`pushint`/`add`/`subtract`/`jumpif`). ffdec decompiles AVM2 to readable AS3 — prefer that over hand parsing.

## Assessing "can this be 汉化"

1. Count text objects: `DefineText`/`DefineText2`/`DefineEditText` (top level **and** inside every `DefineSprite`, plus button records).
2. Dump the embedded fonts' glyph counts and `languageCode`. Latin subsets of 20–60 glyphs ⇒ zero CJK coverage, so Chinese needs a re-embedded CJK font subset (ffdec can do this) or device fonts.
3. Check whether the visible copy is in code strings at all: grep the decompiled source. If there is no prose, text is design-time objects.
4. Export the images and look: title/instruction screens baked into bitmaps ⇒ image editing, not text replacement.
5. Vector-outlined text (converted to shapes) is not text — it must be redrawn.
