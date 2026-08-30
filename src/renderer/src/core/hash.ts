/** 计算内容的 SHA-256 十六进制摘要（用于按游戏内容关联修改配置） */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const input = data instanceof Uint8Array ? toPlainArrayBuffer(data) : data
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** URL 场景以字符串摘要作为游戏标识 */
export async function sha256HexOfString(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text))
}

function toPlainArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength)
  new Uint8Array(copy).set(view)
  return copy
}
