/**
 * Browser-safe gzip + tar helpers. Extracted from mcdoc-check.ts so the
 * spyglass Externals archive implementation can reuse them.
 */

export async function gunzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(bytes)
  writer.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

export interface TarEntry {
  path: string
  data: Uint8Array<ArrayBuffer>
}

export function parseTar(bytes: Uint8Array<ArrayBuffer>): TarEntry[] {
  const out: TarEntry[] = []
  const decoder = new TextDecoder()
  let off = 0
  while (off + 512 <= bytes.length) {
    const name = decoder.decode(bytes.slice(off, off + 100)).replace(/\0.*$/, '')
    const sizeStr = decoder.decode(bytes.slice(off + 124, off + 136)).replace(/\0.*$/, '')
    const size = parseInt(sizeStr.trim(), 8) || 0
    const typeflag = decoder.decode(bytes.slice(off + 156, off + 157))
    off += 512
    if (!name) break
    if (typeflag === '0' || typeflag === '') {
      out.push({ path: name, data: bytes.slice(off, off + size) })
    }
    off += Math.ceil(size / 512) * 512
  }
  return out
}

/**
 * Builds a gzipped tar in memory. Used by tests to create fixtures that
 * round-trip through gunzipBytes + parseTar.
 */
export async function createTarGz(entries: TarEntry[]): Promise<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder()
  const blocks: Uint8Array<ArrayBuffer>[] = []
  for (const e of entries) {
    const header = new Uint8Array(512)
    header.set(enc.encode(e.path).subarray(0, 100), 0)
    const size = e.data.length
    header.set(enc.encode(size.toString(8).padStart(11, '0') + '\0'), 124)
    header[156] = 0x30 // typeflag '0' = regular file
    header.fill(0x20, 148, 156) // checksum field as spaces before summing
    const sum = header.reduce((a, b) => a + b, 0)
    header.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148)
    blocks.push(header)
    const dataBlock = new Uint8Array(Math.ceil(size / 512) * 512)
    dataBlock.set(e.data)
    blocks.push(dataBlock)
  }
  blocks.push(new Uint8Array(1024)) // two zero blocks mark end of archive
  const tar = new Uint8Array(blocks.reduce((a, b) => a + b.length, 0))
  let off = 0
  for (const b of blocks) {
    tar.set(b, off)
    off += b.length
  }
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(tar)
  writer.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}