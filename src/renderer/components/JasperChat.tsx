import React, { useState, useEffect, useRef, useCallback } from 'react';
import JasperOrb, { JasperState } from './JasperOrb';
import SyncedTextReader from './SyncedTextReader';
import MarkdownRenderer, { stripMarkdown } from './MarkdownRenderer';
import './JasperChat.css';

// Study session types
interface StudySession {
  id: string;
  technique: string;
  currentStep: number;
  totalSteps: number;
  topic: string;
  startTime: Date;
  isActive: boolean;
}

interface ReviewItem {
  id: string;
  kbId: number;
  sectionId: string;
  sectionTitle: string;
  lastReviewed: Date | null;
  nextReview: Date;
  difficulty: number; // 1-5
  repetitions: number;
  easeFactor: number;
}

// Learning technique prompts for Study mode
const STUDY_TECHNIQUES = {
  'retrieval-practice': {
    name: 'Retrieval Practice',
    description: 'Test yourself to strengthen memory',
    prompt: 'I want to practice retrieval. Please ask me challenging questions about the content in my knowledge base. After I answer, provide feedback and the correct answer with explanation.',
  },
  'elaborative-interrogation': {
    name: 'Elaborative Interrogation',
    description: 'Deep understanding through "why" questions',
    prompt: 'Help me understand the material deeply by asking "why" and "how" questions. Prompt me to explain the reasoning behind concepts.',
  },
  'feynman-technique': {
    name: 'Feynman Technique',
    description: 'Explain concepts as if teaching someone',
    prompt: 'Act as a curious student. Ask me to explain a concept from my notes as if I\'m teaching you. Point out where my explanation is unclear or incorrect.',
  },
  'interleaving': {
    name: 'Interleaving',
    description: 'Mix different topics for better learning',
    prompt: 'Help me practice interleaving. Present questions that jump between different topics in my knowledge base to help me discriminate between concepts.',
  },
  'dual-coding': {
    name: 'Dual Coding',
    description: 'Combine verbal and visual learning',
    prompt: 'Help me create mental images and diagrams for the concepts in my notes. Describe visual representations and ask me to sketch or visualize concepts.',
  },
};

interface Message {
  id: string;
  role: 'user' | 'jasper' | 'system';
  content: string;
  timestamp: Date;
  sources?: Array<{
    kbId: number;
    kbTitle: string;
    section: string;
    content?: string;
  }>;
  isStreaming?: boolean;
}

interface KnowledgeBase {
  id: number;
  title: string;
  enabled: boolean;
}

interface VoiceConfig {
  selectedVoiceName?: string; // The system voice name to use
  rate?: number;
  pitch?: number;
  volume?: number;
}

interface JasperChatProps {
  knowledgeBases: KnowledgeBase[];
  onNavigateToSource?: (kbId: number, sectionId: string) => void;
  onToggleKnowledgeBase?: (kbId: number, enabled: boolean) => void;
  className?: string;
  voiceConfig?: VoiceConfig;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// System prompt for Jasper AI Learning Assistant
const JASPER_SYSTEM_PROMPT = `You are Jasper, an intelligent and friendly AI Learning Assistant. Your role is to help users learn and understand their study materials effectively.

Your key responsibilities:
1. Answer questions about the user's knowledge bases with accurate, helpful information
2. Explain complex concepts in clear, understandable terms
3. Use analogies and examples to make learning easier
4. Encourage active learning through questions and engagement
5. Cite sources from the knowledge base when providing information
6. Adapt your explanations to the user's level of understanding

When answering questions:
- Be conversational but educational
- Break down complex topics into digestible parts
- Offer to elaborate on any points if the user wants more detail
- Suggest related topics they might want to explore
- Use the available tools to search and retrieve relevant content from their knowledge bases

You have access to tools that let you search and retrieve content from the user's knowledge bases. Use these tools to provide accurate, sourced information.

Remember: You're not just answering questions - you're helping someone learn and retain knowledge for the long term.`;

export function JasperChat({
  knowledgeBases,
  onNavigateToSource,
  onToggleKnowledgeBase,
  className = '',
  voiceConfig,
}: JasperChatProps): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [jasperState, setJasperState] = useState<JasperState>('idle');
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [activeTab, setActiveTab] = useState<'chat' | 'study' | 'review'>('chat');
  // Separate voice/highlight settings for each tab
  const [chatVoiceEnabled, setChatVoiceEnabled] = useState(true);
  const [chatHighlightEnabled, setChatHighlightEnabled] = useState(true);
  const [studyVoiceEnabled, setStudyVoiceEnabled] = useState(true);
  const [studyHighlightEnabled, setStudyHighlightEnabled] = useState(true);
  const [reviewVoiceEnabled, setReviewVoiceEnabled] = useState(true);
  const [reviewHighlightEnabled, setReviewHighlightEnabled] = useState(true);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');

