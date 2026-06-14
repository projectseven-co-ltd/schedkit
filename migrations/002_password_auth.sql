-- Password login for mobile + unified Project Seven auth

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
