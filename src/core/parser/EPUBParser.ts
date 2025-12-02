import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const epub2 = require('epub2');
import { IParser, ParsedDocument, ParsedContentElement } from './IParser';

// Define types for epub2 library
interface EpubMetadata {
  title?: string;
  creator?: string;
  publisher?: string;
  language?: string;
  subject?: string;
  description?: string;
  date?: string;
}

interface TocItem {
  title?: string;
  level?: number;
  id?: string;
}

interface FlowItem {
  id: string;
  title?: string;
}

interface ManifestItem {
  id: string;
  href: string;
  'media-type'?: string;
}

interface EpubInstance {
  metadata: EpubMetadata;
  toc: TocItem[];
  flow: FlowItem[];
  manifest: Record<string, ManifestItem>;
  on(event: 'error', callback: (error: Error) => void): void;
  on(event: 'end', callback: () => void): void;
  parse(): void;
  getChapter(chapterId: string, callback: (error: Error | null, text: string) => void): void;
  getImage(imageId: string, callback: (error: Error | null, data: Buffer, mimeType: string) => void): void;
}

/**
 * Parser for EPUB e-book documents
 */
export class EPUBParser implements IParser {
  private supportedExtensions = ['.epub'];

  /**
   * Parse an EPUB document from file path
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    return new Promise((resolve, reject) => {
      const epub: EpubInstance = new epub2.EPub(filePath);

      epub.on('error', (error: Error) => {
        reject(new Error(`Failed to parse EPUB: ${error.message}`));
      });

      epub.on('end', async () => {
        try {
          const result = await this.processEpub(epub, filePath);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      epub.parse();
    });
  }

  /**
   * Parse an EPUB document from buffer
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    // Write buffer to temp file since epub2 doesn't support buffer input
    const tempPath = path.join(
      path.dirname(filePath),
      `.temp_${Date.now()}_${path.basename(filePath)}`
    );

    try {
      await fs.promises.writeFile(tempPath, buffer);
      const result = await this.parse(tempPath);
      await fs.promises.unlink(tempPath).catch(() => {});
      return result;
    } catch (error) {
      await fs.promises.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Process parsed EPUB and extract content
   */
  private async processEpub(epub: EpubInstance, filePath: string): Promise<ParsedDocument> {
    const warnings: string[] = [];
    const elements: ParsedContentElement[] = [];
    const textParts: string[] = [];

    // Extract metadata
    const metadata: Record<string, unknown> = {
      title: epub.metadata?.title || path.basename(filePath, '.epub'),
      author: epub.metadata?.creator,
      publisher: epub.metadata?.publisher,
      language: epub.metadata?.language,
      subject: epub.metadata?.subject,
      description: epub.metadata?.description,
      date: epub.metadata?.date ? new Date(epub.metadata.date) : undefined,
      format: 'epub',
    };

    // Extract all images from EPUB manifest upfront
    const imageCache = await this.extractAllImages(epub);
    if (imageCache.size > 0) {
      console.log(`Extracted ${imageCache.size} images from EPUB`);
    }

    // Get table of contents
    const toc = epub.toc || [];

    // Add TOC as structure
    if (toc.length > 0) {
      elements.push({
        type: 'heading',
        content: 'Table of Contents',
        level: 1,
      });

      const tocItems = toc.map((item: TocItem) =>
        `${'  '.repeat((item.level || 1) - 1)}${item.title || 'Untitled'}`
      );

      elements.push({
        type: 'list',
        items: tocItems,
        ordered: true,
      });
    }

    // Extract content from each chapter
    const flow = epub.flow || [];

    for (const chapter of flow) {
      try {
        const chapterContent = await this.getChapter(epub, chapter.id);

        if (chapterContent) {
          // Extract text and elements from HTML content with image resolution
          const { text, chapterElements } = this.parseHtmlContent(chapterContent, chapter.title, imageCache);
          textParts.push(text);
          elements.push(...chapterElements);
        }
      } catch (error) {
        warnings.push(`Failed to extract chapter ${chapter.id}: ${(error as Error).message}`);
      }
    }

    const stats = await fs.promises.stat(filePath).catch(() => null);

    return {
      text: textParts.join('\n\n'),
      elements,
      filePath,
      metadata: {
        ...metadata,
        pages: flow.length,
        fileSize: stats?.size,
        createdDate: stats?.birthtime,
        modifiedDate: stats?.mtime,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Extract all images from EPUB manifest
   */
  private async extractAllImages(epub: EpubInstance): Promise<Map<string, string>> {
    const imageCache = new Map<string, string>();

    if (!epub.manifest) {
      return imageCache;
    }

    // Find all image items in manifest
    const imageItems = Object.values(epub.manifest).filter(
      (item: ManifestItem) =>
        item['media-type']?.startsWith('image/') ||
        /\.(jpg|jpeg|png|gif|svg|bmp|webp)$/i.test(item.href)
    );

    for (const item of imageItems) {
      try {
        const imageData = await this.getImage(epub, item.id);
        if (imageData) {
          // Store with both the item ID and the href (filename) as keys
          const mimeType = item['media-type'] || this.getMimeTypeFromPath(item.href);
          const dataUrl = `data:${mimeType};base64,${imageData.toString('base64')}`;

          // Store by ID
          imageCache.set(item.id, dataUrl);

          // Also store by href (both full path and filename only)
          imageCache.set(item.href, dataUrl);
          const fileName = path.basename(item.href);
          imageCache.set(fileName, dataUrl);

          // Store by common relative path patterns
          if (item.href.includes('/')) {
            const parts = item.href.split('/');
            // Store last two segments (e.g., "images/image1.jpg")
            if (parts.length >= 2) {
              imageCache.set(parts.slice(-2).join('/'), dataUrl);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to extract image ${item.id}:`, error);
      }
    }

    return imageCache;
  }

  /**
   * Get image data from EPUB
   */
  private getImage(epub: EpubInstance, imageId: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      epub.getImage(imageId, (error: Error | null, data: Buffer) => {
        if (error || !data) {
          resolve(null);
        } else {
          resolve(data);
        }
      });
    });
  }

  /**
   * Get MIME type from file path
   */
  private getMimeTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'image/png';
  }

  /**
   * Get chapter content from EPUB
   */
  private getChapter(epub: EpubInstance, chapterId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      epub.getChapter(chapterId, (error: Error | null, text: string) => {
        if (error) {
          reject(error);
        } else {
          resolve(text || '');
        }
      });
    });
  }

  /**
   * Parse HTML content to extract text and elements
   */
  private parseHtmlContent(
    html: string,
    chapterTitle?: string,
    imageCache?: Map<string, string>
  ): { text: string; chapterElements: ParsedContentElement[] } {
    const elements: ParsedContentElement[] = [];

    // Add chapter heading if available
    if (chapterTitle) {
      elements.push({
        type: 'heading',
        content: chapterTitle,
        level: 2,
      });
    }

    // Extract headings
    const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
    let match;
    while ((match = headingRegex.exec(html)) !== null) {
      elements.push({
        type: 'heading',
        content: this.stripHtml(match[2]),
        level: parseInt(match[1], 10),
      });
    }

    // Extract paragraphs
    const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gi;
    while ((match = paragraphRegex.exec(html)) !== null) {
      const content = this.stripHtml(match[1]).trim();
      if (content) {
        elements.push({
          type: 'paragraph',
          content,
        });
      }
    }

    // Extract lists
    const listRegex = /<(ul|ol)[^>]*>(.*?)<\/\1>/gis;
    while ((match = listRegex.exec(html)) !== null) {
      const listItems: string[] = [];
      const itemRegex = /<li[^>]*>(.*?)<\/li>/gi;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(match[2])) !== null) {
        listItems.push(this.stripHtml(itemMatch[1]).trim());
      }
      if (listItems.length > 0) {
        elements.push({
          type: 'list',
          items: listItems,
          ordered: match[1].toLowerCase() === 'ol',
        });
      }
    }

    // Extract blockquotes
    const blockquoteRegex = /<blockquote[^>]*>(.*?)<\/blockquote>/gis;
    while ((match = blockquoteRegex.exec(html)) !== null) {
      elements.push({
        type: 'blockquote',
        content: this.stripHtml(match[1]).trim(),
      });
    }

    // Extract images and resolve to base64 data URLs
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi;
    while ((match = imgRegex.exec(html)) !== null) {
      const srcPath = match[1];
      const altText = match[2] || undefined;

      // Try to resolve image from cache
      let resolvedSrc = srcPath;
      if (imageCache) {
        // Try various path formats to find the image
        const pathsToTry = [
          srcPath,
          srcPath.replace(/^\.\.\//, ''), // Remove leading ../
          srcPath.replace(/^\.\//, ''),   // Remove leading ./
          path.basename(srcPath),          // Just filename
        ];

        // Also try the last two segments of the path
        if (srcPath.includes('/')) {
          const parts = srcPath.split('/');
          if (parts.length >= 2) {
            pathsToTry.push(parts.slice(-2).join('/'));
          }
        }

        for (const tryPath of pathsToTry) {
          if (imageCache.has(tryPath)) {
            resolvedSrc = imageCache.get(tryPath)!;
            console.log(`Resolved EPUB image ${srcPath} -> ${tryPath}`);
            break;
          }
        }
      }

      elements.push({
        type: 'image',
        src: resolvedSrc,
        alt: altText,
      });
    }

    // Get plain text
    const text = this.stripHtml(html);

    return { text, chapterElements: elements };
  }

  /**
   * Strip HTML tags and decode entities
   */
  private stripHtml(html: string): string {
    // Remove HTML tags
    let text = html.replace(/<[^>]+>/g, ' ');

    // Decode common HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '...')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
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
