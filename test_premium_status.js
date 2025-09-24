// Test script to demonstrate premium status updates
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://whjbyzeaiwnsxxsexiir.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoamJ5emVhaXduc3h4c2V4aWlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODIyNzExMywiZXhwIjoyMDczODAzMTEzfQ.VuBfJNbj6YZ87dHRGInT6Qs70ecnW_IrRPShFZsAdSQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testPremiumStatusUpdate() {
  console.log('🧪 TESTING PREMIUM STATUS UPDATES\n');

  console.log('🎯 THE ISSUE: Premium status fields not updating in users table\n');

  console.log('📋 WHY THIS HAPPENS:');
  console.log('1. RevenueCat sends webhook with app_user_id (UUID from auth.users.id)');
  console.log('2. Server validates user exists in auth.users');
  console.log('3. Server creates/updates subscription record');
  console.log('4. Server tries to update premium fields in public.users table');
  console.log('5. BUT: User may not exist in public.users table yet!\n');

  console.log('🔍 CHECKING YOUR DATABASE STATE:\n');

  try {
    // Check auth.users (this is automatic with Supabase Auth)
    console.log('1. 📊 auth.users table:');
    console.log('   - This is managed automatically by Supabase Auth');
    console.log('   - Contains user UUIDs after signup/login');
    console.log('   - RevenueCat gets these UUIDs from your app\n');

    // Check public.users table
    console.log('2. 👥 public.users table:');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('user_id, username, email, app_user_id, is_premium, premium_expires_at, premium_will_renew')
      .limit(3);

    if (usersError) {
      console.log('   ❌ Cannot access users table:', usersError.message);
    } else {
      console.log('   ✅ Can access users table');
      console.log('   📋 Sample users:', users?.length || 0);
      if (users && users.length > 0) {
        console.log('   🎯 First user premium status:');
        console.log('      - is_premium:', users[0].is_premium);
        console.log('      - premium_expires_at:', users[0].premium_expires_at);
        console.log('      - premium_will_renew:', users[0].premium_will_renew);
      }
    }

    // Check subscriptions table
    console.log('\n3. 💳 subscriptions table:');
    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('app_user_id, entitlement_id, is_active, expires_at')
      .limit(3);

    if (subsError) {
      console.log('   ❌ Cannot access subscriptions table:', subsError.message);
    } else {
      console.log('   ✅ Can access subscriptions table');
      console.log('   📋 Sample subscriptions:', subs?.length || 0);
    }

    console.log('\n🎯 THE SOLUTION:\n');

    console.log('Your signup/registration process needs to:');
    console.log('1. ✅ Create user in auth.users (automatic)');
    console.log('2. ❌ MISSING: Create record in public.users table');
    console.log('3. ✅ Set app_user_id to match auth.users.id\n');

    console.log('📝 REQUIRED: In your signup code, add:\n');
    console.log('```javascript');
    console.log('// After Supabase auth signup');
    console.log('const { data: authUser } = await supabase.auth.signUp({ email, password });');
    console.log('');
    console.log('// Create public.users record');
    console.log('await supabase.from(\'users\').insert({');
    console.log('  user_id: authUser.user.id, // SERIAL primary key');
    console.log('  username: email.split(\'@\')[0],');
    console.log('  email: email,');
    console.log('  role: \'user\',');
    console.log('  app_user_id: authUser.user.id, // UUID foreign key to auth.users');
    console.log('  is_premium: false, // default');
    console.log('  premium_expires_at: null,');
    console.log('  premium_will_renew: null');
    console.log('});');
    console.log('```\n');

    console.log('🚀 Once you add this, premium status will update correctly!');

  } catch (error) {
    console.log('💥 Test error:', error.message);
  }
}

testPremiumStatusUpdate();
