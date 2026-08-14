// One-off profiling harness for the Spyglass analyzer (plan item #4).
// Generates a synthetic medium pack, runs the analyzer cold + warm, and
// prints timing + diagnostic counts. Not a committed test — a measurement.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { analyzePackWithSpyglass, clearSpyglassCache } from '../dist/spyglass-analyze.js'

const VERSION = '1.21'
const N_FUNCTIONS = 150
const N_RECIPES = 50

function makePack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyglass-profile-'))
  fs.mkdirSync(path.join(dir, 'data', 'profile', 'functions'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'data', 'profile', 'recipe'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'pack.mcmeta'),
    JSON.stringify({ pack: { pack_format: 48, description: 'profile' } }, null, 2),
  )
  for (let i = 0; i < N_FUNCTIONS; i++) {
    // Mix of valid + a few intentionally broken files to produce diagnostics.
    const broken = i % 20 === 0
    const body = broken
      ? `/give @s minecraft:not_a_real_item_${i}\n`
      : `say tick ${i}\nexecute as @a run function profile:functions/f_${i}\n`
    fs.writeFileSync(path.join(dir, 'data', 'profile', 'functions', `f_${i}.mcfunction`), body)
  }
  for (let i = 0; i < N_RECIPES; i++) {
    fs.writeFileSync(
      path.join(dir, 'data', 'profile', 'recipe', `r_${i}.json`),
      JSON.stringify({
        type: 'minecraft:crafting_shaped',
        pattern: ['XX'],
        key: { X: { item: 'minecraft:stone' } },
        result: { item: 'minecraft:dirt', count: 1 },
      }),
      null,
      2,
    )
  }
  return dir
}

async function time(label, fn) {
  const start = process.hrtime.bigint()
  const r = await fn()
  const ms = Number(process.hrtime.bigint() - start) / 1e6
  console.log(`[profile] ${label}: ${ms.toFixed(0)}ms — errors=${r.errorCount} warnings=${r.warningCount} diags=${r.diagnostics.length} files=${r.fileCount}`)
  return ms
}

async function main() {
  const dir = makePack()
  console.log(`[profile] pack at ${dir} (${N_FUNCTIONS} mcfunction + ${N_RECIPES} recipe)`)

  clearSpyglassCache()
  await time('cold (vanilla fetch + bind)', () => analyzePackWithSpyglass(dir, VERSION))
  await time('warm (cache hit)', () => analyzePackWithSpyglass(dir, VERSION))

  // Re-run with a second version to measure version-switch cost.
  await time('version switch 1.20', () => analyzePackWithSpyglass(dir, '1.20'))
  console.log('[profile] done')
}

main().catch(e => {
  console.error('[profile] ERROR', e)
  process.exit(1)
})
