/**
 * oldswf 分片重组（纯逻辑，可完整单测）。
 *
 * oldswf.com 的下载器用 HTTP Range 分片（206）多线程拉取 SWF，
 * 按每个分片的 Content-Range 起始偏移收集，集齐后按偏移排序拼接出完整文件；
 * 若服务器直接返回完整文件（200 / 无 Content-Range），走 setFullBody 捷径。
 */

export interface ContentRange {
  start: number
  end: number
  total: number
}

/** 解析 "bytes 0-131071/1048576" 形式的 Content-Range 头；非法返回 null */
export function parseContentRange(header: string): ContentRange | null {
  const m = header.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  const total = Number(m[3])
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total)) return null
  return { start, end, total }
}

/** SWF 合法文件头：FWS 未压缩 / CWS zlib / ZWS lzma */
export function isSwfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2])
  return magic === 'FWS' || magic === 'CWS' || magic === 'ZWS'
}

export class SwfChunkAssembler {
  /** start 偏移 → 分片字节（同偏移后到覆盖先到） */
  private readonly chunks = new Map<number, Uint8Array>()
  private fullBody: Uint8Array | null = null
  private totalBytes = 0

  /** 收录一个 206 分片；total 来自 Content-Range，取更大者（防镜像间不一致） */
  addChunk(start: number, body: Uint8Array, total?: number): void {
    if (total !== undefined && total > this.totalBytes) this.totalBytes = total
    this.chunks.set(start, body)
  }

  /** 服务器直接返回了完整文件（200 或无 Content-Range） */
  setFullBody(body: Uint8Array): void {
    this.fullBody = body
    if (body.length > this.totalBytes) this.totalBytes = body.length
  }

  get totalSize(): number {
    return this.totalBytes
  }

  /** 已接收字节（分片按偏移去重后求和；重叠分片会高估，仅用于进度展示） */
  get receivedBytes(): number {
    if (this.fullBody) return this.fullBody.length
    let sum = 0
    for (const chunk of this.chunks.values()) sum += chunk.length
    return sum
  }

  get chunkCount(): number {
    return this.fullBody ? 1 : this.chunks.size
  }

  isComplete(): boolean {
    if (this.fullBody) return true
    return this.totalBytes > 0 && this.receivedBytes >= this.totalBytes
  }

  /** 集齐时按偏移排序拼接；未集齐返回 null */
  assemble(): Uint8Array | null {
    if (this.fullBody) return this.fullBody
    if (!this.isComplete()) return null
    const ordered = [...this.chunks.entries()].sort((a, b) => a[0] - b[0])
    let sum = 0
    for (const [, chunk] of ordered) sum += chunk.length
    const out = new Uint8Array(sum)
    let offset = 0
    for (const [, chunk] of ordered) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}
