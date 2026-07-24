import { describe, it, expect } from 'vitest'
import { validateCommand } from '../src/walker.js'
import type { CommandTreeNode } from '../src/types.js'

const mockTree: CommandTreeNode = {
  type: 'root',
  executable: false,
  children: {
    say: {
      type: 'literal',
      executable: true,
      children: {},
    },
    give: {
      type: 'literal',
      executable: false,
      children: {
        target: {
          type: 'argument',
          executable: false,
          parser: 'minecraft:entity',
          children: {
            item: {
              type: 'argument',
              executable: false,
              parser: 'minecraft:item',
              children: {
                count: {
                  type: 'argument',
                  executable: true,
                  parser: 'brigadier:integer',
                  children: {},
                },
              },
            },
          },
        },
      },
    },
    execute: {
      type: 'literal',
      executable: false,
      children: {
        run: {
          type: 'literal',
          executable: false,
          children: {},  // opaque: generic sub-command after run
        },
      },
    },
    summon: {
      type: 'literal',
      executable: false,
      children: {
        entity: {
          type: 'argument',
          executable: false,
          parser: 'minecraft:entity_summon',
          children: {
            pos: {
              type: 'argument',
              executable: true,
              parser: 'minecraft:vec3',
              properties: {},
              children: {},
            },
          },
        },
      },
    },
    data: {
      type: 'literal',
      executable: false,
      children: {
        get: {
          type: 'literal',
          executable: false,
          children: {
            block: {
              type: 'literal',
              executable: false,
              children: {
                pos: {
                  type: 'argument',
                  executable: true,
                  parser: 'minecraft:block_pos',
                  children: {},
                },
              },
            },
          },
        },
      },
    },
  },
}

describe('validateCommand', () => {
  it('accepts a known literal command with no args', () => {
    expect(validateCommand('say', mockTree, false)).toMatchObject({ valid: true })
  })

  it('accepts a command with arguments', () => {
    expect(validateCommand('give @s diamond 1', mockTree, false)).toMatchObject({ valid: true })
  })

  it('rejects an unknown root command', () => {
    expect(validateCommand('blargh', mockTree, false).valid).toBe(false)
  })

  it('rejects extra unexpected trailing arguments', () => {
    expect(validateCommand('say hello world', mockTree, false).valid).toBe(false)
  })

  it('accepts greedy arguments in lenient mode', () => {
    expect(validateCommand('say hello world', mockTree, true).valid).toBe(true)
  })

  it('handles vec3 parser (consumes 3 tokens)', () => {
    expect(validateCommand('summon minecraft:pig ~ ~1 ~', mockTree, false)).toMatchObject({ valid: true })
  })

  it('handles block_pos parser (consumes 3 tokens)', () => {
    expect(validateCommand('data get block 0 64 0', mockTree, false)).toMatchObject({ valid: true })
  })

  it('handles empty input', () => {
    expect(validateCommand('', mockTree, false)).toMatchObject({ valid: true })
  })

  it('handles opaque run node in lenient mode', () => {
    expect(validateCommand('execute run say hi', mockTree, true)).toMatchObject({ valid: true })
  })

  it('lenient mode skips unknown subcommands deeper than root', () => {
    const res = validateCommand('data get block 0 64 0 extra junk', mockTree, true)
    expect(res.valid).toBe(true)
  })
})