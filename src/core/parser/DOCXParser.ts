import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
import { IParser, ParsedDocument, ParsedContentElement } from './IParser';

/**
 * Parser for DOCX documents using mammoth with image extraction
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
   * Parse a DOCX document from buffer with image extraction
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      const warnings: string[] = [];
      const elements: ParsedContentElement[] = [];

      // Extract text from DOCX using mammoth
      const result = await mammoth.extractRawText({ buffer });

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

      // Parse text into paragraph elements
      const paragraphs = result.value.split(/\n+/).filter(p => p.trim());
      for (const para of paragraphs) {
        elements.push({
          type: 'paragraph',
          content: para.trim(),
        });
      }

      // Extract images from DOCX ZIP structure
      const imageElements = await this.extractImages(buffer);
      elements.push(...imageElements);

      if (imageElements.length > 0) {
        console.log(`Extracted ${imageElements.length} images from DOCX`);
      }

      const stats = await fs.promises.stat(filePath).catch(() => null);
      const fileName = path.basename(filePath, path.extname(filePath));

      // Extract metadata from core.xml
      const metadata = await this.extractMetadata(buffer, fileName);

      return {
        text: result.value,
        elements,
        filePath,
        metadata: {
          ...metadata,
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
   * Extract images from DOCX ZIP structure
   */
  private async extractImages(buffer: Buffer): Promise<ParsedContentElement[]> {
    const images: ParsedContentElement[] = [];

    try {
      const zip = await JSZip.loadAsync(buffer);

      // DOCX stores images in word/media/ directory
      const mediaFiles: string[] = [];
      zip.forEach((relativePath: string) => {
        if (relativePath.startsWith('word/media/')) {
          mediaFiles.push(relativePath);
        }
      });

      // Extract each image
      for (const mediaFile of mediaFiles) {
        try {
          const imageData = await zip.file(mediaFile)?.async('base64');
          if (imageData) {
            const mimeType = this.getMimeType(mediaFile);
            const fileName = path.basename(mediaFile);

            images.push({
              type: 'image',
              src: `data:${mimeType};base64,${imageData}`,
              alt: fileName,
            });
          }
        } catch (imgError) {
          console.warn(`Failed to extract image ${mediaFile}:`, imgError);
        }
      }
    } catch (error) {
      console.warn('Failed to extract images from DOCX:', error);
    }

    return images;
  }

  /**
   * Extract metadata from DOCX core.xml
   */
  private async extractMetadata(buffer: Buffer, defaultTitle: string): Promise<Record<string, unknown>> {
    const metadata: Record<string, unknown> = {
      title: defaultTitle,
    };

    try {
      const zip = await JSZip.loadAsync(buffer);
      const coreXml = await zip.file('docProps/core.xml')?.async('text');

      if (coreXml) {
        // Extract title
        const titleMatch = coreXml.match(/<dc:title>(.*?)<\/dc:title>/);
        if (titleMatch && titleMatch[1]) {
          metadata.title = titleMatch[1];
        }

        // Extract author/creator
        const creatorMatch = coreXml.match(/<dc:creator>(.*?)<\/dc:creator>/);
        if (creatorMatch && creatorMatch[1]) {
          metadata.author = creatorMatch[1];
        }

        // Extract subject
        const subjectMatch = coreXml.match(/<dc:subject>(.*?)<\/dc:subject>/);
        if (subjectMatch && subjectMatch[1]) {
          metadata.subject = subjectMatch[1];
        }

        // Extract keywords
        const keywordsMatch = coreXml.match(/<cp:keywords>(.*?)<\/cp:keywords>/);
        if (keywordsMatch && keywordsMatch[1]) {
          metadata.keywords = keywordsMatch[1].split(/[,;]/).map((k: string) => k.trim());
        }
      }
    } catch {
      // Metadata extraction is non-critical
    }

    return metadata;
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.wmf': 'image/x-wmf',
      '.emf': 'image/x-emf',
      '.svg': 'image/svg+xml',
    };
    return mimeTypes[ext] || 'image/png';
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
