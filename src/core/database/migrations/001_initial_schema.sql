-- UP
-- Initial schema migration
-- This migration creates the base schema for FSP's Study Tools

-- Note: The main schema is already applied via schema.sql
-- This migration serves as a placeholder for tracking initial schema version

-- Verify that core tables exist
SELECT 1 FROM knowledge_bases LIMIT 1;
SELECT 1 FROM study_progress LIMIT 1;
SELECT 1 FROM practice_tests LIMIT 1;
SELECT 1 FROM test_results LIMIT 1;
SELECT 1 FROM conversations LIMIT 1;
SELECT 1 FROM content_fts LIMIT 1;
SELECT 1 FROM settings LIMIT 1;

-- DOWN
-- Cannot rollback initial schema
-- This would require dropping all tables and data
