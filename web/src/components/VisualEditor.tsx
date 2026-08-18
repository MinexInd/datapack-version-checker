import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { getNodeDef, getNodeRegistry, nodeCategories, type GraphNode, type GraphEdge, type FunctionGraph } from '../visual/core/graph/NodeTypes'
import { compileGraph } from '../visual/core/compiler/GraphCompiler'
import { createAdapter, resolveVersion, getDefaultVersion } from '../visual/core/minecraft/catalog'
import { parseFunction } from '../visual/core/parser/McFunctionParser'
import { decompileFunction } from '../visual/core/decompiler/GraphDecompiler'
import LiveEditor from './editors/LiveEditor'
import type { BeforeMount, OnMount } from '@monaco-editor/react'
import type { Diagnostic } from '../visual/core/minecraft/types'
import { Icon } from "./Icon";

interface VisualEditorProps {
  activePath: string
  initialContent: string
  version?: string
  onCommit: (next: string) => void
  beforeMount: BeforeMount
  onMount: OnMount
}

// VNode edits must land in the SAME local useNodesState that <ReactFlow> renders
// from and that doCompile() reads. We pass the local setNodes down through this
// context instead of calling useReactFlow().setNodes (which writes a detached
// store in controlled mode).
const UpdateNodeDataContext = createContext<(id: string, key: string, value: string | boolean) => void>(() => {})

function mcfunctionNamespaceBase(path: string): { namespace: string; basePath: string } {
  const m = path.match(/^data\/([^/]+)\/function\/(.+)\.mcfunction$/)
  if (m) return { namespace: m[1], basePath: m[2] }
  const m2 = path.match(/^data\/([^/]+)\/(.+)$/)
  if (m2) return { namespace: m2[1], basePath: m2[2].replace(/\.mcfunction$/, '') }
  return { namespace: 'pack', basePath: 'visual/function' }
}

// Fallback when the semantic decompiler cannot run: one custom_command per line.
function seedGraphFallback(text: string): { nodes: Node[]; edges: Edge[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const nodes: Node[] = []
  const edges: Edge[] = []
  nodes.push({ id: 'entry', type: 'vnode', position: { x: 40, y: 20 }, data: { kind: 'function_entry' } })
  let prev = 'entry'
  lines.forEach((line, i) => {
    const id = 'cmd_' + i
    nodes.push({ id, type: 'vnode', position: { x: 40, y: 90 + i * 86 }, data: { kind: 'custom_command', command: line } })
    edges.push({ id: 'e_' + i, source: prev, sourceHandle: 'out', target: id, targetHandle: 'in' })
    prev = id
  })
  return { nodes, edges }
}

// CODE -> GRAPH: parse the .mcfunction text into IR, then decompile into
// semantic nodes (give/effect/summon/execute-*/scoreboard/...) instead of a wall
// of custom_command nodes. Falls back to the line-based graph on any parse error.
function textToGraph(text: string, version: string | undefined, namespace: string, basePath: string): { nodes: Node[]; edges: Edge[] } {
  try {
    let adapter
    try {
      adapter = version ? createAdapter(resolveVersion(version)) : createAdapter(getDefaultVersion())
    } catch {
      adapter = createAdapter(getDefaultVersion())
    }
    const fnIR = parseFunction(text, namespace, basePath, adapter)
    const { graph } = decompileFunction(fnIR)
    return {
      nodes: graph.nodes.map((n) => ({ id: n.id, type: 'vnode', position: n.position, data: { kind: n.type, ...n.data } })),
      edges: graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? 'out',
        target: e.target,
        targetHandle: e.targetHandle ?? 'in',
      })),
    }
  } catch {
    return seedGraphFallback(text)
  }
}

