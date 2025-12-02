/**
 * Vosk Speech Recognition Service Manager
 *
 * Manages the Vosk Python service for offline speech recognition.
 * Features:
 * - Automatic model download and initialization
 * - Streaming speech recognition
 * - IPC communication with renderer process
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app, BrowserWindow } from 'electron';
import { createLogger } from '../shared/logger';

const log = createLogger('VoskService');

const VOSK_SERVICE_PORT = 5124;
const VOSK_SERVICE_URL = `http://127.0.0.1:${VOSK_SERVICE_PORT}`;

interface VoskStatus {
  available: boolean;
  modelInitialized: boolean;
  isRecognizing: boolean;
  modelExists: boolean;
  modelPath: string | null;
  error: string | null;
}

interface VoskResult {
  type: 'partial' | 'final';
  text: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    conf: number;
  }>;
}

// Response types from Python service
interface HealthResponse {
  status: string;
  vosk_available: boolean;
  model_initialized: boolean;
  is_recognizing: boolean;
}

interface StatusResponse {
  vosk_available: boolean;
  model_initialized: boolean;
  model_exists: boolean;
  model_path: string | null;
  model_name: string;
  model_size_mb: number;
  is_recognizing: boolean;
}

interface SuccessResponse {
  success: boolean;
  error?: string;
}

interface StartResponse extends SuccessResponse {
  is_recognizing: boolean;
}

interface ResultsResponse {
  results: VoskResult[];
  is_recognizing: boolean;
}

class VoskServiceManager {
  private process: ChildProcess | null = null;
  private mainWindow: BrowserWindow | null = null;
  private isStarting = false;
  private isRunning = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private resultsPollingInterval: NodeJS.Timeout | null = null;

  /**
   * Set the main window for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Find Python executable from bundled environment
   */
  private async findPython(): Promise<string | null> {
    const appPath = app.getAppPath();

    // Possible Python paths to check
    const pythonPaths = [
      // Development path (project root)
      path.join(appPath, 'python_env', 'Scripts', 'python.exe'),
      // Development path (parent of dist folder)
      path.join(appPath, '..', 'python_env', 'Scripts', 'python.exe'),
      // Packaged app (resources folder)
      path.join(process.resourcesPath || appPath, 'python_env', 'Scripts', 'python.exe'),
    ];

    for (const pythonPath of pythonPaths) {
      if (fs.existsSync(pythonPath)) {
        log.debug(`Found Python at: ${pythonPath}`);
        return pythonPath;
      }
    }

    log.error('Python not found in any expected location');
    log.debug('Searched paths:', pythonPaths);
    return null;
  }

  /**
   * Get the Vosk service script path
   */
  private getServiceScriptPath(): string | null {
    const appPath = app.getAppPath();

    // Possible script paths to check
    const scriptPaths = [
      // Development path
      path.join(appPath, 'src', 'python', 'vosk_service.py'),
      // Development path (parent of dist folder)
      path.join(appPath, '..', 'src', 'python', 'vosk_service.py'),
      // Packaged app (resources folder)
      path.join(process.resourcesPath || appPath, 'python', 'vosk_service.py'),
    ];

    for (const scriptPath of scriptPaths) {
      if (fs.existsSync(scriptPath)) {
        log.debug(`Found Vosk script at: ${scriptPath}`);
        return scriptPath;
      }
    }

    log.error('Vosk service script not found in any expected location');
    log.debug('Searched paths:', scriptPaths);
    return null;
  }

  /**
   * Start the Vosk service
   */
  async start(): Promise<boolean> {
    if (this.isRunning || this.isStarting) {
      log.info('Vosk service already running or starting');
      return this.isRunning;
    }

    this.isStarting = true;

    try {
      const pythonPath = await this.findPython();
      const scriptPath = this.getServiceScriptPath();

      // Check if Python exists
      if (!pythonPath) {
        log.error('Python not found in any expected location');
        this.isStarting = false;
        return false;
      }

      // Check if script exists
      if (!scriptPath) {
        log.error('Vosk service script not found in any expected location');
        this.isStarting = false;
        return false;
      }

      log.info(`Starting Vosk service: ${pythonPath} ${scriptPath}`);

      this.process = spawn(pythonPath, [
        scriptPath,
        '--host', '127.0.0.1',
        '--port', String(VOSK_SERVICE_PORT)
        // Note: Don't use --auto-init as it blocks startup while downloading the model
        // Model will be initialized on-demand when first used
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      // Handle stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          log.debug(`[Vosk] ${message}`);
        }
      });

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          // Filter out common non-error messages
          if (message.includes('WARNING') || message.includes('INFO')) {
            log.debug(`[Vosk] ${message}`);
          } else {
            log.warn(`[Vosk] ${message}`);
          }
        }
      });

      // Handle process exit
      this.process.on('close', (code: number | null) => {
        log.info(`Vosk service exited with code ${code}`);
        this.isRunning = false;
        this.process = null;
        this.stopHealthCheck();
        this.stopResultsPolling();
      });

      // Handle process error
      this.process.on('error', (err: Error) => {
        log.error('Vosk service error:', err);
        this.isRunning = false;
        this.process = null;
      });

      // Wait for service to be ready
      const isReady = await this.waitForService(30000);

      if (isReady) {
        this.isRunning = true;
        this.isStarting = false;
        this.startHealthCheck();
        log.info('Vosk service started successfully');
        return true;
      } else {
        log.error('Vosk service failed to start in time');
        this.stop();
        this.isStarting = false;
        return false;
      }
    } catch (error) {
      log.error('Failed to start Vosk service:', error);
      this.isStarting = false;
      return false;
    }
  }

  /**
   * Wait for the service to be ready
   */
  private async waitForService(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`${VOSK_SERVICE_URL}/health`);
        if (response.ok) {
          const data = await response.json() as HealthResponse;
          if (data.vosk_available) {
            return true;
          }
        }
      } catch {
        // Service not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Stop the Vosk service
   */
  stop(): void {
    this.stopHealthCheck();
    this.stopResultsPolling();

    if (this.process) {
      log.info('Stopping Vosk service...');

      try {
        // On Windows, we need to kill the process tree
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(this.process.pid), '/f', '/t']);
        } else {
          this.process.kill('SIGTERM');
        }
      } catch (error) {
        log.error('Error stopping Vosk service:', error);
      }

      this.process = null;
    }

    this.isRunning = false;
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const response = await fetch(`${VOSK_SERVICE_URL}/health`);
        if (!response.ok) {
          log.warn('Vosk service health check failed');
        }
      } catch {
        log.warn('Vosk service not responding');
      }
    }, 10000);
  }

  /**
   * Stop health check interval
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<VoskStatus> {
    try {
      const response = await fetch(`${VOSK_SERVICE_URL}/status`);
      if (response.ok) {
        const data = await response.json() as StatusResponse;
        return {
          available: data.vosk_available,
          modelInitialized: data.model_initialized,
          isRecognizing: data.is_recognizing,
          modelExists: data.model_exists,
          modelPath: data.model_path,
          error: null
        };
      }
    } catch {
      // Service not running
    }

    return {
      available: false,
      modelInitialized: false,
      isRecognizing: false,
      modelExists: false,
      modelPath: null,
      error: 'Service not running'
    };
  }

  /**
   * Initialize the Vosk model (downloads if needed)
   */
  async initializeModel(): Promise<boolean> {
    try {
      const response = await fetch(`${VOSK_SERVICE_URL}/initialize`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json() as SuccessResponse;
        return data.success;
      }
      return false;
    } catch (error) {
      log.error('Failed to initialize Vosk model:', error);
      return false;
    }
  }

  /**
   * Start streaming recognition
   */
  async startRecognition(sampleRate: number = 16000): Promise<boolean> {
    try {
      const response = await fetch(`${VOSK_SERVICE_URL}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_rate: sampleRate })
      });

      if (response.ok) {
        const data = await response.json() as StartResponse;
        if (data.success) {
          this.startResultsPolling();
        }
        return data.success;
      }
      return false;
    } catch (error) {
      log.error('Failed to start recognition:', error);
      return false;
    }
  }

  /**
   * Stop streaming recognition
   */
  async stopRecognition(): Promise<boolean> {
    this.stopResultsPolling();

    try {
      const response = await fetch(`${VOSK_SERVICE_URL}/stop`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json() as SuccessResponse;
        return data.success;
      }
      return false;
    } catch (error) {
      log.error('Failed to stop recognition:', error);
      return false;
    }
  }

  /**
   * Send audio data for recognition
   */
  async sendAudio(audioData: ArrayBuffer): Promise<boolean> {
    try {
      const response = await fetch(`${VOSK_SERVICE_URL}/audio`, {
        method: 'POST',
        body: audioData
      });

      return response.ok;
    } catch (error) {
      // Don't log every failed send
      return false;
    }
  }

  /**
   * Get recognition results
   */
  async getResults(): Promise<VoskResult[]> {
    try {
      const response = await fetch(`${VOSK_SERVICE_URL}/results`);
      if (response.ok) {
        const data = await response.json() as ResultsResponse;
        return data.results || [];
      }
    } catch {
      // Silent fail
    }
    return [];
  }

  /**
   * Start polling for results
   */
  private startResultsPolling(): void {
    this.stopResultsPolling();

    this.resultsPollingInterval = setInterval(async () => {
      const results = await this.getResults();
      if (results.length > 0 && this.mainWindow) {
        this.mainWindow.webContents.send('vosk:results', results);
      }
    }, 100); // Poll every 100ms for low latency
  }

  /**
   * Stop polling for results
   */
  private stopResultsPolling(): void {
    if (this.resultsPollingInterval) {
      clearInterval(this.resultsPollingInterval);
      this.resultsPollingInterval = null;
    }
  }

  /**
   * Check if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stop();
  }
}

// Export singleton instance
export const voskService = new VoskServiceManager();
