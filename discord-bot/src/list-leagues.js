// Helper-Script: listet alle Ligen, in denen der Bot-Account Mitglied ist.
// Aufrufen mit:  npm run leagues
//
// Gibt eine Tabelle mit ID + Name aus, die du direkt in config.json kopieren
// kannst. Loggt sich mit den Credentials aus .env ein.

import "dotenv/config";
import * as kb from "./kickbase.js";

(async () => {
  try {
    console.log("Logge ein...");
    await kb.login();
    console.log("✓ Login erfolgreich\n");

    const leagues = await kb.listLeagues();
    if (!leagues.length) {
      console.log("⚠️  Keine Ligen gefunden — der Account ist in keiner Liga Mitglied.");
      process.exit(0);
    }

    console.log(`📋 ${leagues.length} Liga${leagues.length === 1 ? "" : "s"} gefunden:\n`);
    const idW = Math.max(2, ...leagues.map((l) => String(l.id).length));
    const nameW = Math.max(4, ...leagues.map((l) => l.name.length));
    console.log(`  ${"ID".padEnd(idW)}  ${"Name".padEnd(nameW)}`);
    console.log(`  ${"-".repeat(idW)}  ${"-".repeat(nameW)}`);
    leagues.forEach((l) => console.log(`  ${String(l.id).padEnd(idW)}  ${l.name.padEnd(nameW)}`));

    console.log("\n💡 Komplettes config.json (copy-paste-ready):\n");
    const cfg = {
      leagues: leagues.map((l) => ({ id: l.id, name: l.name, channelId: "REPLACE_WITH_DISCORD_CHANNEL_ID" })),
      schedules: [
        { name: "Wochenstand", cron: "0 21 * * 1", leagueId: leagues[0].id, task: "standings", tz: "Europe/Berlin" },
      ],
    };
    console.log(JSON.stringify(cfg, null, 2));
    console.log("\n→ In config.json speichern, dann channelId-Platzhalter durch echte Discord-Channel-IDs ersetzen.");
  } catch (e) {
    console.error("✗ Fehler:", e.message);
    process.exit(1);
  }
})();
