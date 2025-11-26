/**
 * Voice Service for Text-to-Speech and Speech-to-Text
 * Integrates with OpenVoice for high-quality voice synthesis
 * and provides synchronized word highlighting
 */

import {
  VoiceProfile,
  VoiceSettings,
  WordTimestamp,
  SpeechSynthesisResult,
  SpeechRecognitionResult,
  VoiceServiceState,
  VoiceEvent,
  VoiceEventHandler,
  DEFAULT_VOICES,
  DEFAULT_VOICE_SETTINGS,
  STTConfig,
} from '../../shared/voice-types';

export class VoiceService {
  private state: VoiceServiceState;
  private eventHandlers: Set<VoiceEventHandler> = new Set();
  private audioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private customVoices: VoiceProfile[] = [];
  private voiceModelsPath: string;
  private openVoiceEndpoint: string | null = null;

  constructor(voiceModelsPath: string) {
    this.voiceModelsPath = voiceModelsPath;
    this.state = {
      isInitialized: false,
      isSpeaking: false,
      isListening: false,
      currentWordIndex: -1,
      currentVoice: null,
      availableVoices: [...DEFAULT_VOICES],
      error: null,
    };
  }

  /**
   * Initialize the voice service
   */
  async initialize(openVoiceEndpoint?: string): Promise<void> {
    try {
      // Initialize Web Audio API context
      this.audioContext = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      if (openVoiceEndpoint) {
        this.openVoiceEndpoint = openVoiceEndpoint;
      }

      // Load custom voices from storage
      await this.loadCustomVoices();

      // Set default voice
      const defaultVoice = this.state.availableVoices[0];
      if (defaultVoice) {
        this.state.currentVoice = defaultVoice;
      }

      this.state.isInitialized = true;
      this.state.error = null;
    } catch (error) {
      this.state.error = `Failed to initialize voice service: ${error}`;
      throw error;
    }
  }

  /**
   * Load custom trained voices from storage
   */
  private async loadCustomVoices(): Promise<void> {
    try {
      // In Electron, load from local storage or files
      const storedVoices = localStorage.getItem('customVoices');
      if (storedVoices) {
        this.customVoices = JSON.parse(storedVoices);
        this.state.availableVoices = [...DEFAULT_VOICES, ...this.customVoices];
      }
    } catch (error) {
      console.error('Failed to load custom voices:', error);
    }
  }

  /**
   * Save a custom trained voice
   */
  async saveCustomVoice(voice: VoiceProfile): Promise<void> {
    if (voice.type !== 'custom') {
      throw new Error('Can only save custom voice profiles');
    }

    voice.createdAt = new Date();
    this.customVoices.push(voice);
    this.state.availableVoices = [...DEFAULT_VOICES, ...this.customVoices];

    // Persist to storage
    localStorage.setItem('customVoices', JSON.stringify(this.customVoices));
  }

  /**
   * Delete a custom voice
   */
  async deleteCustomVoice(voiceId: string): Promise<void> {
    this.customVoices = this.customVoices.filter((v) => v.id !== voiceId);
    this.state.availableVoices = [...DEFAULT_VOICES, ...this.customVoices];
    localStorage.setItem('customVoices', JSON.stringify(this.customVoices));
  }

  /**
   * Set the active voice
   */
  setVoice(voiceId: string): void {
    const voice = this.state.availableVoices.find((v) => v.id === voiceId);
    if (voice) {
      this.state.currentVoice = voice;
    } else {
      throw new Error(`Voice not found: ${voiceId}`);
    }
  }

  /**
   * Parse text into words with estimated timestamps
   */
  private parseTextToWords(text: string, wordsPerMinute: number = 150): WordTimestamp[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const msPerWord = 60000 / wordsPerMinute;

    return words.map((word, index) => ({
      word,
      startTime: index * msPerWord,
      endTime: (index + 1) * msPerWord,
      index,
    }));
  }

