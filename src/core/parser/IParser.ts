/**
 * Structured content element extracted from documents
 */
export interface ParsedContentElement {
  type: 'paragraph' | 'heading' | 'image' | 'list' | 'code' | 'blockquote';
  content?: string;
  level?: number;          // For headings (1-6)
  items?: string[];        // For lists
  ordered?: boolean;       // For lists
  src?: string;            // For images (base64 or path)
  alt?: string;            // For images
  position?: {             // Original position in document
    page: number;
    x: number;
    y: number;
  };
}

/**
 * Interface for document parsers
 */
export interface ParsedDocument {
  /**
   * Extracted text content from the document (plain text fallback)
   */
  text: string;

  /**
   * Structured content elements (paragraphs, headings, images, etc.)
   */
  elements?: ParsedContentElement[];

  /**
   * Original file path
   */
  filePath: string;

  /**
   * Document metadata
   */
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    pages?: number;
    createdDate?: Date;
    modifiedDate?: Date;
    fileSize?: number;
    [key: string]: unknown;
  };

  /**
   * Any errors encountered during parsing (non-fatal)
   */
  warnings?: string[];
}

/**
 * Parser interface for different document formats
 */
export interface IParser {
  /**
   * Parse a document from a file path
   * @param filePath - Path to the document file
   * @returns Promise resolving to parsed document data
   */
  parse(filePath: string): Promise<ParsedDocument>;

  /**
   * Parse a document from buffer data
   * @param buffer - Document data as Buffer
   * @param filePath - Original file path (for metadata)
   * @returns Promise resolving to parsed document data
   */
  parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument>;

  /**
   * Check if this parser supports the given file extension
   * @param extension - File extension (e.g., '.pdf', '.docx')
   * @returns True if supported
   */
  supports(extension: string): boolean;

  /**
   * Get list of supported file extensions
   */
  getSupportedExtensions(): string[];
}
