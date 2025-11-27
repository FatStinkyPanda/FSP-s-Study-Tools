# FSP's Study Tools - API Reference

**Version:** 1.0.0

This document provides a comprehensive API reference for FSP's Study Tools, covering both the IPC (Inter-Process Communication) APIs for Electron and the core module interfaces.

## Table of Contents

1. [IPC API Reference](#ipc-api-reference)
2. [Knowledge Base API](#knowledge-base-api)
3. [AI Provider API](#ai-provider-api)
4. [Parser API](#parser-api)
5. [Progress Tracking API](#progress-tracking-api)
6. [Test Generation API](#test-generation-api)

---

## IPC API Reference

The application uses Electron IPC for communication between the renderer process (UI) and the main process (backend). All IPC calls are made via the `window.electronAPI` object exposed through the preload script.

### Knowledge Base Operations

#### `kb:create`
Create a new knowledge base.

```typescript
interface CreateKBRequest {
  title: string;
  description?: string;
}

interface CreateKBResponse {
  id: number;
  title: string;
  description: string;
  createdAt: string;
}

// Usage
const kb = await window.electronAPI.invoke('kb:create', {
  title: 'CompTIA A+ Study Guide',
  description: 'Study materials for A+ certification'
});
```

#### `kb:list`
Get all knowledge bases.

```typescript
interface KnowledgeBase {
  id: number;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  moduleCount?: number;
}

// Usage
const kbs: KnowledgeBase[] = await window.electronAPI.invoke('kb:list');
```

#### `kb:get`
Get a specific knowledge base with its modules.

```typescript
// Usage
const kb = await window.electronAPI.invoke('kb:get', kbId);
```

#### `kb:delete`
Delete a knowledge base and all its contents.

```typescript
// Usage
await window.electronAPI.invoke('kb:delete', kbId);
```

#### `kb:import-xml`
Import an XML file to a knowledge base.

```typescript
interface ImportOptions {
  kbId: number;
  filePath: string;
}

// Usage
const result = await window.electronAPI.invoke('kb:import-xml', {
  kbId: 1,
  filePath: '/path/to/file.xml'
});
```

#### `kb:import-file`
Import a document file (PDF, DOCX, TXT, MD, EPUB, PPTX) to a knowledge base.

```typescript
// Usage
const result = await window.electronAPI.invoke('kb:import-file', {
  kbId: 1,
  filePath: '/path/to/document.pdf'
});
```

### AI Operations

#### `ai:chat`
Send a message to the AI and receive a response.

```typescript
interface ChatRequest {
  message: string;
  context?: string;
  kbIds?: number[];  // Knowledge bases to use for context
  history?: Array<{role: 'user' | 'assistant'; content: string}>;
}

interface ChatResponse {
  response: string;
  sources?: Array<{
    kbId: number;
    moduleId: number;
    chapterId: number;
    relevance: number;
  }>;
}

// Usage
const response = await window.electronAPI.invoke('ai:chat', {
  message: 'What is the OSI model?',
  kbIds: [1, 2]
});
```

#### `ai:generate-test`
Generate a test from knowledge base content.

```typescript
interface GenerateTestRequest {
  kbId: number;
  moduleIds?: number[];
  questionCount: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  types: Array<'multiple-choice' | 'true-false' | 'fill-blank' | 'short-answer'>;
}

// Usage
const test = await window.electronAPI.invoke('ai:generate-test', {
  kbId: 1,
  questionCount: 20,
  difficulty: 'medium',
  types: ['multiple-choice', 'true-false']
});
```

### Progress Operations

#### `progress:get`
Get user progress for a knowledge base.

```typescript
interface ProgressData {
  kbId: number;
  completedModules: number[];
  masteredChapters: number[];
  testScores: Array<{date: string; score: number}>;
  studyTime: number;  // in minutes
  lastStudied: string;
}

// Usage
const progress = await window.electronAPI.invoke('progress:get', kbId);
```

#### `progress:update`
Update progress data.

```typescript
// Usage
await window.electronAPI.invoke('progress:update', {
  kbId: 1,
  chapterId: 5,
  completed: true,
  timeSpent: 15  // minutes
});
```

### File Dialog Operations

#### `dialog:open-file`
Open a file dialog for selecting documents.

```typescript
// Usage
const filePaths = await window.electronAPI.invoke('dialog:open-file', {
  filters: [
    { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'epub', 'pptx'] }
  ],
  multiSelections: false
});
```

---

## Knowledge Base API

The `KnowledgeBaseManager` class handles all knowledge base operations.

### Class: KnowledgeBaseManager

```typescript
class KnowledgeBaseManager {
  constructor(db: Database);

  // CRUD Operations
  async createKnowledgeBase(title: string, description?: string): Promise<KnowledgeBase>;
  async getKnowledgeBase(id: number): Promise<KnowledgeBase | null>;
  async getAllKnowledgeBases(): Promise<KnowledgeBase[]>;
  async updateKnowledgeBase(id: number, updates: Partial<KnowledgeBase>): Promise<void>;
  async deleteKnowledgeBase(id: number): Promise<void>;

  // Module Operations
  async getModules(kbId: number): Promise<Module[]>;
  async getChapters(moduleId: number): Promise<Chapter[]>;
  async getChapterContent(chapterId: number): Promise<ChapterContent>;

  // Import Operations
  async importXML(kbId: number, filePath: string): Promise<ImportResult>;
  async importDocument(kbId: number, filePath: string): Promise<ImportResult>;

  // Search
  async searchContent(query: string, kbIds?: number[]): Promise<SearchResult[]>;
}
```

### Interfaces

```typescript
interface KnowledgeBase {
  id: number;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Module {
  id: number;
  kbId: number;
  title: string;
  description: string;
  order: number;
  chapterCount: number;
}

interface Chapter {
  id: number;
  moduleId: number;
  title: string;
  order: number;
  content?: string;
}

interface ImportResult {
  success: boolean;
  modulesImported: number;
  chaptersImported: number;
  errors?: string[];
}

interface SearchResult {
  kbId: number;
  moduleId: number;
  chapterId: number;
  title: string;
  snippet: string;
  relevance: number;
}
```

---

## AI Provider API

The AI system supports multiple providers through a unified interface.

### Class: AIProviderManager

```typescript
class AIProviderManager {
  constructor();

  // Provider Management
  setProvider(providerId: string): void;
  getAvailableProviders(): ProviderInfo[];
  getCurrentProvider(): string;

  // API Key Management
  setApiKey(providerId: string, apiKey: string): void;
  validateApiKey(providerId: string): Promise<boolean>;

  // Chat
  async chat(request: ChatRequest): Promise<ChatResponse>;
  async streamChat(request: ChatRequest): AsyncGenerator<string>;

  // Embedding
  async generateEmbedding(text: string): Promise<number[]>;
}
```

### Supported Providers

| Provider ID | Name | Features |
|-------------|------|----------|
| `google` | Google Gemini | Chat, Embedding, Function Calling |
| `openai` | OpenAI GPT | Chat, Embedding |
| `anthropic` | Anthropic Claude | Chat |
| `local-ollama` | Ollama (Local) | Chat, Embedding |

### Configuration

```typescript
interface ProviderConfig {
  google: {
    apiKey: string;
    model: string;  // 'gemini-1.5-flash', 'gemini-1.5-pro'
  };
  openai: {
    apiKey: string;
    model: string;  // 'gpt-4', 'gpt-3.5-turbo'
  };
  anthropic: {
    apiKey: string;
    model: string;  // 'claude-3-opus', 'claude-3-sonnet'
  };
  local: {
    endpoint: string;  // 'http://localhost:11434'
    model: string;
  };
}
```

---

## Parser API

The parser system handles multiple document formats.

### Class: ParserManager

```typescript
class ParserManager {
  constructor();

  // Parse Documents
  async parseFile(filePath: string): Promise<ParsedDocument>;
  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument>;

  // Query Support
  isSupported(filePathOrExtension: string): boolean;
  getSupportedExtensions(): string[];
  getFileFilters(): FileFilter[];
}
```

### Supported Formats

| Extension | Parser | Description |
|-----------|--------|-------------|
| `.pdf` | PDFParser | PDF documents with text and images |
| `.docx` | DOCXParser | Microsoft Word documents |
| `.txt`, `.text` | TXTParser | Plain text files |
| `.md`, `.markdown` | MarkdownParser | Markdown with structure extraction |
| `.epub` | EPUBParser | EPUB e-books |
| `.pptx`, `.ppt` | PPTXParser | PowerPoint presentations |

### ParsedDocument Interface

```typescript
interface ParsedDocument {
  text: string;                    // Plain text content
  elements?: ParsedContentElement[];  // Structured elements
  filePath: string;
  metadata: {
    title?: string;
    author?: string;
    pages?: number;
    fileSize?: number;
    createdDate?: Date;
    modifiedDate?: Date;
    [key: string]: unknown;
  };
  warnings?: string[];
}

interface ParsedContentElement {
  type: 'paragraph' | 'heading' | 'image' | 'list' | 'code' | 'blockquote';
  content?: string;
  level?: number;        // For headings (1-6)
  items?: string[];      // For lists
  ordered?: boolean;     // For lists
  src?: string;          // For images
  alt?: string;          // For images
}
```

---

## Progress Tracking API

### Class: ProgressManager

```typescript
class ProgressManager {
  constructor(db: Database);

  // Get Progress
  async getProgress(kbId: number): Promise<ProgressData>;
  async getAllProgress(): Promise<Map<number, ProgressData>>;

  // Update Progress
  async markChapterComplete(kbId: number, chapterId: number): Promise<void>;
  async recordStudyTime(kbId: number, minutes: number): Promise<void>;
  async recordTestScore(kbId: number, score: number, maxScore: number): Promise<void>;

  // Spaced Repetition
  async getReviewSchedule(kbId: number): Promise<ReviewItem[]>;
  async updateReviewItem(itemId: number, quality: number): Promise<void>;

  // Analytics
  async getStudyStats(kbId: number): Promise<StudyStats>;
}
```

### Spaced Repetition (SM-2 Algorithm)

```typescript
interface ReviewItem {
  id: number;
  kbId: number;
  chapterId: number;
  title: string;
  nextReview: Date;
  easeFactor: number;
  interval: number;      // days
  repetitions: number;
}

interface StudyStats {
  totalStudyTime: number;    // minutes
  averageSessionTime: number;
  testsTaken: number;
  averageScore: number;
  strongestTopics: string[];
  weakestTopics: string[];
  streakDays: number;
}
```

---

## Test Generation API

### Class: TestGenerator

```typescript
class TestGenerator {
  constructor(aiProvider: AIProviderManager);

  // Generate Tests
  async generateTest(options: TestOptions): Promise<GeneratedTest>;
  async generateQuestion(content: string, type: QuestionType): Promise<Question>;

  // Evaluate Answers
  async evaluateAnswer(question: Question, userAnswer: string): Promise<EvaluationResult>;
}
```

### Interfaces

```typescript
interface TestOptions {
  kbId: number;
  moduleIds?: number[];
  chapterIds?: number[];
  questionCount: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  types: QuestionType[];
  shuffleQuestions?: boolean;
  shuffleAnswers?: boolean;
}

type QuestionType = 'multiple-choice' | 'true-false' | 'fill-blank' | 'short-answer' | 'matching';

interface Question {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];           // For multiple-choice
  correctAnswer: string | string[];
  explanation?: string;
  sourceChapter: number;
  difficulty: string;
}

interface GeneratedTest {
  id: string;
  createdAt: Date;
  questions: Question[];
  totalPoints: number;
  timeLimit?: number;          // minutes
}

interface EvaluationResult {
  correct: boolean;
  score: number;
  feedback: string;
  correctAnswer: string;
}
```

---

## Error Handling

All API methods may throw errors. Use try-catch blocks for error handling:

```typescript
try {
  const kb = await window.electronAPI.invoke('kb:create', { title: 'New KB' });
} catch (error) {
  if (error.code === 'DUPLICATE_TITLE') {
    // Handle duplicate title
  } else if (error.code === 'DATABASE_ERROR') {
    // Handle database error
  } else {
    // Handle unknown error
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `DUPLICATE_TITLE` | Knowledge base with same title exists |
| `NOT_FOUND` | Resource not found |
| `INVALID_INPUT` | Invalid input parameters |
| `DATABASE_ERROR` | Database operation failed |
| `PARSE_ERROR` | Document parsing failed |
| `AI_ERROR` | AI provider error |
| `NETWORK_ERROR` | Network request failed |
| `FILE_ERROR` | File operation failed |

---

## Events

The application emits events for real-time updates:

```typescript
// Listen for progress updates
window.electronAPI.on('progress:updated', (data) => {
  console.log('Progress updated:', data);
});

// Listen for AI streaming responses
window.electronAPI.on('ai:stream', (chunk) => {
  console.log('Received chunk:', chunk);
});

// Listen for import progress
window.electronAPI.on('import:progress', (progress) => {
  console.log(`Import progress: ${progress.percent}%`);
});
```

---

## TypeScript Support

All types are exported from the shared module:

```typescript
import type {
  KnowledgeBase,
  Module,
  Chapter,
  ParsedDocument,
  ProgressData,
  TestOptions,
  Question,
  // ... other types
} from '@shared/types';
```
