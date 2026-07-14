import type { CommandTreeNode } from './types.js'
import { tokenizeCommand, stripQuotes } from './tokenizer.js'

function getArity(parser: string | undefined, props: Record<string, unknown> | undefined): number {
  if (!parser) return 1
  if (parser === 'brigadier:string' && props?.type === 'greedy') return Infinity
  if (parser === 'minecraft:message' || parser === 'minecraft:component' ||
      parser === 'minecraft:text') return Infinity
  if (parser === 'brigadier:command' || parser?.includes('command')) return Infinity
  if (parser === 'minecraft:block_pos' || parser === 'minecraft:vec3' ||
      parser === 'minecraft:block_predicate') return 3
  if (parser === 'minecraft:rotation' || parser === 'minecraft:column_pos' ||
      parser === 'minecraft:vec2') return 2
  return 1
}

function resolveRedirect(node: CommandTreeNode, root: CommandTreeNode): CommandTreeNode {
  if (!node.redirect) return node
  let current: CommandTreeNode = root
  for (const seg of node.redirect) {
    if (current.children && current.children[seg]) {
      current = current.children[seg]
    }
  }
  return current
}

export interface WalkResult {
  valid: boolean
  failedAt?: string
  reason?: string
  lenient?: boolean
}

function walk(
  node: CommandTreeNode,
  tokens: string[],
  index: number,
  root: CommandTreeNode,
  lenient: boolean,
  depth: number,
): WalkResult {
  // End of input: valid only if this node can terminate (or its redirect target can)
  if (index >= tokens.length) {
    if (node.executable) return { valid: true }
    if (node.redirect) {
      const target = resolveRedirect(node, root)
      if (target.executable) return { valid: true }
    }
    // Best-effort: if we're deep in the command and lenient, accept
    if (lenient && depth > 0) return { valid: true, lenient: true }
    return { valid: false }
  }

  const actual = node.redirect ? resolveRedirect(node, root) : node

  if (!actual.children) {
    if (lenient && depth > 0) return { valid: true, lenient: true }
    return { valid: false, failedAt: tokens[index], reason: 'unexpected argument(s) after command' }
  }

  const token = stripQuotes(tokens[index])

  // Strict: literal children that match the current token
  for (const [name, child] of Object.entries(actual.children)) {
    if (child.type === 'literal' && name === token) {
      const res = walk(child, tokens, index + 1, root, lenient, depth + 1)
      if (res.valid) return res
    }
  }

  // Strict: argument children (consume based on parser semantics)
  for (const [name, child] of Object.entries(actual.children)) {
    if (child.type !== 'argument') continue
    const arity = getArity(child.parser, child.properties)
    if (arity === Infinity) return { valid: true }
    const remaining = tokens.length - index
    const consume = Math.min(arity, remaining)
    if (consume <= 0) continue
    const res = walk(child, tokens, index + consume, root, lenient, depth + 1)
    if (res.valid) return res
  }

  // No strict match. In lenient mode (and not at the root command), treat the
  // token as an unknown argument and continue. This tolerates gaps in the
  // command-tree data (e.g. `execute run <cmd>` where `run` has no children).
  if (lenient && depth > 0) {
    return walk(actual, tokens, index + 1, root, lenient, depth + 1)
  }

  return { valid: false, failedAt: token, reason: `no matching subcommand/argument for '${token}'` }
}

export function validateCommand(
  line: string,
  tree: CommandTreeNode,
  lenient: boolean = true,
): WalkResult {
  const tokens = tokenizeCommand(line).map(t => t.value)
  if (tokens.length === 0) return { valid: true }
  return walk(tree, tokens, 0, tree, lenient, 0)
}
