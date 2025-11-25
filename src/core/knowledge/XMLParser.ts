import { parseStringPromise } from 'xml2js';
import {
  Module,
  Chapter,
  Section,
  SectionContent,
  Question,
  Resource,
  ContentElement,
  ParsedFile,
} from '../../shared/types';

export interface ParsedKnowledgeBase {
  metadata: {
    uuid: string;
    title: string;
    version: string;
    author?: string;
    description?: string;
    category?: string;
    tags: string[];
    created?: string;
    modified?: string;
  };
  modules: Module[];
  totalChapters: number;
  totalSections: number;
  totalQuestions: number;
}

export class XMLParser {
  /**
   * Parse XML string into structured knowledge base
   */
  async parseKnowledgeBase(xmlContent: string): Promise<ParsedKnowledgeBase> {
    try {
      console.log('[XMLParser] Parsing XML content, length:', xmlContent?.length || 0);

      const parsed = await parseStringPromise(xmlContent, {
        explicitArray: false,
        mergeAttrs: true,
        trim: true,
        normalize: true,
      });

      console.log('[XMLParser] Parsed result keys:', Object.keys(parsed || {}));

      if (!parsed.knowledge_base) {
        throw new Error('Invalid knowledge base XML: missing root element');
      }

      const kb = parsed.knowledge_base;
      console.log('[XMLParser] KB keys:', Object.keys(kb || {}));
      console.log('[XMLParser] kb.modules:', kb.modules);
      console.log('[XMLParser] kb.modules type:', typeof kb.modules);
      console.log('[XMLParser] kb.modules?.module:', kb.modules?.module);
      console.log('[XMLParser] kb.modules?.module type:', typeof kb.modules?.module);

      // Extract metadata
      const metadata = this.extractMetadata(kb);

      // Parse modules
      const moduleData = kb.modules?.module || [];
      console.log('[XMLParser] moduleData:', moduleData);
      console.log('[XMLParser] moduleData is array:', Array.isArray(moduleData));
      const modules = this.parseModules(moduleData);

      // Calculate statistics
      const stats = this.calculateStatistics(modules);

      return {
        metadata,
        modules,
        totalChapters: stats.chapters,
        totalSections: stats.sections,
        totalQuestions: stats.questions,
      };
    } catch (error) {
      throw new Error(`Failed to parse XML: ${(error as Error).message}`);
    }
  }

  /**
   * Extract metadata from knowledge base XML
   */
  private extractMetadata(kb: any): ParsedKnowledgeBase['metadata'] {
    const meta = kb.metadata || {};

    return {
      uuid: meta.uuid || this.generateUUID(),
      title: meta.title || 'Untitled Knowledge Base',
      version: meta.version || '1.0',
      author: meta.author,
      description: meta.description,
      category: meta.category,
      tags: this.parseTags(meta.tags),
      created: meta.created,
      modified: meta.modified || new Date().toISOString(),
    };
  }

  /**
   * Parse modules from XML
   */
  private parseModules(moduleData: any): Module[] {
    console.log('[XMLParser.parseModules] Input moduleData:', moduleData);
    console.log('[XMLParser.parseModules] Is array:', Array.isArray(moduleData));

    const modules = Array.isArray(moduleData) ? moduleData : [moduleData];
    console.log('[XMLParser.parseModules] After array conversion:', modules);
    console.log('[XMLParser.parseModules] modules length:', modules.length);

    const result = modules
      .filter(m => m) // Filter out undefined/null
      .map((m, index) => {
        console.log(`[XMLParser.parseModules] Processing module ${index}:`, m);
        console.log(`[XMLParser.parseModules] Module ${index} keys:`, Object.keys(m || {}));
        console.log(`[XMLParser.parseModules] Module ${index} chapters:`, m?.chapters);
        console.log(`[XMLParser.parseModules] Module ${index} chapters?.chapter:`, m?.chapters?.chapter);
        console.log(`[XMLParser.parseModules] Module ${index} files:`, m?.files);

        return {
          id: m.id || `module-${index + 1}`,
          title: m.title || `Module ${index + 1}`,
          description: m.description,
          order: parseInt(m.order || String(index + 1), 10),
          files: this.parseFiles(m.files?.file || []),
          chapters: this.parseChapters(m.chapters?.chapter || []),
        };
      });

    console.log('[XMLParser.parseModules] Final result count:', result.length);
    return result;
  }

