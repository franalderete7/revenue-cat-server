const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables (replace with your actual values)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://whjbyzeaiwnsxxsexiir.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoamJ5emVhaXduc3h4c2V4aWlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODIyNzExMywiZXhwIjoyMDczODAzMTEzfQ.VuBfJNbj6YZ87dHRGInT6Qs70ecnW_IrRPShFZsAdSQ';

// Initialize Supabase client with service key for full access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to RevenueCat Server!',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Handle subscription events
async function handleSubscriptionEvent(event) {
  console.log('\n⚙️  PROCESSING SUBSCRIPTION EVENT:');
  console.log('- Event Type:', event.type);
  console.log('- App User ID:', event.app_user_id);

  const {
    type,
    app_user_id,
    product_id,
    entitlement_ids,
    entitlement_id,
    store,
    purchased_at_ms,
    expiration_at_ms,
    period_type,
    transaction_id,
    original_transaction_id,
    cancel_reason,
    expiration_reason,
    grace_period_expiration_at_ms,
    id: event_id,
    event_timestamp_ms
  } = event;

  // Check if this is an anonymous user
  const isAnonymous = app_user_id.startsWith('$RCAnonymousID:');
  console.log('- User Type Check:', isAnonymous ? 'ANONYMOUS' : 'AUTHENTICATED');

  if (isAnonymous) {
    console.log('🚫 EDGE CASE: ANONYMOUS USER DETECTED');
    console.log('   - Reason: app_user_id starts with $RCAnonymousID:');
    console.log('   - Schema Limitation: subscriptions.app_user_id is UUID foreign key to auth.users.id');
    console.log('   - Cannot Store: Anonymous IDs are TEXT strings, not valid UUIDs');
    console.log('   - Action: Skipping webhook processing');
    console.log('   - Solution: Modify schema to allow TEXT in app_user_id or create anonymous_subscriptions table');
    return;
  }

  console.log('✅ USER TYPE: AUTHENTICATED - proceeding with processing');

  // Check if user exists in auth.users (since app_user_id is a foreign key to auth.users.id)
  console.log('\n🔐 AUTH.USER VALIDATION:');
  console.log('- Checking if user exists in auth.users table...');

  try {
    const { data: userExists, error: userCheckError } = await supabase.auth.admin.getUserById(app_user_id);

    console.log('- Supabase auth.admin.getUserById result:');
    console.log('  - Error:', userCheckError ? userCheckError.message : 'null');
    console.log('  - User Found:', !!userExists);
    if (userExists) {
      console.log('  - User ID:', userExists.id);
      console.log('  - Email:', userExists.email);
      console.log('  - Created:', userExists.created_at);
    }

    if (userCheckError || !userExists) {
      console.log('🚫 EDGE CASE: USER NOT FOUND IN AUTH.USERS');
      console.log('   - Reason: User does not exist in Supabase auth.users table');
      console.log('   - Schema Constraint: subscriptions.app_user_id REFERENCES auth.users(id)');
      console.log('   - Cannot Insert: Foreign key constraint would fail');
      console.log('   - Action: Skipping webhook processing');
      console.log('   - Possible Causes:');
      console.log('     * Webhook sent before user account created');
      console.log('     * User account deleted but subscription still active');
      console.log('     * Webhook from different environment/project');
      return;
    }
  } catch (error) {
    console.log('🚫 EDGE CASE: AUTH CHECK ERROR');
    console.log('   - Error Type:', error.constructor.name);
    console.log('   - Error Message:', error.message);
    console.log('   - Action: Skipping webhook processing');
    console.log('   - Possible Causes:');
    console.log('     * Network issues with Supabase');
    console.log('     * Invalid service key');
    console.log('     * Supabase admin API not enabled');
    return;
  }

  console.log('✅ AUTH VALIDATION PASSED: User exists in auth.users');

  // Process entitlements
  const entitlements = entitlement_ids || (entitlement_id ? [entitlement_id] : []);
  console.log('\n📋 ENTITLEMENT PROCESSING:');
  console.log('- Entitlement IDs from webhook:', JSON.stringify(entitlement_ids));
  console.log('- Deprecated entitlement_id:', entitlement_id);
  console.log('- Using entitlements:', JSON.stringify(entitlements));

  if (!product_id || entitlements.length === 0) {
    console.log('🚫 EDGE CASE: MISSING REQUIRED DATA');
    console.log('   - Product ID present:', !!product_id, product_id || 'null');
    console.log('   - Entitlements present:', entitlements.length > 0, `count: ${entitlements.length}`);
    console.log('   - Action: Skipping webhook processing');
    console.log('   - Reason: Cannot create subscription without product and entitlements');
    return;
  }

  console.log('✅ REQUIREMENTS MET: Product and entitlements present');

  // Process each entitlement
  console.log('\n🔄 PROCESSING INDIVIDUAL ENTITLEMENTS:');
  for (let i = 0; i < entitlements.length; i++) {
    const entitlementId = entitlements[i];
    console.log(`\n   📄 Entitlement ${i + 1}/${entitlements.length}: ${entitlementId}`);
    await processSubscriptionEntitlement({
      event,
      app_user_id,
      product_id,
      entitlement_id: entitlementId,
      store,
      event_id,
      event_timestamp_ms
    });
  }

  console.log('\n✅ SUBSCRIPTION EVENT PROCESSING COMPLETE');
}

