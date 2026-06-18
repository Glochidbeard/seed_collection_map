-- Run this once in the Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- This creates the polygons table with team-sharing and row-level security.

CREATE TABLE IF NOT EXISTS polygons (
  id           UUID         PRIMARY KEY,
  name         TEXT         NOT NULL DEFAULT 'Unnamed Area',
  plant_layer  TEXT,
  color        TEXT,
  geojson      JSONB        NOT NULL,
  attributes   JSONB        DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  created_by   UUID         REFERENCES auth.users(id)
);

-- Enable Row Level Security
ALTER TABLE polygons ENABLE ROW LEVEL SECURITY;

-- All authenticated users (team members) can read, write, update, and delete any polygon.
-- This means Daniel and Nathan each see each other's data — they share a team pool.
CREATE POLICY "Team members have full access"
  ON polygons FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Indexes for sync performance
CREATE INDEX IF NOT EXISTS polygons_updated_at  ON polygons (updated_at);
CREATE INDEX IF NOT EXISTS polygons_deleted_at  ON polygons (deleted_at);
CREATE INDEX IF NOT EXISTS polygons_plant_layer ON polygons (plant_layer);
