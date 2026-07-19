export type PackFileMap = Record<string, string>

export interface CheckRequest {
  mode: 'auto' | 'datapack' | 'resourcepack'
  versions?: string[]
  all: boolean
  strict: boolean
  files: PackFileMap
}

export interface McmetaVersion {
  id: string
  name: string
  release: string
  data_pack_version: number
  resource_pack_version: number
}

export interface CheckResponse {
  result: any
  mode: string
}

function apiBase(): string {
  return import.meta.env.DEV ? '/api' : '/api'
}

export async function fetchVersions(): Promise<McmetaVersion[]> {
  const r = await fetch(`${apiBase()}/versions`)
  if (!r.ok) throw new Error(`Failed to fetch versions: ${r.statusText}`)
  return r.json()
}

export async function runCheck(req: CheckRequest): Promise<CheckResponse> {
  const r = await fetch(`${apiBase()}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(text || r.statusText)
  }
  return r.json()
}
