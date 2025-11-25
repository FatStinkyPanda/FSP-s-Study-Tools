import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface UserProgress {
  totalSections: number;
  completedSections: number;
  averageScore: number;
  studyStreak: number;
  sectionsNeedingReview: number;
}

// KB Structure types for AI context
interface KBSection {
  id: string;
  title: string;
  order: number;
}

interface KBChapter {
  id: string;
  title: string;
  description?: string;
  order: number;
  sections: KBSection[];
}

interface KBModule {
  id: string;
  title: string;
  description?: string;
  order: number;
  chapters: KBChapter[];
}

interface KBStructure {
  title: string;
  modules: KBModule[];
}

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  currentQuestion?: string;
  currentTopic?: string;
  knowledgeBaseId?: number;
  sectionContent?: string;
  userProgress?: UserProgress;
  kbTitle?: string;
  kbStructure?: KBStructure;
  isGlobalMode?: boolean; // For Study screen without KB selected
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

function ChatPanel({
  isOpen,
  onToggle,
  currentQuestion,
  currentTopic,
  knowledgeBaseId,
  sectionContent,
  userProgress,
  kbTitle,
  kbStructure,
  isGlobalMode = false
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<Array<{
    module_id: string;
    chapter_id: string;
    section_id: string;
    content: string;
    relevance: number;
  }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track the last KB ID to detect when user switches KBs
  const lastKbIdRef = useRef<number | undefined>(undefined);

  // Reset conversation when KB changes (user switched to a different KB)
  useEffect(() => {
    if (knowledgeBaseId !== undefined && lastKbIdRef.current !== undefined &&
        knowledgeBaseId !== lastKbIdRef.current && conversationId !== null) {
      console.log('[ChatPanel] KB changed, resetting conversation:', {
        from: lastKbIdRef.current,
        to: knowledgeBaseId
      });
      setMessages([]);
      setConversationId(null);
    }
    lastKbIdRef.current = knowledgeBaseId;
  }, [knowledgeBaseId]);

  // Initialize conversation when panel opens and KB structure is available
  // For non-global mode, wait for kbStructure to be loaded before creating conversation
  // This ensures the system message contains the full KB context
  useEffect(() => {
    const shouldInitialize = isOpen && !conversationId && (
      isGlobalMode || // Global mode doesn't need kbStructure
      (knowledgeBaseId && kbStructure && kbStructure.modules.length > 0) // KB mode needs structure
    );

    if (shouldInitialize) {
      console.log('[ChatPanel] Initializing conversation with KB structure:', {
        isGlobalMode,
        knowledgeBaseId,
        hasKbStructure: !!kbStructure,
        moduleCount: kbStructure?.modules?.length || 0
      });
      initializeConversation();
    }
  }, [isOpen, knowledgeBaseId, isGlobalMode, kbStructure]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initializeConversation = async () => {
    // Allow initialization for either specific KB or global mode
    if (!knowledgeBaseId && !isGlobalMode) return;

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

      // Build context-aware system message with full KB structure
      const buildSystemMessage = () => {
        let message: string;

        if (isGlobalMode) {
          // Global mode: AI has access to search all knowledge bases
          message = `You are an AI tutor helping a student learn from their study materials.
Be concise, clear, and encouraging. Focus on helping them understand concepts, not just giving answers.

MODE: GLOBAL TUTOR
You are operating in GLOBAL mode, meaning the student has not selected a specific knowledge base yet.
You have access to search ALL knowledge bases in the system to find relevant content.

When the student asks a question:
1. Relevant content from ALL knowledge bases will be automatically searched and provided to you.
2. The search results will include the KB title, module, chapter, and section for each result.
3. Use this information to provide comprehensive answers drawing from multiple sources.
4. When citing information, mention which knowledge base it comes from.

You can help the student with:
- General questions about any topic covered in their knowledge bases
- Finding relevant content across all their study materials
- Comparing information from different sources
- Recommending which knowledge base to study based on their questions

Be helpful and guide the student to the right materials for their learning goals.`;
        } else {
          // Specific KB mode
          message = `You are an AI tutor helping a student learn from their study materials.
Be concise, clear, and encouraging. Focus on helping them understand concepts, not just giving answers.

IMPORTANT: You have full access to the knowledge base structure and content. When the student asks about specific modules, chapters, or sections, you KNOW what they're referring to because you can see the complete table of contents below.`;

          // Add knowledge base context with full structure
          if (kbTitle) {
            message += `\n\n=== ACTIVE KNOWLEDGE BASE ===`;
            message += `\nTitle: "${kbTitle}"`;
          }

          // Add the complete KB structure (table of contents)
          if (kbStructure && kbStructure.modules.length > 0) {
            message += `\n\n=== TABLE OF CONTENTS ===`;
            kbStructure.modules.forEach((module, mIdx) => {
              message += `\n\nModule ${mIdx + 1}: ${module.title}`;
              if (module.description) {
                message += `\n  Description: ${module.description}`;
              }
              module.chapters.forEach((chapter, cIdx) => {
                message += `\n  Chapter ${cIdx + 1}: ${chapter.title}`;
                if (chapter.description) {
                  message += `\n    Description: ${chapter.description}`;
                }
                chapter.sections.forEach((section, sIdx) => {
                  message += `\n    - Section ${sIdx + 1}: ${section.title}`;
                });
              });
            });
            message += `\n\n=== END TABLE OF CONTENTS ===`;
          }

          // Add current topic/selection context
          if (currentTopic) {
            message += `\n\n=== CURRENT FOCUS ===`;
            message += `\nThe student is currently viewing: ${currentTopic}`;
          }

          // Add user progress context for personalized tutoring
          if (userProgress) {
            const completionPercent = userProgress.totalSections > 0
              ? Math.round((userProgress.completedSections / userProgress.totalSections) * 100)
              : 0;

            message += `\n\n=== STUDENT PROGRESS ===`;
            message += `\nOverall completion: ${completionPercent}% (${userProgress.completedSections}/${userProgress.totalSections} sections)`;
            message += `\nAverage score: ${Math.round(userProgress.averageScore)}%`;
            message += `\nCurrent study streak: ${userProgress.studyStreak} days`;

            if (userProgress.sectionsNeedingReview > 0) {
              message += `\nSections needing review: ${userProgress.sectionsNeedingReview}`;
            }

            // Add personalized guidance based on progress
            if (userProgress.averageScore < 60) {
              message += `\n\nNote: This student has a lower average score. Be extra patient, break concepts down further, and use more examples.`;
            } else if (userProgress.averageScore >= 85) {
              message += `\n\nNote: This student is performing well. You can be more concise and challenge them with deeper questions.`;
            }

            if (userProgress.studyStreak >= 7) {
              message += `\nThis student has been studying consistently - acknowledge their dedication when appropriate.`;
            }
          }

          // Add current section content for context
          if (sectionContent) {
            message += `\n\n=== CURRENT SECTION CONTENT ===`;
            const truncatedContent = sectionContent.length > 3000
              ? sectionContent.substring(0, 3000) + '...[truncated]'
              : sectionContent;
            message += `\n${truncatedContent}`;
            message += `\n=== END CURRENT SECTION ===`;
          }

          message += `\n\nINSTRUCTIONS:
1. When the student asks about a specific chapter, module, or section, refer to the TABLE OF CONTENTS above to answer accurately.
2. If they ask "what does Chapter 2 talk about?", find Chapter 2 in the structure and describe its content/sections.
3. You can see the full hierarchy - use it to provide context-aware answers.
4. If the current section content is provided, use it to give detailed explanations.
5. Be helpful and guide the student through the material effectively.`;
        }

        return message;
      };

      const systemMessage = buildSystemMessage();

      // Debug: Log the system message to see KB structure
      console.log('[ChatPanel] System message length:', systemMessage.length);
      console.log('[ChatPanel] kbStructure provided:', !!kbStructure);
      console.log('[ChatPanel] kbStructure modules:', kbStructure?.modules?.length || 0);
      if (kbStructure && kbStructure.modules.length > 0) {
        console.log('[ChatPanel] First module:', kbStructure.modules[0].title);
        console.log('[ChatPanel] First module chapters:', kbStructure.modules[0].chapters.map(c => c.title));
      }
      console.log('[ChatPanel] System message preview:', systemMessage.substring(0, 500));

      // For global mode, use 0 or null as the KB ID
      const kbIdForConversation = isGlobalMode ? 0 : knowledgeBaseId;

      const convId = await window.electronAPI.invoke(
        'conversation:create',
        kbIdForConversation,
        systemMessage
      ) as number;

      setConversationId(convId);

      // Add welcome message appropriate to the mode
      const welcomeMessage = isGlobalMode
        ? 'Hi! I\'m your AI tutor. I have access to all your knowledge bases and can help you find and learn from any of your study materials. What would you like to learn about?'
        : 'Hi! I\'m your AI tutor. Ask me anything about the material you\'re studying, and I\'ll help explain it in a way that makes sense.';

      setMessages([{
        role: 'assistant',
        content: welcomeMessage,
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

  // Helper function to extract search keywords from user message
  const extractSearchKeywords = (message: string): string[] => {
    // Remove common words and extract meaningful keywords
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here',
      'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
      'because', 'until', 'while', 'about', 'against', 'what', 'which', 'who',
      'whom', 'this', 'that', 'these', 'those', 'am', 'it', 'its', 'me', 'my',
      'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
      'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her',
      'hers', 'herself', 'they', 'them', 'their', 'theirs', 'themselves',
      'tell', 'explain', 'describe', 'help', 'understand', 'know', 'learn',
      'please', 'thanks', 'thank', 'hi', 'hello', 'hey'
    ]);

    // Extract words, filter out stop words and short words
    const words = message.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Return unique keywords, max 5
    return [...new Set(words)].slice(0, 5);
  };

  // Search KB for relevant content based on user message
  const searchKBContent = async (message: string): Promise<string> => {
    const keywords = extractSearchKeywords(message);
    if (keywords.length === 0) return '';

    try {
      // Search using FTS5 with OR for broader results
      const searchQuery = keywords.join(' OR ');

      if (isGlobalMode) {
        // Global mode: search across all knowledge bases
        const results = await window.electronAPI.invoke(
          'kb:searchAll',
          searchQuery,
          15 // Get top 15 results across all KBs
        ) as Array<{
          kb_id: number;
          kb_title: string;
          module_id: string;
          chapter_id: string;
          section_id: string;
          content: string;
          content_type: string;
          rank: number;
        }>;

        if (!results || results.length === 0) return '';

        // Build context from search results
        let searchContext = '\n\n=== RELEVANT CONTENT FROM ALL KNOWLEDGE BASES ===';
        searchContext += '\n(Found based on keywords: ' + keywords.join(', ') + ')\n';

        // Group results by KB and section for better organization
        const seenSections = new Set<string>();
        for (const result of results) {
          const sectionKey = `${result.kb_id}/${result.module_id}/${result.chapter_id}/${result.section_id}`;
          if (seenSections.has(sectionKey)) continue;
          seenSections.add(sectionKey);

          // Truncate long content
          const truncatedContent = result.content.length > 800
            ? result.content.substring(0, 800) + '...[truncated]'
            : result.content;

          // Remove HTML highlight markers
          const cleanContent = truncatedContent.replace(/<\/?mark>/g, '');

          searchContext += `\n--- From KB: "${result.kb_title}" ---`;
          searchContext += `\nModule: ${result.module_id}, Chapter: ${result.chapter_id}, Section: ${result.section_id}`;
          searchContext += `\nContent: ${cleanContent}\n`;
        }

        searchContext += '\n=== END RELEVANT CONTENT ===';
        return searchContext;
      } else if (knowledgeBaseId) {
        // Specific KB mode: search within the selected knowledge base
        const results = await window.electronAPI.invoke(
          'kb:search',
          knowledgeBaseId,
          searchQuery,
          10 // Get top 10 results
        ) as Array<{
          module_id: string;
          chapter_id: string;
          section_id: string;
          content: string;
          content_type: string;
          rank: number;
        }>;

        if (!results || results.length === 0) return '';

        // Build context from search results
        let searchContext = '\n\n=== RELEVANT CONTENT FROM KNOWLEDGE BASE ===';
        searchContext += '\n(Found based on keywords: ' + keywords.join(', ') + ')\n';

        // Group results by section for better organization
        const seenSections = new Set<string>();
        for (const result of results) {
          const sectionKey = `${result.module_id}/${result.chapter_id}/${result.section_id}`;
          if (seenSections.has(sectionKey)) continue;
          seenSections.add(sectionKey);

          // Truncate long content
          const truncatedContent = result.content.length > 1000
            ? result.content.substring(0, 1000) + '...[truncated]'
            : result.content;

          // Remove HTML highlight markers
          const cleanContent = truncatedContent.replace(/<\/?mark>/g, '');

          searchContext += `\n--- Section: ${result.section_id} ---`;
          searchContext += `\nModule: ${result.module_id}, Chapter: ${result.chapter_id}`;
          searchContext += `\nContent: ${cleanContent}\n`;
        }

        searchContext += '\n=== END RELEVANT CONTENT ===';
        return searchContext;
      }

      return '';
    } catch (error) {
      console.error('KB search error:', error);
      return '';
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
      // Search KB for relevant content based on user's question
      const relevantContent = await searchKBContent(inputMessage);

      // Build contextual message with search results
      let contextualMessage = '';

      // Add context about current question if available
      if (currentQuestion) {
        contextualMessage += `Context: The student is working on this question: "${currentQuestion}"\n\n`;
      }

      // Add relevant KB content found through search
      if (relevantContent) {
        contextualMessage += `${relevantContent}\n\n`;
      }

      contextualMessage += `Student's question: ${inputMessage}`;

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
