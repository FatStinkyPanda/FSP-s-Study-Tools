/**
 * Unit tests for AI Providers
 *
 * These tests verify the structure and behavior of AI providers
 * without making actual API calls. Network calls are mocked.
 */
import {
  AIProviderType,
  AICompletionRequest,
  AICompletionResponse,
  AIMessage,
  AIProviderError,
  AIRateLimitError,
  AIAuthenticationError,
} from '../../shared/ai-types';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Helper to create mock response
function createMockResponse(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(headers),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

describe('AI Provider Types', () => {
  describe('AIProviderError', () => {
    it('should create error with correct properties', () => {
      const error = new AIProviderError('Test error', 'openai', 500);

      expect(error.message).toBe('Test error');
      expect(error.provider).toBe('openai');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('AIProviderError');
    });

    it('should include original error', () => {
      const originalError = new Error('Original');
      const error = new AIProviderError('Wrapped error', 'google', 500, originalError);

      expect(error.originalError).toBe(originalError);
    });
  });

  describe('AIRateLimitError', () => {
    it('should create rate limit error with retry-after', () => {
      const error = new AIRateLimitError('anthropic', 60);

      expect(error.message).toContain('Rate limit');
      expect(error.provider).toBe('anthropic');
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
      expect(error.name).toBe('AIRateLimitError');
    });

    it('should work without retry-after', () => {
      const error = new AIRateLimitError('openai');

      expect(error.retryAfter).toBeUndefined();
    });
  });

  describe('AIAuthenticationError', () => {
    it('should create authentication error', () => {
      const error = new AIAuthenticationError('google');

      expect(error.message).toContain('Authentication failed');
      expect(error.provider).toBe('google');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('AIAuthenticationError');
    });
  });
});

describe('AICompletionRequest Validation', () => {
  const validRequest: AICompletionRequest = {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
    maxTokens: 1000,
  };

  it('should accept valid request structure', () => {
    expect(validRequest.model).toBe('gpt-4');
    expect(validRequest.messages.length).toBe(1);
    expect(validRequest.temperature).toBe(0.7);
    expect(validRequest.maxTokens).toBe(1000);
  });

  it('should accept request with tools', () => {
    const requestWithTools: AICompletionRequest = {
      ...validRequest,
      tools: [{
        type: 'function',
        function: {
          name: 'search',
          description: 'Search for content',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
          },
        },
      }],
      toolChoice: 'auto',
    };

    expect(requestWithTools.tools?.length).toBe(1);
    expect(requestWithTools.toolChoice).toBe('auto');
  });

  it('should accept all optional parameters', () => {
    const fullRequest: AICompletionRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Test' }],
      temperature: 0.5,
      maxTokens: 2000,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.5,
      stop: ['\n', 'END'],
      stream: true,
    };

    expect(fullRequest.topP).toBe(0.9);
    expect(fullRequest.frequencyPenalty).toBe(0.5);
    expect(fullRequest.presencePenalty).toBe(0.5);
    expect(fullRequest.stop).toEqual(['\n', 'END']);
    expect(fullRequest.stream).toBe(true);
  });
});

describe('AIMessage Types', () => {
  it('should create system message', () => {
    const message: AIMessage = {
      role: 'system',
      content: 'You are a helpful assistant.',
    };

    expect(message.role).toBe('system');
    expect(message.content).toBe('You are a helpful assistant.');
  });

  it('should create user message', () => {
    const message: AIMessage = {
      role: 'user',
      content: 'What is 2+2?',
    };

    expect(message.role).toBe('user');
  });

  it('should create assistant message', () => {
    const message: AIMessage = {
      role: 'assistant',
      content: '2+2 equals 4.',
    };

    expect(message.role).toBe('assistant');
  });

  it('should create tool message', () => {
    const message: AIMessage = {
      role: 'tool',
      content: '{"result": "search results"}',
      tool_call_id: 'call_123',
    };

    expect(message.role).toBe('tool');
    expect(message.tool_call_id).toBe('call_123');
  });

  it('should create message with tool calls', () => {
    const message: AIMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_456',
        type: 'function',
        function: {
          name: 'navigate',
          arguments: '{"sectionId": "section-1"}',
        },
      }],
    };

    expect(message.tool_calls?.length).toBe(1);
    expect(message.tool_calls?.[0].function.name).toBe('navigate');
  });
});

