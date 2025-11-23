import React, { useState, useEffect } from 'react';
import ChatPanel from './ChatPanel';

interface Question {
  id: string;
  type: string;
  question: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: string;
  tags?: string[];
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

  useEffect(() => {
    loadKnowledgeBases();
  }, []);

  const loadKnowledgeBases = async () => {
    try {
      const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
      setKnowledgeBases(kbs);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load knowledge bases:', error);
      setLoading(false);
    }
  };

  const startSession = async (kbId: number) => {
    try {
      setLoading(true);
      setSelectedKB(kbId);

      // Parse KB to get questions
      const parsed = await window.electronAPI.invoke('kb:parse', kbId) as {
        modules: Array<{
          chapters: Array<{
            sections: Array<{
              questions?: Question[];
            }>;
          }>;
        }>;
      };

      // Extract all questions from all sections
      const allQuestions: Question[] = [];
      for (const module of parsed.modules) {
        for (const chapter of module.chapters) {
          for (const section of chapter.sections) {
            if (section.questions) {
              allQuestions.push(...section.questions);
            }
          }
        }
      }

      // Shuffle questions
      const shuffled = allQuestions.sort(() => Math.random() - 0.5);

      setQuestions(shuffled);
      setCurrentQuestionIndex(0);
      setScore(0);
      setAnsweredQuestions(0);
      setLoading(false);
    } catch (error) {
      console.error('Failed to start session:', error);
      alert(`Failed to start session: ${(error as Error).message}`);
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
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
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
        <div className="session-header">
          <h2>Select Knowledge Base</h2>
          <button className="secondary-button" onClick={onExit}>
            Exit Study Mode
          </button>
        </div>

        {knowledgeBases.length === 0 ? (
          <div className="empty-state">
            <p>No knowledge bases available.</p>
            <p>Import a knowledge base to start studying.</p>
          </div>
        ) : (
          <div className="kb-selection-grid">
            {knowledgeBases.map(kb => (
              <div
                key={kb.id}
                className="kb-selection-card"
                onClick={() => startSession(kb.id)}
              >
                <h3>{kb.title}</h3>
                {kb.metadata && (
                  <div className="kb-stats-small">
                    {kb.metadata.totalQuestions && (
                      <span>{kb.metadata.totalQuestions} questions</span>
                    )}
                    {kb.metadata.totalModules && (
                      <span>{kb.metadata.totalModules} modules</span>
                    )}
                  </div>
                )}
                <button className="primary-button-small">Start Studying</button>
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
    return (
      <div className="study-session">
        <div className="session-complete">
          <h2>Session Complete</h2>
          <div className="score-display">
            <div className="score-circle">
              <span className="score-number">{percentage}%</span>
            </div>
            <p className="score-details">
              {score} out of {questions.length} correct
            </p>
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
  const isCorrect = showResult && selectedAnswer === currentQuestion.correctAnswer;
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  return (
    <div className="study-session">
      <div className="session-header">
        <div className="progress-info">
          <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
          <span className="score-info">Score: {score}/{answeredQuestions}</span>
        </div>
        <button className="secondary-button" onClick={restartSession}>
          Exit Session
        </button>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }}></div>
      </div>

      <div className="question-container">
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

        <h3 className="question-text">{currentQuestion.question}</h3>

        <div className="answer-options">
          {currentQuestion.options?.map((option, index) => (
            <button
              key={index}
              className={`answer-option ${
                selectedAnswer === option ? 'selected' : ''
              } ${
                showResult && option === currentQuestion.correctAnswer ? 'correct' : ''
              } ${
                showResult && selectedAnswer === option && option !== currentQuestion.correctAnswer ? 'incorrect' : ''
              }`}
              onClick={() => handleAnswerSelect(option)}
              disabled={showResult}
            >
              {option}
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
