-- ============================================
-- KICKBASE POKAL — Supabase Setup
-- ============================================
-- Führe dieses SQL im Supabase SQL Editor aus:
-- Dashboard > SQL Editor > New query > Einfügen > Run

-- ============================================
-- 1. TURNIER-TABELLE
-- ============================================
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

-- Lesen: offen (nötig für Realtime)
CREATE POLICY "tournaments_select" ON tournaments
  FOR SELECT USING (true);

-- Schreiben: nur über RPC-Funktionen (siehe unten)
-- Kein direktes INSERT/UPDATE für anon-User!

-- Realtime aktivieren
ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;

-- Initialen Datensatz
INSERT INTO tournaments (id, data)
VALUES (
  'default',
  '{"players":[],"rounds":[],"currentRound":0,"status":"setup","cupName":"Kickbase Pokal"}'
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. PASSWORT-TABELLE (nicht von außen lesbar!)
-- ============================================
CREATE TABLE IF NOT EXISTS tournament_auth (
  tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tournament_auth ENABLE ROW LEVEL SECURITY;
-- Keine Policies = kein direkter Zugriff über anon key
-- Zugriff NUR über SECURITY DEFINER Funktionen

-- ============================================
-- 3. RPC-FUNKTIONEN (serverseitig, sicher)
-- ============================================

-- Prüfe ob ein Passwort gesetzt ist
CREATE OR REPLACE FUNCTION has_password(p_tournament_id TEXT DEFAULT 'default')
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournament_auth WHERE tournament_id = p_tournament_id
  );
$$;

-- Passwort verifizieren (gibt true/false zurück, Hash bleibt serverseitig)
CREATE OR REPLACE FUNCTION verify_password(
  p_tournament_id TEXT DEFAULT 'default',
  p_hash TEXT DEFAULT ''
)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournament_auth
    WHERE tournament_id = p_tournament_id
    AND password_hash = p_hash
  );
$$;

-- Passwort erstmalig setzen (nur wenn noch keins existiert)
CREATE OR REPLACE FUNCTION set_password(
  p_tournament_id TEXT DEFAULT 'default',
  p_hash TEXT DEFAULT ''
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tournament_auth WHERE tournament_id = p_tournament_id) THEN
    RETURN FALSE; -- Passwort existiert bereits
  END IF;
  INSERT INTO tournament_auth (tournament_id, password_hash) VALUES (p_tournament_id, p_hash);
  RETURN TRUE;
END;
$$;

-- Passwort ändern (altes Passwort muss stimmen)
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
    WHERE tournament_id = p_tournament_id AND password_hash = p_old_hash
  ) THEN
    RETURN FALSE;
  END IF;
  UPDATE tournament_auth SET password_hash = p_new_hash WHERE tournament_id = p_tournament_id;
  RETURN TRUE;
END;
$$;

-- Turnierdaten speichern (nur mit gültigem Passwort!)
CREATE OR REPLACE FUNCTION save_tournament(
  p_tournament_id TEXT DEFAULT 'default',
  p_hash TEXT DEFAULT '',
  p_data JSONB DEFAULT '{}'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Passwort prüfen
  IF NOT EXISTS (
    SELECT 1 FROM tournament_auth
    WHERE tournament_id = p_tournament_id AND password_hash = p_hash
  ) THEN
    RETURN FALSE;
  END IF;
  -- Daten speichern
  UPDATE tournaments
  SET data = p_data, updated_at = NOW()
  WHERE id = p_tournament_id;
  RETURN TRUE;
END;
$$;

-- ============================================
-- FERTIG! 🏆
-- ============================================
-- Sicherheitsmodell:
-- ✓ Turnierdaten lesen: offen (für Realtime nötig, aber ohne Passwort nur lesbar)
-- ✓ Turnierdaten schreiben: nur mit Passwort (über save_tournament RPC)
-- ✓ Passwort-Hashes: niemals zum Client gesendet (kein SELECT auf tournament_auth)
-- ✓ Passwort-Verifikation: serverseitig (verify_password RPC)
-- ✓ SHA-256 Hash: Passwort wird nie im Klartext übertragen
