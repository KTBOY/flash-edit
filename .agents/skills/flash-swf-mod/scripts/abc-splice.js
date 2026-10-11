/**
 * ABC 常量池文案替换 + SWF 重建。
 *
 * 原理：AVM2 的字符串常量以 [U30 长度][UTF8 字节] 连续存放，代码里按「池下标」引用而非字节偏移，
 * 因此只要保持条目顺序与数量不变，单条字符串可以任意改长改短；
 * 外层 DoABC 标签长度随之更新，整个标签流重排后按 CWS 重新压缩。
 *
 * 用法：node abc-splice.js <in.swf> <out.swf> <map.json>
 *   map.json: [{ "find": "原文", "replace": "译文", "tag": "可选，限定 DoABC 名" }]
 */
const fs = require('fs');
const zlib = require('zlib');

function u30Encode(v) {
  const out = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function readTags(body) {
  const nbits = (body[0] >> 3) & 31;
  let i = 1 + Math.ceil((4 * nbits) / 8) + 4;
  const tags = [];
  while (i < body.length) {
    const hdr = body.readUInt16LE(i);
    const id = hdr >> 6;
    let sz = hdr & 0x3f;
    let h = 2;
    if (sz === 0x3f) { sz = body.readUInt32LE(i + 2); h = 6; }
    tags.push({ id, hdrAt: i, hdrLen: h, start: i + h, len: sz });
    if (id === 0) break;
    i += h + sz;
  }
  return tags;
}

function buildTag(id, payload) {
  if (payload.length < 63) {
    const out = Buffer.alloc(2 + payload.length);
    out.writeUInt16LE((id << 6) | payload.length, 0);
    payload.copy(out, 2);
    return out;
  }
  const out = Buffer.alloc(6 + payload.length);
  out.writeUInt16LE((id << 6) | 0x3f, 0);
  out.writeUInt32LE(payload.length, 2);
  payload.copy(out, 6);
  return out;
}

/** 在 buf 中定位「整条字符串常量」：找到 find 的字节，且紧邻其前的 U30 长度 == 其字节长度 */
function findPoolEntries(buf, findBytes) {
  const hits = [];
  let at = 0;
  while (true) {
    const p = buf.indexOf(findBytes, at);
    if (p < 0) return hits;
    for (let back = 1; back <= 5; back++) {
      const st = p - back;
      if (st < 0) break;
      let v = 0, s = 1, i = st, guard = 0;
      let last = false;
      while (i < buf.length) {
        const y = buf[i];
        v += (y & 0x7f) * s; s *= 128; i++;
        if (!(y & 0x80)) { last = true; break; }
        if (++guard > 5) break;
      }
      if (last && i === p && v === findBytes.length) {
        hits.push({ lenAt: st, strAt: p, strLen: v, fieldLen: back });
        break;
      }
    }
    at = p + 1;
  }
}

function main() {
  const [inFile, outFile, mapFile] = process.argv.slice(2);
  const rules = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const raw = fs.readFileSync(inFile);
  const sig = String.fromCharCode(raw[0], raw[1], raw[2]);
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('未支持的容器: ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.subarray(8)) : raw.subarray(8);
  const declared = body.length + 8;
  const got = raw.readUInt32LE(4);
  if (declared !== got) throw new Error(`头部校验失败 declared=${declared} got=${got}`);

  const tags = readTags(body);
  const abcTags = tags.filter((t) => t.id === 82 || t.id === 72);
  // DoABC 的 name 字段（frame1 / frame2…）用于把替换限定在正确的 ABC 内
  const abcName = new Map();
  for (const t of abcTags) {
    let p = t.start + 4, nm = '';
    while (body[p] !== 0 && p < t.start + t.len) nm += String.fromCharCode(body[p++]);
    abcName.set(t.start, nm);
  }
  const ownerOf = (h) => abcTags.find((t) => h.lenAt >= t.start && h.strAt + h.strLen <= t.start + t.len);
  console.log(`DoABC 标签 ${abcTags.length} 个：`, abcTags.map((t) => `${abcName.get(t.start)}@${t.start}/${t.len}`).join(' '));

  let applied = 0;
  const perTag = new Map(abcTags.map((t) => [t.start, []]));

  for (const rule of rules) {
    const findBytes = Buffer.from(rule.find, 'utf8');
    const repBytes = Buffer.from(rule.replace, 'utf8');
    const all = findPoolEntries(body, findBytes);
    let inAbc = all.map((h) => ({ h, owner: ownerOf(h) })).filter((x) => x.owner);
    if (rule.tag) {
      const scoped = inAbc.filter((x) => abcName.get(x.owner.start) === rule.tag);
      if (scoped.length === 0) { console.log('  !! 指定 ABC 内未命中', rule.tag, JSON.stringify(rule.find)); continue; }
      inAbc = scoped;
    }
    if (rule.dryRun) { console.log('  [dry]', JSON.stringify(rule.find), '命中', all.length, '其中池内', inAbc.length); continue; }
    if (inAbc.length === 0) { console.log('  !! 未命中', JSON.stringify(rule.find)); continue; }
    if (inAbc.length > 1 && !rule.all) {
      console.log('  !! 多处命中，跳过（需加 tag 限定）', JSON.stringify(rule.find), inAbc.map((x) => abcName.get(x.owner.start)).join('+'));
      continue;
    }
    for (const { h, owner } of inAbc) {
      // 替换区间含长度字段本身，故新内容 = 新的 U30 长度 + 新字节
      perTag.get(owner.start).push({ at: h.lenAt, end: h.strAt + h.strLen, repBytes: Buffer.concat([u30Encode(repBytes.length), repBytes]) });
      applied++;
    }
  }

  // 每个 DoABC 标签内部按位置倒序替换，再重建标签
  const pieces = [];
  let cursor = 0;
  for (const t of tags) {
    pieces.push(body.subarray(cursor, t.hdrAt));
    cursor = t.start + t.len;
    if (t.id !== 82 && t.id !== 72) { pieces.push(body.subarray(t.hdrAt, t.start + t.len)); continue; }
    const edits = (perTag.get(t.start) ?? []).sort((a, b) => b.at - a.at);
    let payload = Buffer.from(body.subarray(t.start, t.start + t.len));
    for (const e of edits) {
      const relAt = e.at - t.start, relEnd = e.end - t.start;
      payload = Buffer.concat([payload.subarray(0, relAt), e.repBytes, payload.subarray(relEnd)]);
    }
    pieces.push(buildTag(t.id, payload));
  }
  pieces.push(body.subarray(cursor));
  const newBody = Buffer.concat(pieces);
  const header = Buffer.alloc(8);
  header.write('CWS', 0, 'latin1');
  header[3] = raw[3];
  header.writeUInt32LE(newBody.length + 8, 4);
  const out = Buffer.concat([header, zlib.deflateSync(newBody, { level: 9 })]);
  fs.writeFileSync(outFile, out);
  console.log(`替换 ${applied} 处 | body ${body.length} → ${newBody.length} | 文件 ${raw.length} → ${out.length}`);
  console.log(`写出 ${outFile}`);
}

main();
