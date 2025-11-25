import { ContentElement } from '../../shared/types';
import { ParsedContentElement } from '../parser/IParser';

/**
 * Represents a file's parsed content for merging
 */
export interface FileContent {
  fileName: string;
  filePath: string;
  text: string;
  elements?: ParsedContentElement[];
  order?: number;
}

/**
 * Configuration options for content merging
 */
export interface MergeOptions {
  /**
   * Whether to add file separators between merged content
   * Default: true
   */
  addFileSeparators?: boolean;

  /**
   * Whether to preserve original file order or sort alphabetically
   * Default: 'preserve'
   */
  orderMode?: 'preserve' | 'alphabetical' | 'natural';

  /**
   * Whether to deduplicate similar content across files
   * Default: false
   */
  deduplicateContent?: boolean;

  /**
   * Minimum similarity threshold for deduplication (0-1)
   * Default: 0.9
   */
  deduplicationThreshold?: number;
}

/**
 * Result of content merge operation
 */
export interface MergeResult {
  /**
   * Combined plain text content
   */
  text: string;

  /**
   * Combined structured content elements
   */
  elements: ContentElement[];

  /**
   * Statistics about the merge
   */
  stats: {
    totalFiles: number;
    totalElements: number;
    duplicatesRemoved: number;
    fileOrder: string[];
  };
}

/**
 * ContentMerger - Intelligently combines content from multiple source files
 *
 * Features:
 * - Maintains logical flow when merging
 * - Optional deduplication of similar content
 * - Adds clear separators between file content
 * - Preserves structured elements (headings, paragraphs, lists)
 * - Supports multiple ordering strategies
 */
export class ContentMerger {
  private defaultOptions: Required<MergeOptions> = {
    addFileSeparators: true,
    orderMode: 'preserve',
    deduplicateContent: false,
    deduplicationThreshold: 0.9,
  };

  /**
   * Merge content from multiple files into a single coherent document
   */
  merge(files: FileContent[], options?: MergeOptions): MergeResult {
    const opts = { ...this.defaultOptions, ...options };

    // Sort files based on order mode
    const sortedFiles = this.sortFiles(files, opts.orderMode);

    const allElements: ContentElement[] = [];
    const allTextParts: string[] = [];
    let duplicatesRemoved = 0;
    let elementOrder = 0;

    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];

      // Add file separator if enabled and not the first file
      if (opts.addFileSeparators && i > 0) {
        allElements.push({
          type: 'heading',
          order: elementOrder++,
          content: `--- ${this.getDisplayName(file.fileName)} ---`,
          level: 4,
        });
        allTextParts.push(`\n\n--- ${this.getDisplayName(file.fileName)} ---\n\n`);
      } else if (opts.addFileSeparators && i === 0 && sortedFiles.length > 1) {
        // Add indicator for first file when there are multiple
        allElements.push({
          type: 'heading',
          order: elementOrder++,
          content: `--- ${this.getDisplayName(file.fileName)} ---`,
          level: 4,
        });
        allTextParts.push(`--- ${this.getDisplayName(file.fileName)} ---\n\n`);
      }

      // Process file elements
      if (file.elements && file.elements.length > 0) {
        for (const elem of file.elements) {
          // Check for duplicates if deduplication is enabled
          if (opts.deduplicateContent && elem.content) {
            const isDuplicate = this.isDuplicateContent(
              elem.content,
              allElements,
              opts.deduplicationThreshold
            );
            if (isDuplicate) {
              duplicatesRemoved++;
              continue;
            }
          }

          // Convert ParsedContentElement to ContentElement
          const contentElement = this.convertElement(elem, elementOrder++);
          allElements.push(contentElement);
        }
      }

