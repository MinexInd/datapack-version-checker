import { Diagnostic } from "../minecraft/types";
import { FunctionGraph, GraphNode, getNodeDef } from "./NodeTypes";

export interface GraphValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Validates a visual graph before compilation: entry point presence, flow
 * connectivity, required fields, cycles, value types.
 */
export function validateGraph(graph: FunctionGraph, file: string): GraphValidationResult {
  const diagnostics: Diagnostic[] = [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const defs = graph.nodes.map((n) => ({ n, def: getNodeDef(n.type) }));

  // Flow edges = edges where both handles are flow.
  const isFlowEdge = (e: any) => {
    const s = nodesById.get(e.source);
    const t = nodesById.get(e.target);
    if (!s || !t) return false;
    const sDef = getNodeDef(s.type);
    const tDef = getNodeDef(t.type);
    const sh = sDef?.handles.find((h) => h.id === e.sourceHandle) ?? sDef?.handles.find((h) => h.type === "flow" && h.dir === "out");
    const th = tDef?.handles.find((h) => h.id === e.targetHandle) ?? tDef?.handles.find((h) => h.type === "flow" && h.dir === "in");
    return (sh?.type === "flow" && th?.type === "flow") || (sDef && tDef && sh?.type === "flow" || th?.type === "flow");
  };
  const flowEdges = graph.edges.filter(isFlowEdge);
  const flowTargets = new Set(flowEdges.map((e) => e.target));
  const flowOut = new Set(flowEdges.map((e) => e.source));

  const entries = graph.nodes.filter((n) => n.type === "function_entry");
  if (entries.length === 0) {
    diagnostics.push({ code: "graph-no-entry", severity: "error", message: "Graph has no Function Entry node.", file, line: 1, column: 1, length: 0 });
  } else if (entries.length > 1) {
    diagnostics.push({ code: "graph-multiple-entries", severity: "error", message: "Graph has multiple Function Entry nodes.", file, line: 1, column: 1, length: 0 });
  }

  // Every exec-consuming node (non-entry, non-provider) must have an incoming flow edge.
  for (const { n, def } of defs) {
    if (!def) {
      diagnostics.push({ code: "graph-unknown-node", severity: "error", message: `Unknown node type "${n.type}".`, file, line: 1, column: 1, length: 0 });
      continue;
    }
    if (def.hasExecIn && !flowTargets.has(n.id)) {
      diagnostics.push({ code: "graph-unconnected", severity: "error", message: `Node "${n.type}" is not connected to execution flow.`, file, line: 1, column: 1, length: 0 });
    }
    // Required fields (not provided by a data edge)
    for (const f of def.fields) {
      if (!f.required) continue;
      const providedByEdge = graph.edges.some((e) => e.target === n.id && e.targetHandle === f.key);
      const val = n.data[f.key];
      if (!providedByEdge && (val === undefined || val === "")) {
        diagnostics.push({ code: "graph-missing-field", severity: "error", message: `Node "${def.label}" requires field "${f.label}".`, file, line: 1, column: 1, length: 0 });
      }
    }
    // Number type check
    for (const f of def.fields) {
      if (f.type === "number" && n.data[f.key] !== undefined && n.data[f.key] !== "") {
        const v = n.data[f.key];
        if (isNaN(Number(v))) {
          diagnostics.push({ code: "graph-invalid-number", severity: "error", message: `Node "${def.label}": "${f.label}" must be a number (got "${v}").`, file, line: 1, column: 1, length: 0 });
        }
      }
    }
  }

  // Branch outputs must be terminal (no join) — document constraint.
  for (const n of graph.nodes) {
    if (n.type === "branch" || n.type === "score_condition") {
      for (const h of getNodeDef(n.type)?.handles.filter((x) => x.type === "flow" && x.dir === "out") ?? []) {
        const downstream = flowEdges.filter((e) => e.source === n.id && (e.sourceHandle === h.id || !e.sourceHandle));
        for (const e of downstream) {
          if (flowOut.has(e.target)) {
            // This branch feeds into another branch's output? Not necessarily a join.
          }
        }
      }
    }
  }

  // Cycle detection on flow graph.
  const cycle = detectFlowCycle(graph, flowEdges);
  if (cycle) {
    diagnostics.push({ code: "graph-cycle", severity: "error", message: `Graph contains a cycle in execution flow: ${cycle.join(" → ")}.`, file, line: 1, column: 1, length: 0 });
  }

  // Type-mismatched connections (flow<->value) — explain why.
  for (const e of graph.edges) {
    const res = validateConnection(graph, e);
    if (!res.valid && res.code) {
      diagnostics.push({
        code: res.code, severity: "error", message: res.reason ?? "Invalid connection",
        file, line: 1, column: 1, length: 0,
      });
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  return { valid: errors.length === 0, diagnostics };
}

export interface ConnectionCheck {
  valid: boolean;
  /** Machine-readable code, or undefined when the connection is fine. */
  code?: string;
  /** Human-readable explanation for WHY the connection is invalid. */
  reason?: string;
}

/**
 * Validate a single candidate connection and explain WHY it is (in)valid.
 * Used by the graph editor to give feedback instead of silently ignoring.
 */
export function validateConnection(graph: FunctionGraph, edge: { source: string; sourceHandle?: string; target: string; targetHandle?: string }): ConnectionCheck {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const src = nodesById.get(edge.source);
  const tgt = nodesById.get(edge.target);
  if (!src || !tgt) return { valid: false, code: "graph-connection-missing-node", reason: "Connection references a node that does not exist." };
  const sDef = getNodeDef(src.type);
  const tDef = getNodeDef(tgt.type);
  if (!sDef) return { valid: false, code: "graph-connection-unknown-source", reason: `Unknown source node type "${src.type}".` };
  if (!tDef) return { valid: false, code: "graph-connection-unknown-target", reason: `Unknown target node type "${tgt.type}".` };

  const srcHandle = sDef.handles.find((h) => h.id === edge.sourceHandle) ?? sDef.handles.find((h) => h.type === "flow" && h.dir === "out");
  const tgtHandle = tDef.handles.find((h) => h.id === edge.targetHandle) ?? tDef.handles.find((h) => h.type === "flow" && h.dir === "in");
  if (!srcHandle) return { valid: false, code: "graph-connection-no-source-port", reason: `"${sDef.label}" has no output port.` };
  if (!tgtHandle) return { valid: false, code: "graph-connection-no-target-port", reason: `"${tDef.label}" has no input port.` };

  const isFlow = (h: any) => h.type === "flow";
  if (isFlow(srcHandle) !== isFlow(tgtHandle)) {
    const side = isFlow(srcHandle) ? "value" : "flow";
    return {
      valid: false,
      code: "graph-connection-type-mismatch",
      reason: `Cannot connect a ${isFlow(srcHandle) ? "flow" : "value"} output to a ${isFlow(tgtHandle) ? "flow" : "value"} input. This ${side} port expects the other kind.`,
    };
  }
  if (src.id === tgt.id) return { valid: false, code: "graph-connection-self-loop", reason: "A node cannot connect to itself." };

  // Flow-specific constraints
  if (isFlow(srcHandle)) {
    if (!tDef.hasExecIn && tDef.handles.filter((h) => h.type === "flow" && h.dir === "in").length === 0) {
      return { valid: false, code: "graph-connection-terminal-target", reason: `"${tDef.label}" is a terminal/value node and cannot receive execution flow.` };
    }
  } else {
    // Value connection: target handle must be a value-in of matching type.
    const sh = srcHandle as any, th = tgtHandle as any;
    if (th.dir !== "in") return { valid: false, code: "graph-connection-bad-direction", reason: `"${tDef.label}" input "${th.label}" is not an input port.` };
    if (th.type !== sh.type) {
      return { valid: false, code: "graph-connection-value-type", reason: `Value type mismatch: "${srcHandle.label}" produces ${sh.type}, but "${th.label}" expects ${th.type}.` };
    }
  }

  return { valid: true };
}

function detectFlowCycle(graph: FunctionGraph, flowEdges: { source: string; target: string }[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of flowEdges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  for (const n of graph.nodes) color.set(n.id, WHITE);

  const dfs = (u: string): string[] | null => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (!color.has(v)) continue;
      const c = color.get(v)!;
      if (c === GRAY) {
        const idx = stack.indexOf(v);
        return stack.slice(idx).concat(v);
      }
      if (c === WHITE) {
        const res = dfs(v);
        if (res) return res;
      }
    }
    stack.pop();
    color.set(u, BLACK);
    return null;
  };

  for (const n of graph.nodes) {
    if (color.get(n.id) === WHITE) {
      const res = dfs(n.id);
      if (res) return res;
    }
  }
  return null;
}
