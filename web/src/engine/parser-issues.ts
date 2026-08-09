import type { McfunctionIssue, StructuralIssue, RegistryIssue, ReferenceIssue } from './types'
import type { ParserIssue } from './parser-runner'

export interface MappedIssues {
  mcfunction: McfunctionIssue[]
  structural: StructuralIssue[]
  registry: RegistryIssue[]
  reference: ReferenceIssue[]
}

export function mapParserIssues(issues: ParserIssue[], files: Map<string, string>): MappedIssues {
  const out: MappedIssues = { mcfunction: [], structural: [], registry: [], reference: [] }
  for (const issue of issues) {
    const line = issue.line
    const command = files.get(issue.file)?.split('\n')[line - 1]?.trim() ?? ''
    if (issue.file.endsWith('.mcfunction')) {
      out.mcfunction.push({ file: issue.file, line, command, issue: issue.message })
    } else if (/Unknown (item|block|entity|registry)/i.test(issue.message)) {
      const m = issue.message.match(/minecraft:[a-z0-9_./-]+/i)
      out.registry.push({ file: issue.file, registry: 'unknown', entry: m?.[0] ?? issue.message, issue: issue.message })
    } else if (issue.file.endsWith('.json')) {
      out.structural.push({ file: issue.file, issue: issue.message, source: 'mcdoc' })
    } else {
      out.reference.push({ file: issue.file, line, reference: issue.message, type: issue.source, issue: issue.message })
    }
  }
  return out
}
