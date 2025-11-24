# Local AI Models Directory

This directory is for storing local AI models that can run offline without API keys.

## Supported Model Types

### ONNX Models (.onnx)
- Optimized neural network models
- Fast inference with ONNX Runtime
- Requires `onnxruntime-node` package (not yet installed)

### GGUF Models (.gguf)
- LLaMA-compatible models
- Runs via llama.cpp bindings
- Requires `node-llama-cpp` package (not yet installed)

## Installation

To enable local AI models, install the required dependencies:

### For ONNX models:
```bash
npm install onnxruntime-node
```

### For GGUF models:
```bash
npm install node-llama-cpp
```

## Adding Models

1. Place your model files in this directory
2. Configure the model in your application settings
3. Load the model using the AIManager API

## Example Configuration

```typescript
// Add a local model configuration
aiManager.addLocalModel({
  id: 'tiny-llama',
  name: 'TinyLlama 1.1B',
  path: 'TinyLlama-1.1B-Chat.gguf',
  type: 'gguf',
  contextWindow: 2048,
  loadOnStartup: false
});

// Load the model
await aiManager.loadLocalModel('tiny-llama');

// Use the model
const response = await aiManager.createCompletion({
  model: 'local:tiny-llama',
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ]
});
```

## Where to Get Models

### GGUF Models (Recommended)
- Hugging Face: https://huggingface.co/models?library=gguf
- Popular options:
  - TinyLlama-1.1B-Chat (1.1B parameters, ~637MB)
  - Phi-2 (2.7B parameters, ~1.6GB)
  - Mistral-7B-Instruct (7B parameters, ~4GB)

### ONNX Models
- Hugging Face: https://huggingface.co/models?library=onnx
- ONNX Model Zoo: https://github.com/onnx/models

## Model Size Guidelines

- Small (< 2GB): Fast, good for basic tasks
- Medium (2-5GB): Balanced performance and quality
- Large (> 5GB): Best quality, requires more RAM

## Performance Tips

1. Start with smaller models (1-3B parameters)
2. Only load models when needed (set `loadOnStartup: false`)
3. Unload models when switching tasks
4. Monitor memory usage

## Current Status

[INFO] Local AI provider infrastructure is ready
[INFO] Model inference not yet implemented
[TODO] Install onnxruntime-node for ONNX support
[TODO] Install node-llama-cpp for GGUF support

The framework is in place, but you'll need to install the appropriate libraries for the model type you want to use.
