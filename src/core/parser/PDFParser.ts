import * as fs from 'fs';
import { IParser, ParsedDocument } from './IParser';

/**
 * Parser for PDF documents using pdf2json
 *
 * Uses pdf2json library which works reliably in Node.js/Electron environments
 */
export class PDFParser implements IParser {
  private supportedExtensions = ['.pdf'];

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
   * Parse a PDF document from buffer
   */
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const PDFParser = require('pdf2json');

      return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();

        // Set up error handler
        pdfParser.on('pdfParser_dataError', (errData: any) => {
          reject(new Error(`PDF parsing error: ${errData.parserError}`));
        });

        // Set up success handler
        pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
          try {
            // Extract text from all pages
            const textParts: string[] = [];

            if (pdfData.Pages && Array.isArray(pdfData.Pages)) {
              for (const page of pdfData.Pages) {
                if (page.Texts && Array.isArray(page.Texts)) {
                  const pageTexts: string[] = [];

                  for (const textItem of page.Texts) {
                    if (textItem.R && Array.isArray(textItem.R)) {
                      for (const run of textItem.R) {
                        if (run.T) {
                          // Decode URI-encoded text, fallback to raw text if decoding fails
                          let decodedText: string;
                          try {
                            decodedText = decodeURIComponent(run.T);
                          } catch (error) {
                            // If URI decoding fails, use raw text
                            decodedText = run.T;
                          }
                          pageTexts.push(decodedText);
                        }
                      }
                    }
                  }

                  if (pageTexts.length > 0) {
                    textParts.push(pageTexts.join(' '));
                  }
                }
              }
            }

            const fullText = textParts.join('\n\n');
            const warnings: string[] = [];

            // Check if text extraction was successful
            if (!fullText || fullText.trim().length === 0) {
              warnings.push('PDF appears to be empty or contains only images. Text extraction may be incomplete.');
            }

            // Get file stats
            fs.promises.stat(filePath).then(stats => {
              resolve({
                text: fullText,
                filePath,
                metadata: {
                  title: pdfData.Meta?.Title || undefined,
                  author: pdfData.Meta?.Author || undefined,
                  subject: pdfData.Meta?.Subject || undefined,
                  keywords: pdfData.Meta?.Keywords ? [pdfData.Meta.Keywords] : undefined,
                  pages: pdfData.Pages?.length || 0,
                  createdDate: pdfData.Meta?.CreationDate ? new Date(pdfData.Meta.CreationDate) : undefined,
                  modifiedDate: pdfData.Meta?.ModDate ? new Date(pdfData.Meta.ModDate) : undefined,
                  fileSize: stats.size,
                  producer: pdfData.Meta?.Producer || undefined,
                  creator: pdfData.Meta?.Creator || undefined,
                },
                warnings: warnings.length > 0 ? warnings : undefined,
              });
            }).catch(() => {
              // If stat fails, resolve without file stats
              resolve({
                text: fullText,
                filePath,
                metadata: {
                  title: pdfData.Meta?.Title || undefined,
                  author: pdfData.Meta?.Author || undefined,
                  subject: pdfData.Meta?.Subject || undefined,
                  keywords: pdfData.Meta?.Keywords ? [pdfData.Meta.Keywords] : undefined,
                  pages: pdfData.Pages?.length || 0,
                  createdDate: pdfData.Meta?.CreationDate ? new Date(pdfData.Meta.CreationDate) : undefined,
                  modifiedDate: pdfData.Meta?.ModDate ? new Date(pdfData.Meta.ModDate) : undefined,
                  producer: pdfData.Meta?.Producer || undefined,
                  creator: pdfData.Meta?.Creator || undefined,
                },
                warnings: warnings.length > 0 ? warnings : undefined,
              });
            });
          } catch (error) {
            reject(new Error(`Failed to process PDF data: ${(error as Error).message}`));
          }
        });

        // Parse the buffer
        pdfParser.parseBuffer(buffer);
      });
    } catch (error) {
      throw new Error(`Failed to parse PDF: ${(error as Error).message}`);
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
