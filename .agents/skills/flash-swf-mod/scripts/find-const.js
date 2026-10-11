#!/usr/bin/env node
// find-const.js — list every occurrence of an AVM1 string inside a SWF's action tags,
// with the sprite/frame path and a "receiver" guess (the previous string token in the same tag).
// Works for both ConstantPool entries and inline Push strings, Flash 4 or Flash 5 encoding.
//
// Usage: node find-const.js <file.swf> <string> [--json]
const fs = require('fs');
const zlib = require('zlib');

const [file, needle] = process.argv.slice(2);
if (!file || !needle) { console.error('usage: node find-const.js <file.swf> <string> [--json]'); process.exit(2); }
const asJson = process.argv.includes('--json');

const buf = fs.readFileSync(file);
const sig = buf.slice(0, 3).toString('latin1');
if (sig === 'CWS') var body = zlib.inflateSync(buf.slice(8));
else if (sig === 'ZWS') body = zlib.inflateSync(buf.slice(8));
else if (sig === 'FWS') body = buf.slice(8);
else { console.error('not an SWF (sig=' + sig + ')'); process.exit(1); }

const nb = (body[0] >> 3) & 31;
let p = Math.ceil((5 + 4 * nb) / 8) + 4;      // rect + frameRate(UI16) + frameCount(UI16)

const hits = [];
function isTok(b, i) { return !(b[i] >= 0x20 && b[i] < 0x7f || b[i] >= 0x80); }

function tokenAt(start, end) {
  let s = start;
  while (s < end && (body[s] >= 0x20 && body[s] !== 0)) s++;
  return body.slice(start, s).toString('latin1');
}

// previous null-delimited ASCII token inside the same tag = likely receiver / previous constant
function prevToken(tagStart, off) {
  let a = off - 1;                                   // the null that ends the previous token
  while (a > tagStart && body[a] !== 0) a--;
  let b = a - 1;
  while (b > tagStart && body[b] !== 0) b--;
  const s = body.slice(b + 1, a).toString('latin1');
  return /^[\x20-\x7e]+$/.test(s) && s.length ? s : null;
}

function scanTag(start, len, path, frame) {
  const end = start + len;
  const n = Buffer.from(needle, 'latin1');
  for (let i = start; i + n.length <= end; i++) {
    let ok = true;
    for (let k = 0; k < n.length; k++) if (body[i + k] !== n[k]) { ok = false; break; }
    if (!ok) continue;
    if (i > start && !isTok(body, i - 1)) continue;              // must start a token
    if (i + n.length < end && !isTok(body, i + n.length)) continue; // must end a token
    const after = body[i + n.length] === 0 ? 'pool-or-cstring' : 'raw';
    hits.push({ path, frame, off: i, kind: after, receiver: prevToken(start, i) });
    i += n.length - 1;
  }
}

function walk(start, end, path, frame) {
  let p = start;
  while (p + 2 <= end) {
    const code = body.readUInt16LE(p); p += 2;
    const type = code >> 6;
    let len = code & 0x3f;
    if (len === 0x3f) { len = body.readUInt32LE(p); p += 4; }
    if (p + len > end) return;
    if (type === 12 || type === 59) scanTag(p, len, path, frame);
    if (type === 39) walk(p + 4, p + len, path + '/S' + body.readUInt16LE(p), 1);
    if (type === 1) frame++;
    p += len;
    if (type === 0) return;
  }
}
walk(p, body.length, '', 1);

const receivers = {};
for (const h of hits) { const r = h.receiver || '(none)'; receivers[r] = (receivers[r] || 0) + 1; }

if (asJson) { console.log(JSON.stringify({ file, needle, hits, receivers }, null, 1)); process.exit(0); }

console.log(`${hits.length} occurrence(s) of "${needle}" in ${file}`);
console.log('\nby neighbouring token (the CALLER, i.e. which object the method is applied to):');
for (const [r, c] of Object.entries(receivers).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${r}`);
console.log('\nall sites:');
for (const h of hits) console.log(`  @${String(h.off).padStart(9)}  ${h.path || '(root)'}  frame=${h.frame}  after=${h.kind}  prev="${h.receiver}"`);
console.log('\nNOTE: sites sharing one ConstantPool entry patch together. If two neighbouring tokens');
console.log('imply different meanings (e.g. health bar vs skill bar), a whole-file string rename is WRONG.');
