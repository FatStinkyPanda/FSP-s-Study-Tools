/**
 * Document Parser Module
 *
 * Provides parsing capabilities for various document formats:
 * - PDF (.pdf)
 * - Microsoft Word (.docx)
 * - Plain Text (.txt, .text)
 * - Markdown (.md, .markdown, .mdown, .mkd)
 * - EPUB e-books (.epub)
 * - PowerPoint (.pptx, .ppt)
 */

export type { IParser, ParsedDocument, ParsedContentElement } from './IParser';
export { PDFParser } from './PDFParser';
export { DOCXParser } from './DOCXParser';
export { TXTParser } from './TXTParser';
export { MarkdownParser } from './MarkdownParser';
export { EPUBParser } from './EPUBParser';
export { PPTXParser } from './PPTXParser';
export { ParserManager } from './ParserManager';
