/**
 * SecureStorage
 *
 * Provides secure storage for sensitive data like API keys using Electron's safeStorage API.
 * On Windows, this uses the DPAPI (Data Protection API) for encryption.
 * On macOS, this uses the Keychain.
 * On Linux, this uses the Secret Service API or libsecret.
 */

import { safeStorage } from 'electron';

export class SecureStorage {
  private static readonly ENCRYPTION_PREFIX = 'ENC:';

  /**
   * Check if encryption is available on this platform
   */
  static isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Encrypt a string value
   * Returns the encrypted value as a base64-encoded string with prefix
   */
  static encrypt(value: string): string {
    if (!value) return value;

    if (!this.isEncryptionAvailable()) {
      console.warn('SecureStorage: Encryption not available on this platform');
      return value;
    }

    try {
      const encrypted = safeStorage.encryptString(value);
      return this.ENCRYPTION_PREFIX + encrypted.toString('base64');
    } catch (error) {
      console.error('SecureStorage: Encryption failed:', error);
      return value;
    }
  }

  /**
   * Decrypt an encrypted string value
   * Handles both encrypted (prefixed) and plain text values
   */
  static decrypt(value: string): string {
    if (!value) return value;

    // Check if value is encrypted (has prefix)
    if (!value.startsWith(this.ENCRYPTION_PREFIX)) {
      return value; // Already plain text
    }

    if (!this.isEncryptionAvailable()) {
      console.warn('SecureStorage: Decryption not available on this platform');
      // Return empty string for security - can't decrypt
      return '';
    }

    try {
      const encryptedBase64 = value.slice(this.ENCRYPTION_PREFIX.length);
      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(encryptedBuffer);
    } catch (error) {
      console.error('SecureStorage: Decryption failed:', error);
      return '';
    }
  }

  /**
   * Check if a value is encrypted
   */
  static isEncrypted(value: string): boolean {
    return value?.startsWith(this.ENCRYPTION_PREFIX) ?? false;
  }

  /**
   * Encrypt a value only if it's not already encrypted
   */
  static encryptIfNeeded(value: string): string {
    if (!value || this.isEncrypted(value)) {
      return value;
    }
    return this.encrypt(value);
  }

  /**
   * Get encryption status info
   */
  static getEncryptionInfo(): {
    available: boolean;
    platform: NodeJS.Platform;
    method: string;
  } {
    const platform = process.platform;
    let method = 'Unknown';

    switch (platform) {
      case 'win32':
        method = 'Windows DPAPI (Data Protection API)';
        break;
      case 'darwin':
        method = 'macOS Keychain';
        break;
      case 'linux':
        method = 'Secret Service API / libsecret';
        break;
    }

    return {
      available: this.isEncryptionAvailable(),
      platform,
      method,
    };
  }
}

export default SecureStorage;
