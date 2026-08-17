/**
 * pack-mcmeta-edit — Pure logic module for the pack.mcmeta GUI (Phase 3.5).
 *
 * Headless read/write engine for pack.mcmeta.  A separate designer agent will
 * build the form UI on top of these exported interfaces — do NOT change any
 * exported signatures without updating the designer brief.
 *
 * Style detection mirrors the fixer (fixer.ts ~L1025-1050):
 *   - new-style  → pack.min_format or pack.max_format exists
 *   - legacy     → pack.pack_format exists (or supported_formats only)
 *   - null       → data.pack missing entirely
 */

import { normalizeFormatTuple } from '../engine/pack-mcmeta'

// ─── Exported types ──────────────────────────────────────────────────────────

/** Which field set the form is editing. */
export type McmetaStyle = 'legacy' | 'new-style'

/** All values the pack.mcmeta form needs to display and edit. */
export interface McmetaFormState {
  style: McmetaStyle | null
  /** Legacy  pack.pack_format */
  packFormat: number | null
  /** new-style pack.min_format tuple [major, minor] */
  minFormat: [number, number] | null
  /** new-style pack.max_format tuple [major, minor] */
  maxFormat: [number, number] | null
  /** pack.description — plain string or JSON text-component object */
  description: string | Record<string, unknown>
  /** Normalised from any supported_formats shape; null means "omit key" */
  supported: { min: number; max: number } | null
}

export type McmetaParseResult =
  | { ok: true; state: McmetaFormState; raw: unknown }
  | { ok: false; error: string }

// ─── readMcmeta ──────────────────────────────────────────────────────────────

/**
 * Parse a pack.mcmeta string into a form-ready state.
 * Unlike `readPackMcmetaFromString` (which throws on invalid JSON), this
 * function always returns a result object — never throws.
 */
export function readMcmeta(content: string): McmetaParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  if (raw === null || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'pack.mcmeta root is not a JSON object',
    }
  }

  const obj = raw as Record<string, unknown>
  const pack = obj.pack as Record<string, unknown> | undefined

  // No pack key at all — return minimal defaults so the form can start fresh.
  if (!pack || typeof pack !== 'object') {
    return {
      ok: true,
      state: {
        style: null,
        packFormat: null,
        minFormat: null,
        maxFormat: null,
        description: '',
        supported: null,
      },
      raw,
    }
  }

  // ── Style detection (mirrors fixer.ts L1033) ────────────────────────────
  const hasMin = pack.min_format !== undefined
  const hasMax = pack.max_format !== undefined
  const style: McmetaStyle | null =
    hasMin || hasMax ? 'new-style' : 'legacy'

  // ── packFormat (legacy) ─────────────────────────────────────────────────
  const pf = pack.pack_format
  const packFormat = typeof pf === 'number' && Number.isFinite(pf) ? pf : null

  // ── min/max tuples (new-style) ──────────────────────────────────────────
  const minFormat = normalizeFormatTuple(pack.min_format) as [number, number] | null
  const maxFormat = normalizeFormatTuple(pack.max_format) as [number, number] | null

  // ── description ──────────────────────────────────────────────────────────
  const descRaw = pack.description
  let description: string | Record<string, unknown> = ''
  if (typeof descRaw === 'string') {
    description = descRaw
  } else if (descRaw !== undefined && descRaw !== null) {
    // JSON text component object — store as object for the form
    description = descRaw as Record<string, unknown>
  } else {
    // undefined or null - keep as empty string
    description = ''
  }

  // ── supported_formats → normalised {min, max} ───────────────────────────
  let supported: { min: number; max: number } | null = null
  const sf = pack.supported_formats
  if (sf !== undefined && sf !== null) {
    if (typeof sf === 'number' && Number.isFinite(sf)) {
      supported = { min: sf, max: sf }
    } else if (Array.isArray(sf) && sf.length > 0) {
      const nums = sf.filter((v: unknown): v is number =>
        typeof v === 'number' && Number.isFinite(v),
      )
      if (nums.length > 0) {
        supported = { min: Math.min(...nums), max: Math.max(...nums) }
      }
    } else if (
      typeof sf === 'object' &&
      'min_inclusive' in (sf as Record<string, unknown>) &&
      'max_inclusive' in (sf as Record<string, unknown>)
    ) {
      const sfo = sf as { min_inclusive: number; max_inclusive: number }
      supported = { min: sfo.min_inclusive, max: sfo.max_inclusive }
    }
  }

  return {
    ok: true,
    state: { style, packFormat, minFormat, maxFormat, description, supported },
    raw,
  }
}

