/**
 * useOpenVoice Hook
 *
 * React hook for integrating with the OpenVoice voice cloning service.
 * Provides methods for voice training, synthesis, and status management.
 */

import { useState, useEffect, useCallback } from 'react';
import { createLogger } from '../../shared/logger';

const log = createLogger('useOpenVoice');

// Types matching the Python backend and preload
export interface OpenVoiceStatus {
  running: boolean;
  initialized: boolean;
  device: string;
  error?: string;
  checkpointsReady: boolean;
}

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

export interface SynthesizeRequest {
  text: string;
  profile_id: string;
  language?: string;
  speed?: number;
}

export interface AudioValidationResult {
  valid: boolean;
  files: Array<{
    path: string;
    valid: boolean;
    duration: number;
    speech_duration: number;
    is_quiet: boolean;
    error?: string;
    details: Record<string, unknown>;
  }>;
  summary: {
    total_files: number;
    valid_files: number;
    total_duration: number;
    total_speech_duration: number;
    min_speech_required: number;
    recommended_speech: number;
    speech_percentage: number;
  };
  recommendations: string[];
}

export interface DownloadProgress {
  downloading: boolean;
  progress: number;
  status: string;
  error?: string;
}

export interface TrainingRetryInfo {
  profileId: string;
  attempt: number;
  maxAttempts: number;
  lastError: string;
  message: string;
}

export interface UseOpenVoiceResult {
  // Status
  status: OpenVoiceStatus;
  isLoading: boolean;
  error: string | null;
  trainingRetry: TrainingRetryInfo | null;

  // Service management
  startService: () => Promise<boolean>;
  stopService: () => Promise<void>;
  initializeModels: () => Promise<boolean>;

  // Profile management
  profiles: OpenVoiceProfile[];
  refreshProfiles: () => Promise<void>;
  createProfile: (name: string, audioSamples: string[]) => Promise<OpenVoiceProfile | null>;
  deleteProfile: (profileId: string) => Promise<boolean>;
  trainProfile: (profileId: string) => Promise<boolean>;
  updateProfileSamples: (profileId: string, audioSamples: string[]) => Promise<OpenVoiceProfile | null>;

  // Audio validation
  validateAudio: (audioPaths: string[]) => Promise<AudioValidationResult | null>;

  // TTS Synthesis
  synthesize: (request: SynthesizeRequest) => Promise<string | null>;
  synthesizeToFile: (request: SynthesizeRequest) => Promise<string | null>;

  // Checkpoints
  checkpointsReady: boolean;
  downloadCheckpoints: () => Promise<{ success: boolean; error?: string }>;
  downloadProgress: DownloadProgress | null;
}

