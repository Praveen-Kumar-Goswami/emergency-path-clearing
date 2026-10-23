import React from 'react';
import type { DashboardConnection } from '../hooks/useDashboard';

export type DashboardView = 'map' | 'analytics' | 'how-it-works' | 'fleet';

interface HeaderProps {
  connection: DashboardConnection;
  lastUpdated: Date | null;
  currentView: DashboardView;
  onSelectView: (view: DashboardView) => void;
  onSignOut: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connection,
  lastUpdated,
  currentView,
  onSelectView,
  onSignOut,
}) => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-logo">🚨</div>
        <div className="brand-text">
          <h1>Path Clear Dispatch</h1>
          <span className="brand-sub">Emergency Fleet Corridor Control</span>
        </div>
      </div>

      {/* Navigation View Switcher */}
      <nav className="header-nav" role="tablist" aria-label="Dashboard Views">
        <button
          role="tab"
          aria-selected={currentView === 'map'}
          className={`nav-btn ${currentView === 'map' ? 'active' : ''}`}
          onClick={() => onSelectView('map')}
        >
          <span className="nav-icon" aria-hidden="true">🗺️</span>
          <span>Live Fleet Map</span>
        </button>

        <button
          role="tab"
          aria-selected={currentView === 'analytics'}
          className={`nav-btn ${currentView === 'analytics' ? 'active' : ''}`}
          onClick={() => onSelectView('analytics')}
        >
          <span className="nav-icon" aria-hidden="true">📊</span>
          <span>Corridor Analytics</span>
        </button>

        <button
          role="tab"
          aria-selected={currentView === 'how-it-works'}
          className={`nav-btn ${currentView === 'how-it-works' ? 'active' : ''}`}
          onClick={() => onSelectView('how-it-works')}
        >
          <span className="nav-icon" aria-hidden="true">🔬</span>
          <span>How It Works & Lab</span>
        </button>

        <button
          role="tab"
          aria-selected={currentView === 'fleet'}
          className={`nav-btn ${currentView === 'fleet' ? 'active' : ''}`}
          onClick={() => onSelectView('fleet')}
        >
          <span className="nav-icon" aria-hidden="true">👥</span>
          <span>Fleet & Units</span>
        </button>
      </nav>

      <div className="header-meta">
        <div className={`telemetry-pill ${connection}`} role="status" aria-live="polite">
          <span className="pill-dot" aria-hidden="true" />
          <span>
            {connection === 'live'
              ? 'LIVE TELEMETRY'
              : connection === 'reconnecting'
              ? 'RECONNECTING...'
              : 'OFFLINE'}
          </span>
        </div>

        {lastUpdated && (
          <span className="last-upd">
            {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}

        <button className="sign-out-btn" onClick={onSignOut} title="Sign Out">
          <span>Exit</span>
          <span>🚪</span>
        </button>
      </div>
    </header>
  );
};