  /**
   * Parse chapters from XML
   */
  private parseChapters(chapterData: any): Chapter[] {
    const chapters = Array.isArray(chapterData) ? chapterData : [chapterData];

    return chapters
      .filter(c => c)
      .map((c, index) => ({
        id: c.id || `chapter-${index + 1}`,
        title: c.title || `Chapter ${index + 1}`,
        description: c.description,
        order: parseInt(c.order || String(index + 1), 10),
        files: this.parseFiles(c.files?.file || []),
        sections: this.parseSections(c.sections?.section || []),
      }));
  }

  /**
   * Parse sections from XML
   */
  private parseSections(sectionData: any): Section[] {
    const sections = Array.isArray(sectionData) ? sectionData : [sectionData];

    return sections
      .filter(s => s)
      .map((s, index) => ({
        id: s.id || `section-${index + 1}`,
        title: s.title || `Section ${index + 1}`,
        order: parseInt(s.order || String(index + 1), 10),
        content: this.parseContent(s.content),
        questions: this.parseQuestions(s.questions?.question || []),
        resources: this.parseResources(s.resources?.resource || []),
      }));
  }

  /**
   * Parse section content
   */
  private parseContent(contentData: any): SectionContent {
    if (!contentData) {
      return {
        text: '',
        html: '',
        markdown: '',
      };
    }

    if (typeof contentData === 'string') {
      return {
        text: contentData,
        html: contentData,
        markdown: contentData,
      };
    }

    return {
      text: contentData.text || contentData._ || '',
      html: contentData.html || '',
      markdown: contentData.markdown || '',
      images: this.parseImages(contentData.images?.image),
      tables: this.parseArray(contentData.tables?.table),
      diagrams: this.parseArray(contentData.diagrams?.diagram),
      elements: this.parseElements(contentData.elements),
    };
  }

  /**
   * Parse structured content elements from XML
   */
  private parseElements(elementsData: any): ContentElement[] | undefined {
    if (!elementsData) return undefined;

    const elements: ContentElement[] = [];

    // Parse headings
    if (elementsData.heading) {
      const headings = Array.isArray(elementsData.heading)
        ? elementsData.heading
        : [elementsData.heading];

      for (const h of headings) {
        if (!h) continue;
        const content = typeof h === 'string' ? h : (h._ || h.content || '');
        const order = typeof h === 'string' ? 0 : parseInt(h.order || '0', 10);
        const level = typeof h === 'string' ? 1 : parseInt(h.level || '1', 10);

        elements.push({
          type: 'heading',
          order,
          content,
          level: Math.min(Math.max(level, 1), 6), // Clamp between 1-6
        });
      }
    }

    // Parse paragraphs
    if (elementsData.paragraph) {
      const paragraphs = Array.isArray(elementsData.paragraph)
        ? elementsData.paragraph
        : [elementsData.paragraph];

      for (const p of paragraphs) {
        if (!p) continue;
        const content = typeof p === 'string' ? p : (p._ || p.content || '');
        const order = typeof p === 'string' ? 0 : parseInt(p.order || '0', 10);

        elements.push({
          type: 'paragraph',
          order,
          content,
        });
      }
    }

    // Parse lists
    if (elementsData.list) {
      const lists = Array.isArray(elementsData.list)
        ? elementsData.list
        : [elementsData.list];

      for (const l of lists) {
        if (!l) continue;
        const order = parseInt(l.order || '0', 10);
        const ordered = l.ordered === 'true' || l.ordered === true;

        // Parse list items
        let items: string[] = [];
        if (l.item) {
          const itemData = Array.isArray(l.item) ? l.item : [l.item];
          items = itemData.map((item: any) =>
            typeof item === 'string' ? item : (item._ || item.content || '')
          );
        } else if (l.items) {
          // Alternative format: comma-separated or nested
          if (typeof l.items === 'string') {
            items = l.items.split(',').map((i: string) => i.trim());
          } else if (l.items.item) {
            const itemData = Array.isArray(l.items.item) ? l.items.item : [l.items.item];
            items = itemData.map((item: any) =>
              typeof item === 'string' ? item : (item._ || '')
            );
          }
        }

        elements.push({
          type: 'list',
          order,
          items,
          ordered,
        });
      }
    }

    // Parse images
    if (elementsData.image) {
      const images = Array.isArray(elementsData.image)
        ? elementsData.image
        : [elementsData.image];

      for (const img of images) {
        if (!img) continue;
        const order = parseInt(img.order || '0', 10);

        elements.push({
          type: 'image',
          order,
          src: img.src || img.path || img.url,
          alt: img.alt || img.caption || img.ocr_text,
        });
      }
    }

    // Parse code blocks
    if (elementsData.code) {
      const codeBlocks = Array.isArray(elementsData.code)
        ? elementsData.code
        : [elementsData.code];

      for (const c of codeBlocks) {
        if (!c) continue;
        const content = typeof c === 'string' ? c : (c._ || c.content || '');
        const order = typeof c === 'string' ? 0 : parseInt(c.order || '0', 10);
        const language = typeof c === 'string' ? undefined : c.language;

        elements.push({
          type: 'code',
          order,
          content,
          language,
        });
      }
    }

    // Parse blockquotes
    if (elementsData.blockquote) {
      const quotes = Array.isArray(elementsData.blockquote)
        ? elementsData.blockquote
        : [elementsData.blockquote];

      for (const q of quotes) {
        if (!q) continue;
        const content = typeof q === 'string' ? q : (q._ || q.content || '');
        const order = typeof q === 'string' ? 0 : parseInt(q.order || '0', 10);

        elements.push({
          type: 'blockquote',
          order,
          content,
        });
      }
    }

    // Sort by order if we have elements
    if (elements.length > 0) {
      elements.sort((a, b) => (a.order || 0) - (b.order || 0));
      return elements;
    }

    return undefined;
  }