function VNode({ id, data, selected }: NodeProps) {
  const updateNodeData = useContext(UpdateNodeDataContext)
  const def = getNodeDef((data as any).kind)
  if (!def) return <div className="vnode vnode-unknown">Unknown node</div>

  const setField = (key: string, value: string | boolean) => updateNodeData(id, key, value)

  const flowIn = def.handles.filter((h) => h.type === 'flow' && h.dir === 'in')
  const flowOut = def.handles.filter((h) => h.type === 'flow' && h.dir === 'out')
  const dataIn = def.handles.filter((h) => h.type !== 'flow' && h.dir === 'in')
  const dataOut = def.handles.filter((h) => h.type !== 'flow' && h.dir === 'out')

  return (
    <div className={`vnode vnode-cat-${def.category}${selected ? ' selected' : ''}`}>
      <div className="vnode-head">
        <span className="vnode-cat">{def.category}</span>
        <span className="vnode-label">{def.label}</span>
      </div>
      <div className="vnode-fields">
        {def.fields.map((f) => (
          <label key={f.key} className="vnode-field">
            <span className="vnode-field-label">{f.label}</span>
            {f.type === 'select' ? (
              <select className="vnode-input" value={(data as any)[f.key] ?? f.default ?? ''} onChange={(e) => setField(f.key, e.target.value)}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.type === 'boolean' ? (
              <input type="checkbox" className="vnode-input" checked={!!(data as any)[f.key]} onChange={(e) => setField(f.key, e.target.checked)} />
            ) : (
              <input type="text" className="vnode-input" value={(data as any)[f.key] ?? f.default ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      {flowIn.map((h) => (
        <Handle key={h.id} type="target" position={Position.Left} id={h.id} title={h.label} className="vf-handle vf-handle-flow" />
      ))}
      {flowOut.map((h) => (
        <Handle key={h.id} type="source" position={Position.Right} id={h.id} title={h.label} className="vf-handle vf-handle-flow" />
      ))}
      {dataIn.map((h, i) => (
        <Handle key={h.id} type="target" position={Position.Top} id={h.id} title={h.label} className="vf-handle vf-handle-data" style={{ left: `${20 + i * 26}%` }} />
      ))}
      {dataOut.map((h, i) => (
        <Handle key={h.id} type="source" position={Position.Bottom} id={h.id} title={h.label} className="vf-handle vf-handle-data" style={{ left: `${20 + i * 26}%` }} />
      ))}
    </div>
  )
}

const nodeTypes = { vnode: VNode }

interface CtxMenu { x: number; y: number; kind: 'node' | 'edge'; id: string }

function VisualEditorInner({ activePath, initialContent, version, onCommit, beforeMount, onMount }: VisualEditorProps) {
  const [mode, setMode] = useState<'code' | 'visual'>('visual')
  const [menu, setMenu] = useState<CtxMenu | null>(null)
  const buildGraph = useCallback(
    (text: string) => {
      const { namespace, basePath } = mcfunctionNamespaceBase(activePath)
      return textToGraph(text, version, namespace, basePath)
    },
    [activePath, version],
  )
  const seed = useMemo(() => buildGraph(initialContent), []) // mount-only; live text edits reseed via effect
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(seed.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed.edges)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [compiled, setCompiled] = useState<string>('')
  const lastCommittedRef = useRef(initialContent)

  const updateNodeData = useCallback(
    (id: string, key: string, value: string | boolean) =>
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, [key]: value } } : n))),
    [setNodes],
  )

  // The .mcfunction text is the source of truth: reseed the graph only when the
  // file changes for reasons OTHER than our own compile.
  useEffect(() => {
    if (initialContent === lastCommittedRef.current) return
    lastCommittedRef.current = initialContent
    const g = buildGraph(initialContent)
    setNodes(g.nodes)
    setEdges(g.edges)
  }, [initialContent, buildGraph, setNodes, setEdges])

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges])

  const addNode = useCallback((kind: string) => {
    const id = 'n_' + Math.random().toString(36).slice(2, 9)
    setNodes((nds) => [...nds, {
      id,
      type: 'vnode',
      position: { x: 320 + (nds.length % 6) * 60, y: 40 + (nds.length % 10) * 70 },
      data: { kind },
    }])
  }, [setNodes])

  const deleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
  }, [setNodes, setEdges])

  const duplicateNodes = useCallback((ids: string[]) => {
    if (!ids.length) return
    const idMap = new Map(ids.map((id) => [id, 'n_' + Math.random().toString(36).slice(2, 9)]))
    setNodes((nds) => {
      const copies = nds
        .filter((n) => ids.includes(n.id))
        .map((n) => ({ ...n, id: idMap.get(n.id)!, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: false, data: { ...n.data } }))
      return [...nds, ...copies]
    })
    setEdges((eds) => {
      const sel = new Set(ids)
      const copies = eds.filter((e) => sel.has(e.source) && sel.has(e.target)).map((e) => ({
        ...e,
        id: 'e_' + Math.random().toString(36).slice(2, 9),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      }))
      return [...eds, ...copies]
    })
  }, [setNodes, setEdges])

  const duplicateSelected = useCallback(() => {
    duplicateNodes(nodes.filter((n) => n.selected).map((n) => n.id))
  }, [nodes, duplicateNodes])

  // Ctrl/Cmd+D duplicates the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        const sel = nodes.filter((n) => n.selected)
        if (sel.length) {
          e.preventDefault()
          duplicateNodes(sel.map((n) => n.id))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodes, duplicateNodes])

  const doCompile = useCallback(() => {
    const graph: FunctionGraph = {
      nodes: nodes.map((n) => ({ id: n.id, type: (n.data as any).kind, position: n.position, data: (n.data as any) } as GraphNode)),
      edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? undefined, target: e.target, targetHandle: e.targetHandle ?? undefined } as GraphEdge)),
    }
    let v
    try {
      v = version ? resolveVersion(version) : getDefaultVersion()
    } catch {
      v = getDefaultVersion()
    }
    const adapter = createAdapter(v)
    const { namespace, basePath } = mcfunctionNamespaceBase(activePath)
    const res = compileGraph(graph, { namespace, basePath, adapter })
    setDiagnostics(res.diagnostics)
    const text = res.main.commands.join('\n')
    setCompiled(text)
    lastCommittedRef.current = text
    onCommit(text)
  }, [nodes, edges, version, activePath, onCommit])

  const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, kind: 'node', id: node.id })
  }, [])
  const onEdgeContextMenu: EdgeMouseHandler = useCallback((e, edge) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, kind: 'edge', id: edge.id })
  }, [])
  const closeMenu = useCallback(() => setMenu(null), [])

  const categories = nodeCategories()
  const registry = getNodeRegistry()

  return (
    <UpdateNodeDataContext.Provider value={updateNodeData}>
      <div className="visual-editor" onClick={closeMenu}>
        <div className="visual-editor-bar">
          <div className="visual-mode-toggle" role="group" aria-label="Editor mode">
            <button type="button" className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}>Code</button>
            <button type="button" className={mode === 'visual' ? 'active' : ''} onClick={() => setMode('visual')}>Visual</button>
          </div>
          <button type="button" className="visual-compile" onClick={doCompile}>Compile <Icon name="play" size={14} /></button>
          <span className="visual-hint">Visual scripting compiles to .mcfunction</span>
        </div>
        {mode === 'code' ? (
          <LiveEditor activePath={activePath} initialContent={initialContent} language="mcfunction" onCommit={onCommit} beforeMount={beforeMount} onMount={onMount} />
        ) : (
          <div className="visual-body">
            <aside className="visual-palette">
              <div className="visual-palette-title">Nodes</div>
              {categories.map((cat) => (
                <div key={cat} className="visual-palette-group">
                  <div className="visual-palette-cat">{cat}</div>
                  {Object.values(registry)
                    .filter((d) => d.category === cat)
                    .map((d) => (
                      <button key={d.type} type="button" className="visual-palette-item" onClick={() => addNode(d.type)} title={d.description}>
                        {d.label}
                      </button>
                    ))}
                </div>
              ))}
            </aside>
            <div className="visual-canvas">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeContextMenu={onEdgeContextMenu}
                deleteKeyCode={['Delete', 'Backspace']}
                nodeTypes={nodeTypes}
                fitView
              >
                <Background />
                <Controls />
                <MiniMap
                  bgColor="#0a0e14"
                  maskColor="rgba(0, 0, 0, 0.45)"
                  nodeColor="#6b7a99"
                  nodeStrokeColor="#2a3650"
                />
              </ReactFlow>
              {menu && (
                <ul className="vf-ctx-menu" style={{ left: menu.x, top: menu.y }}>
                  {menu.kind === 'node' && (
                    <>
                      <li onClick={() => { duplicateNodes([menu.id]); closeMenu() }}>Duplicate</li>
                      <li onClick={() => { deleteNode(menu.id); closeMenu() }}>Delete</li>
                    </>
                  )}
                  {menu.kind === 'edge' && (
                    <li onClick={() => { setEdges((eds) => eds.filter((e) => e.id !== menu.id)); closeMenu() }}>Delete Connection</li>
                  )}
                </ul>
              )}
            </div>
            <aside className="visual-diag">
              <div className="visual-diag-title">Compile result</div>
              <pre className="visual-compiled">{compiled || '(press Compile)'}</pre>
              <div className="visual-diag-title">Diagnostics ({diagnostics.length})</div>
              <ul className="visual-diag-list">
                {diagnostics.map((d, i) => (
                  <li key={i} className={`vdiag vdiag-${d.severity}`}>
                    <span className="vdiag-code">{d.code}</span> {d.message}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}
      </div>
    </UpdateNodeDataContext.Provider>
  )
}

export default function VisualEditor(props: VisualEditorProps) {
  return <VisualEditorInner {...props} />
}
