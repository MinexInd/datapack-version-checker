// ============================================================================
// Minecraft version knowledge system — foundational types.
// The compiler/editor depend on this layer rather than hardcoded version checks.
// Adding a new Minecraft version = adding a version data file, not rewriting code.
// ============================================================================

export type Severity = "error" | "warning" | "info" | "hint" | "optimization";

export interface Diagnostic {
  /** Unique, stable error code, e.g. "unknown-command". */
  code: string;
  severity: Severity;
  message: string;
  /** Absolute virtual path within the project, e.g. "data/mypack/function/a.mcfunction". */
  file: string;
  line: number; // 1-based
  column: number; // 1-based
  length: number;
  /** Optional fix hint shown in the UI. */
  fix?: string;
}

export interface ArgumentSpec {
  name: string;
  kind:
    | "selector"
    | "particle"
    | "entity"
    | "item"
    | "block"
    | "effect"
    | "objective"
    | "sound"
    | "rotation"
    | "position"
    | "coordinates"
    | "int"
    | "float"
    | "double"
    | "string"
    | "bool"
    | "text"
    | "nbt"
    | "json"
    | "resourceLocation"
    | "command"
    | "function"
    | "gamemode"
    | "time"
    | "gamerule"
    | "custom";
  required: boolean;
  description: string;
  /** If kind is from a registry (particle, entity, item, ...), which registry. */
  registry?: "particles" | "entities" | "items" | "blocks" | "effects" | "sounds" | "objectives" | "gamerules";
}

export interface CommandSpec {
  /** Canonical command name, e.g. "execute". */
  name: string;
  description: string;
  /** Template used for documentation / formatting, e.g. "execute as <target> run <command>". */
  syntax: string;
  /** Full argument tree. For `execute` this encodes subcommand chains. */
  arguments: ArgumentSpec[];
  /** Added in this version. */
  since?: string;
  /** Deprecated in this version (still parseable, flagged). */
  deprecatedSince?: string;
  /** Marks the command as only valid as a subcommand of execute. */
  subcommandOnly?: boolean;
}

export interface EntitySpec {
  id: string;
  type: "living" | "hostile" | "passive" | "projectile" | "vehicle" | "utility" | "other";
  name: string;
}

export interface ParticleSpec {
  id: string;
  name: string;
  /** Whether particle takes a data/options argument. */
  hasOptions: boolean;
}

export interface VersionAdapter {
  /**
   * Returns the command specification for `name`, or null if the command does
   * not exist in this version.
   */
  getCommand(name: string): CommandSpec | null;
  /** Every command available in this version. */
  getCommands(): CommandSpec[];
  getParticle(id: string): ParticleSpec | null;
  hasParticle(id: string): boolean;
  getEntity(id: string): EntitySpec | null;
  hasEntity(id: string): boolean;
  hasItem(id: string): boolean;
  hasBlock(id: string): boolean;
  hasEffect(id: string): boolean;
  /** All particles (ids) available in this version. */
  getParticles(): string[];
  getEntities(): string[];
  getItems(): string[];
  getBlocks(): string[];
  getEffects(): string[];
  getSounds(): string[];
  getGamerules(): string[];
  /** Argument specs for a command (empty if unknown). */
  getArguments(command: string): ArgumentSpec[];
  /** Validate a command name + raw args against this version; returns diagnostics. */
  validateCommand(command: string, args: string[]): { valid: boolean; message?: string };
  /** Format suffix: e.g. the particle ids include "minecraft:" prefix. */
  supportsCommand(name: string): boolean;
  supportsArgument(command: string, argName: string): boolean;
  getCommandSyntax(name: string): string | null;
  getPackMetadata(): { pack_format: number; description: string };
  getVersion(): string;
}

export interface VersionData {
  /** e.g. "1.21.4" */
  version: string;
  /** The `pack_format` integer used in pack.mcmeta. */
  packFormat: number;
  /** Short display label, e.g. "1.21". */
  label: string;
  commands: Record<string, CommandSpec>;
  particles: Record<string, ParticleSpec>;
  entities: Record<string, EntitySpec>;
  items: string[];
  blocks: string[];
  effects: string[];
  sounds: string[];
  gamerules: string[];
  /** Version changes affecting syntax/behaviour, for documentation & migrations. */
  changes: VersionChange[];
}

export interface VersionChange {
  version: string;
  title: string;
  description: string;
}
