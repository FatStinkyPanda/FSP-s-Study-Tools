import * as fs from 'fs';
import * as path from 'path';
import { IParser, ParsedDocument, ParsedContentElement } from './IParser';

/**
 * Parser for standalone image files (screenshots, photos, diagrams)
 * Converts images to base64 data URLs for embedding in knowledge bases
 */
export class ImageParser implements IParser {
  private supportedExtensions = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.webp',
    '.svg',
    '.tiff',
    '.tif',
  ];

  /**
   * Parse an image file from file path
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return this.parseBuffer(buffer, filePath);
    } catch (error) {
      throw new Error(`Failed to read image file: ${(error as Error).message}`);
    }
  }

  /**
   * Parse an image file from buffer
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(ext);
      const fileName = path.basename(filePath, ext);

      // Convert to base64 data URL
      const base64Data = buffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      // Get file stats
      const stats = await fs.promises.stat(filePath).catch(() => null);

      // Create image element
      const imageElement: ParsedContentElement = {
        type: 'image',
        src: dataUrl,
        alt: fileName,
      };

      // Create descriptive text for the image
      const descriptiveText = `[Image: ${fileName}]`;

      return {
        text: descriptiveText,
        elements: [imageElement],
        filePath,
        metadata: {
          title: fileName,
          format: ext.substring(1),
          mimeType,
          fileSize: stats?.size,
          createdDate: stats?.birthtime,
          modifiedDate: stats?.mtime,
          isImage: true,
          imageWidth: undefined, // Could be extracted with image processing library
          imageHeight: undefined,
        },
      };
    } catch (error) {
      throw new Error(`Failed to parse image: ${(error as Error).message}`);
    }
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
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
