/**
 * IPC Input Validation Utilities
 *
 * Provides validation functions for IPC handler inputs to prevent
 * injection attacks and ensure data integrity.
 */

import { createLogger } from './logger';

const log = createLogger('IPCValidation');

// Maximum sizes for various inputs
export const MAX_SIZES = {
  XML_CONTENT: 50 * 1024 * 1024,     // 50MB max for KB XML
  JSON_STRING: 10 * 1024 * 1024,     // 10MB max for JSON strings
  SQL_QUERY: 10000,                   // 10K chars for SQL queries
  SEARCH_QUERY: 1000,                 // 1K chars for search queries
  FILE_PATH: 500,                     // 500 chars for file paths
  PROFILE_NAME: 100,                  // 100 chars for profile names
  MESSAGE_CONTENT: 100000,            // 100K chars for chat messages
  HIGHLIGHT_TEXT: 10000,              // 10K chars for highlighted text
  NOTE_TEXT: 50000,                   // 50K chars for notes
  ARRAY_LENGTH: 1000,                 // Max 1000 items in arrays
  QUESTIONS_PER_TEST: 500,            // Max 500 questions per test
};

// Valid color names for highlights
export const VALID_HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'];

// SQL injection prevention - dangerous keywords
const SQL_DANGEROUS_PATTERNS = [
  /;\s*drop\s+/i,
  /;\s*delete\s+/i,
  /;\s*truncate\s+/i,
  /;\s*alter\s+/i,
  /;\s*create\s+/i,
  /;\s*insert\s+into\s+/i,
  /--/,                           // SQL comments
  /\/\*.*\*\//,                   // Block comments
  /union\s+select/i,
  /xp_cmdshell/i,
];

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: unknown;
}

/**
 * Validates that a value is a positive integer
 */
export function validatePositiveInteger(value: unknown, fieldName: string): ValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { valid: false, error: `${fieldName} must be a non-negative integer` };
  }
  return { valid: true, sanitized: value };
}

/**
 * Validates that a value is a positive integer within a range
 */
export function validateIntegerInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number
): ValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { valid: false, error: `${fieldName} must be an integer` };
  }
  if (value < min || value > max) {
    return { valid: false, error: `${fieldName} must be between ${min} and ${max}` };
  }
  return { valid: true, sanitized: value };
}

/**
 * Validates a string with max length
 */
export function validateString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  required = true
): ValidationResult {
  if (value === undefined || value === null) {
    if (required) {
      return { valid: false, error: `${fieldName} is required` };
    }
    return { valid: true, sanitized: undefined };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }

  return { valid: true, sanitized: value };
}

/**
 * Validates SQL query for dangerous patterns (injection prevention)
 */
export function validateSQLQuery(sql: unknown): ValidationResult {
  const stringResult = validateString(sql, 'SQL query', MAX_SIZES.SQL_QUERY);
  if (!stringResult.valid) return stringResult;

  const sqlStr = sql as string;

  for (const pattern of SQL_DANGEROUS_PATTERNS) {
    if (pattern.test(sqlStr)) {
      log.warn('Potentially dangerous SQL pattern detected:', sqlStr.substring(0, 100));
      return { valid: false, error: 'SQL query contains potentially dangerous patterns' };
    }
  }

  return { valid: true, sanitized: sqlStr };
}

/**
 * Validates file path for path traversal attacks
 */
export function validateFilePath(filePath: unknown, fieldName = 'File path'): ValidationResult {
  const stringResult = validateString(filePath, fieldName, MAX_SIZES.FILE_PATH);
  if (!stringResult.valid) return stringResult;

  const pathStr = filePath as string;

  // Check for path traversal attempts
  if (pathStr.includes('..') || pathStr.includes('//') || pathStr.includes('\\\\')) {
    log.warn('Path traversal attempt detected:', pathStr);
    return { valid: false, error: `${fieldName} contains invalid path characters` };
  }

  // Check for null bytes (used in path injection)
  if (pathStr.includes('\0')) {
    log.warn('Null byte in path detected:', pathStr);
    return { valid: false, error: `${fieldName} contains invalid characters` };
  }

  return { valid: true, sanitized: pathStr };
}

