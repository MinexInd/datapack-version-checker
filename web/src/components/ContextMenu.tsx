import { useEffect } from 'react'

interface ContextMenuItem {
  label: string
  action: string
  shortcut?: string
  disabled?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onAction: (action: string) => void
  items: (ContextMenuItem | null)[]
}

export function ContextMenu({ x, y, onClose, onAction, items }: ContextMenuProps) {
  useEffect(() => {
    const handleClick = () => onClose()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Adjust position to stay within viewport
  const menuStyle: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - items.length * 32),
  }

  return (
    <div className="context-menu" style={menuStyle} onClick={e => e.stopPropagation()}>
      {items.map((item, index) => {
        if (item === null) {
          return <div key={`sep-${index}`} className="context-menu-separator" />
        }
        return (
          <div
            key={item.action}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => !item.disabled && onAction(item.action)}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </div>
        )
      })}
    </div>
  )
}
