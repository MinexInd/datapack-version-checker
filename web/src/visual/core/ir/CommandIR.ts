// ============================================================================
// Datapack IR — typed, source-mapped command representation.
//
// The IR is the single semantic layer that code, AST and visual graph all
// flow through. Every node keeps `raw`, `line` and `range` so it can be
// mapped back to source for diagnostics, navigation and round-tripping.
// Anything the engine does not understand is preserved verbatim as CustomIR
// — never silently discarded.
// ============================================================================

export interface SourceRange {
  /** 1-based line number. */
  line: number;
  /** 1-based start column. */
  start: number;
  /** 1-based end column (exclusive). */
  end: number;
}

export interface IRBase {
  /** Original source line (empty if synthesized from a graph). */
  raw: string;
  line: number;
  range?: SourceRange;
}

// ---- shared value types ----------------------------------------------------

export interface PositionValue {
  x: string; // accepts "~", "~1", "-3", "^0.5"
  y: string;
  z: string;
}

export interface SelectorValue {
  /** @a, @p, @e, @s, @r, @initiator, or the full selector including args. */
  text: string;
}

// ---- specific command IRs --------------------------------------------------

export interface ExecuteIR extends IRBase {
  kind: "execute";
  /** Ordered subcommand clauses (as/at/positioned/rotated/facing/if/unless/anchor/align). */
  clauses: ExecuteClause[];
  /** The nested command to run. */
  run: CommandIR;
}

export type ExecuteClause =
  | { type: "as"; target: string }
  | { type: "at"; target: string }
  | { type: "anchored"; anchor: "eyes" | "feet" }
  | { type: "align"; axes: string }
  | { type: "positioned"; x: string; y: string; z: string }
  | { type: "positioned"; target: string; as?: "as" }
  | { type: "rotated"; x: string; y: string }
  | { type: "rotated"; target: string; as?: "as" }
  | { type: "facing"; x: string; y: string; z: string }
  | { type: "facing"; target: string }
  | { type: "condition"; polarity: "if" | "unless"; condition: ConditionIR };

export type ConditionIR =
  | { kind: "entity"; target: string }
  | { kind: "block"; x: string; y: string; z: string; block: string }
  | { kind: "blocks"; from: PositionValue; to: PositionValue; dest: PositionValue; mode?: string }
  | { kind: "score"; target: string; objective: string; op: string; source: string; sourceObjective: string }
  | { kind: "score"; target: string; objective: string; op: string; value: string }
  | { kind: "predicate"; predicate: string }
  | { kind: "data"; action: string; target: string };

export interface FunctionCallIR extends IRBase {
  kind: "function";
  /** namespace:path or tag id. */
  name: string;
  isTag?: boolean;
}

export interface ParticleIR extends IRBase {
  kind: "particle";
  particle: string;
  pos?: PositionValue;
  delta?: PositionValue;
  speed: string;
  count: string;
  visibility?: "force" | "normal";
}

export interface PlaySoundIR extends IRBase {
  kind: "playsound";
  sound: string;
  source: string;
  targets: string;
  pos?: PositionValue;
  volume: string;
  pitch: string;
  minVolume?: string;
}

export interface ScoreboardIR extends IRBase {
  kind: "scoreboard";
  /** objectives | players */
  action: string;
  sub: string;
  objective: string;
  target?: string; // for players
  value?: string;
  op?: string; // for compare: <, <=, =, >=, >
  source?: string;
  sourceObjective?: string;
  displayName?: string;
  criteria?: string;
}

export interface SummonIR extends IRBase {
  kind: "summon";
  entity: string;
  pos?: PositionValue;
  nbt?: string;
}

export interface KillIR extends IRBase {
  kind: "kill";
  targets?: string;
}

export interface TeleportIR extends IRBase {
  kind: "tp";
  targets: string;
  destination?: PositionValue;
  destEntity?: string;
}

export interface EffectIR extends IRBase {
  kind: "effect";
  sub: "give" | "clear";
  targets: string;
  effect?: string;
  seconds?: string;
  amplifier?: string;
  hideParticles?: boolean;
}

export interface SetBlockIR extends IRBase {
  kind: "setblock";
  pos: PositionValue;
  block: string;
  state?: string;
}

export interface FillIR extends IRBase {
  kind: "fill";
  from: PositionValue;
  to: PositionValue;
  block: string;
  mode?: string;
}

