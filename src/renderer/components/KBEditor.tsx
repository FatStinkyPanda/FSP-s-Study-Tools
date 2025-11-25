import React, { useState, useEffect, useCallback, useRef } from 'react';
import './KBEditor.css';
import { ContentElement } from '../../shared/types';

interface FileReference {
  id: string;
  name: string;
  path: string;
  type: string;
  parsed?: boolean;
  parsedContent?: string;
  parsedElements?: ContentElement[];  // Structured content elements
  parseError?: string;
}

interface Module {
  id: string;
  title: string;
  order: number;
  files: FileReference[];
  chapters: Chapter[];
}

interface Chapter {
  id: string;
  title: string;
  order: number;
  files: FileReference[];
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

interface ParseProgress {
  total: number;
  completed: number;
  current: string;
  errors: string[];
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
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null);
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
      // Fetch parsed KB from database via IPC
      const parsed = await window.electronAPI.invoke('kb:parse', id) as {
        metadata: {
          uuid: string;
          title: string;
          version: string;
          author?: string;
          description?: string;
          category?: string;
          tags: string[];
          created?: string;
          modified?: string;
        };
        modules: Array<{
          id: string;
          title: string;
          description?: string;
          order?: number;
          chapters: Array<{
            id: string;
            title: string;
            description?: string;
            order?: number;
            sections: Array<{
              id: string;
              title: string;
              order?: number;
              content?: {
                text?: string;
                html?: string;
                markdown?: string;
              };
            }>;
          }>;
        }>;
      };

      if (!parsed) {
        throw new Error('Knowledge base not found');
      }

      // Convert parsed KB to KBEditor's KBData format
      const convertedModules: Module[] = parsed.modules.map((mod, modIndex) => ({
        id: mod.id || `module_${modIndex}`,
        title: mod.title || `Module ${modIndex + 1}`,
        order: mod.order ?? modIndex,
        files: [], // No files in parsed XML structure
        chapters: mod.chapters.map((ch, chIndex) => ({
          id: ch.id || `chapter_${modIndex}_${chIndex}`,
          title: ch.title || `Chapter ${chIndex + 1}`,
          order: ch.order ?? chIndex,
          files: [], // No files in parsed XML structure
          sections: ch.sections.map((sec, secIndex) => ({
            id: sec.id || `section_${modIndex}_${chIndex}_${secIndex}`,
            title: sec.title || `Section ${secIndex + 1}`,
            order: sec.order ?? secIndex,
            content: {
              text: sec.content?.text || sec.content?.markdown || '',
              files: [], // No files in parsed XML structure
            },
          })),
        })),
      }));

      setKbData({
        title: parsed.metadata.title || 'Untitled',
        metadata: {
          version: parsed.metadata.version || '1.0',
          author: parsed.metadata.author || '',
          description: parsed.metadata.description || '',
        },
        modules: convertedModules,
      });

      // Reset selection state
      setSelectedModule(null);
      setSelectedChapter(null);
      setSelectedSection(null);
      setHasUnsavedChanges(false);