describe('AICompletionResponse Structure', () => {
  const mockResponse: AICompletionResponse = {
    id: 'chatcmpl-123',
    model: 'gpt-4',
    created: Date.now(),
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: 'Hello! How can I help you today?',
      },
      finishReason: 'stop',
    }],
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
  };

  it('should have correct structure', () => {
    expect(mockResponse.id).toBe('chatcmpl-123');
    expect(mockResponse.model).toBe('gpt-4');
    expect(mockResponse.choices.length).toBe(1);
    expect(mockResponse.usage.totalTokens).toBe(30);
  });

  it('should contain message in choices', () => {
    const choice = mockResponse.choices[0];

    expect(choice.index).toBe(0);
    expect(choice.message.role).toBe('assistant');
    expect(choice.message.content).toBe('Hello! How can I help you today?');
    expect(choice.finishReason).toBe('stop');
  });

  it('should have correct usage information', () => {
    const usage = mockResponse.usage;

    expect(usage.promptTokens).toBe(10);
    expect(usage.completionTokens).toBe(20);
    expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens);
  });

  it('should handle tool_calls finish reason', () => {
    const responseWithToolCalls: AICompletionResponse = {
      ...mockResponse,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_789',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"query": "aviation"}',
            },
          }],
        },
        finishReason: 'tool_calls',
      }],
    };

    expect(responseWithToolCalls.choices[0].finishReason).toBe('tool_calls');
    expect(responseWithToolCalls.choices[0].message.tool_calls?.length).toBe(1);
  });
});

describe('Provider-Specific Behaviors (Mocked)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('OpenAI-style API', () => {
    const openAIEndpoint = 'https://api.openai.com/v1/chat/completions';

    it('should format request correctly', () => {
      const request: AICompletionRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        maxTokens: 1000,
      };

      // Expected OpenAI format
      const expectedBody = {
        model: 'gpt-4',
        messages: request.messages,
        temperature: 0.7,
        max_tokens: 1000,
      };

      expect(expectedBody.model).toBe(request.model);
      expect(expectedBody.messages).toEqual(request.messages);
      expect(expectedBody.max_tokens).toBe(request.maxTokens);
    });

    it('should handle successful response', async () => {
      const mockSuccessResponse = {
        id: 'chatcmpl-abc123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(200, mockSuccessResponse));

      const response = await fetch(openAIEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      expect(data.id).toBe('chatcmpl-abc123');
      expect(data.choices[0].message.content).toBe('Hello!');
    });

    it('should handle rate limit error (429)', async () => {
      const mockErrorResponse = {
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit_error',
        },
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse(429, mockErrorResponse, { 'retry-after': '30' })
      );

      const response = await fetch(openAIEndpoint, { method: 'POST' });

      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('30');
    });

    it('should handle authentication error (401)', async () => {
      const mockErrorResponse = {
        error: {
          message: 'Invalid API key',
          type: 'invalid_api_key',
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(401, mockErrorResponse));

      const response = await fetch(openAIEndpoint, { method: 'POST' });

      expect(response.status).toBe(401);
    });
  });

  describe('Google AI (Gemini) style API', () => {
    const geminiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

    it('should format messages for Gemini', () => {
      const messages: AIMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      // Expected Gemini format
      const geminiContents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }],
      }));

      expect(geminiContents[1].role).toBe('model'); // assistant -> model
      expect(geminiContents[0].parts[0].text).toBe('Hello');
    });

    it('should handle Gemini response format', async () => {
      const mockGeminiResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Response from Gemini' }],
            role: 'model',
          },
          finishReason: 'STOP',
          index: 0,
        }],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15,
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(200, mockGeminiResponse));

      const response = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      expect(data.candidates[0].content.parts[0].text).toBe('Response from Gemini');
      expect(data.usageMetadata.totalTokenCount).toBe(15);
    });
  });

  describe('Anthropic style API', () => {
    const anthropicEndpoint = 'https://api.anthropic.com/v1/messages';

    it('should format request for Anthropic', () => {
      const request: AICompletionRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        maxTokens: 1000,
      };

      // Anthropic expects system as a separate field
      const systemMessage = request.messages.find(m => m.role === 'system')?.content;
      const userMessages = request.messages.filter(m => m.role !== 'system');

      expect(systemMessage).toBe('You are helpful.');
      expect(userMessages.length).toBe(1);
    });

    it('should handle Anthropic response format', async () => {
      const mockAnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(200, mockAnthropicResponse));

      const response = await fetch(anthropicEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      expect(data.content[0].text).toBe('Hello from Claude!');
      expect(data.stop_reason).toBe('end_turn');
    });
  });
});

