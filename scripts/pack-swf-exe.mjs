// 把 SWF 附加到 Flash projector 末尾，生成双击即玩的 EXE
//
//   node scripts/pack-swf-exe.mjs <swf 路径> <输出 exe 路径>
//
// 文件结构（与 src/main/services/exe-pack.service.ts 一致）：
//   [projector.exe] + [swf 字节] + [魔数 56 34 12 FA] + [swf 长度 u32 小端]
// 注意：SWF 运行时按「自身所在目录」解析相对路径，所以游戏若依赖
// mapPic/ music/ monster/ 等外部资源，EXE 必须和这些目录放在一起。
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const FOOTER_MAGIC = [0x56, 0x34, 0x12, 0xfa]
const PROJECTOR = resolve('resources/flash-projector.exe')

const [swfPathArg, exePathArg] = process.argv.slice(2)
if (!swfPathArg || !exePathArg) {
  console.error('用法：node scripts/pack-swf-exe.mjs <swf 路径> <输出 exe 路径>')
  process.exit(1)
}

const projector = readFileSync(PROJECTOR)
const swf = readFileSync(resolve(swfPathArg))
const sig = swf.subarray(0, 3).toString('latin1')
if (!['FWS', 'CWS', 'ZWS'].includes(sig)) {
  console.error(`不是合法 SWF（文件头 ${sig}）`)
  process.exit(1)
}
if (projector[0] !== 0x4d || projector[1] !== 0x5a) {
  console.error('内置 projector 不是 PE 文件，检查 resources/flash-projector.exe')
  process.exit(1)
}

const footer = Buffer.alloc(8)
Buffer.from(FOOTER_MAGIC).copy(footer, 0)
footer.writeUInt32LE(swf.length, 4)

const out = exePathArg.endsWith('.exe') ? resolve(exePathArg) : resolve(exePathArg)
writeFileSync(out, Buffer.concat([projector, swf, footer]))

const built = readFileSync(out)
const tail = built.subarray(built.length - 8)
const okMagic = [...FOOTER_MAGIC].every((v, i) => tail[i] === v)
const okLen = tail.readUInt32LE(4) === swf.length
console.log(
  `已生成 ${out}\n  projector ${projector.length} + swf ${swf.length} + footer 8 = ${statSync(out).size} 字节` +
    `\n  回读校验：魔数 ${okMagic ? 'OK' : 'FAIL'}，长度 ${okLen ? 'OK' : 'FAIL'}`
)
if (!okMagic || !okLen) process.exit(1)
