// AI Provider Types
export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'local';

export interface AIProvider {
  name: string;
  type: AIProviderType;
  endpoint: string;
  apiKey?: string;
  models: AIModel[];
}

export interface AIModel {
  id: string;
  name: string;
  provider: AIProviderType;
  contextWindow: number;
  maxOutputTokens: number;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

// Conversation Types
export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AIToolCall[];
}

export interface AIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Request/Response Types
export interface AICompletionRequest {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  tools?: AITool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  stream?: boolean;
}

export interface AICompletionResponse {
  id: string;
  model: string;
  created: number;
  choices: AIChoice[];
  usage: AIUsage;
}

export interface AIChoice {
  index: number;
  message: AIMessage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIStreamChunk {
  id: string;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    delta: Partial<AIMessage>;
    finishReason: string | null;
  }>;
}

// Configuration Types
export interface AIConfiguration {
  defaultProvider: AIProviderType;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  providers: AIProviderConfig[];
}

export interface AIProviderConfig {
  type: AIProviderType;
  name: string;
  endpoint: string;
  apiKey: string;
  enabled: boolean;
  models: string[];
}

// Local Model Types
export interface LocalModelConfig {
  id: string;
  name: string;
  path: string;
  type: 'onnx' | 'gguf';
  contextWindow: number;
  loadOnStartup: boolean;
}

// Error Types
export class AIProviderError extends Error {
  constructor(
    message: string,
    public provider: AIProviderType,
    public statusCode?: number,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export class AIRateLimitError extends AIProviderError {
  constructor(provider: AIProviderType, retryAfter?: number) {
    super(`Rate limit exceeded for ${provider}`, provider, 429);
    this.name = 'AIRateLimitError';
    this.retryAfter = retryAfter;
  }
  retryAfter?: number;
}

export class AIAuthenticationError extends AIProviderError {
  constructor(provider: AIProviderType) {
    super(`Authentication failed for ${provider}`, provider, 401);
    this.name = 'AIAuthenticationError';
  }
}

// Knowledge Base Tool Types
export interface KnowledgeBaseTool {
  navigate: (sectionId: string) => Promise<unknown>;
  search: (query: string, scope?: string) => Promise<unknown[]>;
  getProgress: (sectionId?: string) => Promise<unknown>;
  generateTest: (sectionIds: string[], count: number, difficulty: string) => Promise<unknown>;
}
