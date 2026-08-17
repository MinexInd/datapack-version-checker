import { FunctionIR } from "../ir/FunctionIR";
import { CommandIR, ExecuteIR, ExecuteClause } from "../ir/CommandIR";
import { FunctionGraph, GraphNode, GraphEdge, SourceMeta } from "../graph/NodeTypes";

// ============================================================================
// Reverse conversion: supported .mcfunction logic → visual graph.
//
// Supported commands map to dedicated nodes; anything unsupported is preserved
// as a `custom_command` node. Every node carries a `meta` with its IR key and
// source range so code↔graph source mapping works. Semantics are preserved and
// no data is lost.
// ============================================================================

let eidCounter = 0;
function eid(): string {
  return `e${++eidCounter}`;
}

// ---- Stable semantic node identities ----
// Node ids are derived from the node type + a deterministic hash of its semantic
// content (NOT from array position or line number). This means:
//   * re-parsing unchanged commands preserves node identity,
//   * inserting an unrelated command does not shift the ids of existing nodes,
//   * comments/groups attached to a node keep pointing at the same semantic target.
// Duplicate nodes (identical content) get a numeric suffix to stay unique.
const USED_NODE_IDS = new Set<string>();

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function nid(base: string): string {
  let id = base;
  let n = 1;
  while (USED_NODE_IDS.has(id)) id = `${base}-${++n}`;
  USED_NODE_IDS.add(id);
  return id;
}

/** Compute a stable id from node type + a stable signature string. */
function stableId(type: string, signature: string): string {
  return nid(`n_${type}_${hashString(signature)}`);
}

export interface DecompileResult {
  graph: FunctionGraph;
  /** Number of commands that were preserved as custom_command nodes. */
  customCount: number;
}

