import { writeJsonBoth } from './lib/paths.mjs';
import { vnDateKey } from './lib/tz.mjs';

const CTL_DAYS = 42;
const ATL_DAYS = 7;

export function computeFitness(activities) {
  if (!activities.length) {
    writeJsonBoth('fitness.json', []);
    return [];
  }

  const dailyLoad = new Map();
  for (const a of activities) {
    const day = vnDateKey(a.date);
    // relativeEffort (HR-based) is used for the whole history, never trainingLoad (power-based -
    // only present since ~04/2024 after switching to a running-power-capable device) - the two
    // are on incompatible scales (trainingLoad reads ~12x higher for the same session), and every
    // activity with trainingLoad also has relativeEffort, so preferring trainingLoad would splice
    // 2 unit systems into one continuous CTL/ATL/TSB series and fake a 2024 "fitness cliff".
    const load = a.relativeEffort ?? a.trainingLoad ?? 0;
    dailyLoad.set(day, (dailyLoad.get(day) || 0) + load);
  }

  const start = new Date(`${vnDateKey(activities[0].date)}T00:00:00Z`);
  const end = new Date(`${vnDateKey(activities[activities.length - 1].date)}T00:00:00Z`);
  const ctlK = 1 - Math.exp(-1 / CTL_DAYS);
  const atlK = 1 - Math.exp(-1 / ATL_DAYS);

  const series = [];
  let ctl = 0;
  let atl = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const load = dailyLoad.get(key) || 0;
    ctl += (load - ctl) * ctlK;
    atl += (load - atl) * atlK;
    series.push({
      date: key,
      load: Math.round(load * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
    });
  }

  writeJsonBoth('fitness.json', series);
  console.log(`[fitness] wrote ${series.length} daily CTL/ATL/TSB points`);
  return series;
}
