import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const { data, error } = await supabase.from('projects').select('*').limit(1);
console.log(JSON.stringify(data?.[0] || {error: error?.message}));
