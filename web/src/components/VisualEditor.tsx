import { useCallback, useEffect, useState } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { getNodeDef, getNodeRegistry, nodeCategories, type GraphNode, type GraphEdge, type FunctionGraph } from '../visual/core/graph/NodeTypes'
import { compileGraph } from '../visual/core/compiler/GraphCompiler'
import { createAdapter, resolveVersion, getDefaultVersion } from '../visual/core/minecraft/catalog'
import LiveEditor from './editors/LiveEditor'
import type { BeforeMount, OnMount } from '@monaco-editor/react'
import type { Diagnostic } from '../visual/core/minecraft/types'

interface VisualEditorProps {
  activePath: string
  initialContent: string
  version?: string
  onCommit: (next: string) => void
  beforeMount: BeforeMount
  onMount: OnMount
}

function mcfunctionNamespaceBase(path: string): { namespace: string; basePath: string } {
  // data/<ns>/function/<base>.mcfunction
  const m = path.match(/^data\/([^/]+)\/function\/(.+)\.mcfunction$/)
  if (m) return { namespace: m[1], basePath: m[2] }
  const m2 = path.match(/^data\/([^/]+)\/(.+)$/)
  if (m2) return { namespace: m2[1], basePath: m2[2].replace(/\.mcfunction$/, '') }
  return { namespace: 'pack', basePath: 'visual/function' }
}

function seedGraph(text: string): { nodes: Node[]; edges: Edge[] } {
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

function VNode({ data, selected }: NodeProps) {
  const def = getNodeDef((data as any).kind)
  if (!def) return <div className="vnode vnode-unknown">Unknown node</div>
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
              <select
                className="vnode-input"
                value={(data as any)[f.key] ?? f.default ?? ''}
                onChange={(e) => (data as any)[f.key] = e.target.value}
              >
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.type === 'boolean' ? (
              <input
                type="checkbox"
                className="vnode-input"
                checked={!!(data as any)[f.key]}
                onChange={(e) => (data as any)[f.key] = e.target.checked}
              />
            ) : (
              <input
                type="text"
                className="vnode-input"
                value={(data as any)[f.key] ?? f.default ?? ''}
                onChange={(e) => (data as any)[f.key] = e.target.value}
              />
            )}
          </label>
        ))}
      </div>
      {def.hasExecIn && <Handle type="target" position={Position.Left} id="in" />}
      {def.hasExecOut && <Handle type="source" position={Position.Right} id="out" />}
    </div>
  )
}

const nodeTypes = { vnode: VNode }

export default function VisualEditor({ activePath, initialContent, version, onCommit, beforeMount, onMount }: VisualEditorProps) {
  const [mode, setMode] = useState<'code' | 'visual'>('visual')
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(seedGraph(initialContent).nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seedGraph(initialContent).edges)

  // The .mcfunction text is the source of truth: reseed the graph whenever the
  // underlying file content changes (code edits, or a compile round-trip).
  useEffect(() => {
    const s = seedGraph(initialContent)
    setNodes(s.nodes)
    setEdges(s.edges)
  }, [initialContent, setNodes, setEdges])
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [compiled, setCompiled] = useState<string>('')

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges])

  const addNode = useCallback((kind: string) => {
    const id = 'n_' + Math.random().toString(36).slice(2, 9)
    setNodes((nds) => [...nds, { id, type: 'vnode', position: { x: 320, y: 40 + nds.length * 30 }, data: { kind } }])
  }, [setNodes])

  const doCompile = useCallback(() => {
    const graph: FunctionGraph = {
      nodes: nodes.map((n) => ({ id: n.id, type: (n.data as any).kind, position: n.position, data: (n.data as any) } as GraphNode)),
      edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? undefined, target: e.target, targetHandle: e.targetHandle ?? undefined } as GraphEdge)),
    }
    const v = version ? resolveVersion(version) : getDefaultVersion()
    const adapter = createAdapter(v)
    const { namespace, basePath } = mcfunctionNamespaceBase(activePath)
    const res = compileGraph(graph, { namespace, basePath, adapter })
    setDiagnostics(res.diagnostics)
    const text = res.main.commands.join('\n')
    setCompiled(text)
    onCommit(text)
  }, [nodes, edges, version, activePath, onCommit])

  const categories = nodeCategories()
  const registry = getNodeRegistry()

  return (
    <div className="visual-editor">
      <div className="visual-editor-bar">
        <div className="visual-mode-toggle" role="group" aria-label="Editor mode">
          <button type="button" className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}>Code</button>
          <button type="button" className={mode === 'visual' ? 'active' : ''} onClick={() => setMode('visual')}>Visual</button>
        </div>
        <button type="button" className="visual-compile" onClick={doCompile}>Compile ▶</button>
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
              nodeTypes={nodeTypes}
              fitView
            >
              <Background />
              <Controls />
              <MiniMap />
            </ReactFlow>
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
  )
}
