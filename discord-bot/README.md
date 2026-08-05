# Kickbase Discord Bot

Standalone Discord-Bot, der Kickbase-Daten on-demand und nach Zeitplan in deine Channels postet.

## Was er kann

**Slash-Commands** (manuell auslösen):

| Command | Beschreibung |
|---|---|
| `/standings [league]` | Saison-Tabelle einer Liga |
| `/matchday [day] [league]` | Punkte eines Spieltags (Default: aktueller Spieltag) |
| `/points <user> [league]` | Saison- und aktuelle Spieltagspunkte eines Managers |
| `/lineup <user> [day] [league]` | Aufstellung mit Einzelpunkten |
| `/help` | Befehlsübersicht |

`<user>` hat Autocomplete — sobald du tippst, werden Liga-Mitglieder gefiltert.

**Scheduled Posts** (automatisch laut `config.json`):

- Cron-basiert (z.B. „Mo 21:00")
- Pro Job: Liga + Discord-Channel + Task (`standings` oder `matchday`)
- Beliebig viele parallele Jobs

## Voraussetzungen

- **Node.js 18+** (lokal oder auf Hosting)
- **Kickbase-Account**, der in allen abzufragenden Ligen Mitglied ist (z.B. ein dedizierter Bot-Account)
- **Discord-Application** mit Bot-User (siehe Setup)
- **24/7-Hosting** für Scheduled Tasks (Optionen siehe unten)

## Setup

### 1. Discord-Application + Bot anlegen

1. Geh zu [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**, Name z.B. „Kickbase Bot"
2. Im Tab **Bot** → **Reset Token** → den **Token** sofort kopieren (wird nur einmal angezeigt)
3. Auf der Übersichtsseite die **Application ID** kopieren
4. Im Tab **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
   - Generated URL kopieren → in einem neuen Tab öffnen → in deinen Discord-Server einladen

### 2. Channel-IDs sammeln

In Discord:
1. **User-Settings → Advanced → Developer Mode** aktivieren
2. Rechtsklick auf jeden Ziel-Channel → **Channel-ID kopieren**
3. IDs (es sind lange Zahlen) für die nächste Schritte bereithalten

### 3. Repo klonen + Dependencies

```bash
cd discord-bot
npm install
```

### 4. `.env` und `config.json` anlegen

```bash
cp .env.example .env
cp config.example.json config.json
```

**`.env` ausfüllen:**

```env
KICKBASE_EMAIL=kb.pokal.bot@gmail.com
KICKBASE_PASSWORD=xxxxx
DISCORD_TOKEN=<aus Schritt 1.2>
CLIENT_ID=<aus Schritt 1.3>
GUILD_ID=<optional: deine Discord-Server-ID — Rechtsklick auf Server-Icon>
```

> **Hinweis zu `GUILD_ID`**: Wenn gesetzt, werden die Slash-Commands sofort nur in diesem einen Server registriert (1 Sekunde). Ohne `GUILD_ID` werden sie global registriert (überall verfügbar, aber Discord-Cache braucht bis zu 1 Stunde).

**`config.json` anpassen** — Liga-IDs (aus Kickbase-URL) und Discord-Channel-IDs eintragen, Schedules nach Wunsch:

```json
{
  "leagues": [
    { "id": "5310801", "name": "Liga A", "channelId": "111…" },
    { "id": "5310802", "name": "Liga B", "channelId": "222…" }
  ],
  "schedules": [
    { "name": "Wochenstand", "cron": "0 21 * * 1", "leagueId": "5310801", "task": "standings" }
  ]
}
```

Cron-Syntax: [crontab.guru](https://crontab.guru) — z.B. `0 21 * * 1` = Montag 21:00.

### 5. Slash-Commands bei Discord registrieren

```bash
npm run deploy-commands
```

Output: `✓ Guild-Commands registriert (sofort verfügbar).` (oder global).

> **Wichtig**: Wenn du später Commands in `commands.js` änderst oder Ligen in `config.json` hinzufügst, musst du **`npm run deploy-commands` erneut ausführen**, sonst sieht Discord die Änderungen nicht.

### 6. Bot starten

```bash
npm start
```

Erwartete Ausgabe:

```
[Bot] 3 Ligen, 2 Schedules in config geladen.
[Bot] ✓ Kickbase-Login erfolgreich
[Bot] ✓ Eingeloggt als KickbaseBot#1234
[Scheduler] ✓ "Wochenstand" — 0 21 * * 1 (Europe/Berlin)
```

Im Discord testen: Tippe `/help` in einem Channel — der Bot sollte mit der Befehlsübersicht antworten.

## Hosting (24/7-Betrieb)

Für die Scheduled Tasks muss der Bot dauerhaft laufen. Optionen:

### A — Eigener Rechner / Raspberry Pi

```bash
# Linux/macOS — mit pm2 (Auto-Restart, Logging)
npm install -g pm2
pm2 start src/bot.js --name kickbase-bot
pm2 save
pm2 startup  # einmalig: für Auto-Start beim Boot
```

### B — Railway

1. Repo auf GitHub pushen
2. [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Root: `discord-bot/` setzen, Build/Start: lässt sich aus `package.json` ableiten
4. Variables: alle Werte aus `.env` reinpasten
5. **Wichtig**: `config.json` als File-Mount oder per Variables-Block auch reinbringen — am einfachsten: `config.json` ist nicht in `.gitignore` aufnehmen wenn nur ein Deployment, oder die Werte als ENV reichen lassen und Config dynamisch bauen

### C — Render

Ähnlich Railway. **Background Worker** wählen (nicht Web Service), Start Command: `npm start`. Free Tier schläft nach Inaktivität → für 24/7-Bots Hobby-Plan ($7/mo) wählen.

### D — Fly.io

`fly launch` im `discord-bot/` Ordner, Dockerfile generieren lassen, dann `fly deploy`. Free Tier reicht für einen kleinen Bot.

## Slash-Commands updaten

Wenn du:
- **Eine neue Liga hinzufügst** → Slash-Commands neu deployen, damit der Liga-Choice-Picker sie kennt
- **Eine Command-Definition änderst** → ebenso

```bash
npm run deploy-commands
```

Bei Guild-Registry sofort sichtbar, bei globaler bis zu 1h.

## Konfigurations-Beispiele

### Jeden Sonntag 22:00 Wochenstand für 3 Ligen

```json
"schedules": [
  { "name": "Liga A Wochenstand", "cron": "0 22 * * 0", "leagueId": "ID_A", "task": "standings" },
  { "name": "Liga B Wochenstand", "cron": "0 22 * * 0", "leagueId": "ID_B", "task": "standings" },
  { "name": "Liga C Wochenstand", "cron": "0 22 * * 0", "leagueId": "ID_C", "task": "standings" }
]
```

### Montag 21:30 Spieltag-Recap (letzter Spieltag)

```json
{
  "name": "Spieltag-Recap",
  "cron": "30 21 * * 1",
  "leagueId": "ID_A",
  "task": "matchday",
  "matchdayOffset": -1
}
```

### Festen Spieltag posten (z.B. für Pokal-Runde an Spieltag 18)

```json
{
  "name": "Pokal Runde 1",
  "cron": "0 22 * * 6",
  "leagueId": "ID_A",
  "task": "matchday",
  "matchday": 18
}
```

## Troubleshooting

| Symptom | Wahrscheinliche Ursache / Fix |
|---|---|
| `Kickbase-Login fehlgeschlagen (401): {"err":1,"errMsg":"AccessDenied"}` | Bot-Account ist in keiner Liga Mitglied → erst zu mind. einer Liga adden |
| `/points` zeigt „Manager nicht gefunden" | Liga-ID stimmt nicht oder Bot kennt die Liga nicht (Kickbase-Account muss Member sein) |
| Slash-Commands erscheinen nicht in Discord | `npm run deploy-commands` ausführen; bei globaler Registrierung ggf. 1h warten |
| Schedule feuert nicht | `cron`-Ausdruck mit [crontab.guru](https://crontab.guru) prüfen, Server-Timezone checken |
| Bot zeigt offline | `DISCORD_TOKEN` korrekt? Bot in Server eingeladen? `npm start` läuft? Logs ansehen |

## Sicherheit

- `.env` und `config.json` **niemals committen** (sind in `.gitignore`)
- Bot-Token bei Leak sofort in Discord-Developer-Portal **resetten**
- Kickbase-Account: dedizierter Bot-Account empfohlen, nicht dein Haupt-Account

## Tech Stack

- [discord.js v14](https://discord.js.org/) — Discord-API-Client
- [node-cron](https://github.com/node-cron/node-cron) — Scheduler
- [dotenv](https://github.com/motdotla/dotenv) — Env-Var-Loading
- ESM (Node 18+)

## Lizenz

MIT (passend zum übergeordneten kb-pokal Repo)
