import React, { useState, useEffect, useCallback } from 'react';
import ChatPanel from './ChatPanel';
import KBViewer from './components/KBViewer';
import TestConfiguration, { TestConfig } from './components/TestConfiguration';
import './components/TestConfiguration.css';

interface Question {
  id: string;
  type: string;
  question: string;
  options?: string[] | Record<string, string>;
  correctAnswer?: string;
  explanation?: string;
  difficulty?: string;
  tags?: string[];
  sectionId?: string;
}

interface GeneratedQuestion {
  id: string;
  question: string;
  type: string;
  correctAnswer: string;
  options: Record<string, string>;
  sectionId: string;
  explanation?: string;
}

interface ErrorState {
  message: string;
  type: 'error' | 'warning' | 'info';
}

interface KnowledgeBase {
  id: number;
  uuid: string;
  title: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

interface UserProgress {
  totalSections: number;
  completedSections: number;
  averageScore: number;
  studyStreak: number;
  sectionsNeedingReview: number;
}

interface StudySessionProps {
  onExit: () => void;
  initialKbId?: number | null;
  initialSectionId?: string | null;
  onNavigateToSettings?: () => void;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

function StudySession({ onExit, initialKbId, initialSectionId, onNavigateToSettings }: StudySessionProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<number | null>(initialKbId || null);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(initialSectionId || null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [answeredQuestions, setAnsweredQuestions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number>(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [userProgress, setUserProgress] = useState<UserProgress | null>(null);
  const [currentSectionContent, setCurrentSectionContent] = useState<string>('');
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [viewingKB, setViewingKB] = useState<{ id: number; title: string } | null>(null);
  const [configuringTest, setConfiguringTest] = useState<{ id: number; title: string } | null>(null);

  useEffect(() => {
    loadKnowledgeBases();
    checkAIConfiguration();
  }, []);

  const checkAIConfiguration = async () => {
    try {
      const settings = await window.electronAPI.invoke('settings:getAll') as {
        default_ai_provider?: string;
        openai_api_key?: string;
        anthropic_api_key?: string;
        google_api_key?: string;
        openrouter_api_key?: string;
      };

      // Check if any provider has API key set
      const hasAnyKey = !!(
        settings.openai_api_key ||
        settings.anthropic_api_key ||
        settings.google_api_key ||
        settings.openrouter_api_key
      );

      // Check if default provider is set and has a key
      const defaultProvider = settings.default_ai_provider;
      const hasDefaultProviderKey = defaultProvider && settings[`${defaultProvider}_api_key` as keyof typeof settings];

      setAiConfigured(hasAnyKey && !!hasDefaultProviderKey);
    } catch (err) {
      console.error('Failed to check AI configuration:', err);
      setAiConfigured(false);
    }
  };

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (showResult && e.key === 'Enter') {
        nextQuestion();
      } else if (!showResult && selectedAnswer && e.key === 'Enter') {
        submitAnswer();
      } else if (e.key >= '1' && e.key <= '4' && currentQuestion?.options) {
        const index = parseInt(e.key) - 1;
        if (index < currentQuestion.options.length && !showResult) {
          handleAnswerSelect(currentQuestion.options[index]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [showResult, selectedAnswer, currentQuestionIndex]);

  const showError = useCallback((message: string, type: 'error' | 'warning' | 'info' = 'error') => {
    setError({ message, type });
  }, []);

  const loadKnowledgeBases = async () => {
    try {
      const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
      setKnowledgeBases(kbs);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load knowledge bases:', error);
      showError('Failed to load knowledge bases. Please try again.');
      setLoading(false);
    }
  };

  const fetchUserProgress = async (kbId: number) => {
    try {
      // Get all progress stats
      const [stats, streak, needingReview] = await Promise.all([
        window.electronAPI.invoke('progress:getStats', kbId) as Promise<{
          total_sections: number;
          completed_sections: number;
          average_score: number;
        }>,
        window.electronAPI.invoke('progress:getStreak') as Promise<number>,
        window.electronAPI.invoke('progress:getNeedingReview', kbId, 7) as Promise<Array<unknown>>
      ]);

      setUserProgress({
        totalSections: stats.total_sections || 0,
        completedSections: stats.completed_sections || 0,
        averageScore: stats.average_score || 0,
        studyStreak: streak || 0,
        sectionsNeedingReview: (needingReview || []).length
      });
    } catch (error) {
      console.error('Failed to fetch user progress:', error);
      // Don't block the session, just continue without progress context
    }
  };

  const startSession = async (kbId: number) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedKB(kbId);
      setSessionStartTime(Date.now());

      // First, try to get existing practice tests for this KB
      let allQuestions: Question[] = [];

      try {
        const tests = await window.electronAPI.invoke('test:getAll', kbId) as Array<{
          questions: string;
        }>;

        // Extract questions from existing tests
        for (const test of tests) {
          try {
            const testQuestions = JSON.parse(test.questions) as Question[];
            allQuestions.push(...testQuestions);
          } catch {
            // Skip invalid questions
          }
        }
      } catch {
        // No tests found, continue to try parsing KB
      }

      // If no test questions, try to parse KB for embedded questions
      if (allQuestions.length === 0) {
        try {
          const parsed = await window.electronAPI.invoke('kb:parse', kbId) as {
            modules: Array<{
              chapters: Array<{
                sections: Array<{
                  questions?: Question[];
                  id: string;
                  title: string;
                  content?: { text?: string };
                }>;
              }>;
            }>;
          };

          // Extract any embedded questions
          for (const module of parsed.modules) {
            for (const chapter of module.chapters) {
              for (const section of chapter.sections) {
                if (section.questions && section.questions.length > 0) {
                  allQuestions.push(...section.questions);
                }
              }
            }
          }

          // If still no questions, automatically generate AI questions
          if (allQuestions.length === 0) {
            // Check if there's content worth generating questions from
            let hasContent = false;
            for (const module of parsed.modules) {
              for (const chapter of module.chapters) {
                for (const section of chapter.sections) {
                  const content = section.content?.text || '';
                  if (content.trim().length > 50) {
                    hasContent = true;
                    break;
                  }
                }
                if (hasContent) break;
              }
              if (hasContent) break;
            }

            if (hasContent) {
              // Try to generate AI questions automatically
              try {
                setLoading(false); // Switch from loading to generating state
                setIsGenerating(true);
                setGenerationProgress('Generating questions with AI...');

                const generatedQuestions = await window.electronAPI.invoke('test:generateQuestions', {
                  kbId,
                  questionsPerSection: 3,
                  difficulty: 'medium',
                }) as GeneratedQuestion[];

                if (generatedQuestions && generatedQuestions.length > 0) {
                  setGenerationProgress('Saving practice test...');

                  // Save as a new practice test for future use
                  await window.electronAPI.invoke('test:create', {
                    kbId,
                    title: `AI Generated Test - ${new Date().toLocaleDateString()}`,
                    type: 'ai_generated',
                    questions: generatedQuestions,
                  });

                  // Convert generated questions to the Question format
                  allQuestions = generatedQuestions.map((q, index) => ({
                    id: `gen_${index}`,
                    type: q.type || 'multiple_choice',
                    question: q.question,
                    options: q.options,
                    correctAnswer: q.correctAnswer,
                    explanation: q.explanation || '',
                    difficulty: q.difficulty || 'medium',
                    tags: q.tags || [],
                  }));

                  showError(`Generated ${allQuestions.length} AI questions!`, 'info');
                }

                setIsGenerating(false);
                setGenerationProgress('');
              } catch (genError) {
                setIsGenerating(false);
                setGenerationProgress('');
                // Show a specific error message
                showError(`AI generation failed: ${(genError as Error).message}. Check Settings for AI configuration.`, 'warning');
              }
            }
          }
        } catch {
          // KB parsing failed, continue without embedded questions
        }
      }

      if (allQuestions.length === 0) {
        // Show a helpful message - no content or AI generation failed
        showError('No questions available. Make sure the knowledge base has content and an AI provider is configured in Settings.', 'warning');
        setSelectedKB(null);
        setLoading(false);
        return;
      }

      // Shuffle questions
      const shuffled = allQuestions.sort(() => Math.random() - 0.5);

      setQuestions(shuffled);
      setCurrentQuestionIndex(0);
      setScore(0);
      setAnsweredQuestions(0);
      setLoading(false);

      // Fetch user progress for context-aware AI tutoring
      fetchUserProgress(kbId);

      showError(`Session started with ${shuffled.length} questions!`, 'info');
    } catch (error) {
      console.error('Failed to start session:', error);
      showError(`Failed to start session: ${(error as Error).message}`);
      setSelectedKB(null);
      setLoading(false);
    }
  };

  const handleAnswerSelect = (answer: string) => {
    if (showResult) return; // Don't allow changing answer after submission
    setSelectedAnswer(answer);
  };

  const submitAnswer = () => {
    if (!selectedAnswer) return;

    const currentQuestion = questions[currentQuestionIndex];

    // Get the correct answer text for proper comparison
    // selectedAnswer is the option text, correctAnswer may be a key (A, B, C, D) or the actual text
    let correctAnswerText = currentQuestion.correctAnswer;

    // If options is a Record (like {A: "text", B: "text"}), convert key to text
    if (currentQuestion.options && !Array.isArray(currentQuestion.options)) {
      const optionsRecord = currentQuestion.options as Record<string, string>;
      if (optionsRecord[currentQuestion.correctAnswer]) {
        correctAnswerText = optionsRecord[currentQuestion.correctAnswer];
      }
    }

    const isCorrect = selectedAnswer === correctAnswerText;

    if (isCorrect) {
      setScore(score + 1);
    }

    setAnsweredQuestions(answeredQuestions + 1);
    setShowResult(true);
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentQuestionIndex(currentQuestionIndex + 1);
        setSelectedAnswer(null);
        setShowResult(false);
        setIsTransitioning(false);
      }, 300);
    }
  };

  const restartSession = () => {
    setSelectedKB(null);
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAnsweredQuestions(0);
  };

  // Start a configured test with specific modules/chapters/sections
  const startConfiguredTest = async (config: TestConfig) => {
    try {
      setConfiguringTest(null);
      setLoading(true);
      setError(null);
      setSelectedKB(config.kbId);
      setSessionStartTime(Date.now());

      setIsGenerating(true);
      setGenerationProgress('Generating questions based on your selection...');

      // Generate questions using the test configuration
      const generatedQuestions = await window.electronAPI.invoke('test:generateQuestions', {
        kbId: config.kbId,
        moduleIds: config.moduleIds,
        chapterIds: config.chapterIds,
        sectionIds: config.sectionIds,
        totalQuestions: config.totalQuestions,
        difficulty: config.difficulty,
        adaptiveMode: config.adaptiveMode,
      }) as GeneratedQuestion[];

      if (!generatedQuestions || generatedQuestions.length === 0) {
        throw new Error('No questions were generated. Ensure the selected content has enough material.');
      }

      setGenerationProgress('Saving practice test...');

      // Save as a new practice test for future use
      await window.electronAPI.invoke('test:create', {
        kbId: config.kbId,
        title: `Custom Test - ${new Date().toLocaleDateString()}`,
        type: 'ai_generated',
        questions: generatedQuestions,
      });

      // Convert generated questions to the Question format
      const allQuestions: Question[] = generatedQuestions.map((q, index) => ({
        id: `gen_${index}`,
        type: q.type || 'multiple_choice',
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || '',
        difficulty: config.difficulty,
        tags: q.tags || [],
        sectionId: q.sectionId,
      }));

      // Shuffle questions
      const shuffled = allQuestions.sort(() => Math.random() - 0.5);

      setQuestions(shuffled);
      setCurrentQuestionIndex(0);
      setScore(0);
      setAnsweredQuestions(0);
      setIsGenerating(false);
      setGenerationProgress('');
      setLoading(false);

      // Fetch user progress for context-aware AI tutoring
      fetchUserProgress(config.kbId);

      showError(`Session started with ${shuffled.length} questions!`, 'info');
    } catch (error) {
      console.error('Failed to start configured test:', error);
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('AI Manager not configured')) {
        showError('No AI provider configured. Go to Settings to add an API key.', 'error');
      } else {
        showError(`Failed to start test: ${errorMessage}`, 'error');
      }
      setIsGenerating(false);
      setGenerationProgress('');
      setSelectedKB(null);
      setLoading(false);
    }
  };

