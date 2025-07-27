import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export type MarketPrice = {
  id: string;
  hsn_code: string;
  product_name: string;
  country_code: string;
  country_name: string;
  price: number;
  currency: string;
  date: string;
  source: string;
  created_at: string;
};