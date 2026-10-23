import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { View, ActivityIndicator } from 'react-native';

export default function AmbulanceLayout() {
  const { session, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!session) {
        router.replace('/');
      } else if (role && role !== 'ambulance') {
        router.replace('/');
      }
    }
  }, [session, role, loading, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#dc2626" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0f172a' },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="trip" />
    </Stack>
  );
}