  // Generate questions using AI for a specific KB
  const generateQuestionsForKB = async (kbId: number, difficulty: 'easy' | 'medium' | 'hard' = 'medium') => {
    try {
      setIsGenerating(true);
      setGenerationProgress('Analyzing knowledge base content...');
      setError(null);

      // Call AI to generate questions
      setGenerationProgress('Generating questions with AI...');
      const generatedQuestions = await window.electronAPI.invoke('test:generateQuestions', {
        kbId,
        questionsPerSection: 3,
        difficulty,
      }) as GeneratedQuestion[];

      if (!generatedQuestions || generatedQuestions.length === 0) {
        throw new Error('No questions were generated. Ensure the knowledge base has content and an AI provider is configured.');
      }

      setGenerationProgress('Saving practice test...');

      // Save as a new practice test
      await window.electronAPI.invoke('test:create', {
        kbId,
        title: `AI Generated Test - ${new Date().toLocaleDateString()}`,
        type: 'ai_generated',
        questions: generatedQuestions,
      });

      showError(`Successfully generated ${generatedQuestions.length} questions! Starting session...`, 'info');
      setIsGenerating(false);
      setGenerationProgress('');

      // Start the study session with the new questions
      await startSession(kbId);
    } catch (error) {
      console.error('Failed to generate questions:', error);
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('AI Manager not configured')) {
        showError('No AI provider configured. Go to Settings to add an API key.', 'error');
      } else {
        showError(`Failed to generate questions: ${errorMessage}`, 'error');
      }
      setIsGenerating(false);
      setGenerationProgress('');
    }
  };

