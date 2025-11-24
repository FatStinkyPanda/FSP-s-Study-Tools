import React, { useState, useEffect, useCallback } from 'react';

interface KnowledgeBase {
  id: number;
  uuid: string;
  title: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

interface SearchResult {
  module_id: string;
  chapter_id: string;
  section_id: string;
  content: string;
  content_type: string;
  rank: number;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface SearchResultsProps {
  onNavigateToSection: (kbId: number, sectionId: string) => void;
  onClose: () => void;
}

function SearchResults({ onNavigateToSection, onClose }: SearchResultsProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    loadKnowledgeBases();
  }, []);

  const loadKnowledgeBases = async () => {
    try {
      const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
      setKnowledgeBases(kbs);
      if (kbs.length > 0) {
        setSelectedKB(kbs[0].id);
      }
    } catch (err) {
      console.error('Failed to load KBs:', err);
      setError('Failed to load knowledge bases');
    }
  };

  const performSearch = useCallback(async () => {
    if (!selectedKB || !searchQuery.trim()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);

      const searchResults = await window.electronAPI.invoke(
        'kb:search',
        selectedKB,
        searchQuery.trim(),
        50
      ) as SearchResult[];

      setResults(searchResults);
    } catch (err) {
      console.error('Search failed:', err);
      setError('Search failed. Please try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [selectedKB, searchQuery]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  const handleResultClick = (result: SearchResult) => {
    if (selectedKB) {
      onNavigateToSection(selectedKB, result.section_id);
    }
  };

  const getSnippet = (content: string, maxLength = 200): string => {
    // Content already has <mark> tags for highlighting from FTS5
    if (content.length <= maxLength) {
      return content;
    }

    // Find the first <mark> tag to center the snippet around the match
    const markIndex = content.indexOf('<mark>');
    if (markIndex === -1) {
      return content.substring(0, maxLength) + '...';
    }

    // Center the snippet around the match
    const start = Math.max(0, markIndex - 50);
    const end = Math.min(content.length, start + maxLength);

    let snippet = content.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet;
  };

  const formatPath = (result: SearchResult): string => {
    const parts = [];
    if (result.module_id) parts.push(result.module_id);
    if (result.chapter_id) parts.push(result.chapter_id);
    if (result.section_id) parts.push(result.section_id);
    return parts.join(' > ');
  };

  const selectedKBData = knowledgeBases.find(kb => kb.id === selectedKB);

  return (
    <div className="search-results-container">
      <div className="search-header">
        <div className="search-header-top">
          <h2>Search Knowledge Base</h2>
          <button className="close-button" onClick={onClose} title="Close">
            x
          </button>
        </div>

        <div className="search-controls">
          <div className="kb-selector">
            <label htmlFor="search-kb-select">Knowledge Base:</label>
            <select
              id="search-kb-select"
              value={selectedKB || ''}
              onChange={(e) => {
                setSelectedKB(Number(e.target.value));
                setResults([]);
                setHasSearched(false);
              }}
              disabled={knowledgeBases.length === 0}
            >
              {knowledgeBases.length === 0 ? (
                <option value="">No knowledge bases available</option>
              ) : (
                knowledgeBases.map(kb => (
                  <option key={kb.id} value={kb.id}>{kb.title}</option>
                ))
              )}
            </select>
          </div>

          <div className="search-input-container">
            <input
              type="text"
              className="search-input"
              placeholder="Enter search terms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={!selectedKB}
              autoFocus
            />
            <button
              className="search-button"
              onClick={performSearch}
              disabled={!selectedKB || !searchQuery.trim() || loading}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {selectedKBData && (
          <div className="search-kb-info">
            Searching in: <strong>{selectedKBData.title}</strong>
          </div>
        )}
      </div>

      {error && (
        <div className="search-error">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      <div className="search-results-list">
        {loading && (
          <div className="search-loading">
            <div className="loading-spinner"></div>
            <p>Searching...</p>
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <div className="search-no-results">
            <p>No results found for "{searchQuery}"</p>
            <p className="search-hint">Try different keywords or check your spelling</p>
          </div>
        )}

        {!loading && !hasSearched && knowledgeBases.length > 0 && (
          <div className="search-prompt">
            <p>Enter a search term to find content in your knowledge base</p>
            <p className="search-hint">Use keywords related to the topic you're looking for</p>
          </div>
        )}

        {!loading && knowledgeBases.length === 0 && (
          <div className="search-no-kb">
            <p>No knowledge bases available</p>
            <p className="search-hint">Import a knowledge base first to use search</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <>
            <div className="results-count">
              Found {results.length} result{results.length !== 1 ? 's' : ''}
            </div>
            <ul className="results-list">
              {results.map((result, index) => (
                <li
                  key={`${result.section_id}-${index}`}
                  className="result-item"
                  onClick={() => handleResultClick(result)}
                >
                  <div className="result-path">
                    {formatPath(result)}
                  </div>
                  <div
                    className="result-content"
                    dangerouslySetInnerHTML={{ __html: getSnippet(result.content) }}
                  />
                  <div className="result-meta">
                    <span className="result-type">{result.content_type || 'text'}</span>
                    <span className="result-relevance">
                      Relevance: {Math.round((1 - Math.abs(result.rank)) * 100)}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default SearchResults;
