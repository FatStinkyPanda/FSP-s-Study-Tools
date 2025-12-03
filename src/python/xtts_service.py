"""
XTTS v2 Voice Cloning Service - FSP Study Tools

Coqui XTTS v2 provides high-quality voice cloning with:
- Zero-shot cloning (no training needed, just reference audio)
- Better voice similarity than OpenVoice
- Faster inference
- Multi-language support

This service replaces OpenVoice for improved TTS quality and speed.
"""

import os
import sys
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

# Suppress warnings
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', category=UserWarning)

# Flask imports
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('XTTSService')

app = Flask(__name__)
CORS(app)


def sanitize_text_for_tts(text: str) -> str:
    """Remove emojis and problematic characters for TTS."""
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F700-\U0001F77F"
        "\U0001F780-\U0001F7FF"
        "\U0001F800-\U0001F8FF"
        "\U0001F900-\U0001F9FF"
        "\U0001FA00-\U0001FA6F"
        "\U0001FA70-\U0001FAFF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "]+",
        flags=re.UNICODE
    )
    cleaned = emoji_pattern.sub('', text)
    try:
        cleaned.encode('cp1252')
    except UnicodeEncodeError:
        cleaned = cleaned.encode('cp1252', errors='replace').decode('cp1252')
    return cleaned


class Config:
    """Service configuration"""
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent.parent
        self.data_dir = self.base_dir / 'data' / 'voice'
        self.profiles_dir = self.data_dir / 'profiles'
        self.output_dir = self.data_dir / 'output'
        self.models_dir = self.data_dir / 'xtts_models'

        # Ensure directories exist
        for d in [self.data_dir, self.profiles_dir, self.output_dir, self.models_dir]:
            d.mkdir(parents=True, exist_ok=True)

        # Device configuration
        self.device = 'cuda' if self._cuda_available() else 'cpu'
        logger.info(f"Using device: {self.device}")

    def _cuda_available(self) -> bool:
        try:
            import torch
            return torch.cuda.is_available()
        except:
            return False


config = Config()


class VoiceProfileState(Enum):
    PENDING = 'pending'
    PROCESSING = 'processing'
    READY = 'ready'
    FAILED = 'failed'


@dataclass
class VoiceProfile:
    """Voice profile metadata"""
    id: str
    name: str
    state: str
    created_at: str
    audio_samples: List[str]  # Reference audio files
    speaker_wav: Optional[str] = None  # Processed reference audio for XTTS
    error: Optional[str] = None
    progress: int = 0


class ModelCache:
    """Lazy-loaded XTTS model cache"""
    def __init__(self):
        self._model = None
        self._lock = threading.Lock()
        self._initialized = False
        self._init_error = None

    def initialize(self) -> bool:
        """Initialize XTTS model"""
        if self._initialized:
            return True

        with self._lock:
            if self._initialized:
                return True

            try:
                logger.info("Initializing XTTS v2 model...")

                import torch
                from TTS.api import TTS

                # Load XTTS v2 model (auto-downloads if not present)
                # Model is cached in ~/.local/share/tts/ on Linux or AppData on Windows
                self._model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(config.device)

                self._initialized = True
                logger.info("XTTS v2 model initialized successfully")
                return True

            except Exception as e:
                self._init_error = f"Failed to initialize XTTS: {str(e)}"
                logger.error(self._init_error)
                logger.error(traceback.format_exc())
                return False

    @property
    def model(self):
        if not self._initialized:
            self.initialize()
        return self._model

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    @property
    def init_error(self) -> Optional[str]:
        return self._init_error


model_cache = ModelCache()


class VoiceProfileStore:
    """Manages voice profiles"""

    def __init__(self):
        self._profiles: Dict[str, VoiceProfile] = {}
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
                        profile = VoiceProfile(**profile_data)
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

    def create_profile(self, name: str, audio_samples: List[str]) -> VoiceProfile:
        """Create a new voice profile"""
        with self._lock:
            profile_id = f"voice-{uuid.uuid4().hex[:8]}"
            profile = VoiceProfile(
                id=profile_id,
                name=name,
                state=VoiceProfileState.PENDING.value,
                created_at=datetime.now().isoformat(),
                audio_samples=audio_samples,
                progress=0
            )
            self._profiles[profile_id] = profile
            self._save_profiles()
            return profile

    def get_profile(self, profile_id: str) -> Optional[VoiceProfile]:
        """Get a voice profile by ID"""
        return self._profiles.get(profile_id)

    def update_profile(self, profile_id: str, **kwargs) -> Optional[VoiceProfile]:
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
                # Delete speaker wav file if exists
                if profile.speaker_wav and os.path.exists(profile.speaker_wav):
                    os.remove(profile.speaker_wav)
                # Delete profile directory
                profile_dir = config.profiles_dir / profile_id
                if profile_dir.exists():
                    shutil.rmtree(profile_dir)
                del self._profiles[profile_id]
                self._save_profiles()
                return True
            return False

    def list_profiles(self) -> List[VoiceProfile]:
        """List all profiles"""
        return list(self._profiles.values())