export function useOpenVoice(): UseOpenVoiceResult {
  const [status, setStatus] = useState<OpenVoiceStatus>({
    running: false,
    initialized: false,
    device: 'unknown',
    checkpointsReady: false,
  });
  const [profiles, setProfiles] = useState<OpenVoiceProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [trainingRetry, setTrainingRetry] = useState<TrainingRetryInfo | null>(null);

  // Subscribe to status updates
  useEffect(() => {
    const cleanup = window.electronAPI.onOpenVoiceStatus((newStatus) => {
      setStatus(newStatus);
    });

    // Also subscribe to training updates
    const trainingCleanup = window.electronAPI.onOpenVoiceTrainingUpdate((profile) => {
      log.debug('Training update received:', profile.id, profile.state);
      setProfiles(prev => {
        const existing = prev.find(p => p.id === profile.id);
        if (existing) {
          // Update existing profile
          return prev.map(p => p.id === profile.id ? profile : p);
        } else {
          // Add new profile if not found
          return [...prev, profile];
        }
      });
    });

    // Subscribe to download progress updates
    const downloadCleanup = window.electronAPI.onOpenVoiceDownloadProgress((progress) => {
      log.debug('Download progress:', progress.progress, progress.status);
      setDownloadProgress(progress);
      // Clear progress when download completes
      if (!progress.downloading && progress.progress === 100) {
        setTimeout(() => setDownloadProgress(null), 3000);
      }
    });

    // Subscribe to training retry events
    const retryCleanup = window.electronAPI.onOpenVoiceTrainingRetry((info) => {
      log.debug('Training retry:', info.message);
      setTrainingRetry(info);
      // Clear retry info after a short delay to allow UI update
      setTimeout(() => setTrainingRetry(null), 5000);
    });

    return () => {
      cleanup();
      trainingCleanup();
      downloadCleanup();
      retryCleanup();
    };
  }, []);

  // Get initial status on mount
  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('openvoice:status') as OpenVoiceStatus;
      setStatus(result);

      // Auto-refresh profiles when service is running
      if (result.running) {
        const profilesResult = await window.electronAPI.invoke('openvoice:listProfiles') as {
          success: boolean;
          profiles?: OpenVoiceProfile[];
          error?: string
        };
        if (profilesResult.success && profilesResult.profiles) {
          setProfiles(profilesResult.profiles);
        }
      }
    } catch (err) {
      console.error('Failed to get OpenVoice status:', err);
    }
  }, []);

  const startService = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:start') as { success: boolean; error?: string };
      if (!result.success && result.error) {
        setError(result.error);
      }
      await refreshStatus();
      return result.success;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [refreshStatus]);

  const stopService = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await window.electronAPI.invoke('openvoice:stop');
      await refreshStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [refreshStatus]);

  const initializeModels = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:initialize') as { success: boolean; error?: string };
      if (!result.success && result.error) {
        setError(result.error);
      }
      await refreshStatus();
      return result.success;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [refreshStatus]);

  const refreshProfiles = useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.invoke('openvoice:listProfiles') as {
        success: boolean;
        profiles?: OpenVoiceProfile[];
        error?: string
      };
      if (result.success && result.profiles) {
        setProfiles(result.profiles);
      }
    } catch (err) {
      console.error('Failed to refresh profiles:', err);
    }
  }, []);

  const createProfile = useCallback(async (name: string, audioSamples: string[]): Promise<OpenVoiceProfile | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:createProfile', name, audioSamples) as {
        success: boolean;
        profile?: OpenVoiceProfile;
        error?: string;
      };
      if (result.success && result.profile) {
        await refreshProfiles();
        return result.profile;
      }
      if (result.error) {
        setError(result.error);
      }
      return null;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfiles]);

  const deleteProfile = useCallback(async (profileId: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.invoke('openvoice:deleteProfile', profileId) as { success: boolean };
      await refreshProfiles();
      return result.success;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfiles]);

  const trainProfile = useCallback(async (profileId: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:trainProfile', profileId) as {
        success: boolean;
        error?: string
      };
      if (!result.success && result.error) {
        setError(result.error);
      }
      return result.success;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateProfileSamples = useCallback(async (profileId: string, audioSamples: string[]): Promise<OpenVoiceProfile | null> => {
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:updateProfileSamples', profileId, audioSamples) as {
        success: boolean;
        profile?: OpenVoiceProfile;
        error?: string;
      };
      if (result.success && result.profile) {
        // Update local profiles state
        setProfiles(prev => prev.map(p => p.id === profileId ? result.profile! : p));
        return result.profile;
      }
      if (result.error) {
        setError(result.error);
      }
      return null;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  const synthesize = useCallback(async (request: SynthesizeRequest): Promise<string | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:synthesize', request) as {
        success: boolean;
        audioPath?: string;
        error?: string;
      };
      if (result.success && result.audioPath) {
        return result.audioPath;
      }
      if (result.error) {
        setError(result.error);
      }
      return null;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const synthesizeToFile = useCallback(async (request: SynthesizeRequest): Promise<string | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:synthesizeToFile', request) as {
        success: boolean;
        audioPath?: string;
        error?: string;
      };
      if (result.success && result.audioPath) {
        return result.audioPath;
      }
      if (result.error) {
        setError(result.error);
      }
      return null;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const downloadCheckpoints = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.invoke('openvoice:downloadCheckpoints') as {
        success: boolean;
        error?: string
      };
      await refreshStatus();
      return result;
    } catch (err) {
      return { success: false, error: (err as Error).message };
    } finally {
      setIsLoading(false);
    }
  }, [refreshStatus]);

  const validateAudio = useCallback(async (audioPaths: string[]): Promise<AudioValidationResult | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke('openvoice:validateAudio', audioPaths) as {
        success: boolean;
        valid?: boolean;
        files?: AudioValidationResult['files'];
        summary?: AudioValidationResult['summary'];
        recommendations?: string[];
        error?: string;
      };
      if (result.success && result.valid !== undefined) {
        return {
          valid: result.valid,
          files: result.files || [],
          summary: result.summary || {
            total_files: 0,
            valid_files: 0,
            total_duration: 0,
            total_speech_duration: 0,
            min_speech_required: 5,
            recommended_speech: 30,
            speech_percentage: 0,
          },
          recommendations: result.recommendations || [],
        };
      }
      if (result.error) {
        setError(result.error);
      }
      return null;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    status,
    isLoading,
    error,
    trainingRetry,
    startService,
    stopService,
    initializeModels,
    profiles,
    refreshProfiles,
    createProfile,
    deleteProfile,
    trainProfile,
    updateProfileSamples,
    validateAudio,
    synthesize,
    synthesizeToFile,
    checkpointsReady: status.checkpointsReady,
    downloadCheckpoints,
    downloadProgress,
  };
}

export default useOpenVoice;
