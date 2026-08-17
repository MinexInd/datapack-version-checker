import { CommandIR } from "./CommandIR";
import { Diagnostic } from "../minecraft/types";

/**
 * A parsed `.mcfunction` file. Carries the ordered command IR list plus the
 * original source (for non-destructive round-tripping) and diagnostics.
 */
export interface FunctionIR {
  /** Namespace, e.g. "mypack". */
  namespace: string;
  /** Path within the function namespace, e.g. "combat/attack". */
  path: string;
  /** Commands in order. */
  commands: CommandIR[];
  /** Original source text (for editing / non-destructive preservation). */
  source: string;
  /** Diagnostics produced while parsing/validating this function. */
  diagnostics: Diagnostic[];
  /** Whether the source parsed cleanly. */
  valid: boolean;
}

/** Fully-qualified function id "namespace:path". */
export function functionId(ns: string, path: string): string {
  return `${ns}:${path}`;
}
