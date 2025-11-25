import React from 'react';
import { ContentElement } from '../../shared/types';

interface ContentRendererProps {
  /** Structured content elements to render */
  elements?: ContentElement[];
  /** Fallback plain text if no elements */
  text?: string;
  /** Optional className for the container */
  className?: string;
}

/**
 * Renders structured content elements (paragraphs, headings, lists, images)
 * with textbook-quality formatting.
 *
 * Falls back to plain text rendering if no structured elements are provided.
 */
function ContentRenderer({ elements, text, className = '' }: ContentRendererProps) {
  // If we have structured elements, render them
  if (elements && elements.length > 0) {
    return (
      <div className={`structured-content ${className}`.trim()}>
        {elements.map((element, index) => renderElement(element, index))}
      </div>
    );
  }

  // Fallback to plain text with paragraph detection
  if (text) {
    return (
      <div className={`structured-content ${className}`.trim()}>
        <PlainTextRenderer text={text} />
      </div>
    );
  }

  // No content
  return (
    <div className={`structured-content empty ${className}`.trim()}>
      <p className="content-empty">No content available for this section.</p>
    </div>
  );
}

/**
 * Render a single content element based on its type
 */
function renderElement(element: ContentElement, key: number): React.ReactNode {
  switch (element.type) {
    case 'heading':
      return <ContentHeading key={key} level={element.level || 2} content={element.content || ''} />;

    case 'paragraph':
      return <ContentParagraph key={key} content={element.content || ''} />;

    case 'list':
      return (
        <ContentList
          key={key}
          items={element.items || []}
          ordered={element.ordered || false}
        />
      );

    case 'image':
      return (
        <ContentImage
          key={key}
          src={element.src || ''}
          alt={element.alt || ''}
          width={element.width}
          height={element.height}
        />
      );

    case 'code':
      return (
        <ContentCode
          key={key}
          content={element.content || ''}
          language={element.language}
        />
      );

    case 'blockquote':
      return <ContentBlockquote key={key} content={element.content || ''} />;

    case 'table':
      return (
        <ContentTable
          key={key}
          headers={element.headers || []}
          rows={element.rows || []}
        />
      );

    default:
      // Unknown element type - render as paragraph
      if (element.content) {
        return <ContentParagraph key={key} content={element.content} />;
      }
      return null;
  }
}

/**
 * Heading component with proper hierarchy
 */
function ContentHeading({ level, content }: { level: number; content: string }) {
  const Tag = `h${Math.min(Math.max(level, 1), 6)}` as keyof JSX.IntrinsicElements;
  return (
    <Tag className={`content-heading content-heading-${level}`}>
      {content}
    </Tag>
  );
}

/**
 * Paragraph component with proper styling
 */
function ContentParagraph({ content }: { content: string }) {
  return (
    <p className="content-paragraph">
      {content}
    </p>
  );
}

/**
 * List component (ordered or unordered)
 */
function ContentList({ items, ordered }: { items: string[]; ordered: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`content-list ${ordered ? 'content-list-ordered' : 'content-list-unordered'}`}>
      {items.map((item, index) => (
        <li key={index} className="content-list-item">
          {item}
        </li>
      ))}
    </Tag>
  );
}

/**
 * Image component with optional caption
 */
function ContentImage({ src, alt, width, height }: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}) {
  // Handle different image source types
  const imageSrc = src.startsWith('data:') ? src :
                   src.startsWith('http') ? src :
                   `file://${src}`;

  return (
    <figure className="content-figure">
      <img
        className="content-image"
        src={imageSrc}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
      />
      {alt && (
        <figcaption className="content-image-caption">
          {alt}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Code block component
 */
function ContentCode({ content, language }: { content: string; language?: string }) {
  return (
    <pre className={`content-code ${language ? `language-${language}` : ''}`}>
      <code>{content}</code>
    </pre>
  );
}

/**
 * Blockquote component
 */
function ContentBlockquote({ content }: { content: string }) {
  return (
    <blockquote className="content-blockquote">
      {content}
    </blockquote>
  );
}

/**
 * Table component
 */
function ContentTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="content-table-wrapper">
      <table className="content-table">
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index}>{header}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Plain text renderer with intelligent paragraph detection
 * Used as fallback when no structured elements are available
 */
function PlainTextRenderer({ text }: { text: string }) {
  // Split text into paragraphs based on double newlines or significant whitespace
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (paragraphs.length === 0) {
    return <p className="content-empty">No content available.</p>;
  }

  return (
    <>
      {paragraphs.map((paragraph, index) => {
        // Detect if this looks like a heading (short, possibly numbered/lettered)
        const isShortLine = paragraph.length < 100 && !paragraph.includes('. ');
        const looksLikeHeading = isShortLine && (
          /^\d+\.?\s/.test(paragraph) ||     // Starts with number
          /^[A-Z][A-Z\s]+$/.test(paragraph) || // All caps
          /^Chapter\s/i.test(paragraph) ||   // Chapter prefix
          /^Section\s/i.test(paragraph) ||   // Section prefix
          /^Module\s/i.test(paragraph)       // Module prefix
        );

        if (looksLikeHeading) {
          return (
            <h3 key={index} className="content-heading content-heading-3">
              {paragraph}
            </h3>
          );
        }

        // Check for list-like content
        const lines = paragraph.split('\n');
        const looksLikeList = lines.length > 1 && lines.every(line =>
          /^[\u2022\u2023\u25E6\u2043\u2219•●○◦‣⁃\-\*]\s/.test(line.trim()) ||
          /^\d+[\.\)]\s/.test(line.trim())
        );

        if (looksLikeList) {
          const isOrdered = /^\d+[\.\)]\s/.test(lines[0].trim());
          const items = lines.map(line =>
            line.trim().replace(/^[\u2022\u2023\u25E6\u2043\u2219•●○◦‣⁃\-\*\d+\.\)]\s*/, '').trim()
          );
          return (
            <ContentList key={index} items={items} ordered={isOrdered} />
          );
        }

        // Regular paragraph
        return (
          <p key={index} className="content-paragraph">
            {paragraph}
          </p>
        );
      })}
    </>
  );
}

export default ContentRenderer;
