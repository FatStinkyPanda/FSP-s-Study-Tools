# FSP's Study Tools - Development README

**Version:** 1.0.0  
**Author:** FatStinkyPanda  
**Contact:** support@fatstinkypanda.com  
**License:** [To be determined]

## Project Overview

FSP's Study Tools is a comprehensive, self-contained Windows educational platform that leverages AI models to create an intelligent learning environment. The application enables users to build structured knowledge bases from educational materials and engage with AI tutors for personalized learning experiences.

### Core Vision
A single Windows executable that provides a complete learning management system with AI-powered tutoring, requiring no installation or configuration beyond initial launch.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Web UI)                     │
│                   Electron + React/Vue                   │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────┐
│                   IPC Bridge Layer                       │
│                    (Electron Main)                       │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────┐
│                    Core Engine (C++/Rust)                │
├──────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ XML Parser │  │ AI Manager │  │ Database Manager │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │File Parser │  │Index Engine│  │  Test Generator  │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────┐
│                    Storage Layer                         │
├──────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   SQLite    │  │ XML Storage  │  │ File System  │   │
│  │  Databases  │  │   Manager    │  │   Manager    │   │
│  └─────────────┘  └──────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## Technical Stack

### Core Technologies
- **Executable Framework:** Electron (bundled with Node.js runtime)
- **Frontend:** React/Vue.js + TypeScript
- **Backend Core:** Rust (for performance-critical operations)
- **Database:** SQLite (embedded)
- **AI Runtime:** 
  - ONNX Runtime (local models)
  - llama.cpp (local LLM support)
- **XML Processing:** libxml2 (C++) or quick-xml (Rust)
- **Full-Text Search:** SQLite FTS5 + custom semantic indexing

### Build Tools
- **Bundler:** Webpack/Vite
- **Executable Packager:** electron-builder
- **Native Modules:** node-gyp / neon-bindings (Rust)

## Directory Structure

```
FSP-Study-Tools/
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # Frontend application
│   ├── core/              # Rust/C++ native modules
│   │   ├── ai/           # AI model management
│   │   ├── parser/       # File parsing logic
│   │   ├── indexer/      # Semantic indexing
│   │   ├── xml/          # XML processing
│   │   └── database/     # Database operations
│   └── shared/            # Shared types/utilities
├── resources/
│   ├── models/            # Bundled AI models
│   ├── templates/         # XML templates
│   └── schemas/           # XML schemas
├── data/                  # Default data directory
│   ├── knowledge/         # Knowledge library
│   ├── progress/          # Saved progress
│   └── conversations/     # Chat history
├── tests/
├── docs/
└── build/                 # Build outputs
```

## Core Components

### 1. AI Model Management

```xml
<!-- AI Configuration Schema -->
<ai_config version="1.0">
    <local_models>
        <model id="tiny-llama" path="./models/tiny-llama.onnx" />
        <model id="phi-2" path="./models/phi-2.gguf" />
    </local_models>
    <api_providers>
        <provider name="OpenAI" endpoint="https://api.openai.com/v1">
            <models_endpoint>/models</models_endpoint>
            <api_key encrypted="true">[ENCRYPTED_KEY]</api_key>
        </provider>
        <provider name="Anthropic" endpoint="https://api.anthropic.com">
            <models_endpoint>/v1/models</models_endpoint>
            <api_key encrypted="true">[ENCRYPTED_KEY]</api_key>
        </provider>
        <provider name="Google" endpoint="https://generativelanguage.googleapis.com">
            <models_endpoint>/v1/models</models_endpoint>
            <api_key encrypted="true">[ENCRYPTED_KEY]</api_key>
        </provider>
        <provider name="OpenRouter" endpoint="https://openrouter.ai/api">
            <models_endpoint>/v1/models</models_endpoint>
            <api_key encrypted="true">[ENCRYPTED_KEY]</api_key>
        </provider>
    </api_providers>
</ai_config>
```

### 2. Knowledge Base Structure

