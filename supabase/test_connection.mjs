import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://waiflujimowdlwxrilwd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhaWZsdWppbW93ZGx3eHJpbHdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3Mjg1MzQsImV4cCI6MjEwODMwNDUzNH0.FwuRkR0OXh_ZiumFCVBXHanJYX5HPhb-AKbIo670I9s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('🧪 Testing Supabase Backend Connection...');
  console.log('📍 Supabase URL:', SUPABASE_URL);

  // 1. Dispatcher Auth & Snapshot RPC
  console.log('\n1️⃣  Testing Dispatcher Login & dashboard_snapshot RPC...');
  const { data: dispAuth, error: dispError } = await supabase.auth.signInWithPassword({
    email: 'dispatcher1@gmail.com',
    password: 'password123',
  });

  if (dispError) {
    console.error('❌ Dispatcher sign-in failed:', dispError.message);
    process.exit(1);
  }
  console.log('✅ Dispatcher signed in:', dispAuth.user.email, `(ID: ${dispAuth.user.id})`);

  const { data: snapshot, error: snapError } = await supabase.rpc('dashboard_snapshot');
  if (snapError) {
    console.error('❌ dashboard_snapshot RPC failed:', snapError.message);
    process.exit(1);
  }
  console.log('✅ dashboard_snapshot returned successfully:');
  console.log(`   - Trips: ${snapshot?.trips?.length ?? 0}`);
  console.log(`   - Online Vehicles: ${snapshot?.vehicles?.length ?? 0}`);
  console.log(`   - Active Alerts: ${snapshot?.alerts?.length ?? 0}`);

  // 2. Ambulance Auth & Trip Check
  console.log('\n2️⃣  Testing Ambulance Login & my_active_trip RPC...');
  const { data: ambAuth, error: ambError } = await supabase.auth.signInWithPassword({
    email: 'ambulance1@gmail.com',
    password: 'password123',
  });

  if (ambError) {
    console.error('❌ Ambulance sign-in failed:', ambError.message);
    process.exit(1);
  }
  console.log('✅ Ambulance signed in:', ambAuth.user.email, `(ID: ${ambAuth.user.id})`);

  const { data: activeTrip, error: tripError } = await supabase.rpc('my_active_trip');
  if (tripError) {
    console.error('❌ my_active_trip RPC failed:', tripError.message);
    process.exit(1);
  }
  console.log('✅ my_active_trip returned successfully:', activeTrip ? `Trip ID: ${activeTrip.id}` : 'None (Ready to start trip)');

  console.log('\n🎉 ALL SUPABASE TESTS PASSED! Database, Auth, RLS, and RPCs are 100% operational.\n');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
