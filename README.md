# 🏆 Kickbase Pokal

Ligaübergreifender Kickbase-Pokal mit Auslosung, Punktevergleich, Turnierbaum und Live-Synchronisation.

---

## Features

- **Shared / Live**: Alle sehen den gleichen Stand — Punkte eintragen, Ergebnisse ansehen, alles synchron
- **Frische Auslosung jede Runde** — kein fester Turnierbaum, genau wie der DFB-Pokal
- **Grafischer Turnierbaum** — Gewinner grün, Verlierer ausgegraut + durchgestrichen
- **Selbst Punkte eintragen** — jeder Teilnehmer kann seine Kickbase-Punkte eingeben
- **Mobilfreundlich** — funktioniert perfekt auf dem Handy
- **Kostenlos** — Supabase Free Tier + Netlify Free Tier

---

## Setup-Anleitung (Schritt für Schritt)

### Schritt 1: Supabase einrichten (Datenbank — 5 Min.)

1. Gehe zu **[supabase.com](https://supabase.com)** und erstelle einen kostenlosen Account
2. Klick **"New Project"**
   - Name: `kickbase-pokal`
   - Passwort: irgendwas (aufschreiben!)
   - Region: `West EU (Frankfurt)` empfohlen
   - Klick **"Create new project"** und warte ~2 Minuten
3. Gehe zu **SQL Editor** (links in der Sidebar)
4. Klick **"New query"**
5. Kopiere den **gesamten Inhalt** der Datei `supabase-setup.sql` rein
6. Klick **"Run"** — du solltest "Success" sehen
7. Gehe zu **Settings > API** (links unten)
8. Kopiere dir diese zwei Werte:
   - **Project URL** (z.B. `https://abc123.supabase.co`)
   - **anon / public Key** (der lange String)

### Schritt 2: Code auf GitHub hochladen (3 Min.)

1. Erstelle einen Account auf **[github.com](https://github.com)** (falls noch nicht vorhanden)
2. Klick oben rechts **"+"** → **"New repository"**
   - Name: `kickbase-pokal`
   - **Public** lassen
   - Klick **"Create repository"**
3. Lade alle Dateien aus diesem Ordner ins Repository hoch:
   - Entweder per **"Upload files"** auf GitHub (einfachste Methode)
   - Oder per Git auf der Kommandozeile:
     ```bash
     cd kickbase-pokal
     git init
     git add .
     git commit -m "Initial commit"
     git branch -M main
     git remote add origin https://github.com/DEIN-USERNAME/kickbase-pokal.git
     git push -u origin main
     ```

**Wichtig**: Die `.env` Datei NICHT hochladen! (enthält deine Supabase-Keys)

### Schritt 3: Auf Netlify deployen (3 Min.)

1. Gehe zu **[netlify.com](https://www.netlify.com)** und erstelle einen Account (am besten mit GitHub anmelden)
2. Klick **"Add new site"** → **"Import an existing project"**
3. Wähle **GitHub** und dann dein `kickbase-pokal` Repository
4. Build-Einstellungen werden automatisch erkannt:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. **Bevor du deployst**: Klick auf **"Advanced"** → **"New variable"** und füge hinzu:
   - `VITE_SUPABASE_URL` → deine Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` → dein Supabase Anon Key
6. Klick **"Deploy site"**
7. Nach ~1 Minute bekommst du eine URL wie `kickbase-pokal-abc123.netlify.app`

### Schritt 4: Link teilen! 🎉

Poste den Netlify-Link in deinem Discord-Server. Fertig!

Optional: Unter **Site settings > Domain management** kannst du einen eigenen Namen vergeben,
z.B. `kickbase-pokal.netlify.app`

---

## Lokal entwickeln / testen

```bash
# 1. Dependencies installieren
npm install

# 2. .env Datei erstellen (Supabase-Werte eintragen)
cp .env.example .env
# → .env öffnen und die Werte von Supabase eintragen

# 3. Starten
npm run dev

# → Öffne http://localhost:5173
```

---

## Projektstruktur

```
kickbase-pokal/
├── index.html            ← HTML-Einstiegspunkt
├── package.json          ← Dependencies
├── vite.config.js        ← Build-Tool Konfiguration
├── netlify.toml          ← Netlify Deploy-Konfiguration
├── supabase-setup.sql    ← SQL zum Einrichten der Datenbank
├── .env.example          ← Vorlage für Umgebungsvariablen
└── src/
    ├── main.jsx          ← App-Einstiegspunkt
    ├── App.jsx           ← Hauptanwendung (UI + Logik)
    └── supabase.js       ← Supabase-Client
```

---

## FAQ

**Ist die Seite passwortgeschützt?**
Ja! Beim ersten Aufruf legst du ein Passwort fest. Dieses teilst du im Discord.
Ohne Passwort sieht und ändert niemand etwas. Das Passwort wird als SHA-256-Hash
serverseitig gespeichert — niemals im Klartext. Schreib-Operationen werden über
Supabase RPC-Funktionen abgesichert, die den Passwort-Hash validieren.

**Kann jeder Punkte eintragen?**
Ja — jeder der das Passwort hat, kann Punkte eintragen und Änderungen vornehmen.
Das Passwort kann unter Einstellungen geändert werden (altes Passwort nötig).

**Was kostet das?**
Nichts. Sowohl Supabase als auch Netlify haben großzügige kostenlose Stufen,
die für einen Kickbase-Pokal mehr als ausreichen.

**Wie viele Teilnehmer gehen?**
Technisch unbegrenzt. Praktisch sinnvoll: bis ca. 64 Teilnehmer.

**Was passiert bei Gleichstand?**
Aktuell wird ein Unentschieden nicht automatisch aufgelöst.
Ihr könnt euch im Discord auf eine Regel einigen (z.B. höherer Marktwert gewinnt)
und die Punkte entsprechend anpassen.
