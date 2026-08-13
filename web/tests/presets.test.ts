import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const FAKE_RECIPES = {
  acacia_boat: { type: 'minecraft:crafting_shaped', result: { id: 'minecraft:acacia_boat' } },
  bread: { type: 'minecraft:crafting_shapeless', result: { id: 'minecraft:bread' } },
  apple: { type: 'minecraft:smelting', result: { id: 'minecraft:apple' } },
}

function stubFetch(body: string | null, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: body !== null
      ? vi.fn().mockResolvedValue(JSON.parse(body))
      : vi.fn().mockRejectedValue(new Error('not json')),
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchRecipeIds', () => {
  it('returns sorted recipe IDs', async () => {
    stubFetch(JSON.stringify(FAKE_RECIPES))
    const { fetchRecipeIds } = await import('../src/ide/presets')
    const ids = await fetchRecipeIds('1.21')
    expect(ids).toEqual(['acacia_boat', 'apple', 'bread'])
  })

  it('returns [] on network failure (non-2xx)', async () => {
    stubFetch(null, 500)
    const { fetchRecipeIds } = await import('../src/ide/presets')
    expect(await fetchRecipeIds('1.21')).toEqual([])
  })

  it('returns [] on fetch throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { fetchRecipeIds } = await import('../src/ide/presets')
    expect(await fetchRecipeIds('1.21')).toEqual([])
  })

  it('returns [] on non-object JSON', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue('not-an-object'),
    })
    vi.stubGlobal('fetch', fn)
    const { fetchRecipeIds } = await import('../src/ide/presets')
    expect(await fetchRecipeIds('1.21')).toEqual([])
  })

  it('caches so second call does not re-fetch', async () => {
    const fn = stubFetch(JSON.stringify(FAKE_RECIPES))
    const { fetchRecipeIds } = await import('../src/ide/presets')
    await fetchRecipeIds('1.21')
    await fetchRecipeIds('1.21')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fetches separately for different versions', async () => {
    const fn = stubFetch(JSON.stringify(FAKE_RECIPES))
    const { fetchRecipeIds } = await import('../src/ide/presets')
    await fetchRecipeIds('1.21')
    await fetchRecipeIds('1.20')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('fetchRecipePreset', () => {
  it('returns the matching recipe entry', async () => {
    stubFetch(JSON.stringify(FAKE_RECIPES))
    const { fetchRecipePreset } = await import('../src/ide/presets')
    const preset = await fetchRecipePreset('1.21', 'bread')
    expect(preset).toEqual(FAKE_RECIPES.bread)
  })

  it('returns null for unknown ID', async () => {
    stubFetch(JSON.stringify(FAKE_RECIPES))
    const { fetchRecipePreset } = await import('../src/ide/presets')
    expect(await fetchRecipePreset('1.21', 'nonexistent')).toBeNull()
  })

  it('returns null on network failure', async () => {
    stubFetch(null, 500)
    const { fetchRecipePreset } = await import('../src/ide/presets')
    expect(await fetchRecipePreset('1.21', 'bread')).toBeNull()
  })

  it('returns null on fetch throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { fetchRecipePreset } = await import('../src/ide/presets')
    expect(await fetchRecipePreset('1.21', 'bread')).toBeNull()
  })

  it('returns a clone so mutations are isolated', async () => {
    stubFetch(JSON.stringify(FAKE_RECIPES))
    const { fetchRecipePreset } = await import('../src/ide/presets')
    const a = await fetchRecipePreset('1.21', 'bread')
    const b = await fetchRecipePreset('1.21', 'bread')
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})
