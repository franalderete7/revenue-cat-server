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

  // Use entitlement_ids if available, fallback to deprecated entitlement_id
  const entitlements = entitlement_ids || (entitlement_id ? [entitlement_id] : []);

  if (!product_id || entitlements.length === 0) {
    console.log('Skipping event - missing product_id or entitlements:', type);
    return;
  }

  // Process each entitlement
  for (const entitlementId of entitlements) {
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
    const { data: existingSubscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('app_user_id', app_user_id)
      .eq('entitlement_id', entitlement_id)
      .single();

    const now = new Date();
    const purchasedAt = purchased_at_ms ? new Date(purchased_at_ms) : null;
    const expiresAt = expiration_at_ms ? new Date(expiration_at_ms) : null;

    // Determine subscription status based on event type
    let isActive = false;
    let willRenew = null;
    let cancelledAt = null;

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
        isActive = expiresAt ? expiresAt > now : true;
        willRenew = true;
        cancelledAt = null;
        break;

      case 'CANCELLATION':
        // User cancelled but subscription may still be active until expiration
        isActive = expiresAt ? expiresAt > now : false;
        willRenew = false;
        cancelledAt = now;
        break;

      case 'EXPIRATION':
        isActive = false;
        willRenew = false;
        break;

      case 'BILLING_ISSUE':
        // Check if in grace period
        const graceExpiry = grace_period_expiration_at_ms ? new Date(grace_period_expiration_at_ms) : null;
        isActive = graceExpiry ? graceExpiry > now : false;
        willRenew = true; // Still attempting to renew
        break;

      case 'SUBSCRIPTION_PAUSED':
        isActive = false;
        willRenew = true; // Will resume later
        break;

      default:
        // For other event types, determine based on expiration
        isActive = expiresAt ? expiresAt > now : false;
        willRenew = isActive;
    }

    const subscriptionData = {
      app_user_id,
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

    if (existingSubscription) {
      // Update existing subscription
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update(subscriptionData)
        .eq('id', existingSubscription.id);

      if (updateError) {
        throw updateError;
      }
    } else {
      // Create new subscription record
      const { error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          ...subscriptionData,
          created_at: now
        });

      if (insertError) {
        throw insertError;
      }
    }

    // Update user's premium status
    await updateUserPremiumStatus(app_user_id);

    console.log(`Successfully processed ${type} event for user ${app_user_id}, entitlement ${entitlement_id}`);

  } catch (error) {
    console.error(`Error processing subscription for user ${app_user_id}:`, error);
    throw error;
  }
}

async function updateUserPremiumStatus(app_user_id) {
  try {
    // Get all active subscriptions for the user
    const { data: activeSubscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('app_user_id', app_user_id)
      .eq('is_active', true)
      .order('expires_at', { ascending: false });

    if (subsError) {
      throw subsError;
    }

    // Determine premium status
    const hasActiveSubscription = activeSubscriptions && activeSubscriptions.length > 0;
    let premiumExpiresAt = null;
    let premiumWillRenew = null;

    if (hasActiveSubscription) {
      // Get the subscription with the latest expiration date
      const latestSubscription = activeSubscriptions[0];
      premiumExpiresAt = latestSubscription.expires_at ? new Date(latestSubscription.expires_at) : null;
      premiumWillRenew = latestSubscription.will_renew;
    }

    // Update user record
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({
        is_premium: hasActiveSubscription,
        premium_expires_at: premiumExpiresAt,
        premium_will_renew: premiumWillRenew,
        updated_at: new Date()
      })
      .eq('app_user_id', app_user_id);

    if (userUpdateError) {
      // If user doesn't exist in users table, log a warning but don't throw
      console.warn(`Could not update user premium status for ${app_user_id}:`, userUpdateError);
    }

  } catch (error) {
    console.error(`Error updating user premium status for ${app_user_id}:`, error);
    throw error;
  }
}

// RevenueCat webhook endpoint
app.post('/api/webhooks/revenuecat', async (req, res) => {
  console.log('Webhook received from:', req.headers.origin || req.headers.host || 'unknown origin');
  try {
    // Parse the webhook payload
    const webhook = req.body;
    const { event } = webhook;

    console.log(`Received RevenueCat webhook: ${event.type} for user ${event.app_user_id}`);

    // Handle different event types
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'CANCELLATION':
      case 'UNCANCELLATION':
      case 'EXPIRATION':
      case 'BILLING_ISSUE':
      case 'SUBSCRIPTION_PAUSED':
      case 'PRODUCT_CHANGE':
        await handleSubscriptionEvent(event);
        break;

      case 'TEST':
        console.log('Received test webhook from RevenueCat');
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({
      success: true,
      message: `Processed ${event.type} event`
    });

  } catch (error) {
    console.error('Error processing RevenueCat webhook:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/webhooks/revenuecat`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
