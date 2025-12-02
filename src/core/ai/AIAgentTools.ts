import { AITool, AIToolCall, AIMessage } from '../../shared/ai-types';
import { KnowledgeBaseManager } from '../knowledge/KnowledgeBaseManager';
import { ParsedKnowledgeBase } from '../knowledge/XMLParser';
import { createLogger } from '../../shared/logger';

const log = createLogger('AIAgentTools');

/**
 * Tool definitions for the AI tutor agent
 * These tools allow the AI to search and retrieve KB content autonomously
 */

// Tool definitions that will be passed to the AI
export const KB_TOOLS: AITool[] = [
  {
    type: 'function',
    function: {
      name: 'search_kb_content',
      description: 'Search the knowledge base for content matching a query. Use this to find relevant sections, topics, or concepts. Returns matching content with location info (module, chapter, section).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query - keywords, concepts, or phrases to find in the knowledge base'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10, max: 20)'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_kb_structure',
      description: 'Get the complete table of contents / structure of the knowledge base. Returns all modules, chapters, and section titles (without content). Use this to understand what topics are available or to answer questions about the KB organization.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_section_content',
      description: 'Get the full content of a specific section. Use this after searching or when user asks about a specific section. Requires module_id, chapter_id, and section_id.',
      parameters: {
        type: 'object',
        properties: {
          module_id: {
            type: 'string',
            description: 'The module ID (e.g., "module-1" or the module title)'
          },
          chapter_id: {
            type: 'string',
            description: 'The chapter ID (e.g., "chapter-1" or the chapter title)'
          },
          section_id: {
            type: 'string',
            description: 'The section ID (e.g., "section-1" or the section title)'
          }
        },
        required: ['module_id', 'chapter_id', 'section_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_chapter_content',
      description: 'Get all sections in a chapter with their content. Use this when user asks about a whole chapter or you need to understand the full chapter context.',
      parameters: {
        type: 'object',
        properties: {
          module_id: {
            type: 'string',
            description: 'The module ID containing the chapter'
          },
          chapter_id: {
            type: 'string',
            description: 'The chapter ID to retrieve'
          }
        },
        required: ['module_id', 'chapter_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_module_overview',
      description: 'Get an overview of a module including its description and list of chapters. Use this to understand what a module covers.',
      parameters: {
        type: 'object',
        properties: {
          module_id: {
            type: 'string',
            description: 'The module ID to get overview for'
          }
        },
        required: ['module_id']
      }
    }
  }
];


/**
 * Tool executor that handles tool calls from the AI
 */
export class AIAgentToolExecutor {
  private kbManager: KnowledgeBaseManager;
  private kbId: number;
  private parsedKB: ParsedKnowledgeBase | null = null;

  constructor(kbManager: KnowledgeBaseManager, kbId: number) {
    this.kbManager = kbManager;
    this.kbId = kbId;
  }

  /**
   * Load and cache the parsed KB structure
   */
  private async ensureKBLoaded(): Promise<ParsedKnowledgeBase> {
    if (!this.parsedKB) {
      this.parsedKB = await this.kbManager.parseKnowledgeBase(this.kbId);
    }
    return this.parsedKB;
  }

  /**
   * Execute a tool call and return the result
   */
  async executeTool(toolCall: AIToolCall): Promise<string> {
    const { name, arguments: argsString } = toolCall.function;

    try {
      const args = JSON.parse(argsString);
      log.debug(`Executing tool: ${name}`, args);

      switch (name) {
        case 'search_kb_content':
          return await this.searchKBContent(args.query, args.limit || 10);

        case 'get_kb_structure':
          return await this.getKBStructure();

        case 'get_section_content':
          return await this.getSectionContent(args.module_id, args.chapter_id, args.section_id);

        case 'get_chapter_content':
          return await this.getChapterContent(args.module_id, args.chapter_id);

        case 'get_module_overview':
          return await this.getModuleOverview(args.module_id);

        default:
          return JSON.stringify({ error: `Unknown tool: ${name}` });
      }
    } catch (error) {
      log.error('Tool execution error:', error);
      return JSON.stringify({ error: `Tool execution failed: ${(error as Error).message}` });
    }
  }

  /**
   * Search KB content using FTS5
   */
  private async searchKBContent(query: string, limit: number): Promise<string> {
    const results = await this.kbManager.searchContent(this.kbId, query, Math.min(limit, 20));

    if (!results || results.length === 0) {
      return JSON.stringify({
        message: 'No results found for query: ' + query,
        results: []
      });
    }

    // Format results for AI consumption
    const formattedResults = results.map(r => ({
      location: {
        module: r.module_id,
        chapter: r.chapter_id,
        section: r.section_id
      },
      content_type: r.content_type,
      content_preview: r.content.substring(0, 500) + (r.content.length > 500 ? '...' : ''),
      relevance_rank: r.rank
    }));

    return JSON.stringify({
      query,
      result_count: formattedResults.length,
      results: formattedResults
    });
  }

  /**
   * Get the full KB structure (table of contents)
   */
  private async getKBStructure(): Promise<string> {
    const kb = await this.ensureKBLoaded();

    // Build a clean structure without content
    const structure = {
      title: kb.metadata.title,
      modules: kb.modules.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description,
        chapters: m.chapters.map(c => ({
          id: c.id,
          title: c.title,
          description: c.description,
          sections: c.sections.map(s => ({
            id: s.id,
            title: s.title
          }))
        }))
      }))
    };

    return JSON.stringify(structure);
  }

  /**
   * Get content of a specific section
   */
  private async getSectionContent(moduleId: string, chapterId: string, sectionId: string): Promise<string> {
    const kb = await this.ensureKBLoaded();

    // Find by ID or title (case-insensitive)
    const module = kb.modules.find(m =>
      m.id === moduleId || m.title.toLowerCase().includes(moduleId.toLowerCase())
    );

    if (!module) {
      return JSON.stringify({
        error: `Module not found: ${moduleId}`,
        available_modules: kb.modules.map(m => ({ id: m.id, title: m.title }))
      });
    }

    const chapter = module.chapters.find(c =>
      c.id === chapterId || c.title.toLowerCase().includes(chapterId.toLowerCase())
    );

    if (!chapter) {
      return JSON.stringify({
        error: `Chapter not found: ${chapterId}`,
        available_chapters: module.chapters.map(c => ({ id: c.id, title: c.title }))
      });
    }

    const section = chapter.sections.find(s =>
      s.id === sectionId || s.title.toLowerCase().includes(sectionId.toLowerCase())
    );

    if (!section) {
      return JSON.stringify({
        error: `Section not found: ${sectionId}`,
        available_sections: chapter.sections.map(s => ({ id: s.id, title: s.title }))
      });
    }

    // Get the text content
    const content = section.content.text || section.content.markdown ||
                    (section.content.html ? section.content.html.replace(/<[^>]*>/g, '') : 'No content available');

    return JSON.stringify({
      location: {
        module: { id: module.id, title: module.title },
        chapter: { id: chapter.id, title: chapter.title },
        section: { id: section.id, title: section.title }
      },
      content: content
    });
  }

  /**
   * Get all sections in a chapter
   */
  private async getChapterContent(moduleId: string, chapterId: string): Promise<string> {
    const kb = await this.ensureKBLoaded();

    const module = kb.modules.find(m =>
      m.id === moduleId || m.title.toLowerCase().includes(moduleId.toLowerCase())
    );

    if (!module) {
      return JSON.stringify({
        error: `Module not found: ${moduleId}`,
        available_modules: kb.modules.map(m => ({ id: m.id, title: m.title }))
      });
    }

    const chapter = module.chapters.find(c =>
      c.id === chapterId || c.title.toLowerCase().includes(chapterId.toLowerCase())
    );

    if (!chapter) {
      return JSON.stringify({
        error: `Chapter not found: ${chapterId}`,
        available_chapters: module.chapters.map(c => ({ id: c.id, title: c.title }))
      });
    }

    const sections = chapter.sections.map(s => {
      const content = s.content.text || s.content.markdown ||
                      (s.content.html ? s.content.html.replace(/<[^>]*>/g, '') : 'No content');
      return {
        id: s.id,
        title: s.title,
        content: content.substring(0, 2000) + (content.length > 2000 ? '...[truncated]' : '')
      };
    });

    return JSON.stringify({
      module: { id: module.id, title: module.title },
      chapter: { id: chapter.id, title: chapter.title, description: chapter.description },
      sections
    });
  }

  /**
   * Get overview of a module
   */
  private async getModuleOverview(moduleId: string): Promise<string> {
    const kb = await this.ensureKBLoaded();

    const module = kb.modules.find(m =>
      m.id === moduleId || m.title.toLowerCase().includes(moduleId.toLowerCase())
    );

    if (!module) {
      return JSON.stringify({
        error: `Module not found: ${moduleId}`,
        available_modules: kb.modules.map(m => ({ id: m.id, title: m.title }))
      });
    }

    return JSON.stringify({
      id: module.id,
      title: module.title,
      description: module.description,
      chapter_count: module.chapters.length,
      chapters: module.chapters.map(c => ({
        id: c.id,
        title: c.title,
        description: c.description,
        section_count: c.sections.length,
        sections: c.sections.map(s => ({ id: s.id, title: s.title }))
      }))
    });
  }
}

/**
 * Create tool result message for the AI
 */
export function createToolResultMessage(toolCallId: string, result: string): AIMessage {
  return {
    role: 'tool',
    content: result,
    tool_call_id: toolCallId
  };
}
