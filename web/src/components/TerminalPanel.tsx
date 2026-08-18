import { useState, useRef, useEffect } from 'react'
import { Icon } from "./Icon";

interface TerminalPanelProps {
  isOpen: boolean
  onClose: () => void
  onCommand: (command: string) => void
  logs: { time: string; kind: string; message: string }[]
}

export function TerminalPanel({ isOpen, onClose, onCommand, logs }: TerminalPanelProps) {
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [logs])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = command.trim()
      if (cmd) {
        setHistory(prev => [...prev, cmd])
        setHistoryIndex(-1)
        onCommand(cmd)
        setCommand('')
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setCommand(history[newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex !== -1) {
        const newIndex = Math.min(history.length - 1, historyIndex + 1)
        setHistoryIndex(newIndex)
        setCommand(newIndex === history.length - 1 ? '' : history[newIndex])
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <button type="button" className="terminal-close" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="terminal-output" ref={outputRef}>
        {logs.length === 0 ? (
          <div className="terminal-empty">No output yet</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className={`terminal-line terminal-${log.kind}`}>
              <span className="terminal-time">{log.time}</span>
              <span className="terminal-msg">{log.message}</span>
            </div>
          ))
        )}
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          type="text"
          className="terminal-input"
          placeholder="Type a command..."
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  )
}
