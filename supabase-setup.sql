-- ============================================
-- KICKBASE POKAL — Supabase Setup v2
-- ============================================
-- Führe dieses SQL im Supabase SQL Editor aus:
-- Dashboard > SQL Editor > New query > Einfügen > Run
--
-- Dieses Schema ist abwärtskompatibel. Wer schon ein Setup hat, kann
-- es trotzdem ausführen — alle Statements sind idempotent.

-- ============================================
-- 1. TURNIER-TABELLE (unterstützt mehrere Pokale)
-- ============================================
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tournaments_select" ON tournaments;
CREATE POLICY "tournaments_select" ON tournaments
  FOR SELECT USING (true);

-- Realtime
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tournaments';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
  END IF;
END $$;

INSERT INTO tournaments (id, data)
VALUES (
  'default',
  '{"players":[],"rounds":[],"currentRound":0,"status":"setup","cupName":"Kickbase Pokal","config":{"tiebreakMode":"marketValue","useSeeding":false,"deadlineRequired":false},"archive":[],"titleHolder":null}'
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. AUTH-TABELLE — Admin & Teilnehmer-Passwort
-- ============================================
CREATE TABLE IF NOT EXISTS tournament_auth (
  tournament_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  participant_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tournament_auth ADD COLUMN IF NOT EXISTS participant_hash TEXT;
ALTER TABLE tournament_auth ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. RPC-FUNKTIONEN
-- ============================================

CREATE OR REPLACE FUNCTION has_password(p_tournament_id TEXT DEFAULT 'default')
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER
AS $$
  SELECT EXISTS (SELECT 1 FROM tournament_auth WHERE tournament_id = 'default');
$$;

-- Gibt Rolle zurück: 'admin', 'participant' oder '' (ungültig)
CREATE OR REPLACE FUNCTION verify_password(
  p_tournament_id TEXT DEFAULT 'default',
  p_hash TEXT DEFAULT ''
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE auth_row tournament_auth%ROWTYPE;
BEGIN
  SELECT * INTO auth_row FROM tournament_auth WHERE tournament_id = 'default';
  IF NOT FOUND THEN RETURN ''; END IF;
  IF auth_row.password_hash = p_hash THEN RETURN 'admin'; END IF;
  IF auth_row.participant_hash IS NOT NULL AND auth_row.participant_hash = p_hash THEN RETURN 'participant'; END IF;
  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION set_password(
  p_tournament_id TEXT DEFAULT 'default',
  p_hash TEXT DEFAULT ''
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tournament_auth WHERE tournament_id = 'default') THEN
    RETURN FALSE;
  END IF;
  INSERT INTO tournament_auth (tournament_id, password_hash) VALUES ('default', p_hash);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION change_password(
  p_tournament_id TEXT DEFAULT 'default',
  p_old_hash TEXT DEFAULT '',
  p_new_hash TEXT DEFAULT ''
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tournament_auth
    WHERE tournament_id = 'default' AND password_hash = p_old_hash
  ) THEN
    RETURN FALSE;
  END IF;
  UPDATE tournament_auth SET password_hash = p_new_hash WHERE tournament_id = 'default';
  RETURN TRUE;
END;
$$;

-- Teilnehmer-Passwort setzen/ändern (nur mit Admin-Passwort)
CREATE OR REPLACE FUNCTION set_participant_password(
  p_admin_hash TEXT DEFAULT '',
  p_participant_hash TEXT DEFAULT ''
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tournament_auth
    WHERE tournament_id = 'default' AND password_hash = p_admin_hash
  ) THEN
    RETURN FALSE;
  END IF;
  UPDATE tournament_auth SET participant_hash = NULLIF(p_participant_hash, '') WHERE tournament_id = 'default';
  RETURN TRUE;
END;
$$;

-- Turnier speichern — Admin darf alles, Teilnehmer nur Scores/Kommentare/Predictions
CREATE OR REPLACE FUNCTION save_tournament(
  p_tournament_id TEXT DEFAULT 'default',
  p_hash TEXT DEFAULT '',
  p_data JSONB DEFAULT '{}'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE role TEXT;
BEGIN
  role := verify_password('default', p_hash);
  IF role = '' THEN RETURN FALSE; END IF;

  INSERT INTO tournaments (id, data, updated_at)
  VALUES (p_tournament_id, p_data, NOW())
  ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();

  RETURN TRUE;
END;
$$;

-- Neues Turnier anlegen (nur Admin)
CREATE OR REPLACE FUNCTION create_tournament(
  p_tournament_id TEXT DEFAULT '',
  p_hash TEXT DEFAULT '',
  p_data JSONB DEFAULT '{}'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tournament_auth
    WHERE tournament_id = 'default' AND password_hash = p_hash
  ) THEN
    RETURN FALSE;
  END IF;
  IF p_tournament_id IS NULL OR p_tournament_id = '' THEN RETURN FALSE; END IF;

  INSERT INTO tournaments (id, data)
  VALUES (p_tournament_id, p_data)
  ON CONFLICT (id) DO NOTHING;

  RETURN TRUE;
END;
$$;

-- Turnier löschen (nur Admin, niemals 'default')
CREATE OR REPLACE FUNCTION delete_tournament(
  p_tournament_id TEXT DEFAULT '',
  p_hash TEXT DEFAULT ''
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF p_tournament_id = 'default' OR p_tournament_id IS NULL OR p_tournament_id = '' THEN RETURN FALSE; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tournament_auth
    WHERE tournament_id = 'default' AND password_hash = p_hash
  ) THEN
    RETURN FALSE;
  END IF;
  DELETE FROM tournaments WHERE id = p_tournament_id;
  RETURN TRUE;
END;
$$;

-- ============================================
-- 4. PUSH-SUBSCRIPTION TABELLE (für Notifications)
-- ============================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  player_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_insert" ON push_subscriptions;
CREATE POLICY "push_insert" ON push_subscriptions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "push_select" ON push_subscriptions;
CREATE POLICY "push_select" ON push_subscriptions FOR SELECT USING (true);

-- ============================================
-- FERTIG! 🏆
-- ============================================
-- Sicherheitsmodell:
-- ✓ Turnierdaten lesen: offen (Realtime nötig)
-- ✓ Turnierdaten schreiben: Admin = alles, Teilnehmer = save_tournament erlaubt
--   (serverseitig vertrauen wir dem Client bzgl. Scope — Client soll nur seine Scores ändern)
-- ✓ Neue Turniere erstellen: nur Admin
-- ✓ Passwort-Hashes bleiben serverseitig
