import React, { useState, useEffect, useCallback, useRef } from 'react';
import ContentRenderer from './ContentRenderer';
import ChatPanel from '../ChatPanel';
import { ContentElement } from '../../shared/types';

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface Highlight {
  id: number;
  kb_id: number;
  section_id: string;
  start_offset: number;
  end_offset: number;
  text: string;
  color: string;
  note?: string;
  created_at: string;
}

interface SectionContent {
  text?: string;
  markdown?: string;
  html?: string;
  files?: Array<{ id: string; name: string; path: string; type: string }>;
  elements?: ContentElement[];
}

interface Section {
  id: string;
  title: string;
  order: number;
  content: SectionContent;
}

interface Chapter {
  id: string;
  title: string;
  description?: string;
  order: number;
  sections: Section[];
}

interface Module {
  id: string;
  title: string;
  description?: string;
  order: number;
  chapters: Chapter[];
}

// Unified selection state for module, chapter, or section
type ContentSelection =
  | { type: 'module'; module: Module }
  | { type: 'chapter'; module: Module; chapter: Chapter }
  | { type: 'section'; moduleId: string; chapterId: string; section: Section };

interface ParsedKB {
  title: string;
  metadata: {
    version?: string;
    author?: string;
    description?: string;
    created?: string;
    modified?: string;
  };
  modules: Module[];
}

interface KBViewerProps {
  kbId: number;
  kbTitle: string;
  onBack: () => void;
}

const HIGHLIGHT_COLORS = [
  { name: 'yellow', color: '#fef08a', label: 'Yellow' },
  { name: 'green', color: '#bbf7d0', label: 'Green' },
  { name: 'blue', color: '#bfdbfe', label: 'Blue' },
  { name: 'pink', color: '#fbcfe8', label: 'Pink' },
  { name: 'orange', color: '#fed7aa', label: 'Orange' },
];

