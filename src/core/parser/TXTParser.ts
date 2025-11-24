import * as fs from 'fs';
import * as path from 'path';
import { IParser, ParsedDocument } from './IParser';

/**
 * Parser for plain text documents
 */
export class TXTParser implements IParser {
  private supportedExtensions = ['.txt', '.text', '.md', '.markdown'];

  /**
   * Parse a text document from file path
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return this.parseBuffer(buffer, filePath);
    } catch (error) {
      throw new Error(`Failed to read text file: ${(error as Error).message}`);
    }
  }

  /**
   * Parse a text document from buffer
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      // Try to detect encoding, default to UTF-8
      let text: string;

      try {
        text = buffer.toString('utf-8');
      } catch (error) {
        // Fallback to Latin-1 if UTF-8 fails
        text = buffer.toString('latin1');
      }

      const warnings: string[] = [];

      // Check if text is empty
      if (!text || text.trim().length === 0) {
        warnings.push('Text file appears to be empty.');
      }

      const stats = await fs.promises.stat(filePath).catch(() => null);
      const fileName = path.basename(filePath, path.extname(filePath));
      const extension = path.extname(filePath);

      return {
        text,
        filePath,
        metadata: {
          title: fileName,
          fileSize: stats?.size,
          createdDate: stats?.birthtime,
          modifiedDate: stats?.mtime,
          encoding: 'utf-8',
          format: extension === '.md' || extension === '.markdown' ? 'markdown' : 'plain text',
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse text file: ${(error as Error).message}`);
    }
  }

  /**
   * Check if parser supports file extension
   */
  supports(extension: string): boolean {
    return this.supportedExtensions.includes(extension.toLowerCase());
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return [...this.supportedExtensions];
  }
}
