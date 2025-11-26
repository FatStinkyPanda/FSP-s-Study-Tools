// Voice Service Types

export interface VoiceProfile {
  id: string;
  name: string;
  type: 'default' | 'custom';
  gender?: 'male' | 'female' | 'neutral';
  accent?: string;
  modelPath?: string; // For custom trained voices
  createdAt?: Date;
}

export interface VoiceSettings {
  selectedVoiceId: string;
  rate: number; // 0.5 - 2.0, default 1.0
  pitch: number; // -50 to +50, default 0
  volume: number; // 0 - 100, default 80
  emotionalTone: 'neutral' | 'encouraging' | 'serious';
}

export interface HighlightSettings {
  enabled: boolean;
  style: 'word' | 'karaoke' | 'underline' | 'wave';
  hotspotColor: string;
  pastFadeColor: string;
  futureGlowColor: string;
  fadeDuration: number; // 0.5 - 3.0 seconds
  anticipationRange: number; // 1-5 words ahead
  autoScroll: boolean;
  scrollSpeed: number; // 1-5
}

export interface WordTimestamp {
  word: string;
  startTime: number; // milliseconds
  endTime: number;
  index: number;
}

export interface SpeechSynthesisResult {
  audioBuffer: ArrayBuffer;
  wordTimestamps: WordTimestamp[];
  duration: number; // total duration in milliseconds
}

export interface SpeechRecognitionResult {
  text: string;
  confidence: number;
  isFinal: boolean;
  alternatives?: Array<{
    text: string;
    confidence: number;
  }>;
}

export interface VoiceServiceState {
  isInitialized: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  currentWordIndex: number;
  currentVoice: VoiceProfile | null;
  availableVoices: VoiceProfile[];
  error: string | null;
}

export interface TTSRequest {
  text: string;
  voiceId: string;
  settings: VoiceSettings;
}

export interface STTConfig {
  language: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
}

// Default voice profiles
export const DEFAULT_VOICES: VoiceProfile[] = [
  {
    id: 'voice-female-1',
    name: 'Natural Female (US)',
    type: 'default',
    gender: 'female',
    accent: 'American',
  },
  {
    id: 'voice-female-2',
    name: 'Natural Female (UK)',
    type: 'default',
    gender: 'female',
    accent: 'British',
  },
  {
    id: 'voice-male-1',
    name: 'Natural Male (US)',
    type: 'default',
    gender: 'male',
    accent: 'American',
  },
  {
    id: 'voice-male-2',
    name: 'Natural Male (UK)',
    type: 'default',
    gender: 'male',
    accent: 'British',
  },
  {
    id: 'voice-neutral-1',
    name: 'Neutral (US)',
    type: 'default',
    gender: 'neutral',
    accent: 'American',
  },
];

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  selectedVoiceId: 'voice-female-1',
  rate: 1.0,
  pitch: 0,
  volume: 80,
  emotionalTone: 'neutral',
};

export const DEFAULT_HIGHLIGHT_SETTINGS: HighlightSettings = {
  enabled: true,
  style: 'word',
  hotspotColor: '#fbbf24', // amber-400
  pastFadeColor: '#4ade80', // green-400
  futureGlowColor: '#60a5fa', // blue-400
  fadeDuration: 1.5,
  anticipationRange: 2,
  autoScroll: true,
  scrollSpeed: 3,
};

// Events for voice service
export type VoiceEvent =
  | { type: 'speaking-start'; text: string }
  | { type: 'speaking-end' }
  | { type: 'word-change'; wordIndex: number; word: string }
  | { type: 'listening-start' }
  | { type: 'listening-end' }
  | { type: 'recognition-result'; result: SpeechRecognitionResult }
  | { type: 'error'; error: string };

export type VoiceEventHandler = (event: VoiceEvent) => void;
