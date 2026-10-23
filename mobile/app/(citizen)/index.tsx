import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Linking,
  SafeAreaView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { useLocationSharing } from '../../hooks/useLocationSharing';
import { useMyAlerts } from '../../hooks/useMyAlerts';
import { AlertOverlay } from '../../components/AlertOverlay';

export default function CitizenHomeScreen() {
  const router = useRouter();
  const { userId, signOut } = useAuth();
  const {
    isSharing,
    setIsSharing,
    hasPermission,
    permissionDenied,
    requestPermission,
    speedKmh,
    accuracy,
    lastSentAge,
    error: locError,
    status: sharingStatus,
  } = useLocationSharing();

  const {
    primaryAlert,
    justCleared,
    connectionState,
    acknowledgeAlert,
  } = useMyAlerts();

  const shortId = userId ? userId.substring(0, 6) : 'unknown';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.roleTitle}>Driver Mode</Text>
            <Text style={styles.userIdText}>Device ID: #{shortId}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.liveBadge}>
              <View
                style={[
                  styles.liveDot,
                  connectionState === 'live' ? styles.liveDotGreen : styles.liveDotAmber,
                ]}
              />
              <Text style={styles.liveText}>
                {connectionState === 'live' ? 'Realtime Live' : 'Reconnecting...'}
              </Text>
            </View>
          </View>
        </View>

        {/* Permission Explanation Card if not granted */}
        {hasPermission !== true && (
          <View style={styles.permissionCard}>
            <Text style={styles.permIcon}>📍</Text>
            <Text style={styles.permTitle}>Location Access Required</Text>
            <Text style={styles.permBody}>
              To notify you when an emergency vehicle is approaching behind you, the app checks if
              your car is inside the ambulance's active corridor.
            </Text>
            <View style={styles.privacyBullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>
                Only 1 location row is stored, overwritten live on each update.
              </Text>
            </View>
            <View style={styles.privacyBullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>
                Automatically deleted after 2 minutes of inactivity or when you turn off sharing.
              </Text>
            </View>

            {permissionDenied ? (
              <TouchableOpacity
                style={styles.settingsBtn}
                onPress={() => Linking.openSettings()}
                activeOpacity={0.85}
              >
                <Text style={styles.settingsBtnText}>Open Device Settings</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.allowBtn}
                onPress={requestPermission}
                activeOpacity={0.85}
              >
                <Text style={styles.allowBtnText}>Grant Location Permission</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Sharing Toggle Card */}
        <View style={styles.toggleCard}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.toggleTitle}>Share my location to help ambulances</Text>
              <Text style={styles.toggleSub}>
                {isSharing
                  ? 'Transmitting GPS corridor fixes to protect approaching ambulances.'
                  : 'Location sharing is currently paused. You will not receive corridor alerts.'}
              </Text>
            </View>
            <Switch
              value={isSharing}
              onValueChange={setIsSharing}
              trackColor={{ false: '#334155', true: '#2563eb' }}
              thumbColor={isSharing ? '#ffffff' : '#94a3b8'}
            />
          </View>
        </View>

        {/* Status Metrics Card */}
        <View style={styles.metricsCard}>
          <Text style={styles.metricsHeading}>Live Telemetry Status</Text>

          <View style={styles.statusPillRow}>
            <View
              style={[
                styles.statusPill,
                sharingStatus === 'sharing'
                  ? styles.pillGreen
                  : sharingStatus === 'paused'
                  ? styles.pillAmber
                  : styles.pillRed,
              ]}
            >
              <Text style={styles.pillText}>
                {sharingStatus === 'sharing'
                  ? '● Sharing Active'
                  : sharingStatus === 'paused'
                  ? '⏸ Sharing Paused'
                  : '⚠️ Telemetry Issue'}
              </Text>
            </View>
          </View>

          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Last Sent</Text>
              <Text style={styles.metricValue}>
                {lastSentAge !== null ? `${lastSentAge}s ago` : 'Waiting fix'}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Current Speed</Text>
              <Text style={styles.metricValue}>{speedKmh} km/h</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>GPS Accuracy</Text>
              <Text style={styles.metricValue}>
                {accuracy !== null ? `±${accuracy} m` : '—'}
              </Text>
            </View>
          </View>

          {locError && (
            <View style={styles.errorSubBox}>
              <Text style={styles.errorSubText}>{locError}</Text>
            </View>
          )}
        </View>

        {/* Visible Notice */}
        <View style={styles.noticeCard}>
          <Text style={styles.noticeIcon}>ℹ️</Text>
          <Text style={styles.noticeText}>
            Keep this screen open while driving. Foreground location sharing pauses when the screen
            locks.
          </Text>
        </View>

        {/* Bottom Actions */}
        <View style={styles.footerActions}>
          <TouchableOpacity
            style={styles.privacyLinkBtn}
            onPress={() => router.push('/(citizen)/privacy')}
            activeOpacity={0.8}
          >
            <Text style={styles.privacyLinkText}>Data & Privacy Policy</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.signOutBtn} onPress={signOut} activeOpacity={0.8}>
            <Text style={styles.signOutBtnText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Full screen Emergency Alert Overlay */}
      <AlertOverlay
        alert={primaryAlert}
        justCleared={justCleared}
        onAcknowledge={acknowledgeAlert}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  container: {
    padding: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  roleTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
  },
  userIdText: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveDotGreen: {
    backgroundColor: '#22c55e',
  },
  liveDotAmber: {
    backgroundColor: '#f59e0b',
  },
  liveText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },
  permissionCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  permIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  permTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8,
  },
  permBody: {
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 20,
    marginBottom: 12,
  },
  privacyBullet: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  bulletDot: {
    color: '#3b82f6',
    fontSize: 14,
    marginRight: 8,
    fontWeight: '900',
  },
  bulletText: {
    color: '#94a3b8',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  allowBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  allowBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsBtn: {
    backgroundColor: '#d97706',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  settingsBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  toggleCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  toggleSub: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  metricsCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  metricsHeading: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  statusPillRow: {
    marginBottom: 16,
  },
  statusPill: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  pillGreen: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  pillAmber: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  pillRed: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  pillText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 4,
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  metricValue: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '800',
  },
  errorSubBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorSubText: {
    color: '#f87171',
    fontSize: 12,
  },
  noticeCard: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 24,
    alignItems: 'center',
    gap: 12,
  },
  noticeIcon: {
    fontSize: 20,
  },
  noticeText: {
    color: '#94a3b8',
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  footerActions: {
    gap: 12,
  },
  privacyLinkBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  privacyLinkText: {
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '600',
  },
  signOutBtn: {
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  signOutBtnText: {
    color: '#f1f5f9',
    fontSize: 15,
    fontWeight: '700',
  },
});
