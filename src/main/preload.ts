import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// OpenVoice status interface
export interface OpenVoiceStatus {
  running: boolean;
  initialized: boolean;
  device: string;
  error?: string;
  checkpointsReady: boolean;
}

// Vosk speech recognition result interface
export interface VoskResult {
  type: 'partial' | 'final';
  text: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    conf: number;
  }>;
}

// Vosk status interface
export interface VoskStatus {
  available: boolean;
  modelInitialized: boolean;
  isRecognizing: boolean;
  modelExists: boolean;
  modelPath: string | null;
  error: string | null;
}

// OpenVoice profile interface
export interface OpenVoiceProfile {
  id: string;
  name: string;
  state: 'pending' | 'extracting' | 'ready' | 'failed';
  created_at: string;
  audio_samples: string[];
  embedding_path?: string;
  error?: string;
  progress: number;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Generic invoke method for all IPC channels
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

  // Update event listeners
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('update-status', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // OpenVoice status event listener
  onOpenVoiceStatus: (callback: (status: OpenVoiceStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: OpenVoiceStatus) => callback(status);
    ipcRenderer.on('openvoice:statusUpdate', handler);
    return () => ipcRenderer.removeListener('openvoice:statusUpdate', handler);
  },

  // OpenVoice training progress event listener
  onOpenVoiceTrainingUpdate: (callback: (profile: OpenVoiceProfile) => void) => {
    const handler = (_event: IpcRendererEvent, profile: OpenVoiceProfile) => callback(profile);
    ipcRenderer.on('openvoice:trainingUpdate', handler);
    return () => ipcRenderer.removeListener('openvoice:trainingUpdate', handler);
  },

  // OpenVoice checkpoint download progress event listener
  onOpenVoiceDownloadProgress: (callback: (status: DownloadProgress) => void) => {
    const handler = (_event: IpcRendererEvent, status: DownloadProgress) => callback(status);
    ipcRenderer.on('openvoice:downloadProgress', handler);
    return () => ipcRenderer.removeListener('openvoice:downloadProgress', handler);
  },

  // OpenVoice training retry event listener
  onOpenVoiceTrainingRetry: (callback: (info: TrainingRetryInfo) => void) => {
    const handler = (_event: IpcRendererEvent, info: TrainingRetryInfo) => callback(info);
    ipcRenderer.on('openvoice:trainingRetry', handler);
    return () => ipcRenderer.removeListener('openvoice:trainingRetry', handler);
  },

  // Vosk speech recognition results event listener
  onVoskResults: (callback: (results: VoskResult[]) => void) => {
    const handler = (_event: IpcRendererEvent, results: VoskResult[]) => callback(results);
    ipcRenderer.on('vosk:results', handler);
    return () => ipcRenderer.removeListener('vosk:results', handler);
  },
});

// Update status interface
export interface UpdateStatus {
  event: string;
  data?: unknown;
}

// Download progress interface
export interface DownloadProgress {
  downloading: boolean;
  progress: number;
  status: string;
  error?: string;
}

// Training retry info interface
export interface TrainingRetryInfo {
  profileId: string;
  attempt: number;
  maxAttempts: number;
  lastError: string;
  message: string;
}

// Type definitions for TypeScript
export interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  onOpenVoiceStatus: (callback: (status: OpenVoiceStatus) => void) => () => void;
  onOpenVoiceTrainingUpdate: (callback: (profile: OpenVoiceProfile) => void) => () => void;
  onOpenVoiceDownloadProgress: (callback: (status: DownloadProgress) => void) => () => void;
  onOpenVoiceTrainingRetry: (callback: (info: TrainingRetryInfo) => void) => () => void;
  onVoskResults: (callback: (results: VoskResult[]) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