// ─── writeMcmeta ─────────────────────────────────────────────────────────────

/**
 * Surgically apply form state back to the original pack.mcmeta object and
 * return the serialised JSON (with trailing newline, matching project style).
 *
 * Unknown keys at any depth are preserved — only the fields governed by the
 * form state are written.
 */
export function writeMcmeta(raw: unknown, state: McmetaFormState): string {
  // Deep-clone so we never mutate the caller's object.
  let data: Record<string, unknown>
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    data = structuredClone(raw) as Record<string, unknown>
  } else {
    data = {}
  }

  // Ensure pack root exists.
  if (data.pack === null || typeof data.pack !== 'object' || Array.isArray(data.pack)) {
    data.pack = {}
  }
  const pack = data.pack as Record<string, unknown>

  // Always write description (string or JSON text-component object).
  if (typeof state.description === 'object') {
    pack.description = state.description
  } else {
    pack.description = state.description
  }

  // ── Legacy path ─────────────────────────────────────────────────────────
  const useLegacy =
    state.style === 'legacy' ||
    (state.style === null && typeof state.packFormat === 'number')

  if (useLegacy) {
    if (typeof state.packFormat === 'number' && Number.isFinite(state.packFormat)) {
      pack.pack_format = state.packFormat
    } else {
      delete pack.pack_format
    }
    // New-style fields must not leak into a legacy pack.
    delete pack.min_format
    delete pack.max_format
    // supported_formats
    if (state.supported === null) {
      delete pack.supported_formats
    } else {
      const { min, max } = state.supported
      // A single version is written as a bare integer; a range is written as an
      // inclusive object. A bare array [min, max] would be interpreted as two
      // DISCRETE versions, not a continuous range.
      pack.supported_formats = min === max ? min : { min_inclusive: min, max_inclusive: max }
    }
  } else if (state.style === 'new-style') {
    // ── New-style path ────────────────────────────────────────────────────
    if (state.minFormat !== null) {
      pack.min_format = state.minFormat
    } else {
      delete pack.min_format
    }
    if (state.maxFormat !== null) {
      pack.max_format = state.maxFormat
    } else {
      delete pack.max_format
    }
    // Legacy pack_format must not leak into a new-style pack.
    if (state.packFormat === null) {
      delete pack.pack_format
    }
    // Do NOT touch supported_formats.
  }
  // If style is null and packFormat is not a number, only description was
  // written (which we already did above).

  return JSON.stringify(data, null, 2) + '\n'
}

// ─── parseFormatInput ────────────────────────────────────────────────────────

/**
 * Parse a user-typed format string into either a bare number or a
 * [major, minor] tuple.
 *
 * Accepts:  "42"  → 42
 *           "42.1" → [42, 1]
 *           "42,1" → [42, 1]   (comma separator)
 *           "" / "abc" → null  (invalid)
 */
export function parseFormatInput(text: string): number | [number, number] | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // Comma form → dot form for unified parsing.
  const normalised = trimmed.includes(',') ? trimmed.replace(',', '.') : trimmed

  // Must look like an integer or integer.integer (possibly with leading sign).
  const match = normalised.match(/^-?\d+(?:\.\d+)?$/)
  if (!match) return null

  const parts = normalised.split('.')
  const major = parseInt(parts[0], 10)

  if (parts.length === 1) {
    return Number.isFinite(major) ? major : null
  }

  const minor = parseInt(parts[1], 10)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null

  return [major, minor]
}
