import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from '../core/database/DatabaseManager';
import { AIManager } from '../core/ai/AIManager';
import { ConversationManager } from '../core/ai/ConversationManager';
import { KnowledgeBaseManager } from '../core/knowledge/KnowledgeBaseManager';
import { SettingsManager } from '../core/settings';

class Application {
  private mainWindow: BrowserWindow | null = null;
  private databaseManager: DatabaseManager | null = null;
  private aiManager: AIManager | null = null;
  private conversationManager: ConversationManager | null = null;
  private knowledgeBaseManager: KnowledgeBaseManager | null = null;
  private settingsManager: SettingsManager | null = null;

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
    const dataPath = app.getPath('userData');
    const dbPath = path.join(dataPath, 'fsp-study-tools.db');

    this.databaseManager = new DatabaseManager(dbPath);
    await this.databaseManager.initialize();

    console.log(`Database initialized at: ${dbPath}`);
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

    console.log('AI system initialized');
  }

  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      title: "FSP's Study Tools",
      backgroundColor: '#ffffff',
    });

    // Load the index.html
    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:8080');
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
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
          content: response.content,
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

      try {
        // Open file dialog
        const result = await dialog.showOpenDialog({
          filters: [{ name: 'XML Files', extensions: ['xml'] }],
          properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false };
        }

        const filePath = result.filePaths[0];

        // Read file content
        const xmlContent = fs.readFileSync(filePath, 'utf-8');

        // Import KB
        const kbId = await this.knowledgeBaseManager.importFromXML(xmlContent, filePath);

        return { success: true, kbId };
      } catch (error) {
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
