import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import StudySession from './StudySession';
import KBEditor from './components/KBEditor';
import Dashboard from './components/Dashboard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import SearchResults from './components/SearchResults';
import UpdateNotification from './components/UpdateNotification';
import KBViewer from './components/KBViewer';
import JasperChat from './components/JasperChat';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorNotificationContainer, useErrorNotifications } from './components/ErrorNotification';
import { toUserFriendlyError, errorToNotification, logError } from '../shared/errors';

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface KnowledgeBase {
  id: number;
  uuid: string;
  title: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

interface AppSettings {
  openai_api_key?: string;
  anthropic_api_key?: string;
  google_api_key?: string;
  openrouter_api_key?: string;
  default_ai_provider?: 'openai' | 'anthropic' | 'google' | 'openrouter';
  default_model?: string;
  openai_model?: string;
  anthropic_model?: string;
  google_model?: string;
  openrouter_model?: string;
  openai_models?: string[];
  anthropic_models?: string[];
  google_models?: string[];
  openrouter_models?: string[];
  temperature?: number;
  max_tokens?: number;
  theme?: 'dark' | 'light' | 'auto';
}

interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
}

// KB Editor data types
interface KBFileReference {
  id: string;
  name: string;
  path: string;
  type: string;
  parsed?: boolean;
  parsedContent?: string;
  parseError?: string;
}

interface KBModule {
  id: string;
  title: string;
  order: number;
  files: KBFileReference[];
  chapters: KBChapter[];
}

interface KBChapter {
  id: string;
  title: string;
  order: number;
  files: KBFileReference[];
  sections: KBSection[];
}

interface KBSection {
  id: string;
  title: string;
  order: number;
  content: {
    text: string;
    files: KBFileReference[];
  };
}

interface KBData {
  title: string;
  metadata: {
    version: string;
    author: string;
    description: string;
  };
  modules: KBModule[];
}

// Escape XML special characters
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Helper function to render files in XML format
function renderFilesXML(files: KBFileReference[], indent: string): string {
  if (!files || files.length === 0) return '';

  let xml = `${indent}<files>\n`;
  for (const file of files) {
    xml += `${indent}  <file id="${escapeXML(file.id)}" name="${escapeXML(file.name)}" path="${escapeXML(file.path)}" type="${escapeXML(file.type)}" parsed="${file.parsed ? 'true' : 'false'}">\n`;
    if (file.parsedContent) {
      xml += `${indent}    <parsed_content>${escapeXML(file.parsedContent)}</parsed_content>\n`;
    }
    xml += `${indent}  </file>\n`;
  }
  xml += `${indent}</files>\n`;
  return xml;
}

