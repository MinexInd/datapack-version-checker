import { useState, useEffect, useRef, useMemo, useCallback } from 'react'

interface QuickOpenProps {
  isOpen: boolean
  onClose: () => void
  files: string[]
  onOpenFile: (path: string) => void
  recentFiles?: string[]
}

export function QuickOpen({ isOpen, onClose, files, onOpenFile, recentFiles = [] }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<'file' | 'recent' | 'goto'>('file')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredFiles = useMemo(() => {
    if (!query) return files
    const q = query.toLowerCase()
    return files.filter(f => f.toLowerCase().includes(q))
  }, [files, query])

  const recentFiltered = useMemo(() => {
    if (!query) return recentFiles
    const q = query.toLowerCase()
    return recentFiles.filter(f => f.toLowerCase().includes(q))
  }, [recentFiles, query])

  const gotoMatch = useMemo(() => {
    if (mode !== 'goto' || !query) return null
    const num = parseInt(query, 10)
    if (!isNaN(num) && num > 0) {
      return num
    }
    return null
  }, [query, mode])

  const getDisplayItems = useCallback(() => {
    if (mode === 'goto') return []
    if (mode === 'recent') return recentFiltered
    return filteredFiles
  }, [mode, filteredFiles, recentFiltered])

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setMode('file')
      inputRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, mode])

  const handleSelect = useCallback((item: string) => {
    if (mode === 'goto' && gotoMatch) {
      onOpenFile(`L${gotoMatch}`)
    } else {
      onOpenFile(item)
    }
    onClose()
  }, [mode, gotoMatch, onOpenFile, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const items = getDisplayItems()
      setSelectedIndex(i => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const items = getDisplayItems()
      setSelectedIndex(i => (i - 1 + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const items = getDisplayItems()
      if (items[selectedIndex]) {
        handleSelect(items[selectedIndex])
      }
    } else if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      setMode(m => m === 'file' ? 'recent' : m === 'recent' ? 'goto' : 'file')
    }
  }, [selectedIndex, getDisplayItems, handleSelect, onClose])

  if (!isOpen) return null

  return (
    <div className="quickopen-overlay" onClick={onClose}>
      <div className="quickopen" onClick={e => e.stopPropagation()}>
        <div className="quickopen-header">
          <span className="quickopen-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="quickopen-input"
            placeholder={mode === 'goto' ? 'Enter line number...' : 'Type a file name...'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="quickopen-tabs">
            <button
              className={`quickopen-tab ${mode === 'file' ? 'active' : ''}`}
              onClick={() => setMode('file')}
            >
              Files
            </button>
            <button
              className={`quickopen-tab ${mode === 'recent' ? 'active' : ''}`}
              onClick={() => setMode('recent')}
            >
              Recent
            </button>
            <button
              className={`quickopen-tab ${mode === 'goto' ? 'active' : ''}`}
              onClick={() => setMode('goto')}
            >
              Go to
            </button>
          </div>
        </div>
        <div className="quickopen-list" ref={listRef}>
          {mode === 'goto' ? (
            <div className="quickopen-section">
              {gotoMatch ? (
                <div className="quickopen-item selected" onClick={() => handleSelect('')}>
                  <span className="quickopen-item-icon">📍</span>
                  <span className="quickopen-item-label">Go to line {gotoMatch}</span>
                </div>
              ) : (
                <div className="quickopen-empty">
                  {query ? 'Enter a valid line number' : 'Type a line number'}
                </div>
              )}
            </div>
          ) : (
            <>
              {mode === 'recent' && recentFiltered.length === 0 && (
                <div className="quickopen-empty">No recent files</div>
              )}
              {mode === 'file' && filteredFiles.length === 0 && (
                <div className="quickopen-empty">No files found</div>
              )}
              {(mode === 'file' ? filteredFiles : recentFiltered).map((file, idx) => (
                <div
                  key={file}
                  className={`quickopen-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelect(file)}
                >
                  <span className="quickopen-item-icon">
                    {file.endsWith('.json') ? '📄' : file.endsWith('.mcmeta') ? '⚙️' : '📝'}
                  </span>
                  <span className="quickopen-item-label">{file}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
