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
      <nav className="header-nav">
        <button
          className={`nav-btn ${currentView === 'map' ? 'active' : ''}`}
          onClick={() => onSelectView('map')}
        >
          <span className="nav-icon">🗺️</span>
          <span>Live Fleet Map</span>
        </button>

        <button
          className={`nav-btn ${currentView === 'analytics' ? 'active' : ''}`}
          onClick={() => onSelectView('analytics')}
        >
          <span className="nav-icon">📊</span>
          <span>Corridor Analytics</span>
        </button>

        <button
          className={`nav-btn ${currentView === 'how-it-works' ? 'active' : ''}`}
          onClick={() => onSelectView('how-it-works')}
        >
          <span className="nav-icon">🔬</span>
          <span>How It Works & Lab</span>
        </button>

        <button
          className={`nav-btn ${currentView === 'fleet' ? 'active' : ''}`}
          onClick={() => onSelectView('fleet')}
        >
          <span className="nav-icon">👥</span>
          <span>Fleet & Units</span>
        </button>
      </nav>

      <div className="header-meta">
        <div className={`telemetry-pill ${connection}`}>
          <span className="pill-dot" />
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
