import React, { useState } from 'react';
import {
  LearningTechnique,
  TechniqueSettings,
  getAllTechniques,
  FULL_STACK_PROTOCOL,
  DEFAULT_TECHNIQUE_SETTINGS,
} from '../../shared/learning-types';
import './LearningTechniquesSettings.css';

interface LearningTechniquesSettingsProps {
  settings?: TechniqueSettings;
  onSave: (settings: TechniqueSettings) => void;
  onCancel?: () => void;
}

export function LearningTechniquesSettings({
  settings: initialSettings,
  onSave,
  onCancel,
}: LearningTechniquesSettingsProps): React.ReactElement {
  const [settings, setSettings] = useState<TechniqueSettings>(
    initialSettings || DEFAULT_TECHNIQUE_SETTINGS
  );
  const [activeTab, setActiveTab] = useState<'core' | 'emerging' | 'user' | 'protocol'>('core');

  const allTechniques = getAllTechniques();

  const toggleTechnique = (techniqueId: string) => {
    setSettings((prev) => {
      const enabled = prev.enabledTechniques.includes(techniqueId);
      return {
        ...prev,
        enabledTechniques: enabled
          ? prev.enabledTechniques.filter((id) => id !== techniqueId)
          : [...prev.enabledTechniques, techniqueId],
      };
    });
  };

  const renderTechnique = (technique: LearningTechnique) => {
    const isEnabled = settings.enabledTechniques.includes(technique.id);

    return (
      <div
        key={technique.id}
        className={`technique-card ${isEnabled ? 'enabled' : 'disabled'} ${technique.type}`}
      >
        <div className="technique-header">
          <label className="technique-toggle">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={() => toggleTechnique(technique.id)}
              disabled={technique.type === 'user'}
            />
            <span className="technique-name">{technique.name}</span>
          </label>
          <span className={`technique-type-badge ${technique.type}`}>
            {technique.type === 'program'
              ? '[Program]'
              : technique.type === 'user'
              ? '[User]'
              : '[Hybrid]'}
          </span>
        </div>

        <p className="technique-description">{technique.description}</p>

        {technique.researchBasis && (
          <div className="technique-research">
            <strong>Research:</strong> {technique.researchBasis}
          </div>
        )}

        {technique.implementation && (
          <div className="technique-implementation">
            <strong>How it works:</strong> {technique.implementation}
          </div>
        )}

        {technique.guidance && (
          <div className="technique-guidance">
            <strong>Guidance:</strong> {technique.guidance}
          </div>
        )}
      </div>
    );
  };

  const coreTechniques = allTechniques.filter((t) => t.category === 'core');
  const emergingTechniques = allTechniques.filter((t) => t.category === 'emerging');
  const userTechniques = allTechniques.filter((t) => t.category === 'user-implementable');

  return (
    <div className="learning-techniques-settings">
      <div className="settings-header">
        <h2>Learning Retention Techniques</h2>
        <p className="settings-subtitle">
          Configure evidence-based learning techniques to optimize your study sessions
        </p>
      </div>

      <div className="settings-tabs">
        <button
          className={activeTab === 'core' ? 'active' : ''}
          onClick={() => setActiveTab('core')}
        >
          Core Techniques ({coreTechniques.length})
        </button>
        <button
          className={activeTab === 'emerging' ? 'active' : ''}
          onClick={() => setActiveTab('emerging')}
        >
          Emerging Techniques ({emergingTechniques.length})
        </button>
        <button
          className={activeTab === 'user' ? 'active' : ''}
          onClick={() => setActiveTab('user')}
        >
          User Techniques ({userTechniques.length})
        </button>
        <button
          className={activeTab === 'protocol' ? 'active' : ''}
          onClick={() => setActiveTab('protocol')}
        >
          Full-Stack Protocol
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'core' && (
          <div className="techniques-section">
            <h3>Core Program-Integrated Techniques</h3>
            <p className="section-description">
              These techniques are automatically applied by the program during your study sessions.
            </p>
            <div className="techniques-grid">
              {coreTechniques.map(renderTechnique)}
            </div>
          </div>
        )}

        {activeTab === 'emerging' && (
          <div className="techniques-section">
            <h3>Emerging Program Techniques</h3>
            <p className="section-description">
              Newer techniques based on cutting-edge research. Some may be experimental.
            </p>
            <div className="techniques-grid">
              {emergingTechniques.map(renderTechnique)}
            </div>
          </div>
        )}

        {activeTab === 'user' && (
          <div className="techniques-section">
            <h3>User-Implementable Techniques</h3>
            <p className="section-description">
              Physical and environmental techniques you implement yourself. The program provides
              guidance but cannot automate these.
            </p>
            <div className="techniques-grid">
              {userTechniques.map(renderTechnique)}
            </div>
          </div>
        )}

        {activeTab === 'protocol' && (
          <div className="techniques-section">
            <h3>{FULL_STACK_PROTOCOL.name}</h3>
            <p className="section-description">
              A comprehensive learning session integrating multiple techniques for maximum effectiveness.
            </p>

            <div className="protocol-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={settings.useProtocol}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, useProtocol: e.target.checked }))
                  }
                />
                <span>Enable Full-Stack Protocol for study sessions</span>
              </label>
            </div>

            <div className="protocol-phases">
              {FULL_STACK_PROTOCOL.phases.map((phase) => (
                <div key={phase.name} className="protocol-phase">
                  <h4>{phase.name}</h4>
                  <div className="phase-timing">[{phase.timing.toUpperCase()}]</div>
                  <ul className="phase-techniques">
                    {phase.techniques.map((tech) => {
                      const technique = allTechniques.find((t) => t.id === tech.techniqueId);
                      return (
                        <li key={tech.techniqueId} className={tech.type}>
                          <span className={`type-indicator ${tech.type}`}>
                            {tech.type === 'program' ? '[P]' : tech.type === 'user' ? '[U]' : '[H]'}
                          </span>
                          <span className="technique-ref">{technique?.name || tech.techniqueId}</span>
                          {tech.notes && <span className="technique-notes">- {tech.notes}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="settings-general">
        <h3>Session Settings</h3>
        <div className="settings-row">
          <div className="setting-field">
            <label htmlFor="difficulty">Difficulty Level</label>
            <select
              id="difficulty"
              value={settings.difficultyLevel}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  difficultyLevel: e.target.value as 'beginner' | 'intermediate' | 'advanced',
                }))
              }
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div className="setting-field">
            <label htmlFor="session-duration">Session Duration (minutes)</label>
            <input
              id="session-duration"
              type="number"
              min="15"
              max="120"
              step="5"
              value={settings.sessionDuration}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  sessionDuration: parseInt(e.target.value) || 45,
                }))
              }
            />
          </div>

          <div className="setting-field">
            <label htmlFor="break-interval">Break Interval (minutes)</label>
            <input
              id="break-interval"
              type="number"
              min="5"
              max="30"
              step="5"
              value={settings.breakInterval}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  breakInterval: parseInt(e.target.value) || 15,
                }))
              }
            />
          </div>
        </div>
      </div>

      <div className="settings-actions">
        {onCancel && (
          <button className="cancel-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="save-btn" onClick={() => onSave(settings)}>
          Save Settings
        </button>
      </div>
    </div>
  );
}

export default LearningTechniquesSettings;
