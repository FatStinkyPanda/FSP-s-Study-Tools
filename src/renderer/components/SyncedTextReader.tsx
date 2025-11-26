import React, { useState, useEffect, useRef, useCallback } from 'react';
import './SyncedTextReader.css';

export interface HighlightSettings {
  enabled: boolean;
  style: 'word' | 'karaoke' | 'underline' | 'wave';
  hotspotColor: string;
  pastFadeColor: string;
  futureGlowColor: string;
  fadeDuration: number;
  anticipationRange: number;
  autoScroll: boolean;
  scrollSpeed: number;
}

export interface VoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  selectedVoiceId: string;
}

interface SyncedTextReaderProps {
  text: string;
  highlightSettings?: Partial<HighlightSettings>;
  voiceSettings?: Partial<VoiceSettings>;
  onWordChange?: (wordIndex: number, word: string) => void;
  onSpeakingStart?: () => void;
  onSpeakingEnd?: () => void;
  autoPlay?: boolean;
  showControls?: boolean;
  className?: string;
}

const DEFAULT_HIGHLIGHT_SETTINGS: HighlightSettings = {
  enabled: true,
  style: 'word',
  hotspotColor: '#fbbf24',
  pastFadeColor: '#4ade80',
  futureGlowColor: '#60a5fa',
  fadeDuration: 1.5,
  anticipationRange: 2,
  autoScroll: true,
  scrollSpeed: 3,
};

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  rate: 1.0,
  pitch: 0,
  volume: 80,
  selectedVoiceId: 'default',
};