      // Add plain text
      if (file.text) {
        allTextParts.push(file.text);
      }
    }

    // Build final text with proper spacing
    const finalText = allTextParts.join('\n\n');

    return {
      text: finalText,
      elements: allElements,
      stats: {
        totalFiles: sortedFiles.length,
        totalElements: allElements.length,
        duplicatesRemoved,
        fileOrder: sortedFiles.map(f => f.fileName),
      },
    };
  }

  /**
   * Sort files based on the specified order mode
   */
  private sortFiles(files: FileContent[], mode: string): FileContent[] {
    const sorted = [...files];

    switch (mode) {
      case 'alphabetical':
        sorted.sort((a, b) => a.fileName.localeCompare(b.fileName));
        break;

      case 'natural':
        // Natural sort (handles numbers in filenames correctly)
        sorted.sort((a, b) =>
          a.fileName.localeCompare(b.fileName, undefined, {
            numeric: true,
            sensitivity: 'base',
          })
        );
        break;

      case 'preserve':
      default:
        // Use the order property if available, otherwise preserve array order
        sorted.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        break;
    }

    return sorted;
  }

  /**
   * Get a clean display name from filename
   */
  private getDisplayName(fileName: string): string {
    // Remove extension and clean up
    const withoutExt = fileName.replace(/\.[^.]+$/, '');
    // Replace underscores and hyphens with spaces
    return withoutExt.replace(/[_-]/g, ' ');
  }

  /**
   * Convert ParsedContentElement to ContentElement
   */
  private convertElement(
    elem: ParsedContentElement,
    order: number
  ): ContentElement {
    const base: ContentElement = {
      type: elem.type as ContentElement['type'],
      order,
    };

    if (elem.content) {
      base.content = elem.content;
    }

    if (elem.level) {
      base.level = elem.level;
    }

    if (elem.items) {
      base.items = elem.items;
    }

    if (elem.ordered !== undefined) {
      base.ordered = elem.ordered;
    }

    if (elem.src) {
      base.src = elem.src;
    }

    if (elem.alt) {
      base.alt = elem.alt;
    }

    return base;
  }

  /**
   * Check if content is similar to existing content (for deduplication)
   */
  private isDuplicateContent(
    content: string,
    existingElements: ContentElement[],
    threshold: number
  ): boolean {
    const normalizedNew = this.normalizeForComparison(content);

    for (const elem of existingElements) {
      if (elem.content) {
        const normalizedExisting = this.normalizeForComparison(elem.content);
        const similarity = this.calculateSimilarity(normalizedNew, normalizedExisting);
        if (similarity >= threshold) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Normalize text for comparison (lowercase, remove extra whitespace)
   */
  private normalizeForComparison(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Calculate similarity between two strings (simple Jaccard similarity)
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    // Use word-level comparison for better accuracy
    const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(b.split(' ').filter(w => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        intersection++;
      }
    }

    const union = wordsA.size + wordsB.size - intersection;
    return intersection / union;
  }

  /**
   * Merge elements from multiple sources, maintaining order by position
   */
  mergeByPosition(files: FileContent[]): MergeResult {
    // This is a more sophisticated merge that tries to interleave content
    // based on page/position data (useful when merging chapters from different sources)

    const allElements: ContentElement[] = [];
    const textParts: string[] = [];
    let order = 0;

    // Group elements by source file with position data
    interface PositionedElement {
      element: ParsedContentElement;
      fileName: string;
      page: number;
      y: number;
    }

    const positionedElements: PositionedElement[] = [];

    for (const file of files) {
      if (file.elements) {
        for (const elem of file.elements) {
          positionedElements.push({
            element: elem,
            fileName: file.fileName,
            page: elem.position?.page ?? 1,
            y: elem.position?.y ?? 0,
          });
        }
      }
      if (file.text) {
        textParts.push(file.text);
      }
    }

    // Sort by page, then by Y position
    positionedElements.sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      return a.y - b.y;
    });

    // Convert to ContentElements
    for (const positioned of positionedElements) {
      allElements.push(this.convertElement(positioned.element, order++));
    }

    return {
      text: textParts.join('\n\n'),
      elements: allElements,
      stats: {
        totalFiles: files.length,
        totalElements: allElements.length,
        duplicatesRemoved: 0,
        fileOrder: files.map(f => f.fileName),
      },
    };
  }
}

// Export singleton instance for convenience
export const contentMerger = new ContentMerger();
