import { tokenize } from "./McFunctionLexer";
import { Token, TokenKind, numberValue } from "./tokens";
import {
  CommandIR,
  ExecuteIR,
  ExecuteClause,
  ConditionIR,
  PositionValue,
  FunctionCallIR,
  ParticleIR,
  PlaySoundIR,
  ScoreboardIR,
  SummonIR,
  KillIR,
  TeleportIR,
  EffectIR,
  SetBlockIR,
  FillIR,
  ScheduleIR,
  TagIR,
  TellrawIR,
  TitleIR,
  GiveIR,
  DataIR,
  GameruleIR,
  AdvancementIR,
  WeatherIR,
  TimeIR,
  SayIR,
  CustomIR,
  renderCommand,
} from "../ir/CommandIR";
import { FunctionIR } from "../ir/FunctionIR";
import { VersionAdapter } from "../minecraft/types";
import { Diagnostic } from "../minecraft/types";

// ---------------------------------------------------------------------------
// Semantic mapper: turns a line's tokens into typed CommandIR using the active
// version adapter. Unknown commands are preserved as CustomIR (never dropped).
// ---------------------------------------------------------------------------

const KNOWN = new Set([
  "execute", "function", "particle", "playsound", "scoreboard", "summon", "kill",
  "tp", "teleport", "effect", "setblock", "fill", "schedule", "tag", "tellraw",
  "title", "give", "data", "gamerule", "advancement", "weather", "time", "say",
  "return", "msg", "clear", "clearspawnpoint", "setworldspawn", "forceload",
  "locate", "debug", "attribute", "bossbar", "camera", "clone", "damage",
  "difficulty", "drop", "experience", "input", "item", "jfr", "list", "particle_ex",
  "playsound_ex", "ride", "random", "spectate", "spreadplayers", "startsound",
  "stopsound", "team", "teammsg", "test", "tick", "transfer", "wait", "worlds", "trigger",
]);

function isNum(t: Token): boolean {
  return t.kind === TokenKind.Number;
}

function posFrom(tokens: Token[], i: number): { pos: PositionValue; i: number } | null {
  if (i + 2 >= tokens.length) return null;
  if (tokens.slice(i, i + 3).every((t) => t.kind === TokenKind.Relative || t.kind === TokenKind.Number)) {
    return { pos: { x: tokens[i].text, y: tokens[i + 1].text, z: tokens[i + 2].text }, i: i + 3 };
  }
  return null;
}

export class McFunctionParser {
  constructor(private adapter: VersionAdapter) {}

  parse(source: string, namespace: string, path: string): FunctionIR {
    const commands: CommandIR[] = [];
    const diagnostics: Diagnostic[] = [];
    const lines = source.split(/\r?\n/);

    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const line = lines[idx].replace(/\s+$/, "");
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;

      const { tokens, errors } = tokenize(line);
      for (const e of errors) {
        diagnostics.push({
          code: "lex-error",
          severity: "error",
          message: e.message,
          file: `data/${namespace}/function/${path}.mcfunction`,
          line: lineNo,
          column: e.index + 1,
          length: 1,
        });
      }
      if (tokens.length === 0) continue;

      const ir = this.mapCommand(tokens, line, lineNo);
      if (ir) {
        commands.push(ir);
        // Syntax diagnostics for the mapped command.
        for (const d of ir.__syntaxDiagnostics ?? []) {
          diagnostics.push({ ...d, file: `data/${namespace}/function/${path}.mcfunction`, line: lineNo });
        }
      }
    }

