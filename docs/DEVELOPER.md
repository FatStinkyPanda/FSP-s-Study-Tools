# FSP's Study Tools - Developer Guide

**Version:** 1.0.0

This guide provides comprehensive documentation for developers who want to understand, modify, or extend FSP's Study Tools.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Technology Stack](#technology-stack)
4. [Development Setup](#development-setup)
5. [Core Systems](#core-systems)
6. [Adding New Features](#adding-new-features)
7. [Testing](#testing)
8. [Building & Packaging](#building--packaging)
9. [Contributing](#contributing)

---

## Architecture Overview

FSP's Study Tools is built on Electron, using a multi-process architecture:

```
+------------------+     IPC      +------------------+
|  Renderer Process | <========> |   Main Process    |
|  (React UI)       |             |   (Node.js)       |
+------------------+             +------------------+
        |                               |
        v                               v
+------------------+             +------------------+
|  Preload Script  |             |  Core Services   |
|  (Context Bridge)|             |  (KB, AI, Parser)|
+------------------+             +------------------+
                                        |
                                        v
                                +------------------+
                                |    SQLite DB     |
                                +------------------+
```

### Process Responsibilities

| Process | Responsibility |
|---------|----------------|
| Main | Database, file system, AI providers, parsing |
| Renderer | UI components, state management, user interaction |
| Preload | Secure IPC bridge between processes |

---

## Project Structure

```
FSP's Study Tools/
├── src/
│   ├── main/                    # Main process code
│   │   ├── main.ts              # Electron main entry
│   │   ├── ipc/                 # IPC handlers
│   │   │   └── handlers.ts      # All IPC handler registrations
│   │   └── preload.ts           # Preload script
│   │
│   ├── core/                    # Core business logic
│   │   ├── ai/                  # AI provider system
│   │   │   ├── providers/       # Provider implementations
│   │   │   │   ├── GoogleAIProvider.ts
│   │   │   │   ├── OpenAIProvider.ts
│   │   │   │   ├── AnthropicProvider.ts
│   │   │   │   └── OllamaProvider.ts
│   │   │   ├── AIProviderManager.ts
│   │   │   └── AgenticKBRetrieval.ts  # RAG system
│   │   │
│   │   ├── parser/              # Document parsers
│   │   │   ├── IParser.ts       # Parser interface
│   │   │   ├── ParserManager.ts # Parser coordination
│   │   │   ├── PDFParser.ts
│   │   │   ├── DOCXParser.ts
│   │   │   ├── TXTParser.ts
│   │   │   ├── MarkdownParser.ts
│   │   │   ├── EPUBParser.ts
│   │   │   └── PPTXParser.ts
│   │   │
│   │   ├── kb/                  # Knowledge base management
│   │   │   ├── KnowledgeBaseManager.ts
│   │   │   └── ChapterSplitter.ts
│   │   │
│   │   ├── progress/            # Progress tracking
│   │   │   ├── ProgressManager.ts
│   │   │   └── SpacedRepetition.ts
│   │   │
│   │   ├── voice/               # Voice services
│   │   │   ├── VoiceService.ts
│   │   │   ├── SpeechToText.ts
│   │   │   └── TextToSpeech.ts
│   │   │
│   │   └── database/            # Database layer
│   │       ├── Database.ts
│   │       └── migrations/
│   │
│   ├── renderer/                # React frontend
│   │   ├── index.tsx            # React entry point
│   │   ├── App.tsx              # Main app component
│   │   │
│   │   ├── components/          # React components
│   │   │   ├── Dashboard/
│   │   │   ├── KnowledgeBase/
│   │   │   ├── Study/
│   │   │   ├── Tests/
│   │   │   ├── Progress/
│   │   │   ├── Settings/
│   │   │   ├── JasperChat.tsx   # AI assistant UI
│   │   │   ├── JasperOrb.tsx    # Animated orb
│   │   │   └── common/          # Shared components
│   │   │
│   │   ├── hooks/               # Custom React hooks
│   │   │   ├── useKnowledgeBase.ts
│   │   │   ├── useAI.ts
│   │   │   └── useProgress.ts
│   │   │
│   │   ├── context/             # React contexts
│   │   │   └── AppContext.tsx
│   │   │
│   │   └── styles/              # Global styles
│   │       └── global.css
│   │
│   └── shared/                  # Shared types
│       └── types.ts
│
├── docs/                        # Documentation
│   ├── API.md
│   ├── USER_GUIDE.md
│   └── DEVELOPER.md
│
├── tests/                       # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── scripts/                     # Build scripts
├── assets/                      # Static assets
├── dist/                        # Built output
├── package.json
├── tsconfig.json
├── webpack.config.js
└── electron-builder.yml
```

---

## Technology Stack

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| Electron | 28.x | Desktop application framework |
| React | 18.x | UI framework |
| TypeScript | 5.x | Type-safe JavaScript |
| SQLite | better-sqlite3 | Local database |
| Webpack | 5.x | Module bundler |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| @google/generative-ai | Google Gemini AI integration |
| openai | OpenAI API client |
| @anthropic-ai/sdk | Anthropic Claude API |
| pdfjs-dist | PDF parsing |
| mammoth | DOCX parsing |
| marked | Markdown parsing |
| epub2 | EPUB parsing |
| jszip | ZIP/PPTX handling |

---

## Development Setup

### Prerequisites

- Node.js 18+ with npm
- Git
- VS Code (recommended)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/fsp-study-tools.git
cd fsp-study-tools

# Install dependencies
npm install

# Start development server
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode with hot reload |
| `npm run build` | Build production bundles |
| `npm start` | Run built application |
| `npm test` | Run test suite |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix linting issues |
| `npm run package` | Create distributable package |

### Environment Variables

Create a `.env` file for development:

```env
# Optional: Default AI provider API keys for testing
GOOGLE_AI_KEY=your_key_here
OPENAI_API_KEY=your_key_here

# Development settings
NODE_ENV=development
DEBUG=true
```

---

## Core Systems

### 1. IPC Communication

All communication between renderer and main processes uses typed IPC channels.

**Registering a Handler (main process):**

```typescript
// src/main/ipc/handlers.ts
import { ipcMain } from 'electron';

ipcMain.handle('kb:create', async (event, args: CreateKBRequest) => {
  const { title, description } = args;
  const kb = await kbManager.createKnowledgeBase(title, description);
  return kb;
});
```

**Calling from Renderer:**

```typescript
// In a React component
const result = await window.electronAPI.invoke('kb:create', {
  title: 'My KB',
  description: 'Description'
});
```

**Preload Bridge:**

```typescript
// src/main/preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) =>
    ipcRenderer.on(channel, (event, ...args) => callback(...args)),
});
```

### 2. AI Provider System

The AI system uses a pluggable provider architecture.

**Provider Interface:**

```typescript
// src/core/ai/providers/IAIProvider.ts
interface IAIProvider {
  id: string;
  name: string;

  initialize(config: ProviderConfig): Promise<void>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncGenerator<string>;
  generateEmbedding(text: string): Promise<number[]>;
  isAvailable(): boolean;
}
```

**Adding a New Provider:**

1. Create provider class implementing `IAIProvider`
2. Register in `AIProviderManager`
3. Add configuration UI in Settings

```typescript
// src/core/ai/providers/NewProvider.ts
export class NewProvider implements IAIProvider {
  id = 'new-provider';
  name = 'New AI Provider';

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Implementation
  }
}

// src/core/ai/AIProviderManager.ts
this.registerProvider(new NewProvider());
```

### 3. Document Parser System

Parsers follow a common interface for extensibility.

**Parser Interface:**

```typescript
// src/core/parser/IParser.ts
interface IParser {
  parse(filePath: string): Promise<ParsedDocument>;
  parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument>;
  supports(extension: string): boolean;
  getSupportedExtensions(): string[];
}

interface ParsedDocument {
  text: string;
  elements?: ParsedContentElement[];
  filePath: string;
  metadata: Record<string, unknown>;
  warnings?: string[];
}
```

**Adding a New Parser:**

1. Create parser class implementing `IParser`
2. Register in `ParserManager`

```typescript
// src/core/parser/NewFormatParser.ts
export class NewFormatParser implements IParser {
  private supportedExtensions = ['.xyz'];

  async parse(filePath: string): Promise<ParsedDocument> {
    const buffer = await fs.promises.readFile(filePath);
    return this.parseBuffer(buffer, filePath);
  }

  async parseBuffer(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
    // Parse the buffer and extract content
    return {
      text: extractedText,
      elements: structuredElements,
      filePath,
      metadata: { format: 'xyz' }
    };
  }

  supports(extension: string): boolean {
    return this.supportedExtensions.includes(extension.toLowerCase());
  }

  getSupportedExtensions(): string[] {
    return [...this.supportedExtensions];
  }
}

// src/core/parser/ParserManager.ts
this.registerParser(new NewFormatParser());
```

### 4. Database Layer

SQLite database with migrations support.

**Schema:**

```sql
-- Knowledge Bases
CREATE TABLE knowledge_bases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Modules
CREATE TABLE modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id INTEGER REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chapters
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  order_index INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Progress
CREATE TABLE progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id INTEGER REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT FALSE,
  mastery_level REAL DEFAULT 0,
  last_studied DATETIME,
  study_time INTEGER DEFAULT 0
);

-- Spaced Repetition
CREATE TABLE review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id INTEGER REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  ease_factor REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 1,
  repetitions INTEGER DEFAULT 0,
  next_review DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Running Migrations:**

```typescript
// src/core/database/Database.ts
async runMigrations(): Promise<void> {
  const migrations = await this.loadMigrations();
  for (const migration of migrations) {
    if (!this.hasRun(migration)) {
      await this.execute(migration);
      await this.markComplete(migration);
    }
  }
}
```

### 5. Agentic KB Retrieval (RAG)

The system uses a function-calling approach for intelligent content retrieval.

**How It Works:**

1. User sends a question
2. AI decides what KB content to retrieve using function calls
3. Relevant content is fetched and provided as context
4. AI generates response with accurate information

**Key Components:**

```typescript
// src/core/ai/AgenticKBRetrieval.ts
class AgenticKBRetrieval {
  private tools: FunctionTool[] = [
    {
      name: 'search_knowledge_base',
      description: 'Search for information in the knowledge base',
      parameters: {
        query: { type: 'string', description: 'Search query' },
        kbIds: { type: 'array', description: 'KB IDs to search' }
      }
    },
    {
      name: 'get_chapter_content',
      description: 'Get full content of a specific chapter',
      parameters: {
        chapterId: { type: 'number', description: 'Chapter ID' }
      }
    }
  ];

  async processWithRetrieval(
    message: string,
    kbIds: number[]
  ): Promise<ChatResponse> {
    // AI uses tools to retrieve relevant content
    // then generates informed response
  }
}
```

---

## Adding New Features

### Feature Checklist

1. **Design the feature**
   - Define data models
   - Design UI/UX
   - Plan IPC channels

2. **Implement backend**
   - Add database schema (if needed)
   - Create core service classes
   - Register IPC handlers

3. **Implement frontend**
   - Create React components
   - Add routing (if needed)
   - Implement state management

4. **Test**
   - Write unit tests
   - Add integration tests
   - Manual testing

5. **Document**
   - Update API.md
   - Update USER_GUIDE.md
   - Add inline documentation

### Example: Adding a Bookmark Feature

**1. Database Schema:**

```sql
-- migrations/005_bookmarks.sql
CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  note TEXT,
  position INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**2. Core Service:**

```typescript
// src/core/bookmarks/BookmarkManager.ts
export class BookmarkManager {
  constructor(private db: Database) {}

  async createBookmark(chapterId: number, note?: string, position?: number) {
    return this.db.run(
      'INSERT INTO bookmarks (chapter_id, note, position) VALUES (?, ?, ?)',
      [chapterId, note, position]
    );
  }

  async getBookmarks(chapterId: number) {
    return this.db.all(
      'SELECT * FROM bookmarks WHERE chapter_id = ?',
      [chapterId]
    );
  }
}
```

**3. IPC Handler:**

```typescript
// src/main/ipc/handlers.ts
ipcMain.handle('bookmark:create', async (event, args) => {
  return bookmarkManager.createBookmark(args.chapterId, args.note);
});

ipcMain.handle('bookmark:list', async (event, chapterId) => {
  return bookmarkManager.getBookmarks(chapterId);
});
```

**4. React Hook:**

```typescript
// src/renderer/hooks/useBookmarks.ts
export function useBookmarks(chapterId: number) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    loadBookmarks();
  }, [chapterId]);

  const loadBookmarks = async () => {
    const data = await window.electronAPI.invoke('bookmark:list', chapterId);
    setBookmarks(data);
  };

  const addBookmark = async (note?: string) => {
    await window.electronAPI.invoke('bookmark:create', { chapterId, note });
    loadBookmarks();
  };

  return { bookmarks, addBookmark };
}
```

**5. React Component:**

```tsx
// src/renderer/components/Bookmarks/BookmarkButton.tsx
export function BookmarkButton({ chapterId }: { chapterId: number }) {
  const { addBookmark } = useBookmarks(chapterId);

  return (
    <button onClick={() => addBookmark()}>
      Add Bookmark
    </button>
  );
}
```

---

## Testing

### Test Structure

```
tests/
├── unit/                    # Unit tests
│   ├── parser/
│   │   ├── PDFParser.test.ts
│   │   └── MarkdownParser.test.ts
│   ├── ai/
│   │   └── AIProviderManager.test.ts
│   └── kb/
│       └── KnowledgeBaseManager.test.ts
│
├── integration/             # Integration tests
│   ├── ipc.test.ts
│   └── database.test.ts
│
└── e2e/                     # End-to-end tests
    └── app.test.ts
```

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# With coverage
npm run test:coverage
```

### Writing Tests

```typescript
// tests/unit/parser/MarkdownParser.test.ts
import { MarkdownParser } from '../../../src/core/parser/MarkdownParser';

describe('MarkdownParser', () => {
  let parser: MarkdownParser;

  beforeEach(() => {
    parser = new MarkdownParser();
  });

  it('should support markdown extensions', () => {
    expect(parser.supports('.md')).toBe(true);
    expect(parser.supports('.markdown')).toBe(true);
    expect(parser.supports('.txt')).toBe(false);
  });

  it('should extract headings from markdown', async () => {
    const content = Buffer.from('# Title\n\n## Section\n\nContent');
    const result = await parser.parseBuffer(content, 'test.md');

    expect(result.elements).toContainEqual({
      type: 'heading',
      content: 'Title',
      level: 1
    });
  });
});
```

---

## Building & Packaging

### Development Build

```bash
npm run build
```

Output: `dist/` directory with compiled code

### Production Package

```bash
# All platforms
npm run package

# Specific platform
npm run package:win
npm run package:mac
npm run package:linux
```

### electron-builder Configuration

```yaml
# electron-builder.yml
appId: com.fsp.studytools
productName: FSP's Study Tools
directories:
  output: release
  buildResources: assets

win:
  target:
    - nsis
    - portable
  icon: assets/icon.ico

mac:
  target:
    - dmg
    - zip
  icon: assets/icon.icns
  category: public.app-category.education

linux:
  target:
    - AppImage
    - deb
  icon: assets/icon.png
  category: Education

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### Code Signing

For production releases, configure code signing:

```yaml
# Windows
win:
  certificateFile: ${env.WIN_CSC_LINK}
  certificatePassword: ${env.WIN_CSC_KEY_PASSWORD}

# macOS
mac:
  identity: Developer ID Application: Your Name
  notarize:
    teamId: YOUR_TEAM_ID
```

---

## Contributing

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Use Prettier for formatting
- Write meaningful commit messages

### Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes with tests
4. Run linting: `npm run lint:fix`
5. Run tests: `npm test`
6. Commit with conventional commits: `feat: add new feature`
7. Push and create PR

### Commit Message Format

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Code Review Checklist

- [ ] TypeScript types are correct
- [ ] No console.log statements (use proper logging)
- [ ] Error handling is appropriate
- [ ] Tests cover new functionality
- [ ] Documentation is updated
- [ ] No security vulnerabilities introduced
- [ ] Performance impact considered

---

## Performance Considerations

### Database Optimization

- Use indexes for frequently queried columns
- Batch operations when possible
- Use prepared statements

### Memory Management

- Clean up event listeners
- Dispose of large objects
- Use streaming for large files

### UI Performance

- Virtualize long lists
- Lazy load components
- Debounce search inputs
- Memoize expensive calculations

---

## Security Best Practices

### API Key Storage

```typescript
// Use safeStorage for sensitive data
import { safeStorage } from 'electron';

const encryptedKey = safeStorage.encryptString(apiKey);
// Store encryptedKey in database

const decryptedKey = safeStorage.decryptString(encryptedKey);
```

### Input Validation

- Validate all user inputs
- Sanitize file paths
- Escape database queries (use parameterized queries)

### Content Security Policy

```typescript
// main.ts
mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'"]
    }
  });
});
```

---

## Debugging

### Main Process

```bash
# Start with debugging
npm run dev -- --inspect

# Attach VS Code debugger
```

### Renderer Process

- Use Chrome DevTools (Ctrl+Shift+I)
- React DevTools extension
- Redux DevTools (if using Redux)

### Logging

```typescript
// Development logging
if (process.env.NODE_ENV === 'development') {
  console.log('[DEBUG]', message);
}

// Production logging
import log from 'electron-log';
log.info('Application started');
log.error('Error occurred', error);
```

---

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Project GitHub Repository](https://github.com/yourusername/fsp-study-tools)

---

Happy coding!
