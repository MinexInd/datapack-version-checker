import type { ReactNode } from 'react'

/** Versions the engine covers. Static for now — the hub renders before
 *  fetchVersions() has anything useful to say, and this string is the
 *  engine's declared range rather than a live count. */
const COVERAGE_FROM = '1.13'
const COVERAGE_TO = '26.2'

type CaseStatus = 'open' | 'sealed'

interface DocketField {
  key: string
  value: string
}

interface ToolCaseProps {
  caseNo: string
  status: CaseStatus
  title: string
  description: string
  docket: DocketField[]
  action: ReactNode
  seal?: string
}

function ToolCase({ caseNo, status, title, description, docket, action, seal }: ToolCaseProps) {
  const open = status === 'open'
  return (
    <article className={`tool-case ${open ? 'is-open' : 'is-sealed'}`}>
      <div className="case-bar">
        <span className="case-no">{caseNo}</span>
        <span className="case-gap" />
        <span className={`status-chip ${status}`}>{open ? 'Open' : 'Sealed'}</span>
      </div>

      <div className="case-body">
        <h3 className="case-title">{title}</h3>
        <p className="case-desc">{description}</p>

        <dl className="case-docket">
          {docket.map(field => (
            <div className="docket-row" key={field.key}>
              <dt className="dk-key">{field.key}</dt>
              <dd className="dk-val">{field.value}</dd>
            </div>
          ))}
        </dl>

        <div className="case-action">{action}</div>
      </div>

      {seal && <span className="case-seal" aria-hidden="true">{seal}</span>}
    </article>
  )
}

interface HubPageProps {
  onOpenDatapackEditor: () => void
}

export default function HubPage({ onOpenDatapackEditor }: HubPageProps) {
  const coverage = `${COVERAGE_FROM} \u2192 ${COVERAGE_TO}`

  return (
    <div className="hub-root">
      <div className="hub">
        <section className="desk-masthead">
          <div className="register-strip">
            <span className="reg-field">
              <span className="reg-key">Studio</span>
              <span className="reg-val">MinexStudio</span>
            </span>
            <span className="reg-field">
              <span className="reg-key">Build</span>
              <span className="reg-val">v0.6.0</span>
            </span>
            <span className="reg-field reg-push">
              <span className="reg-key">Runtime</span>
              <span className="reg-val">browser only</span>
            </span>
          </div>

          <div className="masthead-body">
            <div>
              <h1 className="wordmark">
                Minex<span className="wm-tail">Studio</span><span className="wm-dot">.</span>
              </h1>
              <p className="masthead-line">
                A desk for Minecraft datapack work. Load a pack, check it against the
                versions you care about, and read the findings as{' '}
                <strong>triaged issues</strong> — parsed in your browser, never uploaded.
              </p>
            </div>

            <div className="filing-stamp">
              <span className="fs-line1">Desk Open</span>
              <span className="fs-line2">1 of 3 tools</span>
            </div>
          </div>

          <div className="readout-strip">
            <div className="readout-cell">
              <span className="ro-key">Coverage</span>
              <span className="ro-val">
                {COVERAGE_FROM}
                <span className="ro-arrow"> {'\u2192'} </span>
                {COVERAGE_TO}
              </span>
            </div>
            <div className="readout-cell">
              <span className="ro-key">Parser</span>
              <span className="ro-val">SpyglassMC</span>
            </div>
            <div className="readout-cell">
              <span className="ro-key">Check lanes</span>
              <span className="ro-val">9</span>
            </div>
            <div className="readout-cell">
              <span className="ro-key">Upload</span>
              <span className="ro-val">none</span>
            </div>
          </div>
        </section>

        <div className="docket-head">
          <h2>Tool docket</h2>
          <span className="dh-rule" />
          <span className="dh-count">3 cases / 1 open</span>
        </div>

        <div className="docket-grid">
          <ToolCase
            caseNo="CASE 01"
            status="open"
            title="Datapack Editor"
            description="Version checking, analysis, and editing"
            docket={[
              { key: 'Scope', value: 'datapacks' },
              { key: 'Versions', value: coverage },
              { key: 'Fixes', value: 'commands + JSON' },
            ]}
            action={
              <button type="button" className="hub-btn primary" onClick={onOpenDatapackEditor}>
                Open Datapack Editor
                <span className="btn-arrow" aria-hidden="true">{'\u2192'}</span>
              </button>
            }
          />

          <ToolCase
            caseNo="CASE 01B"
            status="open"
            title="Datapack Visual Editor"
            description="Blueprints-style visual scripting that compiles to .mcfunction"
            docket={[
              { key: 'Mode', value: 'Visual graph' },
              { key: 'Output', value: 'mcfunction' },
              { key: 'Engine', value: 'Spyglass-validated' },
            ]}
            action={
              <button type="button" className="hub-btn primary" onClick={onOpenDatapackEditor}>
                Open Visual Editor
                <span className="btn-arrow" aria-hidden="true">{'→'}</span>
              </button>
            }
          />

          <ToolCase
            caseNo="CASE 02"
            status="sealed"
            title="Resourcepack Studio"
            description="Texture, model, and sound pack checking across versions."
            docket={[
              { key: 'Scope', value: 'resource packs' },
              { key: 'Versions', value: 'pending' },
              { key: 'Fixes', value: 'pending' },
            ]}
            seal="Coming soon"
            action={
              <button type="button" className="hub-btn" disabled>
                Not yet available
              </button>
            }
          />

          <ToolCase
            caseNo="CASE 03"
            status="sealed"
            title="Registry Explorer"
            description="Browse blocks, items, and registry entries for any version."
            docket={[
              { key: 'Scope', value: 'registries' },
              { key: 'Versions', value: 'pending' },
              { key: 'Fixes', value: 'n/a' },
            ]}
            seal="Coming soon"
            action={
              <button type="button" className="hub-btn" disabled>
                Not yet available
              </button>
            }
          />
        </div>

        <footer className="hub-footer">
          <p>Runs entirely in your browser — nothing is uploaded.</p>
          <a href="https://github.com/MinexInd/datapack-version-checker" target="_blank" rel="noopener">GitHub</a>
          <a href="https://github.com/MinexInd/datapack-version-checker/issues" target="_blank" rel="noopener">Report an issue</a>
          <span className="hf-version">v0.6.0</span>
        </footer>
      </div>
    </div>
  )
}