export function decompileFunction(fn: FunctionIR): DecompileResult {
  eidCounter = 0;
  USED_NODE_IDS.clear();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let customCount = 0;
  let y = 0;

  const entryId = stableId("function_entry", "entry");
  nodes.push({ id: entryId, type: "function_entry", position: { x: 0, y: 0 }, data: {}, meta: { irKey: "entry" } });

  let prevId: string | null = entryId;
  const Y_STEP = 140;
  const X = 0;

  const addFlow = (from: string, to: string) => {
    edges.push({ id: eid(), source: from, sourceHandle: "out", target: to, targetHandle: "in" });
  };

  const addNode = (type: string, data: Record<string, string>, meta: SourceMeta): string => {
    // Stable semantic identity from type + sorted data content.
    const signature = type + "|" + JSON.stringify(Object.fromEntries(Object.entries(data).sort()));
    const id = stableId(type, signature);
    y += Y_STEP;
    nodes.push({ id, type, position: { x: X, y }, data, meta });
    if (prevId) addFlow(prevId, id);
    prevId = id;
    return id;
  };

  const metaFor = (cmd: CommandIR, key: string): SourceMeta => ({
    irKey: key,
    range: cmd.range,
    raw: cmd.raw,
  });

  const setPrev = (node: { id: string }) => {
    prevId = node.id;
  };

  // Track the previous node so branching from the entry/chain works for simple chains.
  let fnIdx = 0;

  for (const cmd of fn.commands) {
    const key = `commands[${fnIdx}]`;
    mapCommand(cmd, key);
    fnIdx++;
  }

  function mapCommand(cmd: CommandIR, key: string) {
    switch (cmd.kind) {
      case "execute": {
        mapExecute(cmd, key);
        break;
      }
      case "function":
        addNode("function_call", { name: cmd.name, asTag: cmd.name.startsWith("#") ? "true" : "false" }, metaFor(cmd, key));
        break;
      case "particle":
        addNode("particle", {
          particle: cmd.particle,
          pos: cmd.pos ? posStr(cmd.pos) : "~ ~ ~",
          delta: cmd.delta ? posStr(cmd.delta) : "0 0 0",
          speed: cmd.speed,
          count: cmd.count,
          force: cmd.visibility === "force" ? "true" : "false",
        }, metaFor(cmd, key));
        break;
      case "playsound":
        addNode("playsound", {
          sound: cmd.sound, source: cmd.source, targets: cmd.targets,
          pos: cmd.pos ? posStr(cmd.pos) : "~ ~ ~",
          volume: cmd.volume, pitch: cmd.pitch,
        }, metaFor(cmd, key));
        break;
      case "scoreboard":
        mapScoreboard(cmd, key);
        break;
      case "summon":
        addNode("summon", { entity: cmd.entity, pos: cmd.pos ? posStr(cmd.pos) : "~ ~ ~", nbt: cmd.nbt ?? "" }, metaFor(cmd, key));
        break;
      case "kill":
        addNode("kill", { target: cmd.targets ?? "@s" }, metaFor(cmd, key));
        break;
      case "tp":
        addNode("teleport", { target: cmd.targets, pos: cmd.destination ? posStr(cmd.destination) : (cmd.destEntity ?? "~ ~ ~") }, metaFor(cmd, key));
        break;
      case "effect":
        if (cmd.sub === "clear") addNode("effect_clear", { target: cmd.targets, effect: cmd.effect ?? "" }, metaFor(cmd, key));
        else addNode("effect", { target: cmd.targets, effect: cmd.effect ?? "", seconds: cmd.seconds ?? "10", amplifier: cmd.amplifier ?? "0" }, metaFor(cmd, key));
        break;
      case "setblock":
        addNode("setblock", { pos: posStr(cmd.pos), block: cmd.block, mode: cmd.state ?? "" }, metaFor(cmd, key));
        break;
      case "fill":
        addNode("fill", { from: posStr(cmd.from), to: posStr(cmd.to), block: cmd.block, mode: cmd.mode ?? "" }, metaFor(cmd, key));
        break;
      case "schedule":
        addNode("schedule", { function: cmd.function, time: cmd.time, mode: cmd.mode ?? "" }, metaFor(cmd, key));
        break;
      case "tag":
        if (cmd.action === "add") addNode("tag_add", { target: cmd.targets, name: cmd.name ?? "" }, metaFor(cmd, key));
        else if (cmd.action === "remove") addNode("tag_remove", { target: cmd.targets, name: cmd.name ?? "" }, metaFor(cmd, key));
        else addNode("custom_command", { command: cmd.raw }, metaFor(cmd, key));
        break;
      case "weather":
        addNode("weather", { weather: cmd.weather, duration: cmd.duration ?? "" }, metaFor(cmd, key));
        break;
      case "time":
        addNode("time", { action: cmd.action, value: cmd.value }, metaFor(cmd, key));
        break;
      case "gamerule":
        addNode("gamerule", { rule: cmd.rule, value: cmd.value ?? "" }, metaFor(cmd, key));
        break;
      case "data":
        if (cmd.action === "get") addNode("data_get", { targetType: cmd.targetType, target: cmd.target, path: cmd.path ?? "" }, metaFor(cmd, key));
        else if (cmd.action === "remove") addNode("data_remove", { targetType: cmd.targetType, target: cmd.target, path: cmd.path ?? "" }, metaFor(cmd, key));
        else if (cmd.action === "merge") addNode("data_set", { targetType: cmd.targetType, target: cmd.target, value: cmd.value ?? "" }, metaFor(cmd, key));
        else if (cmd.action === "modify") {
          // Structured core subset: set/append/merge/remove/insert with a plain value.
          const simple = cmd.modifyAction && ["set", "append", "merge", "remove", "insert"].includes(cmd.modifyAction);
          const valuePlain = !cmd.value || !/^from\s/.test(cmd.value);
          if (simple && valuePlain) {
            addNode("data_modify", { targetType: cmd.targetType, target: cmd.target, path: cmd.path ?? "", action: cmd.modifyAction ?? "set", value: cmd.value ?? "" }, metaFor(cmd, key));
          } else {
            // Complex forms (e.g. `from entity …`, `from block …`) preserved verbatim.
            customCount++;
            addNode("custom_command", { command: cmd.raw || renderRaw(cmd) }, metaFor(cmd, key));
          }
        } else {
          // data modify has complex nested value syntax; preserve verbatim to guarantee fidelity.
          customCount++;
          addNode("custom_command", { command: cmd.raw || renderRaw(cmd) }, metaFor(cmd, key));
        }
        break;
      case "advancement":
        if (cmd.action === "grant") addNode("grant_advancement", { targets: cmd.targets, advancement: cmd.advancement ?? "" }, metaFor(cmd, key));
        else addNode("revoke_advancement", { targets: cmd.targets, advancement: cmd.advancement ?? "" }, metaFor(cmd, key));
        break;
      case "custom":
        customCount++;
        addNode("custom_command", { command: cmd.raw || renderRaw(cmd) }, metaFor(cmd, key));
        break;
      default:
        customCount++;
        addNode("custom_command", { command: cmd.raw || renderRaw(cmd) }, metaFor(cmd, key));
        break;
    }
  }

  function mapExecute(exe: ExecuteIR, key: string) {
    // Execution-context clauses become context nodes chained in order.
    let clauseIdx = 0;
    for (const clause of exe.clauses) {
      const cKey = `${key}.clauses[${clauseIdx}]`;
      const cMeta: SourceMeta = { irKey: cKey, range: exe.range, raw: exe.raw };
      switch (clause.type) {
        case "as":
          addNode("execute_as", { target: clause.target }, cMeta);
          break;
        case "at":
          addNode("execute_at", { target: clause.target }, cMeta);
          break;
        case "positioned":
          if ((clause as any).target) addNode("execute_positioned", { pos: (clause as any).target }, cMeta);
          else addNode("execute_positioned", { pos: `${(clause as any).x} ${(clause as any).y} ${(clause as any).z}` }, cMeta);
          break;
        case "rotated":
          if ((clause as any).target) addNode("execute_rotated", { x: "as", y: (clause as any).target }, cMeta);
          else addNode("execute_rotated", { x: (clause as any).x, y: (clause as any).y }, cMeta);
          break;
        case "facing":
          if ((clause as any).target) addNode("execute_facing", { mode: "entity", entity: (clause as any).target }, cMeta);
          else addNode("execute_facing", { mode: "pos", x: (clause as any).x, y: (clause as any).y, z: (clause as any).z }, cMeta);
          break;
        case "anchored":
          addNode("execute_anchored", { anchor: clause.anchor }, cMeta);
          break;
        case "condition":
          addNode("execute_condition", { clause: renderConditionClause(clause.condition), polarity: clause.polarity }, cMeta);
          break;
        default:
          customCount++;
          addNode("custom_command", { command: `execute ${clause.type}` }, cMeta);
          break;
      }
      clauseIdx++;
    }
    mapCommand(exe.run, `${key}.run`);
  }

  function mapScoreboard(cmd: Extract<CommandIR, { kind: "scoreboard" }>, key: string) {
    const meta = metaFor(cmd, key);
    if (cmd.action === "objectives" && cmd.sub === "add") {
      addNode("create_objective", { objective: cmd.objective, criteria: cmd.criteria ?? "dummy", display: cmd.displayName ?? "" }, meta);
      return;
    }
    const target = cmd.target ?? "@s";
    if (cmd.sub === "set") addNode("set_score", { target, objective: cmd.objective, value: cmd.value ?? "0" }, meta);
    else if (cmd.sub === "add") addNode("add_score", { target, objective: cmd.objective, value: cmd.value ?? "0" }, meta);
    else if (cmd.sub === "remove") addNode("remove_score", { target, objective: cmd.objective, value: cmd.value ?? "0" }, meta);
    else {
      customCount++;
      addNode("custom_command", { command: cmd.raw || renderRaw(cmd) }, meta);
    }
  }

  return { graph: { nodes, edges }, customCount };
}

function posStr(p: { x: string; y: string; z: string }): string {
  return `${p.x} ${p.y} ${p.z}`;
}

function renderConditionClause(c: any): string {
  switch (c.kind) {
    case "entity": return `entity ${c.target}`;
    case "block": return `block ${c.x} ${c.y} ${c.z} ${c.block}`;
    case "score":
      if ("value" in c) return `score ${c.target} ${c.objective} ${c.op} ${c.value}`;
      return `score ${c.target} ${c.objective} ${c.op} ${c.source} ${c.sourceObjective}`;
    case "predicate": return `predicate ${c.predicate}`;
    case "data": return `data ${c.action} ${c.target}`;
    case "blocks": return `blocks ${posStr(c.from)} ${posStr(c.to)} ${posStr(c.dest)} ${c.mode ?? "all"}`;
    default: return "";
  }
}

function renderRaw(cmd: any): string {
  return cmd.raw || `${cmd.kind}`;
}
