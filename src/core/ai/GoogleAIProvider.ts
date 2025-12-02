import { BaseAIProvider } from './BaseProvider';
import {
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIMessage,
  AITool,
  AIToolCall,
} from '../../shared/ai-types';
import { createLogger } from '../../shared/logger';

const log = createLogger('GoogleAI');

interface GoogleMessagePart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GoogleMessage {
  role: string;
  parts: GoogleMessagePart[];
}

interface GoogleFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GoogleResponsePart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

interface GoogleResponse {
  candidates: Array<{
    content: {
      parts: GoogleResponsePart[];
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GoogleAIProvider extends BaseAIProvider {
  constructor(apiKey: string, endpoint: string = 'https://generativelanguage.googleapis.com/v1beta') {
    super('google', 'Google AI', endpoint, apiKey);
  }

  async createCompletion(request: AICompletionRequest): Promise<AICompletionResponse> {
    this.validateRequest(request);

    const googleRequest: Record<string, unknown> = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 1.0,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        stopSequences: request.stop,
      },
    };

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      googleRequest.tools = [{
        functionDeclarations: this.convertTools(request.tools),
      }];

      // Set tool config based on toolChoice
      if (request.toolChoice === 'auto') {
        googleRequest.toolConfig = {
          functionCallingConfig: {
            mode: 'AUTO',
          },
        };
      } else if (request.toolChoice === 'none') {
        googleRequest.toolConfig = {
          functionCallingConfig: {
            mode: 'NONE',
          },
        };
      }
    }

    log.debug('Request with tools:', JSON.stringify(googleRequest, null, 2).substring(0, 1000));

    const response = await this.makeRequest<GoogleResponse>(
      `${this.endpoint}/models/${request.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        body: JSON.stringify(googleRequest),
      }
    );

    log.debug('Response:', JSON.stringify(response, null, 2).substring(0, 1000));

    return this.convertResponse(response);
  }

  async *createStreamingCompletion(
    request: AICompletionRequest
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.validateRequest(request);

    const googleRequest = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 1.0,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        stopSequences: request.stop,
      },
    };

    const response = await fetch(
      `${this.endpoint}/models/${request.model}:streamGenerateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(googleRequest),
      }
    );

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('{')) continue;

          try {
            const parsed = JSON.parse(trimmed);

            if (parsed.candidates && parsed.candidates.length > 0) {
              const candidate = parsed.candidates[0];
              const text = candidate.content?.parts?.[0]?.text || '';

              yield {
                id: 'google-stream',
                model: request.model,
                created: Date.now(),
                choices: [{
                  index: 0,
                  delta: {
                    content: text,
                  },
                  finishReason: candidate.finishReason === 'STOP' ? 'stop' : null,
                }],
              };
            }
          } catch (error) {
            console.error('Failed to parse streaming chunk:', error);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    const response = await this.makeRequest<{ models: Array<{ name: string }> }>(
      `${this.endpoint}/models?key=${this.apiKey}`,
      {
        method: 'GET',
      }
    );

    return response.models
      .map(model => model.name.replace('models/', ''))
      .filter(name => name.startsWith('gemini'));
  }

  async validateApiKey(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert AITool[] to Google's functionDeclarations format
   */
  protected convertTools(tools: AITool[]): GoogleFunctionDeclaration[] {
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  }

  protected convertMessages(messages: AIMessage[]): GoogleMessage[] {
    // Extract system message content
    const systemMessage = messages.find(m => m.role === 'system');
    let systemPrepended = false;

    const conversationMessages: GoogleMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // System messages handled separately
        continue;
      }

      if (msg.role === 'user') {
        let content = msg.content;

        // Prepend system message to first user message
        if (systemMessage && !systemPrepended) {
          content = `[System Context]\n${systemMessage.content}\n\n[User Message]\n${content}`;
          systemPrepended = true;
        }

        conversationMessages.push({
          role: 'user',
          parts: [{ text: content }],
        });
      } else if (msg.role === 'assistant') {
        // Check if this assistant message has tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Convert tool calls to Google's functionCall format
          const parts: GoogleMessagePart[] = [];

          // Add text content if any
          if (msg.content) {
            parts.push({ text: msg.content });
          }

          // Add function calls
          for (const toolCall of msg.tool_calls) {
            parts.push({
              functionCall: {
                name: toolCall.function.name,
                args: JSON.parse(toolCall.function.arguments),
              },
            });
          }

          conversationMessages.push({
            role: 'model',
            parts,
          });
        } else {
          conversationMessages.push({
            role: 'model',
            parts: [{ text: msg.content }],
          });
        }
      } else if (msg.role === 'tool') {
        // Tool response - Google expects functionResponse parts
        // Parse the tool result if it's JSON, otherwise wrap it
        let response: Record<string, unknown>;
        try {
          response = JSON.parse(msg.content);
        } catch {
          response = { result: msg.content };
        }

        // Find the function name from the tool_call_id
        // The tool_call_id should match a function call in a previous assistant message
        const functionName = this.extractFunctionNameFromToolCallId(msg.tool_call_id || '', messages);

        conversationMessages.push({
          role: 'user', // Google expects function responses as 'user' role
          parts: [{
            functionResponse: {
              name: functionName,
              response,
            },
          }],
        });
      }
    }

    return conversationMessages;
  }

  /**
   * Extract function name from tool_call_id by finding the matching call in previous messages
   */
  private extractFunctionNameFromToolCallId(toolCallId: string, messages: AIMessage[]): string {
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const call of msg.tool_calls) {
          if (call.id === toolCallId) {
            return call.function.name;
          }
        }
      }
    }
    // Fallback: try to extract from the ID format (e.g., "call_search_kb_content_0")
    const match = toolCallId.match(/call_([^_]+(?:_[^_]+)*?)_\d+$/);
    if (match) {
      return match[1];
    }
    return 'unknown_function';
  }

  protected convertResponse(response: GoogleResponse): AICompletionResponse {
    const candidate = response.candidates[0];

    // Extract text content
    const textParts = candidate.content.parts.filter(p => p.text);
    const text = textParts.map(p => p.text || '').join('');

    // Extract function calls
    const functionCallParts = candidate.content.parts.filter(p => p.functionCall);
    const toolCalls: AIToolCall[] = functionCallParts.map((part, index) => ({
      id: `call_${part.functionCall!.name}_${Date.now()}_${index}`,
      type: 'function' as const,
      function: {
        name: part.functionCall!.name,
        arguments: JSON.stringify(part.functionCall!.args),
      },
    }));

    // Determine finish reason
    let finishReason: 'stop' | 'tool_calls' | null = null;
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (candidate.finishReason === 'STOP') {
      finishReason = 'stop';
    }

    const message: AIMessage = {
      role: 'assistant',
      content: text,
    };

    // Add tool_calls if present
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: 'google-' + Date.now(),
      model: 'gemini',
      created: Date.now(),
      choices: [{
        index: 0,
        message,
        finishReason,
      }],
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      },
    };
  }
}
