import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  currentQuestion?: string;
  currentTopic?: string;
  knowledgeBaseId?: number;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

function ChatPanel({ isOpen, onToggle, currentQuestion, currentTopic, knowledgeBaseId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize conversation when panel opens
  useEffect(() => {
    if (isOpen && !conversationId && knowledgeBaseId) {
      initializeConversation();
    }
  }, [isOpen, knowledgeBaseId]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initializeConversation = async () => {
    if (!knowledgeBaseId) return;

    try {
      // Check if any AI providers are configured
      const settings = await window.electronAPI.invoke('settings:getAll') as {
        openai_api_key?: string;
        anthropic_api_key?: string;
        google_api_key?: string;
        openrouter_api_key?: string;
      };

      const hasApiKey = !!(
        settings.openai_api_key ||
        settings.anthropic_api_key ||
        settings.google_api_key ||
        settings.openrouter_api_key
      );

      if (!hasApiKey) {
        setMessages([{
          role: 'assistant',
          content: 'Welcome to the AI Tutor! To use this feature, you need to add an API key in Settings. Go to Settings and add an API key for OpenAI, Anthropic, Google AI, or OpenRouter.',
          timestamp: new Date()
        }]);
        return;
      }

      const systemMessage = `You are an AI tutor helping a student learn from their study materials.
Be concise, clear, and encouraging. Focus on helping them understand concepts, not just giving answers.
${currentTopic ? `Current topic: ${currentTopic}` : ''}`;

      const convId = await window.electronAPI.invoke(
        'conversation:create',
        knowledgeBaseId,
        systemMessage
      ) as number;

      setConversationId(convId);

      // Add welcome message
      setMessages([{
        role: 'assistant',
        content: 'Hi! I\'m your AI tutor. Ask me anything about the material you\'re studying, and I\'ll help explain it in a way that makes sense.',
        timestamp: new Date()
      }]);
    } catch (error) {
      console.error('Failed to initialize conversation:', error);
      setMessages([{
        role: 'assistant',
        content: 'Failed to initialize AI tutor. Please check your API key in Settings.',
        timestamp: new Date()
      }]);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !conversationId || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: inputMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Add context about current question if available
      const contextualMessage = currentQuestion
        ? `Context: The student is working on this question: "${currentQuestion}"\n\nStudent's question: ${inputMessage}`
        : inputMessage;

      // Send to AI
      const response = await window.electronAPI.invoke(
        'conversation:addMessage',
        conversationId,
        {
          role: 'user',
          content: contextualMessage
        }
      ) as { success: boolean; message: { role: string; content: string }; error?: string };

      // Check for errors
      if (!response.success && response.error) {
        console.error('AI response error:', response.error);
      }

      // Add AI response
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.message.content,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);

      // Provide specific error messages based on error type
      let errorContent = 'Sorry, I encountered an error. Please try again.';

      const errorMessage = (error as Error).message;
      if (errorMessage.includes('No AI providers configured')) {
        errorContent = 'No AI provider is configured. Please add an API key in Settings to use the AI tutor.';
      } else if (errorMessage.includes('API key')) {
        errorContent = 'There is an issue with your API key. Please check your Settings and make sure you have entered a valid API key.';
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
        errorContent = 'You have exceeded your API rate limit. Please try again later or check your API provider quota.';
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        errorContent = 'Network error: Unable to connect to the AI service. Please check your internet connection.';
      }

      const assistantErrorMessage: Message = {
        role: 'assistant',
        content: errorContent,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantErrorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickQuestions = [
    'Explain this concept in simpler terms',
    'What are the key points to remember?',
    'Can you give me an example?',
    'Why is this important?'
  ];

  const askQuickQuestion = (question: string) => {
    setInputMessage(question);
  };

  const clearChat = () => {
    setMessages([]);
    setConversationId(null);
    if (isOpen && knowledgeBaseId) {
      initializeConversation();
    }
  };

  return (
    <div className={`chat-panel ${isOpen ? 'open' : 'closed'}`}>
      <div className="chat-header">
        <div className="chat-header-content">
          <h3>AI Tutor</h3>
          {messages.length > 1 && (
            <button className="chat-clear-button" onClick={clearChat} title="Clear conversation">
              Clear
            </button>
          )}
        </div>
        <button className="chat-toggle-button" onClick={onToggle}>
          {isOpen ? '×' : '?'}
        </button>
      </div>

      {isOpen && (
        <>
          <div className="chat-messages">
            {messages.map((message, index) => (
              <div key={index} className={`chat-message ${message.role}`}>
                <div className="message-header">
                  <span className="message-role">
                    {message.role === 'user' ? 'You' : 'AI Tutor'}
                  </span>
                  <span className="message-time">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="message-content">{message.content}</div>
              </div>
            ))}

            {isLoading && (
              <div className="chat-message assistant">
                <div className="message-header">
                  <span className="message-role">AI Tutor</span>
                </div>
                <div className="message-content typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {messages.length <= 1 && (
            <div className="quick-questions">
              <p className="quick-questions-label">Quick questions:</p>
              <div className="quick-questions-grid">
                {quickQuestions.map((question, index) => (
                  <button
                    key={index}
                    className="quick-question-button"
                    onClick={() => askQuickQuestion(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="chat-input-container">
            <input
              type="text"
              className="chat-input"
              placeholder="Ask your tutor..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading || !conversationId}
            />
            <button
              className="chat-send-button"
              onClick={sendMessage}
              disabled={!inputMessage.trim() || isLoading || !conversationId}
            >
              Send
            </button>
          </div>
        </>
      )}

      {!isOpen && (
        <div className="chat-preview">
          <p>Need help? Click to chat with your AI tutor</p>
        </div>
      )}
    </div>
  );
}

export default ChatPanel;
