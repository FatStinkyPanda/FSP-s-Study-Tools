/**
 * Application Error Types and User-Friendly Error Messages
 *
 * This module provides a centralized error handling system with:
 * - Typed error classes for different error categories
 * - User-friendly message generation
 * - Error codes for tracking and debugging
 * - Recovery suggestions for common errors
 */

// Error codes for categorization and tracking
export enum ErrorCode {
  // General errors (1xxx)
  UNKNOWN = 1000,
  INITIALIZATION_FAILED = 1001,
  OPERATION_CANCELLED = 1002,

  // Database errors (2xxx)
  DATABASE_CONNECTION = 2000,
  DATABASE_QUERY = 2001,
  DATABASE_WRITE = 2002,
  DATABASE_CORRUPTION = 2003,
  DATABASE_LOCKED = 2004,

  // File errors (3xxx)
  FILE_NOT_FOUND = 3000,
  FILE_READ_ERROR = 3001,
  FILE_WRITE_ERROR = 3002,
  FILE_TOO_LARGE = 3003,
  FILE_INVALID_FORMAT = 3004,
  FILE_PERMISSION_DENIED = 3005,
  FILE_CORRUPTED = 3006,

  // Knowledge Base errors (4xxx)
  KB_NOT_FOUND = 4000,
  KB_IMPORT_FAILED = 4001,
  KB_EXPORT_FAILED = 4002,
  KB_INVALID_STRUCTURE = 4003,
  KB_PARSE_ERROR = 4004,

  // AI errors (5xxx)
  AI_PROVIDER_ERROR = 5000,
  AI_RATE_LIMIT = 5001,
  AI_AUTHENTICATION = 5002,
  AI_NETWORK_ERROR = 5003,
  AI_INVALID_RESPONSE = 5004,
  AI_MODEL_NOT_FOUND = 5005,
  AI_QUOTA_EXCEEDED = 5006,

  // Network errors (6xxx)
  NETWORK_OFFLINE = 6000,
  NETWORK_TIMEOUT = 6001,
  NETWORK_REQUEST_FAILED = 6002,

  // Validation errors (7xxx)
  VALIDATION_REQUIRED = 7000,
  VALIDATION_INVALID_FORMAT = 7001,
  VALIDATION_OUT_OF_RANGE = 7002,
  VALIDATION_DUPLICATE = 7003,

  // Settings errors (8xxx)
  SETTINGS_LOAD_FAILED = 8000,
  SETTINGS_SAVE_FAILED = 8001,
  SETTINGS_INVALID = 8002,
}

// Error severity levels
export type ErrorSeverity = 'error' | 'warning' | 'info';

// Recovery action types
export interface RecoveryAction {
  label: string;
  action: string;  // Action identifier to handle in the UI
}

