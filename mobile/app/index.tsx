import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function EntryScreen() {
  const router = useRouter();
  const { session, role, loading, error: authError, clearError, signInCitizen, signInStaff, registerStaff, signOut } = useAuth();

  // Supabase connection check state (Step 1 requirement)
  const [connStatus, setConnStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [connError, setConnError] = useState<string | null>(null);

  // Ambulance login & registration form state
  const [showAmbulanceLogin, setShowAmbulanceLogin] = useState(false);
  const [crewAuthMode, setCrewAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const checkConnection = async () => {
    setConnStatus('checking');
    setConnError(null);
    try {
      const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
      if (error) {
        setConnStatus('error');
        setConnError(error.message || 'Failed to reach Supabase backend.');
      } else {
        setConnStatus('connected');
        setConnError(null);
      }
    } catch (err: any) {
      setConnStatus('error');
      setConnError(err.message || 'Network request failed when contacting Supabase.');
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  // Role based redirection
  useEffect(() => {
    if (!loading && session && role) {
      if (role === 'citizen') {
        router.replace('/(citizen)');
      } else if (role === 'ambulance') {
        router.replace('/(ambulance)');
      }
    }
  }, [loading, session, role, router]);

  const handleCitizenPress = async () => {
    try {
      setFormError(null);
      clearError();
      await signInCitizen();
      router.replace('/(citizen)');
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  const handleAmbulanceSubmit = async () => {
    if (!email.trim() || !password) {
      setFormError('Please enter both email and password.');
      return;
    }
    if (crewAuthMode === 'register' && password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    try {
      setFormError(null);
      clearError();
      setSubmitting(true);
      let userRole: any;
      if (crewAuthMode === 'register') {
        userRole = await registerStaff(email, password, 'ambulance');
      } else {
        userRole = await signInStaff(email, password);
      }
      if (userRole === 'ambulance') {
        router.replace('/(ambulance)');
      }
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Restoring session...</Text>
      </View>
    );
  }

  // If user is a dispatcher on mobile
  if (session && role === 'dispatcher') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.badgeIcon}>🖥️</Text>
          <Text style={styles.title}>Dispatch Portal</Text>
          <Text style={styles.subtitle}>
            Dispatchers monitor fleet and active alerts using the web dashboard.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => signOut()} activeOpacity={0.8}>
            <Text style={styles.buttonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Title Header */}
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Text style={styles.headerIcon}>🚨</Text>
          </View>
          <Text style={styles.title}>Emergency Path Clearing</Text>
          <Text style={styles.tagline}>
            Live corridor alerts to clear real road paths for oncoming emergency ambulances.
          </Text>
        </View>

        {/* Step 1 Supabase Connection Card */}
        <View style={[styles.card, connStatus === 'connected' ? styles.cardSuccess : styles.cardPending]}>
          <View style={styles.connRow}>
            <View
              style={[
                styles.statusIndicator,
                connStatus === 'connected'
                  ? styles.indicatorSuccess
                  : connStatus === 'error'
                  ? styles.indicatorError
                  : styles.indicatorPending,
              ]}
            />
            <Text style={styles.cardTitle}>
              {connStatus === 'connected'
                ? 'Connected to Supabase'
                : connStatus === 'checking'
                ? 'Verifying Supabase connection...'
                : 'Connection Failed'}
            </Text>
          </View>
          {connStatus === 'error' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{connError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={checkConnection}>
                <Text style={styles.retryBtnText}>Retry Connection</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Auth Error Banner */}
        {(formError || authError) && (
          <View style={styles.authErrorCard}>
            <Text style={styles.authErrorText}>{formError || authError}</Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.driverButton}
            onPress={handleCitizenPress}
            activeOpacity={0.85}
          >
            <Text style={styles.driverIcon}>🚗</Text>
            <View style={styles.btnTextCol}>
              <Text style={styles.driverBtnTitle}>I'm a Driver</Text>
              <Text style={styles.driverBtnSub}>Get alerts when an ambulance approaches</Text>
            </View>
          </TouchableOpacity>

          {!showAmbulanceLogin ? (
            <TouchableOpacity
              style={styles.crewButton}
              onPress={() => {
                setShowAmbulanceLogin(true);
                setFormError(null);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.crewIcon}>🚑</Text>
              <View style={styles.btnTextCol}>
                <Text style={styles.crewBtnTitle}>Ambulance Crew Login</Text>
                <Text style={styles.crewBtnSub}>Start and broadcast emergency routes</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.loginFormCard}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>
                  {crewAuthMode === 'login' ? '🚑 Crew Sign In' : '🚑 Register Crew Unit'}
                </Text>
                <TouchableOpacity onPress={() => setShowAmbulanceLogin(false)}>
                  <Text style={styles.closeBtn}>Cancel</Text>
                </TouchableOpacity>
              </View>

              {/* Segmented Auth Mode Switcher */}
              <View style={styles.authModeToggle}>
                <TouchableOpacity
                  style={[styles.authModeBtn, crewAuthMode === 'login' && styles.authModeBtnActive]}
                  onPress={() => {
                    setCrewAuthMode('login');
                    setFormError(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.authModeBtnText, crewAuthMode === 'login' && styles.authModeBtnTextActive]}>
                    Sign In
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.authModeBtn, crewAuthMode === 'register' && styles.authModeBtnActive]}
                  onPress={() => {
                    setCrewAuthMode('register');
                    setFormError(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.authModeBtnText, crewAuthMode === 'register' && styles.authModeBtnTextActive]}>
                    New Account
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>Crew Email Address</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="ambulance@hospital.org"
                placeholderTextColor="#64748b"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>
                {crewAuthMode === 'register' ? 'Password (min 8 characters)' : 'Password'}
              </Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#64748b"
                secureTextEntry
                autoCapitalize="none"
              />

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleAmbulanceSubmit}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {crewAuthMode === 'login' ? 'Sign In as Crew' : 'Register Ambulance Unit'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 15,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  badgeIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerIcon: {
    fontSize: 34,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
  },
  cardSuccess: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: '#22c55e',
  },
  cardPending: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  indicatorSuccess: {
    backgroundColor: '#22c55e',
  },
  indicatorError: {
    backgroundColor: '#ef4444',
  },
  indicatorPending: {
    backgroundColor: '#f59e0b',
  },
  cardTitle: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  retryBtn: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  retryBtnText: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '600',
  },
  authErrorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  authErrorText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  actions: {
    gap: 16,
  },
  driverButton: {
    backgroundColor: '#2563eb',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 80,
    elevation: 3,
  },
  driverIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  crewButton: {
    backgroundColor: '#dc2626',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 80,
    elevation: 3,
  },
  crewIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  btnTextCol: {
    flex: 1,
  },
  driverBtnTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  driverBtnSub: {
    color: '#bfdbfe',
    fontSize: 13,
  },
  crewBtnTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  crewBtnSub: {
    color: '#fecaca',
    fontSize: 13,
  },
  loginFormCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  formTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  authModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 3,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  authModeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authModeBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  authModeBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  authModeBtnTextActive: {
    color: '#f87171',
    fontWeight: '700',
  },
  inputLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 16,
    minHeight: 48,
  },
  submitBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 20,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 24,
  },
});
