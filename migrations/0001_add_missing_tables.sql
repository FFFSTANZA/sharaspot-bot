-- Add missing columns to station_owners table
ALTER TABLE station_owners 
ADD COLUMN phone_number VARCHAR,
ADD COLUMN email VARCHAR,
ADD COLUMN business_name VARCHAR,
ADD COLUMN business_type VARCHAR,
ADD COLUMN is_verified BOOLEAN DEFAULT false,
ADD COLUMN verification_documents JSONB DEFAULT '[]'::jsonb;

-- Verify the changes
\d station_owners;