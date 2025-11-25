import React, { useState, useEffect, useCallback } from 'react';
import {
  ErrorNotification as ErrorNotificationData,
  ErrorSeverity,
  RecoveryAction,
} from '../../shared/errors';

interface ErrorNotificationProps {
  notification: ErrorNotificationData;
  onDismiss: (id: string) => void;
  onAction?: (action: string, notificationId: string) => void;
}

/**
 * Individual error notification component
 */
const ErrorNotificationItem: React.FC<ErrorNotificationProps> = ({
  notification,
  onDismiss,
  onAction,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (notification.autoDismiss && notification.dismissAfter) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, notification.dismissAfter);
      return () => clearTimeout(timer);
    }
  }, [notification.autoDismiss, notification.dismissAfter]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(notification.id);
    }, 200);
  }, [notification.id, onDismiss]);

  const handleAction = (action: string) => {
    if (onAction) {
      onAction(action, notification.id);
    }
    if (action !== 'retry' && action !== 'retry-delayed') {
      handleDismiss();
    }
  };

  const getSeverityStyles = (severity: ErrorSeverity) => {
    switch (severity) {
      case 'error':
        return {
          container: 'error-notification-error',
          icon: '[X]',
          iconColor: '#ff6b6b',
        };
      case 'warning':
        return {
          container: 'error-notification-warning',
          icon: '[!]',
          iconColor: '#ffd93d',
        };
      case 'info':
        return {
          container: 'error-notification-info',
          icon: '[i]',
          iconColor: '#74b9ff',
        };
    }
  };

  const styles = getSeverityStyles(notification.severity);

  return (
    <div
      className={`error-notification ${styles.container} ${isExiting ? 'error-notification-exit' : ''}`}
      role="alert"
      aria-live={notification.severity === 'error' ? 'assertive' : 'polite'}
    >
      <div className="error-notification-header">
        <span className="error-notification-icon" style={{ color: styles.iconColor }}>
          {styles.icon}
        </span>
        <div className="error-notification-content">
          <div className="error-notification-title">{notification.title}</div>
          <div className="error-notification-message">{notification.message}</div>
        </div>
        <button
          className="error-notification-close"
          onClick={handleDismiss}
          aria-label="Dismiss notification"
        >
          x
        </button>
      </div>

      {notification.details && (
        <div className="error-notification-details-toggle">
          <button
            className="error-notification-toggle-btn"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '[-] Hide Details' : '[+] Show Details'}
          </button>
          {isExpanded && (
            <div className="error-notification-details">
              <code>{notification.details}</code>
            </div>
          )}
        </div>
      )}

      {notification.actions && notification.actions.length > 0 && (
        <div className="error-notification-actions">
          {notification.actions.map((action: RecoveryAction) => (
            <button
              key={action.action}
              className="error-notification-action-btn"
              onClick={() => handleAction(action.action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface ErrorNotificationContainerProps {
  notifications: ErrorNotificationData[];
  onDismiss: (id: string) => void;
  onAction?: (action: string, notificationId: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  maxVisible?: number;
}

/**
 * Container for managing multiple error notifications
 */
export const ErrorNotificationContainer: React.FC<ErrorNotificationContainerProps> = ({
  notifications,
  onDismiss,
  onAction,
  position = 'top-right',
  maxVisible = 5,
}) => {
  const visibleNotifications = notifications.slice(0, maxVisible);
  const hiddenCount = Math.max(0, notifications.length - maxVisible);

  return (
    <div className={`error-notification-container error-notification-${position}`}>
      {visibleNotifications.map((notification) => (
        <ErrorNotificationItem
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
          onAction={onAction}
        />
      ))}
      {hiddenCount > 0 && (
        <div className="error-notification-overflow">
          +{hiddenCount} more notification{hiddenCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

/**
 * Hook for managing error notifications
 */
export function useErrorNotifications() {
  const [notifications, setNotifications] = useState<ErrorNotificationData[]>([]);

  const addNotification = useCallback((notification: ErrorNotificationData) => {
    setNotifications((prev) => {
      // Prevent duplicate notifications with same message
      const isDuplicate = prev.some(
        (n) => n.message === notification.message && n.code === notification.code
      );
      if (isDuplicate) {
        return prev;
      }
      return [notification, ...prev];
    });
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const clearByCode = useCallback((code: number) => {
    setNotifications((prev) => prev.filter((n) => n.code !== code));
  }, []);

  return {
    notifications,
    addNotification,
    dismissNotification,
    clearAllNotifications,
    clearByCode,
  };
}

export default ErrorNotificationContainer;