async function processSubscriptionEntitlement({
  event,
  app_user_id,
  product_id,
  entitlement_id,
  store,
  event_id,
  event_timestamp_ms
}) {
  console.log(`\n      🔧 Processing entitlement: ${entitlement_id}`);

  const {
    type,
    purchased_at_ms,
    expiration_at_ms,
    period_type,
    transaction_id,
    original_transaction_id,
    cancel_reason,
    expiration_reason,
    grace_period_expiration_at_ms
  } = event;

  try {
    // Check if subscription record already exists
    console.log('         🗄️  DATABASE CHECK: Looking for existing subscription...');
    const { data: existingSubscription, error: selectError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('app_user_id', app_user_id)
      .eq('entitlement_id', entitlement_id)
      .single();

    console.log('         - Query:', `SELECT * FROM subscriptions WHERE app_user_id='${app_user_id}' AND entitlement_id='${entitlement_id}'`);
    console.log('         - Existing subscription found:', !!existingSubscription);
    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 is "not found" which is expected
      console.log('         - Select error:', selectError.message);
    }

    if (existingSubscription) {
      console.log('         📊 Existing subscription details:');
      console.log('            - ID:', existingSubscription.id);
      console.log('            - Is Active:', existingSubscription.is_active);
      console.log('            - Will Renew:', existingSubscription.will_renew);
      console.log('            - Expires At:', existingSubscription.expires_at);
      console.log('            - Last Event:', existingSubscription.last_event_type, 'at', existingSubscription.last_event_at);
    }

    const now = new Date();
    const purchasedAt = purchased_at_ms ? new Date(purchased_at_ms) : null;
    const expiresAt = expiration_at_ms ? new Date(expiration_at_ms) : null;

    console.log('\n         🎮 EVENT TYPE ANALYSIS:');
    console.log('         - Event Type:', type);
    console.log('         - Current Time:', now.toISOString());
    console.log('         - Purchased At:', purchasedAt?.toISOString() || 'null');
    console.log('         - Expires At:', expiresAt?.toISOString() || 'null');

    // Determine subscription status based on event type
    let isActive = false;
    let willRenew = null;
    let cancelledAt = null;

    console.log('         📈 STATUS CALCULATION:');

    switch (type) {
      case 'INITIAL_PURCHASE':
        console.log('         - INITIAL_PURCHASE: New subscription purchase');
        isActive = expiresAt ? expiresAt > now : true;
        willRenew = true;
        cancelledAt = null;
        break;

      case 'RENEWAL':
        console.log('         - RENEWAL: Subscription renewed');
        isActive = expiresAt ? expiresAt > now : true;
        willRenew = true;
        cancelledAt = null;
        break;

      case 'UNCANCELLATION':
        console.log('         - UNCANCELLATION: Subscription reactivated');
        isActive = expiresAt ? expiresAt > now : true;
        willRenew = true;
        cancelledAt = null;
        break;

      case 'CANCELLATION':
        console.log('         - CANCELLATION: User cancelled subscription');
        isActive = expiresAt ? expiresAt > now : false;
        willRenew = false;
        cancelledAt = now;
        console.log('         - Note: Subscription may still be active until expiration');
        break;

      case 'EXPIRATION':
        console.log('         - EXPIRATION: Subscription expired');
        isActive = false;
        willRenew = false;
        break;

      case 'BILLING_ISSUE':
        console.log('         - BILLING_ISSUE: Payment/billing problem');
        const graceExpiry = grace_period_expiration_at_ms ? new Date(grace_period_expiration_at_ms) : null;
        isActive = graceExpiry ? graceExpiry > now : false;
        willRenew = true; // Still attempting to renew
        console.log('         - Grace Period Expiry:', graceExpiry?.toISOString() || 'none');
        console.log('         - In Grace Period:', isActive);
        break;

      case 'SUBSCRIPTION_PAUSED':
        console.log('         - SUBSCRIPTION_PAUSED: Subscription paused');
        isActive = false;
        willRenew = true; // Will resume later
        break;

      default:
        console.log('         - UNKNOWN EVENT TYPE: Using expiration-based logic');
        isActive = expiresAt ? expiresAt > now : false;
        willRenew = isActive;
    }

    console.log('         📊 CALCULATED STATUS:');
    console.log('            - Is Active:', isActive);
    console.log('            - Will Renew:', willRenew);
    console.log('            - Cancelled At:', cancelledAt?.toISOString() || 'null');

    const subscriptionData = {
      app_user_id, // UUID foreign key to auth.users.id
      entitlement_id,
      product_id,
      store: store.toLowerCase(),
      is_active: isActive,
      will_renew: willRenew,
      period_type: period_type?.toLowerCase() || null,
      original_purchase_at: purchasedAt,
      latest_purchase_at: (type === 'INITIAL_PURCHASE' || type === 'RENEWAL') ? purchasedAt : undefined,
      expires_at: expiresAt,
      cancelled_at: cancelledAt,
      rc_subscriber_id: app_user_id,
      rc_event_id: event_id,
      last_event_type: type,
      last_event_at: new Date(event_timestamp_ms),
      raw_event: event,
      updated_at: now
    };

    console.log('\n         💾 DATABASE OPERATION:');
    console.log('         - Data to save:', JSON.stringify(subscriptionData, null, 2));

    if (existingSubscription) {
      console.log('         📝 UPDATING existing subscription...');
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update(subscriptionData)
        .eq('id', existingSubscription.id);

      if (updateError) {
        console.log('         ❌ UPDATE FAILED:', updateError.message);
        throw updateError;
      }
      console.log('         ✅ UPDATE SUCCESSFUL');
    } else {
      console.log('         ➕ INSERTING new subscription...');
      const { error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          ...subscriptionData,
          created_at: now
        });

      if (insertError) {
        console.log('         ❌ INSERT FAILED:', insertError.message);
        throw insertError;
      }
      console.log('         ✅ INSERT SUCCESSFUL');
    }

    console.log(`         🎉 Successfully processed ${type} event for user ${app_user_id}, entitlement ${entitlement_id}`);

    // Update user's premium status in public.users table
    console.log('\n         👤 UPDATING USER PREMIUM STATUS...');
    await updateUserPremiumStatus(app_user_id);

  } catch (error) {
    console.log('         💥 SUBSCRIPTION PROCESSING ERROR:');
    console.log('            - Error Type:', error.constructor.name);
    console.log('            - Error Message:', error.message);
    console.log('            - Error Code:', error.code);
    if (error.details) console.log('            - Error Details:', error.details);
    if (error.hint) console.log('            - Error Hint:', error.hint);
    throw error;
  }
}

