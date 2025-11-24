/**
 * Document Parser Module
 *
 * Provides parsing capabilities for various document formats:
 * - PDF (.pdf)
 * - Microsoft Word (.docx)
 * - Plain Text (.txt, .md)
 */

export type { IParser, ParsedDocument } from './IParser';
export { PDFParser } from './PDFParser';
export { DOCXParser } from './DOCXParser';
export { TXTParser } from './TXTParser';
export { ParserManager } from './ParserManager';