profile_store = VoiceProfileStore()


class ProfileProcessor:
    """Processes voice profiles (prepares reference audio)"""

    def __init__(self):
        self._current_task: Optional[str] = None
        self._lock = threading.Lock()

    def start_processing(self, profile_id: str, audio_paths: List[str]):
        """Start processing a voice profile"""
        with self._lock:
            if self._current_task:
                return False, "Another task is in progress"
            self._current_task = profile_id

        thread = threading.Thread(
            target=self._process_profile,
            args=(profile_id, audio_paths),
            daemon=True
        )
        thread.start()
        return True, "Processing started"

    def _process_profile(self, profile_id: str, audio_paths: List[str]):
        """Background profile processing task"""
        try:
            logger.info(f"Processing voice profile {profile_id}")
            profile_store.update_profile(
                profile_id,
                state=VoiceProfileState.PROCESSING.value,
                progress=10
            )

            # Prepare reference audio
            speaker_wav_path = self._prepare_reference_audio(profile_id, audio_paths)

            profile_store.update_profile(profile_id, progress=50)

            # Validate audio file
            self._validate_audio(speaker_wav_path)

            profile_store.update_profile(profile_id, progress=80)

            # Update profile as ready
            profile_store.update_profile(
                profile_id,
                state=VoiceProfileState.READY.value,
                speaker_wav=speaker_wav_path,
                progress=100
            )

            logger.info(f"Voice profile {profile_id} ready")

        except Exception as e:
            logger.error(f"Profile processing failed for {profile_id}: {e}")
            logger.error(traceback.format_exc())
            profile_store.update_profile(
                profile_id,
                state=VoiceProfileState.FAILED.value,
                error=str(e),
                progress=0
            )
        finally:
            with self._lock:
                self._current_task = None

    def _prepare_reference_audio(self, profile_id: str, audio_paths: List[str]) -> str:
        """Prepare reference audio for XTTS"""
        from pydub import AudioSegment

        profile_dir = config.profiles_dir / profile_id
        profile_dir.mkdir(parents=True, exist_ok=True)

        # XTTS works best with 6-30 seconds of clear speech
        # Combine multiple samples if provided
        if len(audio_paths) == 1:
            audio = AudioSegment.from_file(audio_paths[0])
        else:
            combined = AudioSegment.empty()
            silence = AudioSegment.silent(duration=300)  # 300ms between clips

            for i, path in enumerate(audio_paths):
                try:
                    audio = AudioSegment.from_file(path)
                    if i > 0:
                        combined += silence
                    combined += audio
                except Exception as e:
                    logger.warning(f"Failed to process audio file {path}: {e}")

            audio = combined

        # Normalize audio for XTTS
        # - Mono channel
        # - 22050 Hz sample rate (XTTS preferred)
        # - Normalize volume
        audio = audio.set_channels(1)
        audio = audio.set_frame_rate(22050)

        # Normalize to -20 dBFS for consistent volume
        target_dBFS = -20.0
        change_in_dBFS = target_dBFS - audio.dBFS
        audio = audio.apply_gain(change_in_dBFS)

        # Trim to optimal length (6-30 seconds)
        max_duration_ms = 30000
        if len(audio) > max_duration_ms:
            audio = audio[:max_duration_ms]

        output_path = profile_dir / 'speaker_reference.wav'
        audio.export(str(output_path), format='wav')

        return str(output_path)

    def _validate_audio(self, audio_path: str):
        """Validate reference audio"""
        from pydub import AudioSegment

        audio = AudioSegment.from_file(audio_path)

        # Check for silent/corrupt audio
        if audio.max == 0:
            raise ValueError("Audio file appears to be silent or corrupted")

        # Minimum duration
        if audio.duration_seconds < 3:
            raise ValueError(f"Audio too short ({audio.duration_seconds:.1f}s). Minimum 3 seconds required.")

        # Warn if very quiet
        if audio.dBFS < -50:
            logger.warning(f"Audio is very quiet ({audio.dBFS:.1f} dBFS)")


