import * as fs from 'fs';
import { IParser, ParsedDocument, ParsedContentElement } from './IParser';

// We need to use dynamic import for pdfjs-dist in Node.js/Electron environment
let pdfjsLib: any = null;

/**
 * Text item extracted from PDF with position data
 */
interface PDFTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
  page: number;
}

/**
 * Image item detected and extracted from PDF
 */
interface PDFImageItem {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  data?: string;        // Base64 encoded image data
  mimeType?: string;    // Image MIME type (e.g., 'image/png', 'image/jpeg')
  name?: string;        // Image resource name from PDF
}

/**
 * Parser for PDF documents using pdfjs-dist with position-based paragraph detection
 *
 * Key improvements over pdf2json:
 * - Better CID font and complex encoding support
 * - More accurate text extraction
 * - Proper character mapping for non-standard fonts
 * - Detects paragraph breaks based on Y-position gaps
 * - Identifies headings based on font size changes
 */
export class PDFParser implements IParser {
  private supportedExtensions = ['.pdf'];

  // Configuration for paragraph detection
  // From analysis: normal line spacing within paragraphs is ~1.46x line height
  // Paragraph breaks have gaps >2x line height (2.29x observed)
  private readonly PARAGRAPH_GAP_MULTIPLIER = 2.0;  // Gap > 2.0x line height = new paragraph
  private readonly HEADING_SIZE_MULTIPLIER = 1.15;  // Font > 1.15x base = heading
  private readonly WORD_SPACE_THRESHOLD = 0.3;      // X gap > 0.3x char width = space
  private readonly SAME_LINE_THRESHOLD = 0.5;       // Y diff < 0.5x line height = same line

  /**
   * Initialize pdfjs-dist library using the legacy build for Node.js compatibility
   *
   * Note: We use Function('return import')() to create a true dynamic import
   * that bypasses TypeScript's compilation to require() which doesn't work with ESM
   */
  private async initPdfjs(): Promise<any> {
    if (pdfjsLib) {
      return pdfjsLib;
    }

    try {
      // Use Function to create a real dynamic import that works with ESM modules
      // TypeScript compiles `import()` to `require()` in CommonJS mode, which fails for .mjs files
      // This workaround creates an actual runtime import() call
      const dynamicImport = new Function('modulePath', 'return import(modulePath)');
      const pdfjs = await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjsLib = pdfjs;

      return pdfjsLib;
    } catch (error) {
      console.error('Failed to initialize pdfjs-dist:', error);
      throw new Error(`PDF library initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Parse a PDF document from file path
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return this.parseBuffer(buffer, filePath);
    } catch (error) {
      throw new Error(`Failed to read PDF file: ${(error as Error).message}`);
    }
  }

  /**
   * Parse a PDF document from buffer with intelligent text extraction
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      const pdfjs = await this.initPdfjs();

      // Convert Buffer to Uint8Array for pdfjs
      const data = new Uint8Array(buffer);

      // Load the PDF document with Node.js compatible options
      const loadingTask = pdfjs.getDocument({
        data,
        useSystemFonts: true,
        isEvalSupported: false,  // Required for Node.js
        disableFontFace: true,   // Don't try to load fonts in Node.js
      });

      const pdfDoc = await loadingTask.promise;

      const warnings: string[] = [];
      const textItems: PDFTextItem[] = [];
      const imageItems: PDFImageItem[] = [];

      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });

        // Get text content
        const textContent = await page.getTextContent({
          includeMarkedContent: false,
          disableCombineTextItems: false,
        });

        // Process text items
        for (const item of textContent.items) {
          if ('str' in item && item.str.trim()) {
            // Transform coordinates - pdfjs uses bottom-left origin
            const tx = item.transform;
            const x = tx[4];
            const y = viewport.height - tx[5]; // Flip Y for top-left origin
            const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);

            textItems.push({
              text: item.str,
              x,
              y,
              width: item.width || (item.str.length * fontSize * 0.5),
              height: item.height || fontSize * 1.2,
              fontSize,
              fontName: item.fontName,
              page: pageNum,
            });
          }
        }

        // Extract images from page
        try {
          const extractedImages = await this.extractPageImages(page, pageNum, pdfjs);
          imageItems.push(...extractedImages);
        } catch (imgError) {
          // Image extraction failed, continue without images
          console.warn(`Could not extract images from page ${pageNum}:`, imgError);
        }
      }

      // Check for text extraction issues
      if (textItems.length === 0) {
        warnings.push('PDF appears to be empty or contains only images. Text extraction may be incomplete.');
      }

      // Check for potential encoding issues (garbled text detection)
      const hasGarbledText = this.detectGarbledText(textItems);
      if (hasGarbledText) {
        warnings.push('PDF may contain custom fonts with non-standard encoding. Some text may not display correctly.');
      }

      // Build structured content from positioned text
      const { elements, plainText } = this.buildStructuredContent(textItems, imageItems);

      // Get file stats and metadata
      const stats = await fs.promises.stat(filePath).catch(() => null);
      const metadata = await pdfDoc.getMetadata().catch(() => ({ info: {} }));

      return {
        text: plainText,
        elements,
        filePath,
        metadata: {
          title: metadata.info?.Title || undefined,
          author: metadata.info?.Author || undefined,
          subject: metadata.info?.Subject || undefined,
          keywords: metadata.info?.Keywords ? [metadata.info.Keywords] : undefined,
          pages: pdfDoc.numPages,
          createdDate: metadata.info?.CreationDate ? this.parsePdfDate(metadata.info.CreationDate) : undefined,
          modifiedDate: metadata.info?.ModDate ? this.parsePdfDate(metadata.info.ModDate) : undefined,
          fileSize: stats?.size,
          producer: metadata.info?.Producer || undefined,
          creator: metadata.info?.Creator || undefined,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse PDF: ${(error as Error).message}`);
    }
  }

