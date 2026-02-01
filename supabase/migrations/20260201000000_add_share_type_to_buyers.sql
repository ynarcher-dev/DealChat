ALTER TABLE buyers ADD COLUMN IF NOT EXISTS share_type text DEFAULT 'public';
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS share_files jsonb DEFAULT '[]'::jsonb;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS share_with jsonb DEFAULT '[]'::jsonb;