  /**
   * Synthesize speech from text using OpenVoice or Web Speech API
   */
  async synthesizeSpeech(
    text: string,
    settings: VoiceSettings = DEFAULT_VOICE_SETTINGS
  ): Promise<SpeechSynthesisResult> {
    if (!this.state.isInitialized) {
      throw new Error('Voice service not initialized');
    }

    // Adjust words per minute based on rate
    const baseWPM = 150;
    const adjustedWPM = baseWPM * settings.rate;

    // Parse text to get word timestamps
    const wordTimestamps = this.parseTextToWords(text, adjustedWPM);
    const duration = wordTimestamps.length > 0
      ? wordTimestamps[wordTimestamps.length - 1].endTime
      : 0;

    // If OpenVoice endpoint is available, use it
    if (this.openVoiceEndpoint) {
      try {
        const response = await fetch(`${this.openVoiceEndpoint}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice_id: settings.selectedVoiceId,
            rate: settings.rate,
            pitch: settings.pitch,
            volume: settings.volume / 100,
          }),
        });

        if (response.ok) {
          const audioBuffer = await response.arrayBuffer();

          // Try to get word timestamps from response headers or separate endpoint
          const timestampHeader = response.headers.get('X-Word-Timestamps');
          if (timestampHeader) {
            const serverTimestamps = JSON.parse(timestampHeader);
            return {
              audioBuffer,
              wordTimestamps: serverTimestamps,
              duration: serverTimestamps[serverTimestamps.length - 1]?.endTime || duration,
            };
          }

          return { audioBuffer, wordTimestamps, duration };
        }
      } catch (error) {
        console.warn('OpenVoice synthesis failed, falling back to Web Speech API:', error);
      }
    }

    // Fallback to Web Speech API synthesis with recording
    return this.synthesizeWithWebSpeech(text, settings, wordTimestamps, duration);
  }

  /**
   * Synthesize using Web Speech API
   */
  private async synthesizeWithWebSpeech(
    text: string,
    settings: VoiceSettings,
    wordTimestamps: WordTimestamp[],
    duration: number
  ): Promise<SpeechSynthesisResult> {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Web Speech API not supported'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = settings.rate;
      utterance.pitch = 1 + settings.pitch / 100;
      utterance.volume = settings.volume / 100;

      // Try to find a matching voice
      const voices = window.speechSynthesis.getVoices();
      const selectedVoice = this.state.currentVoice;
      if (selectedVoice && voices.length > 0) {
        const matchingVoice = voices.find((v) =>
          (selectedVoice.gender === 'female' && v.name.toLowerCase().includes('female')) ||
          (selectedVoice.gender === 'male' && v.name.toLowerCase().includes('male')) ||
          v.lang.startsWith(selectedVoice.accent === 'British' ? 'en-GB' : 'en-US')
        );
        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }
      }

      // For Web Speech API, we return an empty audio buffer
      // The actual audio is played through the speech synthesis
      utterance.onend = () => {
        resolve({
          audioBuffer: new ArrayBuffer(0),
          wordTimestamps,
          duration,
        });
      };

      utterance.onerror = (event) => {
        reject(new Error(`Speech synthesis error: ${event.error}`));
      };

      // Note: We don't actually speak here, just prepare the result
      // The speak() method will handle actual playback
      resolve({
        audioBuffer: new ArrayBuffer(0),
        wordTimestamps,
        duration,
      });
    });
  }

  /**
   * Speak text with synchronized word highlighting
   */
  async speak(
    text: string,
    settings: VoiceSettings = DEFAULT_VOICE_SETTINGS,
    onWordChange?: (wordIndex: number, word: string) => void
  ): Promise<void> {
    if (!this.state.isInitialized) {
      throw new Error('Voice service not initialized');
    }

    if (this.state.isSpeaking) {
      this.stop();
    }

    this.state.isSpeaking = true;
    this.state.currentWordIndex = -1;
    this.emit({ type: 'speaking-start', text });

    try {
      const result = await this.synthesizeSpeech(text, settings);

      // If we have audio buffer from OpenVoice, play it
      if (result.audioBuffer.byteLength > 0 && this.audioContext) {
        const audioBuffer = await this.audioContext.decodeAudioData(result.audioBuffer.slice(0));
        this.currentAudioSource = this.audioContext.createBufferSource();
        this.currentAudioSource.buffer = audioBuffer;
        this.currentAudioSource.connect(this.audioContext.destination);
        this.currentAudioSource.start();
      } else {
        // Use Web Speech API for playback
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = settings.rate;
        utterance.pitch = 1 + settings.pitch / 100;
        utterance.volume = settings.volume / 100;
        window.speechSynthesis.speak(utterance);
      }

      // Simulate word highlighting based on timestamps
      for (let i = 0; i < result.wordTimestamps.length; i++) {
        if (!this.state.isSpeaking) break;

        const timestamp = result.wordTimestamps[i];
        this.state.currentWordIndex = i;
        this.emit({ type: 'word-change', wordIndex: i, word: timestamp.word });

        if (onWordChange) {
          onWordChange(i, timestamp.word);
        }

        // Wait for word duration
        const wordDuration = timestamp.endTime - timestamp.startTime;
        await new Promise((resolve) => setTimeout(resolve, wordDuration));
      }

      this.state.isSpeaking = false;
      this.state.currentWordIndex = -1;
      this.emit({ type: 'speaking-end' });
    } catch (error) {
      this.state.isSpeaking = false;
      this.state.error = `Speech failed: ${error}`;
      this.emit({ type: 'error', error: this.state.error });
      throw error;
    }
  }

  /**
   * Stop speaking
   */
  stop(): void {
    if (this.currentAudioSource) {
      this.currentAudioSource.stop();
      this.currentAudioSource = null;
    }
    window.speechSynthesis?.cancel();
    this.state.isSpeaking = false;
    this.state.currentWordIndex = -1;
    this.emit({ type: 'speaking-end' });
  }

  /**
   * Pause speaking
   */
  pause(): void {
    window.speechSynthesis?.pause();
    // Note: AudioBufferSourceNode doesn't support pause, would need more complex handling
  }

  /**
   * Resume speaking
   */
  resume(): void {
    window.speechSynthesis?.resume();
  }

  /**
   * Start speech recognition
   */
  async startListening(config: STTConfig = {
    language: 'en-US',
    continuous: true,
    interimResults: true,
    maxAlternatives: 3,
  }): Promise<void> {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      throw new Error('Speech recognition not supported');
    }

    const SpeechRecognitionAPI = (window as unknown as {
      SpeechRecognition?: typeof SpeechRecognition;
      webkitSpeechRecognition?: typeof SpeechRecognition;
    }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition }).webkitSpeechRecognition;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = config.language;
    recognition.continuous = config.continuous;
    recognition.interimResults = config.interimResults;
    recognition.maxAlternatives = config.maxAlternatives;

    recognition.onstart = () => {
      this.state.isListening = true;
      this.emit({ type: 'listening-start' });
    };

    recognition.onend = () => {
      this.state.isListening = false;
      this.emit({ type: 'listening-end' });
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1];
      const recognitionResult: SpeechRecognitionResult = {
        text: result[0].transcript,
        confidence: result[0].confidence,
        isFinal: result.isFinal,
        alternatives: Array.from(result).slice(1).map((alt) => ({
          text: alt.transcript,
          confidence: alt.confidence,
        })),
      };
      this.emit({ type: 'recognition-result', result: recognitionResult });
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.state.error = `Recognition error: ${event.error}`;
      this.emit({ type: 'error', error: this.state.error });
    };

    recognition.start();
  }

  /**
   * Stop speech recognition
   */
  stopListening(): void {
    this.state.isListening = false;
    this.emit({ type: 'listening-end' });
  }

  /**
   * Train a custom voice using OpenVoice
   */
  async trainCustomVoice(
    name: string,
    audioSamples: ArrayBuffer[]
  ): Promise<VoiceProfile> {
    if (!this.openVoiceEndpoint) {
      throw new Error('OpenVoice endpoint not configured');
    }

    const formData = new FormData();
    formData.append('name', name);
    audioSamples.forEach((sample, index) => {
      formData.append(`audio_${index}`, new Blob([sample], { type: 'audio/wav' }));
    });

    const response = await fetch(`${this.openVoiceEndpoint}/train`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Voice training failed');
    }

    const result = await response.json();

    const newVoice: VoiceProfile = {
      id: `custom-${Date.now()}`,
      name,
      type: 'custom',
      modelPath: result.model_path,
      createdAt: new Date(),
    };

    await this.saveCustomVoice(newVoice);
    return newVoice;
  }

  /**
   * Subscribe to voice events
   */
  on(handler: VoiceEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: VoiceEvent): void {
    this.eventHandlers.forEach((handler) => handler(event));
  }

  /**
   * Get current state
   */
  getState(): VoiceServiceState {
    return { ...this.state };
  }

  /**
   * Get available voices
   */
  getVoices(): VoiceProfile[] {
    return [...this.state.availableVoices];
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.eventHandlers.clear();
  }
}
