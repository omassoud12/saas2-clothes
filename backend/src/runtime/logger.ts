export type RuntimeLogLevel = 'info' | 'warn' | 'error'

export interface RuntimeLogFields {
  readonly requestId?: string
  readonly method?: string
  readonly route?: string
  readonly status?: number
  readonly durationMs?: number
  readonly code?: string
  readonly reason?: string
}

export interface RuntimeLogger {
  info(event: string, fields?: RuntimeLogFields): void
  warn(event: string, fields?: RuntimeLogFields): void
  error(event: string, fields?: RuntimeLogFields): void
}

interface LogWriter {
  log(message: string): void
  warn(message: string): void
  error(message: string): void
}

function compact(fields: RuntimeLogFields): RuntimeLogFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as RuntimeLogFields
}

export function createJsonLogger(
  writer: LogWriter = console,
  now: () => number = Date.now,
): RuntimeLogger {
  function write(
    level: RuntimeLogLevel,
    event: string,
    fields: RuntimeLogFields = {},
  ): void {
    const record = JSON.stringify({
      timestamp: new Date(now()).toISOString(),
      level,
      event,
      ...compact(fields),
    })

    if (level === 'error') writer.error(record)
    else if (level === 'warn') writer.warn(record)
    else writer.log(record)
  }

  const logger: RuntimeLogger = {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  }
  return Object.freeze(logger)
}

export const runtimeLogger = createJsonLogger()
