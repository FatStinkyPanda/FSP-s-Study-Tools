/**
 * AnalyticsDashboard Component
 *
 * Comprehensive analytics dashboard with visualizations for learning progress,
 * study patterns, performance trends, and recommendations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ProgressChart, BarChart, LineChart, HeatmapChart, PieChart } from './charts';
import './AnalyticsDashboard.css';

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

interface LearningRecommendation {
  type: 'next_section' | 'review' | 'test' | 'break' | 'new_topic';
  priority: 'high' | 'medium' | 'low';
  sectionId?: string;
  title: string;
  description: string;
  estimatedTime: number;
  reason: string;
  confidence: number;
}

interface LearningInsights {
  studyPatterns: {
    preferredTimeOfDay: string;
    averageSessionDuration: number;
    mostProductiveDay: string;
    studyFrequency: number;
  };
  performanceTrends: {
    improving: boolean;
    averageScoreChange: number;
    strongTopics: string[];
    weakTopics: string[];
  };
  recommendations: string[];
}

interface TimeDistribution {
  hour: number;
  minutes: number;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface AnalyticsDashboardProps {
  onNavigateToStudy: (kbId?: number, sectionId?: string) => void;
  onNavigateToSettings: () => void;
}

function AnalyticsDashboard({ onNavigateToStudy, onNavigateToSettings }: AnalyticsDashboardProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<number | null>(null);
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [kbStats, setKbStats] = useState<KBStatistics | null>(null);
  const [recentActivity, setRecentActivity] = useState<StudyProgress[]>([]);
  const [recommendations, setRecommendations] = useState<LearningRecommendation[]>([]);
  const [insights, setInsights] = useState<LearningInsights | null>(null);
  const [timeDistribution, setTimeDistribution] = useState<TimeDistribution[]>([]);
  const [streak, setStreak] = useState<number>(0);
  const [velocity, setVelocity] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'insights' | 'recommendations'>('overview');

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
      const kbs = (await window.electronAPI.invoke('kb:list')) as KnowledgeBase[];
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

      // Load all dashboard data in parallel
      const [
        statsData,
        kbStatsData,
        recentData,
        streakData,
        velocityData,
        timeDistData,
        recommendationsData,
        insightsData,
      ] = await Promise.all([
        window.electronAPI.invoke('progress:getStats', kbId) as Promise<ProgressStats>,
        window.electronAPI.invoke('kb:getStatistics', kbId) as Promise<KBStatistics>,
        window.electronAPI.invoke('progress:getRecent', kbId, 50) as Promise<StudyProgress[]>,
        window.electronAPI.invoke('progress:getStreak', kbId) as Promise<number>,
        window.electronAPI.invoke('progress:getVelocity', kbId, 4) as Promise<number>,
        window.electronAPI.invoke('progress:getTimeDistribution', kbId) as Promise<TimeDistribution[]>,
        window.electronAPI.invoke('recommend:getRecommendations', kbId, 5).catch(() => []) as Promise<LearningRecommendation[]>,
        window.electronAPI.invoke('recommend:analyzeLearning', kbId).catch(() => null) as Promise<LearningInsights | null>,
      ]);

      setStats(statsData);
      setKbStats(kbStatsData);
      setRecentActivity(recentData);
      setStreak(streakData);
      setVelocity(velocityData);
      setTimeDistribution(timeDistData);
      setRecommendations(recommendationsData);
      setInsights(insightsData);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError('Failed to load analytics data');
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
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getScoreColor = (score: number): string => {
    if (score >= 0.8) return '#4ade80';
    if (score >= 0.6) return '#fbbf24';
    return '#ef4444';
  };

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'high':
        return '#ef4444';
      case 'medium':
        return '#fbbf24';
      default:
        return '#4ade80';
    }
  };

  const getRecommendationIcon = (type: string): string => {
    switch (type) {
      case 'next_section':
        return 'M9 5l7 7-7 7';
      case 'review':
        return 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15';
      case 'test':
        return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'break':
        return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'new_topic':
        return 'M12 4v16m8-8H4';
      default:
        return 'M13 10V3L4 14h7v7l9-11h-7z';
    }
  };

  // Calculate actual completion percentage based on KB total sections
  const completionPercentage =
    kbStats?.totalSections && kbStats.totalSections > 0
      ? ((stats?.completedSections || 0) / kbStats.totalSections) * 100
      : 0;

  // Prepare chart data
  const getScoreDistribution = () => {
    if (recentActivity.length === 0) return [];
    const ranges = [
      { label: '0-20%', min: 0, max: 0.2, count: 0, color: '#ef4444' },
      { label: '21-40%', min: 0.2, max: 0.4, count: 0, color: '#f97316' },
      { label: '41-60%', min: 0.4, max: 0.6, count: 0, color: '#fbbf24' },
      { label: '61-80%', min: 0.6, max: 0.8, count: 0, color: '#84cc16' },
      { label: '81-100%', min: 0.8, max: 1.01, count: 0, color: '#4ade80' },
    ];
    recentActivity.forEach((item) => {
      const range = ranges.find((r) => item.user_score >= r.min && item.user_score < r.max);
      if (range) range.count++;
    });
    return ranges.map((r) => ({ label: r.label, value: r.count, color: r.color }));
  };

  const getStudyTrend = () => {
    if (recentActivity.length === 0) return [];
    // Group by date
    const byDate = new Map<string, { total: number; count: number }>();
    recentActivity.forEach((item) => {
      const date = formatDate(item.last_viewed);
      const existing = byDate.get(date) || { total: 0, count: 0 };
      existing.total += item.user_score;
      existing.count++;
      byDate.set(date, existing);
    });
    return Array.from(byDate.entries())
      .slice(-10)
      .map(([date, data]) => ({
        x: date,
        y: Math.round((data.total / data.count) * 100),
      }));
  };

  const getActivityHeatmap = () => {
    // Count sessions per day from recent activity
    const dayCounts = new Map<string, number>();
    recentActivity.forEach((item) => {
      const dateKey = new Date(item.last_viewed).toISOString().split('T')[0];
      dayCounts.set(dateKey, (dayCounts.get(dateKey) || 0) + 1);
    });
    return Array.from(dayCounts.entries()).map(([date, value]) => ({ date, value }));
  };

  const getTimeDistributionData = () => {
    if (timeDistribution.length === 0) return [];
    return timeDistribution.map((t) => ({
      label: `${t.hour}:00`,
      value: Math.round(t.minutes),
      color: t.minutes > 30 ? '#4ade80' : t.minutes > 10 ? '#fbbf24' : '#64748b',
    }));
  };

  if (loading && knowledgeBases.length === 0) {
    return (
      <div className="analytics-dashboard">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (knowledgeBases.length === 0) {
    return (
      <div className="analytics-dashboard">
        <div className="analytics-empty">
          <h2>No Data Available</h2>
          <p>Import a knowledge base and start studying to see your analytics!</p>
          <button className="primary-button" onClick={() => onNavigateToStudy()}>
            Go to Study
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-dashboard">
      {error && (
        <div className="analytics-error">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      {/* Header */}
      <div className="analytics-header">
        <div className="analytics-title-section">
          <h2>Learning Analytics</h2>
          <p className="analytics-subtitle">Track your progress and optimize your learning</p>
        </div>
        <div className="analytics-controls">
          <select
            value={selectedKB || ''}
            onChange={(e) => setSelectedKB(Number(e.target.value))}
            className="kb-selector"
          >
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.title}
              </option>
            ))}
          </select>
          <button className="refresh-button" onClick={() => selectedKB && loadDashboardData(selectedKB)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="analytics-tabs">
        <button
          className={`analytics-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`analytics-tab ${activeTab === 'performance' ? 'active' : ''}`}
          onClick={() => setActiveTab('performance')}
        >
          Performance
        </button>
        <button
          className={`analytics-tab ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => setActiveTab('insights')}
        >
          Insights
        </button>
        <button
          className={`analytics-tab ${activeTab === 'recommendations' ? 'active' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          Recommendations
        </button>
      </div>

      {loading ? (
        <div className="analytics-loading">
          <div className="loading-spinner"></div>
        </div>
      ) : (
        <div className="analytics-content">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Key Metrics Row */}
              <div className="metrics-row">
                <div className="metric-card">
                  <ProgressChart
                    percentage={completionPercentage}
                    size={100}
                    primaryColor="#4ade80"
                    label="Completion"
                  />
                </div>
                <div className="metric-card">
                  <div className="metric-icon streak">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                    </svg>
                  </div>
                  <div className="metric-value">{streak}</div>
                  <div className="metric-label">Day Streak</div>
                </div>
                <div className="metric-card">
                  <div className="metric-icon velocity">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="metric-value">{velocity.toFixed(1)}</div>
                  <div className="metric-label">Sections/Week</div>
                </div>
                <div className="metric-card">
                  <div className="metric-icon time">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="metric-value">{formatTime(stats?.totalTimeSpent || 0)}</div>
                  <div className="metric-label">Total Study Time</div>
                </div>
              </div>

              {/* Charts Row */}
              <div className="charts-row">
                <div className="chart-card">
                  <h3>Study Activity</h3>
                  <HeatmapChart data={getActivityHeatmap()} weeks={15} />
                </div>
              </div>

              <div className="charts-row two-column">
                <div className="chart-card">
                  <h3>Score Distribution</h3>
                  <BarChart data={getScoreDistribution()} height={180} />
                </div>
                <div className="chart-card">
                  <h3>Progress Summary</h3>
                  <div className="progress-summary">
                    <div className="summary-stat">
                      <span className="stat-number">{stats?.completedSections || 0}</span>
                      <span className="stat-label">Completed</span>
                    </div>
                    <div className="summary-divider" />
                    <div className="summary-stat">
                      <span className="stat-number">
                        {(kbStats?.totalSections || 0) - (stats?.completedSections || 0)}
                      </span>
                      <span className="stat-label">Remaining</span>
                    </div>
                    <div className="summary-divider" />
                    <div className="summary-stat">
                      <span className="stat-number" style={{ color: getScoreColor(stats?.averageUserScore || 0) }}>
                        {((stats?.averageUserScore || 0) * 100).toFixed(0)}%
                      </span>
                      <span className="stat-label">Avg Score</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Performance Tab */}
          {activeTab === 'performance' && (
            <>
              <div className="charts-row">
                <div className="chart-card full-width">
                  <h3>Score Trend Over Time</h3>
                  <LineChart
                    series={[{ name: 'Score', data: getStudyTrend(), color: '#4ade80' }]}
                    height={220}
                    showArea={true}
                    yAxisMin={0}
                    yAxisMax={100}
                  />
                </div>
              </div>

              <div className="charts-row two-column">
                <div className="chart-card">
                  <h3>Study Time by Hour</h3>
                  <BarChart data={getTimeDistributionData()} height={200} />
                </div>
                <div className="chart-card">
                  <h3>Score Comparison</h3>
                  <div className="score-comparison">
                    <div className="score-item">
                      <span className="score-label">Your Score</span>
                      <div className="score-bar-container">
                        <div
                          className="score-bar"
                          style={{
                            width: `${(stats?.averageUserScore || 0) * 100}%`,
                            backgroundColor: getScoreColor(stats?.averageUserScore || 0),
                          }}
                        />
                      </div>
                      <span className="score-value">{((stats?.averageUserScore || 0) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="score-item">
                      <span className="score-label">AI Assessment</span>
                      <div className="score-bar-container">
                        <div
                          className="score-bar"
                          style={{
                            width: `${(stats?.averageAiScore || 0) * 100}%`,
                            backgroundColor: getScoreColor(stats?.averageAiScore || 0),
                          }}
                        />
                      </div>
                      <span className="score-value">{((stats?.averageAiScore || 0) * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Activity Table */}
              <div className="analytics-card">
                <h3>Recent Study Sessions</h3>
                {recentActivity.length === 0 ? (
                  <p className="no-data">No study sessions recorded yet</p>
                ) : (
                  <div className="activity-table">
                    <div className="table-header">
                      <span>Section</span>
                      <span>Score</span>
                      <span>Time</span>
                      <span>Date</span>
                    </div>
                    {recentActivity.slice(0, 10).map((item, index) => (
                      <div key={index} className="table-row">
                        <span className="section-name">{item.section_id}</span>
                        <span className="score" style={{ color: getScoreColor(item.user_score) }}>
                          {(item.user_score * 100).toFixed(0)}%
                        </span>
                        <span className="time">{formatTime(item.time_spent)}</span>
                        <span className="date">{formatDate(item.last_viewed)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Insights Tab */}
          {activeTab === 'insights' && (
            <>
              {insights ? (
                <>
                  <div className="insights-grid">
                    <div className="insight-card">
                      <h3>Study Patterns</h3>
                      <div className="insight-items">
                        <div className="insight-item">
                          <span className="insight-label">Preferred Time</span>
                          <span className="insight-value">{insights.studyPatterns.preferredTimeOfDay}</span>
                        </div>
                        <div className="insight-item">
                          <span className="insight-label">Avg Session</span>
                          <span className="insight-value">
                            {formatTime(insights.studyPatterns.averageSessionDuration)}
                          </span>
                        </div>
                        <div className="insight-item">
                          <span className="insight-label">Most Productive Day</span>
                          <span className="insight-value">{insights.studyPatterns.mostProductiveDay}</span>
                        </div>
                        <div className="insight-item">
                          <span className="insight-label">Weekly Frequency</span>
                          <span className="insight-value">
                            {insights.studyPatterns.studyFrequency.toFixed(1)} sessions
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="insight-card">
                      <h3>Performance Trends</h3>
                      <div className="trend-indicator">
                        <span
                          className={`trend-arrow ${insights.performanceTrends.improving ? 'up' : 'down'}`}
                        >
                          {insights.performanceTrends.improving ? '↑' : '↓'}
                        </span>
                        <span className="trend-text">
                          {insights.performanceTrends.improving
                            ? 'Your performance is improving!'
                            : 'Focus on weaker topics'}
                        </span>
                      </div>
                      <div className="insight-items">
                        <div className="insight-item">
                          <span className="insight-label">Score Change</span>
                          <span
                            className="insight-value"
                            style={{
                              color: insights.performanceTrends.averageScoreChange >= 0 ? '#4ade80' : '#ef4444',
                            }}
                          >
                            {insights.performanceTrends.averageScoreChange >= 0 ? '+' : ''}
                            {(insights.performanceTrends.averageScoreChange * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="charts-row two-column">
                    <div className="analytics-card">
                      <h3>Strong Topics</h3>
                      {insights.performanceTrends.strongTopics.length > 0 ? (
                        <ul className="topic-list strong">
                          {insights.performanceTrends.strongTopics.map((topic, i) => (
                            <li key={i}>{topic}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="no-data">Keep studying to identify your strengths!</p>
                      )}
                    </div>
                    <div className="analytics-card">
                      <h3>Topics to Review</h3>
                      {insights.performanceTrends.weakTopics.length > 0 ? (
                        <ul className="topic-list weak">
                          {insights.performanceTrends.weakTopics.map((topic, i) => (
                            <li key={i}>{topic}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="no-data">Great job! No weak topics identified.</p>
                      )}
                    </div>
                  </div>

                  {insights.recommendations.length > 0 && (
                    <div className="analytics-card">
                      <h3>AI-Powered Suggestions</h3>
                      <ul className="suggestions-list">
                        {insights.recommendations.map((rec, i) => (
                          <li key={i}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="analytics-empty">
                  <p>Study more sections to unlock learning insights!</p>
                  <button className="primary-button" onClick={() => onNavigateToStudy(selectedKB || undefined)}>
                    Start Studying
                  </button>
                </div>
              )}
            </>
          )}

          {/* Recommendations Tab */}
          {activeTab === 'recommendations' && (
            <>
              {recommendations.length > 0 ? (
                <div className="recommendations-list">
                  {recommendations.map((rec, index) => (
                    <div key={index} className="recommendation-card">
                      <div className="recommendation-header">
                        <div className="recommendation-icon" style={{ color: getPriorityColor(rec.priority) }}>
                          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d={getRecommendationIcon(rec.type)} />
                          </svg>
                        </div>
                        <div className="recommendation-info">
                          <h4>{rec.title}</h4>
                          <span className="recommendation-type">{rec.type.replace('_', ' ')}</span>
                        </div>
                        <div className="recommendation-meta">
                          <span className={`priority-badge ${rec.priority}`}>{rec.priority}</span>
                          <span className="time-estimate">{rec.estimatedTime} min</span>
                        </div>
                      </div>
                      <p className="recommendation-description">{rec.description}</p>
                      <p className="recommendation-reason">{rec.reason}</p>
                      <div className="recommendation-footer">
                        <div className="confidence-bar">
                          <div
                            className="confidence-fill"
                            style={{ width: `${rec.confidence * 100}%` }}
                          />
                        </div>
                        <span className="confidence-label">
                          {(rec.confidence * 100).toFixed(0)}% confidence
                        </span>
                        {rec.sectionId && (
                          <button
                            className="action-button"
                            onClick={() => onNavigateToStudy(selectedKB || undefined, rec.sectionId)}
                          >
                            Start
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="analytics-empty">
                  <p>Study some sections to get personalized recommendations!</p>
                  <button className="primary-button" onClick={() => onNavigateToStudy(selectedKB || undefined)}>
                    Start Studying
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default AnalyticsDashboard;
