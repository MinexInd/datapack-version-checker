/**
 * mcdoc-editor-logic — pure, framework-free helpers backing McdocEditor.
 *
 * Kept separate from the React component so the test suite can exercise the
 * form state and commit path without rendering. The component is the only
 * place that touches React state, debounce timers, or the network.
 */

import { writeBack } from '../../ide/json-ranges'
import type {
  SimplifiedMcdocType,
  JsonValue,
  JsonPath,
} from '../../ide/mcdoc-edit'

export interface FormState {
  value: JsonValue | null
  error: string | null
}

/**
 * Parse the editor text into a form value. `type` is accepted for signature
 * parity with the renderer (it drives structure, not the parse), so a null
 * type still yields a parsed value — the renderer shows a placeholder then.
 */
export function buildFormState(content: string, type: SimplifiedMcdocType | null): FormState {
  void type
  try {
    const value = JSON.parse(content) as JsonValue
    return { value, error: null }
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Produce the next document text for an edit. Wraps the byte-stable write-back
 * from json-ranges (which splices only the edited range and falls back to a
 * full serialization when it cannot locate the node). `type` is accepted for
 * signature parity and is currently unused by the write-back.
 */
export function commitEdit(
  content: string,
  type: SimplifiedMcdocType | null,
  path: JsonPath,
  value: JsonValue,
  newRoot: JsonValue,
): string {
  void type
  return writeBack(content, path, value, newRoot)
}