  // Get current tab's voice/highlight settings
  const voiceEnabled = activeTab === 'chat' ? chatVoiceEnabled : activeTab === 'study' ? studyVoiceEnabled : reviewVoiceEnabled;
  const highlightEnabled = activeTab === 'chat' ? chatHighlightEnabled : activeTab === 'study' ? studyHighlightEnabled : reviewHighlightEnabled;
  const [currentSpeakingMessage, setCurrentSpeakingMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKBPanel, setShowKBPanel] = useState(true);

  // Study mode state
  const [studySession, setStudySession] = useState<StudySession | null>(null);
  const [selectedTechnique, setSelectedTechnique] = useState<string | null>(null);

  // Review mode state
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [currentReviewItem, setCurrentReviewItem] = useState<ReviewItem | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewStats, setReviewStats] = useState({ reviewed: 0, remaining: 0, accuracy: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Get enabled KB IDs
  const enabledKBs = knowledgeBases.filter(kb => kb.enabled);
  const primaryKBId = enabledKBs.length > 0 ? enabledKBs[0].id : 0;

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognitionAPI = (window as unknown as {
        SpeechRecognition?: typeof SpeechRecognition;
        webkitSpeechRecognition?: typeof SpeechRecognition;
      }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition }).webkitSpeechRecognition;

      recognitionRef.current = new SpeechRecognitionAPI();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        const result = event.results[event.results.length - 1];
        if (result.isFinal) {
          setInputText(result[0].transcript);
          setIsListening(false);
          setJasperState('idle');
        } else {
          setInputText(result[0].transcript);
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        if (jasperState === 'listening') {
          setJasperState('idle');
        }
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
        setJasperState('error');
        setTimeout(() => setJasperState('idle'), 2000);
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [jasperState]);

  // Use a ref to track initialization state to avoid infinite loops
  const isInitializingRef = useRef(false);

  // Initialize conversation with the backend
  const initializeConversation = useCallback(async () => {
    if (isInitializingRef.current || primaryKBId <= 0) {
      return;
    }

    isInitializingRef.current = true;
    setIsInitializing(true);
    setError(null);

    try {
      const convId = await window.electronAPI.invoke(
        'conversation:create',
        primaryKBId,
        JASPER_SYSTEM_PROMPT
      ) as number;

      setConversationId(convId);
      setMessages([]);
    } catch (err) {
      console.error('Failed to initialize conversation:', err);
      setError('Failed to connect to AI. Please check your settings.');
    } finally {
      isInitializingRef.current = false;
      setIsInitializing(false);
    }
  }, [primaryKBId]);

  // Initialize or reset conversation when enabled KBs change
  useEffect(() => {
    if (primaryKBId > 0 && !conversationId && !isInitializingRef.current) {
      initializeConversation();
    }
  }, [primaryKBId, conversationId, initializeConversation]);

  // Clear the "select KB" error when we have a valid KB or conversation
  useEffect(() => {
    if (error === 'Please select a knowledge base to chat with Jasper.') {
      // Clear if we have a conversation OR if a KB is selected (conversation is being created)
      if (conversationId || primaryKBId > 0) {
        setError(null);
      }
    }
  }, [conversationId, primaryKBId, error]);

  // Audio level monitoring for listening animation
  const startAudioMonitoring = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      analyserRef.current.fftSize = 256;
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      const updateLevel = () => {
        if (!isListening || !analyserRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(average / 255);
        requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (error) {
      console.error('Failed to start audio monitoring:', error);
    }
  }, [isListening]);

  const stopAudioMonitoring = useCallback(() => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      stopAudioMonitoring();
      setIsListening(false);
      setJasperState('idle');
    } else {
      recognitionRef.current?.start();
      startAudioMonitoring();
      setIsListening(true);
      setJasperState('listening');
    }
  }, [isListening, startAudioMonitoring, stopAudioMonitoring]);

  const sendMessage = useCallback(async () => {
    if (!inputText.trim()) return;

    // Create or use existing conversation
    let currentConversationId = conversationId;
    if (!currentConversationId && primaryKBId > 0) {
      try {
        const convId = await window.electronAPI.invoke(
          'conversation:create',
          primaryKBId,
          JASPER_SYSTEM_PROMPT
        ) as number;
        currentConversationId = convId;
        setConversationId(convId);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        setError('Failed to start conversation. Please check your AI settings.');
        return;
      }
    }

    if (!currentConversationId) {
      setError('Please select a knowledge base to chat with Jasper.');
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setJasperState('thinking');
    setError(null);

    try {
      // Send message to backend
      const response = await window.electronAPI.invoke(
        'conversation:addMessage',
        currentConversationId,
        { role: 'user', content: userMessage.content }
      ) as {
        success: boolean;
        message: { role: string; content: string };
        error?: string;
        toolIterations?: number;
      };

      if (!response.success) {
        throw new Error(response.error || 'Failed to get response');
      }

      const jasperMessage: Message = {
        id: `jasper-${Date.now()}`,
        role: 'jasper',
        content: response.message.content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, jasperMessage]);
      setJasperState('idle');

      // Speak the response if voice is enabled
      if (voiceEnabled && jasperMessage.content) {
        setCurrentSpeakingMessage(jasperMessage.id);
        setJasperState('speaking');
      }
    } catch (err) {
      console.error('Failed to get response:', err);
      setJasperState('error');
      setError((err as Error).message);

      // Add error message
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'jasper',
        content: `I apologize, but I encountered an issue: ${(err as Error).message}. Please check your AI provider settings or try again.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);

      setTimeout(() => setJasperState('idle'), 2000);
    }
  }, [inputText, voiceEnabled, conversationId, primaryKBId]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSpeakingEnd = useCallback(() => {
    setCurrentSpeakingMessage(null);
    if (jasperState === 'speaking') {
      setJasperState('idle');
    }
  }, [jasperState]);

  const handleOrbClick = useCallback(() => {
    if (inputMode === 'voice') {
      toggleListening();
    }
  }, [inputMode, toggleListening]);

  const handleNewConversation = useCallback(async () => {
    setConversationId(null);
    setMessages([]);
    setError(null);
    await initializeConversation();
  }, [initializeConversation]);

  // Study mode functions
  const startStudySession = useCallback(async (techniqueKey: string) => {
    const technique = STUDY_TECHNIQUES[techniqueKey as keyof typeof STUDY_TECHNIQUES];
    if (!technique) return;

    const session: StudySession = {
      id: `study-${Date.now()}`,
      technique: techniqueKey,
      currentStep: 1,
      totalSteps: 5,
      topic: enabledKBs.length > 0 ? enabledKBs[0].title : 'General',
      startTime: new Date(),
      isActive: true,
    };

    setStudySession(session);
    setSelectedTechnique(techniqueKey);

    // Add system message about the study session
    const systemMessage: Message = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: `Starting ${technique.name} session. ${technique.description}`,
      timestamp: new Date(),
    };
    setMessages([systemMessage]);

    // Send the technique prompt to start the session
    if (conversationId || primaryKBId > 0) {
      let currentConversationId = conversationId;
      if (!currentConversationId && primaryKBId > 0) {
        try {
          const convId = await window.electronAPI.invoke(
            'conversation:create',
            primaryKBId,
            JASPER_SYSTEM_PROMPT
          ) as number;
          currentConversationId = convId;
          setConversationId(convId);
        } catch {
          setError('Failed to start study session');
          return;
        }
      }

      setJasperState('thinking');
      try {
        const response = await window.electronAPI.invoke(
          'conversation:addMessage',
          currentConversationId,
          { role: 'user', content: technique.prompt }
        ) as { success: boolean; message: { content: string }; error?: string };

        if (response.success) {
          const jasperMessage: Message = {
            id: `jasper-${Date.now()}`,
            role: 'jasper',
            content: response.message.content,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, jasperMessage]);

          // Trigger TTS if voice is enabled for Study tab
          if (studyVoiceEnabled && jasperMessage.content) {
            setCurrentSpeakingMessage(jasperMessage.id);
            setJasperState('speaking');
            return; // Don't set to idle yet, speaking will handle it
          }
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (jasperState !== 'speaking') {
          setJasperState('idle');
        }
      }
    }
  }, [conversationId, primaryKBId, enabledKBs, studyVoiceEnabled, jasperState]);

  const endStudySession = useCallback(() => {
    setStudySession(null);
    setSelectedTechnique(null);
    setMessages([]);
  }, []);

  // Review mode functions - Spaced Repetition (SM-2 algorithm)
  const loadReviewItems = useCallback(async () => {
    if (enabledKBs.length === 0) return;

    // Load review items from storage or create from KB content
    try {
      const stored = localStorage.getItem('jasper-review-items');
      if (stored) {
        const items: ReviewItem[] = JSON.parse(stored);
        // Filter for items due for review
        const now = new Date();
        const dueItems = items.filter(item => new Date(item.nextReview) <= now);
        setReviewItems(dueItems);
        setReviewStats({
          reviewed: 0,
          remaining: dueItems.length,
          accuracy: 0,
        });
      }
    } catch (err) {
      console.error('Failed to load review items:', err);
    }
  }, [enabledKBs]);

  // SM-2 algorithm for spaced repetition
  const calculateNextReview = useCallback((item: ReviewItem, quality: number): ReviewItem => {
    // quality: 0-2 = fail, 3-5 = pass
    let { easeFactor, repetitions } = item;

    if (quality < 3) {
      // Reset on failure
      repetitions = 0;
    } else {
      repetitions += 1;
      // Adjust ease factor
      easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    }

    // Calculate interval
    let interval: number;
    if (repetitions === 0) {
      interval = 1; // 1 day
    } else if (repetitions === 1) {
      interval = 6; // 6 days
    } else {
      interval = Math.round((repetitions - 1) * easeFactor);
    }

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);

    return {
      ...item,
      lastReviewed: new Date(),
      nextReview,
      difficulty: quality,
      repetitions,
      easeFactor,
    };
  }, []);

  const rateReviewItem = useCallback((quality: number) => {
    if (!currentReviewItem) return;

    const updatedItem = calculateNextReview(currentReviewItem, quality);

    // Update stored items
    const stored = localStorage.getItem('jasper-review-items');
    const allItems: ReviewItem[] = stored ? JSON.parse(stored) : [];
    const index = allItems.findIndex(i => i.id === updatedItem.id);
    if (index >= 0) {
      allItems[index] = updatedItem;
    } else {
      allItems.push(updatedItem);
    }
    localStorage.setItem('jasper-review-items', JSON.stringify(allItems));

    // Update stats
    setReviewStats(prev => ({
      reviewed: prev.reviewed + 1,
      remaining: prev.remaining - 1,
      accuracy: quality >= 3
        ? ((prev.accuracy * prev.reviewed) + 100) / (prev.reviewed + 1)
        : (prev.accuracy * prev.reviewed) / (prev.reviewed + 1),
    }));

    // Move to next item
    const remainingItems = reviewItems.filter(i => i.id !== currentReviewItem.id);
    setReviewItems(remainingItems);
    setCurrentReviewItem(remainingItems.length > 0 ? remainingItems[0] : null);
    setShowAnswer(false);
  }, [currentReviewItem, reviewItems, calculateNextReview]);

  const startReview = useCallback(() => {
    if (reviewItems.length > 0) {
      setCurrentReviewItem(reviewItems[0]);
      setShowAnswer(false);
    }
  }, [reviewItems]);

  // Load review items when switching to review tab
  useEffect(() => {
    if (activeTab === 'review') {
      loadReviewItems();
    }
  }, [activeTab, loadReviewItems]);

  return (
    <div className={`jasper-chat ${className}`}>
      {/* Header */}
      <div className="jasper-chat-header">
        <div className="jasper-header-left">
          <div className="jasper-avatar">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <circle cx="12" cy="12" r="10" fill="url(#jasperGradient)" />
              <defs>
                <linearGradient id="jasperGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4A90D9" />
                  <stop offset="100%" stopColor="#7C4DFF" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="jasper-header-info">
            <h2>Jasper</h2>
            <span className="jasper-subtitle">AI Learning Assistant</span>
          </div>
        </div>
        <div className="jasper-chat-tabs">
          <button
            className={activeTab === 'chat' ? 'active' : ''}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            className={activeTab === 'study' ? 'active' : ''}
            onClick={() => setActiveTab('study')}
          >
            Study
          </button>
          <button
            className={activeTab === 'review' ? 'active' : ''}
            onClick={() => setActiveTab('review')}
          >
            Review
          </button>
        </div>
        <div className="jasper-header-actions">
          <button
            className="jasper-action-btn"
            onClick={() => setShowKBPanel(!showKBPanel)}
            title={showKBPanel ? 'Hide Knowledge Bases' : 'Show Knowledge Bases'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            className="jasper-action-btn"
            onClick={handleNewConversation}
            title="New Conversation"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="jasper-chat-content">
        {/* Sidebar - Knowledge Bases */}
        {showKBPanel && (
          <div className="jasper-chat-sidebar">
            <div className="jasper-kb-section">
              <h3>Knowledge Bases</h3>
              <div className="jasper-kb-list">
                {knowledgeBases.length === 0 ? (
                  <p className="jasper-kb-empty">No knowledge bases available. Import content to get started.</p>
                ) : (
                  knowledgeBases.map((kb) => (
                    <label key={kb.id} className="jasper-kb-item">
                      <input
                        type="checkbox"
                        checked={kb.enabled}
                        onChange={() => onToggleKnowledgeBase?.(kb.id, !kb.enabled)}
                      />
                      <span className="jasper-kb-title">{kb.title}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="jasper-settings-section">
              <h3>Voice Settings <span className="jasper-settings-tab-indicator">({activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Tab)</span></h3>
              <label className="jasper-setting-toggle">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={() => {
                    if (activeTab === 'chat') setChatVoiceEnabled(!chatVoiceEnabled);
                    else if (activeTab === 'study') setStudyVoiceEnabled(!studyVoiceEnabled);
                    else setReviewVoiceEnabled(!reviewVoiceEnabled);
                  }}
                />
                <span>Text-to-Speech</span>
              </label>
              <label className="jasper-setting-toggle">
                <input
                  type="checkbox"
                  checked={highlightEnabled}
                  onChange={() => {
                    if (activeTab === 'chat') setChatHighlightEnabled(!chatHighlightEnabled);
                    else if (activeTab === 'study') setStudyHighlightEnabled(!studyHighlightEnabled);
                    else setReviewHighlightEnabled(!reviewHighlightEnabled);
                  }}
                />
                <span>Text Highlighting</span>
              </label>
            </div>

            <div className="jasper-quick-actions">
              <h3>Quick Actions</h3>
              <button className="jasper-quick-btn" onClick={() => setInputText('Explain the main concepts from my notes')}>
                Explain Concepts
              </button>
              <button className="jasper-quick-btn" onClick={() => setInputText('Quiz me on what I\'ve studied')}>
                Quiz Me
              </button>
              <button className="jasper-quick-btn" onClick={() => setInputText('Summarize the key points')}>
                Summarize
              </button>
              <button className="jasper-quick-btn" onClick={() => setInputText('What should I review next?')}>
                What to Review
              </button>
            </div>
          </div>
        )}

        {/* Main Chat Area */}
        <div className="jasper-chat-main">
          {/* Compact Orb Status Bar */}
          <div className="jasper-status-bar">
            <div className="jasper-orb-mini">
              <JasperOrb
                state={jasperState}
                size="small"
                audioLevel={audioLevel}
                onClick={handleOrbClick}
              />
            </div>
            <div className="jasper-status-info">
              <span className={`jasper-status-dot ${jasperState}`} />
              <span className="jasper-status-text">
                {jasperState === 'idle' && 'Ready to help'}
                {jasperState === 'listening' && 'Listening...'}
                {jasperState === 'thinking' && 'Thinking...'}
                {jasperState === 'speaking' && 'Speaking...'}
                {jasperState === 'processing' && 'Processing...'}
                {jasperState === 'success' && 'Done!'}
                {jasperState === 'error' && 'Error occurred'}
              </span>
            </div>
            {enabledKBs.length > 0 && (
              <div className="jasper-kb-indicator">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3z" />
                  <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" />
                </svg>
                <span>{enabledKBs.length} KB{enabledKBs.length !== 1 ? 's' : ''} active</span>
              </div>
            )}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="jasper-error-banner">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <span>{error}</span>
              <button onClick={() => setError(null)}>Dismiss</button>
            </div>
          )}

          {/* Content Area - Changes based on active tab */}
          {activeTab === 'chat' && (
            <>
              {/* Messages Area */}
              <div className="jasper-messages">
                {messages.length === 0 ? (
                  <div className="jasper-welcome">
                    <div className="jasper-welcome-orb">
                      <JasperOrb state="idle" size="medium" />
                    </div>
                    <h3>Hello! I'm Jasper</h3>
                    <p>Your AI learning assistant. I can help you:</p>
                    <ul className="jasper-welcome-list">
                      <li>Answer questions about your study materials</li>
                      <li>Explain complex concepts in simple terms</li>
                      <li>Quiz you to test your knowledge</li>
                      <li>Suggest what to review next</li>
                    </ul>
                    {enabledKBs.length === 0 ? (
                      <p className="jasper-welcome-hint">
                        Select a knowledge base from the sidebar to get started!
                      </p>
                    ) : (
                      <p className="jasper-welcome-hint">
                        I have access to <strong>{enabledKBs.map(kb => kb.title).join(', ')}</strong>. Ask me anything!
                      </p>
                    )}
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`jasper-message jasper-message-${message.role}`}
                    >
                      {message.role === 'jasper' && (
                        <div className="jasper-message-avatar">
                          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <circle cx="12" cy="12" r="10" fill="url(#jasperMsgGradient)" />
                            <defs>
                              <linearGradient id="jasperMsgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#4A90D9" />
                                <stop offset="100%" stopColor="#7C4DFF" />
                              </linearGradient>
                            </defs>
                          </svg>
                        </div>
                      )}
                      <div className="jasper-message-bubble">
                        <div className="jasper-message-content">
                          {message.role === 'jasper' &&
                          voiceEnabled &&
                          highlightEnabled &&
                          currentSpeakingMessage === message.id ? (
                            <SyncedTextReader
                              text={stripMarkdown(message.content)}
                              showControls={false}
                              autoPlay={true}
                              onSpeakingEnd={handleSpeakingEnd}
                              highlightSettings={{
                                enabled: true,
                                style: 'word',
                                hotspotColor: '#00BCD4',
                                pastFadeColor: '#4ade80',
                                futureGlowColor: '#60a5fa',
                                fadeDuration: 1.0,
                                anticipationRange: 2,
                                autoScroll: true,
                                scrollSpeed: 3,
                              }}
                              voiceSettings={{
                                rate: voiceConfig?.rate ?? 1.0,
                                pitch: voiceConfig?.pitch ?? 0,
                                volume: voiceConfig?.volume ?? 80,
                                selectedVoiceId: 'default',
                                selectedVoiceName: voiceConfig?.selectedVoiceName,
                              }}
                            />
                          ) : (
                            <MarkdownRenderer content={message.content} />
                          )}
                        </div>
                        {message.sources && message.sources.length > 0 && (
                          <div className="jasper-message-sources">
                            <span className="jasper-sources-label">Sources:</span>
                            {message.sources.map((source, idx) => (
                              <button
                                key={idx}
                                className="jasper-source-link"
                                onClick={() => onNavigateToSource?.(source.kbId, source.section)}
                              >
                                {source.kbTitle} &gt; {source.section}
                              </button>
                            ))}
                      </div>
                    )}
                    <div className="jasper-message-time">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {message.role === 'user' && (
                    <div className="jasper-message-avatar jasper-user-avatar">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                      </svg>
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="jasper-input-area">
            <div className="jasper-input-mode-toggle">
              <button
                className={inputMode === 'text' ? 'active' : ''}
                onClick={() => setInputMode('text')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z" />
                </svg>
                Text
              </button>
              <button
                className={inputMode === 'voice' ? 'active' : ''}
                onClick={() => setInputMode('voice')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                </svg>
                Voice
              </button>
            </div>

            {inputMode === 'text' ? (
              <div className="jasper-text-input">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={enabledKBs.length > 0 ? "Ask Jasper anything..." : "Select a knowledge base to start chatting..."}
                  rows={2}
                  disabled={jasperState === 'thinking' || isInitializing}
                />
                <button
                  className="jasper-send-btn"
                  onClick={sendMessage}
                  disabled={!inputText.trim() || jasperState === 'thinking' || isInitializing}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="jasper-voice-input">
                <button
                  className={`jasper-mic-btn ${isListening ? 'listening' : ''}`}
                  onClick={toggleListening}
                  disabled={jasperState === 'thinking'}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                  </svg>
                  <span>{isListening ? 'Stop Listening' : 'Start Listening'}</span>
                </button>
                {inputText && (
                  <div className="jasper-voice-preview">
                    <p>{inputText}</p>
                    <button onClick={sendMessage} disabled={jasperState === 'thinking'}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
            </>
          )}

          {/* Study Mode Tab */}
          {activeTab === 'study' && (
            <div className="jasper-study-content">
              {!studySession ? (
                <div className="jasper-study-selector">
                  <div className="jasper-study-header">
                    <div className="jasper-welcome-orb">
                      <JasperOrb state="idle" size="medium" />
                    </div>
                    <h3>Study with Jasper</h3>
                    <p>Choose a learning technique to start a guided study session</p>
                  </div>

                  {enabledKBs.length === 0 ? (
                    <div className="jasper-study-empty">
                      <p>Select a knowledge base from the sidebar to start studying.</p>
                    </div>
                  ) : (
                    <div className="jasper-technique-grid">
                      {Object.entries(STUDY_TECHNIQUES).map(([key, technique]) => (
                        <button
                          key={key}
                          className={`jasper-technique-card ${selectedTechnique === key ? 'selected' : ''}`}
                          onClick={() => startStudySession(key)}
                        >
                          <div className="technique-icon">
                            {key === 'retrieval-practice' && (
                              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                              </svg>
                            )}
                            {key === 'elaborative-interrogation' && (
                              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                                <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
                              </svg>
                            )}
                            {key === 'feynman-technique' && (
                              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                                <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/>
                              </svg>
                            )}
                            {key === 'interleaving' && (
                              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                                <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
                              </svg>
                            )}
                            {key === 'dual-coding' && (
                              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                                <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5z"/>
                                <circle cx="8" cy="10" r="2"/>
                                <path d="M13 11l2-3 3 4H8z"/>
                              </svg>
                            )}
                          </div>
                          <h4>{technique.name}</h4>
                          <p>{technique.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="jasper-study-session">
                  <div className="jasper-session-header">
                    <div className="jasper-session-info">
                      <h3>{STUDY_TECHNIQUES[studySession.technique as keyof typeof STUDY_TECHNIQUES]?.name}</h3>
                      <span className="jasper-session-topic">Topic: {studySession.topic}</span>
                    </div>
                    <div className="jasper-session-progress">
                      <span className="jasper-progress-text">
                        Step {studySession.currentStep} of {studySession.totalSteps}
                      </span>
                      <div className="jasper-progress-bar">
                        <div
                          className="jasper-progress-fill"
                          style={{ width: `${(studySession.currentStep / studySession.totalSteps) * 100}%` }}
                        />
                      </div>
                    </div>
                    <button className="jasper-end-session-btn" onClick={endStudySession}>
                      End Session
                    </button>
                  </div>

                  {/* Study Session Messages */}
                  <div className="jasper-messages jasper-study-messages">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`jasper-message jasper-message-${message.role}`}
                      >
                        {(message.role === 'jasper' || message.role === 'system') && (
                          <div className="jasper-message-avatar">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                              <circle cx="12" cy="12" r="10" fill="url(#jasperStudyGradient)" />
                              <defs>
                                <linearGradient id="jasperStudyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                  <stop offset="0%" stopColor="#4A90D9" />
                                  <stop offset="100%" stopColor="#7C4DFF" />
                                </linearGradient>
                              </defs>
                            </svg>
                          </div>
                        )}
                        <div className="jasper-message-bubble">
                          <div className="jasper-message-content">
                            {(message.role === 'jasper' || message.role === 'system') &&
                            voiceEnabled &&
                            highlightEnabled &&
                            currentSpeakingMessage === message.id ? (
                              <SyncedTextReader
                                text={stripMarkdown(message.content)}
                                showControls={false}
                                autoPlay={true}
                                onSpeakingEnd={handleSpeakingEnd}
                                highlightSettings={{
                                  enabled: true,
                                  style: 'word',
                                  hotspotColor: '#00BCD4',
                                  pastFadeColor: '#4ade80',
                                  futureGlowColor: '#60a5fa',
                                  fadeDuration: 1.0,
                                  anticipationRange: 2,
                                  autoScroll: true,
                                  scrollSpeed: 3,
                                }}
                                voiceSettings={{
                                  rate: voiceConfig?.rate ?? 1.0,
                                  pitch: voiceConfig?.pitch ?? 0,
                                  volume: voiceConfig?.volume ?? 80,
                                  selectedVoiceId: 'default',
                                  selectedVoiceName: voiceConfig?.selectedVoiceName,
                                }}
                              />
                            ) : (
                              <MarkdownRenderer content={message.content} />
                            )}
                          </div>
                        </div>
                        {message.role === 'user' && (
                          <div className="jasper-message-avatar jasper-user-avatar">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                            </svg>
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Study Input Area */}
                  <div className="jasper-input-area">
                    <div className="jasper-text-input">
                      <textarea
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type your answer or response..."
                        rows={2}
                        disabled={jasperState === 'thinking'}
                      />
                      <button
                        className="jasper-send-btn"
                        onClick={sendMessage}
                        disabled={!inputText.trim() || jasperState === 'thinking'}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Review Mode Tab */}
          {activeTab === 'review' && (
            <div className="jasper-review-content">
              {/* Review Stats Header */}
              <div className="jasper-review-stats">
                <div className="jasper-stat-item">
                  <span className="jasper-stat-value">{reviewStats.reviewed}</span>
                  <span className="jasper-stat-label">Reviewed</span>
                </div>
                <div className="jasper-stat-item">
                  <span className="jasper-stat-value">{reviewStats.remaining}</span>
                  <span className="jasper-stat-label">Remaining</span>
                </div>
                <div className="jasper-stat-item">
                  <span className="jasper-stat-value">{Math.round(reviewStats.accuracy)}%</span>
                  <span className="jasper-stat-label">Accuracy</span>
                </div>
              </div>

              {reviewItems.length === 0 ? (
                <div className="jasper-review-empty">
                  <div className="jasper-welcome-orb">
                    <JasperOrb state="success" size="medium" />
                  </div>
                  <h3>No Items to Review</h3>
                  {enabledKBs.length === 0 ? (
                    <p>Select a knowledge base to start creating review items from your study sessions.</p>
                  ) : (
                    <>
                      <p>Great job! You're all caught up on your reviews.</p>
                      <p className="jasper-review-hint">
                        Start a Study session to create new items for spaced repetition.
                      </p>
                    </>
                  )}
                </div>
              ) : currentReviewItem ? (
                <div className="jasper-review-card">
                  <div className="jasper-review-card-header">
                    <span className="jasper-review-source">
                      {currentReviewItem.sectionTitle}
                    </span>
                    <span className="jasper-review-count">
                      {reviewStats.reviewed + 1} / {reviewStats.reviewed + reviewStats.remaining}
                    </span>
                  </div>

                  <div className="jasper-review-card-content">
                    <div className="jasper-review-question">
                      <h4>Question</h4>
                      <p>What do you remember about this topic?</p>
                    </div>

                    {showAnswer && (
                      <div className="jasper-review-answer">
                        <h4>Answer</h4>
                        <p>Review the content from your knowledge base for the correct answer.</p>
                        <button
                          className="jasper-view-source-btn"
                          onClick={() => onNavigateToSource?.(currentReviewItem.kbId, currentReviewItem.sectionId)}
                        >
                          View Source
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="jasper-review-card-actions">
                    {!showAnswer ? (
                      <button
                        className="jasper-show-answer-btn"
                        onClick={() => setShowAnswer(true)}
                      >
                        Show Answer
                      </button>
                    ) : (
                      <div className="jasper-rating-buttons">
                        <p className="jasper-rating-prompt">How well did you remember?</p>
                        <div className="jasper-rating-row">
                          <button
                            className="jasper-rating-btn jasper-rating-fail"
                            onClick={() => rateReviewItem(1)}
                          >
                            Again
                          </button>
                          <button
                            className="jasper-rating-btn jasper-rating-hard"
                            onClick={() => rateReviewItem(2)}
                          >
                            Hard
                          </button>
                          <button
                            className="jasper-rating-btn jasper-rating-good"
                            onClick={() => rateReviewItem(4)}
                          >
                            Good
                          </button>
                          <button
                            className="jasper-rating-btn jasper-rating-easy"
                            onClick={() => rateReviewItem(5)}
                          >
                            Easy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="jasper-review-start">
                  <div className="jasper-welcome-orb">
                    <JasperOrb state="idle" size="medium" />
                  </div>
                  <h3>Ready to Review</h3>
                  <p>You have {reviewItems.length} items due for review.</p>
                  <button className="jasper-start-review-btn" onClick={startReview}>
                    Start Review Session
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default JasperChat;