export interface ScheduleIR extends IRBase {
  kind: "schedule";
  function: string;
  time: string;
  mode?: "append" | "replace";
}

export interface TagIR extends IRBase {
  kind: "tag";
  targets: string;
  action: "add" | "remove" | "list";
  name?: string;
}

export interface TellrawIR extends IRBase {
  kind: "tellraw";
  targets: string;
  message: string; // raw JSON text
}

export interface TitleIR extends IRBase {
  kind: "title";
  targets: string;
  action: string;
  value: string;
}

export interface GiveIR extends IRBase {
  kind: "give";
  targets: string;
  item: string;
  count?: string;
}

export interface DataIR extends IRBase {
  kind: "data";
  action: string; // get|merge|modify|remove
  targetType: string; // block|entity|storage
  target: string;
  path?: string;
  value?: string;
  /** For `data modify`: the sub-action (set|append|merge|remove|insert). */
  modifyAction?: string;
}

export interface GameruleIR extends IRBase {
  kind: "gamerule";
  rule: string;
  value?: string;
}

export interface AdvancementIR extends IRBase {
  kind: "advancement";
  action: "grant" | "revoke";
  targets: string;
  mode: string;
  advancement?: string;
}

export interface WeatherIR extends IRBase {
  kind: "weather";
  weather: "clear" | "rain" | "thunder";
  duration?: string;
}

export interface TimeIR extends IRBase {
  kind: "time";
  action: "set" | "add" | "query";
  value: string;
}

export interface SayIR extends IRBase {
  kind: "say";
  message: string;
}

/** Any command not otherwise represented — preserved verbatim, never lost. */
export interface CustomIR extends IRBase {
  kind: "custom";
  command: string;
  args: string[];
}

export type CommandIR =
  | ExecuteIR
  | FunctionCallIR
  | ParticleIR
  | PlaySoundIR
  | ScoreboardIR
  | SummonIR
  | KillIR
  | TeleportIR
  | EffectIR
  | SetBlockIR
  | FillIR
  | ScheduleIR
  | TagIR
  | TellrawIR
  | TitleIR
  | GiveIR
  | DataIR
  | GameruleIR
  | AdvancementIR
  | WeatherIR
  | TimeIR
  | SayIR
  | CustomIR;

export function commandKind(ir: CommandIR): string {
  return ir.kind;
}

