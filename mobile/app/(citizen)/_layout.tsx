import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { View, ActivityIndicator } from 'react-native';

export default function CitizenLayout() {
  const { session, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!session) {
        router.replace('/');
      } else if (role && role !== 'citizen') {
        router.replace('/');
      }
    }
  }, [session, role, loading, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
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
      <Stack.Screen name="privacy" />
    </Stack>
  );
}
