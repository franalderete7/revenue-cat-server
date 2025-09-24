You need to update your Supabase database schema. Run this SQL in your Supabase SQL editor:

-- Change app_user_id from UUID to TEXT in both tables
ALTER TABLE subscriptions ALTER COLUMN app_user_id TYPE TEXT;
ALTER TABLE users ALTER COLUMN app_user_id TYPE TEXT;

-- If users table uses app_user_id as primary key, you might need to recreate the constraint
-- First drop the primary key constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
-- Then add it back as TEXT primary key
ALTER TABLE users ADD PRIMARY KEY (app_user_id);
