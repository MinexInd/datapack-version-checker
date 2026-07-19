type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',    // gray
  info: '\x1b[36m',     // cyan
  warn: '\x1b[33m',     // yellow
  error: '\x1b[31m',    // red
}
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

const supportsColor = !process.env.NO_COLOR && process.env.TERM !== 'dumb' && (process.stdout.isTTY || process.env.CI)

function color(level: LogLevel, text: string): string {
  if (!supportsColor) return text
  return LOG_COLORS[level] + text + RESET
}

function dim(text: string): string {
  if (!supportsColor) return text
  return '\x1b[2m' + text + RESET
}

function bold(text: string): string {
  if (!supportsColor) return text
  return BOLD + text + RESET
}

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
    const full = `${dim(ts)} ${color(level, label)} ${prefix}${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`
    if (level === 'error') {
      process.stderr.write(full + '\n')
    } else {
      process.stderr.write(full + '\n')
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
    this.info(`${dim(label)} ${bold(`${elapsed.toFixed(0)}ms`)}${extra.length ? ' ' + extra.join(' ') : ''}`)
  }

  child(prefix: string): Logger {
    const child = new Logger(this.levelLabel, this.prefix ? `${this.prefix}:${prefix}` : prefix)
    child.timers = this.timers
    return child
  }
}

let _logger = new Logger('info')

export function setLogLevel(level: LogLevel): void {
  _logger.setLevel(level)
}

export function getLogger(): Logger {
  return _logger
}
