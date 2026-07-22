type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export class Logger {
  private level: number
  private prefix: string
  private timers: Map<string, number>
  private levelLabel: LogLevel

  constructor(level: LogLevel = 'info', prefix = '') {
    this.level = LEVELS[level]
    this.levelLabel = level
    this.prefix = prefix
    this.timers = new Map()
  }

  setLevel(level: LogLevel): void {
    this.level = LEVELS[level]
    this.levelLabel = level
  }

  getLevel(): LogLevel {
    return this.levelLabel
  }

  private log(level: LogLevel, ...args: any[]): void {
    if (LEVELS[level] < this.level) return
    const ts = new Date().toISOString().slice(11, 23)
    const prefix = this.prefix ? `[${this.prefix}] ` : ''
    const label = level.toUpperCase().padEnd(5)
    const full = `${ts} ${label} ${prefix}${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`
    if (level === 'error') {
      console.error(full)
    } else if (level === 'warn') {
      console.warn(full)
    } else {
      console.log(full)
    }
  }

  debug(...args: any[]): void { this.log('debug', ...args) }
  info(...args: any[]): void { this.log('info', ...args) }
  warn(...args: any[]): void { this.log('warn', ...args) }
  error(...args: any[]): void { this.log('error', ...args) }

  time(label: string): void {
    this.timers.set(label, performance.now())
  }

  timeEnd(label: string, ...extra: any[]): void {
    const start = this.timers.get(label)
    if (start === undefined) {
      this.warn(`Timer "${label}" does not exist`)
      return
    }
    const elapsed = performance.now() - start
    this.timers.delete(label)
    this.info(`${label} ${elapsed.toFixed(0)}ms${extra.length ? ' ' + extra.join(' ') : ''}`)
  }

  child(prefix: string): Logger {
    const child = new Logger(this.levelLabel, this.prefix ? `${this.prefix}:${prefix}` : prefix)
    child.timers = this.timers
    return child
  }
}

let _logger = new Logger('warn')

export function setLogLevel(level: LogLevel): void {
  _logger.setLevel(level)
}

export function getLogger(): Logger {
  return _logger
}
