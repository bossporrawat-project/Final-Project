import { createClient, SupabaseClient } from '@supabase/supabase-js';

// We can store a singleton instance if needed, or just export a factory
let supabaseInstance: SupabaseClient | null = null;

export const getSupabaseClient = (url?: string, key?: string): SupabaseClient => {
  if (supabaseInstance && !url && !key) return supabaseInstance;

  // Try to use environment variables as fallback if not provided
  const supabaseUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = key || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and Key are required to initialize the client.');
  }

  supabaseInstance = createClient(supabaseUrl, supabaseKey);
  return supabaseInstance;
};

export const clearSupabaseClient = () => {
  supabaseInstance = null;
};
