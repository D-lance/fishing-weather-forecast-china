// 多鱼种排行：把每种鱼的 computeForecast 输出按日期合并。纯函数，不碰 DOM。
export function rankDay(outputs, date) {
  const order = new Map(outputs.map((o, i) => [o.key, i]));
  return outputs
    .map(({ key, name, out }) => {
      const day = out?.days?.find((d) => d.date === date);
      if (!day) return null;
      return {
        key,
        name,
        day,
        score: day.score,
        level: day.level,
        level_index: day.level_index,
        windows: day.windows || [],
        day_cap: day.day_cap ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || order.get(a.key) - order.get(b.key));
}

export function allOptimal(entry) {
  if (!entry || entry.ranking.length < 2) return false;
  const score = entry.ranking[0].score;
  return entry.ranking.every((r) => r.day?.sub?.temp === 100 && r.score === score);
}

export function bestByDate(outputs, dates) {
  return dates.map((date) => {
    const ranking = rankDay(outputs, date);
    return { date, top: ranking[0] || null, ranking };
  });
}

const DISPLAY_ALERT_KEYS = ['thunder', 'gale', 'wave', 'rain', 'oxygen', 'oxygenWarn'];

export function dayFlagKeys(day) {
  if (!day) return [];
  const alertKeys = new Set((day.alerts || []).map((a) => a.key));
  if (day.day_cap != null) {
    return ['cap', ...['rain', 'oxygen', 'oxygenWarn'].filter((k) => alertKeys.has(k))];
  }
  return DISPLAY_ALERT_KEYS.filter((k) => alertKeys.has(k));
}

export function mergeAlerts(outputs) {
  const seen = new Set();
  const rows = [];
  for (const { key, out } of outputs) {
    for (const day of out?.days || []) {
      for (const alert of day.alerts || []) {
        const id = `${day.date}|${alert.line}`;
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({ date: day.date, key, line: alert.line });
      }
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
