// Slash-Commands bei Discord registrieren.
// Aufrufen mit:  npm run deploy-commands
//
// Wenn GUILD_ID gesetzt ist → Commands erscheinen sofort in diesem Server.
// Ohne GUILD_ID → globale Registrierung (kann bis zu 1h dauern).

import "dotenv/config";
import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCommands } from "./commands.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "..", "config.json");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("DISCORD_TOKEN und CLIENT_ID müssen in .env gesetzt sein.");
  process.exit(1);
}
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`config.json fehlt (${CONFIG_PATH}). Erst die Config anlegen, dann deploy.`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const commands = buildCommands(config);

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      console.log(`Deploye ${commands.length} Slash-Commands in Guild ${GUILD_ID}...`);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("✓ Guild-Commands registriert (sofort verfügbar).");
    } else {
      console.log(`Deploye ${commands.length} globale Slash-Commands...`);
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✓ Globale Commands registriert (Cache bis zu 1h).");
    }
  } catch (e) {
    console.error("Deploy fehlgeschlagen:", e);
    process.exit(1);
  }
})();