```xml
<!-- Knowledge Base Schema -->
<knowledge_base version="1.0">
    <metadata>
        <title>CompTIA A+ Core 1</title>
        <created>2024-01-01T00:00:00Z</created>
        <modified>2024-01-01T00:00:00Z</modified>
        <author>User</author>
    </metadata>
    <structure>
        <module id="1" title="Mobile Devices">
            <chapter id="1.1" title="Laptop Hardware">
                <section id="1.1.1" title="Components">
                    <content>
                        <text>[Parsed content]</text>
                        <images>
                            <image id="img_1" ocr_text="[OCR result]" />
                        </images>
                    </content>
                    <semantics>
                        <keywords>RAM, CPU, motherboard</keywords>
                        <embeddings>[Vector data]</embeddings>
                    </semantics>
                </section>
            </chapter>
        </module>
    </structure>
</knowledge_base>
```

### 3. Database Schema

```sql
-- Core Tables
CREATE TABLE knowledge_bases (
    id INTEGER PRIMARY KEY,
    uuid TEXT UNIQUE,
    title TEXT,
    created_at TIMESTAMP,
    modified_at TIMESTAMP,
    xml_content TEXT,
    metadata JSON
);

CREATE TABLE study_progress (
    id INTEGER PRIMARY KEY,
    kb_id INTEGER,
    section_id TEXT,
    user_score REAL,
    ai_score REAL,
    time_spent INTEGER,
    last_viewed TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id)
);

CREATE TABLE practice_tests (
    id INTEGER PRIMARY KEY,
    kb_id INTEGER,
    title TEXT,
    type TEXT CHECK(type IN ('manual', 'ai_generated')),
    questions JSON,
    created_at TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id)
);

CREATE TABLE test_results (
    id INTEGER PRIMARY KEY,
    test_id INTEGER,
    score REAL,
    answers JSON,
    taken_at TIMESTAMP,
    time_taken INTEGER,
    FOREIGN KEY (test_id) REFERENCES practice_tests(id)
);

CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    kb_id INTEGER,
    messages JSON,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id)
);

-- Full-text search
CREATE VIRTUAL TABLE content_fts USING fts5(
    section_id,
    content,
    keywords,
    tokenize='porter unicode61'
);
```

### 4. AI Tool Interface

```xml
<!-- AI Tool Commands Schema -->
<tools version="1.0">
    <tool name="navigate">
        <parameters>
            <param name="section_id" type="string" required="true"/>
        </parameters>
    </tool>
    <tool name="search">
        <parameters>
            <param name="query" type="string" required="true"/>
            <param name="scope" type="string" default="current_kb"/>
        </parameters>
    </tool>
    <tool name="get_progress">
        <parameters>
            <param name="section_id" type="string" required="false"/>
        </parameters>
    </tool>
    <tool name="generate_test">
        <parameters>
            <param name="section_ids" type="array" required="true"/>
            <param name="question_count" type="integer" default="10"/>
            <param name="difficulty" type="string" default="medium"/>
        </parameters>
    </tool>
</tools>
```

## Implementation Guidelines

### Phase 1: Core Infrastructure (Weeks 1-4)
1. Set up Electron project with TypeScript
2. Implement SQLite database layer
3. Create XML parsing/generation utilities
4. Build basic file system management

### Phase 2: AI Integration (Weeks 5-8)
1. Integrate ONNX Runtime for local models
2. Implement API provider interfaces
3. Create model management system
4. Build conversation persistence layer

### Phase 3: Knowledge Base Engine (Weeks 9-12)
1. Implement file parsers (PDF, DOCX, etc.)
2. Build semantic indexing system
3. Create auto-structuring algorithms
4. Develop search functionality

### Phase 4: Learning Features (Weeks 13-16)
1. Progress tracking system
2. Grading mechanisms (user + AI)
3. Practice test generator
4. Test result analytics

### Phase 5: UI/UX Development (Weeks 17-20)
1. Design responsive web interface
2. Implement knowledge base editor
3. Create learning dashboard
4. Build settings/configuration panels

### Phase 6: Polish & Packaging (Weeks 21-24)
1. Performance optimization
2. Error handling & recovery
3. Auto-update system
4. Windows executable packaging

## Key Algorithms

### Semantic Indexing
```python
# Pseudo-code for semantic indexing
def index_content(content):
    # Extract keywords using TF-IDF
    keywords = extract_keywords(content)
    
    # Generate embeddings using local model
    embeddings = generate_embeddings(content)
    
    # Store in vector database
    vector_db.insert(content_id, embeddings)
    
    # Update FTS index
    fts_index.insert(content_id, content, keywords)
```

