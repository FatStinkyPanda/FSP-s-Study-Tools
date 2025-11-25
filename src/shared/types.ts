// Database types
export interface KnowledgeBase {
  id: number;
  uuid: string;
  title: string;
  created_at: string;
  modified_at: string;
  xml_content: string;
  metadata: Record<string, unknown>;
}

export interface StudyProgress {
  id: number;
  kb_id: number;
  section_id: string;
  user_score: number;
  ai_score: number;
  time_spent: number;
  last_viewed: string;
}

export interface PracticeTest {
  id: number;
  kb_id: number;
  title: string;
  type: 'manual' | 'ai_generated';
  questions: TestQuestion[];
  created_at: string;
}

export interface TestQuestion {
  id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation?: string;
}

export interface TestResult {
  id: number;
  test_id: number;
  score: number;
  answers: Record<string, number>;
  taken_at: string;
  time_taken: number;
}

export interface Conversation {
  id: number;
  kb_id: number;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// XML Structure types
export interface KnowledgeBaseStructure {
  metadata: KnowledgeBaseMetadata;
  structure: Module[];
}

export interface KnowledgeBaseMetadata {
  title: string;
  created: string;
  modified: string;
  author: string;
}

// Parsed file reference with optional parsed content
export interface ParsedFile {
  id: string;
  name: string;
  path: string;
  type: string;
  parsed?: boolean;
  parsed_content?: string;
}

export interface Module {
  id: string;
  title: string;
  description?: string;
  order?: number;
  files?: ParsedFile[];
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  title: string;
  description?: string;
  order?: number;
  files?: ParsedFile[];
  sections: Section[];
}

export interface Section {
  id: string;
  title: string;
  order?: number;
  content: SectionContent;
  semantics?: SectionSemantics;
  questions?: Question[];
  resources?: Resource[];
}

// Content element types for structured content
export type ContentElementType = 'paragraph' | 'heading' | 'image' | 'list' | 'code' | 'blockquote' | 'table';

export interface ContentElement {
  type: ContentElementType;
  order: number;
  content?: string;           // For paragraph, heading, code, blockquote
  level?: number;             // For headings (1-6)
  src?: string;               // For images
  alt?: string;               // For images
  width?: number;             // For images
  height?: number;            // For images
  items?: string[];           // For lists
  ordered?: boolean;          // For lists (true = numbered, false = bullets)
  language?: string;          // For code blocks
  rows?: string[][];          // For tables
  headers?: string[];         // For table headers
}

export interface StructuredContent {
  elements: ContentElement[];
  rawText: string;            // Fallback plain text
}

export interface SectionContent {
  text: string;
  html?: string;
  markdown?: string;
  images?: Image[];
  tables?: string[];
  diagrams?: string[];
  // New structured content support
  elements?: ContentElement[];
}

export interface Image {
  id: string;
  path?: string;
  ocr_text?: string;
}

export interface Question {
  id: string;
  type: string;
  question: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: string;
  tags?: string[];
}

export interface Resource {
  id: string;
  type: string;
  title: string;
  url?: string;
  description?: string;
}

export interface SectionSemantics {
  keywords: string[];
  embeddings: number[];
}

// AI Configuration types
export interface AIConfig {
  local_models: LocalModel[];
  api_providers: APIProvider[];
}

export interface LocalModel {
  id: string;
  path: string;
  type: 'onnx' | 'gguf';
}

export interface APIProvider {
  name: string;
  endpoint: string;
  models_endpoint: string;
  api_key: string;
}

// Application Settings types
export interface AppSettings {
  general: GeneralSettings;
  ai: AISettings;
  conversation: ConversationSettings;
  grading: GradingSettings;
}

export interface GeneralSettings {
  data_directory: string;
  auto_save_interval: number;
}

export interface AISettings {
  default_model: string;
  temperature: number;
  max_tokens: number;
}

export interface ConversationSettings {
  retention_days: number;
  max_messages: number;
  auto_cleanup: boolean;
}

export interface GradingSettings {
  ai_grading_enabled: boolean;
  grading_frequency: 'per_section' | 'per_module' | 'manual';
}

// Database operation result types
export interface QueryResult<T = unknown> {
  rows: T[];
  changes?: number;
  lastInsertRowid?: number;
}

export interface ExecuteResult {
  changes: number;
  lastInsertRowid: number;
}
