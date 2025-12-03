/**
 * Voice Cloning Service Manager (XTTS v2)
 *
 * Manages the Python XTTS v2 backend service and provides IPC handlers
 * for voice cloning and TTS synthesis.
 *
 * XTTS v2 provides:
 * - Zero-shot voice cloning (no training needed, just reference audio)
 * - Better voice similarity than OpenVoice
 * - Faster inference
 * - Multi-language support
 *
 * Note: IPC channels still use 'openvoice:' prefix for backward compatibility
 */

import { spawn, ChildProcess } from 'child_process';
import { app, ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { createLogger } from '../shared/logger';

const log = createLogger('XTTS');

// XTTS service configuration - configurable via environment variables
const SERVICE_PORT = parseInt(process.env.OPENVOICE_PORT || '5123', 10);
const SERVICE_HOST = process.env.OPENVOICE_HOST || '127.0.0.1';
const SERVICE_URL = `http://${SERVICE_HOST}:${SERVICE_PORT}`;

// Training retry configuration - configurable via environment variables
const TRAINING_MAX_RETRIES = parseInt(process.env.OPENVOICE_MAX_RETRIES || '3', 10);
const TRAINING_RETRY_BASE_DELAY_MS = parseInt(process.env.OPENVOICE_RETRY_DELAY_MS || '2000', 10);

// Error types for classification
const TRANSIENT_ERROR_PATTERNS = [
  'timeout',
  'ECONNRESET',
  'ECONNREFUSED',
  'temporarily unavailable',
  'service unavailable',
  'try again',
  'busy',
];

const PERMANENT_ERROR_PATTERNS = [
  'invalid audio',
  'unsupported format',
  'file not found',
  'permission denied',
  'invalid profile',
  'not enough speech',
];

interface VoiceProfile {
  id: string;
  name: string;
  state: 'pending' | 'processing' | 'ready' | 'failed';
  created_at: string;
  audio_samples: string[];
  speaker_wav?: string;  // Processed reference audio for XTTS
  error?: string;
  progress: number;
}

interface SynthesizeRequest {
  text: string;
  profile_id: string;
  language?: string;
  speed?: number;
}

interface ServiceStatus {
  running: boolean;
  initialized: boolean;
  device: string;
  error?: string;
  checkpointsReady: boolean;  // For XTTS, this is always true once model downloads
}

// Auto-shutdown configuration - stop service after period of inactivity
const AUTO_SHUTDOWN_DELAY_MS = parseInt(process.env.OPENVOICE_AUTO_SHUTDOWN_MS || '300000', 10); // 5 minutes default

class XTTSServiceManager {
  private process: ChildProcess | null = null;
  private isStarting = false;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;
  private autoShutdownTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number = 0;

  constructor() {
    this.setupIPCHandlers();
  }

  /**
   * Reset the auto-shutdown timer - called on every activity
   */
  private resetAutoShutdownTimer(): void {
    this.lastActivityTime = Date.now();

    if (this.autoShutdownTimer) {
      clearTimeout(this.autoShutdownTimer);
    }

    // Only set timer if service is running
    if (this.process) {
      this.autoShutdownTimer = setTimeout(() => {
        const idleTime = Date.now() - this.lastActivityTime;
        if (idleTime >= AUTO_SHUTDOWN_DELAY_MS) {
          log.info(`XTTS service idle for ${Math.round(idleTime / 1000)}s, auto-stopping to save resources`);
          this.stopService();
        }
      }, AUTO_SHUTDOWN_DELAY_MS);
    }
  }

  /**
   * Ensure the service is running - auto-starts if needed
   * This is the key method for seamless user experience
   */
  async ensureServiceRunning(): Promise<{ success: boolean; error?: string }> {
    // If already running, just reset the shutdown timer
    if (this.process) {
      this.resetAutoShutdownTimer();
      return { success: true };
    }

    // If starting, wait for it
    if (this.isStarting) {
      // Wait up to 30 seconds for startup to complete
      const maxWait = 30000;
      const startTime = Date.now();
      while (this.isStarting && Date.now() - startTime < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (this.process) {
        return { success: true };
      }
      return { success: false, error: 'Service startup timed out' };
    }

    // Start the service
    log.info('Auto-starting XTTS service on demand');
    return this.startService();
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  private setupIPCHandlers() {
    // Service management
    ipcMain.handle('openvoice:start', async () => {
      return this.startService();
    });

    ipcMain.handle('openvoice:stop', async () => {
      return this.stopService();
    });

    ipcMain.handle('openvoice:status', async () => {
      return this.getStatus();
    });

    ipcMain.handle('openvoice:initialize', async () => {
      return this.initializeModels();
    });

    // Profile management
    ipcMain.handle('openvoice:listProfiles', async () => {
      return this.listProfiles();
    });

    ipcMain.handle('openvoice:getProfile', async (_event, profileId: string) => {
      return this.getProfile(profileId);
    });

    ipcMain.handle('openvoice:createProfile', async (_event, name: string, audioSamples: string[]) => {
      return this.createProfile(name, audioSamples);
    });

    ipcMain.handle('openvoice:deleteProfile', async (_event, profileId: string) => {
      return this.deleteProfile(profileId);
    });

    ipcMain.handle('openvoice:trainProfile', async (_event, profileId: string) => {
      return this.trainProfile(profileId);
    });

    ipcMain.handle('openvoice:updateProfileSamples', async (_event, profileId: string, audioSamples: string[]) => {
      return this.updateProfileSamples(profileId, audioSamples);
    });

    // TTS Synthesis
    ipcMain.handle('openvoice:synthesize', async (_event, request: SynthesizeRequest) => {
      return this.synthesize(request);
    });

    ipcMain.handle('openvoice:synthesizeToFile', async (_event, request: SynthesizeRequest) => {
      return this.synthesizeToFile(request);
    });

    // Long text synthesis (chunked)
    ipcMain.handle('openvoice:synthesizeLong', async (_event, request: SynthesizeRequest) => {
      return this.synthesizeLong(request);
    });

    // Checkpoints management
    ipcMain.handle('openvoice:checkpointsStatus', async () => {
      return this.checkpointsStatus();
    });

    ipcMain.handle('openvoice:downloadCheckpoints', async () => {
      return this.downloadCheckpoints();
    });

    // Audio validation
    ipcMain.handle('openvoice:validateAudio', async (_event, audioPaths: string[]) => {
      return this.validateAudio(audioPaths);
    });

    // Download status
    ipcMain.handle('openvoice:getDownloadStatus', async () => {
      return this.getDownloadStatus();
    });
  }

  private async makeRequest(
    method: string,
    endpoint: string,
    body?: object,
    timeoutMs: number = 60000
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    return new Promise((resolve) => {
      const url = new URL(endpoint, SERVICE_URL);
      const options = {
        hostname: SERVICE_HOST,
        port: SERVICE_PORT,
        path: url.pathname,
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, data: parsed });
            } else {
              resolve({ success: false, error: parsed.error || 'Request failed' });
            }
          } catch (e) {
            resolve({ success: false, error: 'Invalid response' });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  async startService(): Promise<{ success: boolean; error?: string }> {
    if (this.process) {
      return { success: true };
    }

    if (this.isStarting) {
      return { success: false, error: 'Service is already starting' };
    }

    this.isStarting = true;

    try {
      // Find Python executable
      const pythonPath = await this.findPython();
      if (!pythonPath) {
        return { success: false, error: 'Python not found. Please install Python 3.9+' };
      }

      // Find service script (XTTS v2)
      const serviceScript = path.join(app.getAppPath(), 'src', 'python', 'xtts_service.py');
      if (!fs.existsSync(serviceScript)) {
        return { success: false, error: `Service script not found: ${serviceScript}` };
      }

      log.info(`Starting XTTS service: ${pythonPath} ${serviceScript}`);

      // Add bundled ffmpeg to PATH for audio processing
      const ffmpegBin = path.join(app.getAppPath(), 'ffmpeg_bin');
      const envPath = process.env.PATH || '';
      const newPath = fs.existsSync(ffmpegBin) ? `${ffmpegBin}${path.delimiter}${envPath}` : envPath;

      this.process = spawn(pythonPath, [serviceScript, '--port', String(SERVICE_PORT)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: newPath },
      });

      this.process.stdout?.on('data', (data) => {
        log.debug(`${data}`);
      });

      this.process.stderr?.on('data', (data) => {
        log.warn(`${data}`);
      });

      this.process.on('close', (code) => {
        log.info(`XTTS service exited with code ${code}`);
        this.process = null;
        this.sendStatusUpdate();
      });

      this.process.on('error', (error) => {
        log.error('XTTS service error:', error);
        this.process = null;
      });

      // Wait for service to be ready
      const ready = await this.waitForService(30000);
      if (!ready) {
        this.stopService();
        return { success: false, error: 'Service failed to start within timeout' };
      }

      // Start status monitoring
      this.startStatusMonitoring();

      // Start auto-shutdown timer
      this.resetAutoShutdownTimer();

      this.sendStatusUpdate();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      this.isStarting = false;
    }
  }

  async stopService(): Promise<{ success: boolean }> {
    // Clear auto-shutdown timer
    if (this.autoShutdownTimer) {
      clearTimeout(this.autoShutdownTimer);
      this.autoShutdownTimer = null;
    }

    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.sendStatusUpdate();
    return { success: true };
  }

  async getStatus(): Promise<ServiceStatus> {
    if (!this.process) {
      return {
        running: false,
        initialized: false,
        device: 'unknown',
        checkpointsReady: false,
      };
    }

    const result = await this.makeRequest('GET', '/health');
    if (!result.success) {
      return {
        running: true,
        initialized: false,
        device: 'unknown',
        error: result.error,
        checkpointsReady: false,
      };
    }

    const checkpoints = await this.checkpointsStatus();

    return {
      running: true,
      initialized: result.data?.initialized || false,
      device: result.data?.device || 'unknown',
      error: result.data?.error,
      checkpointsReady: checkpoints.ready || false,
    };
  }

  async initializeModels(): Promise<{ success: boolean; error?: string }> {
    // Auto-start service if not running
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    this.resetAutoShutdownTimer();
    const result = await this.makeRequest('POST', '/initialize');
    this.sendStatusUpdate();
    return result;
  }

  async listProfiles(): Promise<{ success: boolean; profiles?: VoiceProfile[]; error?: string }> {
    // Auto-start service if not running
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}`, profiles: [] };
    }

    this.resetAutoShutdownTimer();
    const result = await this.makeRequest('GET', '/profiles');
    if (result.success) {
      return { success: true, profiles: result.data?.profiles || [] };
    }
    return { success: false, error: result.error };
  }

  async getProfile(profileId: string): Promise<{ success: boolean; profile?: VoiceProfile; error?: string }> {
    // Auto-start service if not running
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    this.resetAutoShutdownTimer();
    const result = await this.makeRequest('GET', `/profiles/${profileId}`);
    if (result.success) {
      return { success: true, profile: result.data };
    }
    return { success: false, error: result.error };
  }

  async createProfile(
    name: string,
    audioSamples: string[]
  ): Promise<{ success: boolean; profile?: VoiceProfile; error?: string }> {
    // Auto-start service if not running
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    this.resetAutoShutdownTimer();
    const result = await this.makeRequest('POST', '/profiles', {
      name,
      audio_samples: audioSamples,
    });
    if (result.success) {
      return { success: true, profile: result.data };
    }
    return { success: false, error: result.error };
  }

  async deleteProfile(profileId: string): Promise<{ success: boolean; error?: string }> {
    // Auto-start service if not running
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    this.resetAutoShutdownTimer();
    const result = await this.makeRequest('DELETE', `/profiles/${profileId}`);
    return result;
  }

  async trainProfile(profileId: string): Promise<{ success: boolean; error?: string; retryAttempt?: number }> {
    // Auto-start service if not running (seamless user experience)
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    // Reset auto-shutdown timer on activity
    this.resetAutoShutdownTimer();

    return this.trainProfileWithRetry(profileId, 0);
  }

  private async trainProfileWithRetry(
    profileId: string,
    attempt: number
  ): Promise<{ success: boolean; error?: string; retryAttempt?: number }> {
    // Keep activity going during training
    this.resetAutoShutdownTimer();

    // XTTS uses /process endpoint (zero-shot, just prepares reference audio)
    const result = await this.makeRequest('POST', `/profiles/${profileId}/process`);

    // Start polling for training progress if request was accepted
    if (result.success) {
      this.pollTrainingProgress(profileId);
      return { success: true };
    }

    // Check if error is transient and we should retry
    const errorMessage = result.error?.toLowerCase() || '';
    const isTransientError = TRANSIENT_ERROR_PATTERNS.some(pattern =>
      errorMessage.includes(pattern.toLowerCase())
    );
    const isPermanentError = PERMANENT_ERROR_PATTERNS.some(pattern =>
      errorMessage.includes(pattern.toLowerCase())
    );

    // Don't retry permanent errors
    if (isPermanentError) {
      log.error(`Training failed with permanent error: ${result.error}`);
      return { success: false, error: result.error };
    }

    // Retry transient errors up to max retries
    if (isTransientError && attempt < TRAINING_MAX_RETRIES) {
      const nextAttempt = attempt + 1;
      const delay = TRAINING_RETRY_BASE_DELAY_MS * Math.pow(2, attempt); // Exponential backoff

      log.info(`Training attempt ${nextAttempt} failed with transient error. Retrying in ${delay}ms...`);

      // Notify frontend about retry
      this.sendTrainingRetryUpdate(profileId, nextAttempt, TRAINING_MAX_RETRIES, result.error || 'Unknown error');

      await new Promise(resolve => setTimeout(resolve, delay));
      return this.trainProfileWithRetry(profileId, nextAttempt);
    }

    // Max retries exceeded or unknown error type
    if (attempt >= TRAINING_MAX_RETRIES) {
      const finalError = `Training failed after ${TRAINING_MAX_RETRIES} attempts: ${result.error}`;
      log.error(finalError);
      return { success: false, error: finalError, retryAttempt: attempt };
    }

    // Unknown error type - don't retry
    return { success: false, error: result.error };
  }

  private sendTrainingRetryUpdate(profileId: string, attempt: number, maxAttempts: number, lastError: string) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('openvoice:trainingRetry', {
          profileId,
          attempt,
          maxAttempts,
          lastError,
          message: `Retrying training (attempt ${attempt}/${maxAttempts})...`,
        });
      } catch (error) {
        console.error('Error sending training retry update:', error);
      }
    }
  }

  async updateProfileSamples(
    profileId: string,
    audioSamples: string[]
  ): Promise<{ success: boolean; profile?: VoiceProfile; error?: string }> {
    // Auto-start service if not running
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    this.resetAutoShutdownTimer();
    const result = await this.makeRequest('PUT', `/profiles/${profileId}/samples`, {
      audio_samples: audioSamples,
    });
    if (result.success) {
      return { success: true, profile: result.data };
    }
    return { success: false, error: result.error };
  }

  async synthesize(request: SynthesizeRequest): Promise<{ success: boolean; audioPath?: string; error?: string }> {
    // Auto-start service if not running (seamless user experience)
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    // Reset auto-shutdown timer on activity
    this.resetAutoShutdownTimer();

    // Use 3-minute timeout for synthesis (first synthesis may need to download/load BERT model which takes ~75s)
    const result = await this.makeRequest('POST', '/synthesize', {
      text: request.text,
      profile_id: request.profile_id,
      language: request.language || 'EN',
      speed: request.speed || 1.0,
    }, 180000);

    if (result.success) {
      return { success: true, audioPath: result.data?.audio_path };
    }
    return { success: false, error: result.error };
  }

  async synthesizeToFile(request: SynthesizeRequest): Promise<{ success: boolean; audioPath?: string; error?: string }> {
    // Same as synthesize, but returns the file path
    return this.synthesize(request);
  }

  async synthesizeLong(request: SynthesizeRequest): Promise<{ success: boolean; audioPath?: string; error?: string }> {
    // Auto-start service if not running (seamless user experience)
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    // Reset auto-shutdown timer on activity
    this.resetAutoShutdownTimer();

    // Use the /synthesize/long endpoint for chunked synthesis of long texts
    // Increased timeout (5 minutes) for longer texts that require chunked processing
    const result = await this.makeRequest('POST', '/synthesize/long', {
      text: request.text,
      profile_id: request.profile_id,
      language: request.language || 'EN',
      speed: request.speed || 1.0,
    }, 300000);

    if (result.success) {
      return { success: true, audioPath: result.data?.audio_path };
    }
    return { success: false, error: result.error };
  }

  async checkpointsStatus(): Promise<{ ready: boolean; checkpoints_dir?: string; error?: string }> {
    // For XTTS, check model status instead of checkpoints
    // XTTS auto-downloads the model via the TTS library
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { ready: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    this.resetAutoShutdownTimer();
    const result = await this.makeRequest('GET', '/model/status');
    if (result.success) {
      return {
        ready: result.data?.initialized || false,
        checkpoints_dir: result.data?.model_path,
      };
    }
    return { ready: false, error: result.error };
  }

  async downloadCheckpoints(): Promise<{ success: boolean; message?: string; error?: string }> {
    // For XTTS, model downloads automatically on first use via TTS library
    // This just initializes the model (which triggers download if needed)
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return {
        success: false,
        error: `XTTS service unavailable: ${serviceResult.error}`,
      };
    }

    this.resetAutoShutdownTimer();

    // Initialize the model (triggers automatic download if needed)
    const result = await this.makeRequest('POST', '/initialize', {}, 300000); // 5 min timeout for download

    if (result.success) {
      return { success: true, message: 'XTTS model initialized (downloaded if needed)' };
    }

    return {
      success: false,
      error: result.error || 'Failed to initialize XTTS model',
    };
  }

  async getDownloadStatus(): Promise<{
    downloading: boolean;
    progress: number;
    status: string;
    error?: string;
  }> {
    // XTTS v2 handles model download automatically via the TTS library
    // We check model status instead of a separate download endpoint
    if (!this.process) {
      return { downloading: false, progress: 0, status: 'Service not running' };
    }

    const result = await this.makeRequest('GET', '/model/status');
    if (result.success) {
      const initialized = result.data?.initialized || false;
      return {
        downloading: false,  // XTTS downloads during initialization
        progress: initialized ? 100 : 0,
        status: initialized ? 'Model ready' : 'Model not initialized',
        error: result.data?.error,
      };
    }
    return { downloading: false, progress: 0, status: '', error: result.error };
  }

  // Note: pollDownloadProgress and sendDownloadUpdate removed - XTTS handles model download automatically via TTS library

  async validateAudio(audioPaths: string[]): Promise<{
    success: boolean;
    valid?: boolean;
    files?: Array<{
      path: string;
      valid: boolean;
      duration: number;
      speech_duration: number;
      is_quiet: boolean;
      error?: string;
      details: Record<string, unknown>;
    }>;
    summary?: {
      total_files: number;
      valid_files: number;
      total_duration: number;
      total_speech_duration: number;
      min_speech_required: number;
      recommended_speech: number;
      speech_percentage: number;
    };
    recommendations?: string[];
    error?: string;
  }> {
    // Auto-start service if not running
    const serviceResult = await this.ensureServiceRunning();
    if (!serviceResult.success) {
      return { success: false, error: `XTTS service unavailable: ${serviceResult.error}` };
    }

    this.resetAutoShutdownTimer();

    // Use longer timeout since VAD analysis can take time
    const result = await this.makeRequest('POST', '/validate-audio', {
      audio_paths: audioPaths,
    }, 120000);

    if (result.success) {
      return {
        success: true,
        valid: result.data?.valid,
        files: result.data?.files,
        summary: result.data?.summary,
        recommendations: result.data?.recommendations,
      };
    }
    return { success: false, error: result.error };
  }

  private async findPython(): Promise<string | null> {
    // First, try the bundled Python virtual environment
    const bundledPythonPaths = [
      // Windows paths (relative to app root)
      path.join(app.getAppPath(), 'python_env', 'Scripts', 'python.exe'),
      // For packaged app (resources folder)
      path.join(process.resourcesPath || app.getAppPath(), 'python_env', 'Scripts', 'python.exe'),
      // Development path
      path.join(app.getAppPath(), '..', 'python_env', 'Scripts', 'python.exe'),
    ];

    for (const pythonPath of bundledPythonPaths) {
      if (fs.existsSync(pythonPath)) {
        log.debug(`Found bundled Python at: ${pythonPath}`);
        // Verify it works
        try {
          const result = await new Promise<boolean>((resolve) => {
            const proc = spawn(pythonPath, ['--version']);
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
          });
          if (result) {
            return pythonPath;
          }
        } catch {
          continue;
        }
      }
    }

    // Fallback to system Python
    const candidates = ['python3', 'python', 'py'];

    for (const cmd of candidates) {
      try {
        const result = await new Promise<string | null>((resolve) => {
          const proc = spawn(cmd, ['--version'], { shell: true });
          let output = '';
          proc.stdout?.on('data', (data) => (output += data));
          proc.stderr?.on('data', (data) => (output += data));
          proc.on('close', (code) => {
            if (code === 0 && output.includes('Python 3')) {
              resolve(cmd);
            } else {
              resolve(null);
            }
          });
          proc.on('error', () => resolve(null));
        });
        if (result) return result;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async waitForService(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const result = await this.makeRequest('GET', '/health');
      if (result.success) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  private startStatusMonitoring() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(async () => {
      if (!this.process) {
        if (this.statusCheckInterval) {
          clearInterval(this.statusCheckInterval);
          this.statusCheckInterval = null;
        }
        return;
      }
      this.sendStatusUpdate();
    }, 5000);
  }

  private async pollTrainingProgress(profileId: string) {
    const poll = async () => {
      const result = await this.getProfile(profileId);
      if (result.success && result.profile) {
        this.sendTrainingUpdate(result.profile);

        // XTTS uses 'processing' state instead of 'extracting'
        if (result.profile.state === 'processing') {
          setTimeout(poll, 1000);
        }
      }
    };
    poll();
  }

  private sendStatusUpdate() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.getStatus().then((status) => {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('openvoice:statusUpdate', status);
          }
        } catch (error) {
          console.error('Error sending status update:', error);
        }
      });
    }
  }

  private sendTrainingUpdate(profile: VoiceProfile) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('openvoice:trainingUpdate', profile);
      } catch (error) {
        console.error('Error sending training update:', error);
      }
    }
  }

  cleanup() {
    this.stopService();
  }
}

// Singleton instance - keep 'openVoiceService' name for backward compatibility
export const openVoiceService = new XTTSServiceManager();

// Export for use in main process
export default openVoiceService;
