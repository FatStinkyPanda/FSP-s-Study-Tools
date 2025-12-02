/**
 * VoiceTrainingStudio Component
 *
 * A comprehensive voice training interface with:
 * - Extensive training scripts with word-by-word highlighting
 * - Live speech recognition to track reading progress (using Vosk offline recognition)
 * - Real-time microphone volume visualization
 * - Microphone status detection
 * - Sample management (add/delete)
 * - Persistent training status
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createLogger } from '../../shared/logger';
import {
  scriptCategories,
  getAllScripts,
  getScriptById,
  TrainingScript,
  ScriptCategory
} from '../../shared/voice-training-scripts';
import type { OpenVoiceProfile } from '../hooks/useOpenVoice';

const log = createLogger('VoiceTrainingStudio');

// Types for Vosk speech recognition results
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

interface VoskStatus {
  available: boolean;
  modelInitialized: boolean;
  isRecognizing: boolean;
  modelExists: boolean;
  modelPath: string | null;
  error: string | null;
}

interface VoiceTrainingStudioProps {
  profile: OpenVoiceProfile;
  onClose: () => void;
  onSaveRecording: (audioPath: string) => Promise<void>;
  onDeleteSample: (samplePath: string) => Promise<void>;
  onStartTraining: () => Promise<void>;
  isTraining: boolean;
}

interface MicrophoneStatus {
  available: boolean;
  active: boolean;
  volume: number;
  deviceName: string | null;
  error: string | null;
}

interface WordHighlight {
  wordIndex: number;
  spokenWords: Set<number>;
  currentWord: string;
}

type Tab = 'scripts' | 'record' | 'samples';

function VoiceTrainingStudio({
  profile,
  onClose,
  onSaveRecording,
  onDeleteSample,
  onStartTraining,
  isTraining
}: VoiceTrainingStudioProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('scripts');

  // Script selection state
  const [selectedCategory, setSelectedCategory] = useState<string>('medium');
  const [selectedScript, setSelectedScript] = useState<TrainingScript | null>(null);
  const [highlightEnabled, setHighlightEnabled] = useState(true);

  // Speech recognition state (Vosk offline)
  const [isListening, setIsListening] = useState(false);
  const [wordHighlight, setWordHighlight] = useState<WordHighlight>({
    wordIndex: 0,
    spokenWords: new Set(),
    currentWord: ''
  });
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [voskStatus, setVoskStatus] = useState<VoskStatus | null>(null);
  const [isInitializingVosk, setIsInitializingVosk] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  // Microphone state
  const [micStatus, setMicStatus] = useState<MicrophoneStatus>({
    available: false,
    active: false,
    volume: 0,
    deviceName: null,
    error: null
  });

  // Refs
  const isListeningRef = useRef(false); // Use ref to track listening state for callbacks
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const volumeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voskCleanupRef = useRef<(() => void) | null>(null);

  // Get words from selected script
  const scriptWords = useMemo(() => {
    if (!selectedScript) return [];
    return selectedScript.text
      .split(/\s+/)
      .map(word => word.replace(/[^\w'-]/g, '').toLowerCase())
      .filter(word => word.length > 0);
  }, [selectedScript]);

  // Check for Vosk speech recognition support and initialize
  useEffect(() => {
    const checkVoskStatus = async () => {
      try {
        const status = await window.electronAPI.invoke('vosk:getStatus') as VoskStatus;
        log.info('Vosk status:', status);
        setVoskStatus(status);

        if (status.available && status.modelInitialized) {
          setRecognitionSupported(true);
          setRecognitionError(null);
        } else if (status.available && !status.modelInitialized) {
          // Model needs to be initialized - this will auto-download if needed
          log.info('Vosk model not initialized, will initialize on first use');
          setRecognitionSupported(true);
        } else {
          setRecognitionSupported(false);
          setRecognitionError(status.error || 'Vosk speech recognition service not available');
        }
      } catch (err) {
        log.error('Failed to check Vosk status:', err);
        setRecognitionSupported(false);
        setRecognitionError('Failed to connect to speech recognition service');
      }
    };

    checkVoskStatus();

    // Set up listener for Vosk results
    const cleanup = window.electronAPI.onVoskResults((results: VoskResult[]) => {
      if (!isListeningRef.current) return;

      log.debug('Vosk results received:', results);

      for (const result of results) {
        processVoskResult(result);
      }
    });

    voskCleanupRef.current = cleanup;

    return () => {
      if (voskCleanupRef.current) {
        voskCleanupRef.current();
      }
    };
  }, []);

  // Process Vosk recognition result
  const processVoskResult = useCallback((result: VoskResult) => {
    if (!result.text || result.text.trim().length === 0) return;

    const transcript = result.text.toLowerCase().trim();
    log.debug(`Vosk ${result.type}: "${transcript}"`);

    // Process the transcript to find matching words
    const spokenWords = transcript.split(/\s+/).filter(w => w.length > 0);
    const lastSpokenWord = spokenWords[spokenWords.length - 1] || '';

    setWordHighlight(prev => {
      const newSpokenWords = new Set(prev.spokenWords);

      // Find words that match what was spoken
      for (const spokenWord of spokenWords) {
        const cleanSpoken = spokenWord.replace(/[^\w'-]/g, '');
        if (cleanSpoken.length < 2) continue;

        // Look for this word starting from current position
        for (let i = prev.wordIndex; i < scriptWords.length && i < prev.wordIndex + 15; i++) {
          const scriptWord = scriptWords[i];
          // Check for match (partial matching for better accuracy)
          if (scriptWord === cleanSpoken ||
              scriptWord.includes(cleanSpoken) ||
              cleanSpoken.includes(scriptWord) ||
              (scriptWord.length > 3 && cleanSpoken.length > 3 &&
               (scriptWord.startsWith(cleanSpoken.slice(0, 3)) || cleanSpoken.startsWith(scriptWord.slice(0, 3))))) {
            newSpokenWords.add(i);
            break;
          }
        }
      }

      // Find the furthest spoken word to set as current
      let maxIndex = prev.wordIndex;
      newSpokenWords.forEach(idx => {
        if (idx > maxIndex) maxIndex = idx;
      });

      return {
        wordIndex: maxIndex,
        spokenWords: newSpokenWords,
        currentWord: lastSpokenWord
      };
    });
  }, [scriptWords]);

  // Initialize microphone and audio analysis
  useEffect(() => {
    initializeMicrophone();

    return () => {
      cleanupAudio();
    };
  }, []);

  const initializeMicrophone = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      if (audioInputs.length === 0) {
        setMicStatus(prev => ({
          ...prev,
          available: false,
          error: 'No microphone detected'
        }));
        return;
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = stream;

      // Set up audio analysis for volume meter
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Get device name
      const track = stream.getAudioTracks()[0];
      const deviceName = track.label || 'Unknown Microphone';

      setMicStatus({
        available: true,
        active: true,
        volume: 0,
        deviceName,
        error: null
      });

      // Start volume monitoring
      startVolumeMonitoring();

      log.info('Microphone initialized:', deviceName);
    } catch (err) {
      const error = err as Error;
      log.error('Failed to initialize microphone:', error);
      setMicStatus({
        available: false,
        active: false,
        volume: 0,
        deviceName: null,
        error: error.name === 'NotAllowedError'
          ? 'Microphone access denied. Please allow access in your browser settings.'
          : `Failed to access microphone: ${error.message}`
      });
    }
  };

  const startVolumeMonitoring = () => {
    if (!analyserRef.current || !volumeCanvasRef.current) return;

    const analyser = analyserRef.current;
    const canvas = volumeCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      // Calculate average volume
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const normalizedVolume = Math.min(average / 128, 1);

      setMicStatus(prev => ({
        ...prev,
        volume: normalizedVolume
      }));

      // Draw volume bar
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);

      // Volume bar
      const barWidth = width * normalizedVolume;

      // Gradient based on volume
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#4ade80');
      gradient.addColorStop(0.5, '#facc15');
      gradient.addColorStop(0.8, '#f87171');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, barWidth, height);

      // Border
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, width, height);
    };

    draw();
  };

  const cleanupAudio = async () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    // Stop Vosk recognition if running
    if (isListeningRef.current) {
      try {
        await window.electronAPI.invoke('vosk:stopRecognition');
      } catch {
        // Ignore errors when stopping
      }
    }
  };

  // Start speech recognition using Vosk offline service
  const startListening = useCallback(async () => {
    if (!recognitionSupported || !micStatus.active) {
      log.warn('Cannot start listening: recognition not supported or mic not active');
      return;
    }

    try {
      setRecognitionError(null);

      // Check if Vosk needs initialization first
      if (voskStatus && !voskStatus.modelInitialized) {
        log.info('Initializing Vosk model...');
        setIsInitializingVosk(true);
        setRecognitionError('Initializing speech recognition model (first-time setup)...');

        const initResult = await window.electronAPI.invoke('vosk:initialize') as boolean;
        setIsInitializingVosk(false);

        if (!initResult) {
          setRecognitionError('Failed to initialize speech recognition model');
          return;
        }

        // Update status
        const newStatus = await window.electronAPI.invoke('vosk:getStatus') as VoskStatus;
        setVoskStatus(newStatus);
        setRecognitionError(null);
      }

      // Start Vosk recognition
      const sampleRate = audioContextRef.current?.sampleRate || 16000;
      const started = await window.electronAPI.invoke('vosk:startRecognition', sampleRate) as boolean;

      if (!started) {
        setRecognitionError('Failed to start speech recognition');
        return;
      }

      // Set up audio streaming to Vosk
      if (audioContextRef.current && streamRef.current) {
        // Create a ScriptProcessorNode to capture audio data
        const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
        const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = async (e) => {
          if (!isListeningRef.current) return;

          // Get audio data
          const inputData = e.inputBuffer.getChannelData(0);

          // Convert Float32 to Int16 PCM (what Vosk expects)
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          // Send to Vosk service
          try {
            await window.electronAPI.invoke('vosk:sendAudio', pcmData.buffer);
          } catch {
            // Silent fail for audio sending - don't spam logs
          }
        };

        source.connect(processor);
        processor.connect(audioContextRef.current.destination);
        audioProcessorRef.current = processor;
      }

      setIsListening(true);
      isListeningRef.current = true;
      log.info('Vosk speech recognition started');

    } catch (err) {
      log.error('Failed to start Vosk speech recognition:', err);
      setRecognitionError('Failed to start speech recognition');
      setIsListening(false);
      isListeningRef.current = false;
    }
  }, [recognitionSupported, micStatus.active, voskStatus]);

  const stopListening = useCallback(async () => {
    log.debug('Stopping Vosk speech recognition');
    isListeningRef.current = false;
    setIsListening(false);

    // Disconnect audio processor
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }

    // Stop Vosk recognition
    try {
      await window.electronAPI.invoke('vosk:stopRecognition');
    } catch {
      // Ignore errors when stopping
    }
  }, []);

  // Recording functions
  const startRecording = useCallback(async () => {
    if (!streamRef.current) {
      log.error('No audio stream available');
      return;
    }

    try {
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      log.info('Recording started');
    } catch (err) {
      log.error('Failed to start recording:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      log.info('Recording stopped');
    }
  }, [isRecording]);

  const saveRecording = useCallback(async () => {
    if (!recordedBlob) return;

    try {
      // Convert blob to base64 and save via electron
      const arrayBuffer = await recordedBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ''
        )
      );

      // Save to file system
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `voice_sample_${timestamp}.webm`;
      const result = await window.electronAPI.invoke('voice:saveRecording', {
        filename,
        data: base64,
        profileId: profile.id
      }) as { success: boolean; path?: string; error?: string };

      if (result.success && result.path) {
        await onSaveRecording(result.path);
        setRecordedBlob(null);
        if (recordedUrl) {
          URL.revokeObjectURL(recordedUrl);
          setRecordedUrl(null);
        }
        log.info('Recording saved:', result.path);
      } else {
        log.error('Failed to save recording:', result.error);
      }
    } catch (err) {
      log.error('Error saving recording:', err);
    }
  }, [recordedBlob, recordedUrl, profile.id, onSaveRecording]);

  const discardRecording = useCallback(() => {
    setRecordedBlob(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
  }, [recordedUrl]);

  // Reset word highlighting
  const resetHighlight = useCallback(() => {
    setWordHighlight({
      wordIndex: 0,
      spokenWords: new Set(),
      currentWord: ''
    });
  }, []);

  // Format time for display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Render script text with highlighting
  const renderScriptText = () => {
    if (!selectedScript) return null;

    const words = selectedScript.text.split(/(\s+)/);
    let wordIndex = 0;

    return words.map((segment, index) => {
      if (/^\s+$/.test(segment)) {
        return <span key={index}>{segment}</span>;
      }

      const currentWordIndex = wordIndex;
      wordIndex++;

      const isSpoken = wordHighlight.spokenWords.has(currentWordIndex);
      const isCurrent = highlightEnabled && currentWordIndex === wordHighlight.wordIndex;
      const isNext = highlightEnabled && currentWordIndex === wordHighlight.wordIndex + 1;

      let className = 'script-word';
      if (isSpoken) className += ' spoken';
      if (isCurrent) className += ' current';
      if (isNext) className += ' next';

      return (
        <span key={index} className={className}>
          {segment}
        </span>
      );
    });
  };

  // Get current category scripts
  const currentCategoryScripts = useMemo(() => {
    const category = scriptCategories.find(c => c.id === selectedCategory);
    return category?.scripts || [];
  }, [selectedCategory]);

  // Check if training is needed
  const needsTraining = profile.state === 'pending' || profile.state === 'failed';
  const samplesChanged = profile.audio_samples.length > 0 && needsTraining;

  return (
    <div className="voice-training-studio">
      {/* Header */}
      <div className="studio-header">
        <div className="studio-title">
          <h2>Voice Training Studio</h2>
          <span className="profile-name">{profile.name}</span>
        </div>
        <button className="close-button" onClick={onClose}>Close</button>
      </div>

      {/* Microphone Status Bar */}
      <div className={`mic-status-bar ${micStatus.active ? 'active' : 'inactive'}`}>
        <div className="mic-indicator">
          <div className={`mic-dot ${micStatus.active ? 'active' : ''}`} />
          <span className="mic-label">
            {micStatus.error || (micStatus.active ? micStatus.deviceName : 'Microphone Inactive')}
          </span>
        </div>
        <div className="volume-meter-container">
          <canvas
            ref={volumeCanvasRef}
            className="volume-meter"
            width={200}
            height={20}
          />
          <span className="volume-label">
            {Math.round(micStatus.volume * 100)}%
          </span>
        </div>
        {!micStatus.available && (
          <button className="retry-mic-btn" onClick={initializeMicrophone}>
            Retry Microphone
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="studio-tabs">
        <button
          className={`tab-btn ${activeTab === 'scripts' ? 'active' : ''}`}
          onClick={() => setActiveTab('scripts')}
        >
          Training Scripts
        </button>
        <button
          className={`tab-btn ${activeTab === 'record' ? 'active' : ''}`}
          onClick={() => setActiveTab('record')}
        >
          Record Audio
        </button>
        <button
          className={`tab-btn ${activeTab === 'samples' ? 'active' : ''}`}
          onClick={() => setActiveTab('samples')}
        >
          Samples ({profile.audio_samples.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="studio-content">
        {/* Scripts Tab */}
        {activeTab === 'scripts' && (
          <div className="scripts-tab">
            {/* Script Selection */}
            <div className="script-selection">
              <div className="category-selector">
                <label>Category:</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value);
                    setSelectedScript(null);
                    resetHighlight();
                  }}
                >
                  {scriptCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} - {cat.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="script-list">
                {currentCategoryScripts.map(script => (
                  <button
                    key={script.id}
                    className={`script-item ${selectedScript?.id === script.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedScript(script);
                      resetHighlight();
                    }}
                  >
                    <span className="script-title">{script.title}</span>
                    <span className="script-duration">{script.estimatedDuration}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Script Display */}
            {selectedScript && (
              <div className="script-display">
                <div className="script-header">
                  <h3>{selectedScript.title}</h3>
                  <p className="script-description">{selectedScript.description}</p>
                  <div className="script-meta">
                    <span>Duration: {selectedScript.estimatedDuration}</span>
                    <span>Tags: {selectedScript.tags.join(', ')}</span>
                  </div>
                </div>

                <div className="script-controls">
                  <label className="highlight-toggle">
                    <input
                      type="checkbox"
                      checked={highlightEnabled}
                      onChange={(e) => setHighlightEnabled(e.target.checked)}
                    />
                    Enable Word Highlighting
                  </label>

                  {recognitionSupported && highlightEnabled && (
                    <>
                      {!isListening ? (
                        <button
                          className="listen-btn start"
                          onClick={startListening}
                          disabled={!micStatus.active}
                        >
                          Start Speech Detection
                        </button>
                      ) : (
                        <button
                          className="listen-btn stop"
                          onClick={stopListening}
                        >
                          Stop Speech Detection
                        </button>
                      )}
                      <button
                        className="reset-btn"
                        onClick={resetHighlight}
                      >
                        Reset Progress
                      </button>
                    </>
                  )}

                  {!recognitionSupported && (
                    <span className="recognition-warning">
                      Offline speech recognition not available.
                      {voskStatus?.error && ` Error: ${voskStatus.error}`}
                    </span>
                  )}
                  {isInitializingVosk && (
                    <span className="recognition-warning initializing">
                      Downloading speech recognition model (one-time setup)...
                    </span>
                  )}
                </div>

                {isListening && (
                  <div className="listening-indicator">
                    <span className="pulse-dot" />
                    Listening... "{wordHighlight.currentWord}"
                  </div>
                )}

                {recognitionError && (
                  <div className="recognition-error">
                    {recognitionError}
                  </div>
                )}

                <div className="script-text">
                  {renderScriptText()}
                </div>

                <div className="script-progress">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${(wordHighlight.spokenWords.size / scriptWords.length) * 100}%`
                    }}
                  />
                  <span className="progress-text">
                    {wordHighlight.spokenWords.size} / {scriptWords.length} words
                    ({Math.round((wordHighlight.spokenWords.size / scriptWords.length) * 100)}%)
                  </span>
                </div>
              </div>
            )}

            {!selectedScript && (
              <div className="no-script-selected">
                <p>Select a training script from the list to begin</p>
                <p className="hint">
                  Longer scripts provide better voice cloning quality.
                  We recommend at least 2-3 minutes of recorded speech.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Record Tab */}
        {activeTab === 'record' && (
          <div className="record-tab">
            <div className="recording-area">
              <div className={`record-button-container ${isRecording ? 'recording' : ''}`}>
                {!isRecording ? (
                  <button
                    className="record-btn"
                    onClick={startRecording}
                    disabled={!micStatus.active || !!recordedBlob}
                  >
                    <span className="record-icon" />
                    Start Recording
                  </button>
                ) : (
                  <button
                    className="record-btn stop"
                    onClick={stopRecording}
                  >
                    <span className="stop-icon" />
                    Stop Recording
                  </button>
                )}
              </div>

              {isRecording && (
                <div className="recording-timer">
                  <span className="pulse-dot red" />
                  {formatTime(recordingTime)}
                </div>
              )}

              {recordedUrl && (
                <div className="recorded-preview">
                  <h4>Recording Preview</h4>
                  <audio controls src={recordedUrl} />
                  <div className="preview-actions">
                    <button
                      className="save-btn"
                      onClick={saveRecording}
                    >
                      Save Recording
                    </button>
                    <button
                      className="discard-btn"
                      onClick={discardRecording}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="recording-tips">
              <h4>Recording Tips</h4>
              <ul>
                <li>Find a quiet environment with minimal background noise</li>
                <li>Maintain a consistent distance from your microphone</li>
                <li>Speak naturally at your normal pace and volume</li>
                <li>Record at least 30 seconds to 2 minutes for best results</li>
                <li>Multiple recordings improve voice cloning quality</li>
              </ul>
            </div>
          </div>
        )}

        {/* Samples Tab */}
        {activeTab === 'samples' && (
          <div className="samples-tab">
            <div className="samples-header">
              <h3>Voice Samples</h3>
              {profile.audio_samples.length > 0 && (
                <div className="training-status">
                  <span className={`status-badge ${profile.state}`}>
                    {profile.state === 'ready' ? 'Trained' :
                     profile.state === 'extracting' ? 'Training...' :
                     profile.state === 'failed' ? 'Failed' : 'Needs Training'}
                  </span>
                  {samplesChanged && !isTraining && (
                    <button
                      className="train-btn"
                      onClick={onStartTraining}
                    >
                      Train Voice
                    </button>
                  )}
                </div>
              )}
            </div>

            {profile.audio_samples.length === 0 ? (
              <div className="no-samples">
                <p>No voice samples yet</p>
                <p className="hint">
                  Record some audio or upload existing recordings to create your voice profile.
                </p>
                <button
                  className="add-sample-btn"
                  onClick={() => setActiveTab('record')}
                >
                  Record First Sample
                </button>
              </div>
            ) : (
              <div className="samples-list">
                {profile.audio_samples.map((sample, index) => {
                  const filename = sample.split(/[/\\]/).pop() || `Sample ${index + 1}`;
                  return (
                    <div key={sample} className="sample-item">
                      <div className="sample-info">
                        <span className="sample-number">{index + 1}</span>
                        <span className="sample-name">{filename}</span>
                      </div>
                      <div className="sample-actions">
                        <button
                          className="play-btn"
                          onClick={async () => {
                            // Load and play audio
                            try {
                              const result = await window.electronAPI.invoke(
                                'voice:getAudioPath',
                                sample
                              ) as { success: boolean; path?: string };
                              if (result.success && result.path) {
                                const audio = new Audio(`file://${result.path}`);
                                audio.play();
                              }
                            } catch (err) {
                              log.error('Failed to play sample:', err);
                            }
                          }}
                        >
                          Play
                        </button>
                        <button
                          className="delete-btn"
                          onClick={() => onDeleteSample(sample)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="samples-summary">
              <p>Total Samples: {profile.audio_samples.length}</p>
              {profile.audio_samples.length < 3 && (
                <p className="recommendation">
                  Recommended: Add at least 3 samples for better voice quality
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer with Training Status */}
      {isTraining && (
        <div className="training-overlay">
          <div className="training-progress">
            <div className="spinner" />
            <p>Training voice profile...</p>
            <p className="progress-percent">{profile.progress}%</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default VoiceTrainingStudio;
