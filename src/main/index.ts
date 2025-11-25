import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from '../core/database/DatabaseManager';
import { AIManager } from '../core/ai/AIManager';
import { ConversationManager } from '../core/ai/ConversationManager';
import { KnowledgeBaseManager } from '../core/knowledge/KnowledgeBaseManager';
import { SettingsManager } from '../core/settings';
import { ProgressManager } from '../core/progress';
import { TestGenerator, TestQuestion } from '../core/tests';
import { UpdateManager } from '../core/update';
import { KB_TOOLS, AIAgentToolExecutor, createToolResultMessage } from '../core/ai/AIAgentTools';
import { AIMessage, AIToolCall } from '../shared/ai-types';

// Development mode detection
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

class Application {
  private mainWindow: BrowserWindow | null = null;
  private databaseManager: DatabaseManager | null = null;
  private aiManager: AIManager | null = null;
  private conversationManager: ConversationManager | null = null;
  private knowledgeBaseManager: KnowledgeBaseManager | null = null;
  private settingsManager: SettingsManager | null = null;
  private progressManager: ProgressManager | null = null;
  private testGenerator: TestGenerator | null = null;
  private updateManager: UpdateManager | null = null;

  constructor() {
    this.initializeApp();
  }

  private initializeApp(): void {
    // Handle creating/removing shortcuts on Windows when installing/uninstalling
    if (require('electron-squirrel-startup')) {
      app.quit();
      return;
    }

    // Initialize when Electron is ready
    app.on('ready', this.onReady.bind(this));

    // Quit when all windows are closed (except on macOS)
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // Re-create window on macOS when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });

    // Clean up before quit
    app.on('before-quit', this.cleanup.bind(this));
  }

