"""
Vosk Speech Recognition Service

Provides offline speech recognition using Vosk.
Features:
- Real-time streaming speech recognition
- Automatic model download and setup
- WebSocket-based communication for low latency
- High accuracy with compact model
"""

import os
import sys
import json
import logging
import zipfile
import shutil
import threading
import queue
import wave
import tempfile
from pathlib import Path
from typing import Optional, Callable

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('VoskService')

# Vosk imports
try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)  # Suppress Vosk logging
    VOSK_AVAILABLE = True
except ImportError:
    logger.error("Vosk not installed. Run: pip install vosk")
    VOSK_AVAILABLE = False

app = Flask(__name__)
CORS(app)

# Global state
vosk_model: Optional[Model] = None
model_path: Optional[str] = None
is_initialized = False
is_recognizing = False
recognition_thread: Optional[threading.Thread] = None
stop_recognition_event = threading.Event()
audio_queue: queue.Queue = queue.Queue()
result_callback: Optional[Callable] = None
latest_results: list = []
results_lock = threading.Lock()

# Model configuration
# Using vosk-model-small-en-us-0.15 - 40MB, fast and accurate
MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
MODEL_NAME = "vosk-model-small-en-us-0.15"
MODEL_SIZE_MB = 40


def get_model_dir() -> Path:
    """Get the directory where the Vosk model should be stored."""
    # Store in app data directory
    if sys.platform == 'win32':
        base_dir = Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming'))
    else:
        base_dir = Path.home() / '.local' / 'share'

    model_dir = base_dir / 'fsp-study-tools' / 'vosk_model'
    model_dir.mkdir(parents=True, exist_ok=True)
    return model_dir


def download_model(progress_callback: Optional[Callable] = None) -> str:
    """Download the Vosk model if not already present."""
    model_dir = get_model_dir()
    model_path = model_dir / MODEL_NAME

    if model_path.exists() and (model_path / 'am' / 'final.mdl').exists():
        logger.info(f"Model already exists at {model_path}")
        return str(model_path)

    logger.info(f"Downloading Vosk model from {MODEL_URL}")

    zip_path = model_dir / f"{MODEL_NAME}.zip"

    try:
        # Download with progress
        response = requests.get(MODEL_URL, stream=True)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0

        with open(zip_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_callback and total_size > 0:
                        progress = int((downloaded / total_size) * 100)
                        progress_callback(progress, f"Downloading model: {progress}%")

        logger.info("Download complete, extracting...")
        if progress_callback:
            progress_callback(100, "Extracting model...")

        # Extract
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(model_dir)

        # Clean up zip file
        zip_path.unlink()

        logger.info(f"Model extracted to {model_path}")
        return str(model_path)

    except Exception as e:
        logger.error(f"Failed to download model: {e}")
        if zip_path.exists():
            zip_path.unlink()
        raise


def initialize_model(progress_callback: Optional[Callable] = None) -> bool:
    """Initialize the Vosk model."""
    global vosk_model, model_path, is_initialized

    if not VOSK_AVAILABLE:
        logger.error("Vosk is not available")
        return False

    if is_initialized and vosk_model is not None:
        logger.info("Model already initialized")
        return True

    try:
        # Download model if needed
        model_path = download_model(progress_callback)

        if progress_callback:
            progress_callback(100, "Loading model...")

        # Load model
        logger.info(f"Loading Vosk model from {model_path}")
        vosk_model = Model(model_path)
        is_initialized = True

        logger.info("Vosk model initialized successfully")
        return True

    except Exception as e:
        logger.error(f"Failed to initialize model: {e}")
        is_initialized = False
        return False


def recognize_audio_data(audio_data: bytes, sample_rate: int = 16000) -> dict:
    """Recognize speech from raw audio data (single shot)."""
    global vosk_model

    if not is_initialized or vosk_model is None:
        return {"error": "Model not initialized"}

    try:
        recognizer = KaldiRecognizer(vosk_model, sample_rate)
        recognizer.SetWords(True)

        # Process audio
        if recognizer.AcceptWaveform(audio_data):
            result = json.loads(recognizer.Result())
        else:
            result = json.loads(recognizer.PartialResult())

        return result

    except Exception as e:
        logger.error(f"Recognition error: {e}")
        return {"error": str(e)}


def start_streaming_recognition(sample_rate: int = 16000):
    """Start streaming recognition in a background thread."""
    global is_recognizing, recognition_thread, stop_recognition_event, audio_queue, latest_results

    if not is_initialized or vosk_model is None:
        return False

    if is_recognizing:
        logger.warning("Recognition already running")
        return True

    stop_recognition_event.clear()
    audio_queue = queue.Queue()
    with results_lock:
        latest_results = []

    def recognition_worker():
        global is_recognizing
        nonlocal sample_rate

        try:
            recognizer = KaldiRecognizer(vosk_model, sample_rate)
            recognizer.SetWords(True)
            recognizer.SetPartialWords(True)

            logger.info("Streaming recognition started")
            is_recognizing = True

            while not stop_recognition_event.is_set():
                try:
                    # Get audio chunk with timeout
                    audio_chunk = audio_queue.get(timeout=0.1)

                    if recognizer.AcceptWaveform(audio_chunk):
                        result = json.loads(recognizer.Result())
                        if result.get('text'):
                            with results_lock:
                                latest_results.append({
                                    'type': 'final',
                                    'text': result.get('text', ''),
                                    'words': result.get('result', [])
                                })
                            logger.debug(f"Final: {result.get('text')}")
                    else:
                        partial = json.loads(recognizer.PartialResult())
                        if partial.get('partial'):
                            with results_lock:
                                # Update the latest partial result
                                if latest_results and latest_results[-1].get('type') == 'partial':
                                    latest_results[-1] = {
                                        'type': 'partial',
                                        'text': partial.get('partial', ''),
                                        'words': partial.get('partial_result', [])
                                    }
                                else:
                                    latest_results.append({
                                        'type': 'partial',
                                        'text': partial.get('partial', ''),
                                        'words': partial.get('partial_result', [])
                                    })
                            logger.debug(f"Partial: {partial.get('partial')}")

                except queue.Empty:
                    continue
                except Exception as e:
                    logger.error(f"Recognition worker error: {e}")

        except Exception as e:
            logger.error(f"Recognition thread error: {e}")
        finally:
            is_recognizing = False
            logger.info("Streaming recognition stopped")

    recognition_thread = threading.Thread(target=recognition_worker, daemon=True)
    recognition_thread.start()
    return True


def stop_streaming_recognition():
    """Stop streaming recognition."""
    global is_recognizing, stop_recognition_event

    stop_recognition_event.set()
    is_recognizing = False

    if recognition_thread and recognition_thread.is_alive():
        recognition_thread.join(timeout=2.0)

    logger.info("Stopped streaming recognition")
    return True


def add_audio_chunk(audio_data: bytes):
    """Add audio chunk to the recognition queue."""
    if is_recognizing:
        audio_queue.put(audio_data)


# Flask routes

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'vosk_available': VOSK_AVAILABLE,
        'model_initialized': is_initialized,
        'is_recognizing': is_recognizing
    })


