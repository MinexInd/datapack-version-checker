import { Diagnostic, VersionAdapter } from "../minecraft/types";
import {
  FunctionGraph,
  GraphNode,
  GraphEdge,
  getNodeDef,
} from "../graph/NodeTypes";
import { validateGraph } from "../graph/GraphValidator";

export interface SourceMapEntry {
  commandIndex: number;
  nodeId: string;
  /** Source range of the original command this node came from (if any). */
  range?: { line: number; start: number; end: number };
  /** Original raw command text. */
  raw?: string;
}

export interface GeneratedFunction {
  /** namespace:path id of the generated function. */
  id: string;
  /** Path within namespace, e.g. "spells/fireball". */
  path: string;
  commands: string[];
  /** Maps each generated command index to the graph node that produced it. */
  sourceMap: SourceMapEntry[];
}

export interface GraphCompileResult {
  valid: boolean;
  diagnostics: Diagnostic[];
  /** The main generated function. */
  main: GeneratedFunction;
  /** Helper functions generated for control flow / branches. */
  helpers: GeneratedFunction[];
}

export interface CompileOptions {
  namespace: string;
  /** Base path, e.g. "spells/fireball" — helpers derive names from this. */
  basePath: string;
  adapter: VersionAdapter;
}

/**
 * Deterministic compilation of a visual graph into .mcfunction commands.
 *
 * - Linear flow compiles into a single function.
 * - Execution-context nodes (execute_as/at/positioned/condition/facing/rotated/anchored)
 *   accumulate into a single `execute … run <action>` command.
 * - Control-flow branch nodes (branch, score_condition) compile to mutually-exclusive
 *   helper functions. Their `out` continuation is compiled back into the main function,
 *   so a branch whose outputs later rejoin is supported (the join is the main flow that
 *   continues after the two helper calls return).
 * - Output is deterministic: same graph + same version => same command text.
 */