### Auto-Structure Detection
```python
# Pattern matching for structure detection
PATTERNS = {
    'module': r'(?:Module|Chapter|Unit)\s+(\d+)',
    'section': r'(?:Section|Part)\s+(\d+\.?\d*)',
    'subsection': r'(\d+\.\d+\.\d+)'
}

def auto_structure(text):
    hierarchy = []
    for line in text.split('\n'):
        for level, pattern in PATTERNS.items():
            if match := re.search(pattern, line):
                hierarchy.append({
                    'level': level,
                    'id': match.group(1),
                    'title': line
                })
    return build_tree(hierarchy)
```

## Configuration Files

### settings.xml
```xml
<settings version="1.0">
    <general>
        <data_directory>./data</data_directory>
        <auto_save_interval>300</auto_save_interval>
    </general>
    <ai>
        <default_model>local:tiny-llama</default_model>
        <temperature>0.7</temperature>
        <max_tokens>2048</max_tokens>
    </ai>
    <conversation>
        <retention_days>30</retention_days>
        <max_messages>1000</max_messages>
        <auto_cleanup>true</auto_cleanup>
    </conversation>
    <grading>
        <ai_grading_enabled>true</ai_grading_enabled>
        <grading_frequency>per_section</grading_frequency>
    </grading>
</settings>
```

## Security Considerations

1. **API Key Storage:** Use Windows Credential Manager or encrypted local storage
2. **Conversation Privacy:** Local-only storage with optional encryption
3. **Model Security:** Verify model checksums before loading
4. **XML Injection:** Sanitize all user inputs before XML processing
5. **Update Security:** Code-sign executables and verify signatures

## Performance Targets

- **Startup Time:** < 3 seconds
- **File Parsing:** 100 pages/second
- **Search Response:** < 100ms
- **AI Response (local):** < 2 seconds first token
- **Database Operations:** < 50ms for standard queries
- **Memory Usage:** < 500MB baseline, < 2GB with models loaded

## Testing Strategy

### Unit Tests
- XML parsing/generation
- Database operations
- File parsers
- Indexing algorithms

### Integration Tests
- AI model communication
- Knowledge base operations
- Progress tracking
- Test generation

### E2E Tests
- Complete learning workflows
- Import/export operations
- Conversation continuity
- Executable packaging

## Deployment

### Build Process
```bash
# Install dependencies
npm install

# Build native modules
npm run build:native

# Build frontend
npm run build:renderer

# Package executable
npm run package:win

# Output: dist/FSP-Study-Tools-Setup.exe
```

### Auto-Update System
- Use electron-updater with GitHub Releases or custom server
- Delta updates for efficiency
- Rollback capability for failed updates

## Monitoring & Analytics

### Local Metrics (Privacy-Preserving)
- Usage patterns (local only)
- Performance metrics
- Error tracking
- Feature usage statistics

### Debug Logging
```xml
<log_config>
    <level>INFO</level>
    <max_size>10MB</max_size>
    <rotation>daily</rotation>
    <location>./data/logs</location>
</log_config>
```

## Future Enhancements

1. **Cloud Sync:** Optional cloud backup/sync
2. **Collaboration:** Share knowledge bases
3. **Mobile Companion:** Android/iOS apps
4. **Voice Interface:** Speech-to-text/text-to-speech
5. **Advanced Analytics:** Learning pattern analysis
6. **Plugin System:** Extensible architecture
7. **Multi-language Support:** Internationalization

## Support & Documentation

- **Website:** [To be created]
- **Documentation:** Built-in help system + online docs
- **Support Email:** support@fatstinkypanda.com
- **Issue Tracking:** GitHub Issues
- **Community:** Discord server for users

## Development Checklist

- [ ] Project setup and structure
- [ ] Database implementation
- [ ] XML processing system
- [ ] Local AI model integration
- [ ] API provider integration
- [ ] File parsing system
- [ ] Semantic indexing
- [ ] Knowledge base editor
- [ ] Progress tracking
- [ ] Practice test system
- [ ] Conversation management
- [ ] UI implementation
- [ ] Settings management
- [ ] Error handling
- [ ] Performance optimization
- [ ] Security implementation
- [ ] Testing suite
- [ ] Documentation
- [ ] Packaging system
- [ ] Auto-update system
- [ ] Release preparation

---

*This document serves as the single source of truth for FSP's Study Tools development. All implementation decisions should reference and update this document accordingly.*