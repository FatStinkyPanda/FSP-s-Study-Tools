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

    // Initialize Test Generator
    this.testGenerator = new TestGenerator(this.databaseManager, this.aiManager);

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
    console.log('Loading HTML from:', htmlPath);
    this.mainWindow.loadFile(htmlPath);

    // Open DevTools in development
    if (!app.isPackaged) {
      this.mainWindow.webContents.openDevTools();
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

      // Add user message to conversation
      await this.conversationManager.addMessage(conversationId, message as never);

      // Check if any AI providers are configured
      const configuredProviders = this.aiManager.getConfiguredProviders();
      if (configuredProviders.length === 0) {
        throw new Error('No AI providers configured. Please add an API key in Settings.');
      }

      try {
        // Get conversation messages
        const messages = await this.conversationManager.getMessages(conversationId);

        // Call AI provider
        const response = await this.aiManager.createCompletion({
          messages: messages as never,
        });

        // Extract assistant message from response
        const assistantMessage = {
          role: 'assistant' as const,
          content: response.choices[0].message.content,
        };

        // Add AI response to conversation
        await this.conversationManager.addMessage(conversationId, assistantMessage as never);

        // Return the response
        return {
          success: true,
          message: assistantMessage,
          usage: response.usage,
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
          console.log('File selection canceled');
          return { success: false };
        }

        const filePath = result.filePaths[0];
        const fileExt = path.extname(filePath).toLowerCase();
        console.log(`Importing knowledge base from: ${filePath} (${fileExt})`);

        let kbId: number;

        // Check if it's XML or a document
        if (fileExt === '.xml') {
          // Read XML file content
          const xmlContent = fs.readFileSync(filePath, 'utf-8');
          console.log(`XML file read successfully, size: ${xmlContent.length} bytes`);

          // Import as XML
          console.log('Starting XML import...');
          kbId = await this.knowledgeBaseManager.importFromXML(xmlContent, filePath);
        } else {
          // Import as document (PDF, DOCX, TXT, etc.)
          console.log('Starting document import...');
          kbId = await this.knowledgeBaseManager.importFromDocument(filePath);
        }

        console.log(`Knowledge base imported successfully with ID: ${kbId}`);
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

    ipcMain.handle('settings:set', async (_event, key: string, value: string | number | boolean, category?: string) => {
      if (!this.settingsManager) {
        throw new Error('Settings Manager not initialized');
      }
      this.settingsManager.set(key, value, category);
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
      return await this.testGenerator.generateQuestionsFromKB(params as {
        kbId: number;
        sectionIds?: string[];
        questionsPerSection?: number;
        difficulty?: 'easy' | 'medium' | 'hard';
      });
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
