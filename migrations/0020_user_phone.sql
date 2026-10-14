-- Mobile numbers are collected from people who register from now on. `phone` is stored in E.164 (+919876543210).
-- `phone_required` is true only for accounts created after this migration, so everyone who signed up
-- earlier is never interrupted by the "add your mobile number" step; they can still add one voluntarily.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_required BOOLEAN NOT NULL DEFAULT false;
