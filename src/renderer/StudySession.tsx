import React, { useState, useEffect, useCallback } from 'react';
import ChatPanel from './ChatPanel';

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

interface StudySessionProps {
  onExit: () => void;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

function StudySession({ onExit }: StudySessionProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<number | null>(null);
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

  useEffect(() => {
    loadKnowledgeBases();
  }, []);

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

          // If still no questions, generate simple questions from content
          if (allQuestions.length === 0) {
            let sectionIndex = 0;
            for (const module of parsed.modules) {
              for (const chapter of module.chapters) {
                for (const section of chapter.sections) {
                  const content = section.content?.text || '';
                  if (content.trim().length > 50) {
                    // Create a simple comprehension question for sections with content
                    allQuestions.push({
                      id: `auto_${sectionIndex}`,
                      type: 'short_answer',
                      question: `Review the content from "${section.title}". What are the key points?`,
                      correctAnswer: 'self-assessed',
                      explanation: `This is a self-assessment question. Review your understanding of: ${section.title}`,
                      difficulty: 'medium',
                      tags: [section.title],
                    });
                    sectionIndex++;
                  }
                }
              }
            }
          }
        } catch (parseError) {
          console.warn('KB parsing failed:', parseError);
        }
      }

      if (allQuestions.length === 0) {
        // Show a helpful message instead of throwing an error
        showError('This knowledge base has no questions yet. Use the Editor to add content, or generate practice tests.', 'warning');
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
    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;

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
                  >
                    Start Studying
                  </button>
                  <button
                    className="secondary-button-small"
                    onClick={(e) => {
                      e.stopPropagation();
                      generateQuestionsForKB(kb.id);
                    }}
                    disabled={isGenerating}
                    title="Generate new practice questions using AI"
                  >
                    Generate Questions
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

        {showResult && currentQuestion.explanation && (
          <div className={`explanation ${isCorrect ? 'correct' : 'incorrect'}`}>
            <h4>{isCorrect ? 'Correct' : 'Incorrect'}</h4>
            <p>{currentQuestion.explanation}</p>
          </div>
        )}

        <div className="question-actions">
          {!showResult ? (
            <button
              className="primary-button"
              onClick={submitAnswer}
              disabled={!selectedAnswer}
            >
              Submit Answer
            </button>
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
      />
    </div>
  );
}

export default StudySession;
