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
  selectedVoiceName?: string; // The system voice name to use (from SpeechSynthesisVoice.name)
  openVoiceProfileId?: string; // Optional OpenVoice profile ID for voice cloning
  useOpenVoice?: boolean; // Whether to use OpenVoice TTS instead of system TTS
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

  // OpenVoice audio playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wordTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isOpenVoiceLoading, setIsOpenVoiceLoading] = useState(false);
  const [openVoiceError, setOpenVoiceError] = useState<string | null>(null);

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

      // If a specific voice name is provided, try to use that
      if (voiceSettings.selectedVoiceName && voices.length > 0) {
        const specifiedVoice = voices.find(v => v.name === voiceSettings.selectedVoiceName);
        if (specifiedVoice) {
          setSelectedVoice(specifiedVoice);
          return;
        }
      }

      // Otherwise, auto-select if no voice selected yet
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
  }, [selectedVoice, voiceSettings.selectedVoiceName]);

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

  // Threshold for using chunked synthesis (characters)
  const LONG_TEXT_THRESHOLD = 500;

  // OpenVoice TTS synthesis function
  const speakWithOpenVoice = useCallback(async () => {
    if (!voiceSettings.openVoiceProfileId || words.length === 0) return;

    setIsOpenVoiceLoading(true);
    setOpenVoiceError(null);

    try {
      // Use chunked synthesis for longer texts
      const useChunkedSynthesis = text.length > LONG_TEXT_THRESHOLD;
      const synthesizeChannel = useChunkedSynthesis ? 'openvoice:synthesizeLong' : 'openvoice:synthesize';

      // Request synthesis from OpenVoice backend
      const result = await window.electronAPI.invoke(synthesizeChannel, {
        text,
        profile_id: voiceSettings.openVoiceProfileId,
        language: 'EN',
        speed: voiceSettings.rate,
      }) as { success: boolean; audioPath?: string; error?: string };

      if (!result.success || !result.audioPath) {
        throw new Error(result.error || 'OpenVoice synthesis failed');
      }

      // Create audio element to play the file
      const audio = new Audio(`file://${result.audioPath}`);
      // For volumes up to 100%, use standard volume control
      // For volumes above 100%, we'll use a gain node later
      const normalizedVolume = Math.min(voiceSettings.volume / 100, 1.0);
      audio.volume = normalizedVolume;

      // If volume is above 100%, we need to use Web Audio API for amplification
      let audioContext: AudioContext | null = null;
      let gainNode: GainNode | null = null;
      if (voiceSettings.volume > 100) {
        audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(audio);
        gainNode = audioContext.createGain();
        gainNode.gain.value = voiceSettings.volume / 100; // e.g., 2.0 for 200%
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        audio.volume = 1.0; // Set base volume to max when using gain
      }
      audioRef.current = audio;

      // Estimate word timing based on audio duration and weighted word lengths
      audio.onloadedmetadata = () => {
        const totalDuration = audio.duration * 1000; // Convert to ms

        // Calculate weighted durations for each word
        // Words with more characters take longer to speak
        // Punctuation at end of words adds pause time
        const calculateWordWeight = (word: string): number => {
          let weight = word.length; // Base weight is character count

          // Add weight for ending punctuation (pauses after sentences)
          if (/[.!?]$/.test(word)) {
            weight += 4; // Longer pause after sentence-ending punctuation
          } else if (/[,;:]$/.test(word)) {
            weight += 2; // Shorter pause after comma/semicolon
          }

          // Minimum weight of 1
          return Math.max(weight, 1);
        };

        const wordWeights = words.map(calculateWordWeight);
        const totalWeight = wordWeights.reduce((sum, w) => sum + w, 0);

        // Calculate cumulative timing for each word
        const wordEndTimes: number[] = [];
        let cumulativeTime = 0;
        for (let i = 0; i < words.length; i++) {
          const wordDuration = (wordWeights[i] / totalWeight) * totalDuration;
          cumulativeTime += wordDuration;
          wordEndTimes.push(cumulativeTime);
        }

        audio.onplay = () => {
          setIsSpeaking(true);
          setIsPaused(false);
          setCurrentWordIndex(0);
          onSpeakingStart?.();

          // Use requestAnimationFrame for smoother sync with audio playback
          let animationFrameId: number | null = null;
          let lastWordIndex = 0;

          const syncWithAudio = () => {
            if (!audioRef.current || audioRef.current.paused || audioRef.current.ended) {
              return;
            }

            const currentTime = audioRef.current.currentTime * 1000; // Convert to ms

            // Find which word we should be on based on current audio time
            let newWordIndex = 0;
            for (let i = 0; i < wordEndTimes.length; i++) {
              if (currentTime < wordEndTimes[i]) {
                newWordIndex = i;
                break;
              }
              newWordIndex = i;
            }

            // Only update if word changed
            if (newWordIndex !== lastWordIndex) {
              lastWordIndex = newWordIndex;
              setCurrentWordIndex(newWordIndex);
              if (onWordChange && words[newWordIndex]) {
                onWordChange(newWordIndex, words[newWordIndex]);
              }
            }

            // Continue syncing
            animationFrameId = requestAnimationFrame(syncWithAudio);
          };

          // Start syncing
          animationFrameId = requestAnimationFrame(syncWithAudio);

          // Store cleanup function in ref for pause/stop handling
          wordTimerRef.current = animationFrameId as unknown as NodeJS.Timeout;
        };

        audio.onpause = () => {
          if (wordTimerRef.current) {
            // Cancel the animation frame (stored as number cast to NodeJS.Timeout)
            cancelAnimationFrame(wordTimerRef.current as unknown as number);
            wordTimerRef.current = null;
          }
          setIsPaused(true);
        };

        audio.onended = () => {
          if (wordTimerRef.current) {
            // Cancel the animation frame
            cancelAnimationFrame(wordTimerRef.current as unknown as number);
            wordTimerRef.current = null;
          }
          setIsSpeaking(false);
          setIsPaused(false);
          setCurrentWordIndex(-1);
          onSpeakingEnd?.();
          audioRef.current = null;
        };

        audio.play().catch((err) => {
          console.error('Audio playback error:', err);
          setOpenVoiceError('Failed to play audio');
          setIsOpenVoiceLoading(false);
        });
      };

      setIsOpenVoiceLoading(false);
    } catch (err) {
      console.error('OpenVoice synthesis error:', err);
      setOpenVoiceError((err as Error).message);
      setIsOpenVoiceLoading(false);
    }
  }, [text, words, voiceSettings, onWordChange, onSpeakingStart, onSpeakingEnd]);

  // Standard Web Speech API TTS function
  const speakWithWebSpeech = useCallback(() => {
    if (!window.speechSynthesis || words.length === 0) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = voiceSettings.rate;
    utterance.pitch = 1 + voiceSettings.pitch / 100;
    // Web Speech API volume is capped at 1.0 (100%)
    // For higher volumes, users need to use OpenVoice custom voices
    utterance.volume = Math.min(voiceSettings.volume / 100, 1.0);

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

  // Main speak function - routes to OpenVoice or Web Speech API
  const speak = useCallback(() => {
    // Check if OpenVoice should be used
    if (voiceSettings.useOpenVoice && voiceSettings.openVoiceProfileId) {
      speakWithOpenVoice();
    } else {
      speakWithWebSpeech();
    }
  }, [voiceSettings.useOpenVoice, voiceSettings.openVoiceProfileId, speakWithOpenVoice, speakWithWebSpeech]);

  const pause = useCallback(() => {
    // Handle OpenVoice audio
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPaused(true);
      return;
    }
    // Handle Web Speech API
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    // Handle OpenVoice audio
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play();
      setIsPaused(false);
      return;
    }
    // Handle Web Speech API
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  const stop = useCallback(() => {
    // Handle OpenVoice audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (wordTimerRef.current) {
      // Cancel animation frame (used for OpenVoice word sync)
      cancelAnimationFrame(wordTimerRef.current as unknown as number);
      wordTimerRef.current = null;
    }
    // Handle Web Speech API
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentWordIndex(-1);
    wordBoundaryIndexRef.current = 0;
    onSpeakingEnd?.();
  }, [onSpeakingEnd]);

  // Seek to a specific word during playback
  const seekToWord = useCallback((targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= words.length) return;

    // Handle OpenVoice audio seek
    if (audioRef.current && audioRef.current.duration) {
      // Calculate approximate time position based on word weights
      const calculateWordWeight = (word: string): number => {
        let weight = word.length;
        if (/[.!?]$/.test(word)) weight += 4;
        else if (/[,;:]$/.test(word)) weight += 2;
        return Math.max(weight, 1);
      };

      const wordWeights = words.map(calculateWordWeight);
      const totalWeight = wordWeights.reduce((sum, w) => sum + w, 0);
      const totalDuration = audioRef.current.duration;

      // Calculate time position for target word
      let targetTime = 0;
      for (let i = 0; i < targetIndex; i++) {
        targetTime += (wordWeights[i] / totalWeight) * totalDuration;
      }

      // Seek to the position
      audioRef.current.currentTime = targetTime;
      setCurrentWordIndex(targetIndex);
      return;
    }

    // Handle Web Speech API - need to restart from the target word
    if (window.speechSynthesis && isSpeaking) {
      // Stop current speech
      window.speechSynthesis.cancel();

      // Create text from target word onwards
      const remainingText = words.slice(targetIndex).join(' ');
      const utterance = new SpeechSynthesisUtterance(remainingText);
      utterance.rate = voiceSettings.rate;
      utterance.pitch = 1 + voiceSettings.pitch / 100;
      utterance.volume = Math.min(voiceSettings.volume / 100, 1.0);

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      // Adjust the word boundary index offset for the remaining text
      const wordOffset = targetIndex;
      wordBoundaryIndexRef.current = 0;

      utterance.onboundary = (event) => {
        if (event.name === 'word') {
          const newIndex = wordOffset + wordBoundaryIndexRef.current;
          setCurrentWordIndex(newIndex);
          if (onWordChange && words[newIndex]) {
            onWordChange(newIndex, words[newIndex]);
          }
          wordBoundaryIndexRef.current++;
        }
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
        setCurrentWordIndex(-1);
        wordBoundaryIndexRef.current = 0;
        onSpeakingEnd?.();
      };

      utteranceRef.current = utterance;
      setCurrentWordIndex(targetIndex);
      window.speechSynthesis.speak(utterance);
    }
  }, [words, voiceSettings, selectedVoice, isSpeaking, onWordChange, onSpeakingEnd]);

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
            {isOpenVoiceLoading ? (
              <span className="synced-control-loading">[Loading...]</span>
            ) : !isSpeaking ? (
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
            {voiceSettings.useOpenVoice && (
              <span className="synced-openvoice-badge" title="Using cloned voice">
                [Cloned Voice]
              </span>
            )}
          </div>

          <div className="synced-text-controls-right">
            <label className="synced-control-label">
              Speed: {voiceSettings.rate.toFixed(1)}x
            </label>
            {!voiceSettings.useOpenVoice && (
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
            )}
          </div>
        </div>
      )}

      {openVoiceError && (
        <div className="synced-text-error">
          [OpenVoice Error: {openVoiceError}]
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
                if (isSpeaking && !isPaused) {
                  seekToWord(index);
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
