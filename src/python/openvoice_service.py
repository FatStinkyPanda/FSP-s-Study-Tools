"""
OpenVoice Service - Voice Cloning and TTS Backend for FSP Study Tools

This service provides a REST API for:
- Voice training (extracting speaker embeddings from audio samples)
- Text-to-speech synthesis with voice cloning
- Voice model management
"""

import os
import sys

# Add bundled OpenVoice and MeloTTS to Python path
_base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_openvoice_src = os.path.join(_base_dir, 'openvoice_src')
_melo_src = os.path.join(_base_dir, 'melo_src')
_ffmpeg_bin = os.path.join(_base_dir, 'ffmpeg_bin')
if os.path.exists(_openvoice_src):
    sys.path.insert(0, _openvoice_src)
if os.path.exists(_melo_src):
    sys.path.insert(0, _melo_src)
if os.path.exists(_ffmpeg_bin):
    os.environ['PATH'] = _ffmpeg_bin + os.pathsep + os.environ.get('PATH', '')

import json
import uuid
import shutil
import logging
import threading
import traceback
import warnings
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, asdict
from enum import Enum

# Suppress FutureWarning for torch.load weights_only parameter
# These warnings are for models we trust (our own checkpoints)
warnings.filterwarnings('ignore', category=FutureWarning, message='.*torch.load.*weights_only.*')
warnings.filterwarnings('ignore', category=FutureWarning, message='.*torch.nn.utils.weight_norm.*')
warnings.filterwarnings('ignore', category=UserWarning, message='.*stft with return_complex=False.*')

# Flask imports
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# Audio processing
import numpy as np

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('OpenVoiceService')


def sanitize_text_for_tts(text: str) -> str:
    """
    Remove emojis and other non-ASCII characters that can't be handled by TTS.
    MeloTTS library has issues with Windows cp1252 encoding when printing text
    containing emojis, causing UnicodeEncodeError.
    """
    # Remove emojis and other Unicode characters outside basic multilingual plane
    # This regex removes most emojis and special symbols
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F700-\U0001F77F"  # alchemical symbols
        "\U0001F780-\U0001F7FF"  # Geometric Shapes Extended
        "\U0001F800-\U0001F8FF"  # Supplemental Arrows-C
        "\U0001F900-\U0001F9FF"  # Supplemental Symbols and Pictographs
        "\U0001FA00-\U0001FA6F"  # Chess Symbols
        "\U0001FA70-\U0001FAFF"  # Symbols and Pictographs Extended-A
        "\U00002702-\U000027B0"  # Dingbats
        "\U000024C2-\U0001F251"
        "]+",
        flags=re.UNICODE
    )

    # Replace emojis with empty string
    cleaned = emoji_pattern.sub('', text)

    # Also try to encode to cp1252 and replace any remaining problematic chars
    try:
        # Test if the string can be encoded in cp1252 (Windows default)
        cleaned.encode('cp1252')
    except UnicodeEncodeError:
        # Replace any remaining non-cp1252 characters with spaces
        cleaned = cleaned.encode('cp1252', errors='replace').decode('cp1252')

    return cleaned

# Global state
app = Flask(__name__)
CORS(app)

# Configuration
class Config:
    """Service configuration"""
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent.parent
        self.data_dir = self.base_dir / 'data' / 'voice'
        self.models_dir = self.data_dir / 'models'
        self.profiles_dir = self.data_dir / 'profiles'
        self.output_dir = self.data_dir / 'output'
        self.checkpoints_dir = self.base_dir / 'openvoice_checkpoints'

        # Ensure directories exist
        for d in [self.data_dir, self.models_dir, self.profiles_dir, self.output_dir]:
            d.mkdir(parents=True, exist_ok=True)

        # Device configuration
        self.device = 'cuda:0' if self._cuda_available() else 'cpu'
        logger.info(f"Using device: {self.device}")

    def _cuda_available(self) -> bool:
        try:
            import torch
            return torch.cuda.is_available()
        except:
            return False

config = Config()

# Voice model state
class VoiceModelState(Enum):
    PENDING = 'pending'
    EXTRACTING = 'extracting'
    READY = 'ready'
    FAILED = 'failed'

@dataclass
class VoiceModel:
    """Voice model metadata"""
    id: str
    name: str
    state: str
    created_at: str
    audio_samples: List[str]
    embedding_path: Optional[str] = None
    error: Optional[str] = None
    progress: int = 0

