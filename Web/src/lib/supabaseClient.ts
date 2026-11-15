import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let currentClientKey: string = '';

export const clearSupabaseClient = () => {
  if (supabaseInstance) {
    try {
      supabaseInstance.removeAllChannels();
    } catch (e) {
      console.warn('Error clearing Supabase channels:', e);
    }
  }
  supabaseInstance = null;
  currentClientKey = '';
};

export const getSupabaseClient = (url?: string, key?: string): SupabaseClient => {
  const supabaseUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = key || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and Key are required to initialize the client.');
  }

  const clientKey = `${supabaseUrl}::${supabaseKey}`;

  // Return existing instance if credentials haven't changed
  if (supabaseInstance && currentClientKey === clientKey) {
    return supabaseInstance;
  }

  // Clean up previous client before creating a new one to prevent channel leaks
  clearSupabaseClient();

  supabaseInstance = createClient(supabaseUrl, supabaseKey);
  currentClientKey = clientKey;
  return supabaseInstance;
};
