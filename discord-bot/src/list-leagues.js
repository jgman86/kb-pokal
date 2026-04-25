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

    console.log("\n💡 Snippet für config.json:\n");
    const snippet = leagues.map((l) => `    { "id": "${l.id}", "name": ${JSON.stringify(l.name)}, "channelId": "REPLACE_WITH_DISCORD_CHANNEL_ID" }`).join(",\n");
    console.log(`  "leagues": [\n${snippet}\n  ]`);
    console.log("");
  } catch (e) {
    console.error("✗ Fehler:", e.message);
    process.exit(1);
  }
})();