async function updateUserPremiumStatus(appUserId) {
  console.log('            🔍 Finding user by app_user_id:', appUserId);

  try {
    // Get all active subscriptions for this user
    const { data: activeSubscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('app_user_id', appUserId)
      .eq('is_active', true)
      .order('expires_at', { ascending: false });

    console.log('            - Active subscriptions query result:');
    console.log('              - Error:', subsError ? subsError.message : 'null');
    console.log('              - Count:', activeSubscriptions ? activeSubscriptions.length : 0);

    if (subsError) {
      throw subsError;
    }

    // Calculate premium status
    const hasActiveSubscription = activeSubscriptions && activeSubscriptions.length > 0;
    let premiumExpiresAt = null;
    let premiumWillRenew = null;

    if (hasActiveSubscription) {
      const latestSubscription = activeSubscriptions[0];
      premiumExpiresAt = latestSubscription.expires_at;
      premiumWillRenew = latestSubscription.will_renew;
    }

    console.log('            📊 Calculated premium status:');
    console.log('              - is_premium:', hasActiveSubscription);
    console.log('              - premium_expires_at:', premiumExpiresAt);
    console.log('              - premium_will_renew:', premiumWillRenew);

    // Update the user in public.users table
    console.log('            💾 Updating users table...');
    const { data: updateResult, error: userUpdateError } = await supabase
      .from('users')
      .update({
        is_premium: hasActiveSubscription,
        premium_expires_at: premiumExpiresAt,
        premium_will_renew: premiumWillRenew,
        updated_at: new Date()
      })
      .eq('app_user_id', appUserId)
      .select();

    console.log('            - Update result:');
    console.log('              - Updated rows:', updateResult ? updateResult.length : 0);
    console.log('              - Error:', userUpdateError ? userUpdateError.message : 'null');

    if (userUpdateError) {
      console.log('            🚫 USER UPDATE FAILED:');
      console.log('               - User may not exist in public.users table');
      console.log('               - This is expected if user signed up but no public.users record was created');
      console.log('               - Premium status will be updated when user record exists');
    } else if (updateResult && updateResult.length > 0) {
      console.log('            ✅ USER PREMIUM STATUS UPDATED SUCCESSFULLY');
    } else {
      console.log('            ⚠️  NO USER RECORD FOUND TO UPDATE');
      console.log('               - User exists in auth.users but not in public.users');
      console.log('               - Ensure your signup process creates public.users records');
    }

  } catch (error) {
    console.log('            💥 USER PREMIUM STATUS UPDATE ERROR:');
    console.log('               - Error:', error.message);
    // Don't throw - this shouldn't break the webhook processing
  }
}


// RevenueCat webhook endpoint
app.post('/api/webhooks/revenuecat', async (req, res) => {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log('🔗 REVENUECAT WEBHOOK RECEIVED');
  console.log('='.repeat(80));
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📡 From:', req.headers.origin || req.headers.host || 'unknown origin');
  console.log('🌐 Method:', req.method);
  console.log('📄 Content-Type:', req.headers['content-type']);
  console.log('📏 Content-Length:', req.headers['content-length'] || 'unknown');

  try {
    // Parse the webhook payload
    const webhook = req.body;
    console.log('\n📦 RAW WEBHOOK PAYLOAD:');
    console.log(JSON.stringify(webhook, null, 2));

    const { event } = webhook;
    console.log('\n🎯 EVENT ANALYSIS:');
    console.log('- Event Type:', event.type);
    console.log('- Event ID:', event.id);
    console.log('- App ID:', event.app_id);
    console.log('- App User ID:', event.app_user_id);
    console.log('- Original App User ID:', event.original_app_user_id);
    console.log('- Store:', event.store);
    console.log('- Environment:', event.environment);
    console.log('- Event Timestamp:', event.event_timestamp_ms, `(ISO: ${new Date(event.event_timestamp_ms).toISOString()})`);

    // Product and entitlement details
    if (event.product_id) console.log('- Product ID:', event.product_id);
    if (event.entitlement_ids) console.log('- Entitlement IDs:', JSON.stringify(event.entitlement_ids));
    if (event.entitlement_id) console.log('- Entitlement ID (deprecated):', event.entitlement_id);

    // Transaction details
    if (event.transaction_id) console.log('- Transaction ID:', event.transaction_id);
    if (event.original_transaction_id) console.log('- Original Transaction ID:', event.original_transaction_id);

    // Subscription details
    if (event.period_type) console.log('- Period Type:', event.period_type);
    if (event.purchased_at_ms) console.log('- Purchased At:', new Date(event.purchased_at_ms).toISOString());
    if (event.expires_at_ms) console.log('- Expires At:', event.expires_at_ms ? new Date(event.expires_at_ms).toISOString() : 'null');
    if (event.cancelled_at_ms) console.log('- Cancelled At:', event.cancelled_at_ms ? new Date(event.cancelled_at_ms).toISOString() : 'null');

    // Validate required fields FIRST
    if (!event || !event.app_user_id) {
      console.log('\n❌ VALIDATION FAILED:');
      console.log('- Missing event:', !event);
      console.log('- Missing app_user_id:', !event?.app_user_id);
      return res.status(400).json({
        error: 'Invalid payload',
        message: 'Missing event or app_user_id'
      });
    }

    console.log('\n🔍 USER TYPE ANALYSIS:');
    const isAnonymous = event.app_user_id.startsWith('$RCAnonymousID:');
    console.log('- User ID:', event.app_user_id);
    console.log('- Is Anonymous:', isAnonymous);
    console.log('- Starts with $RCAnonymousID:', event.app_user_id.startsWith('$RCAnonymousID:'));
    console.log('- UUID Compatible:', !isAnonymous, `(UUIDs cannot contain colons or $ symbols)`);

    if (isAnonymous) {
      console.log('- 🚫 CANNOT STORE: Anonymous IDs are TEXT strings, not UUIDs');
      console.log('- 📋 WOULD NEED: Schema change to allow TEXT in app_user_id column');
    }

    console.log('\n✅ VALIDATION PASSED: Required fields present');

    // Handle different event types
    console.log('\n🎬 EVENT TYPE HANDLING:');
    console.log('- Event Type:', event.type);

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'CANCELLATION':
      case 'UNCANCELLATION':
      case 'EXPIRATION':
      case 'BILLING_ISSUE':
      case 'SUBSCRIPTION_PAUSED':
      case 'PRODUCT_CHANGE':
        console.log('- Action: Processing as subscription event');
        await handleSubscriptionEvent(event);
        break;

      case 'TEST':
        console.log('- Action: Test webhook - no processing needed');
        console.log('📋 TEST WEBHOOK RECEIVED: This confirms RevenueCat can reach your server');
        break;

      default:
        console.log('- Action: Unhandled event type - skipping');
        console.log('⚠️  UNKNOWN EVENT TYPE: RevenueCat sent an event type not handled by this server');
        console.log('   - Consider adding support for this event type if needed');
        console.log('   - Event still processed successfully (just not stored)');
    }

    const processingTime = Date.now() - startTime;
    console.log('\n🎯 WEBHOOK PROCESSING COMPLETE');
    console.log('='.repeat(80));
    console.log('⏱️  Processing Time:', `${processingTime}ms`);
    console.log('📊 Final Status: SUCCESS');
    console.log('🔄 Response: Sending success confirmation to RevenueCat');

    const response = {
      success: true,
      message: `Processed ${event.type} event`,
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString()
    };

    console.log('📤 Response Payload:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.log('\n💥 WEBHOOK PROCESSING FAILED');
    console.log('='.repeat(80));
    console.log('⏱️  Processing Time:', `${processingTime}ms`);
    console.log('📊 Final Status: ERROR');

    console.log('\n🚨 ERROR ANALYSIS:');
    console.log('- Error Type:', error.constructor.name);
    console.log('- Error Message:', error.message);
    console.log('- Error Code:', error.code || 'unknown');
    if (error.details) console.log('- Error Details:', error.details);
    if (error.hint) console.log('- Error Hint:', error.hint);
    console.log('- Stack Trace:', error.stack);

    console.log('\n🔄 ERROR RESPONSE: Sending error details to RevenueCat');
    const errorResponse = {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString()
    };

    console.log('📤 Error Response Payload:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/webhooks/revenuecat`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
