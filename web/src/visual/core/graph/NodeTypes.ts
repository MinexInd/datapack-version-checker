import { VersionAdapter } from "../minecraft/types";

// ============================================================================
// Visual scripting node registry.
//
// Each node type declares its fields, data handles (typed ports) and a pure
// `build` function that turns resolved values into one or more command lines.
// The registry is data-driven so new node types can be added without touching
// the compiler.
// ============================================================================

export type FieldType =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "selector"
  | "particle"
  | "entity"
  | "item"
  | "block"
  | "effect"
  | "sound"
  | "objective"
  | "position"
  | "function";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  default?: string;
  description?: string;
  registry?: "particles" | "entities" | "items" | "blocks" | "effects" | "sounds" | "objectives";
}

export interface HandleSpec {
  id: string;
  label: string;
  /** data port direction */
  dir: "in" | "out";
  type: "flow" | FieldType;
  required?: boolean;
}

export type NodeCategory =
  | "flow"
  | "function"
  | "execution"
  | "scoreboard"
  | "entity"
  | "world"
  | "data"
  | "logic"
  | "advancement"
  | "utility";

export interface NodeTypeDef {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  /** exec flow: whether node consumes a flow input and emits a flow output. */
  hasExecIn: boolean;
  hasExecOut: boolean;
  fields: FieldSpec[];
  handles: HandleSpec[];
  /** Build zero or more command lines from resolved values. */
  build: (data: Record<string, string>, adapter: VersionAdapter) => string[];
  /** For value-provider nodes: produce the value emitted on their output port. */
  getValue?: (data: Record<string, string>) => string;
  /** For control-flow nodes: produce the condition fragment after execute if/unless. */
  getCondition?: (data: Record<string, string>) => string;
  /**
   * For execution-context nodes (execute_as/at/positioned/condition/facing/rotated):
   * produce the clause appended after `execute`, e.g. "as @a" or "if score @s mana > 10".
   * Such nodes accumulate into a single `execute … run <action>` command.
   */
  getClause?: (data: Record<string, string>) => string;
}

/** Source mapping metadata attached to graph nodes by the decompiler. */
export interface SourceMeta {
  /** IR key describing the source command, e.g. "commands[0].run" or "commands[3]". */
  irKey?: string;
  /** Source range in the original function (1-based line/start/end). */
  range?: { line: number; start: number; end: number };
  /** The original command text. */
  raw?: string;
}

export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, string>;
  /** Optional comment. */
  comment?: string;
  /** Source-mapping metadata set by the decompiler (if the graph came from code). */
  meta?: SourceMeta;
  /** Visual grouping (editor metadata only, never affects semantics). */
  groupId?: string;
}

export interface GraphEdge {
  id: string;
  source: string; // node id
  sourceHandle?: string;
  target: string; // node id
  targetHandle?: string;
}

/** A named visual group (editor metadata; must never change Minecraft semantics). */
export interface GraphGroup {
  id: string;
  label: string;
  /** Node ids contained in this group. */
  nodeIds: string[];
  collapsed?: boolean;
  position?: { x: number; y: number };
}

/** A free-floating comment region (editor metadata). */
export interface GraphComment {
  id: string;
  text: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  /** Optional node/edge/group id this comment is attached to. */
  attachedTo?: string;
}

export interface FunctionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Named groups (editor metadata). */
  groups?: GraphGroup[];
  /** Free-floating comments (editor metadata). */
  comments?: GraphComment[];
}

// ---- helpers -----------------------------------------------------------------

function field(f: Omit<FieldSpec, "key" | "label"> & { key: string; label: string }): FieldSpec {
  return f;
}

const flowIn: HandleSpec = { id: "in", label: "In", dir: "in", type: "flow", required: true };
const flowOut: HandleSpec = { id: "out", label: "Out", dir: "out", type: "flow" };

function valueOut(id: string, label: string, type: "flow" | FieldType): HandleSpec {
  return { id, label, dir: "out", type };
}
function valueIn(id: string, label: string, type: "flow" | FieldType): HandleSpec {
  return { id, label, dir: "in", type };
}

