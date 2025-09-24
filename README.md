# RevenueCat Server

A Node.js Express server for handling RevenueCat webhooks and managing subscription data with Supabase.

## Features

- RevenueCat webhook processing for subscription events
- Supabase integration for storing subscription and user data
- Support for all major subscription event types (INITIAL_PURCHASE, RENEWAL, CANCELLATION, etc.)
- **Only processes authenticated users** (skips anonymous users since your schema requires UUID app_user_id)
- **Comprehensive logging** - see exactly what RevenueCat sends and how edge cases are handled

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm
- Supabase project with `subscriptions` and `users` tables

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables (optional - defaults are provided):
```bash
export SUPABASE_URL=your_supabase_url
export SUPABASE_SERVICE_KEY=your_service_key
```

3. Start the development server:
```bash
npm run dev
```

4. Or start the production server:
```bash
npm start
```

The server will run on http://localhost:3000 by default.

## API Endpoints

- `GET /` - Welcome message
- `GET /health` - Health check endpoint
- `POST /api/webhooks/revenuecat` - RevenueCat webhook handler

## Supported Event Types

The webhook handler processes the following RevenueCat event types:

- `INITIAL_PURCHASE` - New subscription purchase
- `RENEWAL` - Subscription renewal
- `CANCELLATION` - Subscription cancelled
- `UNCANCELLATION` - Subscription reactivated
- `EXPIRATION` - Subscription expired
- `BILLING_ISSUE` - Payment/billing issue
- `SUBSCRIPTION_PAUSED` - Subscription paused
- `PRODUCT_CHANGE` - Product changed
- `TEST` - Test webhook from RevenueCat

## Database Schema

Your server works with your existing Supabase schema:

### subscriptions table
```sql
- id (uuid, primary key)
- app_user_id (uuid, foreign key to auth.users.id) - Only authenticated users
- entitlement_id (text)
- product_id (text)
- store (text)
- is_active (boolean)
- will_renew (boolean)
- period_type (text)
- original_purchase_at (timestamp)
- latest_purchase_at (timestamp)
- expires_at (timestamp)
- cancelled_at (timestamp)
- rc_subscriber_id (text)
- rc_event_id (text)
- last_event_type (text)
- last_event_at (timestamp)
- raw_event (jsonb)
- created_at (timestamp)
- updated_at (timestamp)
- UNIQUE(app_user_id, entitlement_id)
```

### users table
```sql
- user_id (serial, primary key)
- username (text)
- email (text)
- role (text)
- app_user_id (uuid, foreign key to auth.users.id)
- is_premium (boolean) - Gets updated by webhooks
- premium_expires_at (timestamp) - Gets updated by webhooks
- premium_will_renew (boolean) - Gets updated by webhooks
```

## Anonymous User IDs

**Your current schema does not support anonymous users** because `subscriptions.app_user_id` is a UUID foreign key to `auth.users(id)`.

RevenueCat sends anonymous IDs like `$RCAnonymousID:{random_string}` which are TEXT strings, not UUIDs. Your server **skips all anonymous user webhooks** and only processes users who exist in `auth.users`.

**To handle anonymous users, you would need to modify your schema** to allow TEXT values in `app_user_id` or create a separate table for anonymous subscriptions.

## Premium Status Updates

The server automatically updates these fields in your `users` table based on subscription events:

- `is_premium`: `true` if user has active subscriptions, `false` otherwise
- `premium_expires_at`: Expiration date of the latest active subscription
- `premium_will_renew`: `true` if the latest subscription will auto-renew

### Important: User Records Must Exist

For premium status to update, users **must exist in both**:
1. `auth.users` (automatic with Supabase Auth)
2. `public.users` (your app must create this record)

### Required Signup Code

In your user registration/signup process, add:

```javascript
// After successful Supabase auth signup
const { data: authUser } = await supabase.auth.signUp({
  email,
  password
});

// Create public.users record
await supabase.from('users').insert({
  user_id: authUser.user.id, // SERIAL primary key (let DB auto-generate)
  username: email.split('@')[0],
  email: email,
  role: 'user',
  app_user_id: authUser.user.id, // UUID foreign key to auth.users
  is_premium: false,
  premium_expires_at: null,
  premium_will_renew: null
});
```

### Testing Premium Updates

Run the test script to check your current setup:
```bash
npm run test-premium
```

## Scripts

- `npm start` - Start the server with Node.js
- `npm run dev` - Start the server with nodemon for development
- `npm run test-premium` - Test premium status update functionality

## Project Structure

```
revenuecatserver/
├── index.js          # Main server file with webhook handlers
├── package.json      # Dependencies and scripts
├── .gitignore        # Git ignore rules
└── README.md         # This file
```

## Webhook Configuration

Configure your RevenueCat webhook to send events to:
```
https://your-deployed-domain.com/api/webhooks/revenuecat
```

**Local Development:**
```
http://localhost:3000/api/webhooks/revenuecat
```

Replace `your-deployed-domain.com` with your actual domain when deploying. Make sure to include the appropriate headers and authentication as needed for your deployment.
