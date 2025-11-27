import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './MarkdownRenderer.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Strip markdown syntax from text for clean TTS reading
 * Removes: **bold**, *italic*, __underline__, ~~strikethrough~~, headers, lists, links, etc.
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';

  let stripped = text;

  // Remove code blocks first (```code```)
  stripped = stripped.replace(/```[\s\S]*?```/g, '');

  // Remove inline code (`code`)
  stripped = stripped.replace(/`([^`]+)`/g, '$1');

  // Remove headers (# ## ### etc.)
  stripped = stripped.replace(/^#{1,6}\s+/gm, '');

  // Remove bold (**text** or __text__) - use non-greedy match that can span spaces
  stripped = stripped.replace(/\*\*([\s\S]*?)\*\*/g, '$1');
  stripped = stripped.replace(/__([\s\S]*?)__/g, '$1');

  // Remove italic (*text* or _text_) - use non-greedy match that can span spaces
  // Be careful not to match bullet points (line start *)
  stripped = stripped.replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '$1');
  stripped = stripped.replace(/(?<!_)_(?!_)(.+?)_(?!_)/g, '$1');

  // Remove strikethrough (~~text~~)
  stripped = stripped.replace(/~~([\s\S]*?)~~/g, '$1');

  // Remove links [text](url) -> text
  stripped = stripped.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove images ![alt](url)
  stripped = stripped.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Remove blockquotes (> text)
  stripped = stripped.replace(/^>\s+/gm, '');

  // Remove horizontal rules (---, ***, ___)
  stripped = stripped.replace(/^[-*_]{3,}\s*$/gm, '');

  // Remove bullet points and numbered lists markers
  stripped = stripped.replace(/^[\s]*[-*+]\s+/gm, '');
  stripped = stripped.replace(/^[\s]*\d+\.\s+/gm, '');

  // Clean up any remaining stray asterisks or underscores that might be markdown artifacts
  // This catches edge cases where markdown spans multiple words
  stripped = stripped.replace(/(\s)\*(\S)/g, '$1$2');
  stripped = stripped.replace(/(\S)\*(\s)/g, '$1$2');
  stripped = stripped.replace(/(\s)_(\S)/g, '$1$2');
  stripped = stripped.replace(/(\S)_(\s)/g, '$1$2');

  // Remove extra whitespace and normalize line breaks
  stripped = stripped.replace(/\n{3,}/g, '\n\n');
  stripped = stripped.trim();

  return stripped;
}

/**
 * MarkdownRenderer component
 * Renders markdown content with proper styling for educational content
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
}) => {
  const htmlContent = useMemo(() => {
    if (!content) return '';

    // Configure marked options for educational content
    marked.setOptions({
      breaks: true, // Convert \n to <br>
      gfm: true, // GitHub Flavored Markdown
    });

    // Parse markdown to HTML
    const rawHtml = marked.parse(content) as string;

    // Sanitize HTML to prevent XSS
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'del',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'blockquote',
        'code',
        'pre',
        'hr',
        'a',
        'span',
        'div',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    });

    return cleanHtml;
  }, [content]);

  return (
    <div
      className={`markdown-renderer ${className}`}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};

export default MarkdownRenderer;
