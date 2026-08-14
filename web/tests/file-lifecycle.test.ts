import { describe, it, expect } from 'vitest'
import { findReferencesTo, isPathTraversal, validateFileName } from '../src/ide/file-lifecycle'

describe('validateFileName', () => {
  it('rejects empty', () => {
    expect(validateFileName('')).not.toBeNull()
  })

  it('rejects slashes and backslashes', () => {
    expect(validateFileName('a/b')).not.toBeNull()
    expect(validateFileName('a\\b')).not.toBeNull()
  })

  it('rejects .. segments', () => {
    expect(validateFileName('a..b')).not.toBeNull()
    expect(validateFileName('../etc/passwd')).not.toBeNull()
  })

  it('rejects control characters', () => {
    expect(validateFileName('a\tb')).not.toBeNull()
    expect(validateFileName('a\nb')).not.toBeNull()
  })

  it('rejects leading/trailing whitespace', () => {
    expect(validateFileName(' a')).not.toBeNull()
    expect(validateFileName('a ')).not.toBeNull()
  })

  it('rejects names ending in /', () => {
    expect(validateFileName('foo/')).not.toBeNull()
  })

  it('accepts normal names', () => {
    expect(validateFileName('foo')).toBeNull()
    expect(validateFileName('foo.mcfunction')).toBeNull()
    expect(validateFileName('my-file_v2.json')).toBeNull()
  })
})

describe('isPathTraversal', () => {
  it('rejects absolute paths', () => {
    expect(isPathTraversal('/etc/passwd')).toBe(true)
    expect(isPathTraversal('\\windows\\system32')).toBe(true)
  })

  it('rejects .. segments', () => {
    expect(isPathTraversal('data/../data/foo')).toBe(true)
    expect(isPathTraversal('foo/../../bar')).toBe(true)
  })

  it('accepts normal relative paths', () => {
    expect(isPathTraversal('data/foo/functions/bar.mcfunction')).toBe(false)
    expect(isPathTraversal('pack.mcmeta')).toBe(false)
  })
})

describe('findReferencesTo', () => {
  const files: Record<string, string> = {
    'data/foo/functions/bar.mcfunction': 'say hello\n# foo:bar\ntag @s add foo:bar',
    'data/foo/advancements/baz.json': '{"criteria":{"a":{"trigger":"minecraft:impossible"}}}',
    'data/foo/loot_tables/items.json': '{"pools":[{"rolls":1,"entries":[{"type":"minecraft:item","name":"foo:bar"}]}]}',
    'data/foo/functions/other.mcfunction': 'function foo:other\n#foo:functions/bar',
  }

  it('finds function id references', () => {
    const refs = findReferencesTo('data/foo/functions/bar.mcfunction', files)
    const hitFiles = [...new Set(refs.map(r => r.file))]
    expect(hitFiles).toContain('data/foo/functions/other.mcfunction')
    expect(hitFiles).toContain('data/foo/loot_tables/items.json')
  })

  it('does not match the file itself', () => {
    const refs = findReferencesTo('data/foo/functions/bar.mcfunction', files)
    expect(refs.some(r => r.file === 'data/foo/functions/bar.mcfunction')).toBe(false)
  })

  it('returns line numbers and snippets', () => {
    const refs = findReferencesTo('data/foo/functions/bar.mcfunction', files)
    const line2 = refs.find(r => r.line === 2 && r.file === 'data/foo/functions/other.mcfunction')
    expect(line2).toBeDefined()
    expect(line2!.snippet).toContain('foo:functions/bar')
  })

  it('returns empty for non-data paths', () => {
    expect(findReferencesTo('pack.mcmeta', files)).toHaveLength(0)
  })
})
