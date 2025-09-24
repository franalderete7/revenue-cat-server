# RevenueCat Server

A Node.js Express server for handling RevenueCat webhooks and managing subscription data with Supabase.

## Features

- RevenueCat webhook processing for subscription events
- Supabase integration for storing subscription and user data
- Automatic premium status management
- Support for all major subscription event types (INITIAL_PURCHASE, RENEWAL, CANCELLATION, etc.)

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

### subscriptions table
```sql
- id (uuid, primary key)
- app_user_id (text)
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
```

### users table
```sql
- app_user_id (text, primary key)
- is_premium (boolean)
- premium_expires_at (timestamp)
- premium_will_renew (boolean)
- updated_at (timestamp)
```

## Scripts

- `npm start` - Start the server with Node.js
- `npm run dev` - Start the server with nodemon for development
- `npm test` - Run tests (not implemented yet)

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
