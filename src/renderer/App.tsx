import React, { useState, useEffect } from 'react';
import './App.css';
import StudySession from './StudySession';

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

function App() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [appVersion, setAppVersion] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'browse' | 'study' | 'settings'>('home');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Get app version
      const version = await window.electronAPI.invoke('app:version') as string;
      setAppVersion(version);

      // Load knowledge bases
      const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
      setKnowledgeBases(kbs);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
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

        {currentView === 'study' && (
          <StudySession onExit={() => setCurrentView('home')} />
        )}

        {currentView === 'settings' && (
          <div className="view settings-view">
            <h2>Settings</h2>
            <div className="settings-section">
              <h3>AI Providers</h3>
              <p>Configure AI provider API keys and settings</p>
              <div className="setting-item">
                <label>OpenAI</label>
                <input type="password" placeholder="API Key" />
              </div>
              <div className="setting-item">
                <label>Anthropic</label>
                <input type="password" placeholder="API Key" />
              </div>
              <div className="setting-item">
                <label>Google AI</label>
                <input type="password" placeholder="API Key" />
              </div>
              <div className="setting-item">
                <label>OpenRouter</label>
                <input type="password" placeholder="API Key" />
              </div>
            </div>

            <div className="settings-section">
              <h3>Application</h3>
              <div className="setting-item">
                <label>Theme</label>
                <select>
                  <option>Dark</option>
                  <option>Light</option>
                  <option>Auto</option>
                </select>
              </div>
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
    </div>
  );
}

export default App;
