import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from "./Icon";

interface Command {
  id: string
  label: string
  category?: string
  shortcut?: string
  action: () => void
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  commands: Command[]
  recentCommands?: string[]
}

export function CommandPalette({ isOpen, onClose, commands, recentCommands = [] }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredCommands = commands.filter(cmd =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      inputRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => (i + 1) % filteredCommands.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action()
        onClose()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [filteredCommands, selectedIndex, onClose])

  if (!isOpen) return null

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-header">
          <span className="command-palette-icon"><Icon name="command" size={14} /></span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="command-palette-list" ref={listRef}>
          {recentCommands.length > 0 && !query && (
            <div className="command-palette-section">
              <div className="command-palette-section-label">Recent</div>
              {recentCommands.map(cmdId => {
                const cmd = commands.find(c => c.id === cmdId)
                if (!cmd) return null
                return (
                  <div
                    key={cmd.id}
                    className={`command-palette-item ${selectedIndex === commands.indexOf(cmd) ? 'selected' : ''}`}
                    onClick={() => { cmd.action(); onClose() }}
                  >
                    <span className="command-palette-item-label">{cmd.label}</span>
                    {cmd.shortcut && <span className="command-palette-item-shortcut">{cmd.shortcut}</span>}
                  </div>
                )
              })}
            </div>
          )}
          <div className="command-palette-section">
            <div className="command-palette-section-label">Commands</div>
            {filteredCommands.map((cmd, idx) => (
              <div
                key={cmd.id}
                className={`command-palette-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => { cmd.action(); onClose() }}
              >
                <span className="command-palette-item-label">{cmd.label}</span>
                {cmd.shortcut && <span className="command-palette-item-shortcut">{cmd.shortcut}</span>}
              </div>
            ))}
            {filteredCommands.length === 0 && (
              <div className="command-palette-empty">No commands found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
