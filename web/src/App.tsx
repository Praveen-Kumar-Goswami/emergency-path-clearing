import { useEffect, useState, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { useDashboard } from './hooks/useDashboard';
import { Header, type DashboardView } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Map } from './components/Map';
import { Login } from './components/Login';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { HowItWorksDashboard } from './components/HowItWorksDashboard';
import { FleetDirectory } from './components/FleetDirectory';
import { deriveMetrics, activeTrips } from './lib/derive';
import type { Trip } from './lib/types';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isDispatcher, setIsDispatcher] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Active dashboard view tab
  const [currentView, setCurrentView] = useState<DashboardView>('map');

  // Selected trip for map tracking
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [followAmbulance, setFollowAmbulance] = useState<boolean>(true);
  const [focusedVehiclePos, setFocusedVehiclePos] = useState<[number, number] | null>(null);

  // Step 1 Supabase connection test card state
  const [connStatus, setConnStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [connError, setConnError] = useState<string | null>(null);

  // Check Supabase connection on startup
  const testSupabaseConnection = async () => {
    try {
      const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
      if (error) {
        setConnStatus('error');
        setConnError(error.message);
      } else {
        setConnStatus('connected');
        setConnError(null);
      }
    } catch (e: any) {
      setConnStatus('error');
      setConnError(e.message || 'Failed to reach Supabase backend.');
    }
  };

  // Restore and verify session
  const verifySession = async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (currentSession?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', currentSession.user.id)
          .maybeSingle();

        if (profile?.role === 'dispatcher') {
          setSession(currentSession);
          setIsDispatcher(true);
        } else {
          await supabase.auth.signOut();
          setSession(null);
          setIsDispatcher(false);
        }
      } else {
        setSession(null);
        setIsDispatcher(false);
      }
    } catch (e) {
      console.warn('Session verification error:', e);
      setSession(null);
      setIsDispatcher(false);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;

    const bootstrap = async () => {
      try {
        const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
        if (!ignore) {
          if (error) {
            setConnStatus('error');
            setConnError(error.message);
          } else {
            setConnStatus('connected');
            setConnError(null);
          }
        }
      } catch (e: any) {
        if (!ignore) {
          setConnStatus('error');
          setConnError(e.message || 'Failed to reach Supabase backend.');
        }
      }

      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!ignore) {
          if (currentSession?.user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', currentSession.user.id)
              .maybeSingle();

            if (profile?.role === 'dispatcher') {
              setSession(currentSession);
              setIsDispatcher(true);
            } else {
              setSession(null);
              setIsDispatcher(false);
            }
          } else {
            setSession(null);
            setIsDispatcher(false);
          }
          setAuthLoading(false);
        }
      } catch (e) {
        if (!ignore) {
          console.warn('Session verification error:', e);
          setSession(null);
          setIsDispatcher(false);
          setAuthLoading(false);
        }
      }
    };

    void bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', newSession.user.id)
          .maybeSingle();

        if (profile?.role === 'dispatcher') {
          setSession(newSession);
          setIsDispatcher(true);
        } else {
          setSession(null);
          setIsDispatcher(false);
        }
      } else {
        setSession(null);
        setIsDispatcher(false);
      }
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setIsDispatcher(false);
  };

  // Live telemetry hook
  const { snapshot, connection, lastUpdated } = useDashboard(isDispatcher);

  const trips = snapshot?.trips;
  const active = useMemo(() => activeTrips(trips || []), [trips]);

  // Derived effective trip selection: either user's selection if still present/active, or first active trip
  const effectiveSelectedTripId = useMemo(() => {
    if (selectedTripId && trips?.some((t) => t.id === selectedTripId)) {
      return selectedTripId;
    }
    return active[0]?.id || selectedTripId || null;
  }, [selectedTripId, trips, active]);

  const selectedTrip = useMemo<Trip | null>(() => {
    if (!trips || !effectiveSelectedTripId) return null;
    return trips.find((t) => t.id === effectiveSelectedTripId) || null;
  }, [trips, effectiveSelectedTripId]);

  const metrics = useMemo(() => {
    return deriveMetrics(snapshot, effectiveSelectedTripId);
  }, [snapshot, effectiveSelectedTripId]);

  const handleFocusVehicle = (pos: [number, number]) => {
    setCurrentView('map');
    setFollowAmbulance(false);
    setFocusedVehiclePos(pos);
    setTimeout(() => setFocusedVehiclePos(null), 1000);
  };

  if (authLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Restoring dispatcher session...</p>
      </div>
    );
  }

  // Not signed in as dispatcher
  if (!session || !isDispatcher) {
    return (
      <div className="auth-page">
        {/* Step 1 Supabase test card */}
        <div className={`conn-status-bar ${connStatus}`}>
          <span className="dot" />
          <span>
            {connStatus === 'connected'
              ? 'Connected to Supabase'
              : connStatus === 'checking'
              ? 'Checking Supabase connection...'
              : `Supabase Error: ${connError}`}
          </span>
          {connStatus === 'error' && (
            <button className="retry-conn-btn" onClick={testSupabaseConnection}>
              Retry
            </button>
          )}
        </div>

        <div className="auth-hero">
          <span className="auth-hero-icon">🚨</span>
          <h1>Emergency Path Clearing</h1>
          <p>Real-Time Spatial Corridor Warning & Fleet Dispatch System</p>
        </div>

        <Login onSuccess={() => verifySession()} />
      </div>
    );
  }

  return (
    <div className="dashboard-root">
      <Header
        connection={connection}
        lastUpdated={lastUpdated}
        currentView={currentView}
        onSelectView={setCurrentView}
        onSignOut={handleSignOut}
      />

      {/* View 1: Live Interactive Fleet Map */}
      {currentView === 'map' && (
        <main className="dashboard-body">
          <div className="map-panel">
            <Map
              selectedTrip={selectedTrip}
              vehicles={snapshot?.vehicles || []}
              alerts={snapshot?.alerts || []}
              follow={followAmbulance}
              onToggleFollow={() => setFollowAmbulance(!followAmbulance)}
              focusedVehiclePos={focusedVehiclePos}
            />
          </div>

          <Sidebar
            trips={snapshot?.trips || []}
            vehicles={snapshot?.vehicles || []}
            alerts={snapshot?.alerts || []}
            selectedTripId={effectiveSelectedTripId}
            onSelectTrip={(id) => {
              setSelectedTripId(id);
              setFollowAmbulance(true);
            }}
            onFocusVehicle={handleFocusVehicle}
            metrics={metrics}
          />
        </main>
      )}

      {/* View 2: Corridor Analytics & Congestion Dashboard */}
      {currentView === 'analytics' && (
        <main className="dashboard-body view-scrollable">
          <AnalyticsDashboard
            snapshot={snapshot}
            onSelectTrip={(tripId) => {
              setSelectedTripId(tripId);
              setCurrentView('map');
            }}
          />
        </main>
      )}

      {/* View 3: How It Works & Interactive PostGIS Lab */}
      {currentView === 'how-it-works' && (
        <main className="dashboard-body view-scrollable">
          <HowItWorksDashboard snapshot={snapshot} />
        </main>
      )}

      {/* View 4: Fleet & Personnel Directory */}
      {currentView === 'fleet' && (
        <main className="dashboard-body view-scrollable">
          <FleetDirectory
            snapshot={snapshot}
            onFocusVehicle={handleFocusVehicle}
          />
        </main>
      )}
    </div>
  );
}