# Global model cache
class ModelCache:
    """Lazy-loaded model cache"""
    def __init__(self):
        self._tone_converter = None
        self._tts_models = {}
        self._lock = threading.Lock()
        self._initialized = False
        self._init_error = None

    def initialize(self) -> bool:
        """Initialize OpenVoice models"""
        if self._initialized:
            return True

        with self._lock:
            if self._initialized:
                return True

            try:
                logger.info("Initializing OpenVoice models...")

                # Check for checkpoints
                converter_path = config.checkpoints_dir / 'checkpoints_v2' / 'converter'
                if not converter_path.exists():
                    self._init_error = f"OpenVoice checkpoints not found at {converter_path}"
                    logger.error(self._init_error)
                    return False

                import torch
                from openvoice.api import ToneColorConverter

                # Load tone color converter
                self._tone_converter = ToneColorConverter(
                    str(converter_path / 'config.json'),
                    device=config.device
                )
                self._tone_converter.load_ckpt(str(converter_path / 'checkpoint.pth'))

                self._initialized = True
                logger.info("OpenVoice models initialized successfully")
                return True

            except Exception as e:
                self._init_error = f"Failed to initialize OpenVoice: {str(e)}"
                logger.error(self._init_error)
                logger.error(traceback.format_exc())
                return False

    @property
    def tone_converter(self):
        if not self._initialized:
            self.initialize()
        return self._tone_converter

    def get_tts_model(self, language: str = 'EN'):
        """Get or create TTS model for language"""
        if language not in self._tts_models:
            try:
                from melo.api import TTS
                self._tts_models[language] = TTS(language=language, device=config.device)
                logger.info(f"Loaded TTS model for language: {language}")
            except Exception as e:
                logger.error(f"Failed to load TTS model for {language}: {e}")
                return None
        return self._tts_models[language]

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    @property
    def init_error(self) -> Optional[str]:
        return self._init_error

model_cache = ModelCache()

