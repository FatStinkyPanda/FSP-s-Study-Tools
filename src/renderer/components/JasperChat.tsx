import React, { useState, useEffect, useRef, useCallback } from 'react';
import JasperOrb, { JasperState } from './JasperOrb';
import SyncedTextReader from './SyncedTextReader';
import './JasperChat.css';

interface Message {
  id: string;
  role: 'user' | 'jasper';
  content: string;
  timestamp: Date;
  source?: {
    knowledgeBase: string;
    section: string;
    page?: string;
  };
}

interface JasperChatProps {
  knowledgeBases: Array<{
    id: number;
    title: string;
    enabled: boolean;
  }>;
  onNavigateToSource?: (kbId: number, sectionId: string) => void;
  onToggleKnowledgeBase?: (kbId: number, enabled: boolean) => void;
  className?: string;
}

export function JasperChat({
  knowledgeBases,
  onNavigateToSource,
  onToggleKnowledgeBase,
  className = '',
}: JasperChatProps): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [jasperState, setJasperState] = useState<JasperState>('idle');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [activeTab, setActiveTab] = useState<'chat' | 'study' | 'review'>('chat');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [currentSpeakingMessage, setCurrentSpeakingMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

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

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setJasperState('thinking');

    try {
      // Simulate AI response - in production, this would call the AI service
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const jasperMessage: Message = {
        id: `jasper-${Date.now()}`,
        role: 'jasper',
        content: generateMockResponse(inputText),
        timestamp: new Date(),
        source: {
          knowledgeBase: 'Sample Knowledge Base',
          section: 'Chapter 1',
          page: 'p. 15',
        },
      };

      setMessages((prev) => [...prev, jasperMessage]);
      setJasperState('idle');

      // Speak the response if voice is enabled
      if (voiceEnabled) {
        setCurrentSpeakingMessage(jasperMessage.id);
        setJasperState('speaking');
      }
    } catch (error) {
      console.error('Failed to get response:', error);
      setJasperState('error');
      setTimeout(() => setJasperState('idle'), 2000);
    }
  }, [inputText, voiceEnabled]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSpeakingEnd = useCallback(() => {
    setCurrentSpeakingMessage(null);
    setIsSpeaking(false);
    if (jasperState === 'speaking') {
      setJasperState('idle');
    }
  }, [jasperState]);

  const handleOrbClick = useCallback(() => {
    if (inputMode === 'voice') {
      toggleListening();
    }
  }, [inputMode, toggleListening]);

  return (
    <div className={`jasper-chat ${className}`}>
      {/* Header */}
      <div className="jasper-chat-header">
        <h2>Jasper AI Learning Assistant</h2>
        <div className="jasper-chat-tabs">
          <button
            className={activeTab === 'chat' ? 'active' : ''}
            onClick={() => setActiveTab('chat')}
          >
            Live Chat
          </button>
          <button
            className={activeTab === 'study' ? 'active' : ''}
            onClick={() => setActiveTab('study')}
          >
            Study Mode
          </button>
          <button
            className={activeTab === 'review' ? 'active' : ''}
            onClick={() => setActiveTab('review')}
          >
            Review Mode
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="jasper-chat-content">
        {/* Sidebar - Knowledge Bases */}
        <div className="jasper-chat-sidebar">
          <div className="jasper-kb-section">
            <h3>Active Knowledge Bases</h3>
            <div className="jasper-kb-list">
              {knowledgeBases.map((kb) => (
                <label key={kb.id} className="jasper-kb-item">
                  <input
                    type="checkbox"
                    checked={kb.enabled}
                    onChange={() => onToggleKnowledgeBase?.(kb.id, !kb.enabled)}
                  />
                  <span>{kb.title}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="jasper-settings-section">
            <h3>Voice Settings</h3>
            <label className="jasper-setting-toggle">
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={() => setVoiceEnabled(!voiceEnabled)}
              />
              <span>Text-to-Speech</span>
            </label>
            <label className="jasper-setting-toggle">
              <input
                type="checkbox"
                checked={highlightEnabled}
                onChange={() => setHighlightEnabled(!highlightEnabled)}
              />
              <span>Text Highlighting</span>
            </label>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="jasper-chat-main">
          {/* Orb Display */}
          <div className="jasper-orb-container">
            <JasperOrb
              state={jasperState}
              size="small"
              audioLevel={audioLevel}
              onClick={handleOrbClick}
            />
            <div className="jasper-status">
              <span className={`jasper-status-dot ${jasperState}`} />
              <span className="jasper-status-text">
                {jasperState === 'idle' && 'Ready'}
                {jasperState === 'listening' && 'Listening...'}
                {jasperState === 'thinking' && 'Thinking...'}
                {jasperState === 'speaking' && 'Speaking...'}
                {jasperState === 'processing' && 'Processing...'}
                {jasperState === 'success' && 'Done!'}
                {jasperState === 'error' && 'Error'}
              </span>
            </div>
          </div>

          {/* Messages Area */}
          <div className="jasper-messages">
            {messages.length === 0 ? (
              <div className="jasper-welcome">
                <p>Hello! I'm Jasper, your AI learning assistant.</p>
                <p>Ask me anything about your knowledge bases, or start a study session.</p>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`jasper-message jasper-message-${message.role}`}
                >
                  <div className="jasper-message-content">
                    {message.role === 'jasper' &&
                    voiceEnabled &&
                    highlightEnabled &&
                    currentSpeakingMessage === message.id ? (
                      <SyncedTextReader
                        text={message.content}
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
                      />
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                  {message.source && (
                    <div
                      className="jasper-message-source"
                      onClick={() => onNavigateToSource?.(1, message.source!.section)}
                    >
                      [Source] {message.source.knowledgeBase} &gt; {message.source.section}
                      {message.source.page && ` &gt; ${message.source.page}`}
                    </div>
                  )}
                  <div className="jasper-message-time">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
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
                [Text]
              </button>
              <button
                className={inputMode === 'voice' ? 'active' : ''}
                onClick={() => setInputMode('voice')}
              >
                [Voice]
              </button>
            </div>

            {inputMode === 'text' ? (
              <div className="jasper-text-input">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask Jasper anything..."
                  rows={2}
                />
                <button
                  className="jasper-send-btn"
                  onClick={sendMessage}
                  disabled={!inputText.trim() || jasperState === 'thinking'}
                >
                  [Send]
                </button>
              </div>
            ) : (
              <div className="jasper-voice-input">
                <button
                  className={`jasper-mic-btn ${isListening ? 'listening' : ''}`}
                  onClick={toggleListening}
                >
                  {isListening ? '[Stop Listening]' : '[Start Listening]'}
                </button>
                {inputText && (
                  <div className="jasper-voice-preview">
                    <p>{inputText}</p>
                    <button onClick={sendMessage}>[Send]</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Mock response generator for demonstration
function generateMockResponse(query: string): string {
  const responses = [
    `That's a great question about "${query.slice(0, 30)}...". Based on your knowledge base, here's what I found: The concept relates to fundamental principles that help build understanding progressively.`,
    `Let me explain that. When we look at "${query.slice(0, 20)}...", we need to consider several key factors that influence the outcome.`,
    `According to your study materials, this topic involves understanding the relationship between different components and how they work together.`,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

export default JasperChat;
