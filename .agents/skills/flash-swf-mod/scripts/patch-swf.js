#!/usr/bin/env node
// patch-swf.js — apply EQUAL-LENGTH byte patches to a SWF's action bytecode and repack it.
// Refuses to run unless every pattern hits exactly the expected number of times, so a
// mis-anchored pattern can never silently corrupt the file.
//
// Usage: node patch-swf.js <in.swf> <out.swf> <spec.json>
//
// spec.json:
// {
//   "patches": [
//     { "name": "money -= -> +=", "find": "96 0b 00 0b", "replace": "96 0b 00 47", "expect": 1 },
//     { "name": "death target 13 -> 1", "offsets": [2712212, 2712271], "writeInt32": 1, "expect": 2 },
//     { "name": "rename constant", "find": "prevFrame", "replace": "nextFrame", "expect": 75 }
//   ]
// }
// find/replace accept hex ("96 0b 00") or a quoted latin1 string; offsets are into the
// INFLATED body (what ffdec's pcodehex and find-const.js report).
const fs = require('fs');
const zlib = require('zlib');

const [inFile, outFile, specFile] = process.argv.slice(2);
if (!inFile || !outFile || !specFile) { console.error('usage: node patch-swf.js <in.swf> <out.swf> <spec.json>'); process.exit(2); }

const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const buf = fs.readFileSync(inFile);
const sig = buf.slice(0, 3).toString('latin1');
if (sig !== 'CWS' && sig !== 'FWS' && sig !== 'ZWS') { console.error('unexpected signature: ' + sig); process.exit(1); }
const declared = buf.readUInt32LE(4);
const body = sig === 'FWS' ? buf.slice(8) : zlib.inflateSync(buf.slice(8));

const toBytes = (v) => {
  if (Array.isArray(v)) return Buffer.from(v);
  if (/^[0-9a-fA-F ]+$/.test(v) && v.trim().length % 2 === 0 && /[0-9a-fA-F]{2}/.test(v) && !/[g-zG-Z]/.test(v.replace(/\s/g, ''))) {
    return Buffer.from(v.replace(/\s/g, ''), 'hex');
  }
  return Buffer.from(String(v).replace(/^"|"$/g, ''), 'latin1');
};

function findAll(needle) {
  const res = [];
  for (let i = 0; i + needle.length <= body.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) if (body[i + k] !== needle[k]) { ok = false; break; }
    if (ok) { res.push(i); i += needle.length - 1; }
  }
  return res;
}

const plan = [];
for (const p of spec.patches) {
  const want = p.expect === undefined ? 1 : p.expect;
  if (p.offsets) {
    if (p.offsets.length !== want) { console.error(`[${p.name}] offsets.length ${p.offsets.length} != expect ${want}`); process.exit(1); }
    for (const o of p.offsets) {
      if (o < 0 || o >= body.length) { console.error(`[${p.name}] offset ${o} out of range`); process.exit(1); }
      if (p.assertBytes !== undefined) {
        const want2 = toBytes(p.assertBytes);
        if (!body.slice(o, o + want2.length).equals(want2)) {
          console.error(`[${p.name}] @${o}: expected ${p.assertBytes}, found ${body.slice(o, o + want2.length).toString('hex')}`);
          process.exit(1);
        }
      }
    }
    plan.push({ name: p.name, sites: p.offsets.map(o => ({ off: o })), p });
    if (p.writeInt32 !== undefined) for (const s of plan.at(-1).sites) s.bytes = Buffer.alloc(4), s.bytes.writeInt32LE(p.writeInt32, 0);
    else if (p.bytes !== undefined) for (const s of plan.at(-1).sites) s.bytes = toBytes(p.bytes);
  } else {
    const f = toBytes(p.find), r = toBytes(p.replace);
    if (f.length !== r.length) { console.error(`[${p.name}] NOT equal length (${f.length} vs ${r.length}) — would shift every later offset. Use an offsets+int32 patch instead.`); process.exit(1); }
    const sites = findAll(f);
    if (sites.length !== want) {
      console.error(`[${p.name}] found ${sites.length} occurrence(s) of ${JSON.stringify(p.find)}, expected ${want}`);
      console.error('  offsets: ' + sites.slice(0, 20).join(', ') + (sites.length > 20 ? ' …' : ''));
      console.error('  A shared constant means several unrelated call sites — re-anchor positionally (offsets) before patching.');
      process.exit(1);
    }
    for (const s of sites) s.bytes = r;
    plan.push({ name: p.name, sites, p });
  }
}

let written = 0;
for (const item of plan) for (const s of item.sites) {
  if (!s.bytes) continue;
  s.bytes.copy(body, s.off);
  written++;
}

const header = Buffer.alloc(8);
header.write(sig === 'FWS' ? 'FWS' : 'CWS', 0, 'latin1');
header[3] = buf[3];
header.writeUInt32LE(declared, 4);            // keep the original FileLength exactly as found
const out = sig === 'FWS'
  ? Buffer.concat([header, body])
  : Buffer.concat([header, zlib.deflateSync(body, { level: 6 })]);
fs.writeFileSync(outFile, out);

console.log(`applied ${written} site(s) across ${plan.length} patch rule(s)`);
for (const it of plan) console.log(`  ${String(it.sites.length).padStart(3)}  ${it.name}  @${it.sites.slice(0, 4).map(s => s.off).join(', ')}${it.sites.length > 4 ? ' …' : ''}`);
console.log(`${inFile} (${fs.statSync(inFile).size} B)  ->  ${outFile} (${out.length} B), body ${body.length} B unchanged in length`);
console.log('next: node verify-swf.js ' + inFile + ' ' + outFile);
