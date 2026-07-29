import { describe, it, expect } from 'vitest'
import { getMcdocSymbols, checkMcdocFile, fileKindFromPath } from '../src/mcdoc-check.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('mcdoc loot table validation', () => {
  it('accepts conditions and functions on pool entries', async () => {
    const table = await getMcdocSymbols()
    expect(table).not.toBeNull()

    const dir = join(tmpdir(), 'mcdoc-test-' + Date.now())
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = join(dir, 'test.json')

    // A loot table with conditions and functions on pool entries
    const lootTable = {
      pools: [{
        rolls: 1,
        entries: [{
          type: 'item',
          name: 'minecraft:stick',
          weight: 1,
          conditions: [{
            condition: 'minecraft:random_chance',
            chance: 0.5,
          }],
          functions: [{
            function: 'minecraft:set_count',
            count: 2,
          }],
        }],
      }],
    }

    writeFileSync(file, JSON.stringify(lootTable, null, 2))
    const issues = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', '1.21', table!)
    console.log('Issues for 1.21:', JSON.stringify(issues, null, 2))
    const entryIssues = issues.filter(i => i.issue.includes('unknown field') && (i.issue.includes('conditions') || i.issue.includes('functions')))
    expect(entryIssues).toHaveLength(0)

    const issuesSnapshot = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', '26w01a', table!)
    console.log('Issues for 26w01a:', JSON.stringify(issuesSnapshot, null, 2))
    const entryIssuesSnapshot = issuesSnapshot.filter(i => i.issue.includes('unknown field') && (i.issue.includes('conditions') || i.issue.includes('functions')))
    expect(entryIssuesSnapshot).toHaveLength(0)

    // Snapshots and pre-releases with the same numeric prefix should NOT trigger
    // the until gate (e.g., "26.3 Snapshot 1" < "26.3" because it's a pre-release)
    for (const ver of ['26.3 Snapshot 1', '26.3 Snapshot 6', '26.3 Pre-Release 2', '26.2']) {
      const issuesV = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', ver, table!)
      const entryIssuesV = issuesV.filter(i => i.issue.includes('unknown field') && (i.issue.includes('conditions') || i.issue.includes('functions')))
      console.log(`Issues for "${ver}":`, JSON.stringify(issuesV, null, 2))
      expect(entryIssuesV).toHaveLength(0)
    }

    // Actual release 26.3 and later should flag them (schema says removed in 26.3)
    const issues26_3 = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', '26.3', table!)
    const entryIssues26_3 = issues26_3.filter(i => i.issue.includes('unknown field') && (i.issue.includes('conditions') || i.issue.includes('functions')))
    console.log('Issues for 26.3 (release):', JSON.stringify(issues26_3, null, 2))
    expect(entryIssues26_3.length).toBeGreaterThan(0)
  })
})
