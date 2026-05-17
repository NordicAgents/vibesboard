-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Roles
-- vibesboard_migrate owns the schema, bypasses RLS, runs migrations only
CREATE ROLE vibesboard_migrate WITH LOGIN PASSWORD 'vibesboard_migrate' BYPASSRLS;
-- vibesboard_app is the application connection, subject to RLS
CREATE ROLE vibesboard_app WITH LOGIN PASSWORD 'vibesboard_app';

-- Grants
GRANT ALL ON SCHEMA public TO vibesboard_migrate;
GRANT USAGE ON SCHEMA public TO vibesboard_app;

-- Default privileges so newly-created tables and sequences (made by the migrate
-- role) are automatically accessible by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE vibesboard_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vibesboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vibesboard_migrate IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO vibesboard_app;