  private async onReady(): Promise<void> {
    try {
      // Initialize database
      await this.initializeDatabase();

      // Initialize AI system
      await this.initializeAI();

      // Create main window
      this.createMainWindow();

      // Set up IPC handlers
      this.setupIPCHandlers();

      console.log('Application initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      app.quit();
    }
  }

  private async initializeDatabase(): Promise<void> {
    try {
      const dataPath = app.getPath('userData');

      if (!dataPath) {
        throw new Error('Unable to get userData path from Electron app');
      }

      const dbPath = path.join(dataPath, 'fsp-study-tools.db');

      if (!dbPath || typeof dbPath !== 'string') {
        throw new Error(`Invalid database path: ${dbPath}`);
      }

      console.log(`Initializing database at: ${dbPath}`);

      this.databaseManager = new DatabaseManager(dbPath);
      await this.databaseManager.initialize();

      console.log(`Database initialized successfully at: ${dbPath}`);
    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    }
  }

  private async initializeAI(): Promise<void> {
    if (!this.databaseManager) {
      throw new Error('Database must be initialized before AI');
    }

    // Initialize Settings Manager
    this.settingsManager = new SettingsManager(this.databaseManager);

    // Initialize AI Manager
    this.aiManager = new AIManager();

    // Configure AI Manager with settings from database
    const settings = this.settingsManager.getAll();
    this.aiManager.configureFromSettings(settings);

    const configuredProviders = this.aiManager.getConfiguredProviders();
    if (configuredProviders.length > 0) {
      console.log(`AI providers configured: ${configuredProviders.join(', ')}`);
    } else {
      console.log('No AI providers configured - please add API keys in Settings');
    }

    // Initialize Conversation Manager
    this.conversationManager = new ConversationManager(this.databaseManager);

    // Initialize Knowledge Base Manager
    this.knowledgeBaseManager = new KnowledgeBaseManager(this.databaseManager);

    // Initialize Progress Manager
    this.progressManager = new ProgressManager(this.databaseManager);

    // Initialize Test Generator (with progressManager for adaptive mode)
    this.testGenerator = new TestGenerator(this.databaseManager, this.aiManager, this.settingsManager, this.progressManager);

    // Initialize Update Manager
    this.updateManager = new UpdateManager();

    console.log('AI system initialized');
  }

  private createMainWindow(): void {
    // Get the base path - in development, __dirname is dist/main/main
    // We need to go up to dist, then into renderer
    const basePath = path.join(__dirname, '..', '..'); // Goes to dist/

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'), // preload.js is in same dir as index.js
      },
      title: "FSP's Study Tools",
      backgroundColor: '#ffffff',
    });

    // Load the index.html from dist/renderer/main_window/index.html
    const htmlPath = path.join(basePath, 'renderer', 'main_window', 'index.html');
    if (isDev) console.log('Loading HTML from:', htmlPath);
    this.mainWindow.loadFile(htmlPath);

    // Open DevTools in development
    if (!app.isPackaged) {
      this.mainWindow.webContents.openDevTools();

      // Run startup diagnostic in development
      this.mainWindow.webContents.once('did-finish-load', () => {
        this.runStartupDiagnostic();
      });
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // Pass mainWindow to UpdateManager and start auto-check
    if (this.updateManager) {
      this.updateManager.setMainWindow(this.mainWindow);
      // Start auto-check in production mode only
      if (app.isPackaged) {
        this.updateManager.startAutoCheck();
      }
    }
  }

  private setupIPCHandlers(): void {
    // Database operations
    ipcMain.handle('db:query', async (_event, sql: string, params?: unknown[]) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }
      return this.databaseManager.query(sql, params);
    });

    ipcMain.handle('db:execute', async (_event, sql: string, params?: unknown[]) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }
      return this.databaseManager.execute(sql, params);
    });

    // Knowledge base operations
    ipcMain.handle('kb:list', async () => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }
      return this.databaseManager.listKnowledgeBases();
    });

    ipcMain.handle('kb:get', async (_event, id: number) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }
      return this.databaseManager.getKnowledgeBase(id);
    });

    ipcMain.handle('kb:create', async (_event, data: unknown) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }
      return this.databaseManager.createKnowledgeBase(data as {
        uuid: string;
        title: string;
        xml_content: string;
        metadata?: Record<string, unknown>;
      });
    });

    // AI operations
    ipcMain.handle('ai:completion', async (_event, request: unknown) => {
      if (!this.aiManager) {
        throw new Error('AI Manager not initialized');
      }
      return this.aiManager.createCompletion(request as never);
    });

    ipcMain.handle('ai:listModels', async (_event, providerType?: string) => {
      if (!this.aiManager) {
        throw new Error('AI Manager not initialized');
      }
      const models = await this.aiManager.listModels(providerType as never);
      return Object.fromEntries(models);
    });

    // Fetch models for a specific provider with a given API key (for validation)
    ipcMain.handle('ai:fetchModels', async (_event, providerType: string, apiKey: string) => {
      const { OpenAIProvider } = await import('../core/ai/OpenAIProvider');
      const { AnthropicProvider } = await import('../core/ai/AnthropicProvider');
      const { GoogleAIProvider } = await import('../core/ai/GoogleAIProvider');
      const { OpenRouterProvider } = await import('../core/ai/OpenRouterProvider');

      let provider;
      switch (providerType) {
        case 'openai':
          provider = new OpenAIProvider(apiKey);
          break;
        case 'anthropic':
          provider = new AnthropicProvider(apiKey);
          break;
        case 'google':
          provider = new GoogleAIProvider(apiKey);
          break;
        case 'openrouter':
          provider = new OpenRouterProvider(apiKey);
          break;
        default:
          throw new Error(`Unknown provider type: ${providerType}`);
      }

      try {
        const models = await provider.listModels();
        return { success: true, models };
      } catch (error) {
        return { success: false, error: (error as Error).message, models: [] };
      }
    });

    ipcMain.handle('ai:validateProviders', async () => {
      if (!this.aiManager) {
        throw new Error('AI Manager not initialized');
      }
      const results = await this.aiManager.validateProviders();
      return Object.fromEntries(results);
    });

    // Conversation operations
    ipcMain.handle('conversation:create', async (_event, kbId: number, systemMessage?: string) => {
      if (!this.conversationManager) {
        throw new Error('Conversation Manager not initialized');
      }
      // Debug: Log what system message is being passed
      console.log('[conversation:create] kbId:', kbId);
      console.log('[conversation:create] systemMessage length:', systemMessage?.length || 0);
      console.log('[conversation:create] systemMessage preview:', systemMessage?.substring(0, 300) || 'NO SYSTEM MESSAGE');
      return this.conversationManager.createConversation(kbId, systemMessage);
    });

    ipcMain.handle('conversation:load', async (_event, conversationId: number) => {
      if (!this.conversationManager) {
        throw new Error('Conversation Manager not initialized');
      }
      return this.conversationManager.loadConversation(conversationId);
    });

    ipcMain.handle('conversation:addMessage', async (_event, conversationId: number, message: unknown) => {
      if (!this.conversationManager) {
        throw new Error('Conversation Manager not initialized');
      }
      if (!this.aiManager) {
        throw new Error('AI Manager not initialized');
      }
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }

      // Add user message to conversation
      await this.conversationManager.addMessage(conversationId, message as never);

      // Check if any AI providers are configured
      const configuredProviders = this.aiManager.getConfiguredProviders();
      if (configuredProviders.length === 0) {
        throw new Error('No AI providers configured. Please add an API key in Settings.');
      }

      try {
        // Get conversation to find the kbId
        const conversation = await this.conversationManager.loadConversation(conversationId);
        if (!conversation) {
          throw new Error(`Conversation ${conversationId} not found`);
        }

        const kbId = conversation.kbId;
        const useTools = kbId > 0; // Only use tools if there's a valid KB ID

        // Create tool executor if we have a KB
        let toolExecutor: AIAgentToolExecutor | null = null;
        if (useTools) {
          toolExecutor = new AIAgentToolExecutor(this.knowledgeBaseManager, kbId);
        }

        // Get conversation messages
        let messages = await this.conversationManager.getMessages(conversationId);

        // Debug: Log what messages are being sent to AI
        console.log('[conversation:addMessage] Total messages:', messages.length);
        console.log('[conversation:addMessage] KB ID:', kbId, 'useTools:', useTools);

        // Tool calling loop - max 5 iterations to prevent infinite loops
        const MAX_TOOL_ITERATIONS = 5;
        let iteration = 0;
        let finalResponse: { role: 'assistant'; content: string; tool_calls?: AIToolCall[] } | null = null;

        while (iteration < MAX_TOOL_ITERATIONS) {
          iteration++;
          console.log(`[conversation:addMessage] Iteration ${iteration}`);

          // Call AI provider with tools if available
          const response = await this.aiManager.createCompletion({
            messages: messages as never,
            tools: useTools ? KB_TOOLS : undefined,
            toolChoice: useTools ? 'auto' : undefined,
          });

          const choice = response.choices[0];
          const assistantMessage = choice.message;

          console.log('[conversation:addMessage] AI response:', {
            hasContent: !!assistantMessage.content,
            hasToolCalls: !!(assistantMessage as { tool_calls?: AIToolCall[] }).tool_calls?.length,
            finishReason: choice.finishReason
          });

          // Check if AI wants to call tools
          const toolCalls = (assistantMessage as { tool_calls?: AIToolCall[] }).tool_calls;
          if (toolCalls && toolCalls.length > 0 && toolExecutor) {
            console.log(`[conversation:addMessage] AI requested ${toolCalls.length} tool call(s)`);

            // Add assistant message with tool calls to messages array
            const assistantWithTools: AIMessage = {
              role: 'assistant',
              content: assistantMessage.content || '',
              tool_calls: toolCalls
            };
            messages = [...messages, assistantWithTools];

            // Execute each tool call and add results
            for (const toolCall of toolCalls) {
              console.log(`[conversation:addMessage] Executing tool: ${toolCall.function.name}`);
              const result = await toolExecutor.executeTool(toolCall);
              console.log(`[conversation:addMessage] Tool result length: ${result.length}`);

              const toolResultMessage = createToolResultMessage(toolCall.id, result);
              messages = [...messages, toolResultMessage];
            }

            // Continue loop to get AI's response after tool results
            continue;
          }

          // No tool calls - this is the final response
          finalResponse = {
            role: 'assistant' as const,
            content: assistantMessage.content || 'I apologize, but I could not generate a response.',
          };
          break;
        }

        if (!finalResponse) {
          finalResponse = {
            role: 'assistant' as const,
            content: 'I apologize, but I reached the maximum number of tool calls. Please try asking your question differently.',
          };
        }

        // Add final AI response to conversation (for persistence)
        await this.conversationManager.addMessage(conversationId, finalResponse as never);

        // Return the response
        return {
          success: true,
          message: finalResponse,
          toolIterations: iteration,
        };
      } catch (error) {
        console.error('AI completion failed:', error);

        // Add error message to conversation
        const errorMessage = {
          role: 'assistant' as const,
          content: `I apologize, but I encountered an error: ${(error as Error).message}`,
        };

        await this.conversationManager.addMessage(conversationId, errorMessage as never);

        return {
          success: false,
          message: errorMessage,
          error: (error as Error).message,
        };
      }
    });

    ipcMain.handle('conversation:getMessages', async (_event, conversationId: number, limit?: number) => {
      if (!this.conversationManager) {
        throw new Error('Conversation Manager not initialized');
      }
      return this.conversationManager.getMessages(conversationId, limit);
    });

    ipcMain.handle('conversation:list', async (_event, kbId: number, limit?: number) => {
      if (!this.conversationManager) {
        throw new Error('Conversation Manager not initialized');
      }
      return this.conversationManager.listConversations(kbId, limit);
    });

    ipcMain.handle('conversation:delete', async (_event, conversationId: number) => {
      if (!this.conversationManager) {
        throw new Error('Conversation Manager not initialized');
      }
      return this.conversationManager.deleteConversation(conversationId);
    });

    // Knowledge Base operations
    ipcMain.handle('kb:import', async (_event, xmlContent: string, filePath?: string) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.importFromXML(xmlContent, filePath);
    });

    ipcMain.handle('kb:parse', async (_event, id: number) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.parseKnowledgeBase(id);
    });

    ipcMain.handle('kb:search', async (_event, kbId: number, query: string, limit?: number) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.searchContent(kbId, query, limit);
    });

    ipcMain.handle('kb:searchAll', async (_event, query: string, limit?: number) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.searchAllKBs(query, limit);
    });

    ipcMain.handle('kb:getStatistics', async (_event, kbId: number) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.getStatistics(kbId);
    });

    ipcMain.handle('kb:delete', async (_event, id: number) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.deleteKnowledgeBase(id);
    });

    ipcMain.handle('kb:update', async (_event, id: number, xmlContent: string) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.updateContent(id, xmlContent);
    });

    ipcMain.handle('kb:export', async (_event, id: number) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.exportToXML(id);
    });

    ipcMain.handle('kb:validate', async (_event, xmlContent: string) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.validateXML(xmlContent);
    });

    ipcMain.handle('kb:getSample', async () => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }
      return this.knowledgeBaseManager.getSampleXML();
    });

    ipcMain.handle('kb:importFile', async () => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }

      if (!this.mainWindow) {
        throw new Error('Main window not initialized');
      }

      try {
        // Get all supported file filters
        const xmlFilters = [{ name: 'XML Files', extensions: ['xml'] }];
        const docFilters = this.knowledgeBaseManager.getDocumentFileFilters();
        const allFilters = [...docFilters, ...xmlFilters];

        // Open file dialog (attached to main window)
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: 'Import Knowledge Base',
          filters: allFilters,
          properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false };
        }

        const filePath = result.filePaths[0];
        const fileExt = path.extname(filePath).toLowerCase();

        let kbId: number;

        // Check if it's XML or a document
        if (fileExt === '.xml') {
          // Read XML file content
          const xmlContent = fs.readFileSync(filePath, 'utf-8');

          // Import as XML
          kbId = await this.knowledgeBaseManager.importFromXML(xmlContent, filePath);
        } else {
          // Import as document (PDF, DOCX, TXT, etc.)
          kbId = await this.knowledgeBaseManager.importFromDocument(filePath);
        }
        return { success: true, kbId };
      } catch (error) {
        console.error('Import failed:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // Application info
    ipcMain.handle('app:version', () => {
      return app.getVersion();
    });

    ipcMain.handle('app:path', (_event, name: string) => {
      return app.getPath(name as any);
    });

    // Settings handlers
    ipcMain.handle('settings:getAll', async () => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      return this.settingsManager.getAll();
    });

    ipcMain.handle('settings:get', async (_event, key: string, defaultValue?: string) => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      return this.settingsManager.get(key, defaultValue);
    });

    ipcMain.handle('settings:set', async (_event, key: string, value: string | number | boolean) => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      this.settingsManager.set(key, value);
      return true;
    });

    ipcMain.handle('settings:updateAll', async (_event, settings: unknown) => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      if (!this.aiManager) {
        throw new Error('AI Manager not initialized');
      }

      // Update settings in database
      this.settingsManager.updateAll(settings as any);

      // Reconfigure AI providers with new settings
      const updatedSettings = this.settingsManager.getAll();
      this.aiManager.configureFromSettings(updatedSettings);

      const configuredProviders = this.aiManager.getConfiguredProviders();
      console.log(`AI providers reconfigured: ${configuredProviders.join(', ') || 'none'}`);

      return true;
    });

    ipcMain.handle('settings:delete', async (_event, key: string) => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      this.settingsManager.delete(key);
      return true;
    });

    ipcMain.handle('settings:reset', async () => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      this.settingsManager.resetToDefaults();
      return true;
    });

    ipcMain.handle('settings:export', async () => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      return this.settingsManager.export();
    });

    ipcMain.handle('settings:import', async (_event, json: string) => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      this.settingsManager.import(json);
      return true;
    });

    // Progress tracking handlers
    ipcMain.handle('progress:record', async (_event, params: unknown) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      this.progressManager.recordProgress(params as { kbId: number; sectionId: string; userScore?: number; aiScore?: number; timeSpent?: number; updateLastViewed?: boolean });
      return true;
    });

    ipcMain.handle('progress:get', async (_event, kbId: number, sectionId: string) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.getProgress(kbId, sectionId);
    });

    ipcMain.handle('progress:getAll', async (_event, kbId: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.getAllProgress(kbId);
    });

    ipcMain.handle('progress:getStats', async (_event, kbId: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.getProgressStats(kbId);
    });

    ipcMain.handle('progress:getRecent', async (_event, kbId: number, limit?: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.getRecentActivity(kbId, limit);
    });

    ipcMain.handle('progress:getNeedingReview', async (_event, kbId: number, threshold?: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.getSectionsNeedingReview(kbId, threshold);
    });

    ipcMain.handle('progress:recordSession', async (_event, params: unknown) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      this.progressManager.recordStudySession(params as { kbId: number; sectionId: string; duration: number; userScore?: number; aiScore?: number });
      return true;
    });

    ipcMain.handle('progress:updateUserScore', async (_event, kbId: number, sectionId: string, score: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      this.progressManager.updateUserScore(kbId, sectionId, score);
      return true;
    });

    ipcMain.handle('progress:updateAiScore', async (_event, kbId: number, sectionId: string, score: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      this.progressManager.updateAiScore(kbId, sectionId, score);
      return true;
    });

    ipcMain.handle('progress:getStreak', async (_event, kbId: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.getStudyStreak(kbId);
    });

    ipcMain.handle('progress:getVelocity', async (_event, kbId: number, weeks?: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.getLearningVelocity(kbId, weeks);
    });

    ipcMain.handle('progress:export', async (_event, kbId: number) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      return this.progressManager.exportProgress(kbId);
    });

    ipcMain.handle('progress:reset', async (_event, kbId: number, sectionId?: string) => {
      if (!this.progressManager) {
        throw new Error('Progress Manager not initialized');
      }
      if (sectionId) {
        this.progressManager.resetProgress(kbId, sectionId);
      } else {
        this.progressManager.resetAllProgress(kbId);
      }
      return true;
    });

    // Test generation handlers
    ipcMain.handle('test:create', async (_event, params: unknown) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      return this.testGenerator.createTest(params as {
        kbId: number;
        title: string;
        type: 'manual' | 'ai_generated';
        questions: TestQuestion[];
      });
    });

    ipcMain.handle('test:get', async (_event, testId: number) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      return this.testGenerator.getTest(testId);
    });

    ipcMain.handle('test:getAll', async (_event, kbId: number) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      return this.testGenerator.getTestsForKB(kbId);
    });

    ipcMain.handle('test:update', async (_event, testId: number, updates: unknown) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      this.testGenerator.updateTest(testId, updates as { title?: string; questions?: TestQuestion[] });
      return true;
    });

    ipcMain.handle('test:delete', async (_event, testId: number) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      this.testGenerator.deleteTest(testId);
      return true;
    });

    ipcMain.handle('test:generateQuestions', async (_event, params: unknown) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      const typedParams = params as {
        kbId: number;
        moduleIds?: string[];
        chapterIds?: string[];
        sectionIds?: string[];
        questionsPerSection?: number;
        totalQuestions?: number;
        difficulty?: 'easy' | 'medium' | 'hard';
        includeExisting?: boolean;
        adaptiveMode?: 'none' | 'low_scores' | 'least_studied';
      };
      try {
        const questions = await this.testGenerator.generateQuestionsFromKB(typedParams);
        return questions;
      } catch (error) {
        console.error('Question generation failed:', error);
        throw error;
      }
    });

    ipcMain.handle('test:validateQuestion', async (_event, question: unknown) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      return this.testGenerator.validateQuestion(question as {
        id: string;
        question: string;
        type: 'multiple_choice' | 'true_false' | 'short_answer';
        correctAnswer: string;
        options?: Record<string, string>;
        sectionId?: string;
        explanation?: string;
      });
    });

    ipcMain.handle('test:validateTest', async (_event, questions: unknown) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      return this.testGenerator.validateTest(questions as TestQuestion[]);
    });

    ipcMain.handle('test:getStats', async (_event, testId: number) => {
      if (!this.testGenerator) {
        throw new Error('Test Generator not initialized');
      }
      return this.testGenerator.getTestStats(testId);
    });

    // Update operations
    ipcMain.handle('update:check', async () => {
      if (!this.updateManager) {
        throw new Error('Update Manager not initialized');
      }
      return this.updateManager.checkForUpdates();
    });

    ipcMain.handle('update:download', async () => {
      if (!this.updateManager) {
        throw new Error('Update Manager not initialized');
      }
      return this.updateManager.downloadUpdate();
    });

    ipcMain.handle('update:install', async () => {
      if (!this.updateManager) {
        throw new Error('Update Manager not initialized');
      }
      this.updateManager.quitAndInstall();
    });

    ipcMain.handle('update:getConfig', async () => {
      if (!this.updateManager) {
        throw new Error('Update Manager not initialized');
      }
      return this.updateManager.getUpdateConfig();
    });

    ipcMain.handle('update:updateConfig', async (_event, config: unknown) => {
      if (!this.updateManager) {
        throw new Error('Update Manager not initialized');
      }
      this.updateManager.updateConfig(config as Partial<{
        autoDownload: boolean;
        autoInstallOnAppQuit: boolean;
        currentVersion: string;
        checkInterval: number;
      }>);
    });

    // Highlight handlers
    ipcMain.handle('highlight:create', async (_event, params: {
      kb_id: number;
      section_id: string;
      start_offset: number;
      end_offset: number;
      text: string;
      color?: string;
      note?: string;
    }) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }

      const result = this.databaseManager.execute(
        `INSERT INTO highlights (kb_id, section_id, start_offset, end_offset, text, color, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [params.kb_id, params.section_id, params.start_offset, params.end_offset, params.text, params.color || 'yellow', params.note || null]
      );

      return result.lastInsertRowid;
    });

    ipcMain.handle('highlight:getAll', async (_event, kbId: number) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }

      return this.databaseManager.query(
        `SELECT * FROM highlights WHERE kb_id = ? ORDER BY section_id, start_offset`,
        [kbId]
      );
    });

    ipcMain.handle('highlight:getForSection', async (_event, kbId: number, sectionId: string) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }

      return this.databaseManager.query(
        `SELECT * FROM highlights WHERE kb_id = ? AND section_id = ? ORDER BY start_offset`,
        [kbId, sectionId]
      );
    });

    ipcMain.handle('highlight:update', async (_event, highlightId: number, updates: {
      color?: string;
      note?: string;
    }) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }

      const setParts: string[] = [];
      const values: unknown[] = [];

      if (updates.color !== undefined) {
        setParts.push('color = ?');
        values.push(updates.color);
      }
      if (updates.note !== undefined) {
        setParts.push('note = ?');
        values.push(updates.note);
      }

      if (setParts.length > 0) {
        values.push(highlightId);
        this.databaseManager.execute(
          `UPDATE highlights SET ${setParts.join(', ')} WHERE id = ?`,
          values
        );
      }

      return true;
    });

    ipcMain.handle('highlight:delete', async (_event, highlightId: number) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }

      this.databaseManager.execute(
        `DELETE FROM highlights WHERE id = ?`,
        [highlightId]
      );

      return true;
    });

    ipcMain.handle('highlight:deleteAllForKB', async (_event, kbId: number) => {
      if (!this.databaseManager) {
        throw new Error('Database not initialized');
      }

      this.databaseManager.execute(
        `DELETE FROM highlights WHERE kb_id = ?`,
        [kbId]
      );

      return true;
    });

    // File dialog and parsing operations
    ipcMain.handle('dialog:openFiles', async (_event, options?: {
      filters?: Array<{ name: string; extensions: string[] }>;
      title?: string;
    }) => {
      if (!this.mainWindow) {
        throw new Error('Main window not initialized');
      }

      try {
        const defaultFilters = [
          { name: 'All Supported Documents', extensions: ['pdf', 'docx', 'txt', 'text', 'md', 'markdown'] },
          { name: 'PDF Documents', extensions: ['pdf'] },
          { name: 'Word Documents', extensions: ['docx'] },
          { name: 'Text Documents', extensions: ['txt', 'text', 'md', 'markdown'] },
        ];

        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: options?.title || 'Select Files',
          filters: options?.filters || defaultFilters,
          properties: ['openFile', 'multiSelections'],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, files: [] };
        }

        // Return file info for each selected file
        const files = result.filePaths.map(filePath => ({
          path: filePath,
          name: path.basename(filePath),
          type: path.extname(filePath).toLowerCase().substring(1),
        }));

        return { success: true, files };
      } catch (error) {
        console.error('File dialog error:', error);
        return { success: false, files: [], error: (error as Error).message };
      }
    });

    ipcMain.handle('file:parse', async (_event, filePath: string) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }

      try {
        const { ParserManager } = await import('../core/parser');
        const parserManager = new ParserManager();

        if (!parserManager.isSupported(filePath)) {
          return {
            success: false,
            error: `Unsupported file type: ${path.extname(filePath)}`,
          };
        }

        const parsed = await parserManager.parseFile(filePath);

        return {
          success: true,
          content: {
            text: parsed.text,
            elements: parsed.elements, // Include structured elements
            metadata: parsed.metadata,
            warnings: parsed.warnings,
          },
        };
      } catch (error) {
        console.error('File parse error:', error);
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    });

    ipcMain.handle('file:parseMultiple', async (_event, filePaths: string[]) => {
      if (!this.knowledgeBaseManager) {
        throw new Error('Knowledge Base Manager not initialized');
      }

      try {
        const { ParserManager } = await import('../core/parser');
        const parserManager = new ParserManager();

        const results = await Promise.all(
          filePaths.map(async (filePath) => {
            try {
              if (!parserManager.isSupported(filePath)) {
                return {
                  path: filePath,
                  name: path.basename(filePath),
                  success: false,
                  error: `Unsupported file type: ${path.extname(filePath)}`,
                };
              }

              const parsed = await parserManager.parseFile(filePath);

              return {
                path: filePath,
                name: path.basename(filePath),
                success: true,
                content: {
                  text: parsed.text,
                  elements: parsed.elements, // Include structured elements
                  metadata: parsed.metadata,
                  warnings: parsed.warnings,
                },
              };
            } catch (error) {
              return {
                path: filePath,
                name: path.basename(filePath),
                success: false,
                error: (error as Error).message,
              };
            }
          })
        );

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return {
          success: successCount > 0,
          results,
          summary: {
            total: filePaths.length,
            successful: successCount,
            failed: failCount,
          },
        };
      } catch (error) {
        console.error('Multiple file parse error:', error);
        return {
          success: false,
          error: (error as Error).message,
          results: [],
          summary: { total: filePaths.length, successful: 0, failed: filePaths.length },
        };
      }
    });

    // Debug handler for testing AI question generation
    ipcMain.handle('debug:testAIGeneration', async (_event, kbId: number) => {
      console.log(`[DEBUG] Testing AI question generation for KB ${kbId}`);

      try {
        // Check DB manager
        if (!this.databaseManager) {
          return { success: false, error: 'Database not initialized' };
        }

        // Check Test generator
        if (!this.testGenerator) {
          return { success: false, error: 'Test generator not initialized' };
        }

        // Get KB info
        const kbs = this.databaseManager.query<{ id: number; title: string; xml_content: string }>(
          'SELECT id, title, xml_content FROM knowledge_bases WHERE id = ?',
          [kbId]
        );

        if (kbs.length === 0) {
          return { success: false, error: `KB not found: ${kbId}` };
        }

        const kb = kbs[0];
        console.log(`[DEBUG] KB: ${kb.title}, Content length: ${kb.xml_content?.length || 0}`);

        // Get existing tests
        const tests = this.testGenerator.getTestsForKB(kbId);
        console.log(`[DEBUG] Existing tests: ${tests.length}`);

        // Try to generate questions
        console.log('[DEBUG] Generating questions with AI...');
        const startTime = Date.now();

        const questions = await this.testGenerator.generateQuestionsFromKB({
          kbId,
          questionsPerSection: 3,
          difficulty: 'medium',
        });

        const elapsed = Date.now() - startTime;
        console.log(`[DEBUG] Generated ${questions.length} questions in ${elapsed}ms`);

        return {
          success: true,
          kbTitle: kb.title,
          existingTests: tests.length,
          generatedQuestions: questions.length,
          elapsedMs: elapsed,
          sampleQuestion: questions.length > 0 ? {
            question: questions[0].question,
            options: questions[0].options,
            type: questions[0].type,
          } : null,
        };
      } catch (error) {
        console.error('[DEBUG] AI generation failed:', error);
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    });

    // Debug handler to get KB XML content
    ipcMain.handle('debug:getKBXml', async (_event, kbId: number) => {
      if (!this.databaseManager) {
        return { success: false, error: 'Database not initialized' };
      }

      const kbs = this.databaseManager.query<{ id: number; title: string; xml_content: string; metadata: string }>(
        'SELECT id, title, xml_content, metadata FROM knowledge_bases WHERE id = ?',
        [kbId]
      );

      if (kbs.length === 0) {
        return { success: false, error: `KB not found: ${kbId}` };
      }

      const kb = kbs[0];
      return {
        success: true,
        kbId: kb.id,
        title: kb.title,
        xmlContentLength: kb.xml_content?.length || 0,
        xmlContentPreview: kb.xml_content?.substring(0, 3000),
        metadata: kb.metadata,
      };
    });

    // Debug handler to list DB state
    ipcMain.handle('debug:dbState', async () => {
      if (!this.databaseManager) {
        return { success: false, error: 'Database not initialized' };
      }

      const kbs = this.databaseManager.query<{ id: number; title: string }>(
        'SELECT id, title FROM knowledge_bases'
      );

      const tests = this.databaseManager.query<{ id: number; kb_id: number; title: string; type: string; questions: string }>(
        'SELECT id, kb_id, title, type, questions FROM practice_tests'
      );

      const testInfo = tests.map(t => {
        let qCount = 0;
        let qType = 'unknown';
        try {
          const qs = JSON.parse(t.questions);
          qCount = qs.length;
          if (qs.length > 0) {
            qType = qs[0].type || 'multiple_choice';
            if (qs[0].correctAnswer === 'self-assessed') {
              qType = 'self-assessment';
            }
          }
        } catch {}
        return {
          id: t.id,
          kbId: t.kb_id,
          title: t.title,
          type: t.type,
          questionCount: qCount,
          questionType: qType,
        };
      });

      return {
        success: true,
        knowledgeBases: kbs,
        practiceTests: testInfo,
      };
    });
  }

  private async runStartupDiagnostic(): Promise<void> {
    console.log('\n=== Startup Diagnostic ===');

    try {
      // Check database
      if (!this.databaseManager) {
        console.log('[WARN] Database not initialized');
        return;
      }

      // List KBs with content info and parse XML to verify structure
      const kbs = this.databaseManager.query<{ id: number; title: string; xml_content: string }>(
        'SELECT id, title, xml_content FROM knowledge_bases'
      );
      console.log(`[INFO] Knowledge Bases: ${kbs.length}`);

      for (const kb of kbs) {
        const contentLen = kb.xml_content?.length || 0;
        const hasContent = contentLen > 500 ? '[OK]' : '[EMPTY]';
        console.log(`  - [${kb.id}] ${kb.title} (${contentLen} chars) ${hasContent}`);

        // Parse XML and check structure for debugging
        if (this.knowledgeBaseManager) {
          try {
            const parsed = await this.knowledgeBaseManager.parseKnowledgeBase(kb.id);
            const moduleCount = parsed.modules?.length || 0;
            const chapterCount = parsed.totalChapters || 0;
            const sectionCount = parsed.totalSections || 0;
            console.log(`      -> Parsed: ${moduleCount} modules, ${chapterCount} chapters, ${sectionCount} sections`);
            if (moduleCount === 0) {
              // Log XML structure for debugging
              const xmlPreview = kb.xml_content?.substring(0, 500) || '';
              console.log(`      -> [WARN] 0 modules! XML preview: ${xmlPreview.replace(/\n/g, ' ').substring(0, 200)}...`);
            }
          } catch (parseErr) {
            console.log(`      -> [ERROR] Parse failed: ${(parseErr as Error).message}`);
          }
        }
      }

      // List practice tests
      const tests = this.databaseManager.query<{ id: number; kb_id: number; title: string; type: string }>(
        'SELECT id, kb_id, title, type FROM practice_tests'
      );
      console.log(`[INFO] Practice Tests: ${tests.length}`);
      tests.forEach(t => console.log(`  - [${t.id}] KB:${t.kb_id} "${t.title}" (${t.type})`));

      // Check AI config
      if (this.aiManager) {
        const providers = this.aiManager.getConfiguredProviders();
        console.log(`[INFO] AI Providers: ${providers.join(', ') || 'none'}`);
      } else {
        console.log('[WARN] AI Manager not initialized');
      }

      // If there are KBs without tests, suggest running a study session
      const kbsWithoutTests = kbs.filter(kb => !tests.some(t => t.kb_id === kb.id));
      if (kbsWithoutTests.length > 0) {
        console.log(`\n[TIP] ${kbsWithoutTests.length} KB(s) have no practice tests yet.`);
        console.log('      Starting a Study session will auto-generate AI questions.');
      }

      console.log('\n=== End Diagnostic ===\n');
    } catch (error) {
      console.error('[ERROR] Diagnostic failed:', error);
    }
  }

  private async cleanup(): Promise<void> {
    console.log('Cleaning up application...');

    if (this.databaseManager) {
      await this.databaseManager.close();
    }

    console.log('Cleanup complete');
  }
}

// Start the application
new Application();