  // Convert AI-generated options format to array for display
  const getOptionsArray = (options: string[] | Record<string, string> | undefined): string[] => {
    if (!options) return [];
    if (Array.isArray(options)) return options;
    // Convert Record<string, string> to array preserving order (A, B, C, D)
    return ['A', 'B', 'C', 'D']
      .filter(key => key in options)
      .map(key => options[key]);
  };

  // Get the correct answer text for comparison
  const getCorrectAnswerText = (question: Question): string => {
    if (!question.options || !question.correctAnswer) return '';
    if (Array.isArray(question.options)) {
      return question.correctAnswer;
    }
    // For Record<string, string>, correctAnswer is the key (A, B, C, D)
    return question.options[question.correctAnswer] || question.correctAnswer;
  };

  if (loading) {
    return (
      <div className="study-session">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // KB Selection view
  if (!selectedKB) {
    // Show KBViewer if viewing a KB
    if (viewingKB) {
      return (
        <KBViewer
          kbId={viewingKB.id}
          kbTitle={viewingKB.title}
          onBack={() => setViewingKB(null)}
        />
      );
    }

    // Show TestConfiguration if configuring a test
    if (configuringTest) {
      return (
        <TestConfiguration
          kbId={configuringTest.id}
          kbTitle={configuringTest.title}
          onCancel={() => setConfiguringTest(null)}
          onStartTest={startConfiguredTest}
        />
      );
    }

    return (
      <div className="study-session">
        {error && (
          <div className={`error-toast ${error.type}`} role="alert">
            <span>{error.message}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">&times;</button>
          </div>
        )}

        {isGenerating && (
          <div className="generating-overlay">
            <div className="generating-modal">
              <div className="loading-spinner"></div>
              <h3>Generating Questions with AI</h3>
              <p>{generationProgress}</p>
              <p className="generating-hint">This may take a minute...</p>
            </div>
          </div>
        )}

        <div className="session-header">
          <h2>Select Knowledge Base</h2>
          <button className="secondary-button" onClick={onExit}>
            Exit Study Mode
          </button>
        </div>

        {aiConfigured === false && (
          <div className="ai-config-warning">
            <span className="ai-config-warning-icon">[!]</span>
            <div className="ai-config-warning-content">
              <div className="ai-config-warning-title">AI Provider Not Configured</div>
              <div className="ai-config-warning-text">
                To generate practice questions with AI, you need to configure an AI provider.
                Go to Settings, add an API key, fetch available models, and select a default provider.
              </div>
              {onNavigateToSettings && (
                <div className="ai-config-warning-action">
                  <button onClick={onNavigateToSettings}>
                    Go to Settings
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {knowledgeBases.length === 0 ? (
          <div className="empty-state fade-in">
            <p>No knowledge bases available.</p>
            <p>Import a knowledge base to start studying.</p>
          </div>
        ) : (
          <div className="kb-selection-grid fade-in">
            {knowledgeBases.map((kb, index) => (
              <div
                key={kb.id}
                className="kb-selection-card"
                style={{ animationDelay: `${index * 0.1}s` }}
                role="article"
                aria-label={`Knowledge base: ${kb.title}`}
              >
                <h3>{kb.title}</h3>
                {kb.metadata && (
                  <div className="kb-stats-small">
                    {kb.metadata.totalQuestions && (
                      <span>{kb.metadata.totalQuestions as number} questions</span>
                    )}
                    {kb.metadata.totalModules && (
                      <span>{kb.metadata.totalModules as number} modules</span>
                    )}
                  </div>
                )}
                <div className="kb-card-actions">
                  <button
                    className="primary-button-small"
                    onClick={() => startSession(kb.id)}
                    disabled={isGenerating}
                    title="Start studying with existing questions"
                  >
                    Quick Start
                  </button>
                  <button
                    className="primary-button-small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfiguringTest({ id: kb.id, title: kb.title });
                    }}
                    disabled={isGenerating}
                    title="Configure a custom test with specific content"
                  >
                    Custom Test
                  </button>
                  <button
                    className="secondary-button-small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingKB({ id: kb.id, title: kb.title });
                    }}
                    disabled={isGenerating}
                    title="View knowledge base content"
                  >
                    View Material
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Session Complete view
  if (answeredQuestions === questions.length && questions.length > 0) {
    const percentage = Math.round((score / questions.length) * 100);
    const sessionDuration = Math.round((Date.now() - sessionStartTime) / 1000 / 60); // minutes
    const avgTimePerQuestion = Math.round((Date.now() - sessionStartTime) / 1000 / questions.length);

    return (
      <div className="study-session">
        {error && (
          <div className={`error-toast ${error.type}`} role="alert">
            <span>{error.message}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">&times;</button>
          </div>
        )}
        <div className="session-complete fade-in">
          <h2>Session Complete!</h2>
          <div className="score-display">
            <div className={`score-circle ${percentage >= 70 ? 'pass' : 'fail'}`}>
              <span className="score-number">{percentage}%</span>
            </div>
            <p className="score-details">
              {score} out of {questions.length} correct
            </p>
          </div>

          <div className="session-stats">
            <div className="stat-item">
              <span className="stat-label">Time:</span>
              <span className="stat-value">{sessionDuration} min</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Avg per Question:</span>
              <span className="stat-value">{avgTimePerQuestion}s</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Performance:</span>
              <span className="stat-value">
                {percentage >= 90 ? 'Excellent!' : percentage >= 70 ? 'Good!' : 'Keep Practicing!'}
              </span>
            </div>
          </div>

          <div className="completion-actions">
            <button className="primary-button" onClick={restartSession}>
              Study Another KB
            </button>
            <button className="secondary-button" onClick={() => startSession(selectedKB)}>
              Retry This KB
            </button>
            <button className="secondary-button" onClick={onExit}>
              Exit Study Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No questions available
  if (questions.length === 0) {
    return (
      <div className="study-session">
        <div className="empty-state">
          <p>No questions found in this knowledge base.</p>
          <button className="secondary-button" onClick={restartSession}>
            Choose Another KB
          </button>
        </div>
      </div>
    );
  }

  // Active Question view
  const currentQuestion = questions[currentQuestionIndex];
  const currentOptions = getOptionsArray(currentQuestion.options);
  const correctAnswerText = getCorrectAnswerText(currentQuestion);
  const isCorrect = showResult && selectedAnswer === correctAnswerText;
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  return (
    <div className="study-session">
      {error && (
        <div className={`error-toast ${error.type}`} role="alert">
          <span>{error.message}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}
      <div className="session-header">
        <div className="progress-info">
          <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
          <span className="score-info">Score: {score}/{answeredQuestions}</span>
          <span className="score-percentage" aria-label="Current percentage">
            {answeredQuestions > 0 ? Math.round((score / answeredQuestions) * 100) : 0}%
          </span>
        </div>
        <button className="secondary-button" onClick={restartSession} aria-label="Exit session">
          Exit Session
        </button>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }}></div>
      </div>

      <div className={`question-container ${isTransitioning ? 'fade-out' : 'fade-in'}`}>
        <div className="question-header">
          {currentQuestion.difficulty && (
            <span className={`difficulty-badge ${currentQuestion.difficulty}`}>
              {currentQuestion.difficulty}
            </span>
          )}
          {currentQuestion.tags && currentQuestion.tags.length > 0 && (
            <div className="question-tags">
              {currentQuestion.tags.map((tag, i) => (
                <span key={i} className="tag">{tag}</span>
              ))}
            </div>
          )}
        </div>

        <h3 className="question-text" role="heading" aria-level={2}>{currentQuestion.question}</h3>

        {currentQuestion.type === 'short_answer' || currentOptions.length === 0 ? (
          <div className="short-answer-container">
            <p className="short-answer-instruction">
              This is a self-assessment question. Think about your answer, then click "I've Reviewed" to continue.
            </p>
            {showResult && currentQuestion.explanation && (
              <div className="self-assessment-hint">
                <strong>Key points to consider:</strong> {currentQuestion.explanation}
              </div>
            )}
          </div>
        ) : (
          <div className="answer-options" role="radiogroup" aria-label="Answer options">
            {currentOptions.map((option, index) => (
              <button
                key={index}
                role="radio"
                aria-checked={selectedAnswer === option}
                aria-label={`Option ${index + 1}: ${option}`}
                className={`answer-option ${
                  selectedAnswer === option ? 'selected' : ''
                } ${
                  showResult && option === correctAnswerText ? 'correct' : ''
                } ${
                  showResult && selectedAnswer === option && option !== correctAnswerText ? 'incorrect' : ''
                }`}
                onClick={() => handleAnswerSelect(option)}
                disabled={showResult}
              >
                <span className="option-number">{index + 1}</span>
                <span className="option-text">{option}</span>
              </button>
            ))}
          </div>
        )}

        {showResult && currentQuestion.explanation && (
          <div className={`explanation ${isCorrect ? 'correct' : 'incorrect'}`}>
            <h4>{isCorrect ? 'Correct' : 'Incorrect'}</h4>
            <p>{currentQuestion.explanation}</p>
          </div>
        )}

        <div className="question-actions">
          {!showResult ? (
            currentQuestion.type === 'short_answer' || currentOptions.length === 0 ? (
              <button
                className="primary-button"
                onClick={() => {
                  setSelectedAnswer('self-assessed');
                  setShowResult(true);
                  setAnsweredQuestions(answeredQuestions + 1);
                  setScore(score + 1); // Self-assessment counts as correct
                }}
              >
                I've Reviewed
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={submitAnswer}
                disabled={!selectedAnswer}
              >
                Submit Answer
              </button>
            )
          ) : (
            <button className="primary-button" onClick={nextQuestion}>
              {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'View Results'}
            </button>
          )}
        </div>
      </div>

      <ChatPanel
        isOpen={isChatOpen}
        onToggle={() => setIsChatOpen(!isChatOpen)}
        currentQuestion={currentQuestion.question}
        currentTopic={currentQuestion.tags?.[0]}
        knowledgeBaseId={selectedKB}
        sectionContent={currentSectionContent}
        userProgress={userProgress || undefined}
        kbTitle={knowledgeBases.find(kb => kb.id === selectedKB)?.title}
      />
    </div>
  );
}

export default StudySession;
