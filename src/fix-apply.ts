import type { FixPreviewV2 } from './fix-preview.js'

/**
 * Applies a FixPreviewV2 to a map of file contents, returning the updated file map
 * and a backup of ONLY the changed files for rollback/undo safety.
 *
 * Pure function: does not mutate inputs, no side effects, no React, no fs.
 */
export function applyFixPreview(
  preview: FixPreviewV2,
  files: Record<string, string>
): {
  files: Record<string, string>
  backup: Record<string, string>
} {
  const nextFiles: Record<string, string> = { ...files }
  const backup: Record<string, string> = {}

  for (const change of preview.changes) {
    if (change.skipped) continue

    const currentContent = files[change.file]

    // Only apply and backup if there is an actual change in content
    if (currentContent !== change.after) {
      // Record backup of previous content (or change.before if file didn't exist in files)
      backup[change.file] = currentContent !== undefined ? currentContent : change.before
      nextFiles[change.file] = change.after
    }
  }

  return {
    files: nextFiles,
    backup,
  }
}
