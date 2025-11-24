import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { BrowserWindow } from 'electron';

/**
 * Update Manager
 *
 * Handles automatic application updates using electron-updater
 * Supports GitHub releases and custom update servers
 */
export class UpdateManager {
  private mainWindow: BrowserWindow | null = null;
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private checkIntervalMs: number = 3600000; // 1 hour default

  constructor() {
    this.setupAutoUpdater();
  }

  /**
   * Initialize auto-updater configuration
   */
  private setupAutoUpdater(): void {
    // Configure auto-updater
    autoUpdater.autoDownload = false; // Don't auto-download, ask user first
    autoUpdater.autoInstallOnAppQuit = true; // Install on quit

    // Setup event handlers
    autoUpdater.on('checking-for-update', () => {
      this.sendStatusToWindow('Checking for updates...');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.sendStatusToWindow('update-available', info);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.sendStatusToWindow('update-not-available', info);
    });

    autoUpdater.on('error', (error: Error) => {
      this.sendStatusToWindow('update-error', {
        message: error.message,
        stack: error.stack,
      });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.sendStatusToWindow('download-progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.sendStatusToWindow('update-downloaded', info);
    });
  }

  /**
   * Set the main window for sending update events
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Send status update to renderer process
   */
  private sendStatusToWindow(event: string, data?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', { event, data });
    }
  }

  /**
   * Check for updates manually
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo || null;
    } catch (error) {
      console.error('Error checking for updates:', error);
      this.sendStatusToWindow('update-error', {
        message: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Start automatic update checking
   */
  startAutoCheck(intervalMs: number = this.checkIntervalMs): void {
    // Initial check
    this.checkForUpdates();

    // Setup interval for periodic checks
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }

    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMs);
  }

  /**
   * Stop automatic update checking
   */
  stopAutoCheck(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  /**
   * Download update
   */
  async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('Error downloading update:', error);
      this.sendStatusToWindow('update-error', {
        message: (error as Error).message,
      });
    }
  }

  /**
   * Install update and quit application
   */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return autoUpdater.currentVersion.version;
  }

  /**
   * Configure update server
   */
  setFeedURL(url: string): void {
    autoUpdater.setFeedURL(url);
  }

  /**
   * Get update configuration
   */
  getUpdateConfig(): UpdateConfig {
    return {
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      currentVersion: this.getCurrentVersion(),
      checkInterval: this.checkIntervalMs,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<UpdateConfig>): void {
    if (config.autoDownload !== undefined) {
      autoUpdater.autoDownload = config.autoDownload;
    }
    if (config.autoInstallOnAppQuit !== undefined) {
      autoUpdater.autoInstallOnAppQuit = config.autoInstallOnAppQuit;
    }
    if (config.checkInterval !== undefined) {
      this.checkIntervalMs = config.checkInterval;
      // Restart auto-check with new interval
      if (this.updateCheckInterval) {
        this.stopAutoCheck();
        this.startAutoCheck(this.checkIntervalMs);
      }
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopAutoCheck();
    this.mainWindow = null;
  }
}

/**
 * Types
 */

export interface UpdateConfig {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  currentVersion: string;
  checkInterval: number;
}

export interface UpdateStatus {
  event: string;
  data?: unknown;
}
