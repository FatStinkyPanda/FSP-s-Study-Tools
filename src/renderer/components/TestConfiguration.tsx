import React, { useState, useEffect } from 'react';

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface Section {
  id: string;
  title: string;
  order: number;
}

interface Chapter {
  id: string;
  title: string;
  order: number;
  sections: Section[];
}

interface Module {
  id: string;
  title: string;
  order: number;
  chapters: Chapter[];
}

interface ParsedKB {
  title: string;
  modules: Module[];
}

interface StudyProgress {
  section_id: string;
  user_score: number;
  ai_score: number;
  time_spent: number;
  last_viewed: string;
}

interface TestConfigurationProps {
  kbId: number;
  kbTitle: string;
  onCancel: () => void;
  onStartTest: (config: TestConfig) => void;
}

export interface TestConfig {
  kbId: number;
  moduleIds: string[];
  chapterIds: string[];
  sectionIds: string[];
  totalQuestions: number;
  difficulty: 'easy' | 'medium' | 'hard';
  adaptiveMode: 'none' | 'low_scores' | 'least_studied';
}

function TestConfiguration({ kbId, kbTitle, onCancel, onStartTest }: TestConfigurationProps) {
  const [parsedKB, setParsedKB] = useState<ParsedKB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());

  // Expand state for tree view
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  // Test options
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [adaptiveMode, setAdaptiveMode] = useState<'none' | 'low_scores' | 'least_studied'>('none');

  // Progress data for adaptive mode
  const [progressData, setProgressData] = useState<StudyProgress[]>([]);

  useEffect(() => {
    loadKBStructure();
    loadProgressData();
  }, [kbId]);

  const loadKBStructure = async () => {
    try {
      setLoading(true);
      setError(null);
      const parsed = await window.electronAPI.invoke('kb:parse', kbId) as ParsedKB;
      setParsedKB(parsed);

      // Auto-expand first module
      if (parsed.modules.length > 0) {
        setExpandedModules(new Set([parsed.modules[0].id]));
      }
    } catch (err) {
      console.error('Failed to load KB structure:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadProgressData = async () => {
    try {
      const progress = await window.electronAPI.invoke('progress:getAll', kbId) as StudyProgress[];
      setProgressData(progress || []);
    } catch (err) {
      console.error('Failed to load progress data:', err);
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

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  const selectModule = (moduleId: string, selected: boolean) => {
    setSelectedModules(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(moduleId);
        // Deselect individual chapters/sections in this module (module selection takes precedence)
        if (parsedKB) {
          const module = parsedKB.modules.find(m => m.id === moduleId);
          if (module) {
            module.chapters.forEach(chapter => {
              const fullChapterId = `${moduleId}.${chapter.id}`;
              setSelectedChapters(prev => {
                const next = new Set(prev);
                next.delete(fullChapterId);
                return next;
              });
              chapter.sections.forEach(section => {
                const fullSectionId = `${moduleId}.${chapter.id}.${section.id}`;
                setSelectedSections(prev => {
                  const next = new Set(prev);
                  next.delete(fullSectionId);
                  return next;
                });
              });
            });
          }
        }
      } else {
        next.delete(moduleId);
      }
      return next;
    });
  };

  const selectChapter = (moduleId: string, chapterId: string, selected: boolean) => {
    const fullChapterId = `${moduleId}.${chapterId}`;
    setSelectedChapters(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(fullChapterId);
        // Deselect individual sections in this chapter
        if (parsedKB) {
          const module = parsedKB.modules.find(m => m.id === moduleId);
          const chapter = module?.chapters.find(c => c.id === chapterId);
          if (chapter) {
            chapter.sections.forEach(section => {
              const fullSectionId = `${moduleId}.${chapterId}.${section.id}`;
              setSelectedSections(prev => {
                const next = new Set(prev);
                next.delete(fullSectionId);
                return next;
              });
            });
          }
        }
      } else {
        next.delete(fullChapterId);
      }
      return next;
    });
  };

  const selectSection = (moduleId: string, chapterId: string, sectionId: string, selected: boolean) => {
    const fullSectionId = `${moduleId}.${chapterId}.${sectionId}`;
    setSelectedSections(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(fullSectionId);
      } else {
        next.delete(fullSectionId);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (parsedKB) {
      setSelectedModules(new Set(parsedKB.modules.map(m => m.id)));
      setSelectedChapters(new Set());
      setSelectedSections(new Set());
    }
  };

  const selectNone = () => {
    setSelectedModules(new Set());
    setSelectedChapters(new Set());
    setSelectedSections(new Set());
  };

  const getSelectionCount = (): { modules: number; chapters: number; sections: number } => {
    let sectionCount = 0;

    if (!parsedKB) return { modules: 0, chapters: 0, sections: 0 };

    // Count sections from selected modules
    for (const moduleId of selectedModules) {
      const module = parsedKB.modules.find(m => m.id === moduleId);
      if (module) {
        for (const chapter of module.chapters) {
          sectionCount += chapter.sections.length;
        }
      }
    }

    // Count sections from selected chapters (not in selected modules)
    for (const chapterId of selectedChapters) {
      const [moduleId, chapId] = chapterId.split('.');
      if (!selectedModules.has(moduleId)) {
        const module = parsedKB.modules.find(m => m.id === moduleId);
        const chapter = module?.chapters.find(c => c.id === chapId);
        if (chapter) {
          sectionCount += chapter.sections.length;
        }
      }
    }

    // Count individual selected sections (not covered by module or chapter selection)
    for (const sectionId of selectedSections) {
      const [moduleId, chapId] = sectionId.split('.');
      if (!selectedModules.has(moduleId) && !selectedChapters.has(`${moduleId}.${chapId}`)) {
        sectionCount++;
      }
    }

    return {
      modules: selectedModules.size,
      chapters: selectedChapters.size,
      sections: sectionCount,
    };
  };

  const isModuleSelected = (moduleId: string): boolean => selectedModules.has(moduleId);

  const isChapterSelected = (moduleId: string, chapterId: string): boolean => {
    if (selectedModules.has(moduleId)) return true; // Parent module selected
    return selectedChapters.has(`${moduleId}.${chapterId}`);
  };

  const isSectionSelected = (moduleId: string, chapterId: string, sectionId: string): boolean => {
    if (selectedModules.has(moduleId)) return true; // Parent module selected
    if (selectedChapters.has(`${moduleId}.${chapterId}`)) return true; // Parent chapter selected
    return selectedSections.has(`${moduleId}.${chapterId}.${sectionId}`);
  };

  const handleStartTest = () => {
    const config: TestConfig = {
      kbId,
      moduleIds: Array.from(selectedModules),
      chapterIds: Array.from(selectedChapters),
      sectionIds: Array.from(selectedSections),
      totalQuestions,
      difficulty,
      adaptiveMode,
    };
    onStartTest(config);
  };

  const hasSelection = selectedModules.size > 0 || selectedChapters.size > 0 || selectedSections.size > 0;
  const counts = getSelectionCount();

  if (loading) {
    return (
      <div className="test-configuration">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading knowledge base structure...</p>
        </div>
      </div>
    );
  }

  if (error || !parsedKB) {
    return (
      <div className="test-configuration">
        <div className="error-container">
          <h3>Error Loading Content</h3>
          <p>{error || 'Failed to load knowledge base'}</p>
          <button className="secondary-button" onClick={onCancel}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="test-configuration">
      <div className="test-config-header">
        <h2>Configure Test: {kbTitle}</h2>
        <button className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>

      <div className="test-config-content">
        {/* Content Selection Panel */}
        <div className="test-config-selection">
          <div className="selection-header">
            <h3>Select Content to Test</h3>
            <div className="selection-actions">
              <button className="link-button" onClick={selectAll}>Select All</button>
              <button className="link-button" onClick={selectNone}>Clear Selection</button>
            </div>
          </div>

          <div className="content-tree">
            {parsedKB.modules.map(module => (
              <div key={module.id} className="tree-module">
                <div className="tree-item module-item">
                  <button
                    className="tree-expand"
                    onClick={() => toggleModule(module.id)}
                  >
                    {expandedModules.has(module.id) ? '[-]' : '[+]'}
                  </button>
                  <label className="tree-label">
                    <input
                      type="checkbox"
                      checked={isModuleSelected(module.id)}
                      onChange={(e) => selectModule(module.id, e.target.checked)}
                    />
                    <span className="tree-title">{module.title}</span>
                    <span className="tree-count">
                      ({module.chapters.reduce((acc, c) => acc + c.sections.length, 0)} sections)
                    </span>
                  </label>
                </div>

                {expandedModules.has(module.id) && (
                  <div className="tree-chapters">
                    {module.chapters.map(chapter => (
                      <div key={chapter.id} className="tree-chapter">
                        <div className="tree-item chapter-item">
                          <button
                            className="tree-expand"
                            onClick={() => toggleChapter(`${module.id}-${chapter.id}`)}
                          >
                            {expandedChapters.has(`${module.id}-${chapter.id}`) ? '[-]' : '[+]'}
                          </button>
                          <label className="tree-label">
                            <input
                              type="checkbox"
                              checked={isChapterSelected(module.id, chapter.id)}
                              disabled={isModuleSelected(module.id)}
                              onChange={(e) => selectChapter(module.id, chapter.id, e.target.checked)}
                            />
                            <span className="tree-title">{chapter.title}</span>
                            <span className="tree-count">({chapter.sections.length} sections)</span>
                          </label>
                        </div>

                        {expandedChapters.has(`${module.id}-${chapter.id}`) && (
                          <div className="tree-sections">
                            {chapter.sections.map(section => (
                              <div key={section.id} className="tree-item section-item">
                                <label className="tree-label">
                                  <input
                                    type="checkbox"
                                    checked={isSectionSelected(module.id, chapter.id, section.id)}
                                    disabled={isModuleSelected(module.id) || isChapterSelected(module.id, chapter.id) && selectedChapters.has(`${module.id}.${chapter.id}`)}
                                    onChange={(e) => selectSection(module.id, chapter.id, section.id, e.target.checked)}
                                  />
                                  <span className="tree-title">{section.title}</span>
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {hasSelection && (
            <div className="selection-summary">
              Selected: {counts.modules > 0 && `${counts.modules} module(s)`}
              {counts.chapters > 0 && ` ${counts.modules > 0 ? '+ ' : ''}${counts.chapters} chapter(s)`}
              {' = '}{counts.sections} section(s) total
            </div>
          )}
        </div>

        {/* Test Options Panel */}
        <div className="test-config-options">
          <h3>Test Options</h3>

          <div className="option-group">
            <label htmlFor="totalQuestions">Number of Questions</label>
            <input
              id="totalQuestions"
              type="number"
              min={1}
              max={100}
              value={totalQuestions}
              onChange={(e) => setTotalQuestions(Math.max(1, Math.min(100, parseInt(e.target.value) || 10)))}
            />
            <span className="option-hint">1-100 questions</span>
          </div>

          <div className="option-group">
            <label htmlFor="difficulty">Difficulty Level</label>
            <select
              id="difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="option-group">
            <label htmlFor="adaptiveMode">Smart Selection</label>
            <select
              id="adaptiveMode"
              value={adaptiveMode}
              onChange={(e) => setAdaptiveMode(e.target.value as 'none' | 'low_scores' | 'least_studied')}
            >
              <option value="none">All content equally</option>
              <option value="low_scores">Focus on low scores</option>
              <option value="least_studied">Focus on least studied</option>
            </select>
            <span className="option-hint">
              {adaptiveMode === 'low_scores' && 'Prioritizes sections where you scored below 70%'}
              {adaptiveMode === 'least_studied' && 'Prioritizes sections with least study time'}
            </span>
          </div>
        </div>
      </div>

      <div className="test-config-footer">
        <button className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          onClick={handleStartTest}
          disabled={!hasSelection}
        >
          {hasSelection ? `Start Test (${totalQuestions} questions)` : 'Select content first'}
        </button>
      </div>
    </div>
  );
}

export default TestConfiguration;