// Base application error
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly severity: ErrorSeverity;
  public readonly userMessage: string;
  public readonly technicalDetails?: string;
  public readonly recoveryActions?: RecoveryAction[];
  public readonly timestamp: Date;

  constructor(
    code: ErrorCode,
    userMessage: string,
    options?: {
      severity?: ErrorSeverity;
      technicalDetails?: string;
      recoveryActions?: RecoveryAction[];
      cause?: Error;
    }
  ) {
    super(userMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.severity = options?.severity || 'error';
    this.technicalDetails = options?.technicalDetails;
    this.recoveryActions = options?.recoveryActions;
    this.timestamp = new Date();

    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

// Database-specific error
export class DatabaseError extends AppError {
  constructor(
    code: ErrorCode,
    userMessage: string,
    options?: {
      technicalDetails?: string;
      recoveryActions?: RecoveryAction[];
      cause?: Error;
    }
  ) {
    super(code, userMessage, {
      severity: 'error',
      ...options,
    });
    this.name = 'DatabaseError';
  }
}

// File operation error
export class FileError extends AppError {
  public readonly filePath?: string;

  constructor(
    code: ErrorCode,
    userMessage: string,
    options?: {
      filePath?: string;
      technicalDetails?: string;
      recoveryActions?: RecoveryAction[];
      cause?: Error;
    }
  ) {
    super(code, userMessage, {
      severity: 'error',
      ...options,
    });
    this.name = 'FileError';
    this.filePath = options?.filePath;
  }
}

// Knowledge Base error
export class KnowledgeBaseError extends AppError {
  public readonly kbId?: number;

  constructor(
    code: ErrorCode,
    userMessage: string,
    options?: {
      kbId?: number;
      technicalDetails?: string;
      recoveryActions?: RecoveryAction[];
      cause?: Error;
    }
  ) {
    super(code, userMessage, {
      severity: 'error',
      ...options,
    });
    this.name = 'KnowledgeBaseError';
    this.kbId = options?.kbId;
  }
}

// Network error
export class NetworkError extends AppError {
  public readonly isOffline: boolean;

  constructor(
    code: ErrorCode,
    userMessage: string,
    options?: {
      isOffline?: boolean;
      severity?: ErrorSeverity;
      technicalDetails?: string;
      recoveryActions?: RecoveryAction[];
      cause?: Error;
    }
  ) {
    super(code, userMessage, {
      severity: options?.severity || 'error',
      technicalDetails: options?.technicalDetails,
      recoveryActions: options?.recoveryActions,
      cause: options?.cause,
    });
    this.name = 'NetworkError';
    this.isOffline = options?.isOffline || false;
  }
}

// Validation error
export class ValidationError extends AppError {
  public readonly field?: string;

  constructor(
    code: ErrorCode,
    userMessage: string,
    options?: {
      field?: string;
      technicalDetails?: string;
      recoveryActions?: RecoveryAction[];
    }
  ) {
    super(code, userMessage, {
      severity: 'warning',
      ...options,
    });
    this.name = 'ValidationError';
    this.field = options?.field;
  }
}

/**
 * Convert raw error to user-friendly AppError
 */
export function toUserFriendlyError(error: unknown, context?: string): AppError {
  // Already an AppError, return as is
  if (error instanceof AppError) {
    return error;
  }

  const rawError = error as Error;
  const message = rawError?.message || String(error);
  const lowerMessage = message.toLowerCase();

  // Network errors
  if (lowerMessage.includes('network') ||
      lowerMessage.includes('fetch') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('econnrefused')) {
    return new NetworkError(
      ErrorCode.NETWORK_REQUEST_FAILED,
      'Unable to connect to the server. Please check your internet connection and try again.',
      {
        technicalDetails: message,
        recoveryActions: [
          { label: 'Retry', action: 'retry' },
          { label: 'Work Offline', action: 'offline' },
        ],
        cause: rawError,
      }
    );
  }

  // Timeout errors
  if (lowerMessage.includes('timeout') || lowerMessage.includes('etimedout')) {
    return new NetworkError(
      ErrorCode.NETWORK_TIMEOUT,
      'The operation took too long. Please try again.',
      {
        technicalDetails: message,
        recoveryActions: [{ label: 'Retry', action: 'retry' }],
        cause: rawError,
      }
    );
  }

  // File not found
  if (lowerMessage.includes('enoent') || lowerMessage.includes('not found')) {
    return new FileError(
      ErrorCode.FILE_NOT_FOUND,
      'The file could not be found. It may have been moved or deleted.',
      {
        technicalDetails: message,
        recoveryActions: [{ label: 'Browse for File', action: 'browse' }],
        cause: rawError,
      }
    );
  }

  // Permission denied
  if (lowerMessage.includes('permission') || lowerMessage.includes('eacces') || lowerMessage.includes('eperm')) {
    return new FileError(
      ErrorCode.FILE_PERMISSION_DENIED,
      'Access denied. Please check file permissions and try again.',
      {
        technicalDetails: message,
        cause: rawError,
      }
    );
  }

  // Database locked
  if (lowerMessage.includes('database is locked') || lowerMessage.includes('busy')) {
    return new DatabaseError(
      ErrorCode.DATABASE_LOCKED,
      'The database is currently busy. Please wait a moment and try again.',
      {
        technicalDetails: message,
        recoveryActions: [{ label: 'Retry', action: 'retry' }],
        cause: rawError,
      }
    );
  }

  // AI rate limit
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || lowerMessage.includes('too many requests')) {
    return new AppError(
      ErrorCode.AI_RATE_LIMIT,
      'Too many requests. Please wait a moment before trying again.',
      {
        severity: 'warning',
        technicalDetails: message,
        recoveryActions: [{ label: 'Retry in 30s', action: 'retry-delayed' }],
        cause: rawError,
      }
    );
  }

  // AI authentication
  if (lowerMessage.includes('api key') || lowerMessage.includes('authentication') || lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
    return new AppError(
      ErrorCode.AI_AUTHENTICATION,
      'Invalid or missing API key. Please check your settings.',
      {
        technicalDetails: message,
        recoveryActions: [{ label: 'Open Settings', action: 'open-settings' }],
        cause: rawError,
      }
    );
  }

  // XML/JSON parse errors
  if (lowerMessage.includes('parse') || lowerMessage.includes('syntax') || lowerMessage.includes('unexpected token')) {
    return new FileError(
      ErrorCode.FILE_INVALID_FORMAT,
      'The file format is invalid or corrupted. Please check the file and try again.',
      {
        technicalDetails: message,
        cause: rawError,
      }
    );
  }

  // Generic error with context
  const contextMessage = context ? `${context}: ` : '';
  return new AppError(
    ErrorCode.UNKNOWN,
    `${contextMessage}An unexpected error occurred. Please try again.`,
    {
      technicalDetails: message,
      recoveryActions: [{ label: 'Retry', action: 'retry' }],
      cause: rawError,
    }
  );
}

/**
 * Create user-friendly messages for common scenarios
 */
export const ErrorMessages = {
  // Knowledge Base operations
  kb: {
    importFailed: (filename: string) => new KnowledgeBaseError(
      ErrorCode.KB_IMPORT_FAILED,
      `Failed to import "${filename}". The file may be corrupted or in an unsupported format.`,
      {
        recoveryActions: [
          { label: 'Try Another File', action: 'browse' },
        ],
      }
    ),
    exportFailed: (title: string) => new KnowledgeBaseError(
      ErrorCode.KB_EXPORT_FAILED,
      `Failed to export "${title}". Please try again or choose a different location.`,
      {
        recoveryActions: [
          { label: 'Try Again', action: 'retry' },
        ],
      }
    ),
    notFound: (id: number) => new KnowledgeBaseError(
      ErrorCode.KB_NOT_FOUND,
      'The knowledge base could not be found. It may have been deleted.',
      { kbId: id }
    ),
    invalidStructure: () => new KnowledgeBaseError(
      ErrorCode.KB_INVALID_STRUCTURE,
      'The knowledge base file has an invalid structure. Please check the file format.',
    ),
  },

  // File operations
  file: {
    tooLarge: (maxSize: string) => new FileError(
      ErrorCode.FILE_TOO_LARGE,
      `The file is too large. Maximum allowed size is ${maxSize}.`,
    ),
    unsupportedFormat: (formats: string[]) => new FileError(
      ErrorCode.FILE_INVALID_FORMAT,
      `Unsupported file format. Please use one of: ${formats.join(', ')}.`,
    ),
    readError: (filename: string) => new FileError(
      ErrorCode.FILE_READ_ERROR,
      `Unable to read "${filename}". The file may be corrupted or in use.`,
      {
        recoveryActions: [
          { label: 'Try Again', action: 'retry' },
        ],
      }
    ),
  },

  // AI operations
  ai: {
    noApiKey: (provider: string) => new AppError(
      ErrorCode.AI_AUTHENTICATION,
      `Please configure your ${provider} API key in Settings to use AI features.`,
      {
        severity: 'warning',
        recoveryActions: [
          { label: 'Open Settings', action: 'open-settings' },
        ],
      }
    ),
    modelNotFound: (model: string) => new AppError(
      ErrorCode.AI_MODEL_NOT_FOUND,
      `The AI model "${model}" is not available. Please select a different model.`,
      {
        recoveryActions: [
          { label: 'Open Settings', action: 'open-settings' },
        ],
      }
    ),
    quotaExceeded: (provider: string) => new AppError(
      ErrorCode.AI_QUOTA_EXCEEDED,
      `Your ${provider} API quota has been exceeded. Please check your account or try again later.`,
      {
        recoveryActions: [
          { label: 'Check Account', action: 'open-provider-console' },
        ],
      }
    ),
  },

  // Settings
  settings: {
    loadFailed: () => new AppError(
      ErrorCode.SETTINGS_LOAD_FAILED,
      'Failed to load settings. Default settings will be used.',
      {
        severity: 'warning',
        recoveryActions: [
          { label: 'Reset Settings', action: 'reset-settings' },
        ],
      }
    ),
    saveFailed: () => new AppError(
      ErrorCode.SETTINGS_SAVE_FAILED,
      'Failed to save settings. Please try again.',
      {
        recoveryActions: [
          { label: 'Try Again', action: 'retry' },
        ],
      }
    ),
  },

  // Database
  database: {
    connectionFailed: () => new DatabaseError(
      ErrorCode.DATABASE_CONNECTION,
      'Unable to connect to the database. The application may not function properly.',
      {
        recoveryActions: [
          { label: 'Restart Application', action: 'restart' },
        ],
      }
    ),
    queryFailed: () => new DatabaseError(
      ErrorCode.DATABASE_QUERY,
      'A database error occurred. Please try again.',
      {
        recoveryActions: [
          { label: 'Try Again', action: 'retry' },
        ],
      }
    ),
  },

  // Network
  network: {
    offline: () => new NetworkError(
      ErrorCode.NETWORK_OFFLINE,
      'You appear to be offline. Some features may not be available.',
      {
        isOffline: true,
        severity: 'warning',
      }
    ),
  },

  // Validation
  validation: {
    required: (field: string) => new ValidationError(
      ErrorCode.VALIDATION_REQUIRED,
      `${field} is required.`,
      { field }
    ),
    invalidFormat: (field: string, expected: string) => new ValidationError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      `Invalid ${field} format. Expected: ${expected}.`,
      { field }
    ),
  },
};

