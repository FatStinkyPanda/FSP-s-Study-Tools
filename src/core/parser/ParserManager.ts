import * as path from 'path';
import { IParser, ParsedDocument } from './IParser';
import { PDFParser } from './PDFParser';
import { DOCXParser } from './DOCXParser';
import { TXTParser } from './TXTParser';
import { MarkdownParser } from './MarkdownParser';
import { EPUBParser } from './EPUBParser';
import { PPTXParser } from './PPTXParser';
import { ImageParser } from './ImageParser';

/**
 * Manager for coordinating document parsers
 */
export class ParserManager {
  private parsers: Map<string, IParser> = new Map();

  constructor() {
    // Register default parsers
    // Note: PDF parsing now uses pdfjs-dist which works in Electron main process
    this.registerParser(new PDFParser());
    this.registerParser(new DOCXParser());
    this.registerParser(new TXTParser());
    this.registerParser(new MarkdownParser());
    this.registerParser(new EPUBParser());
    this.registerParser(new PPTXParser());
    this.registerParser(new ImageParser());
  }

  /**
   * Register a parser for specific file types
   */
  registerParser(parser: IParser): void {
    const extensions = parser.getSupportedExtensions();
    extensions.forEach(ext => {
      this.parsers.set(ext.toLowerCase(), parser);
    });
  }

  /**
   * Get parser for a file extension
   */
  getParser(extension: string): IParser | undefined {
    return this.parsers.get(extension.toLowerCase());
  }

  /**
   * Check if file type is supported
   */
  isSupported(filePathOrExtension: string): boolean {
    const ext = filePathOrExtension.startsWith('.')
      ? filePathOrExtension
      : path.extname(filePathOrExtension);
    return this.parsers.has(ext.toLowerCase());
  }

  /**
   * Get all supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Parse a document file
   */
  async parseFile(filePath: string): Promise<ParsedDocument> {
    const ext = path.extname(filePath);

    if (!ext) {
      throw new Error('File has no extension');
    }

    const parser = this.getParser(ext);

    if (!parser) {
      throw new Error(
        `Unsupported file type: ${ext}. Supported types: ${this.getSupportedExtensions().join(', ')}`
      );
    }

    try {
      return await parser.parse(filePath);
    } catch (error) {
      throw new Error(
        `Failed to parse ${ext} file "${path.basename(filePath)}": ${(error as Error).message}`
      );
    }
  }

  /**
   * Parse document from buffer with file extension hint
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    const ext = path.extname(filePath);

    if (!ext) {
      throw new Error('File path has no extension');
    }

    const parser = this.getParser(ext);

    if (!parser) {
      throw new Error(
        `Unsupported file type: ${ext}. Supported types: ${this.getSupportedExtensions().join(', ')}`
      );
    }

    try {
      return await parser.parseBuffer(buffer, filePath);
    } catch (error) {
      throw new Error(
        `Failed to parse ${ext} buffer "${path.basename(filePath)}": ${(error as Error).message}`
      );
    }
  }

  /**
   * Get file filter for Electron dialog
   */
  getFileFilters(): Array<{ name: string; extensions: string[] }> {
    const allExtensions = this.getSupportedExtensions().map(ext => ext.substring(1));

    return [
      {
        name: 'All Supported Files',
        extensions: allExtensions,
      },
      {
        name: 'PDF Documents',
        extensions: ['pdf'],
      },
      {
        name: 'Word Documents',
        extensions: ['docx'],
      },
      {
        name: 'Markdown Documents',
        extensions: ['md', 'markdown', 'mdown', 'mkd'],
      },
      {
        name: 'EPUB E-Books',
        extensions: ['epub'],
      },
      {
        name: 'PowerPoint Presentations',
        extensions: ['pptx', 'ppt'],
      },
      {
        name: 'Text Documents',
        extensions: ['txt', 'text'],
      },
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif'],
      },
    ];
  }
}
