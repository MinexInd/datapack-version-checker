import { VersionData, VersionAdapter, CommandSpec, ArgumentSpec } from "./types";
import { V1_21 } from "./versions/1_21";
import { V1_21_1 } from "./versions/1_21_1";
export type { VersionData, VersionAdapter, CommandSpec, ParticleSpec, EntitySpec, ArgumentSpec, VersionChange, Diagnostic, Severity } from "./types";

// ---------------------------------------------------------------------------
// Version registry. Add a new Minecraft version here to support it.
// ---------------------------------------------------------------------------
const VERSIONS: VersionData[] = [V1_21, V1_21_1];

/** All registered versions, newest first. */
export function getVersions(): VersionData[] {
  return [...VERSIONS].sort((a, b) => b.packFormat - a.packFormat);
}

/** Resolve a version by id ("1.21", "1.21.4") or pack_format. */
export function resolveVersion(idOrFormat: string | number): VersionData {
  if (typeof idOrFormat === "number") {
    const v = VERSIONS.find((d) => d.packFormat === idOrFormat);
    if (v) return v;
    throw new Error(`Unknown pack format: ${idOrFormat}`);
  }
  const norm = idOrFormat.trim();
  const v =
    VERSIONS.find((d) => d.version === norm) ||
    VERSIONS.find((d) => d.label === norm) ||
    VERSIONS.find((d) => d.version.startsWith(norm));
  if (v) return v;
  // Graceful degradation: return newest so unknown future versions still work
  // against the closest known data.
  const sorted = getVersions();
  return sorted[0];
}

/** The default (newest) supported version. */
export function getDefaultVersion(): VersionData {
  return getVersions()[0];
}

export function createAdapter(data: VersionData): VersionAdapter {
  const norm = (id: string) => (id.includes(":") ? id : `minecraft:${id}`);
  return {
    getCommand(name: string): CommandSpec | null {
      return data.commands[name] ?? null;
    },
    getCommands() {
      return Object.values(data.commands);
    },
    getParticle(id: string) {
      return data.particles[norm(id)] ?? null;
    },
    hasParticle(id: string) {
      return !!data.particles[norm(id)];
    },
    getParticles() {
      return Object.keys(data.particles);
    },
    getEntity(id: string) {
      return data.entities[norm(id)] ?? null;
    },
    hasEntity(id: string) {
      return !!data.entities[norm(id)];
    },
    getEntities() {
      return Object.keys(data.entities);
    },
    hasItem(id: string) {
      return data.items.includes(norm(id));
    },
    getItems() {
      return data.items;
    },
    hasBlock(id: string) {
      return data.blocks.includes(norm(id));
    },
    getBlocks() {
      return data.blocks;
    },
    hasEffect(id: string) {
      return data.effects.includes(norm(id));
    },
    getEffects() {
      return data.effects;
    },
    getSounds() {
      return data.sounds;
    },
    getGamerules() {
      return data.gamerules;
    },
    getArguments(command: string): ArgumentSpec[] {
      return data.commands[command]?.arguments ?? [];
    },
    validateCommand(command: string, args: string[]): { valid: boolean; message?: string } {
      const spec = data.commands[command];
      if (!spec) return { valid: false, message: `Unknown command "${command}".` };
      const required = spec.arguments.filter((a) => a.required && a.name !== "subcommands").length;
      if (args.length < required && command !== "execute") {
        return { valid: false, message: `${command} requires ${required} argument(s).` };
      }
      return { valid: true };
    },
    supportsCommand(name: string) {
      return !!data.commands[name];
    },
    supportsArgument(command: string, argName: string) {
      const spec = data.commands[command];
      if (!spec) return false;
      return spec.arguments.some((a) => a.name === argName);
    },
    getCommandSyntax(name: string) {
      return data.commands[name]?.syntax ?? null;
    },
    getPackMetadata() {
      return { pack_format: data.packFormat, description: `Datapack Studio - ${data.version}` };
    },
    getVersion() {
      return data.version;
    },
  };
}
