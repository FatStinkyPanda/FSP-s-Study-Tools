import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import StudySession from './StudySession';
import KBEditor from './components/KBEditor';
import Dashboard from './components/Dashboard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import SearchResults from './components/SearchResults';
import UpdateNotification from './components/UpdateNotification';
import KBViewer from './components/KBViewer';
import JasperChat from './components/JasperChat';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorNotificationContainer, useErrorNotifications } from './components/ErrorNotification';
import { toUserFriendlyError, errorToNotification, logError } from '../shared/errors';
import { useOpenVoice, OpenVoiceStatus as OpenVoiceStatusType, OpenVoiceProfile as OpenVoiceProfileType } from './hooks/useOpenVoice';
import VoiceProfileEditor from './components/VoiceProfileEditor';

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface KnowledgeBase {
  id: number;
  uuid: string;
  title: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

interface VoiceTrainingSample {
  id: string;
  name: string;
  path?: string;
  duration: number;
  scriptId?: number;
  createdAt: string;
}

interface VoiceProfile {
  id: string;
  name: string;
  type: 'system' | 'custom';
  systemVoice?: string; // For system TTS voices
  openvoiceModel?: string; // For OpenVoice custom voices
  openvoiceProfileId?: string; // OpenVoice backend profile ID
  audioSamplePath?: string; // Reference audio for OpenVoice
  trainingSamples?: VoiceTrainingSample[]; // Multiple audio samples for training
  trainingStatus?: 'pending' | 'training' | 'ready' | 'failed';
  trainingProgress?: number; // 0-100 percentage during training
  trainingError?: string; // Error message if training failed
  created?: string;
}

interface AppSettings {
  openai_api_key?: string;
  anthropic_api_key?: string;
  google_api_key?: string;
  openrouter_api_key?: string;
  default_ai_provider?: 'openai' | 'anthropic' | 'google' | 'openrouter';
  default_model?: string;
  openai_model?: string;
  anthropic_model?: string;
  google_model?: string;
  openrouter_model?: string;
  openai_models?: string[];
  anthropic_models?: string[];
  google_models?: string[];
  openrouter_models?: string[];
  temperature?: number;
  max_tokens?: number;
  theme?: 'dark' | 'light' | 'auto';
  // Voice settings
  voice_enabled?: boolean;
  voice_type?: 'system' | 'custom'; // Whether to use system voice or custom voice profile
  voice_speed?: number; // 0.5 - 2.0
  voice_pitch?: number; // 0.5 - 2.0
  voice_volume?: number; // 0.0 - 1.0
  default_system_voice?: string; // Default system voice name from SpeechSynthesis API
  selected_voice_profile?: string; // Voice profile ID
  voice_profiles?: VoiceProfile[];
  voice_auto_read?: boolean; // Auto-read AI responses
  voice_highlight_sync?: boolean; // Sync text highlighting with speech
}

interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
}

// KB Editor data types
interface KBFileReference {
  id: string;
  name: string;
  path: string;
  type: string;
  parsed?: boolean;
  parsedContent?: string;
  parseError?: string;
}

interface KBModule {
  id: string;
  title: string;
  order: number;
  files: KBFileReference[];
  chapters: KBChapter[];
}

interface KBChapter {
  id: string;
  title: string;
  order: number;
  files: KBFileReference[];
  sections: KBSection[];
}

interface KBSection {
  id: string;
  title: string;
  order: number;
  content: {
    text: string;
    files: KBFileReference[];
  };
}

interface KBData {
  title: string;
  metadata: {
    version: string;
    author: string;
    description: string;
  };
  modules: KBModule[];
}

// Escape XML special characters
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Helper function to render files in XML format
function renderFilesXML(files: KBFileReference[], indent: string): string {
  if (!files || files.length === 0) return '';

  let xml = `${indent}<files>\n`;
  for (const file of files) {
    xml += `${indent}  <file id="${escapeXML(file.id)}" name="${escapeXML(file.name)}" path="${escapeXML(file.path)}" type="${escapeXML(file.type)}" parsed="${file.parsed ? 'true' : 'false'}">\n`;
    if (file.parsedContent) {
      xml += `${indent}    <parsed_content>${escapeXML(file.parsedContent)}</parsed_content>\n`;
    }
    xml += `${indent}  </file>\n`;
  }
  xml += `${indent}</files>\n`;
  return xml;
}

