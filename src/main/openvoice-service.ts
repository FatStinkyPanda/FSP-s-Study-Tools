/**
 * OpenVoice Service Manager
 *
 * Manages the Python OpenVoice backend service and provides IPC handlers
 * for voice training and TTS synthesis.
 */

import { spawn, ChildProcess } from 'child_process';
import { app, ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const SERVICE_PORT = 5123;
const SERVICE_HOST = '127.0.0.1';
const SERVICE_URL = `http://${SERVICE_HOST}:${SERVICE_PORT}`;

interface OpenVoiceProfile {
  id: string;
  name: string;
  state: 'pending' | 'extracting' | 'ready' | 'failed';
  created_at: string;
  audio_samples: string[];
  embedding_path?: string;
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
  checkpointsReady: boolean;
}

class OpenVoiceServiceManager {
  private process: ChildProcess | null = null;
  private isStarting = false;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.setupIPCHandlers();
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

      // Find service script
      const serviceScript = path.join(app.getAppPath(), 'src', 'python', 'openvoice_service.py');
      if (!fs.existsSync(serviceScript)) {
        return { success: false, error: `Service script not found: ${serviceScript}` };
      }

      console.log(`Starting OpenVoice service: ${pythonPath} ${serviceScript}`);

      // Add bundled ffmpeg to PATH for audio processing
      const ffmpegBin = path.join(app.getAppPath(), 'ffmpeg_bin');
      const envPath = process.env.PATH || '';
      const newPath = fs.existsSync(ffmpegBin) ? `${ffmpegBin}${path.delimiter}${envPath}` : envPath;

      this.process = spawn(pythonPath, [serviceScript, '--port', String(SERVICE_PORT)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: newPath },
      });

      this.process.stdout?.on('data', (data) => {
        console.log(`[OpenVoice] ${data}`);
      });

      this.process.stderr?.on('data', (data) => {
        console.error(`[OpenVoice Error] ${data}`);
      });

      this.process.on('close', (code) => {
        console.log(`OpenVoice service exited with code ${code}`);
        this.process = null;
        this.sendStatusUpdate();
      });

      this.process.on('error', (error) => {
        console.error('OpenVoice service error:', error);
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

      this.sendStatusUpdate();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      this.isStarting = false;
    }
  }

  async stopService(): Promise<{ success: boolean }> {
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
    const result = await this.makeRequest('POST', '/initialize');
    this.sendStatusUpdate();
    return result;
  }

  async listProfiles(): Promise<{ success: boolean; profiles?: OpenVoiceProfile[]; error?: string }> {
    const result = await this.makeRequest('GET', '/profiles');
    if (result.success) {
      return { success: true, profiles: result.data?.profiles || [] };
    }
    return { success: false, error: result.error };
  }

  async getProfile(profileId: string): Promise<{ success: boolean; profile?: OpenVoiceProfile; error?: string }> {
    const result = await this.makeRequest('GET', `/profiles/${profileId}`);
    if (result.success) {
      return { success: true, profile: result.data };
    }
    return { success: false, error: result.error };
  }

  async createProfile(
    name: string,
    audioSamples: string[]
  ): Promise<{ success: boolean; profile?: OpenVoiceProfile; error?: string }> {
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
    const result = await this.makeRequest('DELETE', `/profiles/${profileId}`);
    return result;
  }

  async trainProfile(profileId: string): Promise<{ success: boolean; error?: string }> {
    const result = await this.makeRequest('POST', `/profiles/${profileId}/train`);

    // Start polling for training progress
    if (result.success) {
      this.pollTrainingProgress(profileId);
    }

    return result;
  }

  async updateProfileSamples(
    profileId: string,
    audioSamples: string[]
  ): Promise<{ success: boolean; profile?: OpenVoiceProfile; error?: string }> {
    const result = await this.makeRequest('PUT', `/profiles/${profileId}/samples`, {
      audio_samples: audioSamples,
    });
    if (result.success) {
      return { success: true, profile: result.data };
    }
    return { success: false, error: result.error };
  }

  async synthesize(request: SynthesizeRequest): Promise<{ success: boolean; audioPath?: string; error?: string }> {
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
    const result = await this.makeRequest('GET', '/checkpoints/status');
    if (result.success) {
      return {
        ready: result.data?.ready || false,
        checkpoints_dir: result.data?.checkpoints_dir,
      };
    }
    return { ready: false, error: result.error };
  }

  async downloadCheckpoints(): Promise<{ success: boolean; message?: string; error?: string }> {
    // Start automatic checkpoint download
    const result = await this.makeRequest('POST', '/checkpoints/download', {}, 10000);

    if (result.success) {
      // Start polling for progress
      this.pollDownloadProgress();
      return { success: true, message: 'Download started' };
    }

    // If service isn't running, return manual instructions
    const checkpointsDir = path.join(app.getAppPath(), 'openvoice_checkpoints');
    return {
      success: false,
      error: result.error || `Please download OpenVoice v2 checkpoints from https://myshell-public-repo-hosting.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip and extract to ${checkpointsDir}`,
    };
  }

  async getDownloadStatus(): Promise<{
    downloading: boolean;
    progress: number;
    status: string;
    error?: string;
  }> {
    const result = await this.makeRequest('GET', '/checkpoints/download/status');
    if (result.success) {
      return {
        downloading: result.data?.downloading || false,
        progress: result.data?.progress || 0,
        status: result.data?.status || '',
        error: result.data?.error,
      };
    }
    return { downloading: false, progress: 0, status: '', error: result.error };
  }

  private async pollDownloadProgress() {
    const poll = async () => {
      const status = await this.getDownloadStatus();
      this.sendDownloadUpdate(status);

      if (status.downloading) {
        setTimeout(poll, 1000);
      } else {
        // Refresh main status when done
        this.sendStatusUpdate();
      }
    };
    poll();
  }

  private sendDownloadUpdate(status: {
    downloading: boolean;
    progress: number;
    status: string;
    error?: string;
  }) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('openvoice:downloadProgress', status);
    }
  }

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
        console.log(`Found bundled Python at: ${pythonPath}`);
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

        if (result.profile.state === 'extracting') {
          setTimeout(poll, 1000);
        }
      }
    };
    poll();
  }

  private sendStatusUpdate() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.getStatus().then((status) => {
        this.mainWindow?.webContents.send('openvoice:statusUpdate', status);
      });
    }
  }

  private sendTrainingUpdate(profile: OpenVoiceProfile) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('openvoice:trainingUpdate', profile);
    }
  }

  cleanup() {
    this.stopService();
  }
}

// Singleton instance
export const openVoiceService = new OpenVoiceServiceManager();

// Export for use in main process
export default openVoiceService;
