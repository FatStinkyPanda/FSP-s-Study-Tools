import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  db: {
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    execute: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:execute', sql, params),
  },

  // Knowledge base operations
  knowledgeBase: {
    list: () => ipcRenderer.invoke('kb:list'),
    get: (id: number) => ipcRenderer.invoke('kb:get', id),
    create: (data: unknown) => ipcRenderer.invoke('kb:create', data),
  },

  // Application info
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    getPath: (name: string) => ipcRenderer.invoke('app:path', name),
  },
});

// Type definitions for TypeScript
export interface ElectronAPI {
  db: {
    query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    execute: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>;
  };
  knowledgeBase: {
    list: () => Promise<unknown[]>;
    get: (id: number) => Promise<unknown>;
    create: (data: unknown) => Promise<number>;
  };
  app: {
    version: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