      showError('Knowledge base loaded successfully', 'success');
    } catch (error) {
      console.error('Failed to load KB:', error);
      showError(`Failed to load knowledge base: ${(error as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Get all unparsed files from the KB structure
  const getAllUnparsedFiles = useCallback((): { file: FileReference; location: string }[] => {
    const unparsedFiles: { file: FileReference; location: string }[] = [];

    for (const module of kbData.modules) {
      // Module level files
      for (const file of module.files) {
        if (!file.parsed && !file.parseError) {
          unparsedFiles.push({ file, location: `Module: ${module.title}` });
        }
      }

      for (const chapter of module.chapters) {
        // Chapter level files
        for (const file of chapter.files) {
          if (!file.parsed && !file.parseError) {
            unparsedFiles.push({ file, location: `Chapter: ${chapter.title}` });
          }
        }

        for (const section of chapter.sections) {
          // Section level files
          for (const file of section.content.files) {
            if (!file.parsed && !file.parseError) {
              unparsedFiles.push({ file, location: `Section: ${section.title}` });
            }
          }
        }
      }
    }

    return unparsedFiles;
  }, [kbData]);

  // Parse all unparsed files
  const parseAllFiles = useCallback(async () => {
    const unparsedFiles = getAllUnparsedFiles();

    if (unparsedFiles.length === 0) {
      showError('All files are already parsed', 'info');
      return;
    }

    setIsParsing(true);
    setParseProgress({
      total: unparsedFiles.length,
      completed: 0,
      current: '',
      errors: [],
    });

    const errors: string[] = [];

    for (let i = 0; i < unparsedFiles.length; i++) {
      const { file, location } = unparsedFiles[i];

      setParseProgress(prev => prev ? {
        ...prev,
        current: `Parsing ${file.name}...`,
        completed: i,
      } : null);

      try {
        const result = await window.electronAPI.invoke('file:parse', file.path) as {
          success: boolean;
          content?: { text: string; elements?: ContentElement[]; metadata: Record<string, unknown>; warnings?: string[] };
          error?: string;
        };

        if (result.success && result.content) {
          // Update the file in kbData with parsed content and structured elements
          setKbData(prev => updateFileInKbData(prev, file.id, {
            parsed: true,
            parsedContent: result.content!.text,
            parsedElements: result.content!.elements,
          }));
        } else {
          errors.push(`${file.name}: ${result.error || 'Unknown error'}`);
          setKbData(prev => updateFileInKbData(prev, file.id, {
            parsed: false,
            parseError: result.error || 'Unknown error',
          }));
        }
      } catch (error) {
        const errorMsg = (error as Error).message;
        errors.push(`${file.name}: ${errorMsg}`);
        setKbData(prev => updateFileInKbData(prev, file.id, {
          parsed: false,
          parseError: errorMsg,
        }));
      }
    }

    setParseProgress(prev => prev ? {
      ...prev,
      completed: unparsedFiles.length,
      current: 'Complete',
      errors,
    } : null);

    setIsParsing(false);

    if (errors.length === 0) {
      showError(`Successfully parsed ${unparsedFiles.length} file(s)`, 'success');
    } else if (errors.length < unparsedFiles.length) {
      showError(`Parsed ${unparsedFiles.length - errors.length} file(s), ${errors.length} failed`, 'warning');
    } else {
      showError(`Failed to parse all ${errors.length} file(s)`, 'error');
    }

    // Clear progress after a delay
    setTimeout(() => setParseProgress(null), 3000);
  }, [getAllUnparsedFiles, showError]);

  // Helper to update a file's properties anywhere in the KB structure
  const updateFileInKbData = (data: KBData, fileId: string, updates: Partial<FileReference>): KBData => {
    return {
      ...data,
      modules: data.modules.map(module => ({
        ...module,
        files: module.files.map(f => f.id === fileId ? { ...f, ...updates } : f),
        chapters: module.chapters.map(chapter => ({
          ...chapter,
          files: chapter.files.map(f => f.id === fileId ? { ...f, ...updates } : f),
          sections: chapter.sections.map(section => ({
            ...section,
            content: {
              ...section.content,
              files: section.content.files.map(f => f.id === fileId ? { ...f, ...updates } : f),
            },
          })),
        })),
      })),
    };
  };

  // Module operations
  const addModule = () => {
    const newModule: Module = {
      id: `module_${Date.now()}`,
      title: `Module ${kbData.modules.length + 1}`,
      order: kbData.modules.length,
      files: [],
      chapters: [],
    };
    setKbData(prev => ({
      ...prev,
      modules: [...prev.modules, newModule],
    }));
    setSelectedModule(newModule.id);
    setSelectedChapter(null);
    setSelectedSection(null);
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
          setSelectedChapter(null);
          setSelectedSection(null);
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
            files: [],
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
          setSelectedSection(null);
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

  // File operations - Generic add files function
  const addFiles = async (
    targetType: 'module' | 'chapter' | 'section',
    moduleId?: string,
    chapterId?: string,
    sectionId?: string
  ) => {
    try {
      // Open file dialog with multi-select
      const result = await window.electronAPI.invoke('dialog:openFiles', {
        title: 'Select Files to Add',
      }) as { success: boolean; files: Array<{ path: string; name: string; type: string }>; error?: string };

      if (!result.success || result.files.length === 0) {
        return;
      }

      // Create file references
      const newFiles: FileReference[] = result.files.map((f, i) => ({
        id: `file_${Date.now()}_${i}`,
        name: f.name,
        path: f.path,
        type: f.type,
        parsed: false,
      }));

      // Add files to the appropriate location
      setKbData(prev => {
        if (targetType === 'module' && moduleId) {
          return {
            ...prev,
            modules: prev.modules.map(m =>
              m.id === moduleId
                ? { ...m, files: [...m.files, ...newFiles] }
                : m
            ),
          };
        } else if (targetType === 'chapter' && moduleId && chapterId) {
          return {
            ...prev,
            modules: prev.modules.map(m => {
              if (m.id === moduleId) {
                return {
                  ...m,
                  chapters: m.chapters.map(c =>
                    c.id === chapterId
                      ? { ...c, files: [...c.files, ...newFiles] }
                      : c
                  ),
                };
              }
              return m;
            }),
          };
        } else if (targetType === 'section' && moduleId && chapterId && sectionId) {
          return {
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
                          s.id === sectionId
                            ? { ...s, content: { ...s.content, files: [...s.content.files, ...newFiles] } }
                            : s
                        ),
                      };
                    }
                    return c;
                  }),
                };
              }
              return m;
            }),
          };
        }
        return prev;
      });

      showError(`Added ${newFiles.length} file(s)`, 'success');
    } catch (error) {
      console.error('Failed to add files:', error);
      showError(`Failed to add files: ${(error as Error).message}`, 'error');
    }
  };

  // Remove file from any location
  const removeFile = (
    targetType: 'module' | 'chapter' | 'section',
    fileId: string,
    moduleId?: string,
    chapterId?: string,
    sectionId?: string
  ) => {
    setKbData(prev => {
      if (targetType === 'module' && moduleId) {
        return {
          ...prev,
          modules: prev.modules.map(m =>
            m.id === moduleId
              ? { ...m, files: m.files.filter(f => f.id !== fileId) }
              : m
          ),
        };
      } else if (targetType === 'chapter' && moduleId && chapterId) {
        return {
          ...prev,
          modules: prev.modules.map(m => {
            if (m.id === moduleId) {
              return {
                ...m,
                chapters: m.chapters.map(c =>
                  c.id === chapterId
                    ? { ...c, files: c.files.filter(f => f.id !== fileId) }
                    : c
                ),
              };
            }
            return m;
          }),
        };
      } else if (targetType === 'section' && moduleId && chapterId && sectionId) {
        return {
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
                        s.id === sectionId
                          ? { ...s, content: { ...s.content, files: s.content.files.filter(f => f.id !== fileId) } }
                          : s
                      ),
                    };
                  }
                  return c;
                }),
              };
            }
            return m;
          }),
        };
      }
      return prev;
    });
  };

  // Parse a single file
  const parseSingleFile = async (fileId: string) => {
    // Find the file in the KB structure
    let foundFile: FileReference | null = null;

    for (const module of kbData.modules) {
      foundFile = module.files.find(f => f.id === fileId) || null;
      if (foundFile) break;

      for (const chapter of module.chapters) {
        foundFile = chapter.files.find(f => f.id === fileId) || null;
        if (foundFile) break;

        for (const section of chapter.sections) {
          foundFile = section.content.files.find(f => f.id === fileId) || null;
          if (foundFile) break;
        }
        if (foundFile) break;
      }
      if (foundFile) break;
    }

    if (!foundFile) {
      showError('File not found', 'error');
      return;
    }

    try {
      setKbData(prev => updateFileInKbData(prev, fileId, { parsed: false, parseError: undefined }));

      const result = await window.electronAPI.invoke('file:parse', foundFile.path) as {
        success: boolean;
        content?: { text: string; elements?: ContentElement[]; metadata: Record<string, unknown>; warnings?: string[] };
        error?: string;
      };

      if (result.success && result.content) {
        setKbData(prev => updateFileInKbData(prev, fileId, {
          parsed: true,
          parsedContent: result.content!.text,
          parsedElements: result.content!.elements,
          parseError: undefined,
        }));
        showError(`Parsed ${foundFile.name} successfully`, 'success');
      } else {
        setKbData(prev => updateFileInKbData(prev, fileId, {
          parsed: false,
          parseError: result.error || 'Unknown error',
        }));
        showError(`Failed to parse ${foundFile.name}: ${result.error}`, 'error');
      }
    } catch (error) {
      const errorMsg = (error as Error).message;
      setKbData(prev => updateFileInKbData(prev, fileId, {
        parsed: false,
        parseError: errorMsg,
      }));
      showError(`Failed to parse ${foundFile.name}: ${errorMsg}`, 'error');
    }
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

    // Check for unparsed files and auto-parse them
    const unparsedFiles = getAllUnparsedFiles();
    if (unparsedFiles.length > 0) {
      showError(`Parsing ${unparsedFiles.length} unparsed file(s)...`, 'info');
      await parseAllFiles();
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

  // Render file list component
  const renderFileList = (
    files: FileReference[],
    targetType: 'module' | 'chapter' | 'section',
    moduleId?: string,
    chapterId?: string,
    sectionId?: string
  ) => (
    <div className="files-section">
      <div className="section-header">
        <h4>Files ({files.length})</h4>
        <button
          className="add-files-button"
          onClick={() => addFiles(targetType, moduleId, chapterId, sectionId)}
        >
          + Add File(s)
        </button>
      </div>

      {files.length === 0 ? (
        <p className="empty-message">No files attached. Click "+ Add File(s)" to add documents.</p>
      ) : (
        <div className="file-list">
          {files.map(file => (
            <div key={file.id} className={`file-item ${file.parsed ? 'parsed' : ''} ${file.parseError ? 'error' : ''}`}>
              <span className="file-icon">[{file.type.toUpperCase()}]</span>
              <span className="file-name" title={file.path}>{file.name}</span>
              <span className={`file-status ${file.parsed ? 'parsed' : file.parseError ? 'error' : 'pending'}`}>
                {file.parsed ? '[OK]' : file.parseError ? '[ERR]' : '[...]'}
              </span>
              <div className="file-actions">
                {!file.parsed && (
                  <button
                    className="parse-button"
                    onClick={() => parseSingleFile(file.id)}
                    title="Parse this file"
                  >
                    Parse
                  </button>
                )}
                <button
                  className="delete-button"
                  onClick={() => removeFile(targetType, file.id, moduleId, chapterId, sectionId)}
                  title="Remove file"
                >
                  X
                </button>
              </div>
              {file.parseError && (
                <div className="file-error" title={file.parseError}>
                  Error: {file.parseError.substring(0, 50)}...
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Get total file count
  const getTotalFileCount = (): { total: number; parsed: number; unparsed: number } => {
    let total = 0;
    let parsed = 0;

    for (const module of kbData.modules) {
      total += module.files.length;
      parsed += module.files.filter(f => f.parsed).length;

      for (const chapter of module.chapters) {
        total += chapter.files.length;
        parsed += chapter.files.filter(f => f.parsed).length;

        for (const section of chapter.sections) {
          total += section.content.files.length;
          parsed += section.content.files.filter(f => f.parsed).length;
        }
      }
    }

    return { total, parsed, unparsed: total - parsed };
  };

  // Get currently selected items
  const currentModule = kbData.modules.find(m => m.id === selectedModule);
  const currentChapter = currentModule?.chapters.find(c => c.id === selectedChapter);
  const currentSection = currentChapter?.sections.find(s => s.id === selectedSection);
  const fileStats = getTotalFileCount();

  if (loading && !isParsing) {
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

      {/* Parse Progress Modal */}
      {isParsing && parseProgress && (
        <div className="parse-progress-overlay">
          <div className="parse-progress-modal">
            <h3>Parsing Files...</h3>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(parseProgress.completed / parseProgress.total) * 100}%` }}
              />
            </div>
            <p className="progress-text">
              {parseProgress.completed} / {parseProgress.total} files
            </p>
            <p className="progress-current">{parseProgress.current}</p>
          </div>
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
          {fileStats.total > 0 && (
            <span className="file-stats">
              Files: {fileStats.parsed}/{fileStats.total} parsed
            </span>
          )}
          {fileStats.unparsed > 0 && (
            <button
              className="parse-now-button"
              onClick={parseAllFiles}
              disabled={isParsing}
              title={`Parse ${fileStats.unparsed} unparsed file(s)`}
            >
              {isParsing ? 'Parsing...' : `Parse Now (${fileStats.unparsed})`}
            </button>
          )}
          <button className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={handleSave}
            disabled={saveStatus === 'saving' || isParsing}
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
                    className={`tree-node ${selectedModule === module.id && !selectedChapter ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedModule(module.id);
                      setSelectedChapter(null);
                      setSelectedSection(null);
                    }}
                  >
                    <span className="node-icon">[M]</span>
                    <span className="node-title">{module.title}</span>
                    {module.files.length > 0 && (
                      <span className="file-count">({module.files.length} files)</span>
                    )}
                    <div className="node-actions">
                      {moduleIndex > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); moveModule(module.id, 'up'); }}>
                          ^
                        </button>
                      )}
                      {moduleIndex < kbData.modules.length - 1 && (
                        <button onClick={(e) => { e.stopPropagation(); moveModule(module.id, 'down'); }}>
                          v
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); addChapter(module.id); }}>
                        +Ch
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteModule(module.id); }}>
                        X
                      </button>
                    </div>
                  </div>

                  {module.chapters.length > 0 && (
                    <div className="tree-children">
                      {module.chapters.map(chapter => (
                        <div key={chapter.id} className="tree-item chapter-item">
                          <div
                            className={`tree-node ${selectedChapter === chapter.id && !selectedSection ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedModule(module.id);
                              setSelectedChapter(chapter.id);
                              setSelectedSection(null);
                            }}
                          >
                            <span className="node-icon">[C]</span>
                            <span className="node-title">{chapter.title}</span>
                            {chapter.files.length > 0 && (
                              <span className="file-count">({chapter.files.length} files)</span>
                            )}
                            <div className="node-actions">
                              <button onClick={(e) => { e.stopPropagation(); addSection(module.id, chapter.id); }}>
                                +Sec
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); deleteChapter(module.id, chapter.id); }}>
                                X
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
                                    {section.content.files.length > 0 && (
                                      <span className="file-count">
                                        ({section.content.files.length} files)
                                      </span>
                                    )}
                                    <div className="node-actions">
                                      <button onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSection(module.id, chapter.id, section.id);
                                      }}>
                                        X
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

              {renderFileList(currentModule.files, 'module', currentModule.id)}
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

              {renderFileList(currentChapter.files, 'chapter', currentModule.id, currentChapter.id)}
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
                  placeholder="Enter section content here, or add files below to parse content from documents..."
                />
              </div>

              {renderFileList(
                currentSection.content.files,
                'section',
                currentModule.id,
                currentChapter.id,
                currentSection.id
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