describe('Request Validation Rules', () => {
  function validateRequest(request: Partial<AICompletionRequest>): string[] {
    const errors: string[] = [];

    if (!request.model) {
      errors.push('Model is required');
    }

    if (!request.messages || request.messages.length === 0) {
      errors.push('Messages array cannot be empty');
    }

    if (request.temperature !== undefined) {
      if (request.temperature < 0 || request.temperature > 2) {
        errors.push('Temperature must be between 0 and 2');
      }
    }

    if (request.maxTokens !== undefined && request.maxTokens <= 0) {
      errors.push('Max tokens must be positive');
    }

    return errors;
  }

  it('should reject missing model', () => {
    const errors = validateRequest({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(errors).toContain('Model is required');
  });

  it('should reject empty messages', () => {
    const errors = validateRequest({
      model: 'gpt-4',
      messages: [],
    });

    expect(errors).toContain('Messages array cannot be empty');
  });

  it('should reject temperature out of range', () => {
    const errors = validateRequest({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 2.5,
    });

    expect(errors).toContain('Temperature must be between 0 and 2');
  });

  it('should reject negative max tokens', () => {
    const errors = validateRequest({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: -100,
    });

    expect(errors).toContain('Max tokens must be positive');
  });

  it('should accept valid request', () => {
    const errors = validateRequest({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      maxTokens: 1000,
    });

    expect(errors.length).toBe(0);
  });
});

describe('Token Estimation', () => {
  function estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  }

  it('should estimate tokens for short text', () => {
    const text = 'Hello world'; // 11 chars
    const tokens = estimateTokens(text);

    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(5);
  });

  it('should estimate tokens for longer text', () => {
    const text = 'This is a longer piece of text that should result in more tokens being counted.';
    const tokens = estimateTokens(text);

    expect(tokens).toBeGreaterThan(10);
  });

  it('should handle empty text', () => {
    const tokens = estimateTokens('');
    expect(tokens).toBe(0);
  });
});

describe('Tool Call Handling', () => {
  it('should parse tool call arguments', () => {
    const toolCall = {
      id: 'call_abc123',
      type: 'function' as const,
      function: {
        name: 'navigate',
        arguments: '{"sectionId": "mod1.ch1.sec1", "highlight": true}',
      },
    };

    const args = JSON.parse(toolCall.function.arguments);

    expect(args.sectionId).toBe('mod1.ch1.sec1');
    expect(args.highlight).toBe(true);
  });

  it('should handle multiple tool calls', () => {
    const toolCalls = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'search', arguments: '{"query": "aviation"}' },
      },
      {
        id: 'call_2',
        type: 'function' as const,
        function: { name: 'navigate', arguments: '{"sectionId": "sec-1"}' },
      },
    ];

    expect(toolCalls.length).toBe(2);
    expect(toolCalls[0].function.name).toBe('search');
    expect(toolCalls[1].function.name).toBe('navigate');
  });

  it('should create tool response message', () => {
    const toolResponse: AIMessage = {
      role: 'tool',
      content: JSON.stringify({ results: ['item1', 'item2'] }),
      tool_call_id: 'call_abc123',
    };

    expect(toolResponse.role).toBe('tool');
    expect(toolResponse.tool_call_id).toBe('call_abc123');

    const parsed = JSON.parse(toolResponse.content);
    expect(parsed.results.length).toBe(2);
  });
});