  /**
   * Parse questions from XML
   */
  private parseQuestions(questionData: any): Question[] {
    const questions = Array.isArray(questionData) ? questionData : [questionData];

    return questions
      .filter(q => q)
      .map((q, index) => ({
        id: q.id || `question-${index + 1}`,
        type: q.type || 'multiple_choice',
        question: q.question || q.text || '',
        options: this.parseArray(q.options?.option),
        correctAnswer: q.correct_answer || q.answer,
        explanation: q.explanation,
        difficulty: q.difficulty,
        tags: this.parseTags(q.tags),
      }));
  }

  /**
   * Parse resources from XML
   */
  private parseResources(resourceData: any): Resource[] {
    const resources = Array.isArray(resourceData) ? resourceData : [resourceData];

    return resources
      .filter(r => r)
      .map((r, index) => ({
        id: r.id || `resource-${index + 1}`,
        type: r.type || 'link',
        title: r.title || `Resource ${index + 1}`,
        url: r.url || r.href,
        description: r.description,
      }));
  }

  /**
   * Parse files from XML (module/chapter level files with parsed_content)
   */
  private parseFiles(fileData: any): ParsedFile[] {
    if (!fileData) return [];

    const files = Array.isArray(fileData) ? fileData : [fileData];

    return files
      .filter(f => f)
      .map((f, index) => ({
        id: f.id || `file-${index + 1}`,
        name: f.name || `File ${index + 1}`,
        path: f.path || '',
        type: f.type || 'unknown',
        parsed: f.parsed === 'true' || f.parsed === true,
        parsed_content: f.parsed_content || '',
      }));
  }

  /**
   * Parse tags from various formats
   */
  private parseTags(tagsData: any): string[] {
    if (!tagsData) return [];

    if (typeof tagsData === 'string') {
      return tagsData.split(',').map(t => t.trim()).filter(t => t);
    }

    if (Array.isArray(tagsData)) {
      return tagsData.map(t => String(t).trim()).filter(t => t);
    }

    if (tagsData.tag) {
      return this.parseArray(tagsData.tag);
    }

    return [];
  }

  /**
   * Parse array data from XML (handles both array and single item)
   */
  private parseArray(data: any): string[] {
    if (!data) return [];
    if (Array.isArray(data)) return data.map(d => String(d));
    return [String(data)];
  }

