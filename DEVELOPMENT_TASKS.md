# FSP's Study Tools - Development Tasks

**Last Updated:** 2024-11-24
**Project Status:** ~75% Complete
**Current Phase:** Phase 5 - UI/UX Development (Near Completion)

---

## COMPLETED TASKS

### Phase 1: Core Infrastructure [100% Complete]
- [x] Electron project setup with TypeScript
- [x] SQLite database layer with full schema
- [x] XML processing system (XMLParser.ts)
- [x] File system management
- [x] IPC communication layer

### Phase 2: AI Integration [95% Complete]
- [x] AIManager with multi-provider support
- [x] OpenAI Provider
- [x] Anthropic Provider
- [x] Google AI Provider
- [x] OpenRouter Provider
- [x] Conversation persistence (ConversationManager)
- [x] Settings management with API key storage
- [ ] LocalAIProvider (ONNX/llama.cpp) - PLACEHOLDER ONLY

### Phase 3: Knowledge Base Engine [85% Complete]
- [x] PDF Parser (pdf2json)
- [x] DOCX Parser (mammoth)
- [x] TXT Parser
- [x] Parser Manager with extensibility
- [x] Knowledge Base Manager (CRUD, import/export)
- [x] Content Chunker
- [x] FTS5 full-text search
- [ ] Vector embeddings for semantic search
- [ ] OCR for images
- [ ] Advanced structure detection

### Phase 4: Learning Features [95% Complete]
- [x] Progress tracking (ProgressManager)
- [x] User score tracking
- [x] AI score tracking
- [x] Time tracking per section
- [x] Test Generator framework
- [x] Manual test creation
- [x] AI-powered question generation (complete with UI integration)
- [x] Learning velocity calculation
- [x] Study streak tracking
- [ ] Recommendation engine

### Phase 5: UI/UX Development [80% Complete]
- [x] Main app navigation
- [x] KB Editor component with structure management
- [x] KB Editor Save functionality (XML conversion)
- [x] Study Session component
- [x] Settings panel with API key management
- [x] Chat panel integration
- [x] Learning Dashboard with visualizations (stats cards, activity, velocity)
- [x] AI question generation UI with progress overlay
- [ ] Progress charts and graphs (beyond basic stats)
- [ ] Search results UI with navigation
- [ ] Theme switching (dark/light)
- [ ] KB structure visualization

### Phase 6: Polish & Packaging [40% Complete]
- [x] electron-builder configuration
- [x] UpdateManager framework
- [ ] Auto-update server configuration
- [ ] Update notification UI
- [ ] Comprehensive error handling
- [ ] Performance optimization
- [ ] Testing suite
- [ ] Documentation

---

## RECENTLY COMPLETED TASKS

### 1. Study Session Enhancement [COMPLETE]
**File:** `src/renderer/StudySession.tsx`
**Completed Features:**
- Added "Generate Questions" button for KBs without questions
- Implemented AI-powered question generation flow with progress overlay
- Added helper functions for handling both array and Record option formats
- Added generating overlay modal with progress messages
- Added error handling with specific AI provider configuration guidance

### 2. Learning Dashboard [COMPLETE]
**File:** `src/renderer/components/Dashboard.tsx`
**Completed Features:**
- KB selector dropdown
- Stats cards (completion %, avg score, time studied, day streak)
- Quick actions (Continue Studying, Refresh)
- Learning velocity display with contextual messages
- Progress summary (completed, remaining, need review)
- Recent activity list with scores
- Sections needing review list
- KB info footer

### 3. Build System Fix [COMPLETE]
**Files:** `webpack.renderer.config.js`, `package.json`, `src/main/index.ts`
**Status:** Fixed - app now runs correctly
**Changes Made:**
- Added HtmlWebpackPlugin
- Fixed output paths
- Fixed CSP (source-map devtool)
- Fixed preload and HTML paths

---

## PENDING TASKS (Priority Order)

### HIGH PRIORITY

#### 1. Search Results UI
**New file:** `src/renderer/components/SearchResults.tsx`
**Features needed:**
- Search input in header
- Results list with snippets
- Click to navigate to section
- Highlight search terms
- Filter by module/chapter

### MEDIUM PRIORITY

#### 2. Conversation Context Awareness
**Files to modify:**
- `src/core/ai/ConversationManager.ts`
- `src/renderer/ChatPanel.tsx`

**Implementation:**
- Include user progress in system prompt
- Reference current section content
- Track conversation topics

#### 3. Auto-Update UI
**New file:** `src/renderer/components/UpdateNotification.tsx`
**Features needed:**
- Update available banner
- Download progress bar
- Install prompt
- Release notes display

#### 4. Theme System
**Files to modify:**
- `src/renderer/App.css`
- `src/renderer/App.tsx`
- `src/core/settings/SettingsManager.ts`

**Implementation:**
- CSS variables for theming
- Dark/light/auto modes
- Persist preference

### LOW PRIORITY

#### 5. LocalAIProvider Implementation
**File:** `src/core/ai/LocalAIProvider.ts`
**Dependencies:**
- ONNX Runtime
- llama.cpp bindings
- Model download system

