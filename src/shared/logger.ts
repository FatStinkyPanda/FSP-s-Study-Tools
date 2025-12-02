/**
 * Application Logger Utility
 *
 * Provides centralized logging with support for:
 * - Log levels (debug, info, warn, error)
 * - Module/component prefixes
 * - Development vs production modes
 */

// Log levels for potential future use in filtering
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  prefix?: string;
  enableDebug?: boolean;
}

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';

/**
 * Create a logger instance for a specific module/component
 */
export function createLogger(prefix: string, options: LoggerOptions = {}) {
  const { enableDebug = isDevelopment } = options;
  const logPrefix = prefix ? `[${prefix}]` : '';

  return {
    debug: (...args: unknown[]) => {
      if (enableDebug) {
        console.log(`${logPrefix}`, ...args);
      }
    },
    info: (...args: unknown[]) => {
      console.log(`${logPrefix}`, ...args);
    },
    warn: (...args: unknown[]) => {
      console.warn(`${logPrefix}`, ...args);
    },
    error: (...args: unknown[]) => {
      console.error(`${logPrefix}`, ...args);
    },
  };
}

// Default loggers for common components
export const mainLogger = createLogger('Main');
export const rendererLogger = createLogger('Renderer');
export const openVoiceLogger = createLogger('OpenVoice');
export const voiceLogger = createLogger('Voice');
export const ipcLogger = createLogger('IPC');

// Export a convenience function for quick debug logging
export function debugLog(prefix: string, ...args: unknown[]) {
  if (isDevelopment) {
    console.log(`[${prefix}]`, ...args);
  }
}

export default createLogger;