// ---- the registry -------------------------------------------------------------

const SELECTOR_OPTIONS = ["@a", "@p", "@e", "@s", "@r"].map((v) => ({ value: v, label: v }));

function buildRegistry(_adapter: VersionAdapter): Record<string, NodeTypeDef> {
  const defs: NodeTypeDef[] = [
    // ---------------- FLOW ----------------
    {
      type: "function_entry",
      category: "flow",
      label: "Function Entry",
      description: "Entry point of the generated function.",
      hasExecIn: false,
      hasExecOut: true,
      fields: [],
      handles: [flowOut],
      build: () => [],
    },
    {
      type: "sequence",
      category: "flow",
      label: "Sequence",
      description: "Passes execution through in order.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [],
      handles: [flowIn, flowOut],
      build: () => [],
    },
    {
      type: "function_call",
      category: "function",
      label: "Function Call",
      description: "Runs another function.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "name", label: "Function", type: "function", required: true, description: "namespace:path" },
        { key: "asTag", label: "Call as tag (#)", type: "boolean", default: "false" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`function ${d.asTag === "true" ? "#" : ""}${d.name}`],
    },
    {
      type: "schedule",
      category: "function",
      label: "Delay / Schedule",
      description: "Schedules a function to run after a delay in ticks.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "function", label: "Function", type: "function", required: true },
        { key: "time", label: "Delay (ticks)", type: "text", required: true, default: "20t", description: "e.g. 20t, 5s, 1d" },
        { key: "mode", label: "Mode", type: "select", options: ["", "append", "replace"].map((v) => ({ value: v, label: v || "default" })), default: "" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`schedule function ${d.function} ${d.time}${d.mode ? " " + d.mode : ""}`],
    },
    {
      type: "branch",
      category: "flow",
      label: "Branch (Condition)",
      description: "Executes one branch based on an execute if/unless condition.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "condition", label: "Condition", type: "text", required: true, description: "e.g. @s[scores={mana=10..}]" },
        { key: "polarity", label: "Polarity", type: "select", options: [{ value: "if", label: "if" }, { value: "unless", label: "unless" }], default: "if" },
      ],
      handles: [flowIn, flowOut, valueOut("true_out", "True", "flow"), valueOut("false_out", "False", "flow")],
      build: () => [],
      getCondition: (d) => `entity ${d.condition || "@s"}`,
    },
    // ---------------- EXECUTION ----------------
    {
      type: "execute_as",
      category: "execution",
      label: "Execute As",
      description: "Runs the downstream commands as the given target.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [{ key: "target", label: "Target", type: "selector", required: true, default: "@a" }],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: () => [],
      getClause: (d) => `as ${d.target || "@a"}`,
    },
    {
      type: "execute_at",
      category: "execution",
      label: "Execute At",
      description: "Runs downstream commands at the given target's position.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [{ key: "target", label: "Target", type: "selector", required: true, default: "@s" }],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: () => [],
      getClause: (d) => `at ${d.target || "@s"}`,
    },
    {
      type: "execute_positioned",
      category: "execution",
      label: "Execute Positioned",
      description: "Runs downstream commands at a fixed position.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [{ key: "pos", label: "Position", type: "position", required: true, default: "~ ~ ~" }],
      handles: [flowIn, flowOut, valueIn("pos", "Position", "position")],
      build: () => [],
      getClause: (d) => `positioned ${d.pos || "~ ~ ~"}`,
    },
    {
      type: "execute_condition",
      category: "execution",
      label: "Execute Condition",
      description: "Conditionally runs downstream commands using execute if/unless.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "clause", label: "Condition", type: "text", required: true, description: "e.g. score @s mana matches 10.. | entity @s | block ~ ~ ~ minecraft:stone" },
        { key: "polarity", label: "Polarity", type: "select", options: [{ value: "if", label: "if" }, { value: "unless", label: "unless" }], default: "if" },
      ],
      handles: [flowIn, flowOut],
      build: () => [],
      getClause: (d) => `${d.polarity === "unless" ? "unless" : "if"} ${d.clause || "entity @s"}`,
    },
    {
      type: "execute_facing",
      category: "execution",
      label: "Execute Facing",
      description: "Rotates the executor to face a position or entity.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "mode", label: "Mode", type: "select", options: [{ value: "pos", label: "Position" }, { value: "entity", label: "Entity" }], default: "pos" },
        { key: "x", label: "X", type: "number", default: "0" },
        { key: "y", label: "Y", type: "number", default: "0" },
        { key: "z", label: "Z", type: "number", default: "0" },
        { key: "entity", label: "Target", type: "selector", default: "@s" },
      ],
      handles: [flowIn, flowOut],
      build: () => [],
      getClause: (d) => (d.mode === "entity" ? `facing entity ${d.entity || "@s"}` : `facing ${d.x || "0"} ${d.y || "0"} ${d.z || "0"}`),
    },
    {
      type: "execute_rotated",
      category: "execution",
      label: "Execute Rotated",
      description: "Rotates the executor.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "x", label: "Yaw", type: "number", default: "0" },
        { key: "y", label: "Pitch", type: "number", default: "0" },
      ],
      handles: [flowIn, flowOut],
      build: () => [],
      getClause: (d) => `rotated ${d.x || "0"} ${d.y || "0"}`,
    },
    {
      type: "execute_anchored",
      category: "execution",
      label: "Execute Anchored",
      description: "Sets the anchor for positioning (eyes/feet).",
      hasExecIn: true,
      hasExecOut: true,
      fields: [{ key: "anchor", label: "Anchor", type: "select", options: [{ value: "feet", label: "feet" }, { value: "eyes", label: "eyes" }], default: "feet" }],
      handles: [flowIn, flowOut],
      build: () => [],
      getClause: (d) => `anchored ${d.anchor === "eyes" ? "eyes" : "feet"}`,
    },
    // ---------------- SCOREBOARD ----------------
    {
      type: "set_score",
      category: "scoreboard",
      label: "Set Score",
      description: "Sets a scoreboard score.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "objective", label: "Objective", type: "objective", required: true },
        { key: "value", label: "Value", type: "number", required: true },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector"), valueIn("value", "Value", "number")],
      build: (d) => [`scoreboard players set ${d.target} ${d.objective} ${d.value}`],
    },
    {
      type: "add_score",
      category: "scoreboard",
      label: "Add Score",
      description: "Adds to a scoreboard score.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "objective", label: "Objective", type: "objective", required: true },
        { key: "value", label: "Value", type: "number", required: true },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector"), valueIn("value", "Value", "number")],
      build: (d) => [`scoreboard players add ${d.target} ${d.objective} ${d.value}`],
    },
    {
      type: "remove_score",
      category: "scoreboard",
      label: "Remove Score",
      description: "Subtracts from a scoreboard score.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "objective", label: "Objective", type: "objective", required: true },
        { key: "value", label: "Value", type: "number", required: true },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector"), valueIn("value", "Value", "number")],
      build: (d) => [`scoreboard players remove ${d.target} ${d.objective} ${d.value}`],
    },
    {
      type: "create_objective",
      category: "scoreboard",
      label: "Create Objective",
      description: "Declares a scoreboard objective (usually in load).",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "objective", label: "Objective", type: "objective", required: true },
        { key: "criteria", label: "Criteria", type: "text", default: "dummy" },
        { key: "display", label: "Display Name", type: "text" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`scoreboard objectives add ${d.objective} ${d.criteria || "dummy"}${d.display ? " " + d.display : ""}`],
    },
    {
      type: "score_condition",
      category: "scoreboard",
      label: "Score Condition",
      description: "Branches based on a score comparison.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "objective", label: "Objective", type: "objective", required: true },
        { key: "op", label: "Operator", type: "select", options: ["<", "<=", "=", ">=", ">"].map((v) => ({ value: v, label: v })), default: ">" },
        { key: "value", label: "Value", type: "number", required: true },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector"), valueIn("value", "Value", "number")],
      build: () => [],
      getCondition: (d) => `score ${d.target || "@s"} ${d.objective} ${d.op || ">"} ${d.value}`,
    },
    // ---------------- ENTITY ----------------
    {
      type: "summon",
      category: "entity",
      label: "Spawn Entity",
      description: "Spawns an entity.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "entity", label: "Entity", type: "entity", required: true, registry: "entities", default: "minecraft:zombie" },
        { key: "pos", label: "Position", type: "position", default: "~ ~ ~" },
        { key: "nbt", label: "NBT", type: "text" },
      ],
      handles: [flowIn, flowOut, valueIn("entity", "Entity", "entity")],
      build: (d) => [`summon ${d.entity} ${d.pos || "~ ~ ~"}${d.nbt ? " " + d.nbt : ""}`],
    },
    {
      type: "kill",
      category: "entity",
      label: "Kill Entity",
      description: "Kills target entities.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [{ key: "target", label: "Target", type: "selector", default: "@s" }],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: (d) => [`kill ${d.target}`],
    },
    {
      type: "teleport",
      category: "entity",
      label: "Teleport Entity",
      description: "Teleports target entities.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "pos", label: "Destination", type: "position", default: "~ ~ ~" },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: (d) => [`tp ${d.target} ${d.pos}`],
    },
    {
      type: "effect",
      category: "entity",
      label: "Effect",
      description: "Gives a status effect.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "effect", label: "Effect", type: "effect", required: true, registry: "effects", default: "minecraft:speed" },
        { key: "seconds", label: "Duration (s)", type: "number", default: "10" },
        { key: "amplifier", label: "Amplifier", type: "number", default: "0" },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector"), valueIn("effect", "Effect", "effect")],
      build: (d) => [`effect give ${d.target} ${d.effect} ${d.seconds || "10"} ${d.amplifier || "0"} true`],
    },
    {
      type: "tag_add",
      category: "entity",
      label: "Tag Add",
      description: "Adds a tag to target entities.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "name", label: "Tag Name", type: "text", required: true },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: (d) => [`tag ${d.target} add ${d.name}`],
    },
    {
      type: "tag_remove",
      category: "entity",
      label: "Tag Remove",
      description: "Removes a tag from target entities.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "name", label: "Tag Name", type: "text", required: true },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: (d) => [`tag ${d.target} remove ${d.name}`],
    },
    // ---------------- WORLD ----------------
    {
      type: "particle",
      category: "world",
      label: "Particle",
      description: "Spawns a particle effect.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "particle", label: "Particle", type: "particle", required: true, registry: "particles", default: "minecraft:flame" },
        { key: "pos", label: "Position", type: "position", default: "~ ~ ~" },
        { key: "delta", label: "Delta", type: "position", default: "0 0 0" },
        { key: "speed", label: "Speed", type: "number", default: "0" },
        { key: "count", label: "Count", type: "number", default: "1" },
        { key: "force", label: "Force", type: "boolean", default: "false" },
      ],
      handles: [flowIn, flowOut, valueIn("particle", "Particle", "particle")],
      build: (d) => [`particle ${d.particle} ${d.pos || "~ ~ ~"} ${d.delta || "0 0 0"} ${d.speed || "0"} ${d.count || "1"}${d.force === "true" ? " force" : ""}`],
    },
    {
      type: "playsound",
      category: "world",
      label: "Play Sound",
      description: "Plays a sound for players.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "sound", label: "Sound", type: "sound", required: true, registry: "sounds", default: "minecraft:block.note_block.pling" },
        { key: "source", label: "Source", type: "select", options: ["master", "music", "record", "weather", "block", "hostile", "neutral", "player", "ambient", "voice"].map((v) => ({ value: v, label: v })), default: "master" },
        { key: "targets", label: "Targets", type: "selector", default: "@a" },
        { key: "pos", label: "Position", type: "position", default: "~ ~ ~" },
        { key: "volume", label: "Volume", type: "number", default: "1.0" },
        { key: "pitch", label: "Pitch", type: "number", default: "1.0" },
      ],
      handles: [flowIn, flowOut, valueIn("sound", "Sound", "sound")],
      build: (d) => [`playsound ${d.sound} ${d.source || "master"} ${d.targets || "@a"} ${d.pos || "~ ~ ~"} ${d.volume || "1.0"} ${d.pitch || "1.0"}`],
    },
    {
      type: "setblock",
      category: "world",
      label: "Set Block",
      description: "Sets a block at a position.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "pos", label: "Position", type: "position", required: true, default: "~ ~ ~" },
        { key: "block", label: "Block", type: "block", required: true, registry: "blocks", default: "minecraft:stone" },
        { key: "mode", label: "Mode", type: "select", options: ["", "destroy", "keep", "replace"].map((v) => ({ value: v, label: v || "default" })), default: "" },
      ],
      handles: [flowIn, flowOut, valueIn("block", "Block", "block")],
      build: (d) => [`setblock ${d.pos} ${d.block}${d.mode ? " " + d.mode : ""}`],
    },
    {
      type: "fill",
      category: "world",
      label: "Fill",
      description: "Fills a region with a block.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "from", label: "From", type: "position", required: true },
        { key: "to", label: "To", type: "position", required: true },
        { key: "block", label: "Block", type: "block", required: true, registry: "blocks", default: "minecraft:stone" },
        { key: "mode", label: "Mode", type: "select", options: ["", "destroy", "hollow", "outline", "keep", "replace"].map((v) => ({ value: v, label: v || "default" })), default: "" },
      ],
      handles: [flowIn, flowOut, valueIn("block", "Block", "block")],
      build: (d) => [`fill ${d.from} ${d.to} ${d.block}${d.mode ? " " + d.mode : ""}`],
    },
    {
      type: "gamerule",
      category: "world",
      label: "Gamerule",
      description: "Sets a game rule.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "rule", label: "Rule", type: "select", options: ["doDaylightCycle", "keepInventory", "doMobSpawning", "mobGriefing", "doWeatherCycle", "commandBlockOutput"].map((v) => ({ value: v, label: v })), required: true },
        { key: "value", label: "Value", type: "text", required: true },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`gamerule ${d.rule} ${d.value}`],
    },
    // ---------------- DATA ----------------
    {
      type: "data_set",
      category: "data",
      label: "Data Set",
      description: "Sets NBT data on a target.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "targetType", label: "Target Type", type: "select", options: ["block", "entity", "storage"].map((v) => ({ value: v, label: v })), default: "entity" },
        { key: "target", label: "Target", type: "text", required: true },
        { key: "path", label: "Path", type: "text" },
        { key: "value", label: "NBT Value", type: "text" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`data merge ${d.targetType} ${d.target} ${d.value}`],
    },
    // ---------------- ADVANCEMENT ----------------
    {
      type: "grant_advancement",
      category: "advancement",
      label: "Grant Advancement",
      description: "Grants an advancement.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "targets", label: "Targets", type: "selector", default: "@a" },
        { key: "advancement", label: "Advancement", type: "text", required: true },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`advancement grant ${d.targets} only ${d.advancement}`],
    },
    {
      type: "revoke_advancement",
      category: "advancement",
      label: "Revoke Advancement",
      description: "Revokes an advancement.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "targets", label: "Targets", type: "selector", default: "@a" },
        { key: "advancement", label: "Advancement", type: "text", required: true },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`advancement revoke ${d.targets} only ${d.advancement}`],
    },
    // ---------------- SPECIAL ----------------
    {
      type: "custom_command",
      category: "utility",
      label: "Custom Command",
      description: "Escape hatch for arbitrary Minecraft commands.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [{ key: "command", label: "Command", type: "text", required: true }],
      handles: [flowIn, flowOut],
      build: (d) => [d.command],
    },
    {
      type: "comment",
      category: "utility",
      label: "Comment",
      description: "A visual note (not compiled).",
      hasExecIn: false,
      hasExecOut: false,
      fields: [{ key: "text", label: "Comment", type: "text" }],
      handles: [],
      build: () => [],
    },
    {
      type: "return",
      category: "flow",
      label: "Return",
      description: "Returns from the function (stops execution).",
      hasExecIn: true,
      hasExecOut: true,
      fields: [{ key: "value", label: "Return value", type: "text", default: "0" }],
      handles: [flowIn, flowOut],
      build: (d) => [`return ${d.value || "0"}`],
    },
    // ---------------- ENTITY ACTIONS ----------------
    {
      type: "damage",
      category: "entity",
      label: "Damage Entity",
      description: "Deals damage to target entities.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@e[distance=..5]" },
        { key: "amount", label: "Amount", type: "number", required: true, default: "5" },
        { key: "type", label: "Damage Type", type: "text", default: "minecraft:generic" },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: (d) => [`damage ${d.target} ${d.amount}${d.type ? " " + d.type : ""}`],
    },
    {
      type: "effect_clear",
      category: "entity",
      label: "Clear Effect",
      description: "Removes a status effect (or all).",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "target", label: "Target", type: "selector", default: "@s" },
        { key: "effect", label: "Effect", type: "effect", registry: "effects" },
      ],
      handles: [flowIn, flowOut, valueIn("target", "Target", "selector")],
      build: (d) => [`effect clear ${d.target}${d.effect ? " " + d.effect : ""}`],
    },
    // ---------------- WORLD ----------------
    {
      type: "clone",
      category: "world",
      label: "Clone Blocks",
      description: "Copies blocks between regions.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "from", label: "From", type: "position", required: true },
        { key: "to", label: "To", type: "position", required: true },
        { key: "dest", label: "Destination", type: "position", required: true },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`clone ${d.from} ${d.to} ${d.dest}`],
    },
    {
      type: "weather",
      category: "world",
      label: "Weather",
      description: "Sets the weather.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "weather", label: "Weather", type: "select", options: ["clear", "rain", "thunder"].map((v) => ({ value: v, label: v })), default: "clear" },
        { key: "duration", label: "Duration (s)", type: "number" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`weather ${d.weather}${d.duration ? " " + d.duration : ""}`],
    },
    {
      type: "time",
      category: "world",
      label: "Time",
      description: "Sets or queries the world time.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "action", label: "Action", type: "select", options: ["set", "add", "query"].map((v) => ({ value: v, label: v })), default: "set" },
        { key: "value", label: "Value", type: "text", default: "day" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`time ${d.action} ${d.value}`],
    },
    // ---------------- DATA ----------------
    {
      type: "data_get",
      category: "data",
      label: "Data Get",
      description: "Reads NBT data from a target.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "targetType", label: "Target Type", type: "select", options: ["block", "entity", "storage"].map((v) => ({ value: v, label: v })), default: "entity" },
        { key: "target", label: "Target", type: "text", required: true },
        { key: "path", label: "Path", type: "text" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`data get ${d.targetType} ${d.target}${d.path ? " " + d.path : ""}`],
    },
    {
      type: "data_modify",
      category: "data",
      label: "Data Modify",
      description: "Modifies NBT data at a path.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "targetType", label: "Target Type", type: "select", options: ["block", "entity", "storage"].map((v) => ({ value: v, label: v })), default: "entity" },
        { key: "target", label: "Target", type: "text", required: true },
        { key: "path", label: "Path", type: "text" },
        { key: "action", label: "Action", type: "select", options: ["set", "append", "merge", "remove", "insert"].map((v) => ({ value: v, label: v })), default: "set" },
        { key: "value", label: "Value", type: "text" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`data modify ${d.targetType} ${d.target} ${d.path} ${d.action} ${d.value}`],
    },
    {
      type: "data_remove",
      category: "data",
      label: "Data Remove",
      description: "Removes NBT data at a path.",
      hasExecIn: true,
      hasExecOut: true,
      fields: [
        { key: "targetType", label: "Target Type", type: "select", options: ["block", "entity", "storage"].map((v) => ({ value: v, label: v })), default: "entity" },
        { key: "target", label: "Target", type: "text", required: true },
        { key: "path", label: "Path", type: "text" },
      ],
      handles: [flowIn, flowOut],
      build: (d) => [`data remove ${d.targetType} ${d.target} ${d.path}`],
    },

    // ---------------- VALUE PROVIDERS ----------------
    {
      type: "selector_provider",
      category: "entity",
      label: "Selector",
      description: "Produces an entity selector value.",
      hasExecIn: false,
      hasExecOut: false,
      fields: [
        { key: "target", label: "Selector", type: "selector", default: "@a" },
        { key: "advanced", label: "Advanced Selector", type: "text", description: "e.g. @e[type=zombie,distance=..10]" },
      ],
      handles: [valueOut("target", "Selector", "selector")],
      build: () => [],
      getValue: (d) => (d.advanced || d.target || "@a"),
    },
    {
      type: "particle_provider",
      category: "world",
      label: "Particle Value",
      description: "Produces a particle id value.",
      hasExecIn: false,
      hasExecOut: false,
      fields: [{ key: "particle", label: "Particle", type: "particle", required: true, registry: "particles" }],
      handles: [valueOut("particle", "Particle", "particle")],
      build: () => [],
      getValue: (d) => d.particle,
    },
    {
      type: "entity_provider",
      category: "entity",
      label: "Entity Value",
      description: "Produces an entity type value.",
      hasExecIn: false,
      hasExecOut: false,
      fields: [{ key: "entity", label: "Entity", type: "entity", required: true, registry: "entities" }],
      handles: [valueOut("entity", "Entity", "entity")],
      build: () => [],
      getValue: (d) => d.entity,
    },
    {
      type: "position_provider",
      category: "world",
      label: "Position Value",
      description: "Produces a position value.",
      hasExecIn: false,
      hasExecOut: false,
      fields: [{ key: "pos", label: "Position", type: "position", required: true, default: "~ ~ ~" }],
      handles: [valueOut("pos", "Position", "position")],
      build: () => [],
      getValue: (d) => d.pos,
    },
    {
      type: "number_provider",
      category: "logic",
      label: "Number Value",
      description: "Produces a numeric value.",
      hasExecIn: false,
      hasExecOut: false,
      fields: [{ key: "value", label: "Value", type: "number", required: true, default: "1" }],
      handles: [valueOut("value", "Value", "number")],
      build: () => [],
      getValue: (d) => d.value,
    },
    {
      type: "objective_provider",
      category: "scoreboard",
      label: "Objective Value",
      description: "Produces a scoreboard objective name.",
      hasExecIn: false,
      hasExecOut: false,
      fields: [{ key: "objective", label: "Objective", type: "objective", required: true }],
      handles: [valueOut("objective", "Objective", "objective")],
      build: () => [],
      getValue: (d) => d.objective,
    },
  ];

  const out: Record<string, NodeTypeDef> = {};
  for (const d of defs) out[d.type] = d;
  return out;
}

// Registry is version-independent structurally; build functions receive the
// adapter at compile time. We keep a singleton registry keyed by nothing (the
// node *types* are fixed; values are validated at compile time via the adapter).
let cachedRegistry: Record<string, NodeTypeDef> | null = null;

export function getNodeRegistry(_adapter?: VersionAdapter): Record<string, NodeTypeDef> {
  if (!cachedRegistry) cachedRegistry = buildRegistry(_adapter as any);
  return cachedRegistry;
}

export function getNodeDef(type: string): NodeTypeDef | undefined {
  return getNodeRegistry()[type];
}

export function nodeCategories(): NodeCategory[] {
  return ["flow", "function", "execution", "scoreboard", "entity", "world", "data", "logic", "advancement", "utility"];
}