function KBViewer({ kbId, kbTitle, onBack }: KBViewerProps) {
  const [parsedKB, setParsedKB] = useState<ParsedKB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ContentSelection | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showHighlightMenu, setShowHighlightMenu] = useState(false);
  const [highlightMenuPosition, setHighlightMenuPosition] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState<{ text: string; startOffset: number; endOffset: number } | null>(null);
  const [selectedHighlightColor, setSelectedHighlightColor] = useState('yellow');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadKBContent();
    loadHighlights();
  }, [kbId]);

  const loadKBContent = async () => {
    try {
      setLoading(true);
      setError(null);
      const parsed = await window.electronAPI.invoke('kb:parse', kbId) as ParsedKB;
      setParsedKB(parsed);

      // Expand first module by default
      if (parsed.modules.length > 0) {
        setExpandedModules(new Set([parsed.modules[0].id]));
        if (parsed.modules[0].chapters.length > 0) {
          setExpandedChapters(new Set([`${parsed.modules[0].id}-${parsed.modules[0].chapters[0].id}`]));
        }
      }
    } catch (err) {
      console.error('Failed to load KB content:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadHighlights = async () => {
    try {
      const result = await window.electronAPI.invoke('highlight:getAll', kbId) as Highlight[];
      setHighlights(result || []);
    } catch (err) {
      console.error('Failed to load highlights:', err);
    }
  };

  const toggleModule = (moduleId: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  const toggleChapter = (moduleId: string, chapterId: string) => {
    const key = `${moduleId}-${chapterId}`;
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectModule = (module: Module) => {
    setSelection({ type: 'module', module });
    setShowHighlightMenu(false);
    // Expand the module if not already expanded
    setExpandedModules(prev => {
      const next = new Set(prev);
      next.add(module.id);
      return next;
    });
  };

  const selectChapter = (module: Module, chapter: Chapter) => {
    setSelection({ type: 'chapter', module, chapter });
    setShowHighlightMenu(false);
    // Expand the chapter if not already expanded
    const key = `${module.id}-${chapter.id}`;
    setExpandedChapters(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const selectSection = (moduleId: string, chapterId: string, section: Section) => {
    setSelection({ type: 'section', moduleId, chapterId, section });
    setShowHighlightMenu(false);
  };

  const getSectionFullId = () => {
    if (!selection || selection.type !== 'section') return '';
    return `${selection.moduleId}.${selection.chapterId}.${selection.section.id}`;
  };

  const getSectionHighlights = () => {
    const sectionId = getSectionFullId();
    return highlights.filter(h => h.section_id === sectionId);
  };

  // Helper to get content text for any selection type
  const getSelectionContent = (): string => {
    if (!selection) return '';

    switch (selection.type) {
      case 'module':
        return selection.module.description || `Module: ${selection.module.title}`;
      case 'chapter':
        return selection.chapter.description || `Chapter: ${selection.chapter.title}`;
      case 'section':
        return getSectionContent(selection.section);
      default:
        return '';
    }
  };

  // Helper to get title for any selection type
  const getSelectionTitle = (): string => {
    if (!selection) return '';

    switch (selection.type) {
      case 'module':
        return selection.module.title;
      case 'chapter':
        return selection.chapter.title;
      case 'section':
        return selection.section.title;
      default:
        return '';
    }
  };

  const handleTextSelection = useCallback(() => {
    const textSelection = window.getSelection();
    if (!textSelection || textSelection.isCollapsed || !contentRef.current) {
      setShowHighlightMenu(false);
      return;
    }

    const text = textSelection.toString().trim();
    if (!text) {
      setShowHighlightMenu(false);
      return;
    }

    // Get the content element's text
    const contentElement = contentRef.current.querySelector('.section-text-content');
    if (!contentElement) return;

    const fullText = contentElement.textContent || '';

    // Calculate offsets relative to the section content
    const range = textSelection.getRangeAt(0);

    // Get offset by counting characters from start of content element
    let startOffset = 0;
    let endOffset = 0;

    const treeWalker = document.createTreeWalker(
      contentElement,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentOffset = 0;
    let foundStart = false;
    let foundEnd = false;

    while (treeWalker.nextNode() && !foundEnd) {
      const node = treeWalker.currentNode;
      const nodeLength = node.textContent?.length || 0;

      if (!foundStart && node === range.startContainer) {
        startOffset = currentOffset + range.startOffset;
        foundStart = true;
      }

      if (node === range.endContainer) {
        endOffset = currentOffset + range.endOffset;
        foundEnd = true;
      }

      currentOffset += nodeLength;
    }

    // Get position for menu
    const rect = range.getBoundingClientRect();
    setHighlightMenuPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10
    });

    setSelectedText({ text, startOffset, endOffset });
    setShowHighlightMenu(true);
  }, []);

  const createHighlight = async () => {
    if (!selectedText || !selection || selection.type !== 'section') return;

    const sectionId = getSectionFullId();

    try {
      await window.electronAPI.invoke('highlight:create', {
        kb_id: kbId,
        section_id: sectionId,
        start_offset: selectedText.startOffset,
        end_offset: selectedText.endOffset,
        text: selectedText.text,
        color: selectedHighlightColor,
      });

      // Reload highlights
      await loadHighlights();

      // Clear selection
      window.getSelection()?.removeAllRanges();
      setShowHighlightMenu(false);
      setSelectedText(null);
    } catch (err) {
      console.error('Failed to create highlight:', err);
    }
  };

  const removeHighlight = async (highlightId: number) => {
    try {
      await window.electronAPI.invoke('highlight:delete', highlightId);
      await loadHighlights();
    } catch (err) {
      console.error('Failed to remove highlight:', err);
    }
  };

  // Apply highlights to content
  const renderContentWithHighlights = (content: string) => {
    const sectionHighlights = getSectionHighlights();

    if (sectionHighlights.length === 0) {
      return <span className="section-text-content">{content}</span>;
    }

    // Sort highlights by start offset
    const sortedHighlights = [...sectionHighlights].sort((a, b) => a.start_offset - b.start_offset);

    const parts: JSX.Element[] = [];
    let lastIndex = 0;

    sortedHighlights.forEach((highlight, index) => {
      // Add text before highlight
      if (highlight.start_offset > lastIndex) {
        parts.push(
          <span key={`text-${index}`}>
            {content.slice(lastIndex, highlight.start_offset)}
          </span>
        );
      }

      // Add highlighted text
      const highlightColor = HIGHLIGHT_COLORS.find(c => c.name === highlight.color)?.color || '#fef08a';
      parts.push(
        <span
          key={`highlight-${highlight.id}`}
          className="text-highlight"
          style={{ backgroundColor: highlightColor }}
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Remove this highlight?')) {
              removeHighlight(highlight.id);
            }
          }}
          title="Click to remove highlight"
        >
          {content.slice(highlight.start_offset, highlight.end_offset)}
        </span>
      );

      lastIndex = highlight.end_offset;
    });

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(
        <span key="text-end">{content.slice(lastIndex)}</span>
      );
    }

    return <span className="section-text-content">{parts}</span>;
  };

  const getSectionContent = (section: Section): string => {
    if (section.content.text) return section.content.text;
    if (section.content.markdown) return section.content.markdown;
    if (section.content.html) {
      // Strip HTML tags for plain text display
      return section.content.html.replace(/<[^>]*>/g, '');
    }
    return 'No content available for this section.';
  };

  if (loading) {
    return (
      <div className="kb-viewer">
        <div className="kb-viewer-loading">
          <div className="loading-spinner"></div>
          <p>Loading knowledge base content...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kb-viewer">
        <div className="kb-viewer-error">
          <h3>Error Loading Content</h3>
          <p>{error}</p>
          <button className="secondary-button" onClick={onBack}>Go Back</button>
        </div>
      </div>
    );
  }

  if (!parsedKB) {
    return (
      <div className="kb-viewer">
        <div className="kb-viewer-error">
          <h3>No Content Found</h3>
          <p>This knowledge base appears to be empty.</p>
          <button className="secondary-button" onClick={onBack}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="kb-viewer">
      {/* Header */}
      <div className="kb-viewer-header">
        <button className="kb-viewer-back" onClick={onBack}>
          &larr; Back to Library
        </button>
        <div className="kb-viewer-title">
          <h2>{kbTitle}</h2>
          {parsedKB.metadata.author && (
            <span className="kb-viewer-author">by {parsedKB.metadata.author}</span>
          )}
        </div>
        <div className="kb-viewer-stats">
          <span>{parsedKB.modules.length} modules</span>
          <span>{highlights.length} highlights</span>
        </div>
        <button
          className={`ai-study-partner-btn ${isChatOpen ? 'active' : ''}`}
          onClick={() => setIsChatOpen(!isChatOpen)}
          title="AI Study Partner"
        >
          {isChatOpen ? '[x] Close AI' : '[?] AI Study Partner'}
        </button>
      </div>

      <div className="kb-viewer-layout">
        {/* Sidebar - Table of Contents */}
        <aside className="kb-viewer-sidebar">
          <div className="kb-toc-header">
            <h3>Table of Contents</h3>
          </div>
          <nav className="kb-toc">
            {parsedKB.modules.map(module => {
              const isModuleSelected = selection?.type === 'module' && selection.module.id === module.id;
              return (
                <div key={module.id} className="kb-toc-module">
                  <div className="kb-toc-module-row">
                    <button
                      className="kb-toc-expand-btn"
                      onClick={() => toggleModule(module.id)}
                      title={expandedModules.has(module.id) ? 'Collapse' : 'Expand'}
                    >
                      {expandedModules.has(module.id) ? '[-]' : '[+]'}
                    </button>
                    <button
                      className={`kb-toc-module-title ${isModuleSelected ? 'selected' : ''}`}
                      onClick={() => selectModule(module)}
                      title={module.description ? 'Click to view description' : 'Click to view contents'}
                    >
                      {module.title}
                    </button>
                  </div>

                  {expandedModules.has(module.id) && (
                    <div className="kb-toc-chapters">
                      {module.chapters.map(chapter => {
                        const isChapterSelected = selection?.type === 'chapter' &&
                          selection.module.id === module.id &&
                          selection.chapter.id === chapter.id;
                        return (
                          <div key={chapter.id} className="kb-toc-chapter">
                            <div className="kb-toc-chapter-row">
                              <button
                                className="kb-toc-expand-btn"
                                onClick={() => toggleChapter(module.id, chapter.id)}
                                title={expandedChapters.has(`${module.id}-${chapter.id}`) ? 'Collapse' : 'Expand'}
                              >
                                {expandedChapters.has(`${module.id}-${chapter.id}`) ? '[-]' : '[+]'}
                              </button>
                              <button
                                className={`kb-toc-chapter-title ${isChapterSelected ? 'selected' : ''}`}
                                onClick={() => selectChapter(module, chapter)}
                                title={chapter.description ? 'Click to view description' : 'Click to view sections'}
                              >
                                {chapter.title}
                              </button>
                            </div>

                            {expandedChapters.has(`${module.id}-${chapter.id}`) && (
                              <div className="kb-toc-sections">
                                {chapter.sections.map(section => {
                                  const isSelected = selection?.type === 'section' &&
                                    selection.section.id === section.id &&
                                    selection.moduleId === module.id &&
                                    selection.chapterId === chapter.id;
                                  const sectionFullId = `${module.id}.${chapter.id}.${section.id}`;
                                  const hasHighlights = highlights.some(h => h.section_id === sectionFullId);

                                  return (
                                    <button
                                      key={section.id}
                                      className={`kb-toc-section ${isSelected ? 'selected' : ''} ${hasHighlights ? 'has-highlights' : ''}`}
                                      onClick={() => selectSection(module.id, chapter.id, section)}
                                    >
                                      {section.title}
                                      {hasHighlights && <span className="highlight-indicator">[*]</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="kb-viewer-content" ref={contentRef} onMouseUp={handleTextSelection}>
          {selection ? (
            <article className="kb-content-view">
              {/* Module View */}
              {selection.type === 'module' && (
                <>
                  <div className="kb-content-header">
                    <span className="kb-content-type-badge">[Module]</span>
                    <h1 className="kb-content-title">{selection.module.title}</h1>
                  </div>
                  <div className="kb-content-body">
                    {selection.module.description ? (
                      <div className="kb-content-text">
                        <span className="section-text-content">{selection.module.description}</span>
                      </div>
                    ) : (
                      <p className="kb-no-description">No description available for this module.</p>
                    )}
                    <div className="kb-content-overview">
                      <h3>Contents</h3>
                      <p>This module contains <strong>{selection.module.chapters.length}</strong> chapters:</p>
                      <ul className="kb-chapter-list">
                        {selection.module.chapters.map(chapter => (
                          <li key={chapter.id}>
                            <button
                              className="kb-link-button"
                              onClick={() => selectChapter(selection.module, chapter)}
                            >
                              {chapter.title}
                            </button>
                            <span className="kb-item-count">({chapter.sections.length} sections)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              )}

              {/* Chapter View */}
              {selection.type === 'chapter' && (
                <>
                  <div className="kb-content-header">
                    <div className="kb-content-breadcrumb">
                      <button className="kb-link-button" onClick={() => selectModule(selection.module)}>
                        {selection.module.title}
                      </button>
                    </div>
                    <span className="kb-content-type-badge">[Chapter]</span>
                    <h1 className="kb-content-title">{selection.chapter.title}</h1>
                  </div>
                  <div className="kb-content-body">
                    {selection.chapter.description ? (
                      <div className="kb-content-text">
                        <span className="section-text-content">{selection.chapter.description}</span>
                      </div>
                    ) : (
                      <p className="kb-no-description">No description available for this chapter.</p>
                    )}
                    <div className="kb-content-overview">
                      <h3>Sections</h3>
                      <p>This chapter contains <strong>{selection.chapter.sections.length}</strong> sections:</p>
                      <ul className="kb-section-list">
                        {selection.chapter.sections.map(section => (
                          <li key={section.id}>
                            <button
                              className="kb-link-button"
                              onClick={() => selectSection(selection.module.id, selection.chapter.id, section)}
                            >
                              {section.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              )}

              {/* Section View */}
              {selection.type === 'section' && (
                <>
                  <div className="kb-content-header">
                    <div className="kb-content-breadcrumb">
                      {parsedKB.modules.find(m => m.id === selection.moduleId)?.title}
                      {' > '}
                      {parsedKB.modules
                        .find(m => m.id === selection.moduleId)
                        ?.chapters.find(c => c.id === selection.chapterId)?.title}
                    </div>
                    <h1 className="kb-content-title">{selection.section.title}</h1>
                  </div>

                  <div className="kb-content-body">
                    <div className="kb-content-text">
                      {/* Use structured content renderer if elements available, otherwise fall back to highlight-aware text */}
                      {selection.section.content.elements && selection.section.content.elements.length > 0 ? (
                        <ContentRenderer
                          elements={selection.section.content.elements}
                          text={selection.section.content.text}
                          className="kb-content-renderer"
                        />
                      ) : (
                        renderContentWithHighlights(getSectionContent(selection.section))
                      )}
                    </div>

                    {selection.section.content.files && selection.section.content.files.length > 0 && (
                      <div className="kb-section-files">
                        <h4>Related Files</h4>
                        <ul>
                          {selection.section.content.files.map(file => (
                            <li key={file.id}>
                              <span className="file-icon">[{file.type}]</span>
                              {file.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Section highlights summary */}
                  {getSectionHighlights().length > 0 && (
                    <div className="kb-section-highlights">
                      <h4>Your Highlights ({getSectionHighlights().length})</h4>
                      <ul>
                        {getSectionHighlights().map(highlight => (
                          <li key={highlight.id} className="highlight-item">
                            <span
                              className="highlight-color-dot"
                              style={{ backgroundColor: HIGHLIGHT_COLORS.find(c => c.name === highlight.color)?.color }}
                            />
                            <span className="highlight-text">"{highlight.text.substring(0, 100)}{highlight.text.length > 100 ? '...' : ''}"</span>
                            <button
                              className="highlight-remove"
                              onClick={() => removeHighlight(highlight.id)}
                              title="Remove highlight"
                            >
                              [x]
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </article>
          ) : (
            <div className="kb-welcome">
              <h2>Welcome to {kbTitle}</h2>
              {parsedKB.metadata.description && (
                <p className="kb-description">{parsedKB.metadata.description}</p>
              )}
              <div className="kb-overview">
                <h3>Overview</h3>
                <p>This knowledge base contains:</p>
                <ul>
                  <li><strong>{parsedKB.modules.length}</strong> modules</li>
                  <li><strong>{parsedKB.modules.reduce((acc, m) => acc + m.chapters.length, 0)}</strong> chapters</li>
                  <li><strong>{parsedKB.modules.reduce((acc, m) => acc + m.chapters.reduce((acc2, c) => acc2 + c.sections.length, 0), 0)}</strong> sections</li>
                </ul>
              </div>
              <p className="kb-instruction">
                Select a module, chapter, or section from the table of contents to start reading.
                <br />
                <strong>Tip:</strong> Click on module/chapter names to see their description and navigate to sections.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Highlight Menu */}
      {showHighlightMenu && selectedText && (
        <div
          className="highlight-menu"
          style={{
            left: highlightMenuPosition.x,
            top: highlightMenuPosition.y,
          }}
        >
          <div className="highlight-menu-colors">
            {HIGHLIGHT_COLORS.map(color => (
              <button
                key={color.name}
                className={`highlight-color-btn ${selectedHighlightColor === color.name ? 'selected' : ''}`}
                style={{ backgroundColor: color.color }}
                onClick={() => setSelectedHighlightColor(color.name)}
                title={color.label}
              />
            ))}
          </div>
          <button className="highlight-confirm-btn" onClick={createHighlight}>
            Highlight
          </button>
          <button className="highlight-cancel-btn" onClick={() => setShowHighlightMenu(false)}>
            Cancel
          </button>
        </div>
      )}

      {/* AI Study Partner Chat Panel */}
      <ChatPanel
        isOpen={isChatOpen}
        onToggle={() => setIsChatOpen(!isChatOpen)}
        knowledgeBaseId={kbId}
        kbTitle={kbTitle}
        currentTopic={getSelectionTitle()}
        sectionContent={getSelectionContent() || undefined}
      />
    </div>
  );
}

export default KBViewer;
