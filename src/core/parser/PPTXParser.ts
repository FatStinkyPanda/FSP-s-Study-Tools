import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
import { IParser, ParsedDocument, ParsedContentElement } from './IParser';

/**
 * Parser for PowerPoint (PPTX) presentations
 */
export class PPTXParser implements IParser {
  private supportedExtensions = ['.pptx', '.ppt'];

  /**
   * Parse a PowerPoint document from file path
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return this.parseBuffer(buffer, filePath);
    } catch (error) {
      throw new Error(`Failed to read PowerPoint file: ${(error as Error).message}`);
    }
  }

  /**
   * Parse a PowerPoint document from buffer
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      const warnings: string[] = [];
      const elements: ParsedContentElement[] = [];
      const textParts: string[] = [];

      // Check if it's a legacy .ppt file
      const extension = path.extname(filePath).toLowerCase();
      if (extension === '.ppt') {
        warnings.push('Legacy .ppt format detected. Limited parsing support available.');
        // For legacy PPT, we can only provide basic info
        const stats = await fs.promises.stat(filePath).catch(() => null);
        return {
          text: 'Legacy PowerPoint format (.ppt) - please convert to .pptx for full content extraction.',
          elements: [],
          filePath,
          metadata: {
            title: path.basename(filePath, extension),
            format: 'ppt-legacy',
            fileSize: stats?.size,
            createdDate: stats?.birthtime,
            modifiedDate: stats?.mtime,
          },
          warnings,
        };
      }

      // Parse PPTX (OpenXML format)
      const zip = await JSZip.loadAsync(buffer);

      // Extract metadata from docProps/core.xml
      const metadata = await this.extractMetadata(zip, filePath);

      // Extract all images from ppt/media/ directory upfront
      const allImages = await this.extractAllImages(zip);
      if (allImages.size > 0) {
        console.log(`Found ${allImages.size} images in PPTX media directory`);
      }

      // Get list of slide files
      const slideFiles: string[] = [];
      zip.forEach((relativePath: string) => {
        if (relativePath.match(/^ppt\/slides\/slide\d+\.xml$/)) {
          slideFiles.push(relativePath);
        }
      });

      // Sort slides by number
      slideFiles.sort((a: string, b: string) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0', 10);
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0', 10);
        return numA - numB;
      });

      // Extract content from each slide
      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = slideFiles[i];
        const slideNum = i + 1;

        try {
          const slideXml = await zip.file(slideFile)?.async('text');
          if (slideXml) {
            // Build relationship map for this slide to resolve image references
            const relMap = await this.buildRelationshipMap(zip, slideNum);
            const { slideText, slideElements } = this.parseSlideXml(slideXml, slideNum, relMap, allImages);
            textParts.push(`--- Slide ${slideNum} ---\n${slideText}`);
            elements.push(...slideElements);
          }
        } catch (error) {
          warnings.push(`Failed to parse slide ${slideNum}: ${(error as Error).message}`);
        }
      }

      // Extract notes if available
      const notesElements = await this.extractNotes(zip, slideFiles.length);
      if (notesElements.length > 0) {
        elements.push({
          type: 'heading',
          content: 'Speaker Notes',
          level: 2,
        });
        elements.push(...notesElements);
      }

      const stats = await fs.promises.stat(filePath).catch(() => null);

      return {
        text: textParts.join('\n\n'),
        elements,
        filePath,
        metadata: {
          ...metadata,
          pages: slideFiles.length,
          fileSize: stats?.size,
          createdDate: stats?.birthtime,
          modifiedDate: stats?.mtime,
          format: 'pptx',
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse PowerPoint file: ${(error as Error).message}`);
    }
  }

  /**
   * Extract metadata from core.xml
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async extractMetadata(zip: any, filePath: string): Promise<Record<string, unknown>> {
    const metadata: Record<string, unknown> = {
      title: path.basename(filePath, path.extname(filePath)),
    };

    try {
      const coreXml = await zip.file('docProps/core.xml')?.async('text');
      if (coreXml) {
        // Extract title
        const titleMatch = coreXml.match(/<dc:title>(.*?)<\/dc:title>/);
        if (titleMatch) {
          metadata.title = titleMatch[1];
        }

        // Extract author/creator
        const creatorMatch = coreXml.match(/<dc:creator>(.*?)<\/dc:creator>/);
        if (creatorMatch) {
          metadata.author = creatorMatch[1];
        }

        // Extract subject
        const subjectMatch = coreXml.match(/<dc:subject>(.*?)<\/dc:subject>/);
        if (subjectMatch) {
          metadata.subject = subjectMatch[1];
        }

        // Extract keywords
        const keywordsMatch = coreXml.match(/<cp:keywords>(.*?)<\/cp:keywords>/);
        if (keywordsMatch) {
          metadata.keywords = keywordsMatch[1].split(/[,;]/).map((k: string) => k.trim());
        }

        // Extract creation date
        const createdMatch = coreXml.match(/<dcterms:created[^>]*>(.*?)<\/dcterms:created>/);
        if (createdMatch) {
          metadata.createdDate = new Date(createdMatch[1]);
        }

        // Extract modification date
        const modifiedMatch = coreXml.match(/<dcterms:modified[^>]*>(.*?)<\/dcterms:modified>/);
        if (modifiedMatch) {
          metadata.modifiedDate = new Date(modifiedMatch[1]);
        }
      }
    } catch {
      // Metadata extraction is non-critical
    }

    return metadata;
  }

  /**
   * Parse slide XML content
   */
  private parseSlideXml(
    xml: string,
    slideNum: number,
    relMap: Map<string, string>,
    allImages: Map<string, { data: string; mimeType: string }>
  ): { slideText: string; slideElements: ParsedContentElement[] } {
    const elements: ParsedContentElement[] = [];
    const textParts: string[] = [];

    // Add slide heading
    elements.push({
      type: 'heading',
      content: `Slide ${slideNum}`,
      level: 2,
    });

    // Check for paragraph breaks using <a:p> elements
    const paragraphs: string[] = [];
    const paragraphRegex = /<a:p[^>]*>(.*?)<\/a:p>/gs;
    let match;
    while ((match = paragraphRegex.exec(xml)) !== null) {
      const paraText = this.extractTextFromParagraph(match[1]);
      if (paraText.trim()) {
        paragraphs.push(paraText.trim());
      }
    }

    if (paragraphs.length > 0) {
      // First non-empty paragraph is likely the title
      if (paragraphs[0]) {
        elements.push({
          type: 'heading',
          content: paragraphs[0],
          level: 3,
        });
        textParts.push(paragraphs[0]);
      }

      // Rest are body content
      for (let i = 1; i < paragraphs.length; i++) {
        if (paragraphs[i]) {
          elements.push({
            type: 'paragraph',
            content: paragraphs[i],
          });
          textParts.push(paragraphs[i]);
        }
      }
    }

    // Check for images and resolve actual image data
    const imageRegex = /<a:blip[^>]+r:embed="([^"]+)"/g;
    let imageIndex = 1;
    while ((match = imageRegex.exec(xml)) !== null) {
      const rId = match[1];
      const mediaFileName = relMap.get(rId);

      if (mediaFileName && allImages.has(mediaFileName)) {
        // Found actual image data - use base64 data URL
        const imageInfo = allImages.get(mediaFileName)!;
        elements.push({
          type: 'image',
          src: `data:${imageInfo.mimeType};base64,${imageInfo.data}`,
          alt: `Slide ${slideNum} - Image ${imageIndex}`,
        });
        console.log(`Resolved image ${rId} -> ${mediaFileName} on slide ${slideNum}`);
      } else {
        // Fallback to reference (shouldn't happen often)
        elements.push({
          type: 'image',
          src: `embedded:${rId}`,
          alt: `Slide ${slideNum} - Image ${imageIndex} (unresolved)`,
        });
        console.warn(`Could not resolve image ${rId} on slide ${slideNum}`);
      }
      imageIndex++;
    }

    return {
      slideText: textParts.join('\n'),
      slideElements: elements,
    };
  }

  /**
   * Extract text from a paragraph element
   */
  private extractTextFromParagraph(paragraphXml: string): string {
    const textParts: string[] = [];
    const textRegex = /<a:t>([^<]*)<\/a:t>/g;
    let match;

    while ((match = textRegex.exec(paragraphXml)) !== null) {
      const text = this.decodeXmlEntities(match[1]);
      if (text) {
        textParts.push(text);
      }
    }

    return textParts.join('');
  }

  /**
   * Extract speaker notes
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async extractNotes(zip: any, slideCount: number): Promise<ParsedContentElement[]> {
    const elements: ParsedContentElement[] = [];

    for (let i = 1; i <= slideCount; i++) {
      try {
        const notesXml = await zip.file(`ppt/notesSlides/notesSlide${i}.xml`)?.async('text');
        if (notesXml) {
          const notesText = this.extractTextFromSlideNotes(notesXml);
          if (notesText.trim()) {
            elements.push({
              type: 'blockquote',
              content: `Slide ${i}: ${notesText.trim()}`,
            });
          }
        }
      } catch {
        // Notes are optional, don't warn
      }
    }

    return elements;
  }

  /**
   * Extract text from notes XML
   */
  private extractTextFromSlideNotes(xml: string): string {
    const textParts: string[] = [];
    const textRegex = /<a:t>([^<]*)<\/a:t>/g;
    let match;

    while ((match = textRegex.exec(xml)) !== null) {
      const text = this.decodeXmlEntities(match[1]);
      if (text.trim()) {
        textParts.push(text);
      }
    }

    return textParts.join(' ');
  }

  /**
   * Decode XML entities
   */
  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /**
   * Extract all images from ppt/media/ directory
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async extractAllImages(zip: any): Promise<Map<string, { data: string; mimeType: string }>> {
    const images = new Map<string, { data: string; mimeType: string }>();

    try {
      const mediaFiles: string[] = [];
      zip.forEach((relativePath: string) => {
        if (relativePath.startsWith('ppt/media/')) {
          mediaFiles.push(relativePath);
        }
      });

      for (const mediaFile of mediaFiles) {
        try {
          const imageData = await zip.file(mediaFile)?.async('base64');
          if (imageData) {
            const fileName = path.basename(mediaFile);
            const mimeType = this.getMimeType(mediaFile);
            images.set(fileName, { data: imageData, mimeType });
          }
        } catch (imgError) {
          console.warn(`Failed to extract image ${mediaFile}:`, imgError);
        }
      }
    } catch (error) {
      console.warn('Failed to extract images from PPTX:', error);
    }

    return images;
  }

  /**
   * Build relationship map for a slide (rId -> media filename)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildRelationshipMap(zip: any, slideIndex: number): Promise<Map<string, string>> {
    const relMap = new Map<string, string>();

    try {
      const relsPath = `ppt/slides/_rels/slide${slideIndex}.xml.rels`;
      const relsXml = await zip.file(relsPath)?.async('text');

      if (relsXml) {
        // Parse relationships: <Relationship Id="rId2" Target="../media/image1.png" Type="...image"/>
        const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"[^>]*>/g;
        let match;
        while ((match = relRegex.exec(relsXml)) !== null) {
          const rId = match[1];
          const target = match[2];
          // Only include media files
          if (target.includes('/media/') || target.includes('\\media\\')) {
            const fileName = path.basename(target);
            relMap.set(rId, fileName);
          }
        }
      }
    } catch {
      // Relationship extraction is non-critical
    }

    return relMap;
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
