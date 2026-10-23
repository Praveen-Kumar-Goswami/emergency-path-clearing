import type { DashboardConnection } from '../hooks/useDashboard';

interface HeaderProps {
  connection: DashboardConnection;
  lastUpdated: Date | null;
  onSignOut: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connection,
  lastUpdated,
  onSignOut,
}) => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="brand-icon">🚨</span>
        <div className="brand-text">
          <h1>Emergency Path Clearing</h1>
          <span className="brand-sub">Dispatch Fleet Console</span>
        </div>
      </div>

      <div className="header-meta">
        <div className={`connection-pill pill-${connection}`}>
          <span className="status-dot" />
          <span className="status-label">
            {connection === 'live'
              ? 'LIVE TELEMETRY'
              : connection === 'reconnecting'
              ? 'RECONNECTING...'
              : 'OFFLINE'}
          </span>
        </div>

        {lastUpdated && (
          <span className="last-sync">
            Updated: {lastUpdated.toLocaleTimeString()}
          </span>
        )}

        <button className="signout-btn" onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </header>
  );
};