export function compileGraph(graph: FunctionGraph, opts: CompileOptions): GraphCompileResult {
  const file = `data/${opts.namespace}/function/${opts.basePath}.mcfunction`;
  const validation = validateGraph(graph, file);
  const diagnostics = [...validation.diagnostics];

  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const helpers: GeneratedFunction[] = [];
  const main: GeneratedFunction = { id: `${opts.namespace}:${opts.basePath}`, path: opts.basePath, commands: [], sourceMap: [] };
  let helperCounter = 0;

  const entry = graph.nodes.find((n) => n.type === "function_entry");
  if (!entry) {
    diagnostics.push({ code: "graph-no-entry", severity: "error", message: "Cannot compile: no Function Entry node.", file, line: 1, column: 1, length: 0 });
    return { valid: false, diagnostics, main, helpers };
  }

  // data-edge resolution: valueIn handle -> value from source node's getValue.
  const resolveData = (node: GraphNode): Record<string, string> => {
    const def = getNodeDef(node.type);
    const data = { ...node.data };
    if (!def) return data;
    for (const edge of graph.edges) {
      if (edge.target !== node.id) continue;
      const src = nodesById.get(edge.source);
      if (!src) continue;
      const srcDef = getNodeDef(src.type);
      const targetHandle = edge.targetHandle ?? def.handles.find((h) => h.dir === "in")?.id;
      const isDataHandle = def.handles.find((h) => h.id === targetHandle && h.type !== "flow");
      if (isDataHandle && srcDef?.getValue) {
        data[targetHandle!] = srcDef.getValue(src.data);
      }
    }
    return data;
  };

  // flow edges out of a node: { child, handle }
  const flowChildren = (nodeId: string): { child: GraphNode; handle: string }[] => {
    const out: { child: GraphNode; handle: string }[] = [];
    for (const edge of graph.edges) {
      if (edge.source !== nodeId) continue;
      const child = nodesById.get(edge.target);
      if (!child) continue;
      out.push({ child, handle: edge.sourceHandle ?? "out" });
    }
    return out;
  };

  const emitCommand = (target: GeneratedFunction, cmd: string, node: GraphNode, pending: string[]) => {
    if (!cmd) return;
    const full = pending.length > 0 ? `execute ${pending.join(" ")} run ${cmd}` : cmd;
    target.commands.push(full);
    target.sourceMap.push({
      commandIndex: target.commands.length - 1,
      nodeId: node.id,
      range: node.meta?.range,
      raw: node.meta?.raw,
    });
  };

  const emitNode = (node: GraphNode, target: GeneratedFunction, pending: string[]) => {
    const def = getNodeDef(node.type);
    if (!def) return;
    if (def.getValue) return; // value provider emits no command
    const data = resolveData(node);
    const commands = def.build(data, opts.adapter);
    for (const c of commands) emitCommand(target, c, node, pending);
  };

  const compileSubgraph = (start: GraphNode, target: GeneratedFunction, visited: Set<string>, pending: string[]): void => {
    if (visited.has(start.id)) return;
    visited.add(start.id);
    const def = getNodeDef(start.type);
    if (!def) return;

    // Execution-context node: accumulate into the pending prefix and continue.
    if (def.getClause) {
      const clause = def.getClause(resolveData(start));
      const nextPending = clause ? [...pending, clause] : pending;
      for (const ch of flowChildren(start.id)) {
        compileSubgraph(ch.child, target, visited, nextPending);
      }
      return;
    }

    if (start.type === "branch" || start.type === "score_condition") {
      compileBranch(start, target, pending, visited);
      return;
    }

    emitNode(start, target, pending);
    // Execution context is consumed by this action; downstream starts fresh.
    for (const ch of flowChildren(start.id)) {
      compileSubgraph(ch.child, target, visited, []);
    }
  };

  const compileBranch = (branch: GraphNode, target: GeneratedFunction, pending: string[], visited: Set<string>): void => {
    const def = getNodeDef(branch.type)!;
    const data = resolveData(branch);
    const condition = def.getCondition?.(data) ?? "entity @s";
    const polarity = branch.data.polarity === "unless" ? "unless" : "if";
    const prefix = pending.join(" ") ? pending.join(" ") + " " : "";

    const children = flowChildren(branch.id);
    const byHandle = new Map<string, GraphNode>();
    for (const c of children) byHandle.set(c.handle, c.child);

    const trueChild = byHandle.get("true_out") ?? children.find((c) => !byHandle.has("false_out"))?.child;
    const falseChild = byHandle.get("false_out");
    const joinChild = byHandle.get("out") as GraphNode | undefined; // continuation after the branch
    const continuationId: string = joinChild?.id ?? "";

    if (trueChild) {
      helperCounter++;
      const helper: GeneratedFunction = { id: `${opts.namespace}:${opts.basePath}__b${helperCounter}`, path: `${opts.basePath}__b${helperCounter}`, commands: [], sourceMap: [] };
      // Tag generated helpers with metadata so they can be recognized/reconstructed.
      helper.commands.push(`# @ds-branch parent=${opts.basePath} kind=if id=${helperCounter} continuation=${continuationId}`);
      compileSubgraph(trueChild, helper, new Set(), []);
      helpers.push(helper);
      emitCommand(target, `execute ${prefix}${polarity} ${condition} run function ${helper.id}`, branch, []);
    }
    if (falseChild) {
      helperCounter++;
      const helper: GeneratedFunction = { id: `${opts.namespace}:${opts.basePath}__f${helperCounter}`, path: `${opts.basePath}__f${helperCounter}`, commands: [], sourceMap: [] };
      helper.commands.push(`# @ds-branch parent=${opts.basePath} kind=else id=${helperCounter} continuation=${continuationId}`);
      compileSubgraph(falseChild, helper, new Set(), []);
      helpers.push(helper);
      const notPolarity = polarity === "if" ? "unless" : "if";
      emitCommand(target, `execute ${prefix}${notPolarity} ${condition} run function ${helper.id}`, branch, []);
    }

    // Join: after both helpers return, execution continues in the main function.
    if (joinChild) {
      compileSubgraph(joinChild, target, visited, []);
    }
  };

  compileSubgraph(entry, main, new Set(), []);

  return { valid: validation.valid, diagnostics, main, helpers };
}
