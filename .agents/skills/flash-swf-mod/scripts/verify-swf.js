#!/usr/bin/env node
// verify-swf.js — prove a patch did only what you meant: compare two SWFs at the
// inflated-body level (runs of changed bytes + the text around each) and re-check the header.
//
// Usage: node verify-swf.js <original.swf> <patched.swf> [--context 12]
const fs = require('fs');
const zlib = require('zlib');

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: node verify-swf.js <original.swf> <patched.swf>'); process.exit(2); }
const ci = process.argv.indexOf('--context');
const CTX = ci > 0 ? Number(process.argv[ci + 1]) : 12;

function load(f) {
  const buf = fs.readFileSync(f);
  const sig = buf.slice(0, 3).toString('latin1');
  if (!['CWS', 'FWS', 'ZWS'].includes(sig)) { console.error(f + ': bad signature ' + sig); process.exit(1); }
  const body = sig === 'FWS' ? buf.slice(8) : zlib.inflateSync(buf.slice(8));
  return { buf, sig, body, declared: buf.readUInt32LE(4) };
}
const A = load(a), B = load(b);

console.log(`original : ${a}\n           sig=${A.sig} ver=${A.buf[3]} declared=${A.declared} file=${A.buf.length} body=${A.body.length}`);
console.log(`patched  : ${b}\n           sig=${B.sig} ver=${B.buf[3]} declared=${B.declared} file=${B.buf.length} body=${B.body.length}`);

let fail = 0;
const check = (ok, msg) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + msg); if (!ok) fail++; };
check(A.body.length === B.body.length, 'inflated body lengths equal (no shifted offsets)');
check(A.declared === B.declared, 'FileLength header preserved');
check(A.sig === B.sig && A.buf[3] === B.buf[3], 'signature + version preserved');
if (A.body.length !== B.body.length) { console.log('\nLENGTH CHANGED — the patch is not equal-length. Abort.'); process.exit(1); }

const runs = [];
for (let i = 0; i < A.body.length; i++) {
  if (A.body[i] !== B.body[i]) {
    const last = runs[runs.length - 1];
    if (last && i === last.end + 1) last.end = i;
    else runs.push({ start: i, end: i });
  }
}
console.log(`\nchanged bytes: ${runs.reduce((n, r) => n + (r.end - r.start + 1), 0)} in ${runs.length} contiguous run(s)`);
const sizes = [...new Set(runs.map(r => r.end - r.start + 1))];
console.log('run sizes: ' + sizes.join(', '));
console.log('\ncontext (before -> after, latin1 with dots for non-printable):');
const dump = (x) => x.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
for (const r of runs.slice(0, 40)) {
  const s = Math.max(0, r.start - CTX), e = Math.min(A.body.length, r.end + 1 + CTX);
  const hex = A.body.slice(r.start, r.end + 1).toString('hex').replace(/../g, '$& ').trim();
  const hex2 = B.body.slice(r.start, r.end + 1).toString('hex').replace(/../g, '$& ').trim();
  console.log(`  @${r.start} (${r.end - r.start + 1}B)  ${hex} -> ${hex2}`);
  console.log(`            ctx ${dump(A.body.slice(s, e))}  ->  ${dump(B.body.slice(s, e))}`);
}
if (runs.length > 40) console.log(`  … ${runs.length - 40} more runs`);

console.log('\nNow confirm semantics independently — decompile both and diff the sources:');
console.log('  FF="E:/AI/swfide/ffdec-cli.jar"');
console.log(`  java -jar $FF -export script /tmp/as_a "${a}" && java -jar $FF -export script /tmp/as_b "${b}"`);
console.log('  diff -r /tmp/as_a /tmp/as_b     # must contain ONLY the intended lines');
process.exit(fail ? 1 : 0);
