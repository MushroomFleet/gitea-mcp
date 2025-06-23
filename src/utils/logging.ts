import { pino } from 'pino';

// Create logger with default configuration that can be overridden
function createLogger() {
  const logLevel = process.env.LOG_LEVEL || 'info';
  const environment = process.env.NODE_ENV || 'development';

  return pino({
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label })
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err
    },
    redact: {
      paths: ['token', 'password', 'authorization'],
      censor: '[REDACTED]'
    },
    transport: environment === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    } : undefined
  });
}

export const logger = createLogger();
