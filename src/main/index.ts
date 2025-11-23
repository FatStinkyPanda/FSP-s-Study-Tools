import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { DatabaseManager } from '../core/database/DatabaseManager';

class Application {
  private mainWindow: BrowserWindow | null = null;
  private databaseManager: DatabaseManager | null = null;

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

    // Application info
    ipcMain.handle('app:version', () => {
      return app.getVersion();
    });

    ipcMain.handle('app:path', (_event, name: string) => {
      return app.getPath(name as any);
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