  /**
   * Parse images from XML data
   */
  private parseImages(data: any): { id: string; path?: string; ocr_text?: string }[] {
    if (!data) return [];

    const items = Array.isArray(data) ? data : [data];

    return items.map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: `image-${index + 1}`,
          path: item,
        };
      }

      return {
        id: item.id || `image-${index + 1}`,
        path: item.path || item.src || item.url,
        ocr_text: item.ocr_text || item.alt,
      };
    });
  }

  /**
   * Calculate statistics for knowledge base
   */
  private calculateStatistics(modules: Module[]): {
    chapters: number;
    sections: number;
    questions: number;
  } {
    let chapters = 0;
    let sections = 0;
    let questions = 0;

    for (const module of modules) {
      chapters += module.chapters.length;
      for (const chapter of module.chapters) {
        sections += chapter.sections.length;
        for (const section of chapter.sections) {
          questions += section.questions?.length || 0;
        }
      }
    }

    return { chapters, sections, questions };
  }

  /**
   * Generate a simple UUID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Validate knowledge base structure
   */
  validateStructure(parsed: ParsedKnowledgeBase): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required metadata
    if (!parsed.metadata.uuid) {
      errors.push('Missing UUID in metadata');
    }
    if (!parsed.metadata.title) {
      errors.push('Missing title in metadata');
    }

    // Check modules
    if (parsed.modules.length === 0) {
      errors.push('No modules found in knowledge base');
    }

    // Validate module structure
    for (const module of parsed.modules) {
      if (!module.id) {
        errors.push(`Module missing ID: ${module.title}`);
      }
      if (!module.title) {
        warnings.push(`Module ${module.id} missing title`);
      }
      if (module.chapters.length === 0) {
        warnings.push(`Module ${module.id} has no chapters`);
      }

      // Validate chapters
      for (const chapter of module.chapters) {
        if (!chapter.id) {
          errors.push(`Chapter missing ID in module ${module.id}`);
        }
        if (chapter.sections.length === 0) {
          warnings.push(`Chapter ${chapter.id} has no sections`);
        }

        // Validate sections
        for (const section of chapter.sections) {
          if (!section.id) {
            errors.push(`Section missing ID in chapter ${chapter.id}`);
          }
          if (!section.content || !section.content.text) {
            warnings.push(`Section ${section.id} has no text content`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Generate sample XML for reference
   */
  generateSampleXML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<knowledge_base>
  <metadata>
    <uuid>550e8400-e29b-41d4-a716-446655440000</uuid>
    <title>Aviation Fundamentals</title>
    <version>1.0</version>
    <author>Flight Training Center</author>
    <description>Comprehensive guide to aviation fundamentals</description>
    <category>Aviation Training</category>
    <tags>
      <tag>aviation</tag>
      <tag>fundamentals</tag>
      <tag>flight-training</tag>
    </tags>
    <created>2025-01-01T00:00:00Z</created>
    <modified>2025-01-15T12:00:00Z</modified>
  </metadata>

  <modules>
    <module id="mod-1" order="1">
      <title>Aircraft Systems</title>
      <description>Understanding aircraft systems and components</description>
      <chapters>
        <chapter id="ch-1-1" order="1">
          <title>Engine Systems</title>
          <description>Internal combustion and turbine engines</description>
          <sections>
            <section id="sec-1-1-1" order="1">
              <title>Piston Engines</title>
              <content>
                <text>Piston engines convert fuel into mechanical energy...</text>
                <markdown>## Piston Engines

Piston engines convert fuel into mechanical energy through combustion.</markdown>
              </content>
              <questions>
                <question id="q-1" type="multiple_choice">
                  <question>What is the primary function of a piston engine?</question>
                  <options>
                    <option>Convert electrical energy</option>
                    <option>Convert fuel into mechanical energy</option>
                    <option>Compress air</option>
                    <option>Generate lift</option>
                  </options>
                  <correct_answer>Convert fuel into mechanical energy</correct_answer>
                  <explanation>Piston engines use combustion to create mechanical motion.</explanation>
                  <difficulty>easy</difficulty>
                  <tags>engines,basics</tags>
                </question>
              </questions>
              <resources>
                <resource type="link">
                  <title>FAA Engine Handbook</title>
                  <url>https://www.faa.gov/handbook</url>
                  <description>Official FAA reference on aircraft engines</description>
                </resource>
              </resources>
            </section>
          </sections>
        </chapter>
      </chapters>
    </module>
  </modules>
</knowledge_base>`;
  }
}
