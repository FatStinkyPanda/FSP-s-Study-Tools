import { BaseAIProvider } from './BaseProvider';
import {
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIMessage,
  AIProviderError,
  LocalModelConfig,
} from '../../shared/ai-types';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Local AI Provider for running models offline
 *
 * Supports:
 * - ONNX models via ONNX Runtime
 * - GGUF models via llama.cpp bindings
 */
export class LocalAIProvider extends BaseAIProvider {
  private models: Map<string, LoadedModel> = new Map();
  private modelConfigs: Map<string, LocalModelConfig> = new Map();
  private modelsDirectory: string;

  constructor(modelsDirectory: string = './resources/models') {
    super('local', 'Local AI Models', 'local://models', '');
    this.modelsDirectory = modelsDirectory;
    this.ensureModelsDirectory();
  }

  /**
   * Ensure models directory exists
   */
  private ensureModelsDirectory(): void {
    if (!fs.existsSync(this.modelsDirectory)) {
      fs.mkdirSync(this.modelsDirectory, { recursive: true });
    }
  }

  /**
   * Add a model configuration
   */
  addModelConfig(config: LocalModelConfig): void {
    this.modelConfigs.set(config.id, config);

    if (config.loadOnStartup) {
      this.loadModel(config.id).catch(error => {
        console.error(`Failed to load model ${config.id} on startup:`, error);
      });
    }
  }

