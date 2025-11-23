import { AIMessage } from '../../shared/ai-types';
import { DatabaseManager } from '../database/DatabaseManager';

export interface Conversation {
  id: number;
  kbId: number;
  messages: AIMessage[];
  createdAt: string;
  updatedAt: string;
}

export class ConversationManager {
  private db: DatabaseManager;
  private activeConversations: Map<number, AIMessage[]> = new Map();

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  /**
   * Create a new conversation
   */
  async createConversation(kbId: number, systemMessage?: string): Promise<number> {
    const messages: AIMessage[] = [];

    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage,
      });
    }

    const result = this.db.execute(
      'INSERT INTO conversations (kb_id, messages) VALUES (?, ?)',
      [kbId, JSON.stringify(messages)]
    );

    const conversationId = result.lastInsertRowid;
    this.activeConversations.set(conversationId, messages);

    return conversationId;
  }

  /**
   * Load a conversation from database
   */
  async loadConversation(conversationId: number): Promise<Conversation | null> {
    const rows = this.db.query<{
      id: number;
      kb_id: number;
      messages: string;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT id, kb_id, messages, created_at, updated_at FROM conversations WHERE id = ?',
      [conversationId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const messages = JSON.parse(row.messages) as AIMessage[];

    this.activeConversations.set(conversationId, messages);

    return {
      id: row.id,
      kbId: row.kb_id,
      messages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(conversationId: number, message: AIMessage): Promise<void> {
    let messages = this.activeConversations.get(conversationId);

    if (!messages) {
      const conversation = await this.loadConversation(conversationId);
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }
      messages = conversation.messages;
    }

    messages.push(message);

    this.db.execute(
      'UPDATE conversations SET messages = ? WHERE id = ?',
      [JSON.stringify(messages), conversationId]
    );

    this.activeConversations.set(conversationId, messages);
  }

  /**
   * Get messages from a conversation
   */
  async getMessages(conversationId: number, limit?: number): Promise<AIMessage[]> {
    let messages = this.activeConversations.get(conversationId);

    if (!messages) {
      const conversation = await this.loadConversation(conversationId);
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }
      messages = conversation.messages;
    }

    if (limit && limit > 0) {
      return messages.slice(-limit);
    }

    return messages;
  }

  /**
   * Update the last assistant message (for streaming)
   */
  async updateLastMessage(conversationId: number, content: string): Promise<void> {
    const messages = await this.getMessages(conversationId);

    if (messages.length === 0) {
      throw new Error('No messages in conversation');
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') {
      throw new Error('Last message is not from assistant');
    }

    lastMessage.content = content;

    this.db.execute(
      'UPDATE conversations SET messages = ? WHERE id = ?',
      [JSON.stringify(messages), conversationId]
    );

    this.activeConversations.set(conversationId, messages);
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: number): Promise<boolean> {
    this.activeConversations.delete(conversationId);

    const result = this.db.execute(
      'DELETE FROM conversations WHERE id = ?',
      [conversationId]
    );

    return result.changes > 0;
  }

  /**
   * List conversations for a knowledge base
   */
  async listConversations(kbId: number, limit: number = 50): Promise<Array<{
    id: number;
    messageCount: number;
    lastMessage: string;
    createdAt: string;
    updatedAt: string;
  }>> {
    const rows = this.db.query<{
      id: number;
      messages: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, messages, created_at, updated_at
       FROM conversations
       WHERE kb_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
      [kbId, limit]
    );

    return rows.map(row => {
      const messages = JSON.parse(row.messages) as AIMessage[];
      const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : '';

      return {
        id: row.id,
        messageCount: messages.length,
        lastMessage: lastMessage.slice(0, 100),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  /**
   * Clear conversation history (keep system message if present)
   */
  async clearConversation(conversationId: number): Promise<void> {
    const messages = await this.getMessages(conversationId);

    const systemMessages = messages.filter(m => m.role === 'system');

    this.db.execute(
      'UPDATE conversations SET messages = ? WHERE id = ?',
      [JSON.stringify(systemMessages), conversationId]
    );

    this.activeConversations.set(conversationId, systemMessages);
  }

  /**
   * Get conversation statistics
   */
  async getStatistics(conversationId: number): Promise<{
    messageCount: number;
    userMessages: number;
    assistantMessages: number;
    systemMessages: number;
    totalCharacters: number;
    estimatedTokens: number;
  }> {
    const messages = await this.getMessages(conversationId);

    const stats = {
      messageCount: messages.length,
      userMessages: messages.filter(m => m.role === 'user').length,
      assistantMessages: messages.filter(m => m.role === 'assistant').length,
      systemMessages: messages.filter(m => m.role === 'system').length,
      totalCharacters: messages.reduce((sum, m) => sum + m.content.length, 0),
      estimatedTokens: 0,
    };

    // Rough token estimation (~4 characters per token)
    stats.estimatedTokens = Math.ceil(stats.totalCharacters / 4);

    return stats;
  }

  /**
   * Export conversation to JSON
   */
  async exportConversation(conversationId: number): Promise<string> {
    const conversation = await this.loadConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    return JSON.stringify(conversation, null, 2);
  }

  /**
   * Import conversation from JSON
   */
  async importConversation(kbId: number, jsonData: string): Promise<number> {
    const data = JSON.parse(jsonData);
    const messages = data.messages as AIMessage[];

    const result = this.db.execute(
      'INSERT INTO conversations (kb_id, messages) VALUES (?, ?)',
      [kbId, JSON.stringify(messages)]
    );

    return result.lastInsertRowid;
  }

  /**
   * Cleanup old conversations
   */
  async cleanup(daysToKeep: number): Promise<number> {
    const result = this.db.execute(
      `DELETE FROM conversations
       WHERE datetime(updated_at) < datetime('now', '-' || ? || ' days')`,
      [daysToKeep]
    );

    // Clear from active cache
    for (const id of this.activeConversations.keys()) {
      const conversation = await this.loadConversation(id);
      if (!conversation) {
        this.activeConversations.delete(id);
      }
    }

    return result.changes;
  }
}