// Convert KBData to XML format matching the knowledge base schema expected by XMLParser
function convertKBDataToXML(data: KBData, uuid: string): string {
  const now = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<knowledge_base>
  <metadata>
    <uuid>${uuid}</uuid>
    <title>${escapeXML(data.title)}</title>
    <version>${escapeXML(data.metadata.version || '1.0')}</version>
    <author>${escapeXML(data.metadata.author || '')}</author>
    <description>${escapeXML(data.metadata.description || '')}</description>
    <created>${now}</created>
    <modified>${now}</modified>
  </metadata>

  <modules>
`;

  // Add modules
  for (let moduleIndex = 0; moduleIndex < data.modules.length; moduleIndex++) {
    const module = data.modules[moduleIndex];
    xml += `    <module id="${escapeXML(module.id)}" order="${moduleIndex + 1}">\n`;
    xml += `      <title>${escapeXML(module.title)}</title>\n`;
    xml += `      <description></description>\n`;

    // Add module-level files as resources (if any)
    if (module.files && module.files.length > 0) {
      xml += renderFilesXML(module.files, '      ');
    }

    xml += `      <chapters>\n`;

    // Add chapters
    for (let chapterIndex = 0; chapterIndex < module.chapters.length; chapterIndex++) {
      const chapter = module.chapters[chapterIndex];
      xml += `        <chapter id="${escapeXML(chapter.id)}" order="${chapterIndex + 1}">\n`;
      xml += `          <title>${escapeXML(chapter.title)}</title>\n`;
      xml += `          <description></description>\n`;

      // Add chapter-level files (if any)
      if (chapter.files && chapter.files.length > 0) {
        xml += renderFilesXML(chapter.files, '          ');
      }

      xml += `          <sections>\n`;

      // Add sections
      for (let sectionIndex = 0; sectionIndex < chapter.sections.length; sectionIndex++) {
        const section = chapter.sections[sectionIndex];
        xml += `            <section id="${escapeXML(section.id)}" order="${sectionIndex + 1}">\n`;
        xml += `              <title>${escapeXML(section.title)}</title>\n`;
        xml += `              <content>\n`;

        // Combine section text with parsed content from files
        let sectionText = section.content.text || '';
        const allElements: Array<{ type: string; content?: string; level?: number; items?: string[]; ordered?: boolean }> = [];

        if (section.content.files && section.content.files.length > 0) {
          for (const file of section.content.files) {
            if (file.parsedContent) {
              if (sectionText) sectionText += '\n\n';
              sectionText += `[Content from ${file.name}]\n${file.parsedContent}`;
            }
            // Collect structured elements from parsed files
            if (file.parsedElements && file.parsedElements.length > 0) {
              allElements.push(...file.parsedElements);
            }
          }
        }

        xml += `                <text>${escapeXML(sectionText)}</text>\n`;

        // Add structured elements if available
        if (allElements.length > 0) {
          xml += `                <elements>\n`;
          for (let elemIdx = 0; elemIdx < allElements.length; elemIdx++) {
            const elem = allElements[elemIdx];
            if (elem.type === 'heading') {
              xml += `                  <heading order="${elemIdx + 1}" level="${elem.level || 2}">${escapeXML(elem.content || '')}</heading>\n`;
            } else if (elem.type === 'paragraph') {
              xml += `                  <paragraph order="${elemIdx + 1}">${escapeXML(elem.content || '')}</paragraph>\n`;
            } else if (elem.type === 'list') {
              xml += `                  <list order="${elemIdx + 1}" ordered="${elem.ordered ? 'true' : 'false'}">\n`;
              if (elem.items) {
                for (const item of elem.items) {
                  xml += `                    <item>${escapeXML(item)}</item>\n`;
                }
              }
              xml += `                  </list>\n`;
            }
          }
          xml += `                </elements>\n`;
        }

        // Add file references for sections
        if (section.content.files && section.content.files.length > 0) {
          xml += renderFilesXML(section.content.files, '                ');
        }

        xml += `              </content>\n`;
        xml += `            </section>\n`;
      }

      xml += `          </sections>\n`;
      xml += `        </chapter>\n`;
    }

    xml += `      </chapters>\n`;
    xml += `    </module>\n`;
  }

  xml += `  </modules>
</knowledge_base>`;

  return xml;
}

function App() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [appVersion, setAppVersion] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'browse' | 'study' | 'editor' | 'settings' | 'dashboard' | 'analytics' | 'jasper'>('home');
  const [jasperKBs, setJasperKBs] = useState<Array<{ id: number; title: string; enabled: boolean }>>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [studyKbId, setStudyKbId] = useState<number | null>(null);
  const [studySectionId, setStudySectionId] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [customModelInputs, setCustomModelInputs] = useState<Record<string, string>>({});
  const [viewingKB, setViewingKB] = useState<{ id: number; title: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ kb: KnowledgeBase; confirmText: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Error notification system
  const { notifications, addNotification, dismissNotification } = useErrorNotifications();

  // Helper to show user-friendly errors
  const showError = useCallback((error: unknown, context?: string) => {
    const appError = toUserFriendlyError(error, context);
    logError(appError, context);
    addNotification(errorToNotification(appError));
  }, [addNotification]);

  // Handle notification actions
  const handleNotificationAction = useCallback((action: string, notificationId: string) => {
    switch (action) {
      case 'retry':
        // Dismiss and let the caller retry
        dismissNotification(notificationId);
        break;
      case 'open-settings':
        setCurrentView('settings');
        dismissNotification(notificationId);
        break;
      case 'restart':
        window.location.reload();
        break;
      case 'offline':
        // Dismiss notification for offline mode
        dismissNotification(notificationId);
        break;
      default:
        console.log('Unhandled notification action:', action);
    }
  }, [dismissNotification]);

  useEffect(() => {
    loadData();
  }, []);

  // Apply theme when settings change
  useEffect(() => {
    applyTheme(settings.theme || 'dark');
  }, [settings.theme]);

  const applyTheme = (theme: string) => {
    const root = document.documentElement;

    if (theme === 'auto') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', theme);
    }
  };

  const loadData = async () => {
    try {
      // Get app version
      const version = await window.electronAPI.invoke('app:version') as string;
      setAppVersion(version);

      // Load knowledge bases
      const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
      setKnowledgeBases(kbs);
      // Initialize Jasper KB list with all KBs enabled by default
      setJasperKBs(kbs.map(kb => ({ id: kb.id, title: kb.title, enabled: true })));

      // Load settings
      const loadedSettings = await window.electronAPI.invoke('settings:getAll') as AppSettings;
      setSettings(loadedSettings);

      // Apply theme immediately after loading
      applyTheme(loadedSettings.theme || 'dark');
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      await window.electronAPI.invoke('settings:updateAll', settings);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (error) {
      showError(error, 'Failed to save settings');
    }
  };

  const handleSettingChange = (key: keyof AppSettings, value: string | number | string[]) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Fetch available models for a provider using the API key
  const fetchModelsForProvider = async (provider: 'openai' | 'anthropic' | 'google' | 'openrouter') => {
    const apiKeyMap: Record<string, keyof AppSettings> = {
      openai: 'openai_api_key',
      anthropic: 'anthropic_api_key',
      google: 'google_api_key',
      openrouter: 'openrouter_api_key',
    };

    const modelsKeyMap: Record<string, keyof AppSettings> = {
      openai: 'openai_models',
      anthropic: 'anthropic_models',
      google: 'google_models',
      openrouter: 'openrouter_models',
    };

    const apiKey = settings[apiKeyMap[provider]];
    if (!apiKey) {
      setModelErrors(prev => ({ ...prev, [provider]: 'Please enter an API key first' }));
      return;
    }

    setFetchingModels(prev => ({ ...prev, [provider]: true }));
    setModelErrors(prev => ({ ...prev, [provider]: '' }));

    try {
      const result = await window.electronAPI.invoke('ai:fetchModels', provider, apiKey) as FetchModelsResult;

      if (result.success) {
        setSettings(prev => ({
          ...prev,
          [modelsKeyMap[provider]]: result.models
        }));
        setModelErrors(prev => ({ ...prev, [provider]: '' }));
      } else {
        setModelErrors(prev => ({ ...prev, [provider]: result.error || 'Failed to fetch models' }));
      }
    } catch (error) {
      setModelErrors(prev => ({ ...prev, [provider]: (error as Error).message }));
    } finally {
      setFetchingModels(prev => ({ ...prev, [provider]: false }));
    }
  };

  // Handle model selection change
  const handleModelChange = (provider: 'openai' | 'anthropic' | 'google' | 'openrouter', model: string) => {
    const modelKeyMap: Record<string, keyof AppSettings> = {
      openai: 'openai_model',
      anthropic: 'anthropic_model',
      google: 'google_model',
      openrouter: 'openrouter_model',
    };

    setSettings(prev => ({
      ...prev,
      [modelKeyMap[provider]]: model,
      default_model: model, // Also set as default model
    }));
  };

  // Handle custom model input
  const handleCustomModelSubmit = (provider: 'openai' | 'anthropic' | 'google' | 'openrouter') => {
    const customModel = customModelInputs[provider];
    if (customModel && customModel.trim()) {
      handleModelChange(provider, customModel.trim());
      setCustomModelInputs(prev => ({ ...prev, [provider]: '' }));
    }
  };

  const handleSearchNavigate = (kbId: number, sectionId: string) => {
    setStudyKbId(kbId);
    setStudySectionId(sectionId);
    setShowSearch(false);
    setCurrentView('study');
  };

  const getSampleXML = async () => {
    try {
      const xml = await window.electronAPI.invoke('kb:getSample') as string;
      console.log('Sample XML:', xml);
      alert('Sample XML logged to console. Check DevTools!');
    } catch (error) {
      console.error('Failed to get sample XML:', error);
    }
  };

  const importKnowledgeBase = async () => {
    try {
      // Call IPC handler that opens dialog, reads file, and imports
      const result = await window.electronAPI.invoke('kb:importFile') as { success: boolean; kbId?: number; error?: string };

      if (result.success && result.kbId) {
        // Show success notification
        addNotification({
          id: `import-success-${Date.now()}`,
          code: 0,
          severity: 'info',
          title: 'Import Successful',
          message: `Knowledge base imported successfully!`,
          timestamp: new Date(),
          autoDismiss: true,
          dismissAfter: 3000,
        });
        // Reload data
        await loadData();
      } else if (result.error) {
        showError(new Error(result.error), 'Knowledge Base Import');
      }
    } catch (error) {
      showError(error, 'Knowledge Base Import');
    }
  };

  const deleteKnowledgeBase = async () => {
    if (!deleteConfirm || deleteConfirm.confirmText.toLowerCase() !== 'delete') {
      return;
    }

    setIsDeleting(true);
    try {
      await window.electronAPI.invoke('kb:delete', deleteConfirm.kb.id);
      // Reload data
      await loadData();
      setDeleteConfirm(null);
    } catch (error) {
      showError(error, 'Failed to delete knowledge base');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="app loading">
        <div className="loading-spinner"></div>
        <p>Loading FSP's Study Tools...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        {/* Error Notification Container */}
        <ErrorNotificationContainer
          notifications={notifications}
          onDismiss={dismissNotification}
          onAction={handleNotificationAction}
          position="top-right"
        />

        {/* Header */}
        <header className="app-header">
        <div className="header-content">
          <h1>FSP's Study Tools</h1>
          <div className="header-actions">
            <button
              className="header-search-btn"
              onClick={() => setShowSearch(true)}
              title="Search Knowledge Base (Ctrl+K)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              Search
            </button>
          </div>
          <div className="header-meta">
            <span className="version">v{appVersion}</span>
            <span className="status">Development Mode</span>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="app-nav">
        <button
          className={currentView === 'home' ? 'active' : ''}
          onClick={() => setCurrentView('home')}
        >
          [Home]
        </button>
        <button
          className={currentView === 'dashboard' ? 'active' : ''}
          onClick={() => setCurrentView('dashboard')}
        >
          [Dashboard]
        </button>
        <button
          className={currentView === 'analytics' ? 'active' : ''}
          onClick={() => setCurrentView('analytics')}
        >
          [Analytics]
        </button>
        <button
          className={currentView === 'jasper' ? 'active' : ''}
          onClick={() => setCurrentView('jasper')}
        >
          [Jasper AI]
        </button>
        <button
          className={currentView === 'browse' ? 'active' : ''}
          onClick={() => setCurrentView('browse')}
        >
          [Browse KB]
        </button>
        <button
          className={currentView === 'study' ? 'active' : ''}
          onClick={() => setCurrentView('study')}
        >
          [Study]
        </button>
        <button
          className={currentView === 'editor' ? 'active' : ''}
          onClick={() => setCurrentView('editor')}
        >
          [Editor]
        </button>
        <button
          className={currentView === 'settings' ? 'active' : ''}
          onClick={() => setCurrentView('settings')}
        >
          [Settings]
        </button>
      </nav>

      {/* Main Content */}
      <main className="app-main">
        {currentView === 'home' && (
          <div className="view home-view">
            <h2>Welcome to FSP's Study Tools</h2>
            <p className="subtitle">AI-Powered Learning Platform</p>

            <div className="features-grid">
              <div className="feature-card">
                <h3>[Database]</h3>
                <p>SQLite with FTS5 Search</p>
                <span className="status-badge success">Ready</span>
              </div>

              <div className="feature-card">
                <h3>[AI Integration]</h3>
                <p>4 Provider Support</p>
                <span className="status-badge success">Ready</span>
              </div>

              <div className="feature-card">
                <h3>[Knowledge Base]</h3>
                <p>XML Parsing Engine</p>
                <span className="status-badge success">Ready</span>
              </div>

              <div className="feature-card">
                <h3>[UI/UX]</h3>
                <p>React Interface</p>
                <span className="status-badge active">Active</span>
              </div>
            </div>

            <div className="stats-section">
              <h3>Knowledge Bases</h3>
              <div className="stat-item">
                <span className="stat-label">Total:</span>
                <span className="stat-value">{knowledgeBases.length}</span>
              </div>
              {knowledgeBases.length === 0 && (
                <div className="empty-state">
                  <p>No knowledge bases imported yet.</p>
                  <button className="primary-button" onClick={getSampleXML}>
                    Get Sample XML
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === 'browse' && (
          viewingKB ? (
            <KBViewer
              kbId={viewingKB.id}
              kbTitle={viewingKB.title}
              onBack={() => setViewingKB(null)}
            />
          ) : (
            <div className="view browse-view">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0 }}>Knowledge Base Library</h2>
                <button className="primary-button" onClick={importKnowledgeBase}>
                  Import XML
                </button>
              </div>
              {knowledgeBases.length === 0 ? (
                <div className="empty-state">
                  <p>No knowledge bases available.</p>
                  <p>Import an XML file to get started.</p>
                  <button className="primary-button" onClick={getSampleXML}>
                    View Sample XML Format
                  </button>
                </div>
              ) : (
                <div className="kb-list">
                  {knowledgeBases.map(kb => (
                    <div
                      key={kb.id}
                      className="kb-card"
                      onClick={() => setViewingKB({ id: kb.id, title: kb.title })}
                    >
                      <button
                        className="kb-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm({ kb, confirmText: '' });
                        }}
                        title="Delete Knowledge Base"
                      >
                        X
                      </button>
                      <h3>{kb.title}</h3>
                      <div className="kb-meta">
                        <span>ID: {kb.id}</span>
                        <span>Created: {new Date(kb.created_at).toLocaleDateString()}</span>
                      </div>
                      {kb.metadata && (
                        <div className="kb-stats">
                          {kb.metadata.totalModules && (
                            <span>{kb.metadata.totalModules as number} modules</span>
                          )}
                          {kb.metadata.totalChapters && (
                            <span>{kb.metadata.totalChapters as number} chapters</span>
                          )}
                          {kb.metadata.totalSections && (
                            <span>{kb.metadata.totalSections as number} sections</span>
                          )}
                        </div>
                      )}
                      <p className="kb-card-hint">Click to read and study</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {currentView === 'dashboard' && (
          <Dashboard onNavigateToStudy={() => setCurrentView('study')} />
        )}

        {currentView === 'analytics' && (
          <AnalyticsDashboard
            onNavigateToStudy={(kbId?: number, sectionId?: string) => {
              if (kbId) setStudyKbId(kbId);
              if (sectionId) setStudySectionId(sectionId);
              setCurrentView('study');
            }}
            onNavigateToSettings={() => setCurrentView('settings')}
          />
        )}

        {currentView === 'jasper' && (
          <JasperChat
            knowledgeBases={jasperKBs}
            onNavigateToSource={(kbId: number, sectionId: string) => {
              setStudyKbId(kbId);
              setStudySectionId(sectionId);
              setCurrentView('study');
            }}
            onToggleKnowledgeBase={(kbId: number, enabled: boolean) => {
              setJasperKBs(prev =>
                prev.map(kb =>
                  kb.id === kbId ? { ...kb, enabled } : kb
                )
              );
            }}
          />
        )}

        {currentView === 'study' && (
          <StudySession
            onExit={() => {
              setCurrentView('home');
              setStudyKbId(null);
              setStudySectionId(null);
            }}
            initialKbId={studyKbId}
            initialSectionId={studySectionId}
            onNavigateToSettings={() => setCurrentView('settings')}
          />
        )}

        {currentView === 'editor' && (
          <div className="view editor-view">
            <KBEditor
              onSave={async (data) => {
                try {
                  console.log('[App.tsx] KBEditor onSave called');
                  console.log('[App.tsx] KBData:', JSON.stringify(data, null, 2));
                  console.log('[App.tsx] Module count:', data.modules?.length || 0);

                  // Generate UUID for new KB
                  const uuid = crypto.randomUUID();

                  // Convert KBData to XML format
                  const xmlContent = convertKBDataToXML(data, uuid);
                  console.log('[App.tsx] Generated XML length:', xmlContent.length);
                  console.log('[App.tsx] Generated XML (first 2000 chars):', xmlContent.substring(0, 2000));

                  // Calculate module/chapter/section counts
                  const totalModules = data.modules.length;
                  const totalChapters = data.modules.reduce(
                    (sum, m) => sum + m.chapters.length, 0
                  );
                  const totalSections = data.modules.reduce(
                    (sum, m) => sum + m.chapters.reduce(
                      (cSum, c) => cSum + c.sections.length, 0
                    ), 0
                  );

                  // Build metadata with counts
                  const metadata = {
                    ...data.metadata,
                    totalModules,
                    totalChapters,
                    totalSections,
                  };

                  // Save to database
                  await window.electronAPI.invoke('kb:create', {
                    uuid,
                    title: data.title,
                    xml_content: xmlContent,
                    metadata,
                  });

                  // Refresh the KB list
                  const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
                  setKnowledgeBases(kbs);

                  // Return to home view
                  setCurrentView('home');
                } catch (error) {
                  showError(error, 'Failed to save knowledge base');
                }
              }}
              onCancel={() => setCurrentView('home')}
            />
          </div>
        )}

        {currentView === 'settings' && (
          <div className="view settings-view">
            <div className="settings-header">
              <h2>Settings</h2>
              {settingsSaved && (
                <div className="settings-saved-indicator">
                  Settings saved successfully
                </div>
              )}
            </div>

            <div className="settings-section">
              <h3>Appearance</h3>
              <p className="settings-description">
                Customize the look and feel of the application.
              </p>

              <div className="setting-item">
                <label htmlFor="theme-select">
                  Theme
                  <span className="setting-status">
                    {settings.theme === 'auto' ? ' (System)' : settings.theme === 'light' ? ' (Light)' : ' (Dark)'}
                  </span>
                </label>
                <select
                  id="theme-select"
                  value={settings.theme || 'dark'}
                  onChange={(e) => handleSettingChange('theme', e.target.value)}
                  className="theme-select"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="auto">Auto (System)</option>
                </select>
                <span className="setting-hint">
                  Choose your preferred color theme. Auto follows your system settings.
                </span>
              </div>
            </div>

            <div className="settings-section">
              <h3>AI Providers</h3>
              <p className="settings-description">
                Configure AI provider API keys to enable AI-powered tutoring.
                Your API keys are stored securely and never leave your device.
                After entering an API key, click "Fetch Models" to validate and load available models.
              </p>

              {/* Default Provider Selection */}
              <div className="setting-item">
                <label htmlFor="default-provider">
                  Default AI Provider
                </label>
                <select
                  id="default-provider"
                  value={settings.default_ai_provider || ''}
                  onChange={(e) => handleSettingChange('default_ai_provider', e.target.value)}
                  className="provider-select"
                >
                  <option value="">Select a provider...</option>
                  {settings.openai_api_key && <option value="openai">OpenAI</option>}
                  {settings.anthropic_api_key && <option value="anthropic">Anthropic</option>}
                  {settings.google_api_key && <option value="google">Google AI</option>}
                  {settings.openrouter_api_key && <option value="openrouter">OpenRouter</option>}
                </select>
              </div>

              {/* OpenAI */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>OpenAI</h4>
                  <span className={`provider-status ${settings.openai_api_key && (settings.openai_models?.length || 0) > 0 ? 'valid' : settings.openai_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.openai_api_key && (settings.openai_models?.length || 0) > 0 ? '[Valid]' : settings.openai_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="openai-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="openai-key"
                      type="password"
                      placeholder="sk-..."
                      value={settings.openai_api_key || ''}
                      onChange={(e) => handleSettingChange('openai_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('openai')}
                      disabled={!settings.openai_api_key || fetchingModels.openai}
                    >
                      {fetchingModels.openai ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.openai && <span className="setting-error">{modelErrors.openai}</span>}
                  <span className="setting-hint">Get your API key from platform.openai.com</span>
                </div>
                {(settings.openai_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="openai-model">Model</label>
                    <select
                      id="openai-model"
                      value={settings.openai_model || ''}
                      onChange={(e) => handleModelChange('openai', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.openai_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="openai-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="openai-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., gpt-4o)"
                      value={customModelInputs.openai || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, openai: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('openai')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('openai')}
                      disabled={!customModelInputs.openai}
                    >
                      Use
                    </button>
                  </div>
                  {settings.openai_model && <span className="current-model">Current: {settings.openai_model}</span>}
                </div>
              </div>

              {/* Anthropic */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>Anthropic</h4>
                  <span className={`provider-status ${settings.anthropic_api_key && (settings.anthropic_models?.length || 0) > 0 ? 'valid' : settings.anthropic_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.anthropic_api_key && (settings.anthropic_models?.length || 0) > 0 ? '[Valid]' : settings.anthropic_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="anthropic-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="anthropic-key"
                      type="password"
                      placeholder="sk-ant-..."
                      value={settings.anthropic_api_key || ''}
                      onChange={(e) => handleSettingChange('anthropic_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('anthropic')}
                      disabled={!settings.anthropic_api_key || fetchingModels.anthropic}
                    >
                      {fetchingModels.anthropic ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.anthropic && <span className="setting-error">{modelErrors.anthropic}</span>}
                  <span className="setting-hint">Get your API key from console.anthropic.com</span>
                </div>
                {(settings.anthropic_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="anthropic-model">Model</label>
                    <select
                      id="anthropic-model"
                      value={settings.anthropic_model || ''}
                      onChange={(e) => handleModelChange('anthropic', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.anthropic_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="anthropic-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="anthropic-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., claude-3-5-sonnet-20241022)"
                      value={customModelInputs.anthropic || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, anthropic: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('anthropic')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('anthropic')}
                      disabled={!customModelInputs.anthropic}
                    >
                      Use
                    </button>
                  </div>
                  {settings.anthropic_model && <span className="current-model">Current: {settings.anthropic_model}</span>}
                </div>
              </div>

              {/* Google AI */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>Google AI</h4>
                  <span className={`provider-status ${settings.google_api_key && (settings.google_models?.length || 0) > 0 ? 'valid' : settings.google_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.google_api_key && (settings.google_models?.length || 0) > 0 ? '[Valid]' : settings.google_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="google-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="google-key"
                      type="password"
                      placeholder="AIza..."
                      value={settings.google_api_key || ''}
                      onChange={(e) => handleSettingChange('google_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('google')}
                      disabled={!settings.google_api_key || fetchingModels.google}
                    >
                      {fetchingModels.google ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.google && <span className="setting-error">{modelErrors.google}</span>}
                  <span className="setting-hint">Get your API key from makersuite.google.com</span>
                </div>
                {(settings.google_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="google-model">Model</label>
                    <select
                      id="google-model"
                      value={settings.google_model || ''}
                      onChange={(e) => handleModelChange('google', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.google_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="google-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="google-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., gemini-1.5-pro)"
                      value={customModelInputs.google || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, google: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('google')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('google')}
                      disabled={!customModelInputs.google}
                    >
                      Use
                    </button>
                  </div>
                  {settings.google_model && <span className="current-model">Current: {settings.google_model}</span>}
                </div>
              </div>

              {/* OpenRouter */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>OpenRouter</h4>
                  <span className={`provider-status ${settings.openrouter_api_key && (settings.openrouter_models?.length || 0) > 0 ? 'valid' : settings.openrouter_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.openrouter_api_key && (settings.openrouter_models?.length || 0) > 0 ? '[Valid]' : settings.openrouter_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="openrouter-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="openrouter-key"
                      type="password"
                      placeholder="sk-or-..."
                      value={settings.openrouter_api_key || ''}
                      onChange={(e) => handleSettingChange('openrouter_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('openrouter')}
                      disabled={!settings.openrouter_api_key || fetchingModels.openrouter}
                    >
                      {fetchingModels.openrouter ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.openrouter && <span className="setting-error">{modelErrors.openrouter}</span>}
                  <span className="setting-hint">Get your API key from openrouter.ai</span>
                </div>
                {(settings.openrouter_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="openrouter-model">Model</label>
                    <select
                      id="openrouter-model"
                      value={settings.openrouter_model || ''}
                      onChange={(e) => handleModelChange('openrouter', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.openrouter_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="openrouter-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="openrouter-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., openai/gpt-4)"
                      value={customModelInputs.openrouter || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, openrouter: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('openrouter')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('openrouter')}
                      disabled={!customModelInputs.openrouter}
                    >
                      Use
                    </button>
                  </div>
                  {settings.openrouter_model && <span className="current-model">Current: {settings.openrouter_model}</span>}
                </div>
              </div>
            </div>

            {/* AI Settings */}
            <div className="settings-section">
              <h3>AI Settings</h3>
              <div className="setting-item">
                <label htmlFor="temperature">
                  Temperature
                  <span className="setting-value">{settings.temperature ?? 0.7}</span>
                </label>
                <input
                  id="temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.temperature ?? 0.7}
                  onChange={(e) => handleSettingChange('temperature', parseFloat(e.target.value))}
                />
                <span className="setting-hint">Lower = more focused, Higher = more creative (0-2)</span>
              </div>
              <div className="setting-item">
                <label htmlFor="max-tokens">Max Tokens</label>
                <input
                  id="max-tokens"
                  type="number"
                  min="100"
                  max="8000"
                  step="100"
                  value={settings.max_tokens ?? 2000}
                  onChange={(e) => handleSettingChange('max_tokens', parseInt(e.target.value))}
                />
                <span className="setting-hint">Maximum response length (100-8000)</span>
              </div>
            </div>

            <div className="settings-actions">
              <button className="primary-button" onClick={saveSettings}>
                Save Settings
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>FSP's Study Tools - AI-Powered Learning</p>
        <p className="footer-meta">
          Phase 5: UI/UX Development | Database + AI + Knowledge Base Engine Complete
        </p>
      </footer>

      {/* Search Modal */}
      {showSearch && (
        <div className="search-modal-overlay" onClick={() => setShowSearch(false)}>
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <SearchResults
              onNavigateToSection={handleSearchNavigate}
              onClose={() => setShowSearch(false)}
            />
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="delete-modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Knowledge Base</h3>
            <p className="delete-warning">
              You are about to permanently delete:
            </p>
            <p className="delete-kb-name">"{deleteConfirm.kb.title}"</p>
            <p className="delete-instruction">
              This action cannot be undone. All associated progress, highlights, and test results will be deleted.
            </p>
            <p className="delete-confirm-instruction">
              Type <strong>delete</strong> to confirm:
            </p>
            <input
              type="text"
              className="delete-confirm-input"
              value={deleteConfirm.confirmText}
              onChange={(e) => setDeleteConfirm({ ...deleteConfirm, confirmText: e.target.value })}
              placeholder="Type 'delete' to confirm"
              autoFocus
            />
            <div className="delete-modal-actions">
              <button
                className="cancel-button"
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="delete-button"
                onClick={deleteKnowledgeBase}
                disabled={deleteConfirm.confirmText.toLowerCase() !== 'delete' || isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Now'}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* Update Notification */}
        <UpdateNotification />
      </div>
    </ErrorBoundary>
  );
}

export default App;