profile_processor = ProfileProcessor()


class TTSSynthesizer:
    """Text-to-speech synthesis with XTTS v2"""

    MAX_CHUNK_CHARS = 250  # XTTS handles shorter chunks better

    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences"""
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        return [s.strip() for s in sentences if s.strip()]

    def _chunk_text(self, text: str) -> List[str]:
        """Split text into manageable chunks"""
        sentences = self._split_into_sentences(text)
        chunks = []
        current_chunk = ""

        for sentence in sentences:
            if len(current_chunk) + len(sentence) + 1 > self.MAX_CHUNK_CHARS and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = sentence
            else:
                current_chunk = f"{current_chunk} {sentence}".strip() if current_chunk else sentence

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks if chunks else [text]

    def synthesize(
        self,
        text: str,
        profile_id: str,
        language: str = 'en',
        speed: float = 1.0
    ) -> Optional[str]:
        """
        Synthesize speech with voice cloning

        Args:
            text: Text to synthesize
            profile_id: Voice profile ID
            language: Language code (en, es, fr, de, it, pt, pl, tr, ru, nl, cs, ar, zh-cn, ja, hu, ko)
            speed: Speech speed (0.5-2.0)

        Returns:
            Path to generated audio file, or None on failure
        """
        try:
            # Get voice profile
            profile = profile_store.get_profile(profile_id)
            if not profile:
                raise ValueError(f"Profile not found: {profile_id}")

            if profile.state != VoiceProfileState.READY.value:
                raise ValueError(f"Profile not ready: {profile.state}")

            if not profile.speaker_wav or not os.path.exists(profile.speaker_wav):
                raise ValueError("Profile reference audio not found")

            # Initialize model
            if not model_cache.initialize():
                raise Exception(model_cache.init_error)

            # Sanitize text
            sanitized_text = sanitize_text_for_tts(text)

            # Generate output path
            output_id = uuid.uuid4().hex[:8]
            output_path = config.output_dir / f'output_{output_id}.wav'

            # Synthesize with XTTS
            # XTTS uses the reference audio directly for zero-shot cloning
            model_cache.model.tts_to_file(
                text=sanitized_text,
                file_path=str(output_path),
                speaker_wav=profile.speaker_wav,
                language=language,
                speed=speed
            )

            return str(output_path)

        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            logger.error(traceback.format_exc())
            return None

    def synthesize_long(
        self,
        text: str,
        profile_id: str,
        language: str = 'en',
        speed: float = 1.0
    ) -> Optional[Dict[str, Any]]:
        """Synthesize long text with automatic chunking"""
        from pydub import AudioSegment

        try:
            chunks = self._chunk_text(text)
            logger.info(f"Synthesizing {len(chunks)} chunks for long text ({len(text)} chars)")

            if len(chunks) == 1:
                audio_path = self.synthesize(text, profile_id, language, speed)
                if audio_path:
                    audio = AudioSegment.from_wav(audio_path)
                    return {
                        'audio_path': audio_path,
                        'duration': len(audio) / 1000.0,
                        'chunks': 1
                    }
                return None

            # Synthesize each chunk
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

                # Small pause between chunks
                silence = AudioSegment.silent(duration=150)
                audio_segments.append(silence)

            if not audio_segments:
                raise Exception("All chunks failed to synthesize")

            # Concatenate
            combined = audio_segments[0]
            for segment in audio_segments[1:]:
                combined += segment

            # Export
            output_id = uuid.uuid4().hex[:8]
            output_path = config.output_dir / f'combined_{output_id}.wav'
            combined.export(str(output_path), format='wav')

            # Cleanup temp files
            for temp_file in temp_files:
                try:
                    os.remove(temp_file)
                except OSError as e:
                    logger.debug(f"Failed to cleanup temp file {temp_file}: {e}")

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
    """Initialize XTTS model"""
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

    # Update and reset to pending state
    updated = profile_store.update_profile(
        profile_id,
        audio_samples=audio_samples,
        state='pending',
        progress=0
    )
    if updated:
        return jsonify(asdict(updated))
    return jsonify({'error': 'Failed to update profile'}), 500


@app.route('/profiles/<profile_id>/process', methods=['POST'])
def process_profile(profile_id: str):
    """Process a voice profile (prepare reference audio)"""
    profile = profile_store.get_profile(profile_id)
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404

    success, message = profile_processor.start_processing(profile_id, profile.audio_samples)
    return jsonify({
        'success': success,
        'message': message
    })


@app.route('/validate-audio', methods=['POST'])
def validate_audio():
    """Validate audio file(s) before processing"""
    data = request.json
    audio_paths = data.get('audio_paths', [])

    if not audio_paths:
        return jsonify({'error': 'No audio files provided'}), 400

    results = []
    total_duration = 0
    all_valid = True

    for audio_path in audio_paths:
        result = _validate_single_audio(audio_path)
        results.append(result)

        if result.get('valid'):
            total_duration += result.get('duration', 0)
        else:
            all_valid = False

    # XTTS works best with 6-30 seconds of reference audio
    min_duration = 6.0
    recommended_duration = 15.0

    validation_result = {
        'valid': all_valid and total_duration >= min_duration,
        'files': results,
        'summary': {
            'total_files': len(audio_paths),
            'valid_files': sum(1 for r in results if r.get('valid')),
            'total_duration': round(total_duration, 2),
            'min_duration_required': min_duration,
            'recommended_duration': recommended_duration,
        },
        'recommendations': []
    }

    if total_duration < min_duration:
        validation_result['recommendations'].append(
            f"Need at least {min_duration}s of audio. Currently: {total_duration:.1f}s. "
            "Try recording longer audio."
        )
        validation_result['valid'] = False
    elif total_duration < recommended_duration:
        validation_result['recommendations'].append(
            f"For best voice cloning quality, we recommend {recommended_duration}s of audio. "
            f"Currently: {total_duration:.1f}s."
        )

    if any(r.get('is_quiet') for r in results):
        validation_result['recommendations'].append(
            "Some audio files are very quiet. This may affect voice cloning quality."
        )

    return jsonify(validation_result)


def _validate_single_audio(audio_path: str) -> Dict[str, Any]:
    """Validate a single audio file"""
    result = {
        'path': audio_path,
        'valid': False,
        'duration': 0,
        'is_quiet': False,
        'error': None,
        'details': {}
    }

    try:
        if not os.path.exists(audio_path):
            result['error'] = 'File not found'
            return result

        file_size = os.path.getsize(audio_path)
        if file_size == 0:
            result['error'] = 'File is empty'
            return result

        result['details']['file_size'] = file_size

        from pydub import AudioSegment
        audio = AudioSegment.from_file(audio_path)

        result['duration'] = audio.duration_seconds
        result['details']['channels'] = audio.channels
        result['details']['sample_rate'] = audio.frame_rate
        result['details']['dBFS'] = round(audio.dBFS, 2) if audio.dBFS != float('-inf') else -100

        if audio.max == 0:
            result['error'] = 'Audio file appears to be silent or corrupted'
            return result

        if audio.dBFS < -50:
            result['is_quiet'] = True

        if audio.duration_seconds < 3:
            result['error'] = f'Audio too short ({audio.duration_seconds:.1f}s). Minimum 3 seconds required.'
            return result

        result['valid'] = True
        return result

    except Exception as e:
        result['error'] = f'Failed to analyze audio: {str(e)}'
        return result


@app.route('/synthesize', methods=['POST'])
def synthesize():
    """Synthesize speech with voice cloning"""
    data = request.json
    text = data.get('text')
    profile_id = data.get('profile_id')
    language = data.get('language', 'en')
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
    language = data.get('language', 'en')
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
    language = data.get('language', 'en')
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


@app.route('/model/status', methods=['GET'])
def model_status():
    """Check if XTTS model is downloaded and ready"""
    return jsonify({
        'initialized': model_cache.is_initialized,
        'device': config.device,
        'error': model_cache.init_error,
        'ready': model_cache.is_initialized
    })


# ============== Main ==============

def main():
    """Start the XTTS service"""
    import argparse

    parser = argparse.ArgumentParser(description='XTTS Voice Cloning Service')
    parser.add_argument('--port', type=int, default=5123, help='Port to listen on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')

    args = parser.parse_args()

    logger.info(f"Starting XTTS service on {args.host}:{args.port}")
    logger.info(f"Data directory: {config.data_dir}")

    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == '__main__':
    main()
