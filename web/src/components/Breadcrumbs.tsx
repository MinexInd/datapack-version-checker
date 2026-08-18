import { useMemo } from 'react'
import { Icon } from "./Icon";

interface BreadcrumbsProps {
  path: string | null
  onNavigate: (path: string) => void
}

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const parts = useMemo(() => {
    if (!path) return []
    return path.split('/').filter(Boolean)
  }, [path])

  if (parts.length === 0) {
    return (
      <div className="breadcrumbs">
        <span className="breadcrumbs-home">Home</span>
      </div>
    )
  }

  return (
    <div className="breadcrumbs">
      <button
        className="breadcrumbs-item"
        onClick={() => onNavigate('')}
      >
        <span className="breadcrumbs-icon"><Icon name="folder" size={16} /></span>
        <span>Home</span>
      </button>
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        const currentPath = parts.slice(0, index + 1).join('/')

        return (
          <div key={currentPath} className="breadcrumbs-separator">
            <span className="breadcrumbs-separator-icon">/</span>
            <button
              className={`breadcrumbs-item ${isLast ? 'active' : ''}`}
              onClick={() => !isLast && onNavigate(currentPath)}
              disabled={isLast}
            >
              <span>{part}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
