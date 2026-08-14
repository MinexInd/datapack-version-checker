import { describe, it, expect } from 'vitest'
import { toFixPreviewV2, type FixPreviewLike, type FixPreviewV2 } from '../../src/fix-preview'
import { applyFixPreview } from '../../src/fix-apply'
import { computeLineDiff } from '../src/ide/fix-diff'

describe('toFixPreviewV2', () => {
  it('maps legacy FixPreview to FixPreviewV2 with before/after, reason, confidence, and skipped files', () => {
    const files: Record<string, string> = {
      'pack.mcmeta': '{\n  "pack": {\n    "pack_format": 15\n  }\n}',
      'data/demo/functions/main.mcfunction': 'execute if entity @s run say hello\nexecute if score @s obj matches 1.. run say test',
      'data/demo/predicates/test.json': '{\n  "condition": "minecraft:entity_properties"\n}',
    }

    const legacyPreview: FixPreviewLike = {
      results: [
        {
          file: 'pack.mcmeta',
          patches: 1,
          details: ['Updated pack_format to 61 for 1.21.4'],
        },
        {
          file: 'data/demo/functions/main.mcfunction',
          patches: 1,
          details: ['main.mcfunction:2: execute command syntax updated'],
        },
        {
          file: 'data/demo/predicates/test.json',
          patches: 1,
          details: ['Predicate field rename for 1.21.4'],
        },
      ],
      plan: {
        sourceVersion: '1.20.2',
        targetVersion: '1.21.4',
        direction: 'forward',
        rewrites: [
          {
            id: 'execute-syntax',
            description: 'Execute command syntax updated',
            count: 1,
            files: ['data/demo/functions/main.mcfunction'],
          },
        ],
        jsonFixes: [
          {
            type: 'predicate_field_rename',
            count: 1,
            files: ['data/demo/predicates/test.json'],
          },
        ],
        manualAttention: [],
        skippedFiles: [
          {
            file: 'data/demo/dialog/intro.json',
            registry: 'dialog',
            reason: 'Dialog registry not supported in target version',
          },
        ],
        summary: {
          totalFilesToPatch: 3,
          commandRewrites: 1,
          jsonFixes: 1,
          manualAttention: 0,
          skippedFiles: 1,
          mcdocRemovals: 0,
          packMcmetaUpdate: true,
        },
      },
      summary: {
        filesFixed: 3,
        totalPatches: 3,
        errors: [],
      },
      outputFiles: {
        'pack.mcmeta': '{\n  "pack": {\n    "pack_format": 61\n  }\n}',
        'data/demo/functions/main.mcfunction': 'execute if entity @s run say hello\nexecute if score @s obj matches 1.. run say updated',
        'data/demo/predicates/test.json': '{\n  "condition": "minecraft:entity_properties_renamed"\n}',
      },
    }

    const v2 = toFixPreviewV2(legacyPreview, files)

    expect(v2.version).toBe('1.21.4')
    expect(v2.summary).toContain('3 files changed')
    expect(v2.summary).toContain('1.21.4')

    // Check skipped files
    expect(v2.skipped).toHaveLength(1)
    expect(v2.skipped[0].file).toBe('data/demo/dialog/intro.json')
    expect(v2.skipped[0].reason).toContain('Dialog registry not supported')

    // Find each file change
    const mcmetaChange = v2.changes.find(c => c.file === 'pack.mcmeta')
    expect(mcmetaChange).toBeDefined()
    expect(mcmetaChange?.before).toBe(files['pack.mcmeta'])
    expect(mcmetaChange?.after).toBe(legacyPreview.outputFiles!['pack.mcmeta'])
    expect(mcmetaChange?.confidence).toBe('high')
    expect(mcmetaChange?.reason).toContain('pack_format')

    const mcfunctionChange = v2.changes.find(c => c.file === 'data/demo/functions/main.mcfunction')
    expect(mcfunctionChange).toBeDefined()
    expect(mcfunctionChange?.before).toBe(files['data/demo/functions/main.mcfunction'])
    expect(mcfunctionChange?.after).toBe(legacyPreview.outputFiles!['data/demo/functions/main.mcfunction'])
    expect(mcfunctionChange?.confidence).toBe('medium')
    expect(mcfunctionChange?.reason).toContain('execute command syntax updated')

    const predicateChange = v2.changes.find(c => c.file === 'data/demo/predicates/test.json')
    expect(predicateChange).toBeDefined()
    expect(predicateChange?.confidence).toBe('high')
    expect(predicateChange?.reason).toContain('Predicate field rename')

    const skippedChange = v2.changes.find(c => c.file === 'data/demo/dialog/intro.json')
    expect(skippedChange).toBeDefined()
    expect(skippedChange?.skipped).toBe(true)
  })

  it('assigns low confidence when manual attention or warnings are flagged', () => {
    const files: Record<string, string> = {
      'data/demo/functions/complex.mcfunction': 'execute ... complex macro ...',
    }

    const preview: FixPreviewLike = {
      results: [
        {
          file: 'data/demo/functions/complex.mcfunction',
          patches: 1,
          details: ['Manual attention: complex macro requires human verification'],
        },
      ],
      plan: {
        sourceVersion: '1.20',
        targetVersion: '1.21',
        direction: 'forward',
        rewrites: [],
        jsonFixes: [],
        manualAttention: [
          {
            description: 'Macro verification',
            reason: 'Complex macro requires manual check',
            files: ['data/demo/functions/complex.mcfunction'],
          },
        ],
        summary: {
          totalFilesToPatch: 1,
          commandRewrites: 0,
          jsonFixes: 0,
          manualAttention: 1,
          mcdocRemovals: 0,
          packMcmetaUpdate: false,
        },
      },
      outputFiles: {
        'data/demo/functions/complex.mcfunction': 'execute ... ported macro ...',
      },
    }

    const v2 = toFixPreviewV2(preview, files)
    const change = v2.changes.find(c => c.file === 'data/demo/functions/complex.mcfunction')
    expect(change?.confidence).toBe('low')
    expect(change?.reason.toLowerCase()).toContain('complex macro')
  })

  it('handles empty or missing fix preview gracefully', () => {
    const v2 = toFixPreviewV2(null, {})
    expect(v2.changes).toEqual([])
    expect(v2.skipped).toEqual([])
    expect(v2.summary).toBe('No fix preview available')
  })
})

