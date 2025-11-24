import React, { useState, useEffect, useCallback, useRef } from 'react';
import './KBEditor.css';

interface Module {
  id: string;
  title: string;
  order: number;
  chapters: Chapter[];
}

interface Chapter {
  id: string;
  title: string;
  order: number;
  sections: Section[];
}

interface Section {
  id: string;
  title: string;
  order: number;
  content: {
    text: string;
    files: FileReference[];
  };
}

interface FileReference {
  id: string;
  name: string;
  path: string;
  type: 'pdf' | 'docx' | 'txt';
}

interface KBEditorProps {
  kbId?: number;
  onSave?: (data: KBData) => void;
  onCancel?: () => void;
}

interface KBData {
  title: string;
  metadata: {
    version: string;
    author: string;
    description: string;
  };
  modules: Module[];
}

interface ErrorState {
  message: string;
  type: 'error' | 'warning' | 'info' | 'success';
}

interface ConfirmationModal {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export default function KBEditor({ kbId, onSave, onCancel }: KBEditorProps) {
  const [kbData, setKbData] = useState<KBData>({
    title: '',
    metadata: {
      version: '1.0',
      author: '',
      description: '',
    },
    modules: [],
  });

  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<ErrorState | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationModal>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (kbId) {
      loadKnowledgeBase(kbId);
    }
  }, [kbId]);

  // Auto-dismiss error/success toasts after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Auto-dismiss "saved" status after 3 seconds
  useEffect(() => {
    if (saveStatus === 'saved') {
      const timer = setTimeout(() => setSaveStatus('idle'), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape to cancel
      if (e.key === 'Escape' && !confirmation.isOpen) {
        if (onCancel) {
          if (hasUnsavedChanges) {
            showConfirmation(
              'Unsaved Changes',
              'You have unsaved changes. Are you sure you want to cancel?',
              () => onCancel()
            );
          } else {
            onCancel();
          }
        }
      }
      // Escape to close confirmation modal
      if (e.key === 'Escape' && confirmation.isOpen) {
        setConfirmation(prev => ({ ...prev, isOpen: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmation.isOpen, hasUnsavedChanges, onCancel]);

  // Mark as having unsaved changes when data changes
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [kbData]);

  const showError = useCallback((message: string, type: 'error' | 'warning' | 'info' | 'success' = 'error') => {
    setError({ message, type });
  }, []);

  const showConfirmation = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirmation({
      isOpen: true,
      title,
      message,
      onConfirm,
    });
  }, []);

  const closeConfirmation = useCallback(() => {
    setConfirmation(prev => ({ ...prev, isOpen: false }));
  }, []);

  const loadKnowledgeBase = async (id: number) => {
    setLoading(true);
    try {
      // TODO: Implement loading from database
      console.log('Loading KB:', id);
      showError('Knowledge base loaded successfully', 'success');
    } catch (error) {
      console.error('Failed to load KB:', error);
      showError(`Failed to load knowledge base: ${(error as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Module operations
  const addModule = () => {
    const newModule: Module = {
      id: `module_${Date.now()}`,
      title: `Module ${kbData.modules.length + 1}`,
      order: kbData.modules.length,
      chapters: [],
    };
    setKbData(prev => ({
      ...prev,
      modules: [...prev.modules, newModule],
    }));
    setSelectedModule(newModule.id);
  };

  const updateModule = (moduleId: string, updates: Partial<Module>) => {
    setKbData(prev => ({
      ...prev,
      modules: prev.modules.map(m =>
        m.id === moduleId ? { ...m, ...updates } : m
      ),
    }));
  };

  const deleteModule = (moduleId: string) => {
    showConfirmation(
      'Delete Module',
      'Are you sure you want to delete this module and all its chapters? This action cannot be undone.',
      () => {
        setKbData(prev => ({
          ...prev,
          modules: prev.modules.filter(m => m.id !== moduleId),
        }));
        if (selectedModule === moduleId) {
          setSelectedModule(null);
        }
        showError('Module deleted successfully', 'success');
        closeConfirmation();
      }
    );
  };

  const moveModule = (moduleId: string, direction: 'up' | 'down') => {
    setKbData(prev => {
      const modules = [...prev.modules];
      const index = modules.findIndex(m => m.id === moduleId);
      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= modules.length) return prev;

      // Swap
      [modules[index], modules[newIndex]] = [modules[newIndex], modules[index]];

      // Update order
      modules.forEach((m, i) => {
        m.order = i;
      });

      return { ...prev, modules };
    });
  };

  // Chapter operations
  const addChapter = (moduleId: string) => {
    setKbData(prev => ({
      ...prev,
      modules: prev.modules.map(m => {
        if (m.id === moduleId) {
          const newChapter: Chapter = {
            id: `chapter_${Date.now()}`,
            title: `Chapter ${m.chapters.length + 1}`,
            order: m.chapters.length,
            sections: [],
          };
          return {
            ...m,
            chapters: [...m.chapters, newChapter],
          };
        }
        return m;
      }),
    }));
  };

  const updateChapter = (moduleId: string, chapterId: string, updates: Partial<Chapter>) => {
    setKbData(prev => ({
      ...prev,
      modules: prev.modules.map(m => {
        if (m.id === moduleId) {
          return {
            ...m,
            chapters: m.chapters.map(c =>
              c.id === chapterId ? { ...c, ...updates } : c
            ),
          };
        }
        return m;
      }),
    }));
  };

  const deleteChapter = (moduleId: string, chapterId: string) => {
    showConfirmation(
      'Delete Chapter',
      'Are you sure you want to delete this chapter and all its sections? This action cannot be undone.',
      () => {
        setKbData(prev => ({
          ...prev,
          modules: prev.modules.map(m => {
            if (m.id === moduleId) {
              return {
                ...m,
                chapters: m.chapters.filter(c => c.id !== chapterId),
              };
            }
            return m;
          }),
        }));
        if (selectedChapter === chapterId) {
          setSelectedChapter(null);
        }
        showError('Chapter deleted successfully', 'success');
        closeConfirmation();
      }
    );
  };

  // Section operations
  const addSection = (moduleId: string, chapterId: string) => {
    setKbData(prev => ({
      ...prev,
      modules: prev.modules.map(m => {
        if (m.id === moduleId) {
          return {
            ...m,
            chapters: m.chapters.map(c => {
              if (c.id === chapterId) {
                const newSection: Section = {
                  id: `section_${Date.now()}`,
                  title: `Section ${c.sections.length + 1}`,
                  order: c.sections.length,
                  content: {
                    text: '',
                    files: [],
                  },
                };
                return {
                  ...c,
                  sections: [...c.sections, newSection],
                };
              }
              return c;
            }),
          };
        }
        return m;
      }),
    }));
  };

  const updateSection = (
    moduleId: string,
    chapterId: string,
    sectionId: string,
    updates: Partial<Section>
  ) => {
    setKbData(prev => ({
      ...prev,
      modules: prev.modules.map(m => {
        if (m.id === moduleId) {
          return {
            ...m,
            chapters: m.chapters.map(c => {
              if (c.id === chapterId) {
                return {
                  ...c,
                  sections: c.sections.map(s =>
                    s.id === sectionId ? { ...s, ...updates } : s
                  ),
                };
              }
              return c;
            }),
          };
        }
        return m;
      }),
    }));
  };

  const deleteSection = (moduleId: string, chapterId: string, sectionId: string) => {
    showConfirmation(
      'Delete Section',
      'Are you sure you want to delete this section? This action cannot be undone.',
      () => {
        setKbData(prev => ({
          ...prev,
          modules: prev.modules.map(m => {
            if (m.id === moduleId) {
              return {
                ...m,
                chapters: m.chapters.map(c => {
                  if (c.id === chapterId) {
                    return {
                      ...c,
                      sections: c.sections.filter(s => s.id !== sectionId),
                    };
                  }
                  return c;
                }),
              };
            }
            return m;
          }),
        }));
        if (selectedSection === sectionId) {
          setSelectedSection(null);
        }
        showError('Section deleted successfully', 'success');
        closeConfirmation();
      }
    );
  };

  // File operations
  const addFileToSection = async (moduleId: string, chapterId: string, sectionId: string) => {
    try {
      // Open file dialog
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [
          { name: 'Documents', extensions: ['pdf', 'docx', 'txt'] },
        ],
      }) as { filePath: string; fileName: string } | null;

      if (result) {
        const fileRef: FileReference = {
          id: `file_${Date.now()}`,
          name: result.fileName,
          path: result.filePath,
          type: result.fileName.endsWith('.pdf') ? 'pdf' :
                result.fileName.endsWith('.docx') ? 'docx' : 'txt',
        };

        setKbData(prev => ({
          ...prev,
          modules: prev.modules.map(m => {
            if (m.id === moduleId) {
              return {
                ...m,
                chapters: m.chapters.map(c => {
                  if (c.id === chapterId) {
                    return {
                      ...c,
                      sections: c.sections.map(s => {
                        if (s.id === sectionId) {
                          return {
                            ...s,
                            content: {
                              ...s.content,
                              files: [...s.content.files, fileRef],
                            },
                          };
                        }
                        return s;
                      }),
                    };
                  }
                  return c;
                }),
              };
            }
            return m;
          }),
        }));
        showError(`File "${result.fileName}" added successfully`, 'success');
      }
    } catch (error) {
      console.error('Failed to add file:', error);
      showError(`Failed to add file: ${(error as Error).message}`, 'error');
    }
  };

  const removeFileFromSection = (
    moduleId: string,
    chapterId: string,
    sectionId: string,
    fileId: string
  ) => {
    setKbData(prev => ({
      ...prev,
      modules: prev.modules.map(m => {
        if (m.id === moduleId) {
          return {
            ...m,
            chapters: m.chapters.map(c => {
              if (c.id === chapterId) {
                return {
                  ...c,
                  sections: c.sections.map(s => {
                    if (s.id === sectionId) {
                      return {
                        ...s,
                        content: {
                          ...s.content,
                          files: s.content.files.filter(f => f.id !== fileId),
                        },
                      };
                    }
                    return s;
                  }),
                };
              }
              return c;
            }),
          };
        }
        return m;
      }),
    }));
  };

  const handleSave = async () => {
    // Validate
    const errors: { [key: string]: string } = {};

    if (!kbData.title.trim()) {
      errors.title = 'Title is required';
    }

    if (kbData.modules.length === 0) {
      errors.modules = 'At least one module is required';
    }

    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      showError('Please fix the validation errors before saving', 'error');
      return;
    }

    try {
      setSaveStatus('saving');
      setLoading(true);

      // Convert to XML and save
      if (onSave) {
        onSave(kbData);
      }

      // Simulate async save
      await new Promise(resolve => setTimeout(resolve, 500));

      setSaveStatus('saved');
      setHasUnsavedChanges(false);
      showError('Knowledge base saved successfully!', 'success');
    } catch (error) {
      console.error('Failed to save:', error);
      setSaveStatus('error');
      showError(`Failed to save: ${(error as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Get currently selected items
  const currentModule = kbData.modules.find(m => m.id === selectedModule);
  const currentChapter = currentModule?.chapters.find(c => c.id === selectedChapter);
  const currentSection = currentChapter?.sections.find(s => s.id === selectedSection);

  if (loading) {
    return (
      <div className="kb-editor loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="kb-editor">
      {/* Error Toast */}
      {error && (
        <div className={`kb-toast ${error.type}`} role="alert">
          <span>{error.message}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmation.isOpen && (
        <div className="modal-overlay" onClick={closeConfirmation}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{confirmation.title}</h3>
            <p>{confirmation.message}</p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={closeConfirmation}>
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  confirmation.onConfirm();
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="editor-header">
        <div className="header-left">
          <h2>{kbId ? 'Edit Knowledge Base' : 'Create New Knowledge Base'}</h2>
          {hasUnsavedChanges && (
            <span className="unsaved-indicator" title="You have unsaved changes">
              (Unsaved changes)
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="save-indicator success">Saved!</span>
          )}
          {saveStatus === 'saving' && (
            <span className="save-indicator saving">Saving...</span>
          )}
        </div>
        <div className="editor-actions">
          <span className="keyboard-hint">Ctrl+S to save, Esc to cancel</span>
          <button className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="editor-metadata">
        <div className="form-group">
          <label>Title: <span className="required">*</span></label>
          <input
            type="text"
            value={kbData.title}
            onChange={e => {
              setKbData(prev => ({ ...prev, title: e.target.value }));
              if (validationErrors.title) {
                setValidationErrors(prev => {
                  const { title, ...rest } = prev;
                  return rest;
                });
              }
            }}
            placeholder="Knowledge Base Title"
            className={validationErrors.title ? 'input-error' : ''}
            aria-invalid={!!validationErrors.title}
            aria-describedby={validationErrors.title ? 'title-error' : undefined}
          />
          {validationErrors.title && (
            <span className="validation-error" id="title-error" role="alert">
              {validationErrors.title}
            </span>
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Author:</label>
            <input
              type="text"
              value={kbData.metadata.author}
              onChange={e =>
                setKbData(prev => ({
                  ...prev,
                  metadata: { ...prev.metadata, author: e.target.value },
                }))
              }
            />
          </div>
          <div className="form-group">
            <label>Version:</label>
            <input
              type="text"
              value={kbData.metadata.version}
              onChange={e =>
                setKbData(prev => ({
                  ...prev,
                  metadata: { ...prev.metadata, version: e.target.value },
                }))
              }
            />
          </div>
        </div>
        <div className="form-group">
          <label>Description:</label>
          <textarea
            value={kbData.metadata.description}
            onChange={e =>
              setKbData(prev => ({
                ...prev,
                metadata: { ...prev.metadata, description: e.target.value },
              }))
            }
            rows={3}
          />
        </div>
      </div>

      <div className="editor-content">
        {/* Structure Panel */}
        <div className="structure-panel">
          <div className="panel-header">
            <h3>Structure</h3>
            <button className="add-button" onClick={addModule}>
              + Module
            </button>
          </div>
          {validationErrors.modules && (
            <div className="panel-validation-error" role="alert">
              {validationErrors.modules}
            </div>
          )}

          <div className="structure-tree">
            {kbData.modules.length === 0 ? (
              <div className="empty-state">
                <p>No modules yet. Click "+ Module" to add one.</p>
              </div>
            ) : (
              kbData.modules.map((module, moduleIndex) => (
                <div key={module.id} className="tree-item module-item">
                  <div
                    className={`tree-node ${selectedModule === module.id ? 'selected' : ''}`}
                    onClick={() => setSelectedModule(module.id)}
                  >
                    <span className="node-icon">[M]</span>
                    <span className="node-title">{module.title}</span>
                    <div className="node-actions">
                      {moduleIndex > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); moveModule(module.id, 'up'); }}>
                          ↑
                        </button>
                      )}
                      {moduleIndex < kbData.modules.length - 1 && (
                        <button onClick={(e) => { e.stopPropagation(); moveModule(module.id, 'down'); }}>
                          ↓
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); addChapter(module.id); }}>
                        +Ch
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteModule(module.id); }}>
                        ×
                      </button>
                    </div>
                  </div>

                  {module.chapters.length > 0 && (
                    <div className="tree-children">
                      {module.chapters.map(chapter => (
                        <div key={chapter.id} className="tree-item chapter-item">
                          <div
                            className={`tree-node ${selectedChapter === chapter.id ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedModule(module.id);
                              setSelectedChapter(chapter.id);
                            }}
                          >
                            <span className="node-icon">[C]</span>
                            <span className="node-title">{chapter.title}</span>
                            <div className="node-actions">
                              <button onClick={(e) => { e.stopPropagation(); addSection(module.id, chapter.id); }}>
                                +Sec
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); deleteChapter(module.id, chapter.id); }}>
                                ×
                              </button>
                            </div>
                          </div>

                          {chapter.sections.length > 0 && (
                            <div className="tree-children">
                              {chapter.sections.map(section => (
                                <div key={section.id} className="tree-item section-item">
                                  <div
                                    className={`tree-node ${selectedSection === section.id ? 'selected' : ''}`}
                                    onClick={() => {
                                      setSelectedModule(module.id);
                                      setSelectedChapter(chapter.id);
                                      setSelectedSection(section.id);
                                    }}
                                  >
                                    <span className="node-icon">[S]</span>
                                    <span className="node-title">{section.title}</span>
                                    <span className="file-count">
                                      ({section.content.files.length} files)
                                    </span>
                                    <div className="node-actions">
                                      <button onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSection(module.id, chapter.id, section.id);
                                      }}>
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Details Panel */}
        <div className="details-panel">
          {!selectedModule && (
            <div className="empty-state">
              <p>Select a module, chapter, or section to edit</p>
            </div>
          )}

          {selectedModule && !selectedChapter && currentModule && (
            <div className="details-content">
              <h3>Module Details</h3>
              <div className="form-group">
                <label>Title:</label>
                <input
                  type="text"
                  value={currentModule.title}
                  onChange={e => updateModule(currentModule.id, { title: e.target.value })}
                />
              </div>
              <div className="stats">
                <p>Chapters: {currentModule.chapters.length}</p>
                <p>
                  Sections:{' '}
                  {currentModule.chapters.reduce((sum, c) => sum + c.sections.length, 0)}
                </p>
              </div>
            </div>
          )}

          {selectedChapter && !selectedSection && currentChapter && currentModule && (
            <div className="details-content">
              <h3>Chapter Details</h3>
              <div className="form-group">
                <label>Title:</label>
                <input
                  type="text"
                  value={currentChapter.title}
                  onChange={e =>
                    updateChapter(currentModule.id, currentChapter.id, { title: e.target.value })
                  }
                />
              </div>
              <div className="stats">
                <p>Sections: {currentChapter.sections.length}</p>
              </div>
            </div>
          )}

          {selectedSection && currentSection && currentChapter && currentModule && (
            <div className="details-content">
              <h3>Section Details</h3>
              <div className="form-group">
                <label>Title:</label>
                <input
                  type="text"
                  value={currentSection.title}
                  onChange={e =>
                    updateSection(currentModule.id, currentChapter.id, currentSection.id, {
                      title: e.target.value,
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label>Content:</label>
                <textarea
                  value={currentSection.content.text}
                  onChange={e =>
                    updateSection(currentModule.id, currentChapter.id, currentSection.id, {
                      content: { ...currentSection.content, text: e.target.value },
                    })
                  }
                  rows={10}
                  placeholder="Enter section content here..."
                />
              </div>

              <div className="files-section">
                <div className="section-header">
                  <h4>Files</h4>
                  <button
                    className="add-button"
                    onClick={() =>
                      addFileToSection(currentModule.id, currentChapter.id, currentSection.id)
                    }
                  >
                    + Add File
                  </button>
                </div>

                {currentSection.content.files.length === 0 ? (
                  <p className="empty-message">No files attached</p>
                ) : (
                  <div className="file-list">
                    {currentSection.content.files.map(file => (
                      <div key={file.id} className="file-item">
                        <span className="file-icon">[{file.type.toUpperCase()}]</span>
                        <span className="file-name">{file.name}</span>
                        <button
                          className="delete-button"
                          onClick={() =>
                            removeFileFromSection(
                              currentModule.id,
                              currentChapter.id,
                              currentSection.id,
                              file.id
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
