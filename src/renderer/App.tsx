import React, { useState, useEffect } from 'react';
import './App.css';
import StudySession from './StudySession';
import KBEditor from './components/KBEditor';
import Dashboard from './components/Dashboard';
import SearchResults from './components/SearchResults';

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
  theme?: 'dark' | 'light' | 'auto';
}

// KB Editor data types
interface KBModule {
  id: string;
  title: string;
  order: number;
  chapters: KBChapter[];
}

interface KBChapter {
  id: string;
  title: string;
  order: number;
  sections: KBSection[];
}

interface KBSection {
  id: string;
  title: string;
  order: number;
  content: {
    text: string;
    files: { id: string; name: string; path: string; type: string }[];
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

// Convert KBData to XML format matching the knowledge base schema
function convertKBDataToXML(data: KBData): string {
  const now = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<knowledge_base version="1.0">
  <metadata>
    <title>${escapeXML(data.title)}</title>
    <created>${now}</created>
    <modified>${now}</modified>
    <author>${escapeXML(data.metadata.author || '')}</author>
    <description>${escapeXML(data.metadata.description || '')}</description>
    <version>${escapeXML(data.metadata.version || '1.0')}</version>
  </metadata>
  <structure>
`;

  // Add modules
  for (const module of data.modules) {
    xml += `    <module id="${escapeXML(module.id)}" title="${escapeXML(module.title)}">\n`;

    // Add chapters
    for (const chapter of module.chapters) {
      xml += `      <chapter id="${escapeXML(chapter.id)}" title="${escapeXML(chapter.title)}">\n`;

      // Add sections
      for (const section of chapter.sections) {
        xml += `        <section id="${escapeXML(section.id)}" title="${escapeXML(section.title)}">\n`;
        xml += `          <content>\n`;
        xml += `            <text>${escapeXML(section.content.text)}</text>\n`;

        // Add file references
        if (section.content.files.length > 0) {
          xml += `            <files>\n`;
          for (const file of section.content.files) {
            xml += `              <file id="${escapeXML(file.id)}" name="${escapeXML(file.name)}" path="${escapeXML(file.path)}" type="${escapeXML(file.type)}" />\n`;
          }
          xml += `            </files>\n`;
        }

        xml += `          </content>\n`;
        xml += `        </section>\n`;
      }

      xml += `      </chapter>\n`;
    }

    xml += `    </module>\n`;
  }

  xml += `  </structure>
</knowledge_base>`;

  return xml;
}

function App() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [appVersion, setAppVersion] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'browse' | 'study' | 'editor' | 'settings' | 'dashboard'>('home');
  const [settings, setSettings] = useState<AppSettings>({});
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [studyKbId, setStudyKbId] = useState<number | null>(null);
  const [studySectionId, setStudySectionId] = useState<string | null>(null);

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
      console.error('Failed to save settings:', error);
      alert(`Failed to save settings: ${(error as Error).message}`);
    }
  };

  const handleSettingChange = (key: keyof AppSettings, value: string) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
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
        alert(`Knowledge base imported successfully! ID: ${result.kbId}`);
        // Reload data
        await loadData();
      } else if (result.error) {
        alert(`Failed to import: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to import knowledge base:', error);
      alert(`Failed to import: ${(error as Error).message}`);
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
    <div className="app">
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
            <p className="subtitle">AI-Powered Aviation Training Platform</p>

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
          <div className="view browse-view">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Knowledge Base Browser</h2>
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
                  <div key={kb.id} className="kb-card">
                    <h3>{kb.title}</h3>
                    <div className="kb-meta">
                      <span>ID: {kb.id}</span>
                      <span>Created: {new Date(kb.created_at).toLocaleDateString()}</span>
                    </div>
                    {kb.metadata && (
                      <div className="kb-stats">
                        {kb.metadata.totalModules && (
                          <span>{kb.metadata.totalModules} modules</span>
                        )}
                        {kb.metadata.totalChapters && (
                          <span>{kb.metadata.totalChapters} chapters</span>
                        )}
                        {kb.metadata.totalSections && (
                          <span>{kb.metadata.totalSections} sections</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {currentView === 'dashboard' && (
          <Dashboard onNavigateToStudy={() => setCurrentView('study')} />
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
          />
        )}

        {currentView === 'editor' && (
          <div className="view editor-view">
            <KBEditor
              onSave={async (data) => {
                try {
                  // Convert KBData to XML format
                  const xmlContent = convertKBDataToXML(data);

                  // Generate UUID for new KB
                  const uuid = crypto.randomUUID();

                  // Save to database
                  await window.electronAPI.invoke('kb:create', {
                    uuid,
                    title: data.title,
                    xml_content: xmlContent,
                    metadata: data.metadata,
                  });

                  // Refresh the KB list
                  const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
                  setKnowledgeBases(kbs);

                  // Return to home view
                  setCurrentView('home');
                } catch (error) {
                  console.error('Failed to save KB:', error);
                  alert(`Failed to save: ${(error as Error).message}`);
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
              </p>

              <div className="setting-item">
                <label htmlFor="openai-key">
                  OpenAI API Key
                  <span className="setting-status">
                    {settings.openai_api_key ? ' (Configured)' : ' (Not configured)'}
                  </span>
                </label>
                <input
                  id="openai-key"
                  type="password"
                  placeholder="sk-..."
                  value={settings.openai_api_key || ''}
                  onChange={(e) => handleSettingChange('openai_api_key', e.target.value)}
                />
                <span className="setting-hint">
                  Get your API key from platform.openai.com
                </span>
              </div>

              <div className="setting-item">
                <label htmlFor="anthropic-key">
                  Anthropic API Key
                  <span className="setting-status">
                    {settings.anthropic_api_key ? ' (Configured)' : ' (Not configured)'}
                  </span>
                </label>
                <input
                  id="anthropic-key"
                  type="password"
                  placeholder="sk-ant-..."
                  value={settings.anthropic_api_key || ''}
                  onChange={(e) => handleSettingChange('anthropic_api_key', e.target.value)}
                />
                <span className="setting-hint">
                  Get your API key from console.anthropic.com
                </span>
              </div>

              <div className="setting-item">
                <label htmlFor="google-key">
                  Google AI API Key
                  <span className="setting-status">
                    {settings.google_api_key ? ' (Configured)' : ' (Not configured)'}
                  </span>
                </label>
                <input
                  id="google-key"
                  type="password"
                  placeholder="AIza..."
                  value={settings.google_api_key || ''}
                  onChange={(e) => handleSettingChange('google_api_key', e.target.value)}
                />
                <span className="setting-hint">
                  Get your API key from makersuite.google.com
                </span>
              </div>

              <div className="setting-item">
                <label htmlFor="openrouter-key">
                  OpenRouter API Key
                  <span className="setting-status">
                    {settings.openrouter_api_key ? ' (Configured)' : ' (Not configured)'}
                  </span>
                </label>
                <input
                  id="openrouter-key"
                  type="password"
                  placeholder="sk-or-..."
                  value={settings.openrouter_api_key || ''}
                  onChange={(e) => handleSettingChange('openrouter_api_key', e.target.value)}
                />
                <span className="setting-hint">
                  Get your API key from openrouter.ai
                </span>
              </div>
            </div>

            <div className="settings-section">
              <h3>Application</h3>
              <div className="setting-item">
                <label htmlFor="theme">Theme</label>
                <select
                  id="theme"
                  value={settings.theme || 'dark'}
                  onChange={(e) => handleSettingChange('theme', e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="auto">Auto</option>
                </select>
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
        <p>FSP's Study Tools - AI-Powered Aviation Training</p>
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
    </div>
  );
}

export default App;