describe('applyFixPreview and rollback/undo', () => {
  it('applies changed files and returns a backup of ONLY changed files', () => {
    const originalWorkspace: Record<string, string> = {
      'pack.mcmeta': '{"pack_format": 15}',
      'data/a.mcfunction': '# a original',
      'data/b.mcfunction': '# b unchanged',
      'data/c.json': '{"field": 1}',
    }

    const previewV2: FixPreviewV2 = {
      version: '1.21.4',
      summary: '2 files changed',
      skipped: [{ file: 'data/skipped.json', reason: 'unsupported' }],
      changes: [
        {
          file: 'pack.mcmeta',
          before: '{"pack_format": 15}',
          after: '{"pack_format": 61}',
          reason: 'Format bump',
          confidence: 'high',
        },
        {
          file: 'data/a.mcfunction',
          before: '# a original',
          after: '# a updated',
          reason: 'Command fix',
          confidence: 'medium',
        },
        {
          file: 'data/b.mcfunction',
          before: '# b unchanged',
          after: '# b unchanged',
          reason: 'No change',
          confidence: 'high',
        },
        {
          file: 'data/skipped.json',
          before: '{"skip": true}',
          after: '{"skip": false}',
          reason: 'Skipped file',
          confidence: 'low',
          skipped: true,
          skipReason: 'unsupported',
        },
      ],
    }

    const applied = applyFixPreview(previewV2, originalWorkspace)

    // Applied files should reflect updates for changed, unskipped files
    expect(applied.files['pack.mcmeta']).toBe('{"pack_format": 61}')
    expect(applied.files['data/a.mcfunction']).toBe('# a updated')
    expect(applied.files['data/b.mcfunction']).toBe('# b unchanged')
    expect(applied.files['data/c.json']).toBe('{"field": 1}')
    // Skipped file was not modified
    expect(applied.files['data/skipped.json']).toBeUndefined()

    // Backup should contain ONLY the files that actually changed
    expect(Object.keys(applied.backup).sort()).toEqual(['data/a.mcfunction', 'pack.mcmeta'])
    expect(applied.backup['pack.mcmeta']).toBe('{"pack_format": 15}')
    expect(applied.backup['data/a.mcfunction']).toBe('# a original')
    expect('data/b.mcfunction' in applied.backup).toBe(false)
    expect('data/c.json' in applied.backup).toBe(false)
    expect('data/skipped.json' in applied.backup).toBe(false)

    // Rollback: overlaying backup over applied files restores the exact original workspace
    const restoredWorkspace = { ...applied.files, ...applied.backup }
    expect(restoredWorkspace).toEqual(originalWorkspace)
  })
})

describe('computeLineDiff', () => {
  it('computes line-level additions, deletions, and context rows', () => {
    const before = 'line 1\nline 2\nline 3'
    const after = 'line 1\nline 2 modified\nline 3'

    const diff = computeLineDiff(before, after)
    expect(diff.additions).toBe(1)
    expect(diff.deletions).toBe(1)
    expect(diff.rows.some(r => r.kind === 'removed' && r.text === 'line 2')).toBe(true)
    expect(diff.rows.some(r => r.kind === 'added' && r.text === 'line 2 modified')).toBe(true)
  })

  it('returns zero additions and deletions for identical content', () => {
    const content = 'same line 1\nsame line 2'
    const diff = computeLineDiff(content, content)
    expect(diff.additions).toBe(0)
    expect(diff.deletions).toBe(0)
    expect(diff.rows).toHaveLength(0)
  })
})
