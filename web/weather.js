// 日期天气汇总：从 Open-Meteo forecast 的 hourly/daily 取白天数据。纯函数，不碰 DOM。
const WMO = [
  { codes: [95, 96, 99], kind: 'thunder', sev: 10 },
  { codes: [65, 67, 82], kind: 'heavyRain', sev: 9 },
  { codes: [61, 63, 66, 80, 81], kind: 'rain', sev: 8 },
  { codes: [71, 73, 75, 77, 85, 86], kind: 'snow', sev: 7 },
  { codes: [51, 53, 55, 56, 57], kind: 'drizzle', sev: 6 },
  { codes: [45, 48], kind: 'fog', sev: 5 },
  { codes: [3], kind: 'overcast', sev: 4 },
  { codes: [2], kind: 'partlyCloudy', sev: 3 },
  { codes: [1], kind: 'mainlyClear', sev: 2 },
  { codes: [0], kind: 'clear', sev: 1 },
];
const UNKNOWN = { kind: 'unknown', sev: 0 };

function num(v) {
  return Number.isFinite(v) ? v : null;
}

function condition(code) {
  if (code == null) return UNKNOWN;
  return WMO.find((g) => g.codes.includes(code)) || UNKNOWN;
}

function beaufort(ms) {
  if (ms == null) return null;
  if (ms < 0.3) return 0;
  if (ms < 1.6) return 1;
  if (ms < 3.4) return 2;
  if (ms < 5.5) return 3;
  if (ms < 8.0) return 4;
  if (ms < 10.8) return 5;
  if (ms < 13.9) return 6;
  if (ms < 17.2) return 7;
  if (ms < 20.8) return 8;
  if (ms < 24.5) return 9;
  if (ms < 28.5) return 10;
  if (ms < 32.7) return 11;
  return 12;
}

export function summarizeDay(fc, date) {
  if (!fc || !date) return null;
  const times = fc.hourly?.time || [];
  const all = [];
  for (let i = 0; i < times.length; i++) if (times[i]?.startsWith(`${date}T`)) all.push(i);
  if (!all.length && !(fc.daily?.time || []).includes(date)) return null;

  const daytime = all.filter((i) => {
    const h = +times[i].slice(11, 13);
    return h >= 6 && h < 18;
  });
  const idxs = daytime.length ? daytime : all;
  const H = fc.hourly || {};
  const di = (fc.daily?.time || []).indexOf(date);

  let code = null;
  let kind = 'unknown';
  let sev = 0;
  for (const i of idxs) {
    const c = condition(num(H.weather_code?.[i]));
    if (c.sev > sev) { sev = c.sev; kind = c.kind; code = num(H.weather_code?.[i]); }
  }

  let windSpeed = null;
  let windDir = null;
  for (const i of idxs) {
    const v = num(H.wind_speed_10m?.[i]);
    if (v == null || (windSpeed != null && v <= windSpeed)) continue;
    windSpeed = v;
    const deg = num(H.wind_direction_10m?.[i]);
    windDir = deg == null ? null : Math.round(deg / 45) % 8;
  }

  const temps = idxs.map((i) => num(H.temperature_2m?.[i])).filter((v) => v != null);
  const dailyMax = di >= 0 ? num(fc.daily?.temperature_2m_max?.[di]) : null;
  const dailyMin = di >= 0 ? num(fc.daily?.temperature_2m_min?.[di]) : null;
  const rain = idxs.map((i) => num(H.precipitation_probability?.[i])).filter((v) => v != null);
  const hum = idxs.map((i) => num(H.relative_humidity_2m?.[i])).filter((v) => v != null);

  return {
    code,
    kind,
    tempMax: dailyMax ?? (temps.length ? Math.max(...temps) : null),
    tempMin: dailyMin ?? (temps.length ? Math.min(...temps) : null),
    windSpeed,
    windDir,
    windLevel: beaufort(windSpeed),
    rainProb: rain.length ? Math.max(...rain) : null,
    humidity: hum.length ? Math.round(hum.reduce((a, b) => a + b, 0) / hum.length) : null,
  };
}