    const valid = diagnostics.filter((d) => d.severity === "error").length === 0;
    return {
      namespace,
      path,
      commands,
      source,
      diagnostics,
      valid,
    };
  }

  private mapCommand(tokens: Token[], line: string, lineNo: number): CommandIR & { __syntaxDiagnostics?: Diagnostic[] } | null {
    const cmd = tokens[0].text;
    const rest = tokens.slice(1);
    const range = { line: lineNo, start: tokens[0].start + 1, end: (tokens[tokens.length - 1]?.end ?? tokens[0].end) + 1 };
    const base = { raw: line, line: lineNo, range };

    const syntaxDiagnostics: Diagnostic[] = [];
    const diag = (message: string, code: string, column: number, length = 1, severity: "error" | "warning" | "info" = "error") =>
      syntaxDiagnostics.push({ code, severity, message, file: "", line: lineNo, column, length });

    // ---- custom/unknown command ----
    const makeCustom = (): CustomIR => ({ kind: "custom", command: cmd, args: rest.map((t) => t.text), raw: line, line: lineNo, range, __syntaxDiagnostics: syntaxDiagnostics } as any);

    switch (cmd) {
      case "execute": {
        return this.parseExecute(rest, base, lineNo, diag);
      }
      case "function": {
        const ir: FunctionCallIR = { kind: "function", name: rest[0]?.text ?? "", raw: line, line: lineNo, range };
        if (rest.length === 0) diag("Missing function id", "missing-argument", tokens[0].end + 1);
        return ir as any;
      }
      case "particle": {
        const ir: ParticleIR = {
          kind: "particle",
          particle: rest[0]?.text ?? "",
          speed: "0",
          count: "1",
          raw: line, line: lineNo, range,
        };
        let i = 1;
        const p = posFrom(rest, i);
        if (p) { ir.pos = p.pos; i = p.i; }
        const d = posFrom(rest, i);
        if (d) { ir.delta = d.pos; i = d.i; }
        if (i < rest.length && isNum(rest[i])) { ir.speed = rest[i].text; i++; }
        if (i < rest.length && isNum(rest[i])) { ir.count = rest[i].text; i++; }
        if (i < rest.length && (rest[i].text === "force" || rest[i].text === "normal")) { ir.visibility = rest[i].text as any; i++; }
        if (rest.length === 0) diag("Missing particle id", "missing-argument", tokens[0].end + 1);
        return ir as any;
      }
      case "playsound": {
        const ir: PlaySoundIR = {
          kind: "playsound",
          sound: rest[0]?.text ?? "",
          source: rest[1]?.text ?? "master",
          targets: rest[2]?.text ?? "",
          volume: "1.0", pitch: "1.0",
          raw: line, line: lineNo, range,
        };
        let i = 3;
        const p = posFrom(rest, i);
        if (p) { ir.pos = p.pos; i = p.i; }
        if (i < rest.length && isNum(rest[i])) { ir.volume = rest[i].text; i++; }
        if (i < rest.length && isNum(rest[i])) { ir.pitch = rest[i].text; i++; }
        if (i < rest.length && isNum(rest[i])) { ir.minVolume = rest[i].text; i++; }
        if (rest.length < 3) diag("playsound requires <sound> <source> <targets>", "missing-argument", tokens[0].end + 1);
        return ir as any;
      }
      case "scoreboard": return this.parseScoreboard(rest, base, diag) as any;
      case "summon": {
        const ir: SummonIR = { kind: "summon", entity: rest[0]?.text ?? "", raw: line, line: lineNo, range };
        let i = 1;
        const p = posFrom(rest, i);
        if (p) { ir.pos = p.pos; i = p.i; }
        if (i < rest.length) ir.nbt = rest[i].text;
        return ir as any;
      }
      case "kill": {
        const ir: KillIR = { kind: "kill", raw: line, line: lineNo, range };
        if (rest.length) ir.targets = rest[0].text;
        return ir as any;
      }
      case "tp":
      case "teleport": {
        const ir: TeleportIR = { kind: "tp", targets: rest[0]?.text ?? "", raw: line, line: lineNo, range };
        let i = 1;
        const p = posFrom(rest, i);
        if (p) { ir.destination = p.pos; i = p.i; }
        else if (i < rest.length) { ir.destEntity = rest[i].text; i++; }
        return ir as any;
      }
      case "effect": {
        const ir: EffectIR = { kind: "effect", sub: "give", targets: "", raw: line, line: lineNo, range };
        let i = 0;
        if (rest[0]?.text === "clear") { ir.sub = "clear"; i = 1; }
        else if (rest[0]?.text === "give") { i = 1; }
        if (rest[i]) { ir.targets = rest[i].text; i++; }
        if (ir.sub === "give" && rest[i]) { ir.effect = rest[i].text; i++; }
        if (ir.sub === "give" && rest[i] && isNum(rest[i])) { ir.seconds = rest[i].text; i++; }
        if (ir.sub === "give" && rest[i] && isNum(rest[i])) { ir.amplifier = rest[i].text; i++; }
        if (ir.sub === "give" && rest[i] && rest[i].text === "true") { ir.hideParticles = true; i++; }
        return ir as any;
      }
      case "setblock": {
        const ir: SetBlockIR = { kind: "setblock", pos: { x: "~", y: "~", z: "~" }, block: "", raw: line, line: lineNo, range };
        const p = posFrom(rest, 0);
        if (p) { ir.pos = p.pos; ir.block = rest[p.i]?.text ?? ""; if (rest[p.i + 1]) ir.state = rest[p.i + 1].text; }
        return ir as any;
      }
      case "fill": {
        const ir: FillIR = { kind: "fill", from: { x: "~", y: "~", z: "~" }, to: { x: "~", y: "~", z: "~" }, block: "", raw: line, line: lineNo, range };
        const a = posFrom(rest, 0);
        const b = a ? posFrom(rest, a.i) : null;
        if (a && b) { ir.from = a.pos; ir.to = b.pos; ir.block = rest[b.i]?.text ?? ""; if (rest[b.i + 1]) ir.mode = rest[b.i + 1].text; }
        return ir as any;
      }
      case "schedule": {
        const ir: ScheduleIR = { kind: "schedule", function: rest[1]?.text ?? "", time: rest[2]?.text ?? "", raw: line, line: lineNo, range };
        if (rest[3]?.text === "append" || rest[3]?.text === "replace") ir.mode = rest[3].text as any;
        return ir as any;
      }
      case "tag": {
        const ir: TagIR = { kind: "tag", targets: rest[0]?.text ?? "", action: "add", raw: line, line: lineNo, range };
        if (rest[1]?.text === "add" || rest[1]?.text === "remove" || rest[1]?.text === "list") ir.action = rest[1].text as any;
        if (rest[2]) ir.name = rest[2].text;
        return ir as any;
      }
      case "tellraw": {
        const ir: TellrawIR = { kind: "tellraw", targets: rest[0]?.text ?? "", message: rest[1]?.text ?? "", raw: line, line: lineNo, range };
        return ir as any;
      }
      case "title": {
        const ir: TitleIR = { kind: "title", targets: rest[0]?.text ?? "", action: rest[1]?.text ?? "title", value: rest[2]?.text ?? "", raw: line, line: lineNo, range };
        return ir as any;
      }
      case "give": {
        const ir: GiveIR = { kind: "give", targets: rest[0]?.text ?? "", item: rest[1]?.text ?? "", raw: line, line: lineNo, range };
        if (rest[2] && isNum(rest[2])) ir.count = rest[2].text;
        return ir as any;
      }
      case "data": {
        const ir: DataIR = { kind: "data", action: rest[0]?.text ?? "", targetType: rest[1]?.text ?? "", target: "", raw: line, line: lineNo, range };
        // data get block <pos> <path> | data get entity <target> <path> | data get storage <id> <path>
        let i = 2;
        if (ir.targetType === "block") { const p = posFrom(rest, i); if (p) { ir.target = posText(p.pos); i = p.i; } }
        else if (ir.targetType === "entity") { ir.target = rest[i]?.text ?? ""; i++; }
        else if (ir.targetType === "storage") { ir.target = rest[i]?.text ?? ""; i++; }
        if (ir.action === "merge") {
          // data merge <target> <nbt>  — the trailing part is the NBT value, not a path.
          if (rest[i]) ir.value = rest.slice(i).map((t) => t.text).join(" ");
        } else if (ir.action === "modify") {
          // data modify <target> <path> <action> <value...>
          if (rest[i]) ir.path = rest[i].text; i++;
          if (rest[i]) ir.modifyAction = rest[i].text; i++;
          if (rest[i]) ir.value = rest.slice(i).map((t) => t.text).join(" ");
        } else {
          // data get/remove <target> <path>
          if (rest[i]) ir.path = rest[i].text;
        }
        return ir as any;
      }
      case "gamerule": {
        const ir: GameruleIR = { kind: "gamerule", rule: rest[0]?.text ?? "", raw: line, line: lineNo, range };
        if (rest[1]) ir.value = rest[1].text;
        return ir as any;
      }
      case "advancement": {
        const ir: AdvancementIR = { kind: "advancement", action: rest[0]?.text === "revoke" ? "revoke" : "grant", targets: rest[1]?.text ?? "", mode: rest[2]?.text ?? "everything", raw: line, line: lineNo, range };
        if (rest[3]) ir.advancement = rest.slice(3).map((t) => t.text).join(" ");
        return ir as any;
      }
      case "weather": {
        const ir: WeatherIR = { kind: "weather", weather: (rest[0]?.text as any) ?? "clear", raw: line, line: lineNo, range };
        if (rest[1] && isNum(rest[1])) ir.duration = rest[1].text;
        return ir as any;
      }
      case "time": {
        const ir: TimeIR = { kind: "time", action: (rest[0]?.text as any) ?? "query", value: rest[1]?.text ?? "", raw: line, line: lineNo, range };
        return ir as any;
      }
      case "say": {
        const ir: SayIR = { kind: "say", message: rest.map((t) => t.text).join(" "), raw: line, line: lineNo, range };
        return ir as any;
      }
      case "return":
      case "msg":
      case "clear":
      case "clearspawnpoint":
      case "setworldspawn":
      case "forceload":
      case "locate":
      case "debug":
      case "attribute":
      case "bossbar":
      case "camera":
      case "clone":
      case "damage":
      case "difficulty":
      case "drop":
      case "experience":
      case "input":
      case "item":
      case "jfr":
      case "list":
      case "particle_ex":
      case "playsound_ex":
      case "ride":
      case "random":
      case "spectate":
      case "spreadplayers":
      case "startsound":
      case "stopsound":
      case "team":
      case "teammsg":
      case "test":
      case "tick":
      case "transfer":
      case "wait":
      case "worlds":
      case "trigger":
        return makeCustom();

      default:
        return makeCustom();
    }
  }

  private parseExecute(tokens: Token[], base: any, lineNo: number, diag: any): ExecuteIR {
    const clauses: ExecuteClause[] = [];
    let i = 0;
    let runStart = -1;

    const peek = () => tokens[i]?.text;

    while (i < tokens.length) {
      const w = peek();
      switch (w) {
        case "as": { const t = tokens[i + 1]?.text ?? ""; clauses.push({ type: "as", target: t }); i += 2; break; }
        case "at": { const t = tokens[i + 1]?.text ?? ""; clauses.push({ type: "at", target: t }); i += 2; break; }
        case "anchored": { const a = tokens[i + 1]?.text === "eyes" ? "eyes" : "feet"; clauses.push({ type: "anchored", anchor: a }); i += 2; break; }
        case "align": { const a = tokens[i + 1]?.text ?? "xyz"; clauses.push({ type: "align", axes: a }); i += 2; break; }
        case "positioned": {
          if (tokens[i + 1]?.text === "as") { const t = tokens[i + 2]?.text ?? ""; clauses.push({ type: "positioned", target: t, as: "as" }); i += 3; }
          else { const p = posFrom(tokens, i + 1); if (p) { clauses.push({ type: "positioned", x: p.pos.x, y: p.pos.y, z: p.pos.z }); i = p.i; } else i += 2; }
          break;
        }
        case "rotated": {
          if (tokens[i + 1]?.text === "as") { const t = tokens[i + 2]?.text ?? ""; clauses.push({ type: "rotated", target: t, as: "as" }); i += 3; }
          else if (tokens[i + 1] && tokens[i + 2]) { clauses.push({ type: "rotated", x: tokens[i + 1].text, y: tokens[i + 2].text }); i += 3; }
          else i += 2;
          break;
        }
        case "facing": {
          if (tokens[i + 1]?.text === "entity") { const t = tokens[i + 2]?.text ?? ""; clauses.push({ type: "facing", target: t }); i += 3; }
          else if (tokens[i + 1] && tokens[i + 2] && tokens[i + 3]) { clauses.push({ type: "facing", x: tokens[i + 1].text, y: tokens[i + 2].text, z: tokens[i + 3].text }); i += 4; }
          else i += 2;
          break;
        }
        case "if":
        case "unless": {
          const polarity = w as "if" | "unless";
          const cond = this.parseCondition(tokens, i + 1);
          if (cond) { clauses.push({ type: "condition", polarity, condition: cond.condition }); i = cond.i; }
          else i += 2;
          break;
        }
        case "run": {
          runStart = i + 1;
          i = tokens.length; // remaining tokens are the nested command
          break;
        }
        default: {
          // Unknown execute subcommand — stop parsing the chain.
          runStart = i;
          i = tokens.length;
          break;
        }
      }
    }

    let run: CommandIR;
    if (runStart >= 0 && runStart < tokens.length) {
      const runTokens = tokens.slice(runStart);
      // The inner command's raw text is reconstructed from its own tokens (not
      // the whole execute line) so custom commands / source mapping stay correct
      // even when tokens carry absolute offsets from a nested execute line.
      const innerLine = runTokens.map((t) => t.text).join(" ");
      const innerRange = {
        line: lineNo,
        start: (runTokens[0].start ?? 0) + 1,
        end: (runTokens[runTokens.length - 1].end ?? 0) + 1,
      };
      run = this.mapCommand(runTokens, innerLine, lineNo) ?? {
        kind: "custom", command: runTokens[0]?.text ?? "", args: runTokens.map((t) => t.text), raw: innerLine, line: lineNo, range: innerRange,
      };
      if (run) run.raw = innerLine;
      if (run) run.range = innerRange;
      // Strip __syntaxDiagnostics from inner? Keep top-level only for simplicity.
    } else {
      run = { kind: "custom", command: "run", args: [], raw: base.raw, line: lineNo, range: base.range } as any;
    }

    return { kind: "execute", clauses, run, raw: base.raw, line: lineNo, range: base.range } as any;
  }

  private parseCondition(tokens: Token[], start: number): { condition: ConditionIR; i: number } | null {
    const kind = tokens[start]?.text;
    switch (kind) {
      case "entity": return { condition: { kind: "entity", target: tokens[start + 1]?.text ?? "" }, i: start + 2 };
      case "block": {
        const p = posFrom(tokens, start + 1);
        if (p) return { condition: { kind: "block", x: p.pos.x, y: p.pos.y, z: p.pos.z, block: tokens[p.i]?.text ?? "" }, i: p.i + 1 };
        return null;
      }
      case "score": {
        const target = tokens[start + 1]?.text ?? "";
        const objective = tokens[start + 2]?.text ?? "";
        const op = tokens[start + 3]?.text ?? "";
        const v4 = tokens[start + 4]?.text ?? "";
        // `matches` operator takes a single range value, e.g. "10..", "..5", "3..7".
        if (op === "matches") {
          return { condition: { kind: "score", target, objective, op, value: v4 }, i: start + 5 };
        }
        if (isNum(tokens[start + 4])) {
          return { condition: { kind: "score", target, objective, op, value: v4 }, i: start + 5 };
        }
        const srcObj = tokens[start + 5]?.text ?? "";
        return { condition: { kind: "score", target, objective, op, source: v4, sourceObjective: srcObj }, i: start + 6 };
      }
      case "predicate": return { condition: { kind: "predicate", predicate: tokens[start + 1]?.text ?? "" }, i: start + 2 };
      case "data": return { condition: { kind: "data", action: tokens[start + 1]?.text ?? "", target: tokens.slice(start + 2).map((t) => t.text).join(" ") }, i: tokens.length };
      case "blocks": {
        const a = posFrom(tokens, start + 1);
        const b = a ? posFrom(tokens, a.i) : null;
        const c = b ? posFrom(tokens, b.i) : null;
        if (a && b && c) return { condition: { kind: "blocks", from: a.pos, to: b.pos, dest: c.pos, mode: tokens[c.i]?.text ?? "all" }, i: c.i + 1 };
        return null;
      }
      default: return null;
    }
  }

  private parseScoreboard(tokens: Token[], base: any, diag: any): ScoreboardIR {
    const ir: ScoreboardIR = { kind: "scoreboard", action: tokens[0]?.text ?? "", sub: tokens[1]?.text ?? "", objective: tokens[2]?.text ?? "", raw: base.raw, line: base.line, range: base.range };
    if (ir.action === "objectives") {
      // scoreboard objectives add <name> <criteria> [display]
      if (tokens[3]) ir.criteria = tokens[3].text;
      if (tokens[4]) ir.displayName = tokens[4].text;
    } else if (ir.action === "players") {
      // scoreboard players set/add/remove/get/... <target> <objective> [value]
      // scoreboard players operation <target> <objective> <op> <source> <sourceObjective>
      if (ir.sub === "operation") {
        ir.target = tokens[2]?.text ?? "";
        ir.objective = tokens[3]?.text ?? "";
        ir.op = tokens[4]?.text ?? "";
        ir.source = tokens[5]?.text ?? "";
        ir.sourceObjective = tokens[6]?.text ?? "";
      } else {
        ir.target = tokens[2]?.text ?? "";
        ir.objective = tokens[3]?.text ?? "";
        if (tokens[4]) ir.value = tokens[4].text;
      }
    }
    return ir;
  }
}

function posText(p: PositionValue): string {
  return `${p.x} ${p.y} ${p.z}`;
}

/** Parse a single command line into CommandIR (convenience for tooling/tests). */
export function parseCommandLine(line: string, adapter: VersionAdapter): CommandIR {
  const p = new McFunctionParser(adapter);
  const fn = p.parse(line, "test", "inline");
  if (fn.commands.length > 0) return fn.commands[0];
  return { kind: "custom", command: "", args: [], raw: line, line: 1 };
}

/** Convenience: build a FunctionIR for a namespace/path. */
export function parseFunction(source: string, ns: string, path: string, adapter: VersionAdapter): FunctionIR {
  return new McFunctionParser(adapter).parse(source, ns, path);
}