/**
 * Error notification payload for UI
 */
export interface ErrorNotification {
  id: string;
  code: ErrorCode;
  severity: ErrorSeverity;
  title: string;
  message: string;
  details?: string;
  actions?: RecoveryAction[];
  timestamp: Date;
  autoDismiss?: boolean;
  dismissAfter?: number;  // milliseconds
}

/**
 * Convert AppError to notification payload
 */
export function errorToNotification(error: AppError): ErrorNotification {
  return {
    id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    code: error.code,
    severity: error.severity,
    title: getErrorTitle(error.code),
    message: error.userMessage,
    details: error.technicalDetails,
    actions: error.recoveryActions,
    timestamp: error.timestamp,
    autoDismiss: error.severity !== 'error',
    dismissAfter: error.severity === 'warning' ? 5000 : error.severity === 'info' ? 3000 : undefined,
  };
}

/**
 * Get error title based on code
 */
function getErrorTitle(code: ErrorCode): string {
  const codePrefix = Math.floor(code / 1000);

  switch (codePrefix) {
    case 1: return 'Application Error';
    case 2: return 'Database Error';
    case 3: return 'File Error';
    case 4: return 'Knowledge Base Error';
    case 5: return 'AI Service Error';
    case 6: return 'Network Error';
    case 7: return 'Validation Error';
    case 8: return 'Settings Error';
    default: return 'Error';
  }
}

/**
 * Log error with consistent format
 */
export function logError(error: AppError | Error, context?: string): void {
  const timestamp = new Date().toISOString();
  const prefix = context ? `[${context}]` : '';

  if (error instanceof AppError) {
    console.error(
      `${timestamp} ${prefix} [${error.code}] ${error.name}: ${error.userMessage}`,
      error.technicalDetails ? `\nDetails: ${error.technicalDetails}` : '',
      error.cause ? `\nCause: ${(error.cause as Error).message}` : ''
    );
  } else {
    console.error(`${timestamp} ${prefix} Error: ${error.message}`, error);
  }
}
