// Kickbase Discord Bot — main entrypoint.
//
// Startet den discord.js-Client, lädt config.json, registriert
// Slash-Commands (oder erinnert dran wenn fehlend) und feuert die
// Scheduler-Jobs.

import "dotenv/config";
import { Client, GatewayIntentBits, Events } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleCommand, handleAutocomplete } from "./commands.js";
import { startSchedules } from "./scheduler.js";
import * as kb from "./kickbase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "..", "config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`config.json nicht gefunden unter ${CONFIG_PATH}. Kopiere config.example.json → config.json und passe sie an.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

function checkEnv() {
  const required = ["KICKBASE_EMAIL", "KICKBASE_PASSWORD", "DISCORD_TOKEN", "CLIENT_ID"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Fehlende Env-Vars: ${missing.join(", ")}. Siehe .env.example.`);
    process.exit(1);
  }
}

async function main() {
  checkEnv();
  const config = loadConfig();
  console.log(`[Bot] ${config.leagues.length} Ligen, ${(config.schedules || []).length} Schedules in config geladen.`);

  // Kickbase-Login einmal beim Start prüfen — fail-fast wenn Creds kaputt
  try {
    await kb.login();
    console.log("[Bot] ✓ Kickbase-Login erfolgreich");
  } catch (e) {
    console.error("[Bot] ✗ Kickbase-Login fehlgeschlagen:", e.message);
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    console.log(`[Bot] ✓ Eingeloggt als ${c.user.tag}`);
    startSchedules(client, config);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) await handleCommand(interaction, config);
    else if (interaction.isAutocomplete()) await handleAutocomplete(interaction, config);
  });

  client.on(Events.Error, (e) => console.error("[Bot] Discord error:", e));
  process.on("SIGTERM", () => { console.log("[Bot] SIGTERM — shutting down"); client.destroy(); process.exit(0); });
  process.on("SIGINT", () => { console.log("[Bot] SIGINT — shutting down"); client.destroy(); process.exit(0); });

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((e) => { console.error("[Bot] fatal:", e); process.exit(1); });