export function SyncedTextReader({
  text,
  highlightSettings: highlightSettingsOverride,
  voiceSettings: voiceSettingsOverride,
  onWordChange,
  onSpeakingStart,
  onSpeakingEnd,
  autoPlay = false,
  showControls = true,
  className = '',
}: SyncedTextReaderProps): React.ReactElement {
  const highlightSettings = { ...DEFAULT_HIGHLIGHT_SETTINGS, ...highlightSettingsOverride };
  const voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...voiceSettingsOverride };

  const [words, setWords] = useState<string[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const wordBoundaryIndexRef = useRef<number>(0);

  // Parse text into words
  useEffect(() => {
    const parsedWords = text.split(/\s+/).filter((w) => w.length > 0);
    setWords(parsedWords);
    wordRefs.current = new Array(parsedWords.length).fill(null);
    setCurrentWordIndex(-1);
  }, [text]);

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (voices.length > 0 && !selectedVoice) {
        // Prefer English voices
        const englishVoice = voices.find((v) => v.lang.startsWith('en-'));
        setSelectedVoice(englishVoice || voices[0]);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [selectedVoice]);

  // Auto-scroll to current word
  useEffect(() => {
    if (
      highlightSettings.autoScroll &&
      currentWordIndex >= 0 &&
      wordRefs.current[currentWordIndex]
    ) {
      const wordElement = wordRefs.current[currentWordIndex];
      wordElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
  }, [currentWordIndex, highlightSettings.autoScroll]);

  // Auto-play on mount
  useEffect(() => {
    if (autoPlay && words.length > 0) {
      speak();
    }
  }, [autoPlay, words.length]);

  const speak = useCallback(() => {
    if (!window.speechSynthesis || words.length === 0) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = voiceSettings.rate;
    utterance.pitch = 1 + voiceSettings.pitch / 100;
    utterance.volume = voiceSettings.volume / 100;

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    wordBoundaryIndexRef.current = 0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
      setCurrentWordIndex(0);
      onSpeakingStart?.();
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentWordIndex(-1);
      wordBoundaryIndexRef.current = 0;
      onSpeakingEnd?.();
    };

    // Use boundary event for word-level tracking
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        // Calculate word index based on character position
        const charIndex = event.charIndex;
        let wordCount = 0;
        let currentPos = 0;

        for (let i = 0; i < words.length; i++) {
          const wordStart = text.indexOf(words[i], currentPos);
          if (charIndex >= wordStart && charIndex < wordStart + words[i].length) {
            wordCount = i;
            break;
          }
          currentPos = wordStart + words[i].length;
          wordCount = i + 1;
        }

        setCurrentWordIndex(wordCount);
        if (onWordChange && words[wordCount]) {
          onWordChange(wordCount, words[wordCount]);
        }
      }
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [text, words, voiceSettings, selectedVoice, onWordChange, onSpeakingStart, onSpeakingEnd]);

  const pause = useCallback(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentWordIndex(-1);
    wordBoundaryIndexRef.current = 0;
    onSpeakingEnd?.();
  }, [onSpeakingEnd]);

  const getWordClassName = (index: number): string => {
    if (!highlightSettings.enabled || currentWordIndex < 0) {
      return 'synced-word';
    }

    const distance = index - currentWordIndex;
    const classes = ['synced-word'];

    if (index === currentWordIndex) {
      classes.push('synced-word-active');
      classes.push(`synced-word-style-${highlightSettings.style}`);
    } else if (distance < 0 && distance >= -3) {
      // Past words (fading)
      classes.push('synced-word-past');
      classes.push(`synced-word-past-${Math.abs(distance)}`);
    } else if (distance > 0 && distance <= highlightSettings.anticipationRange) {
      // Future words (anticipatory glow)
      classes.push('synced-word-future');
      classes.push(`synced-word-future-${distance}`);
    } else if (highlightSettings.style === 'karaoke' && index < currentWordIndex) {
      // Karaoke style: all past words stay highlighted
      classes.push('synced-word-karaoke-past');
    }

    return classes.join(' ');
  };

  const getWordStyle = (index: number): React.CSSProperties => {
    const style: React.CSSProperties = {};

    if (!highlightSettings.enabled || currentWordIndex < 0) {
      return style;
    }

    const distance = index - currentWordIndex;

    if (index === currentWordIndex) {
      style.backgroundColor = highlightSettings.hotspotColor;
      style.boxShadow = `0 0 10px ${highlightSettings.hotspotColor}`;
    } else if (distance < 0 && distance >= -3) {
      const opacity = 1 - Math.abs(distance) * 0.3;
      style.backgroundColor = `${highlightSettings.pastFadeColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
    } else if (distance > 0 && distance <= highlightSettings.anticipationRange) {
      const opacity = 1 - distance * 0.3;
      style.backgroundColor = `${highlightSettings.futureGlowColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
    } else if (highlightSettings.style === 'karaoke' && index < currentWordIndex) {
      style.backgroundColor = highlightSettings.pastFadeColor;
    }

    return style;
  };

  return (
    <div className={`synced-text-reader ${className}`}>
      {showControls && (
        <div className="synced-text-controls">
          <div className="synced-text-controls-left">
            {!isSpeaking ? (
              <button
                className="synced-control-btn synced-control-play"
                onClick={speak}
                title="Play"
              >
                [Play]
              </button>
            ) : isPaused ? (
              <button
                className="synced-control-btn synced-control-resume"
                onClick={resume}
                title="Resume"
              >
                [Resume]
              </button>
            ) : (
              <button
                className="synced-control-btn synced-control-pause"
                onClick={pause}
                title="Pause"
              >
                [Pause]
              </button>
            )}
            {isSpeaking && (
              <button
                className="synced-control-btn synced-control-stop"
                onClick={stop}
                title="Stop"
              >
                [Stop]
              </button>
            )}
          </div>

          <div className="synced-text-controls-right">
            <label className="synced-control-label">
              Speed: {voiceSettings.rate.toFixed(1)}x
            </label>
            <label className="synced-control-label">
              Voice:
              <select
                value={selectedVoice?.name || ''}
                onChange={(e) => {
                  const voice = availableVoices.find((v) => v.name === e.target.value);
                  if (voice) setSelectedVoice(voice);
                }}
                className="synced-voice-select"
              >
                {availableVoices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={`synced-text-content ${isSpeaking ? 'synced-text-speaking' : ''}`}
        style={{
          '--fade-duration': `${highlightSettings.fadeDuration}s`,
          '--hotspot-color': highlightSettings.hotspotColor,
          '--past-fade-color': highlightSettings.pastFadeColor,
          '--future-glow-color': highlightSettings.futureGlowColor,
        } as React.CSSProperties}
      >
        {words.map((word, index) => (
          <React.Fragment key={index}>
            <span
              ref={(el) => (wordRefs.current[index] = el)}
              className={getWordClassName(index)}
              style={getWordStyle(index)}
              onClick={() => {
                if (isSpeaking) {
                  // TODO: Implement click-to-seek functionality
                }
              }}
            >
              {word}
            </span>
            {index < words.length - 1 && ' '}
          </React.Fragment>
        ))}
      </div>

      {isSpeaking && highlightSettings.style === 'wave' && (
        <div className="synced-text-wave-overlay" />
      )}
    </div>
  );
}

export default SyncedTextReader;