# Voice profile storage
class VoiceProfileStore:
    """Manages voice profiles and their embeddings"""

    def __init__(self):
        self._profiles: Dict[str, VoiceModel] = {}
        self._lock = threading.Lock()
        self._load_profiles()

    def _load_profiles(self):
        """Load existing profiles from disk"""
        profiles_file = config.profiles_dir / 'profiles.json'
        if profiles_file.exists():
            try:
                with open(profiles_file, 'r') as f:
                    data = json.load(f)
                    for profile_data in data.get('profiles', []):
                        profile = VoiceModel(**profile_data)
                        self._profiles[profile.id] = profile
                logger.info(f"Loaded {len(self._profiles)} voice profiles")
            except Exception as e:
                logger.error(f"Failed to load profiles: {e}")

    def _save_profiles(self):
        """Save profiles to disk"""
        profiles_file = config.profiles_dir / 'profiles.json'
        try:
            with open(profiles_file, 'w') as f:
                json.dump({
                    'profiles': [asdict(p) for p in self._profiles.values()]
                }, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save profiles: {e}")

    def create_profile(self, name: str, audio_samples: List[str]) -> VoiceModel:
        """Create a new voice profile"""
        with self._lock:
            profile_id = f"voice-{uuid.uuid4().hex[:8]}"
            profile = VoiceModel(
                id=profile_id,
                name=name,
                state=VoiceModelState.PENDING.value,
                created_at=datetime.now().isoformat(),
                audio_samples=audio_samples,
                progress=0
            )
            self._profiles[profile_id] = profile
            self._save_profiles()
            return profile

    def get_profile(self, profile_id: str) -> Optional[VoiceModel]:
        """Get a voice profile by ID"""
        return self._profiles.get(profile_id)

    def update_profile(self, profile_id: str, **kwargs) -> Optional[VoiceModel]:
        """Update a voice profile"""
        with self._lock:
            profile = self._profiles.get(profile_id)
            if profile:
                for key, value in kwargs.items():
                    if hasattr(profile, key):
                        setattr(profile, key, value)
                self._save_profiles()
            return profile

    def delete_profile(self, profile_id: str) -> bool:
        """Delete a voice profile"""
        with self._lock:
            if profile_id in self._profiles:
                profile = self._profiles[profile_id]
                # Delete embedding file if exists
                if profile.embedding_path and os.path.exists(profile.embedding_path):
                    os.remove(profile.embedding_path)
                # Delete profile directory
                profile_dir = config.profiles_dir / profile_id
                if profile_dir.exists():
                    shutil.rmtree(profile_dir)
                del self._profiles[profile_id]
                self._save_profiles()
                return True
            return False

    def list_profiles(self) -> List[VoiceModel]:
        """List all profiles"""
        return list(self._profiles.values())

profile_store = VoiceProfileStore()

# Training task queue
class TrainingQueue:
    """Manages voice training tasks"""

    def __init__(self):
        self._current_task: Optional[str] = None
        self._lock = threading.Lock()

    def start_training(self, profile_id: str, audio_paths: List[str]):
        """Start training a voice profile"""
        with self._lock:
            if self._current_task:
                return False, "Another training task is in progress"
            self._current_task = profile_id

        # Start training in background thread
        thread = threading.Thread(
            target=self._train_voice,
            args=(profile_id, audio_paths),
            daemon=True
        )
        thread.start()
        return True, "Training started"

    def _train_voice(self, profile_id: str, audio_paths: List[str]):
        """Background training task"""
        try:
            logger.info(f"Starting voice training for profile {profile_id}")
            profile_store.update_profile(
                profile_id,
                state=VoiceModelState.EXTRACTING.value,
                progress=10
            )

            # Initialize models if needed
            if not model_cache.initialize():
                raise Exception(model_cache.init_error or "Failed to initialize models")

            profile_store.update_profile(profile_id, progress=30)

            # Combine audio samples if multiple
            combined_audio_path = self._prepare_audio(profile_id, audio_paths)

            # Validate audio file has actual content (not silent/corrupt)
            from pydub import AudioSegment
            audio_info = AudioSegment.from_file(combined_audio_path)
            logger.info(f"Audio file info - Duration: {audio_info.duration_seconds:.2f}s, "
                       f"Channels: {audio_info.channels}, "
                       f"Sample rate: {audio_info.frame_rate}Hz, "
                       f"Sample width: {audio_info.sample_width} bytes, "
                       f"Max amplitude: {audio_info.max}, "
                       f"dBFS: {audio_info.dBFS:.2f}")

            # Check for silent/corrupt audio (max amplitude of 0 means no audio content)
            if audio_info.max == 0:
                raise ValueError(
                    "The audio file appears to be silent or corrupted. "
                    "The file has proper duration but contains no audio data. "
                    "Please verify that: (1) your microphone was working during recording, "
                    "(2) the correct audio input device was selected, "
                    "(3) the file plays correctly in a media player. "
                    f"File duration: {audio_info.duration_seconds:.1f}s, Size: {os.path.getsize(combined_audio_path):,} bytes"
                )

            # Also warn if audio is extremely quiet (dBFS below -50 is very quiet)
            if audio_info.dBFS < -50:
                logger.warning(f"Audio is very quiet (dBFS: {audio_info.dBFS:.2f}). Training may not work well.")

            profile_store.update_profile(profile_id, progress=50)

            # Extract speaker embedding
            from openvoice import se_extractor

            logger.info(f"Extracting speaker embedding from {combined_audio_path}")

            # Try with VAD first, fall back to whisper-based splitting if VAD fails
            try:
                logger.info("Attempting extraction with VAD...")
                target_se, audio_name = se_extractor.get_se(
                    combined_audio_path,
                    model_cache.tone_converter,
                    vad=True
                )
            except AssertionError as vad_error:
                if "input audio is too short" in str(vad_error):
                    logger.warning(f"VAD-based extraction failed (no speech detected), trying whisper-based extraction...")
                    # Fall back to whisper-based splitting which doesn't require VAD
                    target_se, audio_name = se_extractor.get_se(
                        combined_audio_path,
                        model_cache.tone_converter,
                        vad=False
                    )
                else:
                    raise

            profile_store.update_profile(profile_id, progress=80)

            # Save embedding
            import torch
            embedding_path = str(config.profiles_dir / profile_id / 'speaker_embedding.pth')
            os.makedirs(os.path.dirname(embedding_path), exist_ok=True)
            torch.save(target_se, embedding_path)

            # Update profile as ready
            profile_store.update_profile(
                profile_id,
                state=VoiceModelState.READY.value,
                embedding_path=embedding_path,
                progress=100
            )

            logger.info(f"Voice training completed for profile {profile_id}")

        except Exception as e:
            logger.error(f"Voice training failed for {profile_id}: {e}")
            logger.error(traceback.format_exc())
            profile_store.update_profile(
                profile_id,
                state=VoiceModelState.FAILED.value,
                error=str(e),
                progress=0
            )
        finally:
            with self._lock:
                self._current_task = None

    def _prepare_audio(self, profile_id: str, audio_paths: List[str]) -> str:
        """Prepare audio for training - combine multiple samples"""
        from pydub import AudioSegment

        profile_dir = config.profiles_dir / profile_id
        profile_dir.mkdir(parents=True, exist_ok=True)

        if len(audio_paths) == 1:
            # Single audio file - just copy/convert
            output_path = profile_dir / 'combined_audio.wav'
            audio = AudioSegment.from_file(audio_paths[0])
            audio = audio.set_channels(1).set_frame_rate(22050)
            audio.export(str(output_path), format='wav')
            return str(output_path)

        # Multiple audio files - concatenate with silence
        combined = AudioSegment.empty()
        silence = AudioSegment.silent(duration=500)  # 500ms silence between clips

        for i, path in enumerate(audio_paths):
            try:
                audio = AudioSegment.from_file(path)
                audio = audio.set_channels(1).set_frame_rate(22050)
                if i > 0:
                    combined += silence
                combined += audio
            except Exception as e:
                logger.warning(f"Failed to process audio file {path}: {e}")

        output_path = profile_dir / 'combined_audio.wav'
        combined.export(str(output_path), format='wav')
        return str(output_path)

training_queue = TrainingQueue()

# TTS Synthesis
class TTSSynthesizer:
    """Text-to-speech synthesis with voice cloning"""

    # Maximum characters per chunk to avoid memory issues
    MAX_CHUNK_CHARS = 500

    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences for chunked processing"""
        import re
        # Split on sentence-ending punctuation followed by space or end
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        return [s.strip() for s in sentences if s.strip()]

    def _chunk_text(self, text: str) -> List[str]:
        """Split text into manageable chunks while preserving sentence boundaries"""
        sentences = self._split_into_sentences(text)
        chunks = []
        current_chunk = ""

        for sentence in sentences:
            # If adding this sentence would exceed max, start new chunk
            if len(current_chunk) + len(sentence) + 1 > self.MAX_CHUNK_CHARS and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = sentence
            else:
                current_chunk = f"{current_chunk} {sentence}".strip() if current_chunk else sentence

        # Don't forget the last chunk
        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks if chunks else [text]

    def synthesize(
        self,
        text: str,
        profile_id: str,
        language: str = 'EN',
        speed: float = 1.0
    ) -> Optional[str]:
        """
        Synthesize speech with voice cloning

        Args:
            text: Text to synthesize
            profile_id: Voice profile ID to clone
            language: Language code (EN, ES, FR, ZH, JP, KR)
            speed: Speech speed (0.5-2.0)

        Returns:
            Path to generated audio file, or None on failure
        """
        try:
            # Get voice profile
            profile = profile_store.get_profile(profile_id)
            if not profile:
                raise ValueError(f"Profile not found: {profile_id}")

            if profile.state != VoiceModelState.READY.value:
                raise ValueError(f"Profile not ready: {profile.state}")

            if not profile.embedding_path or not os.path.exists(profile.embedding_path):
                raise ValueError("Profile embedding not found")

            # Initialize models
            if not model_cache.initialize():
                raise Exception(model_cache.init_error)

            import torch

            # Load target speaker embedding
            target_se = torch.load(profile.embedding_path, map_location=config.device)

            # Get TTS model for language
            tts_model = model_cache.get_tts_model(language)
            if not tts_model:
                raise ValueError(f"TTS model not available for language: {language}")

            # Generate base TTS
            output_id = uuid.uuid4().hex[:8]
            temp_path = config.output_dir / f'temp_{output_id}.wav'
            output_path = config.output_dir / f'output_{output_id}.wav'

            speaker_ids = tts_model.hps.data.spk2id
            speaker_key = list(speaker_ids.keys())[0]  # Use first speaker
            speaker_id = speaker_ids[speaker_key]

            # Sanitize text to remove emojis and problematic characters
            # MeloTTS library has issues with Windows cp1252 encoding
            sanitized_text = sanitize_text_for_tts(text)
            tts_model.tts_to_file(sanitized_text, speaker_id, str(temp_path), speed=speed)

            # Get source speaker embedding
            base_speaker_key = speaker_key.lower().replace('_', '-')
            base_speakers_dir = config.checkpoints_dir / 'checkpoints_v2' / 'base_speakers' / 'ses'
            source_se = torch.load(
                str(base_speakers_dir / f'{base_speaker_key}.pth'),
                map_location=config.device
            )

            # Apply voice cloning (tone color conversion)
            model_cache.tone_converter.convert(
                audio_src_path=str(temp_path),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(output_path),
                message="@FSPStudyTools"
            )

            # Cleanup temp file
            if temp_path.exists():
                temp_path.unlink()

            return str(output_path)

        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            logger.error(traceback.format_exc())
            return None

    def synthesize_long(
        self,
        text: str,
        profile_id: str,
        language: str = 'EN',
        speed: float = 1.0
    ) -> Optional[Dict[str, Any]]:
        """
        Synthesize long text with automatic chunking and concatenation.

        Returns dict with:
            - audio_path: Path to final concatenated audio
            - duration: Total duration in seconds
            - chunks: Number of chunks processed
        """
        from pydub import AudioSegment

        try:
            # Split text into chunks
            chunks = self._chunk_text(text)
            logger.info(f"Synthesizing {len(chunks)} chunks for long text ({len(text)} chars)")

            if len(chunks) == 1:
                # Single chunk - use regular synthesis
                audio_path = self.synthesize(text, profile_id, language, speed)
                if audio_path:
                    audio = AudioSegment.from_wav(audio_path)
                    return {
                        'audio_path': audio_path,
                        'duration': len(audio) / 1000.0,
                        'chunks': 1
                    }
                return None

            # Multiple chunks - synthesize each and concatenate
            audio_segments = []
            temp_files = []

            for i, chunk in enumerate(chunks):
                logger.info(f"Synthesizing chunk {i+1}/{len(chunks)}: {len(chunk)} chars")
                chunk_path = self.synthesize(chunk, profile_id, language, speed)

                if not chunk_path:
                    logger.warning(f"Failed to synthesize chunk {i+1}, skipping")
                    continue

                temp_files.append(chunk_path)
                segment = AudioSegment.from_wav(chunk_path)
                audio_segments.append(segment)

                # Add small pause between chunks for natural flow
                silence = AudioSegment.silent(duration=200)  # 200ms
                audio_segments.append(silence)

            if not audio_segments:
                raise Exception("All chunks failed to synthesize")

            # Concatenate all segments
            combined = audio_segments[0]
            for segment in audio_segments[1:]:
                combined += segment

            # Export combined audio
            output_id = uuid.uuid4().hex[:8]
            output_path = config.output_dir / f'combined_{output_id}.wav'
            combined.export(str(output_path), format='wav')

            # Cleanup temp files
            for temp_file in temp_files:
                try:
                    os.remove(temp_file)
                except:
                    pass

            return {
                'audio_path': str(output_path),
                'duration': len(combined) / 1000.0,
                'chunks': len(chunks)
            }

        except Exception as e:
            logger.error(f"Long text synthesis failed: {e}")
            logger.error(traceback.format_exc())
            return None

tts_synthesizer = TTSSynthesizer()

# ============== REST API Endpoints ==============

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'initialized': model_cache.is_initialized,
        'device': config.device,
        'error': model_cache.init_error
    })

@app.route('/initialize', methods=['POST'])
def initialize_models():
    """Initialize OpenVoice models"""
    success = model_cache.initialize()
    return jsonify({
        'success': success,
        'error': model_cache.init_error
    })

@app.route('/profiles', methods=['GET'])
def list_profiles():
    """List all voice profiles"""
    profiles = profile_store.list_profiles()
    return jsonify({
        'profiles': [asdict(p) for p in profiles]
    })

@app.route('/profiles', methods=['POST'])
def create_profile():
    """Create a new voice profile"""
    data = request.json
    name = data.get('name')
    audio_samples = data.get('audio_samples', [])

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    if not audio_samples:
        return jsonify({'error': 'At least one audio sample is required'}), 400

    # Verify audio files exist
    for path in audio_samples:
        if not os.path.exists(path):
            return jsonify({'error': f'Audio file not found: {path}'}), 400

    profile = profile_store.create_profile(name, audio_samples)
    return jsonify(asdict(profile))

@app.route('/profiles/<profile_id>', methods=['GET'])
def get_profile(profile_id: str):
    """Get a voice profile"""
    profile = profile_store.get_profile(profile_id)
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404
    return jsonify(asdict(profile))

@app.route('/profiles/<profile_id>', methods=['DELETE'])
def delete_profile(profile_id: str):
    """Delete a voice profile"""
    success = profile_store.delete_profile(profile_id)
    if not success:
        return jsonify({'error': 'Profile not found'}), 404
    return jsonify({'success': True})

@app.route('/profiles/<profile_id>/samples', methods=['PUT'])
def update_profile_samples(profile_id: str):
    """Update audio samples for a voice profile"""
    profile = profile_store.get_profile(profile_id)
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404

    data = request.json
    audio_samples = data.get('audio_samples', [])

    if not audio_samples:
        return jsonify({'error': 'At least one audio sample is required'}), 400

    # Verify audio files exist
    for path in audio_samples:
        if not os.path.exists(path):
            return jsonify({'error': f'Audio file not found: {path}'}), 400

    # Update the profile
    updated = profile_store.update_profile(profile_id, audio_samples=audio_samples, state='pending', progress=0)
    if updated:
        return jsonify(asdict(updated))
    return jsonify({'error': 'Failed to update profile'}), 500

@app.route('/profiles/<profile_id>/train', methods=['POST'])
def train_profile(profile_id: str):
    """Start training a voice profile"""
    profile = profile_store.get_profile(profile_id)
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404

    success, message = training_queue.start_training(profile_id, profile.audio_samples)
    return jsonify({
        'success': success,
        'message': message
    })


@app.route('/validate-audio', methods=['POST'])
def validate_audio():
    """
    Validate audio file(s) before training to prevent failures.
    Returns detailed analysis including:
    - Duration
    - Audio quality metrics
    - Estimated speech duration via VAD
    - Recommendations for success
    """
    data = request.json
    audio_paths = data.get('audio_paths', [])

    if not audio_paths:
        return jsonify({'error': 'No audio files provided'}), 400

    results = []
    total_duration = 0
    total_speech_duration = 0
    all_valid = True

    for audio_path in audio_paths:
        result = _validate_single_audio(audio_path)
        results.append(result)

        if result.get('valid'):
            total_duration += result.get('duration', 0)
            total_speech_duration += result.get('speech_duration', 0)
        else:
            all_valid = False

    # Overall validation
    min_speech_required = 5.0  # seconds
    recommended_speech = 30.0  # seconds for best results

    validation_result = {
        'valid': all_valid and total_speech_duration >= min_speech_required,
        'files': results,
        'summary': {
            'total_files': len(audio_paths),
            'valid_files': sum(1 for r in results if r.get('valid')),
            'total_duration': round(total_duration, 2),
            'total_speech_duration': round(total_speech_duration, 2),
            'min_speech_required': min_speech_required,
            'recommended_speech': recommended_speech,
            'speech_percentage': round((total_speech_duration / total_duration * 100) if total_duration > 0 else 0, 1),
        },
        'recommendations': []
    }

    # Add recommendations
    if total_speech_duration < min_speech_required:
        validation_result['recommendations'].append(
            f"Need at least {min_speech_required}s of detected speech. Currently: {total_speech_duration:.1f}s. "
            "Try recording longer audio or speaking more clearly."
        )
        validation_result['valid'] = False
    elif total_speech_duration < recommended_speech:
        validation_result['recommendations'].append(
            f"For best voice cloning quality, we recommend at least {recommended_speech}s of speech. "
            f"Currently: {total_speech_duration:.1f}s. Consider adding more samples."
        )

    if any(r.get('is_quiet') for r in results):
        validation_result['recommendations'].append(
            "Some audio files are very quiet. This may affect voice cloning quality. "
            "Try recording at a higher volume or closer to the microphone."
        )

    return jsonify(validation_result)


def _validate_single_audio(audio_path: str) -> Dict[str, Any]:
    """Validate a single audio file and return detailed analysis"""
    result = {
        'path': audio_path,
        'valid': False,
        'duration': 0,
        'speech_duration': 0,
        'is_quiet': False,
        'error': None,
        'details': {}
    }

    try:
        # Check file exists
        if not os.path.exists(audio_path):
            result['error'] = 'File not found'
            return result

        # Check file size
        file_size = os.path.getsize(audio_path)
        if file_size == 0:
            result['error'] = 'File is empty'
            return result

        result['details']['file_size'] = file_size

        # Load and analyze with pydub
        from pydub import AudioSegment
        audio = AudioSegment.from_file(audio_path)

        result['duration'] = audio.duration_seconds
        result['details']['channels'] = audio.channels
        result['details']['sample_rate'] = audio.frame_rate
        result['details']['sample_width'] = audio.sample_width
        result['details']['dBFS'] = round(audio.dBFS, 2) if audio.dBFS != float('-inf') else -100
        result['details']['max_amplitude'] = audio.max

        # Check for silent/corrupt audio
        if audio.max == 0:
            result['error'] = 'Audio file appears to be silent or corrupted (no audio data detected)'
            return result

        # Check for very quiet audio
        if audio.dBFS < -50:
            result['is_quiet'] = True
            result['details']['quiet_warning'] = f'Audio is very quiet ({audio.dBFS:.1f} dBFS)'

        # Minimum duration check
        if audio.duration_seconds < 3:
            result['error'] = f'Audio too short ({audio.duration_seconds:.1f}s). Minimum 3 seconds required.'
            return result

        # Try VAD analysis to estimate speech duration
        try:
            speech_duration = _analyze_speech_duration(audio_path)
            result['speech_duration'] = speech_duration
            result['details']['speech_percentage'] = round((speech_duration / audio.duration_seconds * 100) if audio.duration_seconds > 0 else 0, 1)

            if speech_duration < 3:
                result['error'] = f'Not enough speech detected ({speech_duration:.1f}s). Please ensure clear speech is present.'
                return result

        except Exception as vad_error:
            logger.warning(f"VAD analysis failed for {audio_path}: {vad_error}")
            # If VAD fails, estimate speech as 70% of duration (conservative estimate)
            result['speech_duration'] = audio.duration_seconds * 0.7
            result['details']['speech_estimated'] = True

        result['valid'] = True
        return result

    except Exception as e:
        result['error'] = f'Failed to analyze audio: {str(e)}'
        logger.error(f"Audio validation error for {audio_path}: {e}")
        return result


def _analyze_speech_duration(audio_path: str) -> float:
    """Use VAD to analyze actual speech duration in audio file"""
    try:
        from whisper_timestamped.transcribe import get_audio_tensor, get_vad_segments

        SAMPLE_RATE = 16000

        audio_tensor = get_audio_tensor(audio_path)
        segments = get_vad_segments(
            audio_tensor,
            output_sample=True,
            min_speech_duration=0.1,
            min_silence_duration=1,
            method="silero",
        )

        total_speech = sum(
            (float(seg["end"]) - float(seg["start"])) / SAMPLE_RATE
            for seg in segments
        )

        return total_speech

    except Exception as e:
        logger.warning(f"VAD analysis failed: {e}")
        raise

@app.route('/synthesize', methods=['POST'])
def synthesize():
    """Synthesize speech with voice cloning"""
    data = request.json
    text = data.get('text')
    profile_id = data.get('profile_id')
    language = data.get('language', 'EN')
    speed = data.get('speed', 1.0)

    if not text:
        return jsonify({'error': 'Text is required'}), 400

    if not profile_id:
        return jsonify({'error': 'Profile ID is required'}), 400

    output_path = tts_synthesizer.synthesize(text, profile_id, language, speed)

    if not output_path:
        return jsonify({'error': 'Synthesis failed'}), 500

    return jsonify({
        'success': True,
        'audio_path': output_path
    })

@app.route('/synthesize/long', methods=['POST'])
def synthesize_long():
    """Synthesize long text with automatic chunking"""
    data = request.json
    text = data.get('text')
    profile_id = data.get('profile_id')
    language = data.get('language', 'EN')
    speed = data.get('speed', 1.0)

    if not text:
        return jsonify({'error': 'Text is required'}), 400

    if not profile_id:
        return jsonify({'error': 'Profile ID is required'}), 400

    result = tts_synthesizer.synthesize_long(text, profile_id, language, speed)

    if not result:
        return jsonify({'error': 'Synthesis failed'}), 500

    return jsonify({
        'success': True,
        'audio_path': result['audio_path'],
        'duration': result['duration'],
        'chunks': result['chunks']
    })

@app.route('/synthesize/stream', methods=['POST'])
def synthesize_and_stream():
    """Synthesize and return audio file directly"""
    data = request.json
    text = data.get('text')
    profile_id = data.get('profile_id')
    language = data.get('language', 'EN')
    speed = data.get('speed', 1.0)

    if not text or not profile_id:
        return jsonify({'error': 'Text and profile_id are required'}), 400

    output_path = tts_synthesizer.synthesize(text, profile_id, language, speed)

    if not output_path:
        return jsonify({'error': 'Synthesis failed'}), 500

    return send_file(output_path, mimetype='audio/wav')

@app.route('/audio/<filename>', methods=['GET'])
def get_audio(filename: str):
    """Serve generated audio files"""
    audio_path = config.output_dir / filename
    if not audio_path.exists():
        return jsonify({'error': 'File not found'}), 404
    return send_file(str(audio_path), mimetype='audio/wav')

@app.route('/checkpoints/status', methods=['GET'])
def checkpoints_status():
    """Check if OpenVoice checkpoints are installed"""
    v2_path = config.checkpoints_dir / 'checkpoints_v2'
    converter_path = v2_path / 'converter'
    base_speakers_path = v2_path / 'base_speakers' / 'ses'

    return jsonify({
        'checkpoints_dir': str(config.checkpoints_dir),
        'v2_exists': v2_path.exists(),
        'converter_exists': converter_path.exists(),
        'base_speakers_exists': base_speakers_path.exists(),
        'ready': converter_path.exists() and base_speakers_path.exists()
    })


# Global download state
_download_state = {
    'downloading': False,
    'progress': 0,
    'status': '',
    'error': None
}


@app.route('/checkpoints/download', methods=['POST'])
def download_checkpoints():
    """Download OpenVoice v2 checkpoints automatically"""
    global _download_state

    if _download_state['downloading']:
        return jsonify({
            'success': False,
            'error': 'Download already in progress',
            'progress': _download_state['progress'],
            'status': _download_state['status']
        }), 400

    # Start download in background
    thread = threading.Thread(target=_download_checkpoints_task, daemon=True)
    thread.start()

    return jsonify({
        'success': True,
        'message': 'Download started',
        'progress': 0,
        'status': 'Starting download...'
    })


@app.route('/checkpoints/download/status', methods=['GET'])
def download_status():
    """Get checkpoint download progress"""
    return jsonify({
        'downloading': _download_state['downloading'],
        'progress': _download_state['progress'],
        'status': _download_state['status'],
        'error': _download_state['error']
    })


def _download_checkpoints_task():
    """Background task to download checkpoints"""
    global _download_state
    import urllib.request
    import zipfile

    _download_state = {
        'downloading': True,
        'progress': 0,
        'status': 'Initializing download...',
        'error': None
    }

    try:
        # OpenVoice v2 checkpoints URL
        checkpoint_url = "https://myshell-public-repo-hosting.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"
        zip_path = config.checkpoints_dir / 'checkpoints_v2.zip'

        # Ensure directory exists
        config.checkpoints_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Downloading checkpoints from {checkpoint_url}")
        _download_state['status'] = 'Downloading checkpoints (~300MB)...'

        # Download with progress tracking
        def progress_hook(count, block_size, total_size):
            if total_size > 0:
                percent = int(count * block_size * 100 / total_size)
                _download_state['progress'] = min(percent, 95)  # Cap at 95 until extraction

        urllib.request.urlretrieve(checkpoint_url, str(zip_path), progress_hook)

        _download_state['progress'] = 95
        _download_state['status'] = 'Extracting checkpoints...'
        logger.info("Download complete, extracting...")

        # Extract zip file
        with zipfile.ZipFile(str(zip_path), 'r') as zip_ref:
            zip_ref.extractall(str(config.checkpoints_dir))

        # Clean up zip file
        zip_path.unlink()

        _download_state['progress'] = 100
        _download_state['status'] = 'Checkpoints installed successfully!'
        logger.info("Checkpoints installed successfully")

    except Exception as e:
        logger.error(f"Checkpoint download failed: {e}")
        _download_state['error'] = str(e)
        _download_state['status'] = f'Download failed: {e}'
    finally:
        _download_state['downloading'] = False

# ============== Main ==============

def main():
    """Start the OpenVoice service"""
    import argparse

    parser = argparse.ArgumentParser(description='OpenVoice Service')
    parser.add_argument('--port', type=int, default=5123, help='Port to listen on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')

    args = parser.parse_args()

    logger.info(f"Starting OpenVoice service on {args.host}:{args.port}")
    logger.info(f"Data directory: {config.data_dir}")
    logger.info(f"Checkpoints directory: {config.checkpoints_dir}")

    app.run(host=args.host, port=args.port, debug=args.debug)

if __name__ == '__main__':
    main()
