import React, { useState, useEffect, useCallback } from 'react';

interface KnowledgeBase {
  id: number;
  uuid: string;
  title: string;
  created_at: string;
  modified_at: string;
  metadata?: Record<string, unknown>;
}

interface ProgressStats {
  totalSections: number;
  completedSections: number;
  averageUserScore: number;
  averageAiScore: number;
  totalTimeSpent: number;
  completionPercentage: number;
}

interface KBStatistics {
  totalSections: number;
  totalChunks: number;
  totalCharacters: number;
  averageChunkSize: number;
  contentTypes: Record<string, number>;
}

interface StudyProgress {
  id: number;
  kb_id: number;
  section_id: string;
  user_score: number;
  ai_score: number;
  time_spent: number;
  last_viewed: string;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface DashboardProps {
  onNavigateToStudy: () => void;
}

function Dashboard({ onNavigateToStudy }: DashboardProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<number | null>(null);
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<StudyProgress[]>([]);
  const [needsReview, setNeedsReview] = useState<StudyProgress[]>([]);
  const [streak, setStreak] = useState<number>(0);
  const [velocity, setVelocity] = useState<number>(0);
  const [kbStats, setKbStats] = useState<KBStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadKnowledgeBases();
  }, []);

  useEffect(() => {
    if (selectedKB) {
      loadDashboardData(selectedKB);
    }
  }, [selectedKB]);

  const loadKnowledgeBases = async () => {
    try {
      const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
      setKnowledgeBases(kbs);
      if (kbs.length > 0) {
        setSelectedKB(kbs[0].id);
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to load KBs:', err);
      setError('Failed to load knowledge bases');
      setLoading(false);
    }
  };

  const loadDashboardData = useCallback(async (kbId: number) => {
    try {
      setLoading(true);
      setError(null);

      // Load all dashboard data in parallel (including KB statistics for accurate section counts)
      const [statsData, recentData, reviewData, streakData, velocityData, kbStatsData] = await Promise.all([
        window.electronAPI.invoke('progress:getStats', kbId) as Promise<ProgressStats>,
        window.electronAPI.invoke('progress:getRecent', kbId, 10) as Promise<StudyProgress[]>,
        window.electronAPI.invoke('progress:getNeedingReview', kbId, 0.7) as Promise<StudyProgress[]>,
        window.electronAPI.invoke('progress:getStreak', kbId) as Promise<number>,
        window.electronAPI.invoke('progress:getVelocity', kbId, 4) as Promise<number>,
        window.electronAPI.invoke('kb:getStatistics', kbId) as Promise<KBStatistics>,
      ]);

      setStats(statsData);
      setRecentActivity(recentData);
      setNeedsReview(reviewData);
      setStreak(streakData);
      setVelocity(velocityData);
      setKbStats(kbStatsData);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError('Failed to load progress data');
      setLoading(false);
    }
  }, []);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    // Check if date is valid
    if (isNaN(date.getTime())) return 'Unknown';
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const getScoreColor = (score: number): string => {
    if (score >= 0.8) return '#4ade80';
    if (score >= 0.6) return '#fbbf24';
    return '#ef4444';
  };

  // Calculate actual completion percentage based on KB total sections
  const actualCompletionPercentage = kbStats?.totalSections && kbStats.totalSections > 0
    ? ((stats?.completedSections || 0) / kbStats.totalSections) * 100
    : 0;

  if (loading && knowledgeBases.length === 0) {
    return (
      <div className="dashboard">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (knowledgeBases.length === 0) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty">
          <h2>Welcome to Your Learning Dashboard</h2>
          <p>No knowledge bases found. Import one to start tracking your progress!</p>
          <button className="primary-button" onClick={onNavigateToStudy}>
            Go to Study
          </button>
        </div>
      </div>
    );
  }

  const selectedKBData = knowledgeBases.find(kb => kb.id === selectedKB);

  return (
    <div className="dashboard">
      {error && (
        <div className="dashboard-error">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      <div className="dashboard-header">
        <h2>Learning Dashboard</h2>
        <div className="kb-selector">
          <label htmlFor="kb-select">Knowledge Base:</label>
          <select
            id="kb-select"
            value={selectedKB || ''}
            onChange={(e) => setSelectedKB(Number(e.target.value))}
          >
            {knowledgeBases.map(kb => (
              <option key={kb.id} value={kb.id}>{kb.title}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="dashboard-loading">
          <div className="loading-spinner"></div>
        </div>
      ) : (
        <>
          {/* Stats Overview Cards */}
          <div className="stats-cards">
            <div className="stat-card">
              <div className="stat-icon completion-icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <div className="stat-content">
                <span className="stat-value">{actualCompletionPercentage.toFixed(0)}%</span>
                <span className="stat-label">Completion</span>
              </div>
              <div className="stat-progress">
                <div
                  className="stat-progress-fill"
                  style={{ width: `${actualCompletionPercentage}%` }}
                ></div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon score-icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
              <div className="stat-content">
                <span className="stat-value" style={{ color: getScoreColor(stats?.averageUserScore || 0) }}>
                  {((stats?.averageUserScore || 0) * 100).toFixed(0)}%
                </span>
                <span className="stat-label">Avg Score</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon time-icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="stat-content">
                <span className="stat-value">{formatTime(stats?.totalTimeSpent || 0)}</span>
                <span className="stat-label">Time Studied</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon streak-icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  <path d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
                </svg>
              </div>
              <div className="stat-content">
                <span className="stat-value">{streak}</span>
                <span className="stat-label">Day Streak</span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="quick-actions">
            <button className="action-button primary" onClick={onNavigateToStudy}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Continue Studying
            </button>
            <button className="action-button secondary" onClick={() => loadDashboardData(selectedKB!)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          <div className="dashboard-grid">
            {/* Learning Velocity */}
            <div className="dashboard-card velocity-card">
              <h3>Learning Velocity</h3>
              <div className="velocity-display">
                <span className="velocity-value">{velocity.toFixed(1)}</span>
                <span className="velocity-unit">sections/week</span>
              </div>
              <p className="velocity-context">
                {velocity > 5 ? 'Great pace! Keep it up!' :
                 velocity > 2 ? 'Good progress. Stay consistent!' :
                 velocity > 0 ? 'Getting started. Study more to improve!' :
                 'No recent activity. Time to study!'}
              </p>
            </div>

            {/* Sections Summary */}
            <div className="dashboard-card sections-card">
              <h3>Progress Summary</h3>
              <div className="sections-summary">
                <div className="summary-item">
                  <span className="summary-value">{stats?.completedSections || 0}</span>
                  <span className="summary-label">Completed</span>
                </div>
                <div className="summary-divider"></div>
                <div className="summary-item">
                  <span className="summary-value">{(kbStats?.totalSections || 0) - (stats?.completedSections || 0)}</span>
                  <span className="summary-label">Remaining</span>
                </div>
                <div className="summary-divider"></div>
                <div className="summary-item">
                  <span className="summary-value">{needsReview.length}</span>
                  <span className="summary-label">Need Review</span>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="dashboard-card activity-card">
              <h3>Recent Activity</h3>
              {recentActivity.length === 0 ? (
                <p className="no-activity">No recent study activity</p>
              ) : (
                <ul className="activity-list">
                  {recentActivity.slice(0, 5).map((item, index) => (
                    <li key={index} className="activity-item">
                      <div className="activity-info">
                        <span className="activity-section">{item.section_id}</span>
                        <span className="activity-time">{formatDate(item.last_viewed)}</span>
                      </div>
                      <div className="activity-score" style={{ color: getScoreColor(item.user_score) }}>
                        {(item.user_score * 100).toFixed(0)}%
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Needs Review */}
            <div className="dashboard-card review-card">
              <h3>Needs Review</h3>
              {needsReview.length === 0 ? (
                <p className="no-review">All caught up! No sections need review.</p>
              ) : (
                <ul className="review-list">
                  {needsReview.slice(0, 5).map((item, index) => (
                    <li key={index} className="review-item">
                      <span className="review-section">{item.section_id}</span>
                      <span className="review-score" style={{ color: getScoreColor(item.user_score) }}>
                        {(item.user_score * 100).toFixed(0)}%
                      </span>
                    </li>
                  ))}
                  {needsReview.length > 5 && (
                    <li className="review-more">+{needsReview.length - 5} more sections</li>
                  )}
                </ul>
              )}
            </div>
          </div>

          {/* Selected KB Info */}
          {selectedKBData && (
            <div className="kb-info-footer">
              <span className="kb-title">{selectedKBData.title}</span>
              <span className="kb-updated">Last updated: {formatDate(selectedKBData.modified_at)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Dashboard;
