/**
 * VoiceProfileEditor Component
 *
 * A modal component for editing and managing individual voice profiles.
 * Allows users to:
 * - Rename profiles
 * - View and manage audio samples used for training
 * - Add new audio samples (file upload or record in-app)
 * - Remove audio samples
 * - Trigger retraining when samples change
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './VoiceProfileEditor.css';

export interface VoiceTrainingSample {
  id: string;
  name: string;
  path?: string;
  duration: number;
  scriptId?: number;
  createdAt: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  type: 'system' | 'custom';
  systemVoice?: string;
  openvoiceModel?: string;
  openvoiceProfileId?: string;
  audioSamplePath?: string;
  trainingSamples?: VoiceTrainingSample[];
  trainingStatus?: 'pending' | 'training' | 'ready' | 'failed';
  trainingProgress?: number;
  trainingError?: string;
  created?: string;
}

interface VoiceProfileEditorProps {
  profile: VoiceProfile;
  onClose: () => void;
  onSave: (updatedProfile: VoiceProfile, needsRetraining: boolean) => Promise<void>;
  onRetrain: (profileId: string) => Promise<void>;
  systemVoices: SpeechSynthesisVoice[];
  isLoading?: boolean;
}

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

export function VoiceProfileEditor({
  profile,
  onClose,
  onSave,
  onRetrain,
  systemVoices,
  isLoading = false,
}: VoiceProfileEditorProps) {
  const [editedProfile, setEditedProfile] = useState<VoiceProfile>({ ...profile });
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [samplesChanged, setSamplesChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'samples' | 'record'>('details');
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    summary?: {
      total_duration: number;
      total_speech_duration: number;
      speech_percentage: number;
    };
    recommendations?: string[];
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up audio preview URL on unmount
  useEffect(() => {
    return () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    };
  }, [audioPreviewUrl]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        if (audioPreviewUrl) {
          URL.revokeObjectURL(audioPreviewUrl);
        }
        setAudioPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setRecordingTime(0);

      // Start recording timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      setError('Failed to access microphone. Please check permissions.');
      console.error('Recording error:', err);
    }
  }, [audioPreviewUrl]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Add recorded sample to profile
  const addRecordedSample = useCallback(async () => {
    if (!recordedBlob) return;

    try {
      // Convert blob to ArrayBuffer for saving
      const arrayBuffer = await recordedBlob.arrayBuffer();
      const sampleId = `sample-${Date.now()}`;
      const sampleName = `Recording ${new Date().toLocaleString()}`;

      // Save via electron API using existing voice:saveAudioSample handler
      const result = await window.electronAPI.invoke('voice:saveAudioSample', {
        profileId: editedProfile.id,
        sampleId,
        audioData: arrayBuffer,
        sampleName,
        duration: recordingTime,
      }) as { success: boolean; sample?: VoiceTrainingSample; error?: string };

      if (result.success && result.sample) {
        const newSamples = [...(editedProfile.trainingSamples || []), result.sample];
        setEditedProfile(prev => ({
          ...prev,
          trainingSamples: newSamples,
        }));
        setSamplesChanged(true);
        setRecordedBlob(null);
        setAudioPreviewUrl(null);
        setRecordingTime(0);
      } else {
        setError(result.error || 'Failed to save recording');
      }
    } catch (err) {
      setError('Failed to save recording');
      console.error('Save recording error:', err);
    }
  }, [recordedBlob, recordingTime, editedProfile.id, editedProfile.trainingSamples]);

  // Add audio file from disk
  const addAudioFile = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'webm'] },
        ],
        properties: ['openFile'],
      }) as { canceled: boolean; filePaths: string[] };

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const fileName = filePath.split(/[\\/]/).pop() || 'audio';
        const sampleId = `sample-${Date.now()}`;

        // Copy file to profile directory using existing voice:copyAudioFile handler
        const copyResult = await window.electronAPI.invoke('voice:copyAudioFile', {
          profileId: editedProfile.id,
          sourcePath: filePath,
          sampleId,
        }) as { success: boolean; path?: string; error?: string };

        if (copyResult.success && copyResult.path) {
          const newSample: VoiceTrainingSample = {
            id: sampleId,
            name: fileName,
            path: copyResult.path,
            duration: 0, // Unknown for uploaded files, could be computed if needed
            createdAt: new Date().toISOString(),
          };
          const newSamples = [...(editedProfile.trainingSamples || []), newSample];
          setEditedProfile(prev => ({
            ...prev,
            trainingSamples: newSamples,
          }));
          setSamplesChanged(true);
        } else {
          setError(copyResult.error || 'Failed to add audio file');
        }
      }
    } catch (err) {
      setError('Failed to add audio file');
      console.error('Add audio file error:', err);
    }
  }, [editedProfile.id, editedProfile.trainingSamples]);

  // Remove audio sample
  const removeSample = useCallback(async (sampleId: string) => {
    try {
      // Use existing voice:deleteSample handler
      const result = await window.electronAPI.invoke('voice:deleteSample', {
        profileId: editedProfile.id,
        sampleId,
      }) as { success: boolean; error?: string };

      if (result.success) {
        const newSamples = (editedProfile.trainingSamples || []).filter(s => s.id !== sampleId);
        setEditedProfile(prev => ({
          ...prev,
          trainingSamples: newSamples,
        }));
        setSamplesChanged(true);
      } else {
        setError(result.error || 'Failed to remove sample');
      }
    } catch (err) {
      setError('Failed to remove sample');
      console.error('Remove sample error:', err);
    }
  }, [editedProfile.id, editedProfile.trainingSamples]);

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Validate audio samples before training
  const validateAudioSamples = useCallback(async () => {
    const samples = editedProfile.trainingSamples || [];
    if (samples.length === 0) {
      setValidationResult(null);
      return;
    }

    const audioPaths = samples.map(s => s.path).filter((p): p is string => !!p);
    if (audioPaths.length === 0) {
      setValidationResult(null);
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('openvoice:validateAudio', audioPaths) as {
        success: boolean;
        valid?: boolean;
        summary?: {
          total_duration: number;
          total_speech_duration: number;
          speech_percentage: number;
        };
        recommendations?: string[];
        error?: string;
      };

      if (result.success) {
        setValidationResult({
          valid: result.valid || false,
          summary: result.summary,
          recommendations: result.recommendations,
        });
      } else {
        setError(result.error || 'Validation failed');
        setValidationResult(null);
      }
    } catch (err) {
      setError('Failed to validate audio');
      setValidationResult(null);
    } finally {
      setIsValidating(false);
    }
  }, [editedProfile.trainingSamples]);

  // Auto-validate when samples change
  useEffect(() => {
    if (editedProfile.trainingSamples && editedProfile.trainingSamples.length > 0) {
      validateAudioSamples();
    } else {
      setValidationResult(null);
    }
  }, [editedProfile.trainingSamples, validateAudioSamples]);

  // Save profile changes
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(editedProfile, samplesChanged);
      onClose();
    } catch (err) {
      setError('Failed to save profile');
      console.error('Save profile error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Play audio sample preview
  const playSample = (samplePath: string) => {
    const audio = new Audio(`file://${samplePath}`);
    audio.play().catch(err => console.error('Audio playback error:', err));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="voice-profile-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Voice Profile</h3>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        {/* Tab Navigation */}
        <div className="editor-tabs">
          <button
            className={`editor-tab ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            Details
          </button>
          {profile.type === 'custom' && (
            <>
              <button
                className={`editor-tab ${activeTab === 'samples' ? 'active' : ''}`}
                onClick={() => setActiveTab('samples')}
              >
                Audio Samples ({editedProfile.trainingSamples?.length || 0})
              </button>
              <button
                className={`editor-tab ${activeTab === 'record' ? 'active' : ''}`}
                onClick={() => setActiveTab('record')}
              >
                Record New
              </button>
            </>
          )}
        </div>

        <div className="modal-content">
          {error && (
            <div className="editor-error">
              {error}
              <button onClick={() => setError(null)}>x</button>
            </div>
          )}

          {/* Details Tab */}
          {activeTab === 'details' && (
            <div className="editor-section">
              <div className="form-group">
                <label htmlFor="profile-name-edit">Profile Name</label>
                <input
                  id="profile-name-edit"
                  type="text"
                  value={editedProfile.name}
                  onChange={(e) => setEditedProfile(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter profile name..."
                />
              </div>

              {profile.type === 'system' && (
                <div className="form-group">
                  <label htmlFor="system-voice-edit">System Voice</label>
                  <select
                    id="system-voice-edit"
                    value={editedProfile.systemVoice || ''}
                    onChange={(e) => setEditedProfile(prev => ({ ...prev, systemVoice: e.target.value }))}
                  >
                    <option value="">Select a voice...</option>
                    {systemVoices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {profile.type === 'custom' && (
                <>
                  <div className="form-group">
                    <label>Training Status</label>
                    <div className={`training-status-display ${editedProfile.trainingStatus}`}>
                      {editedProfile.trainingStatus === 'ready' && 'Ready to use'}
                      {editedProfile.trainingStatus === 'training' && `Training... ${editedProfile.trainingProgress || 0}%`}
                      {editedProfile.trainingStatus === 'pending' && 'Waiting for training'}
                      {editedProfile.trainingStatus === 'failed' && 'Training failed'}
                    </div>
                    {editedProfile.trainingError && (
                      <div className="training-error-message">
                        {editedProfile.trainingError}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Audio Samples</label>
                    <div className="samples-summary">
                      {editedProfile.trainingSamples?.length || 0} sample(s) -
                      Total duration: {formatDuration(
                        (editedProfile.trainingSamples || []).reduce((sum, s) => sum + s.duration, 0)
                      )}
                    </div>
                  </div>

                  {samplesChanged && (
                    <div className="retrain-notice">
                      Audio samples have changed. The profile will be retrained automatically when you save.
                    </div>
                  )}
                </>
              )}

              <div className="form-group">
                <label>Created</label>
                <div className="created-date">
                  {editedProfile.created
                    ? new Date(editedProfile.created).toLocaleDateString()
                    : 'Unknown'}
                </div>
              </div>
            </div>
          )}

          {/* Audio Samples Tab */}
          {activeTab === 'samples' && profile.type === 'custom' && (
            <div className="editor-section">
              <div className="samples-header">
                <span className="samples-count">
                  {editedProfile.trainingSamples?.length || 0} audio sample(s)
                </span>
                <button className="add-sample-btn" onClick={addAudioFile}>
                  + Add Audio File
                </button>
              </div>

              {(editedProfile.trainingSamples?.length || 0) === 0 ? (
                <div className="no-samples-message">
                  <p>No audio samples yet.</p>
                  <p>Add audio files or record new samples to train this voice.</p>
                </div>
              ) : (
                <div className="samples-list">
                  {editedProfile.trainingSamples?.map((sample) => (
                    <div key={sample.id} className="sample-item">
                      <div className="sample-info">
                        <span className="sample-name">{sample.name}</span>
                        <span className="sample-duration">{formatDuration(sample.duration)}</span>
                        <span className="sample-date">
                          {new Date(sample.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="sample-actions">
                        {sample.path && (
                          <button
                            className="play-sample-btn"
                            onClick={() => playSample(sample.path!)}
                            title="Play sample"
                          >
                            Play
                          </button>
                        )}
                        <button
                          className="remove-sample-btn"
                          onClick={() => removeSample(sample.id)}
                          title="Remove sample"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Validation Results */}
              {isValidating && (
                <div className="validation-status validating">
                  Analyzing audio quality...
                </div>
              )}

              {validationResult && !isValidating && (
                <div className={`validation-status ${validationResult.valid ? 'valid' : 'invalid'}`}>
                  <div className="validation-header">
                    {validationResult.valid ? '[OK] Audio Ready for Training' : '[WARNING] Audio Issues Detected'}
                  </div>
                  {validationResult.summary && (
                    <div className="validation-summary">
                      <span>Duration: {formatDuration(validationResult.summary.total_duration)}</span>
                      <span>Speech: {formatDuration(validationResult.summary.total_speech_duration)} ({validationResult.summary.speech_percentage}%)</span>
                    </div>
                  )}
                  {validationResult.recommendations && validationResult.recommendations.length > 0 && (
                    <div className="validation-recommendations">
                      {validationResult.recommendations.map((rec, i) => (
                        <div key={i} className="recommendation">{rec}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="samples-hint">
                <p>For best results:</p>
                <ul>
                  <li>Use 30-60 seconds of clear speech</li>
                  <li>Record in a quiet environment</li>
                  <li>Multiple samples improve voice quality</li>
                </ul>
              </div>
            </div>
          )}

          {/* Record Tab */}
          {activeTab === 'record' && profile.type === 'custom' && (
            <div className="editor-section">
              <div className="recording-area">
                <div className="recording-timer">
                  {formatDuration(recordingTime)}
                </div>

                <div className={`recording-indicator ${isRecording ? 'active' : ''}`}>
                  {isRecording ? 'Recording...' : recordedBlob ? 'Recording Complete' : 'Ready to Record'}
                </div>

                <div className="recording-controls">
                  {!isRecording && !recordedBlob && (
                    <button className="record-btn start" onClick={startRecording}>
                      Start Recording
                    </button>
                  )}
                  {isRecording && (
                    <button className="record-btn stop" onClick={stopRecording}>
                      Stop Recording
                    </button>
                  )}
                  {recordedBlob && (
                    <>
                      <button
                        className="record-btn preview"
                        onClick={() => {
                          if (audioPreviewUrl) {
                            const audio = new Audio(audioPreviewUrl);
                            audio.play();
                          }
                        }}
                      >
                        Preview
                      </button>
                      <button className="record-btn discard" onClick={() => {
                        setRecordedBlob(null);
                        setAudioPreviewUrl(null);
                        setRecordingTime(0);
                      }}>
                        Discard
                      </button>
                      <button className="record-btn save" onClick={addRecordedSample}>
                        Add to Profile
                      </button>
                    </>
                  )}
                </div>

                <div className="recording-hint">
                  {isRecording
                    ? 'Speak clearly. Click "Stop Recording" when done.'
                    : 'Click "Start Recording" and speak clearly into your microphone.'}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {profile.type === 'custom' && editedProfile.trainingStatus !== 'training' && (
            <button
              className="retrain-btn"
              onClick={() => onRetrain(profile.openvoiceProfileId || profile.id)}
              disabled={isLoading || !editedProfile.trainingSamples?.length}
            >
              {isLoading ? 'Training...' : 'Retrain Voice'}
            </button>
          )}
          <div className="footer-spacer" />
          <button className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="save-btn"
            onClick={handleSave}
            disabled={saving || isLoading || !editedProfile.name.trim()}
          >
            {saving ? 'Saving...' : samplesChanged ? 'Save & Retrain' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceProfileEditor;
