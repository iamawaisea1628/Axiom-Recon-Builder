import { createClient } from '@supabase/supabase-js';

const url = process.env.REACT_APP_SUPABASE_URL;
const publishableKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

// Reported by index.js as a readable screen instead of a blank page.
export const configError = !url || !publishableKey
  ? 'Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_PUBLISHABLE_KEY. Add them in Vercel → Settings → Environment Variables (or .env.local for local development) and redeploy.'
  : null;

export const supabase = configError
  ? null
  : createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
