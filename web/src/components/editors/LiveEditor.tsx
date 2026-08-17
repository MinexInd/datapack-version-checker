import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'

interface LiveEditorProps {
  activePath: string
  initialContent: string
  language: string
  onCommit: (next: string) => void
  beforeMount: BeforeMount
  onMount: OnMount
}

// A Monaco editor that keeps the text in local state while typing so the host
// (IdePage) does NOT re-render on every keystroke. The document is committed to
// the parent state on a short debounce, which is what removes the "laggy" feel
// when editing large JSON / mcfunction files. The \`value\` prop always equals the
// live local text, so Monaco never resets the model or jumps the caret.
const COMMIT_MS = 250

export default function LiveEditor({
  activePath,
  initialContent,
  language,
  onCommit,
  beforeMount,
  onMount,
}: LiveEditorProps) {
  const [text, setText] = useState(initialContent)
  const textRef = useRef(initialContent)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const handleChange = useCallback((value: string | undefined) => {
    const next = value ?? ''
    textRef.current = next
    setText(next)
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => onCommitRef.current(next), COMMIT_MS)
  }, [])

  // Flush any pending edit when the file is switched (unmount), so the last
  // keystrokes are never lost before the debounce fires.
  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      onCommitRef.current(textRef.current)
    }
  }, [])

  return (
    <Editor
      path={`file:///pack/${activePath}`}
      beforeMount={beforeMount}
      onMount={onMount}
      language={language}
      value={text}
      onChange={handleChange}
      theme="minex-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 4,
        insertSpaces: true,
        wordWrap: 'off',
        renderWhitespace: 'boundary',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 8, bottom: 8 },
        'semanticHighlighting.enabled': true,
      }}
    />
  )
}
