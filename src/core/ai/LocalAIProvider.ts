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
import { createLogger } from '../../shared/logger';

const log = createLogger('LocalAI');

/**
 * Local AI Provider for running models offline
 *
 * Supports:
 * - ONNX models via ONNX Runtime (optional - requires onnxruntime-node)
 * - GGUF models via node-llama-cpp (optional - requires node-llama-cpp)
 * - Transformers.js models (pure JS, no native deps)
 *
 * The provider will attempt to use available backends in order of preference.
 */
export class LocalAIProvider extends BaseAIProvider {
  private models: Map<string, LoadedModel> = new Map();
  private modelConfigs: Map<string, LocalModelConfig> = new Map();
  private modelsDirectory: string;
  private availableBackends: Set<LocalBackend> = new Set();
  private initialized: boolean = false;

  constructor(modelsDirectory: string = './resources/models') {
    super('local', 'Local AI Models', 'local://models', '');
    this.modelsDirectory = modelsDirectory;
    this.ensureModelsDirectory();
  }

  /**
   * Initialize the provider and detect available backends
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.detectAvailableBackends();
    this.initialized = true;

    log.info(`LocalAIProvider initialized. Available backends: ${Array.from(this.availableBackends).join(', ') || 'none'}`);
  }

  /**
   * Detect which AI backends are available
   */
  private async detectAvailableBackends(): Promise<void> {
    // Check for ONNX Runtime (optional dependency)
    try {
      // @ts-ignore - optional dependency
      await import('onnxruntime-node');
      this.availableBackends.add('onnx');
      log.debug('ONNX Runtime available');
    } catch {
      log.debug('ONNX Runtime not available');
    }

    // Check for node-llama-cpp (optional dependency)
    try {
      // @ts-ignore - optional dependency
      await import('node-llama-cpp');
      this.availableBackends.add('llama-cpp');
      log.debug('node-llama-cpp available');
    } catch {
      log.debug('node-llama-cpp not available');
    }

    // Check for Transformers.js (optional dependency)
    try {
      // @ts-ignore - optional dependency
      await import('@xenova/transformers');
      this.availableBackends.add('transformers-js');
      log.debug('Transformers.js available');
    } catch {
      log.debug('Transformers.js not available');
    }
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
        log.error(`Failed to load model ${config.id} on startup:`, error);
      });
    }
  }

  /**
   * Load a model into memory
   */
  async loadModel(modelId: string): Promise<void> {
    await this.initialize();

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
          if (!this.availableBackends.has('onnx')) {
            throw new Error('ONNX Runtime not installed. Run: npm install onnxruntime-node');
          }
          loadedModel = await this.loadONNXModel(modelPath, config);
          break;

        case 'gguf':
          if (!this.availableBackends.has('llama-cpp')) {
            throw new Error('node-llama-cpp not installed. Run: npm install node-llama-cpp');
          }
          loadedModel = await this.loadGGUFModel(modelPath, config);
          break;

        case 'transformers':
          if (!this.availableBackends.has('transformers-js')) {
            throw new Error('Transformers.js not installed. Run: npm install @xenova/transformers');
          }
          loadedModel = await this.loadTransformersModel(modelPath, config);
          break;

        default:
          throw new Error(`Unsupported model type: ${config.type}`);
      }

      this.models.set(modelId, loadedModel);
      log.info(`Model loaded successfully: ${modelId}`);
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
  private async loadONNXModel(modelPath: string, config: LocalModelConfig): Promise<LoadedModel> {
    // @ts-ignore - optional dependency
    const ort = await import('onnxruntime-node') as any;
    const session = await ort.InferenceSession.create(modelPath);

    return {
      id: config.id,
      type: 'onnx',
      config,
      session,
      generate: async (prompt: string, options: GenerationOptions) => {
        // ONNX inference implementation
        // This is a simplified example - actual implementation depends on model architecture
        try {
          const inputIds = this.tokenize(prompt);
          const inputTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);

          const feeds = { input_ids: inputTensor };
          const results = await session.run(feeds);

          // Extract logits and decode
          const logits = results.logits?.data as Float32Array;
          const outputText = this.decodeTokens(logits, options.maxTokens || 256);

          return {
            text: outputText,
            finishReason: 'stop',
          };
        } catch (error) {
          log.error('ONNX inference error:', error);
          return {
            text: `Error during ONNX inference: ${(error as Error).message}`,
            finishReason: 'error',
          };
        }
      },
    };
  }

  /**
   * Load GGUF model using llama.cpp
   */
  private async loadGGUFModel(modelPath: string, config: LocalModelConfig): Promise<LoadedModel> {
    // @ts-ignore - optional dependency
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp') as any;

    const llama = await getLlama();
    const model = await llama.loadModel({
      modelPath,
    });

    const context = await model.createContext();

    return {
      id: config.id,
      type: 'gguf',
      config,
      session: { llama, model, context },
      generate: async (prompt: string, options: GenerationOptions) => {
        try {
          const session = new LlamaChatSession({
            contextSequence: context.getSequence(),
          });

          const response = await session.prompt(prompt, {
            maxTokens: options.maxTokens || 2048,
            temperature: options.temperature || 0.7,
            topP: options.topP || 0.9,
            stopStrings: options.stop,
          });

          return {
            text: response,
            finishReason: 'stop',
          };
        } catch (error) {
          log.error('GGUF inference error:', error);
          return {
            text: `Error during GGUF inference: ${(error as Error).message}`,
            finishReason: 'error',
          };
        }
      },
    };
  }

  /**
   * Load Transformers.js model
   */
  private async loadTransformersModel(modelPath: string, config: LocalModelConfig): Promise<LoadedModel> {
    // @ts-ignore - optional dependency
    const { pipeline, env } = await import('@xenova/transformers') as any;

    // Configure Transformers.js to use local models
    env.localModelPath = this.modelsDirectory;
    env.allowRemoteModels = false;

    // Create text generation pipeline
    const generator = await pipeline('text-generation', modelPath, {
      quantized: true,
    });

    return {
      id: config.id,
      type: 'transformers',
      config,
      session: generator,
      generate: async (prompt: string, options: GenerationOptions) => {
        try {
          const output = await generator(prompt, {
            max_new_tokens: options.maxTokens || 256,
            temperature: options.temperature || 0.7,
            top_p: options.topP || 0.9,
            do_sample: true,
          });

          const generatedText = Array.isArray(output)
            ? output[0]?.generated_text || ''
            : (output as { generated_text: string }).generated_text || '';

          // Remove the prompt from the generated text
          const responseText = generatedText.replace(prompt, '').trim();

          return {
            text: responseText,
            finishReason: 'stop',
          };
        } catch (error) {
          log.error('Transformers.js inference error:', error);
          return {
            text: `Error during inference: ${(error as Error).message}`,
            finishReason: 'error',
          };
        }
      },
    };
  }

  /**
   * Simple tokenization (for ONNX models)
   * In production, this would use the model's actual tokenizer
   */
  private tokenize(text: string): number[] {
    // Simple character-level tokenization as placeholder
    // Real implementation would use the model's tokenizer
    return text.split('').map(char => char.charCodeAt(0));
  }

  /**
   * Simple token decoding (for ONNX models)
   * In production, this would use the model's actual tokenizer
   */
  private decodeTokens(logits: Float32Array, maxTokens: number): string {
    // Simplified decoding - in production would use proper vocab
    const tokens: number[] = [];
    const vocabSize = 256; // Simplified

    for (let i = 0; i < maxTokens && i * vocabSize < logits.length; i++) {
      let maxIdx = 0;
      let maxVal = logits[i * vocabSize];

      for (let j = 1; j < vocabSize; j++) {
        if (logits[i * vocabSize + j] > maxVal) {
          maxVal = logits[i * vocabSize + j];
          maxIdx = j;
        }
      }

      if (maxIdx === 0) break; // EOS token
      tokens.push(maxIdx);
    }

    return String.fromCharCode(...tokens);
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
      try {
        const session = model.session as any;
        if (model.type === 'onnx' && session.release) {
          await session.release();
        } else if (model.type === 'gguf') {
          // Dispose llama context
          if (session.context?.dispose) {
            await session.context.dispose();
          }
          if (session.model?.dispose) {
            await session.model.dispose();
          }
        } else if (model.type === 'transformers') {
          // Transformers.js cleanup
          if (session.dispose) {
            await session.dispose();
          }
        }
      } catch (error) {
        log.error(`Error unloading model ${modelId}:`, error);
      }
    }

    this.models.delete(modelId);
    log.info(`Model unloaded: ${modelId}`);
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
    await this.initialize();
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
    await this.initialize();
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

    // For now, simulate streaming by yielding the full response in chunks
    // In production with llama.cpp, actual streaming would be used
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
        await new Promise(resolve => setTimeout(resolve, 30));
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
    await this.initialize();
    // For local models, check if any backends and models are configured
    return this.availableBackends.size > 0 && this.modelConfigs.size > 0;
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
          parts.push(`### System:\n${message.content}\n`);
          break;
        case 'user':
          parts.push(`### User:\n${message.content}\n`);
          break;
        case 'assistant':
          parts.push(`### Assistant:\n${message.content}\n`);
          break;
        default:
          parts.push(`${message.content}\n`);
      }
    }

    parts.push('### Assistant:\n');
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

  /**
   * Get available backends
   */
  async getAvailableBackends(): Promise<LocalBackend[]> {
    await this.initialize();
    return Array.from(this.availableBackends);
  }

  /**
   * Check if a specific backend is available
   */
  async isBackendAvailable(backend: LocalBackend): Promise<boolean> {
    await this.initialize();
    return this.availableBackends.has(backend);
  }

  /**
   * Scan models directory for available model files
   */
  scanModelsDirectory(): LocalModelFile[] {
    const files: LocalModelFile[] = [];

    if (!fs.existsSync(this.modelsDirectory)) {
      return files;
    }

    const entries = fs.readdirSync(this.modelsDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        let type: 'onnx' | 'gguf' | 'transformers' | 'unknown' = 'unknown';

        if (ext === '.onnx') {
          type = 'onnx';
        } else if (ext === '.gguf' || ext === '.bin') {
          type = 'gguf';
        }

        const filePath = path.join(this.modelsDirectory, entry.name);
        const stats = fs.statSync(filePath);

        files.push({
          name: entry.name,
          path: entry.name,
          type,
          size: stats.size,
          modified: stats.mtime,
        });
      } else if (entry.isDirectory()) {
        // Check for Transformers.js model directory
        const configPath = path.join(this.modelsDirectory, entry.name, 'config.json');
        if (fs.existsSync(configPath)) {
          const stats = fs.statSync(path.join(this.modelsDirectory, entry.name));
          files.push({
            name: entry.name,
            path: entry.name,
            type: 'transformers',
            size: this.getDirectorySize(path.join(this.modelsDirectory, entry.name)),
            modified: stats.mtime,
          });
        }
      }
    }

    return files;
  }

  /**
   * Get total size of a directory
   */
  private getDirectorySize(dirPath: string): number {
    let totalSize = 0;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        totalSize += fs.statSync(entryPath).size;
      } else if (entry.isDirectory()) {
        totalSize += this.getDirectorySize(entryPath);
      }
    }

    return totalSize;
  }
}

/**
 * Internal types
 */

type LocalBackend = 'onnx' | 'llama-cpp' | 'transformers-js';

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
  type: 'onnx' | 'gguf' | 'transformers';
  config: LocalModelConfig;
  session: unknown;
  generate: (prompt: string, options: GenerationOptions) => Promise<GenerationResponse>;
}

interface LocalModelFile {
  name: string;
  path: string;
  type: 'onnx' | 'gguf' | 'transformers' | 'unknown';
  size: number;
  modified: Date;
}
