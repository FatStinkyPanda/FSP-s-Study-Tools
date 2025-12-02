import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';

interface UpdateInfo {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  releaseName?: string;
}

interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdateStatus {
  event: string;
  data?: unknown;
}

interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  onUpdateStatus?: (callback: (status: UpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

function UpdateNotification() {
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);

  // Handle update status events from main process
  const handleUpdateStatus = useCallback((status: UpdateStatus) => {
    console.log('Update status:', status);

    switch (status.event) {
      case 'Checking for updates...':
        setUpdateState('checking');
        setError(null);
        break;

      case 'update-available':
        setUpdateState('available');
        setUpdateInfo(status.data as UpdateInfo);
        setDismissed(false);
        break;

      case 'update-not-available':
        setUpdateState('not-available');
        setUpdateInfo(status.data as UpdateInfo);
        break;

      case 'download-progress':
        setUpdateState('downloading');
        setDownloadProgress(status.data as DownloadProgress);
        break;

      case 'update-downloaded':
        setUpdateState('downloaded');
        setUpdateInfo(status.data as UpdateInfo);
        setDownloadProgress(null);
        break;

      case 'update-error':
        setUpdateState('error');
        setError((status.data as { message: string })?.message || 'Unknown error');
        break;
    }
  }, []);

  // Set up event listener on mount
  useEffect(() => {
    if (window.electronAPI?.onUpdateStatus) {
      const cleanup = window.electronAPI.onUpdateStatus(handleUpdateStatus);
      return cleanup;
    }
  }, [handleUpdateStatus]);

  // Check for updates on mount (after a delay to let app initialize)
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdates();
    }, 5000); // Check after 5 seconds

    return () => clearTimeout(timer);
  }, []);

  const checkForUpdates = async () => {
    try {
      setUpdateState('checking');
      setError(null);
      await window.electronAPI.invoke('update:check');
    } catch (err) {
      console.error('Failed to check for updates:', err);
      setUpdateState('error');
      setError((err as Error).message);
    }
  };

  const downloadUpdate = async () => {
    try {
      setUpdateState('downloading');
      setDownloadProgress({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
      await window.electronAPI.invoke('update:download');
    } catch (err) {
      console.error('Failed to download update:', err);
      setUpdateState('error');
      setError((err as Error).message);
    }
  };

  const installUpdate = async () => {
    try {
      await window.electronAPI.invoke('update:install');
    } catch (err) {
      console.error('Failed to install update:', err);
      setError((err as Error).message);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    return formatBytes(bytesPerSecond) + '/s';
  };

  // Don't show anything if dismissed or idle/not-available
  if (dismissed || updateState === 'idle' || updateState === 'not-available') {
    return null;
  }

  // Don't show "checking" state briefly - only show if it takes a while
  if (updateState === 'checking') {
    return null;
  }

  return (
    <div className="update-notification-container">
      {/* Update Available Banner */}
      {updateState === 'available' && updateInfo && (
        <div className="update-banner update-available">
          <div className="update-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div className="update-content">
            <div className="update-title">
              Update Available: v{updateInfo.version}
            </div>
            <div className="update-subtitle">
              A new version is ready to download
              {updateInfo.releaseName && ` - ${updateInfo.releaseName}`}
            </div>
          </div>
          <div className="update-actions">
            {updateInfo.releaseNotes && (
              <button
                className="update-btn secondary"
                onClick={() => setShowReleaseNotes(!showReleaseNotes)}
              >
                {showReleaseNotes ? 'Hide Notes' : 'Release Notes'}
              </button>
            )}
            <button className="update-btn primary" onClick={downloadUpdate}>
              Download
            </button>
            <button className="update-btn dismiss" onClick={() => setDismissed(true)}>
              Later
            </button>
          </div>
        </div>
      )}

      {/* Download Progress */}
      {updateState === 'downloading' && downloadProgress && (
        <div className="update-banner update-downloading">
          <div className="update-icon downloading">
            <div className="spinner-small"></div>
          </div>
          <div className="update-content">
            <div className="update-title">
              Downloading Update... {Math.round(downloadProgress.percent)}%
            </div>
            <div className="update-progress-bar">
              <div
                className="update-progress-fill"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
            <div className="update-subtitle">
              {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
              {' - '}
              {formatSpeed(downloadProgress.bytesPerSecond)}
            </div>
          </div>
        </div>
      )}

      {/* Update Downloaded - Ready to Install */}
      {updateState === 'downloaded' && (
        <div className="update-banner update-ready">
          <div className="update-icon ready">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="update-content">
            <div className="update-title">
              Update Ready to Install
            </div>
            <div className="update-subtitle">
              Restart the application to apply the update
            </div>
          </div>
          <div className="update-actions">
            <button className="update-btn primary" onClick={installUpdate}>
              Restart Now
            </button>
            <button className="update-btn dismiss" onClick={() => setDismissed(true)}>
              Later
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {updateState === 'error' && error && (
        <div className="update-banner update-error">
          <div className="update-icon error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="update-content">
            <div className="update-title">Update Error</div>
            <div className="update-subtitle">{error}</div>
          </div>
          <div className="update-actions">
            <button className="update-btn secondary" onClick={checkForUpdates}>
              Retry
            </button>
            <button className="update-btn dismiss" onClick={() => setDismissed(true)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Release Notes Modal */}
      {showReleaseNotes && updateInfo?.releaseNotes && (
        <div className="release-notes-overlay" onClick={() => setShowReleaseNotes(false)}>
          <div className="release-notes-modal" onClick={e => e.stopPropagation()}>
            <div className="release-notes-header">
              <h3>Release Notes - v{updateInfo.version}</h3>
              <button
                className="close-btn"
                onClick={() => setShowReleaseNotes(false)}
              >
                x
              </button>
            </div>
            <div className="release-notes-content">
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(updateInfo.releaseNotes || '') }} />
            </div>
            <div className="release-notes-footer">
              <button
                className="update-btn secondary"
                onClick={() => setShowReleaseNotes(false)}
              >
                Close
              </button>
              <button
                className="update-btn primary"
                onClick={() => { setShowReleaseNotes(false); downloadUpdate(); }}
              >
                Download Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UpdateNotification;