  /**
   * Load a model into memory
   */
  async loadModel(modelId: string): Promise<void> {
    const config = this.modelConfigs.get(modelId);
    if (!config) {
      throw new Error(`Model configuration not found: ${modelId}`);
    }

    // Check if model file exists
    const modelPath = path.resolve(this.modelsDirectory, config.path);
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    try {
      let loadedModel: LoadedModel;

      switch (config.type) {
        case 'onnx':
          loadedModel = await this.loadONNXModel(modelPath, config);
          break;

        case 'gguf':
          loadedModel = await this.loadGGUFModel(modelPath, config);
          break;

        default:
          throw new Error(`Unsupported model type: ${config.type}`);
      }

      this.models.set(modelId, loadedModel);
      console.log(`Model loaded successfully: ${modelId}`);
    } catch (error) {
      throw new AIProviderError(
        `Failed to load model ${modelId}: ${(error as Error).message}`,
        'local',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Load ONNX model
   */
  private async loadONNXModel(_modelPath: string, config: LocalModelConfig): Promise<LoadedModel> {
    // Placeholder for ONNX Runtime integration
    // In production, this would use onnxruntime-node
    return {
      id: config.id,
      type: 'onnx',
      config,
      session: null, // ONNX InferenceSession would go here
      generate: async (_prompt: string, _options: GenerationOptions) => {
        // Placeholder implementation
        // In production, this would run inference using ONNX Runtime
        throw new Error('ONNX model inference not yet implemented. Install onnxruntime-node for full support.');
      },
    };
  }

  /**
   * Load GGUF model using llama.cpp
   */
  private async loadGGUFModel(_modelPath: string, config: LocalModelConfig): Promise<LoadedModel> {
    // Placeholder for llama.cpp integration
    // In production, this would use node-llama-cpp or @llama-node/llama-cpp
    return {
      id: config.id,
      type: 'gguf',
      config,
      session: null, // LlamaCpp instance would go here
      generate: async (_prompt: string, _options: GenerationOptions) => {
        // Placeholder implementation
        // In production, this would use llama.cpp bindings
        throw new Error('GGUF model inference not yet implemented. Install node-llama-cpp for full support.');
      },
    };
  }

  /**
   * Unload a model from memory
   */
  async unloadModel(modelId: string): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) {
      return;
    }

    // Cleanup model resources
    if (model.session) {
      // Dispose of ONNX session or llama.cpp context
      // Implementation depends on the library
    }

    this.models.delete(modelId);
    console.log(`Model unloaded: ${modelId}`);
  }

  /**
   * Get loaded model
   */
  private getLoadedModel(modelId: string): LoadedModel {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not loaded: ${modelId}. Call loadModel() first.`);
    }
    return model;
  }

  /**
   * Create a completion using local model
   */
  async createCompletion(request: AICompletionRequest): Promise<AICompletionResponse> {
    this.validateRequest(request);

    const modelId = request.model.replace(/^local:/, ''); // Remove 'local:' prefix
    const model = this.getLoadedModel(modelId);

    try {
      // Convert messages to prompt
      const prompt = this.convertMessagesToPrompt(request.messages);

      // Generate completion
      const generationOptions: GenerationOptions = {
        temperature: request.temperature ?? 0.7,
        maxTokens: request.maxTokens ?? 2048,
        topP: request.topP,
        stop: request.stop,
      };

      const response = await model.generate(prompt, generationOptions);

      // Convert to standard response format
      return {
        id: `local-${Date.now()}`,
        model: request.model,
        created: Math.floor(Date.now() / 1000),
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: response.text,
            },
            finishReason: response.finishReason as 'stop' | 'length' | null,
          },
        ],
        usage: {
          promptTokens: this.estimateTokens(prompt),
          completionTokens: this.estimateTokens(response.text),
          totalTokens: this.estimateTokens(prompt) + this.estimateTokens(response.text),
        },
      };
    } catch (error) {
      throw new AIProviderError(
        `Local model inference failed: ${(error as Error).message}`,
        'local',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Create a streaming completion
   */
  async *createStreamingCompletion(
    request: AICompletionRequest
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.validateRequest(request);

    const modelId = request.model.replace(/^local:/, '');
    const model = this.getLoadedModel(modelId);

    const prompt = this.convertMessagesToPrompt(request.messages);
    const generationOptions: GenerationOptions = {
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? 2048,
      topP: request.topP,
      stop: request.stop,
    };

    // For now, simulate streaming by yielding the full response
    // In production, this would use actual streaming from the model
    try {
      const response = await model.generate(prompt, generationOptions);
      const words = response.text.split(' ');

      for (let i = 0; i < words.length; i++) {
        yield {
          id: `local-${Date.now()}`,
          model: request.model,
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              delta: {
                role: i === 0 ? 'assistant' : undefined,
                content: (i > 0 ? ' ' : '') + words[i],
              },
              finishReason: i === words.length - 1 ? response.finishReason : null,
            },
          ],
        };

        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } catch (error) {
      throw new AIProviderError(
        `Local model streaming failed: ${(error as Error).message}`,
        'local',
        undefined,
        error as Error
      );
    }
  }

  /**
   * List available local models
   */
  async listModels(): Promise<string[]> {
    return Array.from(this.modelConfigs.keys());
  }

  /**
   * Validate local model availability
   */
  async validateApiKey(): Promise<boolean> {
    // For local models, check if any models are configured
    return this.modelConfigs.size > 0;
  }

  /**
   * Convert messages to prompt string
   */
  protected convertMessages(messages: AIMessage[]): string {
    return this.convertMessagesToPrompt(messages);
  }

  /**
   * Convert messages array to prompt string for local model
   */
  private convertMessagesToPrompt(messages: AIMessage[]): string {
    const parts: string[] = [];

    for (const message of messages) {
      switch (message.role) {
        case 'system':
          parts.push(`System: ${message.content}\n`);
          break;
        case 'user':
          parts.push(`User: ${message.content}\n`);
          break;
        case 'assistant':
          parts.push(`Assistant: ${message.content}\n`);
          break;
        default:
          parts.push(`${message.content}\n`);
      }
    }

    parts.push('Assistant:');
    return parts.join('\n');
  }

  /**
   * Convert response (not used for local models)
   */
  protected convertResponse(response: unknown): AICompletionResponse {
    // Local models generate responses directly
    return response as AICompletionResponse;
  }

  /**
   * Get list of loaded models
   */
  getLoadedModels(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * Get model configuration
   */
  getModelConfig(modelId: string): LocalModelConfig | undefined {
    return this.modelConfigs.get(modelId);
  }

  /**
   * Check if model is loaded
   */
  isModelLoaded(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /**
   * Get models directory path
   */
  getModelsDirectory(): string {
    return this.modelsDirectory;
  }

  /**
   * Set models directory path
   */
  setModelsDirectory(directory: string): void {
    this.modelsDirectory = directory;
    this.ensureModelsDirectory();
  }
}

/**
 * Internal types
 */

interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
}

interface GenerationResponse {
  text: string;
  finishReason: string | null;
}

interface LoadedModel {
  id: string;
  type: 'onnx' | 'gguf';
  config: LocalModelConfig;
  session: unknown; // InferenceSession or LlamaCpp instance
  generate: (prompt: string, options: GenerationOptions) => Promise<GenerationResponse>;
}
