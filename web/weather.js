// 日期天气汇总 + 多模型合并：纯函数，不碰 DOM。
// 主源用 CMA（cma_grapes_global），缺失字段/小时/天由 best_match 补齐；页面显示 5 天。
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
const HAZARD_SEV = 6; // 毛毛雨及以上；降水/雷暴不能被“主导天气”盖掉

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

const asArray = (v) => (Array.isArray(v) ? v : []);
// CMA 对鹰潭最高温系统性偏低；预报温度用 best_match，当前实况仍用 CMA。
const FALLBACK_HOURLY = new Set(['temperature_2m']);
const FALLBACK_DAILY = new Set(['temperature_2m_max', 'temperature_2m_min']);

// hourly/daily 按时间（或日期）对齐；主源非空值优先，null/缺行用回退源。
function mergeSeries(primary, fallback, preferFallback = null) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const pTimes = asArray(primary.time);
  const fTimes = asArray(fallback.time);
  const times = [];
  const seen = new Set();
  for (const t of [...pTimes, ...fTimes]) {
    if (t == null || seen.has(t)) continue;
    seen.add(t);
    times.push(t);
  }
  times.sort();
  const pIdx = new Map(pTimes.map((t, i) => [t, i]));
  const fIdx = new Map(fTimes.map((t, i) => [t, i]));
  const keys = new Set([...Object.keys(primary), ...Object.keys(fallback)]);
  const out = { time: times };
  for (const key of keys) {
    if (key === 'time') continue;
    const pa = asArray(primary[key]);
    const fa = asArray(fallback[key]);
    const prefer = preferFallback?.has(key) === true;
    out[key] = times.map((t) => {
      const i = pIdx.get(t);
      const j = fIdx.get(t);
      const pv = i == null ? null : pa[i];
      const fv = j == null ? null : (fa[j] ?? null);
      if (prefer && fv != null) return fv;
      return pv != null ? pv : fv;
    });
  }
  return out;
}

/**
 * 合并两个 Open-Meteo forecast 响应。
 * primary = CMA；fallback = best_match。返回结构仍是 Open-Meteo hourly/daily/current。
 * 温度字段优先 best_match；其余字段优先 CMA，缺失时回退。
 */
export function mergeForecast(primary, fallback) {
  const p = primary?.hourly && primary?.daily ? primary : null;
  const f = fallback?.hourly && fallback?.daily ? fallback : null;
  if (!p) return f;
  if (!f) return p;
  const out = { ...f, ...p };
  out.hourly = mergeSeries(p.hourly, f.hourly, FALLBACK_HOURLY);
  out.daily = mergeSeries(p.daily, f.daily, FALLBACK_DAILY);
  if (p.current || f.current) {
    out.current = { ...(f.current || {}) };
    for (const [k, v] of Object.entries(p.current || {})) if (v != null) out.current[k] = v;
  }
  out.hourly_units = { ...(f.hourly_units || {}), ...(p.hourly_units || {}) };
  out.daily_units = { ...(f.daily_units || {}), ...(p.daily_units || {}) };
  for (const k of ['latitude', 'longitude', 'elevation', 'timezone', 'utc_offset_seconds']) {
    if (out[k] == null) out[k] = f[k] ?? null;
  }
  return out;
}

// 未来天用“白天主导天气”，避免一个小时阴把整天写成阴；平票优先 13:00/12:00，再取更阴的一档。
function representativeCode(entries) {
  if (!entries.length) return null;
  const counts = new Map();
  for (const e of entries) counts.set(e.code, (counts.get(e.code) || 0) + 1);
  const max = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, n]) => n === max).map(([c]) => c);
  const noon = entries.find((e) => e.h === 13)?.code ?? entries.find((e) => e.h === 12)?.code;
  if (noon != null && tied.includes(noon)) return noon;
  return tied.sort((a, b) => b - a)[0];
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

  const temps = idxs.map((i) => num(H.temperature_2m?.[i])).filter((v) => v != null);
  const dailyMax = di >= 0 ? num(fc.daily?.temperature_2m_max?.[di]) : null;
  const dailyMin = di >= 0 ? num(fc.daily?.temperature_2m_min?.[di]) : null;
  const rain = idxs.map((i) => num(H.precipitation_probability?.[i])).filter((v) => v != null);
  const hum = idxs.map((i) => num(H.relative_humidity_2m?.[i])).filter((v) => v != null);
  const rainProb = rain.length ? Math.max(...rain) : null;
  const humidity = hum.length ? Math.round(hum.reduce((a, b) => a + b, 0) / hum.length) : null;
  const tempMax = dailyMax ?? (temps.length ? Math.max(...temps) : null);
  const tempMin = dailyMin ?? (temps.length ? Math.min(...temps) : null);

  // 今天优先实况：天气带不再把“白天最差的一小时”当成现在的天气。
  const cur = fc.current;
  if (cur && String(cur.time || '').slice(0, 10) === date && num(cur.weather_code) != null) {
    const c = condition(num(cur.weather_code));
    const ws = num(cur.wind_speed_10m);
    const deg = num(cur.wind_direction_10m);
    const h = num(cur.relative_humidity_2m);
    return {
      now: true,
      code: num(cur.weather_code),
      kind: c.kind,
      temp: num(cur.temperature_2m),
      tempMax,
      tempMin,
      windSpeed: ws,
      windDir: deg == null ? null : Math.round(deg / 45) % 8,
      windLevel: beaufort(ws),
      rainProb,
      humidity: h == null ? humidity : Math.round(h),
    };
  }

  // 未来天：有降水/雷暴就取最严重；否则取白天主导天气。
  const entries = idxs
    .map((i) => ({ h: +times[i].slice(11, 13), code: num(H.weather_code?.[i]) }))
    .filter((e) => e.code != null);
  const hazard = entries.filter((e) => condition(e.code).sev >= HAZARD_SEV);
  let code = null;
  if (hazard.length) {
    code = hazard.reduce((a, b) => (condition(b.code).sev > condition(a.code).sev ? b : a)).code;
  } else {
    code = representativeCode(entries);
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

  return {
    now: false,
    code,
    kind: condition(code).kind,
    temp: null,
    tempMax,
    tempMin,
    windSpeed,
    windDir,
    windLevel: beaufort(windSpeed),
    rainProb,
    humidity,
  };
}
