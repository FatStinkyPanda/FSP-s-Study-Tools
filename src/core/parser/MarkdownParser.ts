import * as fs from 'fs';
import * as path from 'path';
import { IParser, ParsedDocument, ParsedContentElement } from './IParser';

// Interfaces for marked library types
interface MarkedToken {
  type: string;
  text?: string;
  depth?: number;
  ordered?: boolean;
  items?: MarkedToken[];
  href?: string;
}

/**
 * Enhanced parser for Markdown documents with structure extraction
 */
export class MarkdownParser implements IParser {
  private supportedExtensions = ['.md', '.markdown', '.mdown', '.mkd'];
  private marked: {
    setOptions: (options: Record<string, unknown>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Lexer: { lex: (text: string) => any[] };
  } | null = null;
  private markedLoaded = false;

  /**
   * Load the marked library dynamically (ESM module)
   */
  private async loadMarked(): Promise<void> {
    if (this.markedLoaded) return;

    try {
      // Dynamic import for ESM module
      const markedModule = await import('marked');
      this.marked = {
        setOptions: markedModule.marked.setOptions,
        Lexer: markedModule.Lexer
      };

      // Configure marked options
      this.marked.setOptions({
        gfm: true, // GitHub Flavored Markdown
        breaks: true,
      });

      this.markedLoaded = true;
    } catch (error) {
      console.error('Failed to load marked library:', error);
      throw new Error('Markdown parsing library not available');
    }
  }

  /**
   * Parse a Markdown document from file path
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return this.parseBuffer(buffer, filePath);
    } catch (error) {
      throw new Error(`Failed to read Markdown file: ${(error as Error).message}`);
    }
  }

  /**
   * Parse a Markdown document from buffer
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      const text = buffer.toString('utf-8');
      const warnings: string[] = [];

      if (!text || text.trim().length === 0) {
        warnings.push('Markdown file appears to be empty.');
      }

      // Load marked library if not loaded
      await this.loadMarked();

      // Parse Markdown to tokens
      let elements: ParsedContentElement[] = [];
      if (this.marked) {
        const tokens = this.marked.Lexer.lex(text);
        elements = this.extractElements(tokens);
      } else {
        // Fallback: basic extraction without marked
        elements = this.basicExtractElements(text);
      }

      // Extract metadata from frontmatter if present
      const metadata = this.extractFrontmatter(text);

      const stats = await fs.promises.stat(filePath).catch(() => null);
      const fileName = path.basename(filePath, path.extname(filePath));

      // Get plain text version (strip markdown)
      const plainText = this.stripMarkdown(text);

      // Find title from first heading if not in frontmatter
      if (!metadata.title) {
        const firstHeading = elements.find(el => el.type === 'heading' && el.level === 1);
        if (firstHeading) {
          metadata.title = firstHeading.content;
        } else {
          metadata.title = fileName;
        }
      }

      return {
        text: plainText,
        elements,
        filePath,
        metadata: {
          ...metadata,
          fileSize: stats?.size,
          createdDate: stats?.birthtime,
          modifiedDate: stats?.mtime,
          format: 'markdown',
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse Markdown file: ${(error as Error).message}`);
    }
  }

  /**
   * Extract structured elements from Markdown tokens
   */
  private extractElements(tokens: MarkedToken[]): ParsedContentElement[] {
    const elements: ParsedContentElement[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'heading':
          elements.push({
            type: 'heading',
            content: token.text || '',
            level: token.depth || 1,
          });
          break;

        case 'paragraph':
          elements.push({
            type: 'paragraph',
            content: token.text || '',
          });
          break;

        case 'list':
          elements.push({
            type: 'list',
            items: this.extractListItems(token),
            ordered: token.ordered ?? false,
          });
          break;

        case 'code':
          elements.push({
            type: 'code',
            content: token.text || '',
          });
          break;

        case 'blockquote':
          elements.push({
            type: 'blockquote',
            content: token.text || '',
          });
          break;

        case 'image':
          if (token.href) {
            elements.push({
              type: 'image',
              src: token.href,
              alt: token.text || undefined,
            });
          }
          break;
      }
    }

    return elements;
  }

  /**
   * Basic element extraction without marked (fallback)
   */
  private basicExtractElements(text: string): ParsedContentElement[] {
    const elements: ParsedContentElement[] = [];
    const lines = text.split('\n');
    let currentParagraph = '';

    for (const line of lines) {
      // Check for headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (currentParagraph.trim()) {
          elements.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        elements.push({
          type: 'heading',
          content: headingMatch[2],
          level: headingMatch[1].length,
        });
        continue;
      }

      // Check for code blocks
      if (line.startsWith('```')) {
        if (currentParagraph.trim()) {
          elements.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        continue;
      }

      // Check for blockquotes
      if (line.startsWith('>')) {
        if (currentParagraph.trim()) {
          elements.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        elements.push({
          type: 'blockquote',
          content: line.replace(/^>\s*/, ''),
        });
        continue;
      }

      // Check for list items
      const listMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
      if (listMatch) {
        if (currentParagraph.trim()) {
          elements.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        elements.push({
          type: 'list',
          items: [listMatch[2]],
          ordered: false,
        });
        continue;
      }

      // Empty line ends paragraph
      if (!line.trim()) {
        if (currentParagraph.trim()) {
          elements.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        continue;
      }

      // Add to current paragraph
      currentParagraph += (currentParagraph ? ' ' : '') + line;
    }

    // Final paragraph
    if (currentParagraph.trim()) {
      elements.push({ type: 'paragraph', content: currentParagraph.trim() });
    }

    return elements;
  }

  /**
   * Extract items from a list token
   */
  private extractListItems(listToken: MarkedToken): string[] {
    if (!listToken.items || !Array.isArray(listToken.items)) {
      return [];
    }

    return listToken.items.map((item: MarkedToken) => {
      return item.text || '';
    });
  }

  /**
   * Extract YAML frontmatter metadata
   */
  private extractFrontmatter(text: string): Record<string, unknown> {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = text.match(frontmatterRegex);

    if (!match) {
      return {};
    }

    const yaml = match[1];
    const metadata: Record<string, unknown> = {};

    // Simple YAML parsing for common fields
    const lines = yaml.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value: unknown = line.substring(colonIndex + 1).trim();

        // Remove quotes if present
        if (typeof value === 'string' && ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))) {
          value = value.slice(1, -1);
        }

        // Parse arrays (simple format: [item1, item2])
        if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        }

        // Parse dates
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            value = date;
          }
        }

        metadata[key] = value;
      }
    }

    return metadata;
  }

  /**
   * Strip Markdown formatting to get plain text
   */
  private stripMarkdown(text: string): string {
    // Remove frontmatter
    text = text.replace(/^---\n[\s\S]*?\n---\n?/, '');

    // Remove code blocks
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`[^`]*`/g, '');

    // Remove images
    text = text.replace(/!\[.*?\]\(.*?\)/g, '');

    // Remove links but keep text
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

    // Remove headers formatting
    text = text.replace(/^#+\s+/gm, '');

    // Remove emphasis
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');
    text = text.replace(/~~(.*?)~~/g, '$1');

    // Remove blockquotes
    text = text.replace(/^>\s+/gm, '');

    // Remove horizontal rules
    text = text.replace(/^[-*_]{3,}\s*$/gm, '');

    // Remove list markers
    text = text.replace(/^[\s]*[-*+]\s+/gm, '');
    text = text.replace(/^[\s]*\d+\.\s+/gm, '');

    // Clean up extra whitespace
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();

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
