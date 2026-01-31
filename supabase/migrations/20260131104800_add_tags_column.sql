-- Add tags column to files table
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS tags TEXT;

-- Add tags column to other tables as well
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS tags TEXT;

ALTER TABLE sellers 
ADD COLUMN IF NOT EXISTS tags TEXT;

ALTER TABLE buyers 
ADD COLUMN IF NOT EXISTS tags TEXT;