#### 6. Vector Embeddings
**New file:** `src/core/indexer/SemanticIndexer.ts`
**Features:**
- Generate embeddings from content
- Store in SQLite (blob)
- Cosine similarity search
- Integration with KnowledgeBaseManager

#### 7. Testing Suite
**Directory:** `src/__tests__/`
**Coverage needed:**
- Unit tests for core modules
- Integration tests for IPC
- E2E tests for workflows

#### 8. Documentation
**Files to create:**
- `docs/API.md`
- `docs/USER_GUIDE.md`
- `docs/DEVELOPER.md`

---

## FILE STRUCTURE REFERENCE

```
src/
  core/
    ai/
      AIManager.ts         [COMPLETE]
      BaseProvider.ts      [COMPLETE]
      OpenAIProvider.ts    [COMPLETE]
      AnthropicProvider.ts [COMPLETE]
      GoogleAIProvider.ts  [COMPLETE]
      OpenRouterProvider.ts[COMPLETE]
      LocalAIProvider.ts   [PLACEHOLDER]
      ConversationManager.ts[COMPLETE]
    database/
      DatabaseManager.ts   [COMPLETE]
      MigrationManager.ts  [COMPLETE]
    knowledge/
      KnowledgeBaseManager.ts [COMPLETE]
      XMLParser.ts         [COMPLETE]
      ContentChunker.ts    [COMPLETE]
    parser/
      ParserManager.ts     [COMPLETE]
      PDFParser.ts         [COMPLETE]
      DOCXParser.ts        [COMPLETE]
      TXTParser.ts         [COMPLETE]
    progress/
      ProgressManager.ts   [COMPLETE]
    tests/
      TestGenerator.ts     [COMPLETE]
    update/
      UpdateManager.ts     [COMPLETE]
    settings/
      SettingsManager.ts   [COMPLETE]
    indexer/               [NOT STARTED]
  main/
    index.ts               [COMPLETE]
    preload.ts             [COMPLETE]
  renderer/
    App.tsx                [COMPLETE]
    App.css                [COMPLETE]
    StudySession.tsx       [COMPLETE - with AI question generation]
    ChatPanel.tsx          [COMPLETE]
    components/
      KBEditor.tsx         [COMPLETE]
      KBEditor.css         [COMPLETE]
      Dashboard.tsx        [COMPLETE - new]
      SearchResults.tsx    [NOT STARTED]
      UpdateNotification.tsx[NOT STARTED]
  shared/
    types.ts               [COMPLETE]
    ai-types.ts            [COMPLETE]
```

---

## IPC HANDLERS REFERENCE

All handlers are in `src/main/index.ts`:

### Database
- `db:query` - Execute SQL query
- `db:run` - Execute SQL statement

### Knowledge Base
- `kb:list` - List all KBs
- `kb:get` - Get KB by ID
- `kb:create` - Create new KB
- `kb:update` - Update KB
- `kb:delete` - Delete KB
- `kb:import` - Import XML
- `kb:parse` - Parse KB content
- `kb:search` - Search KB content
- `kb:validate` - Validate XML
- `kb:export` - Export KB
- `kb:importFile` - Import from file

### AI
- `ai:completion` - Get AI completion
- `ai:listModels` - List available models
- `ai:validateProviders` - Validate API keys

### Conversation
- `conversation:create` - Start conversation
- `conversation:load` - Load conversation
- `conversation:addMessage` - Add message
- `conversation:list` - List conversations

### Settings
- `settings:get` - Get setting
- `settings:set` - Set setting
- `settings:getAll` - Get all settings
- `settings:setMultiple` - Set multiple

### Progress
- `progress:record` - Record progress
- `progress:get` - Get section progress
- `progress:getAll` - Get all progress
- `progress:getStats` - Get statistics
- `progress:getRecent` - Get recent activity
- `progress:getNeedingReview` - Get sections needing review
- `progress:getStreak` - Get study streak days
- `progress:getVelocity` - Get learning velocity

### Tests
- `test:create` - Create test
- `test:get` - Get test
- `test:getAll` - Get all tests for KB
- `test:generateQuestions` - Generate with AI
- `test:validateQuestion` - Validate question

### Update
- `update:check` - Check for updates
- `update:download` - Download update
- `update:install` - Install update

---

## NEXT SESSION QUICK START

1. Run `npm run build` to rebuild
2. Run `npm start` to launch app
3. Continue with remaining tasks:
   - Search Results UI (HIGH PRIORITY)
   - Conversation Context Awareness (MEDIUM)
   - Auto-Update UI (MEDIUM)
   - Theme System (MEDIUM)

4. Test AI question generation with configured API key
5. Test Learning Dashboard with imported KB

---

## KNOWN ISSUES

1. **CSP Warning** - Shows in dev mode, safe to ignore
2. **React DevTools** - Suggested but not required
3. **Empty KB Study** - Now shows warning instead of error

---

## BUILD COMMANDS

```bash
# Development
npm run build          # Build all
npm run build:main     # Build main process
npm run build:renderer # Build renderer

# Run
npm start             # Start app

# Package
npm run package:win   # Windows installer
```
