/**
 * Renderer process entry point
 * This file is loaded by the renderer process
 */

console.log('[Renderer] FSP Study Tools initialized');
console.log('[Renderer] Electron API available:', !!window.electronAPI);

// Add event listener for DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Renderer] DOM loaded');

  // Test Electron API if available
  if (window.electronAPI) {
    // Get app version
    window.electronAPI.invoke('app:version')
      .then((version: string) => {
        console.log('[Renderer] App version:', version);

        // Update version in UI if element exists
        const versionElements = document.querySelectorAll('[data-app-version]');
        versionElements.forEach(el => {
          el.textContent = `v${version}`;
        });
      })
      .catch((err: Error) => {
        console.error('[Renderer] Failed to get app version:', err);
      });
  } else {
    console.warn('[Renderer] Electron API not available');
  }
});

// Export empty object to make this a module
export {};