  /**
   * Extract images from a PDF page as base64 data
   */
  private async extractPageImages(page: any, pageNum: number, pdfjs: any): Promise<PDFImageItem[]> {
    const images: PDFImageItem[] = [];

    try {
      // Get operator list to find image operations
      const operatorList = await page.getOperatorList();
      const ops = pdfjs.OPS;

      // Track image names we've seen to avoid duplicates
      const processedImages = new Set<string>();

      for (let i = 0; i < operatorList.fnArray.length; i++) {
        const fn = operatorList.fnArray[i];
        const args = operatorList.argsArray[i];

        if (fn === ops.paintImageXObject) {
          const imageName = args[0];

          // Skip if we've already processed this image
          if (processedImages.has(imageName)) {
            continue;
          }
          processedImages.add(imageName);

          try {
            // Get the image object from the page's object dictionary
            const imgObj = await page.objs.get(imageName);

            if (imgObj && imgObj.data) {
              // Extract image data and convert to base64
              const imageData = await this.convertImageToBase64(imgObj);

              if (imageData) {
                images.push({
                  x: 0,  // Position info not easily available from operator list
                  y: 0,
                  width: imgObj.width || 100,
                  height: imgObj.height || 100,
                  page: pageNum,
                  data: imageData.data,
                  mimeType: imageData.mimeType,
                  name: imageName,
                });
              }
            }
          } catch (imgObjError) {
            // Individual image extraction failed, continue with others
            console.warn(`Could not extract image ${imageName}:`, imgObjError);
          }
        } else if (fn === ops.paintInlineImageXObject) {
          // Inline images have data directly in args
          try {
            const imgData = args[0];
            if (imgData && imgData.data) {
              const imageData = await this.convertImageToBase64(imgData);

              if (imageData) {
                images.push({
                  x: 0,
                  y: 0,
                  width: imgData.width || 100,
                  height: imgData.height || 100,
                  page: pageNum,
                  data: imageData.data,
                  mimeType: imageData.mimeType,
                  name: `inline-${pageNum}-${i}`,
                });
              }
            }
          } catch (inlineError) {
            console.warn('Could not extract inline image:', inlineError);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to extract images from page ${pageNum}:`, error);
    }

    return images;
  }

  /**
   * Convert PDF image object to base64 data URL
   */
  private async convertImageToBase64(imgObj: any): Promise<{ data: string; mimeType: string } | null> {
    try {
      const { data, width, height } = imgObj;

      if (!data || !width || !height) {
        return null;
      }

      // Determine the image type and create appropriate base64 data
      // PDF images can be in various formats - we need to reconstruct them

      // Check if it's already a known image format
      if (imgObj.kind === 'RGBA') {
        // RGBA data - convert to PNG using canvas-like approach
        return this.rgbaToDataUrl(data, width, height);
      } else if (imgObj.kind === 'RGB') {
        // RGB data - convert to PNG
        return this.rgbToDataUrl(data, width, height);
      } else if (imgObj.kind === 'GRAYSCALE') {
        // Grayscale data
        return this.grayscaleToDataUrl(data, width, height);
      } else {
        // Try to handle as raw image data
        // For complex cases, create a simple representation
        return this.rawToDataUrl(data, width, height);
      }
    } catch (error) {
      console.warn('Image conversion error:', error);
      return null;
    }
  }

  /**
   * Convert RGBA pixel data to a base64 PNG data URL
   * Uses a simple BMP-like approach that works in Node.js without canvas
   */
  private rgbaToDataUrl(data: Uint8ClampedArray | Uint8Array, width: number, height: number): { data: string; mimeType: string } | null {
    try {
      // Convert to Uint8Array if needed
      const pixelData = data instanceof Uint8Array ? data : new Uint8Array(data);
      // Create a simple uncompressed BMP
      const bmpData = this.createBMP(pixelData, width, height, 4);
      const base64 = Buffer.from(bmpData).toString('base64');
      return {
        data: `data:image/bmp;base64,${base64}`,
        mimeType: 'image/bmp',
      };
    } catch (error) {
      console.warn('RGBA to BMP conversion failed:', error);
      return null;
    }
  }

  /**
   * Convert RGB pixel data to base64
   */
  private rgbToDataUrl(data: Uint8ClampedArray | Uint8Array, width: number, height: number): { data: string; mimeType: string } | null {
    try {
      // Convert RGB to RGBA by adding alpha channel
      const rgbaData = new Uint8Array(width * height * 4);
      for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        rgbaData[j] = data[i];       // R
        rgbaData[j + 1] = data[i + 1]; // G
        rgbaData[j + 2] = data[i + 2]; // B
        rgbaData[j + 3] = 255;        // A
      }

      const bmpData = this.createBMP(rgbaData, width, height, 4);
      const base64 = Buffer.from(bmpData).toString('base64');
      return {
        data: `data:image/bmp;base64,${base64}`,
        mimeType: 'image/bmp',
      };
    } catch (error) {
      console.warn('RGB to BMP conversion failed:', error);
      return null;
    }
  }

  /**
   * Convert grayscale pixel data to base64
   */
  private grayscaleToDataUrl(data: Uint8ClampedArray | Uint8Array, width: number, height: number): { data: string; mimeType: string } | null {
    try {
      // Convert grayscale to RGBA
      const rgbaData = new Uint8Array(width * height * 4);
      for (let i = 0, j = 0; i < data.length; i++, j += 4) {
        const gray = data[i];
        rgbaData[j] = gray;     // R
        rgbaData[j + 1] = gray; // G
        rgbaData[j + 2] = gray; // B
        rgbaData[j + 3] = 255;  // A
      }

      const bmpData = this.createBMP(rgbaData, width, height, 4);
      const base64 = Buffer.from(bmpData).toString('base64');
      return {
        data: `data:image/bmp;base64,${base64}`,
        mimeType: 'image/bmp',
      };
    } catch (error) {
      console.warn('Grayscale to BMP conversion failed:', error);
      return null;
    }
  }

  /**
   * Handle raw/unknown image data formats
   */
  private rawToDataUrl(data: Uint8ClampedArray | Uint8Array, width: number, height: number): { data: string; mimeType: string } | null {
    try {
      // Try to determine format based on data size
      const expectedRGBA = width * height * 4;
      const expectedRGB = width * height * 3;
      const expectedGray = width * height;

      if (data.length === expectedRGBA) {
        return this.rgbaToDataUrl(data, width, height);
      } else if (data.length === expectedRGB) {
        return this.rgbToDataUrl(data, width, height);
      } else if (data.length === expectedGray) {
        return this.grayscaleToDataUrl(data, width, height);
      }

      // Unknown format - skip
      console.warn(`Unknown image data format: expected ${expectedRGBA}, ${expectedRGB}, or ${expectedGray} bytes, got ${data.length}`);
      return null;
    } catch (error) {
      console.warn('Raw image conversion failed:', error);
      return null;
    }
  }

  /**
   * Create a BMP file from RGBA pixel data
   * BMP format is simple and doesn't require external libraries
   */
  private createBMP(pixelData: Uint8Array, width: number, height: number, channels: number): Uint8Array {
    // BMP file header (14 bytes) + DIB header (40 bytes) + pixel data
    const rowSize = Math.ceil((width * 24) / 32) * 4; // 24-bit BMP with padding
    const pixelArraySize = rowSize * height;
    const fileSize = 54 + pixelArraySize;

    const bmp = new Uint8Array(fileSize);
    const view = new DataView(bmp.buffer);

    // BMP File Header (14 bytes)
    bmp[0] = 0x42; // 'B'
    bmp[1] = 0x4D; // 'M'
    view.setUint32(2, fileSize, true);      // File size
    view.setUint32(6, 0, true);             // Reserved
    view.setUint32(10, 54, true);           // Pixel data offset

    // DIB Header (BITMAPINFOHEADER - 40 bytes)
    view.setUint32(14, 40, true);           // DIB header size
    view.setInt32(18, width, true);         // Width
    view.setInt32(22, -height, true);       // Height (negative for top-down)
    view.setUint16(26, 1, true);            // Color planes
    view.setUint16(28, 24, true);           // Bits per pixel (24-bit)
    view.setUint32(30, 0, true);            // Compression (none)
    view.setUint32(34, pixelArraySize, true); // Image size
    view.setInt32(38, 2835, true);          // Horizontal resolution (72 DPI)
    view.setInt32(42, 2835, true);          // Vertical resolution (72 DPI)
    view.setUint32(46, 0, true);            // Colors in palette
    view.setUint32(50, 0, true);            // Important colors

    // Pixel data (BGR format, bottom-up by default but we use negative height for top-down)
    let offset = 54;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * channels;
        // BMP uses BGR order
        bmp[offset++] = pixelData[srcIdx + 2]; // B
        bmp[offset++] = pixelData[srcIdx + 1]; // G
        bmp[offset++] = pixelData[srcIdx];     // R
      }
      // Add padding to make row size multiple of 4
      const padding = rowSize - (width * 3);
      for (let p = 0; p < padding; p++) {
        bmp[offset++] = 0;
      }
    }

    return bmp;
  }

  /**
   * Parse PDF date format (D:YYYYMMDDHHmmSS) to Date object
   */
  private parsePdfDate(dateStr: string): Date | undefined {
    try {
      // PDF date format: D:YYYYMMDDHHmmSSOHH'mm'
      const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
      if (match) {
        const [, year, month, day, hour = '0', min = '0', sec = '0'] = match;
        return new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hour),
          parseInt(min),
          parseInt(sec)
        );
      }
    } catch {
      // Ignore date parsing errors
    }
    return undefined;
  }

  /**
   * Detect if text appears to be garbled (encoding issues)
   */
  private detectGarbledText(items: PDFTextItem[]): boolean {
    if (items.length === 0) return false;

    // Sample text for analysis
    const sampleText = items.slice(0, 50).map(i => i.text).join('');

    // Check for unusual character patterns that suggest encoding issues:
    // 1. Too many non-ASCII characters in English text
    // 2. Random-looking sequences of characters
    // 3. Too few spaces relative to text length

    const nonAsciiRatio = (sampleText.match(/[^\x20-\x7E]/g) || []).length / sampleText.length;
    const spaceRatio = (sampleText.match(/\s/g) || []).length / sampleText.length;

    // If more than 20% non-ASCII or less than 5% spaces in substantial text, likely garbled
    if (sampleText.length > 50 && (nonAsciiRatio > 0.2 || spaceRatio < 0.05)) {
      return true;
    }

    return false;
  }

  /**
   * Build structured content from positioned text and image items
   */
  private buildStructuredContent(
    items: PDFTextItem[],
    imageItems: PDFImageItem[] = []
  ): {
    elements: ParsedContentElement[];
    plainText: string;
  } {
    if (items.length === 0 && imageItems.length === 0) {
      return { elements: [], plainText: '' };
    }

    if (items.length === 0) {
      // Only images, no text
      const imageElements: ParsedContentElement[] = imageItems.map((img, index) => ({
        type: 'image' as const,
        alt: `Image ${index + 1} on page ${img.page}`,
        position: { page: img.page, x: img.x, y: img.y },
      }));
      return { elements: imageElements, plainText: '[Document contains images only]' };
    }

    // Sort items by page, then Y position (top to bottom), then X position (left to right)
    const sortedItems = [...items].sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      // Use a tolerance for Y comparison to handle items on the same line
      const yDiff = Math.abs(a.y - b.y);
      const lineHeight = Math.max(a.height, b.height);
      if (yDiff < lineHeight * 0.5) {
        // Same line - sort by X
        return a.x - b.x;
      }
      return a.y - b.y;
    });

    // Calculate average font size (base font) excluding outliers
    const fontSizes = sortedItems.map(item => item.fontSize);
    const avgFontSize = this.calculateMedian(fontSizes);

    // Calculate average line height
    const lineHeights = sortedItems.map(item => item.height);
    const avgLineHeight = this.calculateMedian(lineHeights);

    // Build content by detecting paragraphs and headings
    const elements: ParsedContentElement[] = [];
    const paragraphTexts: string[] = [];

    let currentParagraph: string[] = [];
    let currentPage = sortedItems[0].page;
    let lastY = sortedItems[0].y;
    let lastX = sortedItems[0].x;
    let lastWidth = sortedItems[0].width;
    let isCurrentHeading = false;
    let currentHeadingLevel = 0;

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const isHeading = item.fontSize > avgFontSize * this.HEADING_SIZE_MULTIPLIER;

      // Detect if we need to start a new paragraph
      let startNewParagraph = false;
      let addSpace = false;

      if (item.page !== currentPage) {
        // New page - definitely new paragraph
        startNewParagraph = true;
        currentPage = item.page;
      } else {
        const yGap = item.y - lastY;
        const isSameLine = Math.abs(yGap) < avgLineHeight * this.SAME_LINE_THRESHOLD;

        // Check for vertical gap indicating new paragraph
        // Only start new paragraph if there's significant extra spacing (>1.8x normal line height)
        if (yGap > avgLineHeight * this.PARAGRAPH_GAP_MULTIPLIER) {
          startNewParagraph = true;
        } else if (isHeading !== isCurrentHeading) {
          // Font size changed significantly - likely heading/paragraph transition
          startNewParagraph = true;
        }

        // Check horizontal spacing for word breaks
        // Add space if there's a gap between text items on the same line
        // Or if moving to a new line (return to left margin)
        if (!startNewParagraph) {
          if (isSameLine) {
            // Same line - check for word gap
            const xGap = item.x - (lastX + lastWidth);
            if (xGap > item.fontSize * this.WORD_SPACE_THRESHOLD) {
              addSpace = true;
            }
          } else {
            // New line within same paragraph - add space unless last char was hyphen
            const lastText = currentParagraph[currentParagraph.length - 1];
            if (lastText && !lastText.endsWith('-')) {
              addSpace = true;
            } else if (lastText && lastText.endsWith('-')) {
              // Remove hyphen for word continuation
              currentParagraph[currentParagraph.length - 1] = lastText.slice(0, -1);
            }
          }
        }
      }

      // Handle paragraph/heading transitions
      if (startNewParagraph && currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join('').trim();
        if (paragraphText) {
          if (isCurrentHeading) {
            elements.push({
              type: 'heading',
              content: paragraphText,
              level: currentHeadingLevel,
            });
          } else {
            elements.push({
              type: 'paragraph',
              content: paragraphText,
            });
          }
          paragraphTexts.push(paragraphText);
        }
        currentParagraph = [];
      }

      // Update heading state
      if (isHeading) {
        isCurrentHeading = true;
        currentHeadingLevel = this.calculateHeadingLevel(item.fontSize, avgFontSize);
      } else if (startNewParagraph) {
        isCurrentHeading = false;
        currentHeadingLevel = 0;
      }

      // Add space if needed
      if (addSpace && currentParagraph.length > 0) {
        const lastText = currentParagraph[currentParagraph.length - 1];
        if (!lastText.endsWith(' ') && !lastText.endsWith('\n')) {
          currentParagraph.push(' ');
        }
      }

      // Add the text
      currentParagraph.push(item.text);

      // Update position tracking
      lastY = item.y;
      lastX = item.x;
      lastWidth = item.width || (item.text.length * item.fontSize * 0.5);
    }

    // Don't forget the last paragraph
    if (currentParagraph.length > 0) {
      const paragraphText = currentParagraph.join('').trim();
      if (paragraphText) {
        if (isCurrentHeading) {
          elements.push({
            type: 'heading',
            content: paragraphText,
            level: currentHeadingLevel,
          });
        } else {
          elements.push({
            type: 'paragraph',
            content: paragraphText,
          });
        }
        paragraphTexts.push(paragraphText);
      }
    }

    // Post-process: Clean up and detect lists
    const processedElements = this.postProcessElements(elements);

    // Integrate images into the element flow
    const finalElements = this.integrateImages(processedElements, imageItems);

    // Build plain text with proper paragraph breaks
    const plainText = paragraphTexts.join('\n\n');

    return { elements: finalElements, plainText };
  }

  /**
   * Integrate image elements into the content flow based on position
   */
  private integrateImages(
    elements: ParsedContentElement[],
    imageItems: PDFImageItem[]
  ): ParsedContentElement[] {
    if (imageItems.length === 0) {
      return elements;
    }

    // Filter to only include images that were successfully extracted
    const extractedImages = imageItems.filter(img => img.data);

    if (extractedImages.length === 0) {
      // No images were successfully extracted
      const pagesWithImages = new Set(imageItems.map(img => img.page));
      if (pagesWithImages.size > 0) {
        const imageNote: ParsedContentElement = {
          type: 'paragraph',
          content: `[This document contains ${imageItems.length} image(s) that could not be extracted.]`,
        };
        return [...elements, imageNote];
      }
      return elements;
    }

    // Convert images to content elements with actual base64 data
    const imageElements: ParsedContentElement[] = extractedImages.map((img, index) => ({
      type: 'image' as const,
      src: img.data,  // Base64 data URL
      alt: `Figure ${index + 1} (Page ${img.page})`,
      position: { page: img.page, x: img.x, y: img.y },
    }));

    // Group images by page for better organization
    const imagesByPage = new Map<number, ParsedContentElement[]>();
    imageElements.forEach(img => {
      const page = img.position?.page || 1;
      if (!imagesByPage.has(page)) {
        imagesByPage.set(page, []);
      }
      imagesByPage.get(page)!.push(img);
    });

    // Insert images after text content, organized by page
    const result: ParsedContentElement[] = [...elements];

    // Add images section
    if (extractedImages.length > 0) {
      result.push({
        type: 'heading' as const,
        content: 'Figures',
        level: 3,
      });

      // Add images sorted by page
      const sortedPages = Array.from(imagesByPage.keys()).sort((a, b) => a - b);
      for (const page of sortedPages) {
        const pageImages = imagesByPage.get(page)!;
        pageImages.forEach(img => {
          result.push(img);
        });
      }
    }

    return result;
  }

  /**
   * Calculate heading level based on font size ratio
   */
  private calculateHeadingLevel(fontSize: number, baseFontSize: number): number {
    const ratio = fontSize / baseFontSize;
    if (ratio >= 2.0) return 1;
    if (ratio >= 1.7) return 2;
    if (ratio >= 1.4) return 3;
    if (ratio >= 1.25) return 4;
    return 5;
  }

  /**
   * Calculate median of an array
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Post-process elements to detect lists and clean up content
   */
  private postProcessElements(elements: ParsedContentElement[]): ParsedContentElement[] {
    const processed: ParsedContentElement[] = [];
    let currentList: string[] | null = null;
    let isOrderedList = false;

    // Regex patterns for list detection
    const bulletPattern = /^[\u2022\u2023\u25E6\u2043\u2219•●○◦‣⁃\-\*]\s*/;
    const numberedPattern = /^(\d+[\.\)]\s*|[a-zA-Z][\.\)]\s*)/;

    for (const element of elements) {
      if (element.type === 'paragraph' && element.content) {
        const content = element.content.trim();

        // Check for bullet list item
        if (bulletPattern.test(content)) {
          if (!currentList || isOrderedList) {
            // Start new unordered list
            if (currentList) {
              processed.push({
                type: 'list',
                items: currentList,
                ordered: isOrderedList,
              });
            }
            currentList = [];
            isOrderedList = false;
          }
          currentList.push(content.replace(bulletPattern, '').trim());
          continue;
        }

        // Check for numbered list item
        if (numberedPattern.test(content)) {
          if (!currentList || !isOrderedList) {
            // Start new ordered list
            if (currentList) {
              processed.push({
                type: 'list',
                items: currentList,
                ordered: isOrderedList,
              });
            }
            currentList = [];
            isOrderedList = true;
          }
          currentList.push(content.replace(numberedPattern, '').trim());
          continue;
        }

        // Not a list item - finalize any pending list
        if (currentList) {
          processed.push({
            type: 'list',
            items: currentList,
            ordered: isOrderedList,
          });
          currentList = null;
        }

        // Clean up paragraph content
        const cleanedContent = this.cleanParagraphContent(content);
        if (cleanedContent) {
          processed.push({
            type: 'paragraph',
            content: cleanedContent,
          });
        }
      } else if (element.type === 'heading') {
        // Finalize any pending list
        if (currentList) {
          processed.push({
            type: 'list',
            items: currentList,
            ordered: isOrderedList,
          });
          currentList = null;
        }

        if (element.content?.trim()) {
          processed.push({
            type: 'heading',
            content: element.content.trim(),
            level: element.level,
          });
        }
      } else {
        processed.push(element);
      }
    }

    // Finalize any remaining list
    if (currentList) {
      processed.push({
        type: 'list',
        items: currentList,
        ordered: isOrderedList,
      });
    }

    return processed;
  }

  /**
   * Detect and fix character-spaced text (e.g., "A + C o r e" -> "A+ Core")
   * This is a common issue with PDF extraction where fonts embed characters individually
   */
  private fixCharacterSpacing(text: string): string {
    // Pattern: single character followed by space followed by single character
    // This detects sequences like "A + C o r e 1 a n d C o r e 2"

    // Count ratio of single-char "words" to detect the problem
    const words = text.split(/\s+/);
    const singleCharWords = words.filter(w => w.length === 1 && /[a-zA-Z0-9]/.test(w)).length;
    const totalWords = words.length;

    // If more than 40% of words are single characters, likely has spacing issue
    if (totalWords > 5 && singleCharWords / totalWords > 0.4) {
      // Remove spaces between single characters while preserving real word boundaries
      // Strategy: Join characters that are separated by single spaces, keep multi-spaces as word breaks
      let result = '';
      let i = 0;

      while (i < text.length) {
        const char = text[i];
        const nextChar = text[i + 1];
        const afterNext = text[i + 2];

        result += char;

        // If current is a letter/digit, next is space, and after is letter/digit
        // Check if this looks like character spacing vs real word boundary
        if (/[a-zA-Z0-9]/.test(char) && nextChar === ' ' && /[a-zA-Z0-9]/.test(afterNext || '')) {
          // Look ahead to see if this is really character spacing
          // Real word boundaries usually have longer sequences after the space
          let lookAhead = '';
          let j = i + 2;
          while (j < text.length && text[j] !== ' ') {
            lookAhead += text[j];
            j++;
          }

          // If the next "word" is just 1 char, likely spacing issue - skip the space
          if (lookAhead.length === 1) {
            i++; // Skip the space
          }
        }
        i++;
      }

      // Clean up any remaining artifacts
      return result.replace(/\s{2,}/g, ' ').trim();
    }

    return text;
  }

  /**
   * Clean up paragraph content
   */
  private cleanParagraphContent(content: string): string {
    // First try to fix character spacing issues
    let cleaned = this.fixCharacterSpacing(content);

    // Remove excessive whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Fix common PDF extraction issues
    // - Fix missing spaces after periods
    cleaned = cleaned.replace(/\.([A-Z])/g, '. $1');
    // - Fix missing spaces after commas
    cleaned = cleaned.replace(/,([A-Za-z])/g, ', $1');
    // - Remove orphan characters at start (common PDF artifact)
    cleaned = cleaned.replace(/^[^\w\s]{1,2}\s+/, '');

    return cleaned;
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