export function renderCommand(ir: CommandIR): string {
  // Deterministic re-serialisation of the IR back to command text.
  switch (ir.kind) {
    case "custom":
      return [ir.command, ...ir.args].join(" ");
    case "say":
      return `say ${ir.message}`;
    case "execute": {
      const parts: string[] = ["execute"];
      for (const c of ir.clauses) {
        switch (c.type) {
          case "as": parts.push("as", c.target); break;
          case "at": parts.push("at", c.target); break;
          case "anchored": parts.push("anchored", c.anchor); break;
          case "align": parts.push("align", c.axes); break;
          case "positioned": {
            const pT = (c as any).target;
            if (pT) parts.push("positioned", "as", pT);
            else parts.push("positioned", (c as any).x, (c as any).y, (c as any).z);
            break;
          }
          case "rotated": {
            const rT = (c as any).target;
            if (rT) parts.push("rotated", "as", rT);
            else parts.push("rotated", (c as any).x, (c as any).y);
            break;
          }
          case "facing": {
            const fT = (c as any).target;
            if (fT) parts.push("facing", fT);
            else parts.push("facing", (c as any).x, (c as any).y, (c as any).z);
            break;
          }
          case "condition":
            parts.push(c.polarity, ...renderCondition(c.condition));
            break;
        }
      }
      parts.push("run", renderCommand(ir.run));
      return parts.join(" ");
    }
    case "function": return `function ${ir.name}`;
    case "particle": {
      const p = [`particle ${ir.particle}`];
      if (ir.pos) p.push(pos(ir.pos));
      if (ir.delta) p.push(pos(ir.delta));
      p.push(ir.speed, ir.count);
      if (ir.visibility) p.push(ir.visibility);
      return p.join(" ");
    }
    case "playsound": {
      const s = [`playsound ${ir.sound} ${ir.source} ${ir.targets}`];
      if (ir.pos) s.push(pos(ir.pos));
      s.push(ir.volume ?? "1.0", ir.pitch ?? "1.0");
      if (ir.minVolume) s.push(ir.minVolume);
      return s.join(" ");
    }
    case "summon": {
      const s = [`summon ${ir.entity}`];
      if (ir.pos) s.push(pos(ir.pos));
      if (ir.nbt) s.push(ir.nbt);
      return s.join(" ");
    }
    case "kill": return ir.targets ? `kill ${ir.targets}` : "kill";
    case "tp": {
      const s = [`tp ${ir.targets}`];
      if (ir.destination) s.push(pos(ir.destination));
      else if (ir.destEntity) s.push(ir.destEntity);
      return s.join(" ");
    }
    case "effect": {
      if (ir.sub === "clear") {
        return ir.effect ? `effect clear ${ir.targets} ${ir.effect}` : `effect clear ${ir.targets}`;
      }
      const s = [`effect give ${ir.targets} ${ir.effect ?? ""}`];
      if (ir.seconds) s.push(ir.seconds);
      if (ir.amplifier) s.push(ir.amplifier);
      if (ir.hideParticles) s.push("true");
      return s.join(" ");
    }
    case "setblock": {
      const s = [`setblock ${pos(ir.pos)} ${ir.block}`];
      if (ir.state) s.push(ir.state);
      return s.join(" ");
    }
    case "fill": {
      const s = [`fill ${pos(ir.from)} ${pos(ir.to)} ${ir.block}`];
      if (ir.mode) s.push(ir.mode);
      return s.join(" ");
    }
    case "schedule": {
      const s = [`schedule function ${ir.function} ${ir.time}`];
      if (ir.mode) s.push(ir.mode);
      return s.join(" ");
    }
    case "scoreboard": {
      const parts = [`scoreboard ${ir.action} ${ir.sub}`];
      if (ir.action === "objectives") {
        parts.push(ir.objective);
        if (ir.criteria) parts.push(ir.criteria);
        if (ir.displayName) parts.push(ir.displayName);
      } else {
        parts.push(ir.target ?? "", ir.op ?? "", ir.source ?? "", ir.sourceObjective ?? "", ir.objective);
        if (ir.value) parts.push(ir.value);
      }
      return parts.filter((s) => s !== "").join(" ");
    }
    case "tag": return `tag ${ir.targets} ${ir.action}${ir.name ? " " + ir.name : ""}`;
    case "tellraw": return `tellraw ${ir.targets} ${ir.message}`;
    case "title": return `title ${ir.targets} ${ir.action}${ir.value ? " " + ir.value : ""}`;
    case "give": return `give ${ir.targets} ${ir.item}${ir.count ? " " + ir.count : ""}`;
    case "data": {
      let s = `data ${ir.action} ${ir.targetType} ${ir.target}`;
      if (ir.action === "modify") {
        if (ir.path) s += ` ${ir.path}`;
        if (ir.modifyAction) s += ` ${ir.modifyAction}`;
        if (ir.value) s += ` ${ir.value}`;
      } else {
        if (ir.path) s += ` ${ir.path}`;
        if (ir.value) s += ` ${ir.value}`;
      }
      return s;
    }
    case "gamerule": return ir.value ? `gamerule ${ir.rule} ${ir.value}` : `gamerule ${ir.rule}`;
    case "advancement": return `advancement ${ir.action} ${ir.targets} ${ir.mode}${ir.advancement ? " " + ir.advancement : ""}`;
    case "weather": return ir.duration ? `weather ${ir.weather} ${ir.duration}` : `weather ${ir.weather}`;
    case "time": return `time ${ir.action} ${ir.value}`;
  }
}

function pos(p: PositionValue): string {
  return `${p.x} ${p.y} ${p.z}`;
}

function renderCondition(c: ConditionIR): string[] {
  switch (c.kind) {
    case "entity": return ["entity", c.target];
    case "block": return ["block", c.x, c.y, c.z, c.block];
    case "score":
      if ("value" in c) return ["score", c.target, c.objective, c.op, c.value];
      return ["score", c.target, c.objective, c.op, c.source, c.sourceObjective];
    case "predicate": return ["predicate", c.predicate];
    case "data": return ["data", c.action, c.target];
    case "blocks": return ["blocks", pos(c.from), pos(c.to), pos(c.dest), c.mode ?? "all"];
  }
}
