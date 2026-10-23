import { useEffect, useState, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { useDashboard } from './hooks/useDashboard';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Map } from './components/Map';
import { Login } from './components/Login';
import { deriveMetrics, activeTrips } from './lib/derive';
import type { Trip } from './lib/types';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isDispatcher, setIsDispatcher] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Selected trip for map tracking
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [followAmbulance, setFollowAmbulance] = useState<boolean>(true);
  const [focusedVehiclePos, setFocusedVehiclePos] = useState<[number, number] | null>(null);

  // Step 1 Supabase connection test card state
  const [connStatus, setConnStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [connError, setConnError] = useState<string | null>(null);

  // Check Supabase connection on startup
  const testSupabaseConnection = async () => {
    setConnStatus('checking');
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
      setAuthLoading(true);
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
    testSupabaseConnection();
    verifySession();

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

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setIsDispatcher(false);
  };

  // Live telemetry hook
  const { snapshot, connection, lastUpdated } = useDashboard(isDispatcher);

  // Auto-select newest active trip if none selected or if selected trip ended
  useEffect(() => {
    if (!snapshot?.trips) return;
    const active = activeTrips(snapshot.trips);
    if (active.length > 0) {
      const isCurrentActive = active.some((t) => t.id === selectedTripId);
      if (!selectedTripId || !isCurrentActive) {
        setSelectedTripId(active[0].id);
      }
    }
  }, [snapshot?.trips, selectedTripId]);

  const selectedTrip = useMemo<Trip | null>(() => {
    if (!snapshot?.trips) return null;
    return snapshot.trips.find((t) => t.id === selectedTripId) || null;
  }, [snapshot?.trips, selectedTripId]);

  const metrics = useMemo(() => {
    return deriveMetrics(snapshot, selectedTripId);
  }, [snapshot, selectedTripId]);

  const handleFocusVehicle = (pos: [number, number]) => {
    setFollowAmbulance(false);
    setFocusedVehiclePos(pos);
    // Clear focus after small pan delay
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

        <Login onSuccess={() => verifySession()} />
      </div>
    );
  }

  return (
    <div className="dashboard-root">
      <Header
        connection={connection}
        lastUpdated={lastUpdated}
        onSignOut={handleSignOut}
      />

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
          selectedTripId={selectedTripId}
          onSelectTrip={(id) => {
            setSelectedTripId(id);
            setFollowAmbulance(true);
          }}
          onFocusVehicle={handleFocusVehicle}
          metrics={metrics}
        />
      </main>
    </div>
  );
}
