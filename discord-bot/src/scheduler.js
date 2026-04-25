// Scheduler — startet Cron-Jobs aus config.json und postet Embeds
// in den jeweils zugeordneten Discord-Channel.

import cron from "node-cron";
import * as kb from "./kickbase.js";
import { standingsEmbed, matchdayEmbed, errorEmbed } from "./format.js";

export function startSchedules(client, config) {
  const jobs = [];
  for (const sched of config.schedules || []) {
    if (!cron.validate(sched.cron)) {
      console.error(`[Scheduler] Ungültiger cron-Ausdruck "${sched.cron}" für "${sched.name}" — übersprungen.`);
      continue;
    }
    const league = config.leagues.find((l) => l.id === sched.leagueId);
    if (!league) {
      console.error(`[Scheduler] Liga ${sched.leagueId} nicht in config — "${sched.name}" übersprungen.`);
      continue;
    }
    const job = cron.schedule(sched.cron, () => runJob(client, sched, league).catch((e) => console.error("Scheduled job error:", e)),
      { timezone: sched.tz || "Europe/Berlin" });
    job.start();
    jobs.push({ name: sched.name, cron: sched.cron, tz: sched.tz });
    console.log(`[Scheduler] ✓ "${sched.name}" — ${sched.cron} (${sched.tz || "Europe/Berlin"})`);
  }
  return jobs;
}

export async function runJob(client, sched, league) {
  console.log(`[Scheduler] ▶  ${sched.name} läuft...`);
  const channel = await client.channels.fetch(league.channelId);
  if (!channel || !channel.isTextBased()) throw new Error(`Channel ${league.channelId} nicht erreichbar oder kein Text-Channel`);

  try {
    const opts = { relegationCount: league.relegationCount, promotionCount: league.promotionCount, titleHolder: league.titleHolder };
    if (sched.task === "standings") {
      const rows = await kb.getStandings(league.id);
      await channel.send({ embeds: [standingsEmbed(league.name, rows, opts)] });
      return;
    }
    if (sched.task === "matchday") {
      let day = sched.matchday;
      if (day == null) {
        const cur = await kb.getCurrentMatchday();
        day = (cur ?? 1) + (sched.matchdayOffset || 0);
        if (day < 1) day = 1;
      }
      const rows = await kb.getMatchdayPoints(league.id, day);
      await channel.send({ embeds: [matchdayEmbed(league.name, day, rows, opts)] });
      return;
    }
    throw new Error(`Unbekannter Task: ${sched.task}`);
  } catch (e) {
    console.error(`[Scheduler] ${sched.name} failed:`, e);
    try { await channel.send({ embeds: [errorEmbed(`Scheduled job "${sched.name}" failed: ${e.message}`)] }); } catch {}
  }
}