@app.route('/status', methods=['GET'])
def status():
    """Get detailed status."""
    model_dir = get_model_dir()
    model_exists = (model_dir / MODEL_NAME).exists()

    return jsonify({
        'vosk_available': VOSK_AVAILABLE,
        'model_initialized': is_initialized,
        'model_exists': model_exists,
        'model_path': str(model_dir / MODEL_NAME) if model_exists else None,
        'model_name': MODEL_NAME,
        'model_size_mb': MODEL_SIZE_MB,
        'is_recognizing': is_recognizing
    })


@app.route('/initialize', methods=['POST'])
def initialize():
    """Initialize the Vosk model (downloads if needed)."""
    try:
        success = initialize_model()
        return jsonify({
            'success': success,
            'model_initialized': is_initialized
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/start', methods=['POST'])
def start_recognition():
    """Start streaming recognition."""
    data = request.json or {}
    sample_rate = data.get('sample_rate', 16000)

    if not is_initialized:
        return jsonify({
            'success': False,
            'error': 'Model not initialized'
        }), 400

    success = start_streaming_recognition(sample_rate)
    return jsonify({
        'success': success,
        'is_recognizing': is_recognizing
    })


@app.route('/stop', methods=['POST'])
def stop_recognition():
    """Stop streaming recognition."""
    stop_streaming_recognition()
    return jsonify({
        'success': True,
        'is_recognizing': is_recognizing
    })


@app.route('/audio', methods=['POST'])
def receive_audio():
    """Receive audio chunk for streaming recognition."""
    if not is_recognizing:
        return jsonify({
            'success': False,
            'error': 'Recognition not running'
        }), 400

    # Get raw audio data
    audio_data = request.data
    if not audio_data:
        return jsonify({
            'success': False,
            'error': 'No audio data'
        }), 400

    add_audio_chunk(audio_data)
    return jsonify({'success': True})


@app.route('/results', methods=['GET'])
def get_results():
    """Get recognition results and clear them."""
    global latest_results

    with results_lock:
        results = latest_results.copy()
        # Keep only the last partial result
        latest_results = [r for r in latest_results if r.get('type') == 'partial'][-1:] if latest_results else []

    return jsonify({
        'results': results,
        'is_recognizing': is_recognizing
    })


@app.route('/recognize', methods=['POST'])
def recognize_single():
    """Single-shot recognition from audio file or data."""
    if not is_initialized:
        return jsonify({
            'success': False,
            'error': 'Model not initialized'
        }), 400

    # Handle file upload
    if 'audio' in request.files:
        audio_file = request.files['audio']
        # Save to temp file and process
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            audio_file.save(tmp.name)
            try:
                with wave.open(tmp.name, 'rb') as wf:
                    sample_rate = wf.getframerate()
                    audio_data = wf.readframes(wf.getnframes())
                result = recognize_audio_data(audio_data, sample_rate)
            finally:
                os.unlink(tmp.name)
    else:
        # Handle raw audio data
        audio_data = request.data
        sample_rate = int(request.args.get('sample_rate', 16000))
        result = recognize_audio_data(audio_data, sample_rate)

    return jsonify({
        'success': 'error' not in result,
        'result': result
    })


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Vosk Speech Recognition Service')
    parser.add_argument('--host', default='127.0.0.1', help='Host to bind to')
    parser.add_argument('--port', type=int, default=5124, help='Port to bind to')
    parser.add_argument('--auto-init', action='store_true', help='Auto-initialize model on startup')

    args = parser.parse_args()

    if args.auto_init:
        logger.info("Auto-initializing Vosk model...")
        initialize_model()

    logger.info(f"Starting Vosk service on {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, threaded=True)


if __name__ == '__main__':
    main()