/**
 * Validates XML content with size limits
 */
export function validateXMLContent(content: unknown): ValidationResult {
  const stringResult = validateString(content, 'XML content', MAX_SIZES.XML_CONTENT);
  if (!stringResult.valid) return stringResult;

  const xmlStr = content as string;

  // Basic XML structure check
  if (!xmlStr.trim().startsWith('<?xml') && !xmlStr.trim().startsWith('<')) {
    return { valid: false, error: 'Invalid XML format' };
  }

  return { valid: true, sanitized: xmlStr };
}

/**
 * Validates an array with item validation
 */
export function validateArray(
  value: unknown,
  fieldName: string,
  maxLength: number,
  itemValidator?: (item: unknown, index: number) => ValidationResult
): ValidationResult {
  if (!Array.isArray(value)) {
    return { valid: false, error: `${fieldName} must be an array` };
  }

  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds maximum length of ${maxLength} items` };
  }

  if (itemValidator) {
    for (let i = 0; i < value.length; i++) {
      const result = itemValidator(value[i], i);
      if (!result.valid) {
        return { valid: false, error: `${fieldName}[${i}]: ${result.error}` };
      }
    }
  }

  return { valid: true, sanitized: value };
}

/**
 * Validates a highlight color
 */
export function validateHighlightColor(color: unknown): ValidationResult {
  if (color === undefined || color === null) {
    return { valid: true, sanitized: 'yellow' }; // Default color
  }

  if (typeof color !== 'string') {
    return { valid: false, error: 'Color must be a string' };
  }

  if (!VALID_HIGHLIGHT_COLORS.includes(color.toLowerCase())) {
    return { valid: false, error: `Color must be one of: ${VALID_HIGHLIGHT_COLORS.join(', ')}` };
  }

  return { valid: true, sanitized: color.toLowerCase() };
}

/**
 * Validates message content for chat
 */
export function validateMessageContent(message: unknown): ValidationResult {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  const msg = message as Record<string, unknown>;

  // Validate role
  if (!msg.role || typeof msg.role !== 'string') {
    return { valid: false, error: 'Message role is required' };
  }

  const validRoles = ['user', 'assistant', 'system', 'tool'];
  if (!validRoles.includes(msg.role)) {
    return { valid: false, error: `Message role must be one of: ${validRoles.join(', ')}` };
  }

  // Validate content
  if (msg.content !== undefined && msg.content !== null) {
    const contentResult = validateString(msg.content, 'Message content', MAX_SIZES.MESSAGE_CONTENT, false);
    if (!contentResult.valid) return contentResult;
  }

  return { valid: true, sanitized: message };
}

/**
 * Validates highlight creation parameters
 */
export function validateHighlightParams(params: unknown): ValidationResult {
  if (!params || typeof params !== 'object') {
    return { valid: false, error: 'Highlight parameters must be an object' };
  }

  const p = params as Record<string, unknown>;

  // Validate kb_id
  const kbIdResult = validatePositiveInteger(p.kb_id, 'kb_id');
  if (!kbIdResult.valid) return kbIdResult;

  // Validate section_id
  const sectionIdResult = validateString(p.section_id, 'section_id', 200);
  if (!sectionIdResult.valid) return sectionIdResult;

  // Validate offsets
  const startResult = validatePositiveInteger(p.start_offset, 'start_offset');
  if (!startResult.valid) return startResult;

  const endResult = validatePositiveInteger(p.end_offset, 'end_offset');
  if (!endResult.valid) return endResult;

  if ((p.start_offset as number) >= (p.end_offset as number)) {
    return { valid: false, error: 'start_offset must be less than end_offset' };
  }

  // Validate text
  const textResult = validateString(p.text, 'text', MAX_SIZES.HIGHLIGHT_TEXT);
  if (!textResult.valid) return textResult;

  // Validate optional color
  const colorResult = validateHighlightColor(p.color);
  if (!colorResult.valid) return colorResult;

  // Validate optional note
  if (p.note !== undefined && p.note !== null) {
    const noteResult = validateString(p.note, 'note', MAX_SIZES.NOTE_TEXT, false);
    if (!noteResult.valid) return noteResult;
  }

  return { valid: true, sanitized: params };
}

/**
 * Validates test generation parameters
 */
export function validateTestGenerationParams(params: unknown): ValidationResult {
  if (!params || typeof params !== 'object') {
    return { valid: false, error: 'Test generation parameters must be an object' };
  }

  const p = params as Record<string, unknown>;

  // Validate kbId
  const kbIdResult = validatePositiveInteger(p.kbId, 'kbId');
  if (!kbIdResult.valid) return kbIdResult;

  // Validate optional arrays
  if (p.moduleIds !== undefined) {
    const moduleResult = validateArray(p.moduleIds, 'moduleIds', MAX_SIZES.ARRAY_LENGTH);
    if (!moduleResult.valid) return moduleResult;
  }

  if (p.chapterIds !== undefined) {
    const chapterResult = validateArray(p.chapterIds, 'chapterIds', MAX_SIZES.ARRAY_LENGTH);
    if (!chapterResult.valid) return chapterResult;
  }

  if (p.sectionIds !== undefined) {
    const sectionResult = validateArray(p.sectionIds, 'sectionIds', MAX_SIZES.ARRAY_LENGTH);
    if (!sectionResult.valid) return sectionResult;
  }

  // Validate optional numeric params
  if (p.questionsPerSection !== undefined) {
    const qpsResult = validateIntegerInRange(p.questionsPerSection, 'questionsPerSection', 1, 50);
    if (!qpsResult.valid) return qpsResult;
  }

  if (p.totalQuestions !== undefined) {
    const tqResult = validateIntegerInRange(p.totalQuestions, 'totalQuestions', 1, MAX_SIZES.QUESTIONS_PER_TEST);
    if (!tqResult.valid) return tqResult;
  }

  // Validate difficulty
  if (p.difficulty !== undefined) {
    const validDifficulties = ['easy', 'medium', 'hard'];
    if (!validDifficulties.includes(p.difficulty as string)) {
      return { valid: false, error: `difficulty must be one of: ${validDifficulties.join(', ')}` };
    }
  }

  return { valid: true, sanitized: params };
}

/**
 * Validates synthesize request parameters
 */
export function validateSynthesizeRequest(request: unknown): ValidationResult {
  if (!request || typeof request !== 'object') {
    return { valid: false, error: 'Synthesize request must be an object' };
  }

  const r = request as Record<string, unknown>;

  // Validate text
  const textResult = validateString(r.text, 'text', MAX_SIZES.MESSAGE_CONTENT);
  if (!textResult.valid) return textResult;

  // Validate profile_id
  const profileResult = validateString(r.profile_id, 'profile_id', 100);
  if (!profileResult.valid) return profileResult;

  // Validate optional language
  if (r.language !== undefined) {
    const langResult = validateString(r.language, 'language', 10, false);
    if (!langResult.valid) return langResult;
  }

  // Validate optional speed
  if (r.speed !== undefined) {
    if (typeof r.speed !== 'number' || r.speed < 0.1 || r.speed > 3.0) {
      return { valid: false, error: 'speed must be a number between 0.1 and 3.0' };
    }
  }

  return { valid: true, sanitized: request };
}

/**
 * Helper to wrap an IPC handler with validation
 */
export function withValidation<T extends unknown[], R>(
  handler: (...args: T) => Promise<R>,
  validators: Array<(arg: unknown) => ValidationResult>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    for (let i = 0; i < validators.length && i < args.length; i++) {
      const result = validators[i](args[i]);
      if (!result.valid) {
        throw new Error(`Validation failed: ${result.error}`);
      }
    }
    return handler(...args);
  };
}

export default {
  MAX_SIZES,
  VALID_HIGHLIGHT_COLORS,
  validatePositiveInteger,
  validateIntegerInRange,
  validateString,
  validateSQLQuery,
  validateFilePath,
  validateXMLContent,
  validateArray,
  validateHighlightColor,
  validateMessageContent,
  validateHighlightParams,
  validateTestGenerationParams,
  validateSynthesizeRequest,
  withValidation,
};
