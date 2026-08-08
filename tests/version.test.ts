import { describe, it, expect } from 'vitest'
import { versionNameToDataVersion } from '../src/version.js'
import type { McmetaVersion } from '../src/types.js'

// Fixture: versions from 1.20.4 to 26.1 (Spyglass list starts at 1.14+)
const versions: McmetaVersion[] = [
  { id: '1.14', name: '1.14', type: 'release', stable: true, data_pack_version: 4, data_pack_version_minor: 0, resource_pack_version: 4, resource_pack_version_minor: 0, data_version: 1952, release_time: '2019-04-23T00:00:00Z' },
  { id: '1.14.1', name: '1.14.1', type: 'release', stable: true, data_pack_version: 5, data_pack_version_minor: 0, resource_pack_version: 5, resource_pack_version_minor: 0, data_version: 1957, release_time: '2019-05-17T00:00:00Z' },
  { id: '1.20.4', name: '1.20.4', type: 'release', stable: true, data_pack_version: 41, data_pack_version_minor: 0, resource_pack_version: 34, resource_pack_version_minor: 0, data_version: 3826, release_time: '2023-12-07T00:00:00Z' },
  { id: '1.20.5', name: '1.20.5', type: 'release', stable: true, data_pack_version: 61, data_pack_version_minor: 0, resource_pack_version: 40, resource_pack_version_minor: 0, data_version: 3955, release_time: '2024-04-23T00:00:00Z' },
  { id: '1.21', name: '1.21', type: 'release', stable: true, data_pack_version: 68, data_pack_version_minor: 0, resource_pack_version: 45, resource_pack_version_minor: 0, data_version: 4525, release_time: '2024-06-12T00:00:00Z' },
  { id: '1.21.4', name: '1.21.4', type: 'release', stable: true, data_pack_version: 71, data_pack_version_minor: 0, resource_pack_version: 47, resource_pack_version_minor: 0, data_version: 4620, release_time: '2024-12-03T00:00:00Z' },
  { id: '26.1', name: '26.1', type: 'release', stable: true, data_pack_version: 101, data_pack_version_minor: 0, resource_pack_version: 70, resource_pack_version_minor: 0, data_version: 9000, release_time: '2026-01-01T00:00:00Z' },
]

describe('versionNameToDataVersion — floor semantics', () => {
  it('returns exact match when version is in the list', () => {
    expect(versionNameToDataVersion('1.20.5', versions)).toBe(3955)
    expect(versionNameToDataVersion('26.1', versions)).toBe(9000)
    expect(versionNameToDataVersion('1.14', versions)).toBe(1952)
  })

  it('floors "1.13.2" to the lowest known version (1.14)', () => {
    // 1.13.2 is below all known versions — clamp to lowest
    expect(versionNameToDataVersion('1.13.2', versions)).toBe(1952)
  })

  it('floors "1.13" to the lowest known version (1.14)', () => {
    expect(versionNameToDataVersion('1.13', versions)).toBe(1952)
  })

  it('floors "26.0" to the highest known version <= 26.0', () => {
    // 26.0 < 26.1, so floor to 1.21.4
    expect(versionNameToDataVersion('26.0', versions)).toBe(4620)
  })

  it('returns exact match for "1.21.5" if in list, or floors to highest <=', () => {
    // 1.21.5 is not in our fixture, so floor to 1.21.4
    expect(versionNameToDataVersion('1.21.5', versions)).toBe(4620)
  })

  it('handles suffix (pre-release) version strings', () => {
    // "1.21.4 Pre-release 2" is pre-release of 1.21.4, so it's < 1.21.4
    // Floor should be 1.21
    expect(versionNameToDataVersion('1.21.4 Pre-release 2', versions)).toBe(4525)
  })

  it('returns null for completely unparseable garbage', () => {
    expect(versionNameToDataVersion('abc', versions)).toBeNull()
    expect(versionNameToDataVersion('', versions)).toBeNull()
    expect(versionNameToDataVersion('snapshot-24w01a', versions)).toBeNull()
  })

  it('returns null for empty versions list', () => {
    expect(versionNameToDataVersion('1.20.5', [])).toBeNull()
  })

  it('floors to highest known when requested version is between known versions', () => {
    // 1.20.4 < 1.20.4.2 < 1.20.5 -> floor to 1.20.4
    expect(versionNameToDataVersion('1.20.4.2', versions)).toBe(3826)
  })

  it('floors above all known versions to the highest known', () => {
    // 27.0 is above 26.1 — clamp to highest (26.1)
    expect(versionNameToDataVersion('27.0', versions)).toBe(9000)
  })

  it('matches by id field as well', () => {
    expect(versionNameToDataVersion('1.21', versions)).toBe(4525)
  })
})
