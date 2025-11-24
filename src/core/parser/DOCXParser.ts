import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import { IParser, ParsedDocument } from './IParser';

/**
 * Parser for DOCX documents using mammoth
 */
export class DOCXParser implements IParser {
  private supportedExtensions = ['.docx'];

  /**
   * Parse a DOCX document from file path
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return this.parseBuffer(buffer, filePath);
    } catch (error) {
      throw new Error(`Failed to read DOCX file: ${(error as Error).message}`);
    }
  }

  /**
   * Parse a DOCX document from buffer
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      // Extract text from DOCX
      const result = await mammoth.extractRawText({ buffer });

      const warnings: string[] = [];

      // Collect any messages from mammoth
      if (result.messages && result.messages.length > 0) {
        result.messages.forEach((msg: { type: string; message: string }) => {
          if (msg.type === 'warning') {
            warnings.push(msg.message);
          }
        });
      }

      // Check if text extraction was successful
      if (!result.value || result.value.trim().length === 0) {
        warnings.push('DOCX appears to be empty. Text extraction may be incomplete.');
      }

      const stats = await fs.promises.stat(filePath).catch(() => null);
      const fileName = path.basename(filePath, path.extname(filePath));

      return {
        text: result.value,
        filePath,
        metadata: {
          title: fileName,
          fileSize: stats?.size,
          createdDate: stats?.birthtime,
          modifiedDate: stats?.mtime,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse DOCX: ${(error as Error).message}`);
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
