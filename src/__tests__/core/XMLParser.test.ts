/**
 * Unit tests for XMLParser
 */
import { XMLParser, ParsedKnowledgeBase } from '../../core/knowledge/XMLParser';

describe('XMLParser', () => {
  let parser: XMLParser;

  beforeEach(() => {
    parser = new XMLParser();
  });

  describe('parseKnowledgeBase', () => {
    it('should parse valid XML with complete structure', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <knowledge_base>
          <metadata>
            <uuid>test-uuid-123</uuid>
            <title>Test Knowledge Base</title>
            <version>1.0</version>
            <author>Test Author</author>
            <description>A test knowledge base</description>
            <category>Testing</category>
            <tags>
              <tag>test</tag>
              <tag>unit-testing</tag>
            </tags>
          </metadata>
          <modules>
            <module id="mod-1" order="1">
              <title>Test Module</title>
              <description>Module description</description>
              <chapters>
                <chapter id="ch-1" order="1">
                  <title>Test Chapter</title>
                  <sections>
                    <section id="sec-1" order="1">
                      <title>Test Section</title>
                      <content>
                        <text>This is test content.</text>
                      </content>
                    </section>
                  </sections>
                </chapter>
              </chapters>
            </module>
          </modules>
        </knowledge_base>`;

      const result = await parser.parseKnowledgeBase(xml);

      expect(result.metadata.uuid).toBe('test-uuid-123');
      expect(result.metadata.title).toBe('Test Knowledge Base');
      expect(result.metadata.version).toBe('1.0');
      expect(result.metadata.author).toBe('Test Author');
      expect(result.metadata.tags).toContain('test');
      expect(result.metadata.tags).toContain('unit-testing');
      expect(result.modules.length).toBe(1);
      expect(result.modules[0].title).toBe('Test Module');
      expect(result.modules[0].chapters.length).toBe(1);
      expect(result.modules[0].chapters[0].sections.length).toBe(1);
    });

    it('should throw error for invalid XML without root element', async () => {
      const xml = `<?xml version="1.0"?><invalid_root></invalid_root>`;

      await expect(parser.parseKnowledgeBase(xml)).rejects.toThrow('Invalid knowledge base XML');
    });

    it('should throw error for malformed XML', async () => {
      const xml = `<knowledge_base><unclosed_tag>`;

      await expect(parser.parseKnowledgeBase(xml)).rejects.toThrow('Failed to parse XML');
    });

    it('should handle missing metadata gracefully', async () => {
      const xml = `<knowledge_base>
        <modules>
          <module id="mod-1">
            <title>Module</title>
            <chapters></chapters>
          </module>
        </modules>
      </knowledge_base>`;

      const result = await parser.parseKnowledgeBase(xml);

      expect(result.metadata.title).toBe('Untitled Knowledge Base');
      expect(result.metadata.version).toBe('1.0');
      expect(result.metadata.uuid).toBeTruthy(); // Should generate UUID
    });

    it('should parse questions correctly', async () => {
      const xml = `<knowledge_base>
        <metadata><title>Test</title></metadata>
        <modules>
          <module id="mod-1">
            <chapters>
              <chapter id="ch-1">
                <sections>
                  <section id="sec-1">
                    <content><text>Content</text></content>
                    <questions>
                      <question id="q-1" type="multiple_choice">
                        <question>What is 2+2?</question>
                        <options>
                          <option>3</option>
                          <option>4</option>
                          <option>5</option>
                        </options>
                        <correct_answer>4</correct_answer>
                        <explanation>Basic arithmetic</explanation>
                        <difficulty>easy</difficulty>
                      </question>
                    </questions>
                  </section>
                </sections>
              </chapter>
            </chapters>
          </module>
        </modules>
      </knowledge_base>`;

      const result = await parser.parseKnowledgeBase(xml);
      const question = result.modules[0].chapters[0].sections[0].questions[0];

      expect(question.id).toBe('q-1');
      expect(question.type).toBe('multiple_choice');
      expect(question.question).toBe('What is 2+2?');
      expect(question.options).toContain('4');
      expect(question.correctAnswer).toBe('4');
      expect(question.explanation).toBe('Basic arithmetic');
      expect(question.difficulty).toBe('easy');
    });

    it('should parse resources correctly', async () => {
      const xml = `<knowledge_base>
        <metadata><title>Test</title></metadata>
        <modules>
          <module id="mod-1">
            <chapters>
              <chapter id="ch-1">
                <sections>
                  <section id="sec-1">
                    <content><text>Content</text></content>
                    <resources>
                      <resource type="link">
                        <title>External Resource</title>
                        <url>https://example.com</url>
                        <description>A helpful link</description>
                      </resource>
                    </resources>
                  </section>
                </sections>
              </chapter>
            </chapters>
          </module>
        </modules>
      </knowledge_base>`;

      const result = await parser.parseKnowledgeBase(xml);
      const resource = result.modules[0].chapters[0].sections[0].resources[0];

      expect(resource.type).toBe('link');
      expect(resource.title).toBe('External Resource');
      expect(resource.url).toBe('https://example.com');
      expect(resource.description).toBe('A helpful link');
    });

    it('should calculate statistics correctly', async () => {
      const xml = `<knowledge_base>
        <metadata><title>Test</title></metadata>
        <modules>
          <module id="mod-1">
            <chapters>
              <chapter id="ch-1">
                <sections>
                  <section id="sec-1">
                    <content><text>Content 1</text></content>
                    <questions>
                      <question id="q-1"><question>Q1?</question></question>
                      <question id="q-2"><question>Q2?</question></question>
                    </questions>
                  </section>
                  <section id="sec-2">
                    <content><text>Content 2</text></content>
                  </section>
                </sections>
              </chapter>
              <chapter id="ch-2">
                <sections>
                  <section id="sec-3">
                    <content><text>Content 3</text></content>
                    <questions>
                      <question id="q-3"><question>Q3?</question></question>
                    </questions>
                  </section>
                </sections>
              </chapter>
            </chapters>
          </module>
        </modules>
      </knowledge_base>`;

      const result = await parser.parseKnowledgeBase(xml);

      expect(result.totalChapters).toBe(2);
      expect(result.totalSections).toBe(3);
      expect(result.totalQuestions).toBe(3);
    });

    it('should handle single items as arrays', async () => {
      const xml = `<knowledge_base>
        <metadata>
          <title>Test</title>
          <tags>single-tag</tags>
        </metadata>
        <modules>
          <module id="mod-1">
            <chapters>
              <chapter id="ch-1">
                <sections>
                  <section id="sec-1">
                    <content><text>Content</text></content>
                  </section>
                </sections>
              </chapter>
            </chapters>
          </module>
        </modules>
      </knowledge_base>`;

      const result = await parser.parseKnowledgeBase(xml);

      expect(result.metadata.tags).toContain('single-tag');
      expect(result.modules.length).toBe(1);
    });

    it('should handle comma-separated tags', async () => {
      const xml = `<knowledge_base>
        <metadata>
          <title>Test</title>
          <tags>tag1, tag2, tag3</tags>
        </metadata>
        <modules></modules>
      </knowledge_base>`;

      const result = await parser.parseKnowledgeBase(xml);

      expect(result.metadata.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });
  });

  describe('validateStructure', () => {
    it('should return valid for complete structure', async () => {
      const xml = `<knowledge_base>
        <metadata>
          <uuid>test-uuid</uuid>
          <title>Test</title>
        </metadata>
        <modules>
          <module id="mod-1">
            <title>Module 1</title>
            <chapters>
              <chapter id="ch-1">
                <title>Chapter 1</title>
                <sections>
                  <section id="sec-1">
                    <title>Section 1</title>
                    <content><text>Content here</text></content>
                  </section>
                </sections>
              </chapter>
            </chapters>
          </module>
        </modules>
      </knowledge_base>`;

      const parsed = await parser.parseKnowledgeBase(xml);
      const validation = parser.validateStructure(parsed);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should report errors for missing required fields', async () => {
      const parsed: ParsedKnowledgeBase = {
        metadata: {
          uuid: '',
          title: '',
          version: '1.0',
          tags: []
        },
        modules: [],
        totalChapters: 0,
        totalSections: 0,
        totalQuestions: 0
      };

      const validation = parser.validateStructure(parsed);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing UUID in metadata');
      expect(validation.errors).toContain('Missing title in metadata');
      expect(validation.errors).toContain('No modules found in knowledge base');
    });

    it('should report warnings for empty chapters/sections', async () => {
      const parsed: ParsedKnowledgeBase = {
        metadata: {
          uuid: 'test-uuid',
          title: 'Test',
          version: '1.0',
          tags: []
        },
        modules: [{
          id: 'mod-1',
          title: 'Module 1',
          order: 1,
          chapters: []
        }],
        totalChapters: 0,
        totalSections: 0,
        totalQuestions: 0
      };

      const validation = parser.validateStructure(parsed);

      expect(validation.warnings).toContain('Module mod-1 has no chapters');
    });
  });

  describe('generateSampleXML', () => {
    it('should generate valid parseable XML', async () => {
      const sampleXml = parser.generateSampleXML();
      const result = await parser.parseKnowledgeBase(sampleXml);

      expect(result.metadata.title).toBe('Aviation Fundamentals');
      expect(result.modules.length).toBe(1);
      expect(result.modules[0].chapters.length).toBe(1);
    });
  });
});
