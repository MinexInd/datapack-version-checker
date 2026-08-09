import { createTarGz } from '../../src/engine/tar'

/**
 * Builds a tiny gzipped tar in memory: one regular file "data/foo.txt"
 * containing "hi". Round-trips through gunzipBytes + parseTar.
 */
export async function createTarGzFixture(): Promise<Uint8Array> {
  return createTarGz([{ path: 'data/foo.txt', data: new TextEncoder().encode('hi') }])
}