// Convert KBData to XML format matching the knowledge base schema expected by XMLParser
function convertKBDataToXML(data: KBData, uuid: string): string {
  const now = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<knowledge_base>
  <metadata>
    <uuid>${uuid}</uuid>
    <title>${escapeXML(data.title)}</title>
    <version>${escapeXML(data.metadata.version || '1.0')}</version>
    <author>${escapeXML(data.metadata.author || '')}</author>
    <description>${escapeXML(data.metadata.description || '')}</description>
    <created>${now}</created>
    <modified>${now}</modified>
  </metadata>

  <modules>
`;

  // Add modules
  for (let moduleIndex = 0; moduleIndex < data.modules.length; moduleIndex++) {
    const module = data.modules[moduleIndex];
    xml += `    <module id="${escapeXML(module.id)}" order="${moduleIndex + 1}">\n`;
    xml += `      <title>${escapeXML(module.title)}</title>\n`;
    xml += `      <description></description>\n`;

    // Add module-level files as resources (if any)
    if (module.files && module.files.length > 0) {
      xml += renderFilesXML(module.files, '      ');
    }

    xml += `      <chapters>\n`;

    // Add chapters
    for (let chapterIndex = 0; chapterIndex < module.chapters.length; chapterIndex++) {
      const chapter = module.chapters[chapterIndex];
      xml += `        <chapter id="${escapeXML(chapter.id)}" order="${chapterIndex + 1}">\n`;
      xml += `          <title>${escapeXML(chapter.title)}</title>\n`;
      xml += `          <description></description>\n`;

      // Add chapter-level files (if any)
      if (chapter.files && chapter.files.length > 0) {
        xml += renderFilesXML(chapter.files, '          ');
      }

      xml += `          <sections>\n`;

      // Add sections
      for (let sectionIndex = 0; sectionIndex < chapter.sections.length; sectionIndex++) {
        const section = chapter.sections[sectionIndex];
        xml += `            <section id="${escapeXML(section.id)}" order="${sectionIndex + 1}">\n`;
        xml += `              <title>${escapeXML(section.title)}</title>\n`;
        xml += `              <content>\n`;

        // Combine section text with parsed content from files
        let sectionText = section.content.text || '';
        const allElements: Array<{ type: string; content?: string; level?: number; items?: string[]; ordered?: boolean }> = [];

        if (section.content.files && section.content.files.length > 0) {
          for (const file of section.content.files) {
            if (file.parsedContent) {
              if (sectionText) sectionText += '\n\n';
              sectionText += `[Content from ${file.name}]\n${file.parsedContent}`;
            }
            // Collect structured elements from parsed files
            if (file.parsedElements && file.parsedElements.length > 0) {
              allElements.push(...file.parsedElements);
            }
          }
        }

        xml += `                <text>${escapeXML(sectionText)}</text>\n`;

        // Add structured elements if available
        if (allElements.length > 0) {
          xml += `                <elements>\n`;
          for (let elemIdx = 0; elemIdx < allElements.length; elemIdx++) {
            const elem = allElements[elemIdx];
            if (elem.type === 'heading') {
              xml += `                  <heading order="${elemIdx + 1}" level="${elem.level || 2}">${escapeXML(elem.content || '')}</heading>\n`;
            } else if (elem.type === 'paragraph') {
              xml += `                  <paragraph order="${elemIdx + 1}">${escapeXML(elem.content || '')}</paragraph>\n`;
            } else if (elem.type === 'list') {
              xml += `                  <list order="${elemIdx + 1}" ordered="${elem.ordered ? 'true' : 'false'}">\n`;
              if (elem.items) {
                for (const item of elem.items) {
                  xml += `                    <item>${escapeXML(item)}</item>\n`;
                }
              }
              xml += `                  </list>\n`;
            }
          }
          xml += `                </elements>\n`;
        }

        // Add file references for sections
        if (section.content.files && section.content.files.length > 0) {
          xml += renderFilesXML(section.content.files, '                ');
        }

        xml += `              </content>\n`;
        xml += `            </section>\n`;
      }

      xml += `          </sections>\n`;
      xml += `        </chapter>\n`;
    }

    xml += `      </chapters>\n`;
    xml += `    </module>\n`;
  }

  xml += `  </modules>
</knowledge_base>`;

  return xml;
}

function App() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [appVersion, setAppVersion] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'browse' | 'study' | 'editor' | 'settings' | 'dashboard' | 'analytics' | 'jasper'>('home');
  const [jasperKBs, setJasperKBs] = useState<Array<{ id: number; title: string; enabled: boolean }>>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [studyKbId, setStudyKbId] = useState<number | null>(null);
  const [studySectionId, setStudySectionId] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [customModelInputs, setCustomModelInputs] = useState<Record<string, string>>({});
  const [viewingKB, setViewingKB] = useState<{ id: number; title: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ kb: KnowledgeBase; confirmText: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Voice settings state
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [testingVoice, setTestingVoice] = useState(false);
  const [showVoiceProfileModal, setShowVoiceProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [selectedAudioFile, setSelectedAudioFile] = useState<string | null>(null);
  const [voiceModalTab, setVoiceModalTab] = useState<'system' | 'custom'>('system');
  const [selectedModalVoice, setSelectedModalVoice] = useState<string>('');
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [editingVoiceProfile, setEditingVoiceProfile] = useState<VoiceProfile | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'free' | 'script'>('free');
  const [selectedScript, setSelectedScript] = useState<number | null>(null);
  const [recordedSamples, setRecordedSamples] = useState<Array<{ id: string; name: string; duration: number; blob: Blob }>>([]);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const recordingStartTimeRef = React.useRef<number>(0);

  // Training scripts for voice cloning
  const trainingScripts = [
    { id: 1, title: "Introduction", text: "Hello, my name is Jasper and I am your AI learning assistant. I am here to help you study and learn new things." },
    { id: 2, title: "Numbers & Letters", text: "The quick brown fox jumps over the lazy dog. One, two, three, four, five, six, seven, eight, nine, ten." },
    { id: 3, title: "Questions", text: "How are you doing today? What would you like to learn about? Can I help you with anything else?" },
    { id: 4, title: "Emotions", text: "That's fantastic news! I'm sorry to hear that. I'm excited to help you with this. Let me think about that for a moment." },
    { id: 5, title: "Technical", text: "The algorithm processes the data efficiently. Initialize the variables before the main function. The API returns a JSON response." },
  ];

  // Error notification system
  const { notifications, addNotification, dismissNotification } = useErrorNotifications();

  // OpenVoice voice cloning service
  const openVoice = useOpenVoice();

  // Helper to show user-friendly errors
  const showError = useCallback((error: unknown, context?: string) => {
    const appError = toUserFriendlyError(error, context);
    logError(appError, context);
    addNotification(errorToNotification(appError));
  }, [addNotification]);

  // Handle notification actions
  const handleNotificationAction = useCallback((action: string, notificationId: string) => {
    switch (action) {
      case 'retry':
        // Dismiss and let the caller retry
        dismissNotification(notificationId);
        break;
      case 'open-settings':
        setCurrentView('settings');
        dismissNotification(notificationId);
        break;
      case 'restart':
        window.location.reload();
        break;
      case 'offline':
        // Dismiss notification for offline mode
        dismissNotification(notificationId);
        break;
      default:
        console.log('Unhandled notification action:', action);
    }
  }, [dismissNotification]);

  useEffect(() => {
    loadData();
  }, []);

  // Apply theme when settings change
  useEffect(() => {
    applyTheme(settings.theme || 'dark');
  }, [settings.theme]);

  // Load system voices for TTS
  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setSystemVoices(voices);
    };

    // Voices may not be loaded immediately
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Load OpenVoice profiles when service is running and we have custom voice profiles
  useEffect(() => {
    const loadProfiles = async () => {
      // Only refresh if service is running and we have custom voice profiles
      if (openVoice.status.running && settings.voice_profiles?.some(p => p.type === 'custom' && p.openvoiceProfileId)) {
        console.log('[App] OpenVoice service running, refreshing profiles...');
        await openVoice.refreshProfiles();
      }
    };
    loadProfiles();
  }, [openVoice.status.running, settings.voice_profiles, openVoice.refreshProfiles]);

  // Sync OpenVoice training updates with local voice profiles
  useEffect(() => {
    // Listen for OpenVoice training updates via the hook's profiles
    const syncTrainingStatus = () => {
      console.log('[syncTrainingStatus] Running sync...', {
        voiceProfilesCount: settings.voice_profiles?.length || 0,
        ovProfilesCount: openVoice.profiles.length
      });

      if (!settings.voice_profiles || openVoice.profiles.length === 0) {
        console.log('[syncTrainingStatus] Early return - no profiles to sync');
        return;
      }

      let hasChanges = false;
      const updatedProfiles = settings.voice_profiles.map(profile => {
        if (profile.type !== 'custom' || !profile.openvoiceProfileId) return profile;

        // Find matching OpenVoice profile
        const ovProfile = openVoice.profiles.find(p => p.id === profile.openvoiceProfileId);
        console.log('[syncTrainingStatus] Matching profile:', {
          localId: profile.openvoiceProfileId,
          ovProfile: ovProfile ? { id: ovProfile.id, state: ovProfile.state } : 'not found'
        });
        if (!ovProfile) return profile;

        // Map OpenVoice state to local training status
        let newStatus: VoiceProfile['trainingStatus'] = profile.trainingStatus;
        let newProgress = profile.trainingProgress;
        let newError = profile.trainingError;

        if (ovProfile.state === 'extracting') {
          newStatus = 'training';
          newProgress = ovProfile.progress;
        } else if (ovProfile.state === 'ready') {
          newStatus = 'ready';
          newProgress = 100;
          newError = undefined;
        } else if (ovProfile.state === 'failed') {
          newStatus = 'failed';
          newError = ovProfile.error;
        } else if (ovProfile.state === 'pending') {
          newStatus = 'pending';
        }

        // Check if anything changed
        if (
          newStatus !== profile.trainingStatus ||
          newProgress !== profile.trainingProgress ||
          newError !== profile.trainingError
        ) {
          console.log('[syncTrainingStatus] Status changed:', {
            profileId: profile.id,
            oldStatus: profile.trainingStatus,
            newStatus,
            ovState: ovProfile.state
          });
          hasChanges = true;
          return {
            ...profile,
            trainingStatus: newStatus,
            trainingProgress: newProgress,
            trainingError: newError,
          };
        }
        return profile;
      });

      if (hasChanges) {
        console.log('[syncTrainingStatus] Updating settings with new profiles');
        setSettings(prev => ({
          ...prev,
          voice_profiles: updatedProfiles,
        }));
      }
    };

    syncTrainingStatus();
  }, [openVoice.profiles, settings.voice_profiles]);

  const applyTheme = (theme: string) => {
    const root = document.documentElement;

    if (theme === 'auto') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', theme);
    }
  };

  const loadData = async () => {
    try {
      // Get app version
      const version = await window.electronAPI.invoke('app:version') as string;
      setAppVersion(version);

      // Load knowledge bases
      const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
      setKnowledgeBases(kbs);
      // Initialize Jasper KB list with all KBs enabled by default
      setJasperKBs(kbs.map(kb => ({ id: kb.id, title: kb.title, enabled: true })));

      // Load settings
      const loadedSettings = await window.electronAPI.invoke('settings:getAll') as AppSettings;
      console.log('[App] Loaded settings - voice_profiles:', loadedSettings.voice_profiles);
      console.log('[App] Loaded settings - selected_voice_profile:', loadedSettings.selected_voice_profile);
      setSettings(loadedSettings);

      // Apply theme immediately after loading
      applyTheme(loadedSettings.theme || 'dark');
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      await window.electronAPI.invoke('settings:updateAll', settings);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (error) {
      showError(error, 'Failed to save settings');
    }
  };

  const handleSettingChange = async (key: keyof AppSettings, value: string | number | string[] | boolean | VoiceProfile[]) => {
    const newSettings = {
      ...settings,
      [key]: value
    };
    setSettings(newSettings);

    // Auto-save voice profile selection immediately
    if (key === 'selected_voice_profile') {
      try {
        await window.electronAPI.invoke('settings:updateAll', newSettings);
        console.log('Voice profile selection saved');
      } catch (error) {
        console.error('Failed to save voice profile selection:', error);
      }
    }
  };

  // Voice testing function
  const testVoice = useCallback(async () => {
    if (testingVoice) {
      speechSynthesis.cancel();
      setTestingVoice(false);
      return;
    }

    const testText = "Hello! I'm Jasper, your AI learning assistant. How can I help you study today?";

    // Find selected voice profile
    const selectedProfile = settings.voice_profiles?.find(
      p => p.id === settings.selected_voice_profile
    );

    // Debug logging
    console.log('[testVoice] Selected profile ID:', settings.selected_voice_profile);
    console.log('[testVoice] Found profile:', selectedProfile);
    console.log('[testVoice] Profile type:', selectedProfile?.type);
    console.log('[testVoice] OpenVoice profile ID:', selectedProfile?.openvoiceProfileId);
    console.log('[testVoice] Training status:', selectedProfile?.trainingStatus);
    console.log('[testVoice] OpenVoice service running:', openVoice.status.running);

    // Check if it's a custom voice with OpenVoice
    if (selectedProfile?.type === 'custom' && selectedProfile.openvoiceProfileId && selectedProfile.trainingStatus === 'ready') {
      // Use OpenVoice synthesis for custom voices
      setTestingVoice(true);
      try {
        // synthesize() expects a SynthesizeRequest object and returns the audio path directly
        const audioPath = await openVoice.synthesize({
          text: testText,
          profile_id: selectedProfile.openvoiceProfileId,
          language: 'EN',
          speed: settings.voice_speed ?? 1.0
        });

        console.log('[testVoice] OpenVoice synthesis result - audioPath:', audioPath);

        if (audioPath) {
          // Play the generated audio
          const audio = new Audio(`file://${audioPath}`);
          audio.volume = settings.voice_volume ?? 1.0;
          audio.onended = () => setTestingVoice(false);
          audio.onerror = () => {
            console.error('Failed to play OpenVoice audio');
            setTestingVoice(false);
          };
          await audio.play();
        } else {
          console.error('OpenVoice synthesis failed:', openVoice.error);
          setTestingVoice(false);
          // Fall back to system voice
          fallbackToSystemVoice(testText, selectedProfile);
        }
      } catch (error) {
        console.error('OpenVoice synthesis error:', error);
        setTestingVoice(false);
        fallbackToSystemVoice(testText, selectedProfile);
      }
      return;
    }

    // Use browser's SpeechSynthesis for system voices
    const utterance = new SpeechSynthesisUtterance(testText);
    utterance.rate = settings.voice_speed ?? 1.0;
    utterance.pitch = settings.voice_pitch ?? 1.0;
    utterance.volume = settings.voice_volume ?? 1.0;

    if (selectedProfile?.type === 'system' && selectedProfile.systemVoice) {
      const voice = systemVoices.find(v => v.name === selectedProfile.systemVoice);
      if (voice) {
        utterance.voice = voice;
      }
    } else if (settings.default_system_voice) {
      // Fall back to default system voice if no profile selected
      const voice = systemVoices.find(v => v.name === settings.default_system_voice);
      if (voice) {
        utterance.voice = voice;
      }
    }

    utterance.onend = () => setTestingVoice(false);
    utterance.onerror = () => setTestingVoice(false);

    setTestingVoice(true);
    speechSynthesis.speak(utterance);
  }, [testingVoice, settings, systemVoices, openVoice]);

  // Helper function to fall back to system voice
  const fallbackToSystemVoice = (text: string, profile?: VoiceProfile) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.voice_speed ?? 1.0;
    utterance.pitch = settings.voice_pitch ?? 1.0;
    utterance.volume = settings.voice_volume ?? 1.0;

    if (settings.default_system_voice) {
      const voice = systemVoices.find(v => v.name === settings.default_system_voice);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => setTestingVoice(false);
    utterance.onerror = () => setTestingVoice(false);

    setTestingVoice(true);
    speechSynthesis.speak(utterance);
  };

  // Preview a specific voice
  const previewVoice = useCallback((voiceName: string) => {
    if (previewingVoice) {
      speechSynthesis.cancel();
      setPreviewingVoice(false);
      return;
    }

    const voice = systemVoices.find(v => v.name === voiceName);
    if (!voice) return;

    const utterance = new SpeechSynthesisUtterance(
      "Hello! This is a preview of this voice. How does it sound?"
    );
    utterance.voice = voice;
    utterance.rate = settings.voice_speed ?? 1.0;
    utterance.pitch = settings.voice_pitch ?? 1.0;
    utterance.volume = settings.voice_volume ?? 1.0;

    utterance.onend = () => setPreviewingVoice(false);
    utterance.onerror = () => setPreviewingVoice(false);

    setPreviewingVoice(true);
    speechSynthesis.speak(utterance);
  }, [previewingVoice, settings, systemVoices]);

  // Create a new voice profile (system or custom)
  const createVoiceProfile = useCallback(async (
    name: string,
    systemVoice: string,
    isCustom: boolean = false,
    audioPath?: string,
    samples?: Array<{ id: string; name: string; duration: number; blob: Blob }>
  ) => {
    const profileId = `profile-${Date.now()}`;
    const trainingSamples: VoiceTrainingSample[] = [];
    const savedAudioPaths: string[] = [];

    // Save recorded samples to disk if creating a custom voice
    if (isCustom && samples && samples.length > 0) {
      for (const sample of samples) {
        try {
          // Convert Blob to ArrayBuffer
          const arrayBuffer = await sample.blob.arrayBuffer();
          const result = await window.electronAPI.invoke('voice:saveAudioSample', {
            profileId,
            sampleId: sample.id,
            audioData: Array.from(new Uint8Array(arrayBuffer)),
            format: 'webm'
          }) as { success: boolean; path?: string; error?: string };

          if (result.success && result.path) {
            trainingSamples.push({
              id: sample.id,
              name: sample.name,
              path: result.path,
              duration: sample.duration,
              createdAt: new Date().toISOString()
            });
            savedAudioPaths.push(result.path);
          }
        } catch (error) {
          console.error('Failed to save sample:', sample.name, error);
        }
      }
    }

    // Copy uploaded audio file if provided
    console.log('[DEBUG] createVoiceProfile - isCustom:', isCustom, 'audioPath:', audioPath);
    if (isCustom && audioPath) {
      try {
        const sampleId = `uploaded-${Date.now()}`;
        console.log('[DEBUG] Copying audio file with sampleId:', sampleId, 'profileId:', profileId, 'sourcePath:', audioPath);
        const result = await window.electronAPI.invoke('voice:copyAudioFile', {
          profileId,
          sourcePath: audioPath,
          sampleId
        }) as { success: boolean; path?: string; error?: string };

        console.log('[DEBUG] voice:copyAudioFile result:', result);
        if (result.success && result.path) {
          trainingSamples.push({
            id: sampleId,
            name: audioPath.split(/[\\/]/).pop() || 'Uploaded audio',
            path: result.path,
            duration: 0, // Duration unknown for uploaded files
            createdAt: new Date().toISOString()
          });
          savedAudioPaths.push(result.path);
          console.log('[DEBUG] Audio file copied successfully. savedAudioPaths:', savedAudioPaths);
        } else {
          console.error('[DEBUG] voice:copyAudioFile failed:', result.error);
        }
      } catch (error) {
        console.error('Failed to copy uploaded file:', error);
      }
    } else {
      console.log('[DEBUG] Skipping audio copy - isCustom:', isCustom, 'audioPath:', audioPath);
    }

    let openvoiceProfileId: string | undefined;
    let trainingStatus: VoiceProfile['trainingStatus'] = isCustom ? 'pending' : undefined;
    let trainingError: string | undefined;

    console.log('[DEBUG] Before OpenVoice integration - isCustom:', isCustom, 'savedAudioPaths.length:', savedAudioPaths.length);
    // For custom voices, integrate with OpenVoice
    if (isCustom && savedAudioPaths.length > 0) {
      console.log('[DEBUG] Entering OpenVoice integration block');
      try {
        // Track if service is ready (don't rely on stale closure state)
        let serviceReady = openVoice.status.running;
        console.log('[DEBUG] Initial serviceReady:', serviceReady, 'openVoice.status:', openVoice.status);

        // Start OpenVoice service if not running
        if (!serviceReady) {
          console.log('[DEBUG] Starting OpenVoice service...');
          const startResult = await openVoice.startService();
          console.log('[DEBUG] startService result:', startResult);
          if (startResult) {
            serviceReady = true;
          } else {
            console.warn('Failed to start OpenVoice service, profile will be created without OpenVoice integration');
          }
        }

        // Create OpenVoice profile if service is running
        if (serviceReady) {
          // Ensure models are initialized before creating profile
          console.log('[DEBUG] Service ready, checking models initialized:', openVoice.status.initialized);
          if (!openVoice.status.initialized) {
            console.log('[DEBUG] Initializing OpenVoice models...');
            const initResult = await openVoice.initializeModels();
            console.log('[DEBUG] initializeModels result:', initResult);
            if (!initResult) {
              console.warn('Failed to initialize models, training may not work');
            }
          }

          console.log('[DEBUG] Creating OpenVoice profile with name:', name, 'audio samples:', savedAudioPaths);
          const ovProfile = await openVoice.createProfile(name, savedAudioPaths);
          console.log('[DEBUG] createProfile result:', ovProfile);

          if (ovProfile) {
            openvoiceProfileId = ovProfile.id;
            trainingStatus = 'pending';
            console.log('[DEBUG] OpenVoice profile created:', ovProfile.id);

            // Start training automatically
            console.log('[DEBUG] Starting voice training for profile:', ovProfile.id);
            const trainResult = await openVoice.trainProfile(ovProfile.id);
            console.log('[DEBUG] trainProfile result:', trainResult);
            if (trainResult) {
              trainingStatus = 'training';
              console.log('[DEBUG] Training started successfully');
            } else {
              trainingError = openVoice.error || 'Training failed to start';
              console.error('[DEBUG] Training failed to start:', trainingError);
            }
          } else {
            trainingError = openVoice.error || 'Failed to create OpenVoice profile';
            console.error('[DEBUG] Failed to create OpenVoice profile:', trainingError);
          }
        } else {
          console.log('[DEBUG] Service not ready, skipping OpenVoice integration');
        }
      } catch (error) {
        console.error('[DEBUG] OpenVoice integration error:', error);
        trainingError = (error as Error).message;
      }
    } else {
      console.log('[DEBUG] Skipping OpenVoice integration - isCustom:', isCustom, 'savedAudioPaths.length:', savedAudioPaths.length);
    }

    const newProfile: VoiceProfile = {
      id: profileId,
      name,
      type: isCustom ? 'custom' : 'system',
      systemVoice: isCustom ? undefined : systemVoice,
      openvoiceProfileId,
      audioSamplePath: isCustom && trainingSamples.length > 0 ? trainingSamples[0].path : undefined,
      trainingSamples: isCustom && trainingSamples.length > 0 ? trainingSamples : undefined,
      trainingStatus,
      trainingError,
      created: new Date().toISOString(),
    };

    const existingProfiles = settings.voice_profiles || [];
    const updatedProfiles = [...existingProfiles, newProfile];

    // Update state
    setSettings(prev => ({
      ...prev,
      voice_profiles: updatedProfiles,
      selected_voice_profile: newProfile.id,
    }));

    // Auto-save to persistent storage
    try {
      const updatedSettings = {
        ...settings,
        voice_profiles: updatedProfiles,
        selected_voice_profile: newProfile.id,
      };
      await window.electronAPI.invoke('settings:updateAll', updatedSettings);
      console.log('Voice profile saved to persistent storage');
    } catch (error) {
      console.error('Failed to save voice profile to storage:', error);
    }

    setShowVoiceProfileModal(false);
    setNewProfileName('');
    setSelectedModalVoice('');
    setSelectedAudioFile(null);
    setVoiceModalTab('system');
  }, [settings, openVoice]);

  // Delete a voice profile and its associated audio files
  const deleteVoiceProfile = useCallback(async (profileId: string) => {
    const existingProfiles = settings.voice_profiles || [];
    const profileToDelete = existingProfiles.find(p => p.id === profileId);

    // Delete audio files from disk for custom profiles
    if (profileToDelete?.type === 'custom') {
      try {
        await window.electronAPI.invoke('voice:deleteProfile', profileId);
      } catch (error) {
        console.error('Failed to delete profile audio files:', error);
      }

      // Also delete from OpenVoice if it has an OpenVoice profile
      if (profileToDelete.openvoiceProfileId && openVoice.status.running) {
        try {
          await openVoice.deleteProfile(profileToDelete.openvoiceProfileId);
        } catch (error) {
          console.error('Failed to delete OpenVoice profile:', error);
        }
      }
    }

    const updatedProfiles = existingProfiles.filter(p => p.id !== profileId);

    setSettings(prev => ({
      ...prev,
      voice_profiles: updatedProfiles,
      selected_voice_profile: updatedProfiles.length > 0 ? updatedProfiles[0].id : undefined,
    }));
  }, [settings.voice_profiles, openVoice]);

  // Select audio file for voice training (placeholder for OpenVoice integration)
  const selectAudioForTraining = useCallback(async () => {
    console.log('[DEBUG] selectAudioForTraining called');
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }
        ],
        properties: ['openFile']
      }) as { canceled: boolean; filePaths: string[] };

      console.log('[DEBUG] dialog:openFile result:', result);
      if (!result.canceled && result.filePaths.length > 0) {
        console.log('[DEBUG] Setting selectedAudioFile to:', result.filePaths[0]);
        setSelectedAudioFile(result.filePaths[0]);
      } else {
        console.log('[DEBUG] File dialog was canceled or no file selected');
      }
    } catch (error) {
      console.error('[DEBUG] selectAudioForTraining error:', error);
      showError(error, 'Failed to select audio file');
    }
  }, [showError]);

  // Start voice recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        // Calculate duration from start time ref (avoids closure issue with state)
        const durationSeconds = Math.round((Date.now() - recordingStartTimeRef.current) / 1000);
        const sampleName = selectedScript !== null
          ? trainingScripts.find(s => s.id === selectedScript)?.title || `Sample ${recordedSamples.length + 1}`
          : `Recording ${recordedSamples.length + 1}`;

        setRecordedSamples(prev => [...prev, {
          id: `sample-${Date.now()}`,
          name: sampleName,
          duration: durationSeconds,
          blob: audioBlob,
        }]);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        setRecordingTime(0);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);

      // Start timer for UI display
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      showError(error, 'Failed to start recording. Please check microphone permissions.');
    }
  }, [selectedScript, recordedSamples.length, showError]);

  // Stop voice recording
  const stopRecording = useCallback(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setMediaRecorder(null);
      setIsRecording(false);

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [mediaRecorder]);

  // Delete a recorded sample
  const deleteRecordedSample = useCallback((sampleId: string) => {
    setRecordedSamples(prev => prev.filter(s => s.id !== sampleId));
  }, []);

  // Play a recorded sample
  const playRecordedSample = useCallback((blob: Blob) => {
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(audioUrl);
  }, []);

  // Format recording time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Fetch available models for a provider using the API key
  const fetchModelsForProvider = async (provider: 'openai' | 'anthropic' | 'google' | 'openrouter') => {
    const apiKeyMap: Record<string, keyof AppSettings> = {
      openai: 'openai_api_key',
      anthropic: 'anthropic_api_key',
      google: 'google_api_key',
      openrouter: 'openrouter_api_key',
    };

    const modelsKeyMap: Record<string, keyof AppSettings> = {
      openai: 'openai_models',
      anthropic: 'anthropic_models',
      google: 'google_models',
      openrouter: 'openrouter_models',
    };

    const apiKey = settings[apiKeyMap[provider]];
    if (!apiKey) {
      setModelErrors(prev => ({ ...prev, [provider]: 'Please enter an API key first' }));
      return;
    }

    setFetchingModels(prev => ({ ...prev, [provider]: true }));
    setModelErrors(prev => ({ ...prev, [provider]: '' }));

    try {
      const result = await window.electronAPI.invoke('ai:fetchModels', provider, apiKey) as FetchModelsResult;

      if (result.success) {
        setSettings(prev => ({
          ...prev,
          [modelsKeyMap[provider]]: result.models
        }));
        setModelErrors(prev => ({ ...prev, [provider]: '' }));
      } else {
        setModelErrors(prev => ({ ...prev, [provider]: result.error || 'Failed to fetch models' }));
      }
    } catch (error) {
      setModelErrors(prev => ({ ...prev, [provider]: (error as Error).message }));
    } finally {
      setFetchingModels(prev => ({ ...prev, [provider]: false }));
    }
  };

  // Handle model selection change
  const handleModelChange = (provider: 'openai' | 'anthropic' | 'google' | 'openrouter', model: string) => {
    const modelKeyMap: Record<string, keyof AppSettings> = {
      openai: 'openai_model',
      anthropic: 'anthropic_model',
      google: 'google_model',
      openrouter: 'openrouter_model',
    };

    setSettings(prev => ({
      ...prev,
      [modelKeyMap[provider]]: model,
      default_model: model, // Also set as default model
    }));
  };

  // Handle custom model input
  const handleCustomModelSubmit = (provider: 'openai' | 'anthropic' | 'google' | 'openrouter') => {
    const customModel = customModelInputs[provider];
    if (customModel && customModel.trim()) {
      handleModelChange(provider, customModel.trim());
      setCustomModelInputs(prev => ({ ...prev, [provider]: '' }));
    }
  };

  const handleSearchNavigate = (kbId: number, sectionId: string) => {
    setStudyKbId(kbId);
    setStudySectionId(sectionId);
    setShowSearch(false);
    setCurrentView('study');
  };

  const getSampleXML = async () => {
    try {
      const xml = await window.electronAPI.invoke('kb:getSample') as string;
      console.log('Sample XML:', xml);
      alert('Sample XML logged to console. Check DevTools!');
    } catch (error) {
      console.error('Failed to get sample XML:', error);
    }
  };

  const importKnowledgeBase = async () => {
    try {
      // Call IPC handler that opens dialog, reads file, and imports
      const result = await window.electronAPI.invoke('kb:importFile') as { success: boolean; kbId?: number; error?: string };

      if (result.success && result.kbId) {
        // Show success notification
        addNotification({
          id: `import-success-${Date.now()}`,
          code: 0,
          severity: 'info',
          title: 'Import Successful',
          message: `Knowledge base imported successfully!`,
          timestamp: new Date(),
          autoDismiss: true,
          dismissAfter: 3000,
        });
        // Reload data
        await loadData();
      } else if (result.error) {
        showError(new Error(result.error), 'Knowledge Base Import');
      }
    } catch (error) {
      showError(error, 'Knowledge Base Import');
    }
  };

  const deleteKnowledgeBase = async () => {
    if (!deleteConfirm || deleteConfirm.confirmText.toLowerCase() !== 'delete') {
      return;
    }

    setIsDeleting(true);
    try {
      await window.electronAPI.invoke('kb:delete', deleteConfirm.kb.id);
      // Reload data
      await loadData();
      setDeleteConfirm(null);
    } catch (error) {
      showError(error, 'Failed to delete knowledge base');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="app loading">
        <div className="loading-spinner"></div>
        <p>Loading FSP's Study Tools...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        {/* Error Notification Container */}
        <ErrorNotificationContainer
          notifications={notifications}
          onDismiss={dismissNotification}
          onAction={handleNotificationAction}
          position="top-right"
        />

        {/* Header */}
        <header className="app-header">
        <div className="header-content">
          <h1>FSP's Study Tools</h1>
          <div className="header-actions">
            <button
              className="header-search-btn"
              onClick={() => setShowSearch(true)}
              title="Search Knowledge Base (Ctrl+K)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              Search
            </button>
          </div>
          <div className="header-meta">
            <span className="version">v{appVersion}</span>
            <span className="status">Development Mode</span>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="app-nav">
        <button
          className={currentView === 'home' ? 'active' : ''}
          onClick={() => setCurrentView('home')}
        >
          [Home]
        </button>
        <button
          className={currentView === 'dashboard' ? 'active' : ''}
          onClick={() => setCurrentView('dashboard')}
        >
          [Dashboard]
        </button>
        <button
          className={currentView === 'analytics' ? 'active' : ''}
          onClick={() => setCurrentView('analytics')}
        >
          [Analytics]
        </button>
        <button
          className={currentView === 'jasper' ? 'active' : ''}
          onClick={() => setCurrentView('jasper')}
        >
          [Jasper AI]
        </button>
        <button
          className={currentView === 'browse' ? 'active' : ''}
          onClick={() => setCurrentView('browse')}
        >
          [Browse KB]
        </button>
        <button
          className={currentView === 'study' ? 'active' : ''}
          onClick={() => setCurrentView('study')}
        >
          [Study]
        </button>
        <button
          className={currentView === 'editor' ? 'active' : ''}
          onClick={() => setCurrentView('editor')}
        >
          [Editor]
        </button>
        <button
          className={currentView === 'settings' ? 'active' : ''}
          onClick={() => setCurrentView('settings')}
        >
          [Settings]
        </button>
      </nav>

      {/* Main Content */}
      <main className="app-main">
        {currentView === 'home' && (
          <div className="view home-view">
            <h2>Welcome to FSP's Study Tools</h2>
            <p className="subtitle">AI-Powered Learning Platform</p>

            <div className="features-grid">
              <div className="feature-card">
                <h3>[Database]</h3>
                <p>SQLite with FTS5 Search</p>
                <span className="status-badge success">Ready</span>
              </div>

              <div className="feature-card">
                <h3>[AI Integration]</h3>
                <p>4 Provider Support</p>
                <span className="status-badge success">Ready</span>
              </div>

              <div className="feature-card">
                <h3>[Knowledge Base]</h3>
                <p>XML Parsing Engine</p>
                <span className="status-badge success">Ready</span>
              </div>

              <div className="feature-card">
                <h3>[UI/UX]</h3>
                <p>React Interface</p>
                <span className="status-badge active">Active</span>
              </div>
            </div>

            <div className="stats-section">
              <h3>Knowledge Bases</h3>
              <div className="stat-item">
                <span className="stat-label">Total:</span>
                <span className="stat-value">{knowledgeBases.length}</span>
              </div>
              {knowledgeBases.length === 0 && (
                <div className="empty-state">
                  <p>No knowledge bases imported yet.</p>
                  <button className="primary-button" onClick={getSampleXML}>
                    Get Sample XML
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === 'browse' && (
          viewingKB ? (
            <KBViewer
              kbId={viewingKB.id}
              kbTitle={viewingKB.title}
              onBack={() => setViewingKB(null)}
            />
          ) : (
            <div className="view browse-view">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0 }}>Knowledge Base Library</h2>
                <button className="primary-button" onClick={importKnowledgeBase}>
                  Import XML
                </button>
              </div>
              {knowledgeBases.length === 0 ? (
                <div className="empty-state">
                  <p>No knowledge bases available.</p>
                  <p>Import an XML file to get started.</p>
                  <button className="primary-button" onClick={getSampleXML}>
                    View Sample XML Format
                  </button>
                </div>
              ) : (
                <div className="kb-list">
                  {knowledgeBases.map(kb => (
                    <div
                      key={kb.id}
                      className="kb-card"
                      onClick={() => setViewingKB({ id: kb.id, title: kb.title })}
                    >
                      <button
                        className="kb-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm({ kb, confirmText: '' });
                        }}
                        title="Delete Knowledge Base"
                      >
                        X
                      </button>
                      <h3>{kb.title}</h3>
                      <div className="kb-meta">
                        <span>ID: {kb.id}</span>
                        <span>Created: {new Date(kb.created_at).toLocaleDateString()}</span>
                      </div>
                      {kb.metadata && (
                        <div className="kb-stats">
                          {kb.metadata.totalModules && (
                            <span>{kb.metadata.totalModules as number} modules</span>
                          )}
                          {kb.metadata.totalChapters && (
                            <span>{kb.metadata.totalChapters as number} chapters</span>
                          )}
                          {kb.metadata.totalSections && (
                            <span>{kb.metadata.totalSections as number} sections</span>
                          )}
                        </div>
                      )}
                      <p className="kb-card-hint">Click to read and study</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {currentView === 'dashboard' && (
          <Dashboard onNavigateToStudy={() => setCurrentView('study')} />
        )}

        {currentView === 'analytics' && (
          <AnalyticsDashboard
            onNavigateToStudy={(kbId?: number, sectionId?: string) => {
              if (kbId) setStudyKbId(kbId);
              if (sectionId) setStudySectionId(sectionId);
              setCurrentView('study');
            }}
            onNavigateToSettings={() => setCurrentView('settings')}
          />
        )}

        {currentView === 'jasper' && (
          <JasperChat
            knowledgeBases={jasperKBs}
            onNavigateToSource={(kbId: number, sectionId: string) => {
              setStudyKbId(kbId);
              setStudySectionId(sectionId);
              setCurrentView('study');
            }}
            onToggleKnowledgeBase={(kbId: number, enabled: boolean) => {
              setJasperKBs(prev =>
                prev.map(kb =>
                  kb.id === kbId ? { ...kb, enabled } : kb
                )
              );
            }}
            voiceConfig={(() => {
              const selectedProfile = settings.voice_profiles?.find(
                p => p.id === settings.selected_voice_profile
              );
              const isCustomVoice = selectedProfile?.type === 'custom' &&
                                    selectedProfile?.trainingStatus === 'ready' &&
                                    selectedProfile?.openvoiceProfileId;
              return {
                selectedVoiceName: selectedProfile?.systemVoice || settings.default_system_voice,
                rate: settings.voice_speed ?? 1.0,
                pitch: settings.voice_pitch ?? 1.0,
                volume: (settings.voice_volume ?? 0.8) * 100,
                useOpenVoice: isCustomVoice ? true : false,
                openVoiceProfileId: isCustomVoice ? selectedProfile?.openvoiceProfileId : undefined,
              };
            })()}
          />
        )}

        {currentView === 'study' && (
          <StudySession
            onExit={() => {
              setCurrentView('home');
              setStudyKbId(null);
              setStudySectionId(null);
            }}
            initialKbId={studyKbId}
            initialSectionId={studySectionId}
            onNavigateToSettings={() => setCurrentView('settings')}
          />
        )}

        {currentView === 'editor' && (
          <div className="view editor-view">
            <KBEditor
              onSave={async (data) => {
                try {
                  console.log('[App.tsx] KBEditor onSave called');
                  console.log('[App.tsx] KBData:', JSON.stringify(data, null, 2));
                  console.log('[App.tsx] Module count:', data.modules?.length || 0);

                  // Generate UUID for new KB
                  const uuid = crypto.randomUUID();

                  // Convert KBData to XML format
                  const xmlContent = convertKBDataToXML(data, uuid);
                  console.log('[App.tsx] Generated XML length:', xmlContent.length);
                  console.log('[App.tsx] Generated XML (first 2000 chars):', xmlContent.substring(0, 2000));

                  // Calculate module/chapter/section counts
                  const totalModules = data.modules.length;
                  const totalChapters = data.modules.reduce(
                    (sum, m) => sum + m.chapters.length, 0
                  );
                  const totalSections = data.modules.reduce(
                    (sum, m) => sum + m.chapters.reduce(
                      (cSum, c) => cSum + c.sections.length, 0
                    ), 0
                  );

                  // Build metadata with counts
                  const metadata = {
                    ...data.metadata,
                    totalModules,
                    totalChapters,
                    totalSections,
                  };

                  // Save to database
                  await window.electronAPI.invoke('kb:create', {
                    uuid,
                    title: data.title,
                    xml_content: xmlContent,
                    metadata,
                  });

                  // Refresh the KB list
                  const kbs = await window.electronAPI.invoke('kb:list') as KnowledgeBase[];
                  setKnowledgeBases(kbs);

                  // Return to home view
                  setCurrentView('home');
                } catch (error) {
                  showError(error, 'Failed to save knowledge base');
                }
              }}
              onCancel={() => setCurrentView('home')}
            />
          </div>
        )}

        {currentView === 'settings' && (
          <div className="view settings-view">
            <div className="settings-header">
              <h2>Settings</h2>
              {settingsSaved && (
                <div className="settings-saved-indicator">
                  Settings saved successfully
                </div>
              )}
            </div>

            <div className="settings-section">
              <h3>Appearance</h3>
              <p className="settings-description">
                Customize the look and feel of the application.
              </p>

              <div className="setting-item">
                <label htmlFor="theme-select">
                  Theme
                  <span className="setting-status">
                    {settings.theme === 'auto' ? ' (System)' : settings.theme === 'light' ? ' (Light)' : ' (Dark)'}
                  </span>
                </label>
                <select
                  id="theme-select"
                  value={settings.theme || 'dark'}
                  onChange={(e) => handleSettingChange('theme', e.target.value)}
                  className="theme-select"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="auto">Auto (System)</option>
                </select>
                <span className="setting-hint">
                  Choose your preferred color theme. Auto follows your system settings.
                </span>
              </div>
            </div>

            <div className="settings-section">
              <h3>AI Providers</h3>
              <p className="settings-description">
                Configure AI provider API keys to enable AI-powered tutoring.
                Your API keys are stored securely and never leave your device.
                After entering an API key, click "Fetch Models" to validate and load available models.
              </p>

              {/* Default Provider Selection */}
              <div className="setting-item">
                <label htmlFor="default-provider">
                  Default AI Provider
                </label>
                <select
                  id="default-provider"
                  value={settings.default_ai_provider || ''}
                  onChange={(e) => handleSettingChange('default_ai_provider', e.target.value)}
                  className="provider-select"
                >
                  <option value="">Select a provider...</option>
                  {settings.openai_api_key && <option value="openai">OpenAI</option>}
                  {settings.anthropic_api_key && <option value="anthropic">Anthropic</option>}
                  {settings.google_api_key && <option value="google">Google AI</option>}
                  {settings.openrouter_api_key && <option value="openrouter">OpenRouter</option>}
                </select>
              </div>

              {/* OpenAI */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>OpenAI</h4>
                  <span className={`provider-status ${settings.openai_api_key && (settings.openai_models?.length || 0) > 0 ? 'valid' : settings.openai_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.openai_api_key && (settings.openai_models?.length || 0) > 0 ? '[Valid]' : settings.openai_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="openai-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="openai-key"
                      type="password"
                      placeholder="sk-..."
                      value={settings.openai_api_key || ''}
                      onChange={(e) => handleSettingChange('openai_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('openai')}
                      disabled={!settings.openai_api_key || fetchingModels.openai}
                    >
                      {fetchingModels.openai ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.openai && <span className="setting-error">{modelErrors.openai}</span>}
                  <span className="setting-hint">Get your API key from platform.openai.com</span>
                </div>
                {(settings.openai_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="openai-model">Model</label>
                    <select
                      id="openai-model"
                      value={settings.openai_model || ''}
                      onChange={(e) => handleModelChange('openai', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.openai_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="openai-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="openai-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., gpt-4o)"
                      value={customModelInputs.openai || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, openai: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('openai')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('openai')}
                      disabled={!customModelInputs.openai}
                    >
                      Use
                    </button>
                  </div>
                  {settings.openai_model && <span className="current-model">Current: {settings.openai_model}</span>}
                </div>
              </div>

              {/* Anthropic */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>Anthropic</h4>
                  <span className={`provider-status ${settings.anthropic_api_key && (settings.anthropic_models?.length || 0) > 0 ? 'valid' : settings.anthropic_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.anthropic_api_key && (settings.anthropic_models?.length || 0) > 0 ? '[Valid]' : settings.anthropic_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="anthropic-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="anthropic-key"
                      type="password"
                      placeholder="sk-ant-..."
                      value={settings.anthropic_api_key || ''}
                      onChange={(e) => handleSettingChange('anthropic_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('anthropic')}
                      disabled={!settings.anthropic_api_key || fetchingModels.anthropic}
                    >
                      {fetchingModels.anthropic ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.anthropic && <span className="setting-error">{modelErrors.anthropic}</span>}
                  <span className="setting-hint">Get your API key from console.anthropic.com</span>
                </div>
                {(settings.anthropic_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="anthropic-model">Model</label>
                    <select
                      id="anthropic-model"
                      value={settings.anthropic_model || ''}
                      onChange={(e) => handleModelChange('anthropic', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.anthropic_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="anthropic-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="anthropic-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., claude-3-5-sonnet-20241022)"
                      value={customModelInputs.anthropic || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, anthropic: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('anthropic')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('anthropic')}
                      disabled={!customModelInputs.anthropic}
                    >
                      Use
                    </button>
                  </div>
                  {settings.anthropic_model && <span className="current-model">Current: {settings.anthropic_model}</span>}
                </div>
              </div>

              {/* Google AI */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>Google AI</h4>
                  <span className={`provider-status ${settings.google_api_key && (settings.google_models?.length || 0) > 0 ? 'valid' : settings.google_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.google_api_key && (settings.google_models?.length || 0) > 0 ? '[Valid]' : settings.google_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="google-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="google-key"
                      type="password"
                      placeholder="AIza..."
                      value={settings.google_api_key || ''}
                      onChange={(e) => handleSettingChange('google_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('google')}
                      disabled={!settings.google_api_key || fetchingModels.google}
                    >
                      {fetchingModels.google ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.google && <span className="setting-error">{modelErrors.google}</span>}
                  <span className="setting-hint">Get your API key from makersuite.google.com</span>
                </div>
                {(settings.google_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="google-model">Model</label>
                    <select
                      id="google-model"
                      value={settings.google_model || ''}
                      onChange={(e) => handleModelChange('google', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.google_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="google-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="google-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., gemini-1.5-pro)"
                      value={customModelInputs.google || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, google: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('google')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('google')}
                      disabled={!customModelInputs.google}
                    >
                      Use
                    </button>
                  </div>
                  {settings.google_model && <span className="current-model">Current: {settings.google_model}</span>}
                </div>
              </div>

              {/* OpenRouter */}
              <div className="ai-provider-card">
                <div className="provider-header">
                  <h4>OpenRouter</h4>
                  <span className={`provider-status ${settings.openrouter_api_key && (settings.openrouter_models?.length || 0) > 0 ? 'valid' : settings.openrouter_api_key ? 'pending' : 'unconfigured'}`}>
                    {settings.openrouter_api_key && (settings.openrouter_models?.length || 0) > 0 ? '[Valid]' : settings.openrouter_api_key ? '[Key Set]' : '[Not Configured]'}
                  </span>
                </div>
                <div className="setting-item">
                  <label htmlFor="openrouter-key">API Key</label>
                  <div className="api-key-row">
                    <input
                      id="openrouter-key"
                      type="password"
                      placeholder="sk-or-..."
                      value={settings.openrouter_api_key || ''}
                      onChange={(e) => handleSettingChange('openrouter_api_key', e.target.value)}
                    />
                    <button
                      className="fetch-models-btn"
                      onClick={() => fetchModelsForProvider('openrouter')}
                      disabled={!settings.openrouter_api_key || fetchingModels.openrouter}
                    >
                      {fetchingModels.openrouter ? 'Fetching...' : 'Fetch Models'}
                    </button>
                  </div>
                  {modelErrors.openrouter && <span className="setting-error">{modelErrors.openrouter}</span>}
                  <span className="setting-hint">Get your API key from openrouter.ai</span>
                </div>
                {(settings.openrouter_models?.length || 0) > 0 && (
                  <div className="setting-item">
                    <label htmlFor="openrouter-model">Model</label>
                    <select
                      id="openrouter-model"
                      value={settings.openrouter_model || ''}
                      onChange={(e) => handleModelChange('openrouter', e.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {settings.openrouter_models?.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="setting-item">
                  <label htmlFor="openrouter-custom">Custom Model Name</label>
                  <div className="custom-model-row">
                    <input
                      id="openrouter-custom"
                      type="text"
                      placeholder="Enter custom model name (e.g., openai/gpt-4)"
                      value={customModelInputs.openrouter || ''}
                      onChange={(e) => setCustomModelInputs(prev => ({ ...prev, openrouter: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSubmit('openrouter')}
                    />
                    <button
                      className="use-model-btn"
                      onClick={() => handleCustomModelSubmit('openrouter')}
                      disabled={!customModelInputs.openrouter}
                    >
                      Use
                    </button>
                  </div>
                  {settings.openrouter_model && <span className="current-model">Current: {settings.openrouter_model}</span>}
                </div>
              </div>
            </div>

            {/* AI Settings */}
            <div className="settings-section">
              <h3>AI Settings</h3>
              <div className="setting-item">
                <label htmlFor="temperature">
                  Temperature
                  <span className="setting-value">{settings.temperature ?? 0.7}</span>
                </label>
                <input
                  id="temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.temperature ?? 0.7}
                  onChange={(e) => handleSettingChange('temperature', parseFloat(e.target.value))}
                />
                <span className="setting-hint">Lower = more focused, Higher = more creative (0-2)</span>
              </div>
              <div className="setting-item">
                <label htmlFor="max-tokens">Max Tokens</label>
                <input
                  id="max-tokens"
                  type="number"
                  min="100"
                  max="8000"
                  step="100"
                  value={settings.max_tokens ?? 2000}
                  onChange={(e) => handleSettingChange('max_tokens', parseInt(e.target.value))}
                />
                <span className="setting-hint">Maximum response length (100-8000)</span>
              </div>
            </div>

            {/* Voice Settings */}
            <div className="settings-section">
              <h3>Voice Settings (Jasper)</h3>
              <p className="settings-description">
                Configure Jasper's text-to-speech voice and create custom voice profiles.
              </p>

              {/* Voice Enable/Disable */}
              <div className="setting-item">
                <label htmlFor="voice-enabled" className="checkbox-label">
                  <input
                    id="voice-enabled"
                    type="checkbox"
                    checked={settings.voice_enabled ?? true}
                    onChange={(e) => handleSettingChange('voice_enabled', e.target.checked)}
                  />
                  <span>Enable Voice Output</span>
                </label>
                <span className="setting-hint">Allow Jasper to read responses aloud</span>
              </div>

              <div className="setting-item">
                <label htmlFor="voice-auto-read" className="checkbox-label">
                  <input
                    id="voice-auto-read"
                    type="checkbox"
                    checked={settings.voice_auto_read ?? false}
                    onChange={(e) => handleSettingChange('voice_auto_read', e.target.checked)}
                  />
                  <span>Auto-Read Responses</span>
                </label>
                <span className="setting-hint">Automatically read AI responses when received</span>
              </div>

              <div className="setting-item">
                <label htmlFor="voice-highlight-sync" className="checkbox-label">
                  <input
                    id="voice-highlight-sync"
                    type="checkbox"
                    checked={settings.voice_highlight_sync ?? true}
                    onChange={(e) => handleSettingChange('voice_highlight_sync', e.target.checked)}
                  />
                  <span>Sync Text Highlighting</span>
                </label>
                <span className="setting-hint">Highlight words as they are spoken</span>
              </div>

              {/* Voice Type Selector */}
              <div className="setting-item">
                <label>Active Voice Type</label>
                <div className="voice-type-selector">
                  <button
                    className={`voice-type-btn ${(settings.voice_type ?? 'system') === 'system' ? 'active' : ''}`}
                    onClick={() => handleSettingChange('voice_type', 'system')}
                  >
                    System Voice
                  </button>
                  <button
                    className={`voice-type-btn ${settings.voice_type === 'custom' ? 'active' : ''}`}
                    onClick={() => handleSettingChange('voice_type', 'custom')}
                    disabled={!settings.voice_profiles?.some(p => p.type === 'custom')}
                    title={!settings.voice_profiles?.some(p => p.type === 'custom') ? 'No custom voice profiles created yet' :
                           !settings.voice_profiles?.some(p => p.type === 'custom' && p.trainingStatus === 'ready') ? 'Custom profiles are still training' : ''}
                  >
                    Custom Voice
                  </button>
                </div>
                <span className="setting-hint">
                  {settings.voice_type === 'custom'
                    ? 'Using custom OpenVoice voice cloning'
                    : 'Using system text-to-speech voice'}
                </span>
              </div>

              {/* Default Voice Selector - Quick selection without profiles */}
              <div className="setting-item">
                <label htmlFor="default-voice">Default System Voice</label>
                <div className="voice-selector-row">
                  <select
                    id="default-voice"
                    value={settings.default_system_voice || ''}
                    onChange={(e) => handleSettingChange('default_system_voice', e.target.value)}
                  >
                    <option value="">Browser Default</option>
                    {systemVoices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                  {settings.default_system_voice && (
                    <button
                      className="preview-voice-btn"
                      onClick={() => previewVoice(settings.default_system_voice || '')}
                      title="Preview voice"
                    >
                      {previewingVoice ? 'Stop' : 'Preview'}
                    </button>
                  )}
                </div>
                <span className="setting-hint">
                  {systemVoices.length} voices available. Select a voice to use for TTS.
                </span>
              </div>

              {/* Voice Profiles */}
              <div className="setting-item voice-profiles-section">
                <div className="voice-profiles-header">
                  <label>Voice Profiles</label>
                  <button
                    className="add-profile-btn"
                    onClick={() => {
                      setShowVoiceProfileModal(true);
                      setVoiceModalTab('system');
                      setNewProfileName('');
                      setSelectedModalVoice('');
                    }}
                  >
                    + New Profile
                  </button>
                </div>
                <span className="setting-hint profiles-hint">
                  Create named profiles to quickly switch between different voice configurations.
                </span>

                {(settings.voice_profiles?.length || 0) === 0 ? (
                  <div className="no-profiles-message">
                    <p>No voice profiles created yet.</p>
                  </div>
                ) : (
                  <div className="voice-profiles-list">
                    {settings.voice_profiles?.map((profile) => (
                      <div
                        key={profile.id}
                        className={`voice-profile-item ${settings.selected_voice_profile === profile.id ? 'selected' : ''}`}
                      >
                        <div
                          className="voice-profile-info"
                          onClick={() => handleSettingChange('selected_voice_profile', profile.id)}
                        >
                          <span className="profile-name">{profile.name}</span>
                          <span className="profile-type">
                            {profile.type === 'system' ? (
                              <span className="system-badge">System: {profile.systemVoice?.split(' ')[0] || 'Default'}</span>
                            ) : (
                              <span className={`custom-badge ${profile.trainingStatus}`}>
                                Custom {profile.trainingStatus === 'ready' ? '(Ready)' :
                                       profile.trainingStatus === 'training' ? `(Training ${profile.trainingProgress || 0}%)` :
                                       profile.trainingStatus === 'failed' ? '(Failed)' : '(Pending)'}
                                {profile.trainingSamples && profile.trainingSamples.length > 0 && (
                                  <span className="sample-count"> - {profile.trainingSamples.length} sample{profile.trainingSamples.length !== 1 ? 's' : ''}</span>
                                )}
                              </span>
                            )}
                          </span>
                          {profile.trainingError && (
                            <span className="training-error" title={profile.trainingError}>
                              Error: {profile.trainingError.substring(0, 50)}{profile.trainingError.length > 50 ? '...' : ''}
                            </span>
                          )}
                        </div>
                        <div className="voice-profile-actions">
                          {profile.type === 'system' && profile.systemVoice && (
                            <button
                              className="preview-profile-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                previewVoice(profile.systemVoice || '');
                              }}
                              title="Preview this voice"
                            >
                              {previewingVoice ? 'Stop' : 'Play'}
                            </button>
                          )}
                          {profile.type === 'custom' && profile.trainingStatus === 'failed' && profile.openvoiceProfileId && (
                            <button
                              className="retry-training-btn"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (profile.openvoiceProfileId) {
                                  await openVoice.trainProfile(profile.openvoiceProfileId);
                                }
                              }}
                              title="Retry training"
                              disabled={openVoice.isLoading}
                            >
                              Retry
                            </button>
                          )}
                          <button
                            className="edit-profile-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingVoiceProfile(profile);
                            }}
                            title="Edit profile"
                          >
                            Edit
                          </button>
                          <button
                            className="delete-profile-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteVoiceProfile(profile.id);
                            }}
                            title="Delete profile"
                          >
                            x
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Voice Parameters */}
              <div className="setting-item">
                <label htmlFor="voice-speed">
                  Speed
                  <span className="setting-value">{(settings.voice_speed ?? 1.0).toFixed(1)}x</span>
                </label>
                <input
                  id="voice-speed"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.voice_speed ?? 1.0}
                  onChange={(e) => handleSettingChange('voice_speed', parseFloat(e.target.value))}
                />
                <span className="setting-hint">Speaking rate (0.5x - 2x)</span>
              </div>

              <div className="setting-item">
                <label htmlFor="voice-pitch">
                  Pitch
                  <span className="setting-value">{(settings.voice_pitch ?? 1.0).toFixed(1)}</span>
                </label>
                <input
                  id="voice-pitch"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.voice_pitch ?? 1.0}
                  onChange={(e) => handleSettingChange('voice_pitch', parseFloat(e.target.value))}
                />
                <span className="setting-hint">Voice pitch (0.5 - 2.0)</span>
              </div>

              <div className="setting-item">
                <label htmlFor="voice-volume">
                  Volume
                  <span className={`setting-value ${(settings.voice_volume ?? 1.0) > 1.0 ? 'volume-warning' : ''}`}>
                    {Math.round((settings.voice_volume ?? 1.0) * 100)}%
                  </span>
                </label>
                <input
                  id="voice-volume"
                  type="range"
                  min="0"
                  max="3"
                  step="0.1"
                  value={settings.voice_volume ?? 1.0}
                  onChange={(e) => handleSettingChange('voice_volume', parseFloat(e.target.value))}
                  className={(settings.voice_volume ?? 1.0) > 1.0 ? 'volume-high' : ''}
                />
                <span className={`setting-hint ${(settings.voice_volume ?? 1.0) > 1.0 ? 'volume-warning-text' : ''}`}>
                  {(settings.voice_volume ?? 1.0) > 1.0
                    ? '[WARNING] High volume may cause hearing damage!'
                    : 'Volume level (0-300%)'}
                </span>
              </div>

              {/* Test Voice Button */}
              <div className="setting-item">
                <button
                  className={`test-voice-btn ${testingVoice ? 'testing' : ''}`}
                  onClick={testVoice}
                >
                  {testingVoice ? 'Stop Test' : 'Test Voice'}
                </button>
                <span className="setting-hint">
                  Preview the current voice settings
                </span>
              </div>

              {/* OpenVoice Training Section (placeholder) */}
              <div className="voice-training-section">
                <h4>Custom Voice Training (OpenVoice)</h4>
                <p className="settings-description">
                  Train a custom voice using your own audio samples. This feature uses OpenVoice
                  for high-quality voice cloning.
                </p>

                {/* OpenVoice Service Status */}
                <div className="setting-item openvoice-status">
                  <label>OpenVoice Service Status</label>
                  <div className="status-row">
                    <span className={`status-indicator ${openVoice.status.running ? 'running' : 'stopped'}`}>
                      {openVoice.status.running ? 'Running' : 'Stopped'}
                    </span>
                    {openVoice.status.running && (
                      <>
                        <span className="status-detail">
                          Device: {openVoice.status.device}
                        </span>
                        {openVoice.status.initialized && (
                          <span className="status-detail initialized">Models Loaded</span>
                        )}
                      </>
                    )}
                    {openVoice.isLoading && (
                      <span className="status-loading">Loading...</span>
                    )}
                  </div>
                  {openVoice.error && (
                    <div className="status-error">{openVoice.error}</div>
                  )}
                  <div className="service-controls">
                    {!openVoice.status.running ? (
                      <button
                        className="start-service-btn"
                        onClick={async () => {
                          const success = await openVoice.startService();
                          if (success && !openVoice.status.initialized) {
                            await openVoice.initializeModels();
                          }
                        }}
                        disabled={openVoice.isLoading}
                      >
                        Start OpenVoice Service
                      </button>
                    ) : (
                      <>
                        {!openVoice.status.initialized && (
                          <button
                            className="init-models-btn"
                            onClick={() => openVoice.initializeModels()}
                            disabled={openVoice.isLoading}
                          >
                            Initialize Models
                          </button>
                        )}
                        <button
                          className="stop-service-btn"
                          onClick={() => openVoice.stopService()}
                          disabled={openVoice.isLoading}
                        >
                          Stop Service
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="setting-item">
                  <button
                    className="select-audio-btn"
                    onClick={selectAudioForTraining}
                  >
                    Select Audio Sample
                  </button>
                  {selectedAudioFile && (
                    <span className="selected-file">
                      Selected: {selectedAudioFile.split(/[\\/]/).pop()}
                    </span>
                  )}
                </div>
                <div className="setting-item">
                  <button
                    className="train-voice-btn"
                    disabled={!selectedAudioFile || openVoice.isLoading}
                    onClick={async () => {
                      if (!selectedAudioFile) return;

                      // Create a quick profile with the selected audio
                      const profileName = `Voice ${new Date().toLocaleDateString()}`;
                      await createVoiceProfile(profileName, '', true, selectedAudioFile, undefined);
                      setSelectedAudioFile(null);
                    }}
                  >
                    {openVoice.isLoading ? 'Processing...' : 'Create & Train Voice'}
                  </button>
                  <span className="setting-hint">
                    Provide a clear audio sample (10-30 seconds) for best results
                  </span>
                </div>
              </div>
            </div>

            <div className="settings-actions">
              <button className="primary-button" onClick={saveSettings}>
                Save Settings
              </button>
            </div>

            {/* Voice Profile Creation Modal */}
            {showVoiceProfileModal && (
              <div className="modal-overlay" onClick={() => setShowVoiceProfileModal(false)}>
                <div className="modal voice-profile-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Create Voice Profile</h3>
                    <button className="modal-close" onClick={() => setShowVoiceProfileModal(false)}>x</button>
                  </div>

                  {/* Tab Navigation */}
                  <div className="modal-tabs">
                    <button
                      className={`modal-tab ${voiceModalTab === 'system' ? 'active' : ''}`}
                      onClick={() => setVoiceModalTab('system')}
                    >
                      System Voice
                    </button>
                    <button
                      className={`modal-tab ${voiceModalTab === 'custom' ? 'active' : ''}`}
                      onClick={() => setVoiceModalTab('custom')}
                    >
                      Custom Voice (Clone)
                    </button>
                  </div>

                  <div className="modal-content">
                    {/* Common: Profile Name */}
                    <div className="form-group">
                      <label htmlFor="profile-name">Profile Name</label>
                      <input
                        id="profile-name"
                        type="text"
                        placeholder={voiceModalTab === 'system' ? "e.g., Professional, Casual" : "e.g., My Voice, Dad's Voice"}
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.target.value)}
                      />
                    </div>

                    {/* System Voice Tab Content */}
                    {voiceModalTab === 'system' && (
                      <>
                        <div className="form-group">
                          <label htmlFor="system-voice">Select System Voice</label>
                          <div className="voice-select-row">
                            <select
                              id="system-voice"
                              value={selectedModalVoice}
                              onChange={(e) => setSelectedModalVoice(e.target.value)}
                            >
                              <option value="">Select a voice...</option>
                              {systemVoices.map((voice) => (
                                <option key={voice.name} value={voice.name}>
                                  {voice.name} ({voice.lang})
                                </option>
                              ))}
                            </select>
                            {selectedModalVoice && (
                              <button
                                className="preview-btn-small"
                                onClick={() => previewVoice(selectedModalVoice)}
                              >
                                {previewingVoice ? 'Stop' : 'Preview'}
                              </button>
                            )}
                          </div>
                          <span className="form-hint">{systemVoices.length} voices available on your system</span>
                        </div>
                      </>
                    )}

                    {/* Custom Voice Tab Content */}
                    {voiceModalTab === 'custom' && (
                      <>
                        {/* Recording Mode Selection */}
                        <div className="form-group">
                          <label>Choose Input Method</label>
                          <div className="recording-options">
                            <div
                              className={`recording-option ${recordingMode === 'free' ? 'selected' : ''}`}
                              onClick={() => setRecordingMode('free')}
                            >
                              <div className="recording-option-title">Free Recording</div>
                              <div className="recording-option-desc">Record anything you want</div>
                            </div>
                            <div
                              className={`recording-option ${recordingMode === 'script' ? 'selected' : ''}`}
                              onClick={() => setRecordingMode('script')}
                            >
                              <div className="recording-option-title">Guided Scripts</div>
                              <div className="recording-option-desc">Read provided scripts</div>
                            </div>
                          </div>
                        </div>

                        {/* Upload Existing Audio Option */}
                        <div className="form-group">
                          <label>Or Upload Existing Audio</label>
                          <div className="audio-upload-section">
                            <button
                              className="select-audio-btn"
                              onClick={selectAudioForTraining}
                            >
                              Select Audio File
                            </button>
                            {selectedAudioFile && (
                              <span className="selected-file">
                                {selectedAudioFile.split(/[\\/]/).pop()}
                              </span>
                            )}
                          </div>
                          <span className="form-hint">
                            Supported formats: MP3, WAV, OGG, M4A, FLAC
                          </span>
                        </div>

                        {/* Script Selection (if script mode) */}
                        {recordingMode === 'script' && (
                          <div className="training-scripts">
                            <div className="training-scripts-header">
                              <label>Training Scripts</label>
                              <span className="form-hint">Select a script and read it aloud</span>
                            </div>
                            {trainingScripts.map((script) => {
                              const isRecorded = recordedSamples.some(s => s.name === script.title);
                              return (
                                <div
                                  key={script.id}
                                  className={`script-item ${selectedScript === script.id ? 'selected' : ''} ${isRecorded ? 'recorded' : ''}`}
                                  onClick={() => setSelectedScript(script.id)}
                                >
                                  <div className="script-header">
                                    <span className="script-title">{script.title}</span>
                                    <span className={`script-status ${isRecorded ? 'recorded' : 'pending'}`}>
                                      {isRecorded ? 'Recorded' : 'Pending'}
                                    </span>
                                  </div>
                                  <div className="script-text">"{script.text}"</div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Recording Controls */}
                        <div className="voice-recording-section">
                          <div className="recording-controls">
                            {!isRecording ? (
                              <button
                                className="record-btn ready"
                                onClick={startRecording}
                                disabled={recordingMode === 'script' && selectedScript === null}
                              >
                                Start Recording
                              </button>
                            ) : (
                              <>
                                <div className="recording-indicator">
                                  <span className="recording-dot"></span>
                                  Recording: {formatTime(recordingTime)}
                                </div>
                                <button
                                  className="record-btn recording"
                                  onClick={stopRecording}
                                >
                                  Stop Recording
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Recorded Samples List */}
                        {recordedSamples.length > 0 && (
                          <div className="recorded-samples">
                            <h5>Recorded Samples ({recordedSamples.length})</h5>
                            {recordedSamples.map((sample) => (
                              <div key={sample.id} className="sample-item">
                                <div className="sample-info">
                                  <span className="sample-name">{sample.name}</span>
                                  <span className="sample-duration">{formatTime(sample.duration)}</span>
                                </div>
                                <div className="sample-actions">
                                  <button onClick={() => playRecordedSample(sample.blob)}>Play</button>
                                  <button className="delete" onClick={() => deleteRecordedSample(sample.id)}>Delete</button>
                                </div>
                              </div>
                            ))}
                            <span className="form-hint">
                              More samples = better voice quality. Aim for 3-5 recordings for best results.
                            </span>
                          </div>
                        )}

                        <div className="custom-voice-info">
                          <p className="info-title">Tips for Best Results:</p>
                          <ul>
                            <li>Use a quiet environment with minimal background noise</li>
                            <li>Speak clearly at a consistent volume and pace</li>
                            <li>Record multiple samples (10-30 seconds each) for better quality</li>
                            <li>You can add more samples later to refine the voice</li>
                          </ul>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="modal-actions">
                    <button className="secondary-button" onClick={() => {
                      setShowVoiceProfileModal(false);
                      setNewProfileName('');
                      setSelectedModalVoice('');
                      setSelectedAudioFile(null);
                      setRecordedSamples([]);
                      setSelectedScript(null);
                      setRecordingMode('free');
                    }}>
                      Cancel
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        !newProfileName.trim() ||
                        (voiceModalTab === 'system' && !selectedModalVoice) ||
                        (voiceModalTab === 'custom' && !selectedAudioFile && recordedSamples.length === 0)
                      }
                      onClick={async () => {
                        console.log('[DEBUG] Modal Create button clicked - voiceModalTab:', voiceModalTab);
                        console.log('[DEBUG] Modal state - selectedAudioFile:', selectedAudioFile, 'recordedSamples.length:', recordedSamples.length);

                        if (voiceModalTab === 'system') {
                          await createVoiceProfile(newProfileName, selectedModalVoice, false);
                        } else {
                          // Validate we have audio before creating custom profile
                          if (!selectedAudioFile && recordedSamples.length === 0) {
                            console.error('[DEBUG] Cannot create custom profile without audio!');
                            return;
                          }

                          // For custom voices, save recorded samples and/or uploaded file
                          console.log('[DEBUG] Creating custom profile with audioPath:', selectedAudioFile);
                          await createVoiceProfile(
                            newProfileName,
                            '',
                            true,
                            selectedAudioFile || undefined,
                            recordedSamples.length > 0 ? recordedSamples : undefined
                          );
                          // Reset recording state after profile creation
                          setRecordedSamples([]);
                          setSelectedScript(null);
                          setRecordingMode('free');
                        }
                      }}
                    >
                      {voiceModalTab === 'custom' ? 'Create & Start Training' : 'Create Profile'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Voice Profile Editor Modal */}
            {editingVoiceProfile && (
              <VoiceProfileEditor
                profile={editingVoiceProfile}
                onClose={() => setEditingVoiceProfile(null)}
                onSave={async (updatedProfile, needsRetraining) => {
                  // Update the profile in settings
                  const updatedProfiles = settings.voice_profiles?.map(p =>
                    p.id === updatedProfile.id ? updatedProfile : p
                  ) || [];
                  await handleSettingChange('voice_profiles', updatedProfiles);

                  // Trigger retraining if samples changed and it's a custom profile
                  if (needsRetraining && updatedProfile.type === 'custom' && updatedProfile.openvoiceProfileId) {
                    // First update the backend profile's audio samples
                    const audioSamples = updatedProfile.audioSamples || [];
                    if (audioSamples.length > 0) {
                      const result = await openVoice.updateProfileSamples(
                        updatedProfile.openvoiceProfileId,
                        audioSamples
                      );
                      if (result) {
                        // Now train with the updated samples
                        await openVoice.trainProfile(updatedProfile.openvoiceProfileId);
                        // Refresh profiles to get updated training status
                        await openVoice.refreshProfiles();
                      } else {
                        console.error('Failed to update profile samples in backend');
                      }
                    }
                  }
                }}
                onRetrain={async (profileId) => {
                  await openVoice.trainProfile(profileId);
                }}
                systemVoices={systemVoices}
                isLoading={openVoice.isLoading}
              />
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>FSP's Study Tools - AI-Powered Learning</p>
        <p className="footer-meta">
          Phase 5: UI/UX Development | Database + AI + Knowledge Base Engine Complete
        </p>
      </footer>

      {/* Search Modal */}
      {showSearch && (
        <div className="search-modal-overlay" onClick={() => setShowSearch(false)}>
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <SearchResults
              onNavigateToSection={handleSearchNavigate}
              onClose={() => setShowSearch(false)}
            />
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="delete-modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Knowledge Base</h3>
            <p className="delete-warning">
              You are about to permanently delete:
            </p>
            <p className="delete-kb-name">"{deleteConfirm.kb.title}"</p>
            <p className="delete-instruction">
              This action cannot be undone. All associated progress, highlights, and test results will be deleted.
            </p>
            <p className="delete-confirm-instruction">
              Type <strong>delete</strong> to confirm:
            </p>
            <input
              type="text"
              className="delete-confirm-input"
              value={deleteConfirm.confirmText}
              onChange={(e) => setDeleteConfirm({ ...deleteConfirm, confirmText: e.target.value })}
              placeholder="Type 'delete' to confirm"
              autoFocus
            />
            <div className="delete-modal-actions">
              <button
                className="cancel-button"
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="delete-button"
                onClick={deleteKnowledgeBase}
                disabled={deleteConfirm.confirmText.toLowerCase() !== 'delete' || isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Now'}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* Update Notification */}
        <UpdateNotification />
      </div>
    </ErrorBoundary>
  );
}

export default App;
