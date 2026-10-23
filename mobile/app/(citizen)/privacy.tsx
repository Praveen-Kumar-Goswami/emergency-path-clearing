import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';

export default function CitizenPrivacyScreen() {
  const router = useRouter();
  const { userId, signOut } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAndSignOut = async () => {
    Alert.alert(
      'Delete Data & Sign Out',
      'This will immediately remove your vehicle location entry from the database and sign you out.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete & Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsDeleting(true);
              if (userId) {
                await supabase.from('vehicle_locations').delete().eq('user_id', userId);
              }
              await signOut();
              router.replace('/');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete data.');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Data & Privacy Policy</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardHeading}>🛡️ Minimal Data Collection</Text>
          <Text style={styles.cardText}>
            Emergency Path Clearing was designed from the ground up for strict driver privacy. We
            do not track journeys, build location profiles, or retain persistent location logs.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What is collected:</Text>

          <View style={styles.item}>
            <Text style={styles.itemTitle}>1. Live Coordinates</Text>
            <Text style={styles.itemDesc}>
              Latitude and longitude are collected strictly while the sharing toggle is turned ON
              and the app is in the foreground.
            </Text>
          </View>

          <View style={styles.item}>
            <Text style={styles.itemTitle}>2. Speed & Heading</Text>
            <Text style={styles.itemDesc}>
              Speed in km/h is used solely to distinguish moving vehicles from stationary/blocking
              vehicles. Compass heading is used to verify that your vehicle is traveling in the same
              direction as the approaching ambulance.
            </Text>
          </View>

          <View style={styles.item}>
            <Text style={styles.itemTitle}>3. Single-Row Storage</Text>
            <Text style={styles.itemDesc}>
              Only a single database row exists per user. Each location update completely
              overwrites the previous fix. Historical tracks are never logged.
            </Text>
          </View>

          <View style={styles.item}>
            <Text style={styles.itemTitle}>4. Automatic Ephemeral Expiry</Text>
            <Text style={styles.itemDesc}>
              Any telemetry row older than 2 minutes of silence is automatically excluded by the
              corridor matcher and cleaned up by database maintenance jobs.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDeleteAndSignOut}
          disabled={isDeleting}
          activeOpacity={0.85}
        >
          {isDeleting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.deleteBtnText}>Delete My Data & Sign Out</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
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
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  backBtn: {
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  backBtnText: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f8fafc',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#cbd5e1',
    marginBottom: 12,
  },
  item: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  itemTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  itemDesc: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  deleteBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  deleteBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
