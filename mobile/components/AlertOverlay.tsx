import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  SafeAreaView,
} from 'react-native';
import * as Speech from 'expo-speech';
import { MOVE_SIDE } from '../lib/config';
import { AlertData } from '../hooks/useMyAlerts';

interface AlertOverlayProps {
  alert: AlertData | null;
  justCleared: boolean;
  onAcknowledge: (alertId: string) => void;
}

export const AlertOverlay: React.FC<AlertOverlayProps> = ({
  alert,
  justCleared,
  onAcknowledge,
}) => {
  const flashAnim = useRef(new Animated.Value(1)).current;
  const speechIntervalRef = useRef<any>(null);
  const vibrationIntervalRef = useRef<any>(null);

  const isAcknowledged = alert?.status === 'acknowledged';
  const isBlocking = alert?.blocking === true;
  const roundedDist = alert ? Math.round(alert.distance_m / 10) * 10 : 0;

  // Gentle flashing animation only when alert is active (not acknowledged)
  useEffect(() => {
    if (!alert || isAcknowledged) {
      flashAnim.setValue(1);
      return;
    }

    const flashLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flashAnim, {
          toValue: 0.5,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    flashLoop.start();

    return () => {
      flashLoop.stop();
    };
  }, [alert, isAcknowledged, flashAnim]);

  // Speech and Vibration feedback loop
  useEffect(() => {
    if (!alert || isAcknowledged) {
      if (speechIntervalRef.current) clearInterval(speechIntervalRef.current);
      if (vibrationIntervalRef.current) clearInterval(vibrationIntervalRef.current);
      Speech.stop();
      Vibration.cancel();
      return;
    }

    const spokenText = isBlocking
      ? `You are blocking the emergency ambulance. Move aside now.`
      : `Ambulance approaching. Please move to the ${MOVE_SIDE} and let it pass.`;

    const speakNow = () => {
      Speech.speak(spokenText, {
        language: 'en',
        rate: 1.0,
      });
    };

    const vibrateNow = () => {
      Vibration.vibrate([0, 500, 200, 500]);
    };

    // Immediate triggers
    speakNow();
    vibrateNow();

    speechIntervalRef.current = setInterval(speakNow, 8000);
    vibrationIntervalRef.current = setInterval(vibrateNow, 3000);

    return () => {
      if (speechIntervalRef.current) clearInterval(speechIntervalRef.current);
      if (vibrationIntervalRef.current) clearInterval(vibrationIntervalRef.current);
      Speech.stop();
      Vibration.cancel();
    };
  }, [alert?.id, isAcknowledged, isBlocking]);

  // Cleared banner rendering
  if (justCleared && !alert) {
    return (
      <View style={styles.clearedBanner}>
        <Text style={styles.clearedEmoji}>✅</Text>
        <Text style={styles.clearedTitle}>Ambulance has passed</Text>
        <Text style={styles.clearedSubtitle}>Thank you for clearing the path!</Text>
      </View>
    );
  }

  if (!alert) return null;

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View
        style={[
          styles.card,
          isAcknowledged ? styles.calmCard : styles.urgentCard,
          !isAcknowledged && { opacity: flashAnim },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.sirenIcon}>{isBlocking ? '🚨' : '🚑'}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {isBlocking ? 'BLOCKING VEHICLE' : isAcknowledged ? 'MOVING ASIDE' : 'EMERGENCY ALERT'}
            </Text>
          </View>
        </View>

        <Text style={styles.heading}>
          {isBlocking ? 'You are blocking the ambulance!' : 'Ambulance Approaching'}
        </Text>

        <View style={styles.distanceBox} accessible={true} accessibilityLabel={`Distance to ambulance: ${roundedDist} meters behind you`}>
          <Text style={styles.distanceNumber}>{roundedDist}</Text>
          <Text style={styles.distanceUnit}>meters behind you</Text>
        </View>

        <Text style={styles.instruction}>
          {isBlocking
            ? 'You are stationary or slow directly in the ambulance route. Move aside immediately!'
            : `Please move to the ${MOVE_SIDE.toUpperCase()} and let the ambulance pass.`}
        </Text>

        {!isAcknowledged ? (
          <TouchableOpacity
            style={styles.ackButton}
            onPress={() => onAcknowledge(alert.id)}
            activeOpacity={0.85}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="I am moving aside"
            accessibilityHint="Confirms to the dispatcher and ambulance that you are clearing the road"
          >
            <Text style={styles.ackButtonText}>I'm Moving Aside</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.acknowledgedBox} accessible={true} accessibilityRole="status">
            <Text style={styles.acknowledgedText}>
              ✓ Status reported: Moving to the {MOVE_SIDE}. Stand by until ambulance passes.
            </Text>
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  urgentCard: {
    backgroundColor: '#b91c1c',
    borderColor: '#ef4444',
  },
  calmCard: {
    backgroundColor: '#1e293b',
    borderColor: '#3b82f6',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 2,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  sirenIcon: {
    fontSize: 36,
  },
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heading: {
    fontSize: 26,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 32,
  },
  distanceBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
    marginBottom: 16,
  },
  distanceNumber: {
    fontSize: 48,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
  },
  distanceUnit: {
    fontSize: 14,
    color: '#fecaca',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  instruction: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  ackButton: {
    backgroundColor: '#ffffff',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
    elevation: 4,
  },
  ackButtonText: {
    color: '#b91c1c',
    fontSize: 18,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  acknowledgedBox: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderColor: '#22c55e',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    width: '100%',
  },
  acknowledgedText: {
    color: '#86efac',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  clearedBanner: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: '#15803d',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    zIndex: 99999,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  clearedEmoji: {
    fontSize: 32,
    marginBottom: 4,
  },
  clearedTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  clearedSubtitle: {
    fontSize: 13,
    color: '#bbf7d0',
    marginTop: 2,
  },
});
