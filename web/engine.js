// 今日鱼情 · 评分引擎（纯函数，不碰 DOM；浏览器 <script type="module"> 与 Node 都能 import）
//
// 唯一口径：docs/model.md（鱼情模型 v0.4）+ docs/impl-notes.md。
// 公式、权重、鱼种表、输出结构全部按该文件实现；Python 版（外部 skill 的 scripts/）是回归基准，
// 两端对同一份 fixture 算出的分数差应 ≤ 1。改公式先改 model.md，再两端一起改。
//
// 用法：
//   import { computeForecast } from './engine.js';
//   const out = computeForecast({ forecast, marine, species: 'crucian', water: 'lake', waterSource: 'osm', name: '太湖' });
//   // forecast = Open-Meteo /v1/forecast 原始响应；marine = /v1/marine 原始响应或 null
//
// 时间口径：Open-Meteo 以 timezone=auto 返回本地钟点字符串（无偏移），本文件把它当作「本地分钟数」
// （按 UTC 解析得到的伪时间戳 / 60000），需要真实时刻（日月计算）时再减去 utc_offset_seconds。

export const MODEL_VERSION = '0.4';

// ───────────────────────── 数据源（§1） ─────────────────────────
const HOURLY = 'temperature_2m,relative_humidity_2m,pressure_msl,surface_pressure,cloud_cover,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
const DAILY = 'sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum';
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// forecast_days=8：热季会把 d+1 00:00–02:00 算进最后一天，必须多要一天才能拿到那几个小时；
// 网页端用 localToday() 把“今天”传给 computeForecast，避免把多出来的第 8 天显示出来。
export function forecastUrl(lat, lon) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${r4(lat)}&longitude=${r4(lon)}&timezone=auto&past_days=7&forecast_days=8&wind_speed_unit=ms&hourly=${HOURLY}&daily=${DAILY}`;
}
export function marineUrl(lat, lon) {
  return `https://marine-api.open-meteo.com/v1/marine?latitude=${r4(lat)}&longitude=${r4(lon)}&timezone=auto&past_days=1&forecast_days=8&hourly=wave_height,wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction`;
}
/** Flood API：河流径流趋势（GloFAS 最近网格；湖泊/海边可能为 null）。 */
export function floodUrl(lat, lon) {
  return `https://flood-api.open-meteo.com/v1/flood?latitude=${r4(lat)}&longitude=${r4(lon)}&daily=river_discharge&past_days=7&forecast_days=8`;
}
/** 按 forecast 响应的时区偏移算“当地今天”（YYYY-MM-DD），不依赖浏览器/服务器本地日期。 */
export function localToday(fc, ms = Date.now()) {
  return new Date(ms + (fc?.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 10);
}
export function geocodeUrl(name, lang = 'zh') {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&language=${lang === 'en' ? 'en' : 'zh'}&count=8`;
}
export function reverseUrl(lat, lon, lang = 'zh') {
  return `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=${lang === 'en' ? 'en' : 'zh'}&zoom=12&lat=${r4(lat)}&lon=${r4(lon)}`;
}
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// model.md §1 的查询 + impl-notes 补的 landuse=aquaculture 一行（否则 pond 判定里的 aquaculture 永远触发不了）。
// geom=true 时改为输出裁剪到约 ±3 km 框内的几何（网站地图高亮 / 吸附 / 附近水体列表用），判定逻辑不变。
export function overpassQuery(lat, lon, geom = false) {
  const a = `${r4(lat)},${r4(lon)}`;
  const dLat = 0.027, dLon = 0.027 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(r4).join(',');
  return `[out:json][timeout:15];
(
 nwr(around:1500,${a})["natural"="water"];
 nwr(around:1500,${a})["landuse"="reservoir"];
 nwr(around:1500,${a})["landuse"="aquaculture"];
 way(around:1500,${a})["waterway"~"^(river|stream|canal)$"];
 way(around:5000,${a})["natural"="coastline"];
);
${geom ? `out geom(${bbox}) 60;` : 'out tags center 40;'}`;
}

/** 海况响应是否有效：三列全是 null（或请求失败）= 内陆，按淡水处理 */
export function marineAvailable(marine) {
  const h = marine && marine.hourly;
  if (!h) return false;
  for (const k of ['wave_height', 'sea_surface_temperature', 'sea_level_height_msl']) {
    if (Array.isArray(h[k]) && h[k].some((v) => v != null)) return true;
  }
  return false;
}

/** Overpass 结果 → 水域类型（§1 判定优先级）。返回 sea|reservoir|lake|pond|river|unknown */
export function classifyWater(overpass, hasMarine) {
  const els = (overpass && overpass.elements) || [];
  const has = (f) => els.some((e) => f(e.tags || {}));
  if (hasMarine && has((t) => t.natural === 'coastline')) return 'sea';
  if (has((t) => t.water === 'reservoir' || t.landuse === 'reservoir')) return 'reservoir';
  if (has((t) => t.water === 'lake')) return 'lake';
  if (has((t) => t.water === 'pond' || t.water === 'fishpond' || t.landuse === 'aquaculture')) return 'pond';
  if (has((t) => t.water === 'river' || t.water === 'canal' || /^(river|stream|canal)$/.test(t.waterway || ''))) return 'river';
  if (has((t) => t.natural === 'water')) return 'lake';
  return 'unknown';
}

export const WATER_TYPES = ['reservoir', 'lake', 'river', 'pond', 'sea', 'unknown'];

// ───────────────────────── 鱼种表（§5） ─────────────────────────
// 构建时若 fixtures/species.json（或 FISH_SPECIES_JSON）存在，tools/build.mjs 会用它替换下面两个标记之间的数组。
const SPECIES_TABLE = /*SPECIES_BEGIN*/[
  { "key": "crucian", "name": "鲫鱼", "tmin": 5, "opt_lo": 15, "opt_hi": 25, "tmax": 30 },
  { "key": "carp", "name": "鲤鱼", "tmin": 10, "opt_lo": 18, "opt_hi": 28, "tmax": 32 },
  { "key": "grass", "name": "草鱼", "tmin": 15, "opt_lo": 20, "opt_hi": 30, "tmax": 33 },
  { "key": "silver", "name": "鲢鳙", "tmin": 16, "opt_lo": 22, "opt_hi": 30, "tmax": 34 },
  { "key": "tilapia", "name": "罗非", "tmin": 18, "opt_lo": 24, "opt_hi": 32, "tmax": 36 },
  { "key": "culter", "name": "翘嘴/鲌鱼", "tmin": 8, "opt_lo": 15, "opt_hi": 28, "tmax": 32 },
  { "key": "bass", "name": "鲈鱼（大口黑鲈）", "tmin": 10, "opt_lo": 18, "opt_hi": 28, "tmax": 32 },
  { "key": "snakehead", "name": "黑鱼", "tmin": 12, "opt_lo": 20, "opt_hi": 30, "tmax": 34 },
  { "key": "mandarin", "name": "鳜鱼", "tmin": 10, "opt_lo": 18, "opt_hi": 28, "tmax": 30 },
  { "key": "catfish", "name": "黄颡鱼", "tmin": 10, "opt_lo": 18, "opt_hi": 28, "tmax": 32 },
  { "key": "seabass", "name": "海鲈", "tmin": 8, "opt_lo": 14, "opt_hi": 24, "tmax": 28 },
  { "key": "seabream", "name": "黑鲷", "tmin": 10, "opt_lo": 15, "opt_hi": 25, "tmax": 30 }
]/*SPECIES_END*/;

const SPECIES_EN = {
  crucian: 'Crucian carp', carp: 'Common carp', grass: 'Grass carp', silver: 'Silver / bighead carp', tilapia: 'Tilapia',
  culter: 'Topmouth culter', bass: 'Largemouth bass', snakehead: 'Snakehead', mandarin: 'Mandarin fish',
  catfish: 'Yellow catfish', seabass: 'Sea bass', seabream: 'Black seabream',
};
// §7：路亚鱼种给饵型，不给味型
const LURE_SPECIES = new Set(['culter', 'bass', 'snakehead', 'mandarin', 'seabass']);

export const SPECIES = SPECIES_TABLE.map((s) => ({ ...s, en: s.en || SPECIES_EN[s.key] || s.key, lure: typeof s.lure === 'boolean' ? s.lure : LURE_SPECIES.has(s.key) }));
export const DEFAULT_SPECIES = 'crucian';

// ───────────────────────── SunCalc（内联） ─────────────────────────
// 以下日月算法取自 SunCalc 1.9.0（https://github.com/mourner/suncalc），
// (c) 2011-2015, Vladimir Agafonkin，BSD 2-Clause 许可：
//   Redistribution and use in source and binary forms, with or without modification, are permitted provided that
//   the following conditions are met: 1. Redistributions of source code must retain the above copyright notice,
//   this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above
//   copyright notice, this list of conditions and the following disclaimer in the documentation and/or other
//   materials provided with the distribution.
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES
//   ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DAMAGES ARISING IN ANY
//   WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
// 只保留本模型用到的月亮位置 / 月相 / 月出月落；getMoonTimes 改为接收「本地零点对应的真实时刻」，
// 其余公式逐字未改。
const PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan, asin = Math.asin, atan = Math.atan2, acos = Math.acos, rad = PI / 180;
const dayMs = 1000 * 60 * 60 * 24, J1970 = 2440588, J2000 = 2451545;
const toJulian = (ms) => ms / dayMs - 0.5 + J1970;
const toDays = (ms) => toJulian(ms) - J2000;
const e = rad * 23.4397;
const rightAscension = (l, b) => atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
const declination = (l, b) => asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
const altitude = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
function astroRefraction(h) {
  if (h < 0) h = 0;
  return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}
const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)), P = rad * 102.9372;
  return M + C + P + PI;
}
function sunCoords(d) {
  const M = solarMeanAnomaly(d), L = eclipticLongitude(M);
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d),
    l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F), dt = 385001 - 20905 * cos(M);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
}
/** 月亮高度（弧度，含大气折射），ms = 真实 UTC 毫秒 */
export function moonAltitude(ms, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(ms), c = moonCoords(d), H = siderealTime(d, lw) - c.ra;
  const h = altitude(H, phi, c.dec);
  return h + astroRefraction(h);
}
/** suncalc getMoonIllumination：phase ∈ [0,1)，0 新月、0.5 满月 */
export function moonIllumination(ms) {
  const d = toDays(ms), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi));
  const angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
  return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI, angle };
}
/** suncalc getMoonTimes，t0 = 本地零点的真实 UTC 毫秒；返回 {rise, set}（真实 UTC 毫秒，可能缺） */
export function moonTimes(t0, lat, lng) {
  const hoursLater = (h) => t0 + h * dayMs / 24;
  const hc = 0.133 * rad;
  let h0 = moonAltitude(t0, lat, lng) - hc, h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;
  for (let i = 1; i <= 24; i += 2) {
    h1 = moonAltitude(hoursLater(i), lat, lng) - hc;
    h2 = moonAltitude(hoursLater(i + 1), lat, lng) - hc;
    a = (h0 + h2) / 2 - h1;
    b = (h2 - h0) / 2;
    xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    d = b * b - 4 * a * h1;
    roots = 0;
    if (d >= 0) {
      dx = Math.sqrt(d) / (Math.abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise && set) break;
    h0 = h2;
  }
  const out = {};
  if (rise) out.rise = hoursLater(rise);
  if (set) out.set = hoursLater(set);
  return out;
}

// ───────────────────────── 小工具 ─────────────────────────
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const round1 = (x) => Math.round(x * 10) / 10;
/** "2026-09-23T05:00" → 本地分钟数（按 UTC 解析的伪时间） */
function localMin(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) / 60000;
}
const pad = (n) => String(n).padStart(2, '0');
function fmtHM(min) {
  const d = new Date(Math.round(min) * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function fmtISO(min) {
  const d = new Date(Math.round(min) * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${fmtHM(min)}`;
}
const mean = (arr) => {
  const v = arr.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sgn = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d);
function beaufort(v) {
  const t = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  let b = 0;
  while (b < t.length && v >= t[b]) b++;
  return b;
}
const isNorth = (dir) => dir != null && (dir >= 315 || dir <= 45);

// ───────────────────────── 文案（中文为口径，英文供 /en/） ─────────────────────────
const DIRS = { zh: ['北', '东北', '东', '东南', '南', '西南', '西', '西北'], en: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] };
const dirName = (deg, lang) => DIRS[lang][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

export const LEVELS = {
  zh: ['极佳', '好', '一般', '偏差', '不建议'],
  en: ['Excellent', 'Good', 'Fair', 'Poor', 'Not advised'],
};
// 等级说明（中文与 Python 基准同文）
export const LEVEL_TEXT = {
  zh: ['天时都在线，挑最佳时段去', '值得去，留意扣分最多的那一项', '能钓，别期望太高，挑对时段比挑日子重要', '能不去就不去，去就只钓最佳时段', '多半是雷暴、大风、大雨或者水温太离谱，改天吧'],
  en: ['Everything lines up; go in the best window', 'Worth going; watch the factor that loses the most points', 'Fishable, keep expectations low; picking the hour matters more than the day', 'Skip it if you can; if you go, fish only the best window', 'Likely storms, strong wind, heavy rain or badly off water temperature; try another day'],
};
const DANGER_WORDS = { zh: { thunder: '雷暴', gale: '大风', wave: '大浪' }, en: { thunder: 'thunderstorms', gale: 'strong gusts', wave: 'high waves' } };
const capText = (lang, what) => (lang === 'en'
  ? `${what.join(' and ')} today: fish only in safe hours, or pick another day`
  : `今天有${what.join('和')}，只建议在安全时段短钓，或者改天`);

export function levelIndex(score) {
  return score >= 80 ? 0 : score >= 65 ? 1 : score >= 50 ? 2 : score >= 35 ? 3 : 4;
}

const SAFETY = {
  zh: {
    thunder: '雷暴，远离水边、收起碳素竿',
    gale: '阵风 7 级以上，别去开阔水面和堤坝',
    wave: '浪高 2.5 米以上，别上礁石',
    rain: '强降水，河道注意涨水',
    heat: '气温 35℃ 以上，防中暑，多带水、找树荫',
    ice: '可能结冰：冰钓安全第一，冰厚不到 10 厘米不上冰',
    oxygen: '高温、低压、无风，浅水容易缺氧浮头；找活水、增氧机或深水，别钓浅滩',
    oxygenWarn: '实测溶解氧偏低，鱼口可能受影响；找活水、增氧机或深水',
    oxygenIce: '冰下可能缺氧，注意鱼浮头；冰钓先测冰厚',
  },
  en: {
    thunder: 'Thunderstorm: stay away from the water and lower carbon rods',
    gale: 'Gusts of Beaufort 7+: avoid open water and embankments',
    wave: 'Waves 2.5 m or higher: stay off the rocks',
    rain: 'Heavy rain: watch for rising rivers',
    heat: 'Air ≥ 35°C: beware of heatstroke, bring water, find shade',
    ice: 'Possible ice: safety first, never go on ice thinner than 10 cm',
    oxygen: 'Hot, low pressure and calm: shallow water may lose oxygen; fish deeper or near moving/aerated water',
    oxygenWarn: 'Measured dissolved oxygen is low; the bite may suffer. Fish moving or aerated water.',
    oxygenIce: 'Oxygen may run low under ice; watch for gasping fish; test ice thickness',
  },
};

const T = {
  zh: {
    season: { cold: '水温偏低时', mild: '水温适中时', hot: '天热时' },
    temp: (W, sp, lo, hi, st, tmin, tmax) => {
      let d;
      if (W >= lo && W <= hi) d = '正合适，鱼爱开口';
      else if (W < lo) d = st < 60 ? '偏凉；水温太低，鱼不爱动，整体打折' : '偏凉，开口一般';
      else d = st < 60 ? '偏热；水温太高，鱼不爱动，整体打折' : '偏热，开口一般';
      return `估算水温 ${W.toFixed(1)}℃，${sp}最舒服 ${lo}–${hi}℃：${d}`;
    },
    pressure: (P, d24, parts) => `气压 ${P.toFixed(0)} 百帕（比昨天此时 ${d24 == null ? '没数据' : sgn(d24)}）：${parts.join('，')}`,
    pLow: '气压偏低', pHigh: '气压偏高', pDrop: '急降，有冷空气或降雨过境', pFall: '在下降', pJump: '猛升，冷空气过后鱼容易闭口', pRise: '在上升', pStable: '气压平稳',
    pShort: '最近 3 小时开始往下掉，鱼常趁机开口', pHypoxia: '低压闷热，容易缺氧浮头', pMissing: '气压数据暂缺，按一般情况算',
    trend: (dT, s, desc) => `今天平均气温比昨天 ${dT == null ? '没数据' : sgn(dT) + '℃'}：${desc}`,
    tCrash: '骤降，鱼停口', tDrop: '降温，开口变差', tUpCold: '天冷回暖，大好事', tUpMild: '升温，小有利', tUpHot: '天热还在升温，更闷', tStable: '气温平稳', tNone: '按平稳算',
    wind: (v, bf, dir, desc) => `${dir ? dir + '风' : '风'} ${bf} 级（${v.toFixed(1)} 米/秒）：${desc}`,
    wCalm: '几乎无风，水面发闷', wBest: '微风起浪，最理想', wOk: '风不大，还不错', wStrong: '风偏大，抛竿看漂吃力', wGale: '大风，很难钓', wStorm: '狂风，别出钓', wNorth: '，北风降温', wMissing: '风速数据暂缺，按一般情况算',
    sky: (cond, s, S) => `${cond}，${T.zh.season[s]}${S >= 80 ? '有利' : S >= 50 ? '影响一般' : '不利'}`,
    skyThunder: '雷暴', skySnow: '下雪', skyLight: (p) => `小雨（每小时 ${p.toFixed(1)} 毫米）`, skyMod: (p) => `中雨（每小时 ${p.toFixed(1)} 毫米）`, skyHeavy: (p) => `大雨（每小时 ${p.toFixed(1)} 毫米）`,
    skyClear: '晴天', skyPartly: '多云', skyOvercast: '阴天',
    time: { dawn: '早口：日出前后，一天的黄金时段', dusk: '晚口：日落前后，黄金时段', noon: { hot: '中午：天热太晒，鱼躲深水', mild: '中午：口一般', cold: '中午：天冷时中午水最暖，最好' }, night: { hot: '夜里：天热夜钓凉快，鱼靠边找食', mild: '夜里：口一般', cold: '夜里：天冷，鱼基本不动' }, day: '白天一般时段' },
    major: '，赶上月亮大时段（月亮正当头或在脚下前后），加分', iceMode: '；冰钓鲫鱼照样能钓，打折少一些', minor: '，赶上月亮小时段（月出、月落前后），加分',
    moon: (a, d) => `农历约${Math.min(30, Math.max(1, Math.round(a) + 1))}：${d <= 2 ? '接近初一或十五，鱼口活跃' : d <= 4 ? '离初一、十五不远' : '半月前后，影响不大'}`,
    tide: {
      slack: '；潮水：平潮，水不动', run: '；潮水：刚涨潮或刚落潮，水流起来了', mid: '；潮水：涨落中段',
      detail: (r, c, p) => {
        const bits = [];
        if (r != null) bits.push(`潮差约 ${r.toFixed(1)} 米`);
        if (c != null) bits.push(`流速约 ${c.toFixed(1)} 公里/小时`);
        if (p != null) bits.push(`浪周期约 ${p.toFixed(0)} 秒`);
        return bits.length ? `；${bits.join('，')}` : '';
      },
    },
    geo: {
      riverFlood: (r) => `河道：近两天下雨 ${r.toFixed(0)} 毫米，涨水浑浊，找回水湾`,
      river: '河道：活水溶氧足，正常', reservoirHot: '水库：天热时深水区凉快，有利', reservoir: '水库：水面大，找结构',
      lake: '湖泊：正常', pondHot: '小塘天热没风，容易缺氧', pond: '池塘：鱼多，正常',
      seaRough: (w) => `浪高 ${w.toFixed(1)} 米，风浪偏大`, sea: '海面平稳', unknown: '没认出是什么水，按一般水体算，请在上面手动选一下',
      riverRise: '，流量在涨，鱼可能靠边', riverFall: '，流量在退，鱼往深水和主河道退',
      reservoirRise: '，入库流量在涨，鱼可能进湾、靠边', reservoirFall: '，水位在退，鱼往深水退',
    },
    layer: { cold: '水层：水温低，钓深水底层，午后找向阳面', cool: '水层：中下层为主，向阳浅滩，午后最好', mild: '水层：早晚钓浅滩，中午转深水', hot: '水层：早晚和夜里钓浅水，白天找深水、树荫、进水口' },
    spot: (from, to) => `钓位：风从${from}来，钓${to}岸（下风岸），风把食物和氧气吹过去`,
    spotColdNorth: '钓位：天冷刮北风，改钓背风向阳的北岸',
    spotStrong: '钓位：风力 4 级以上，选背风、站位平稳的岸，安全第一',
    bait: { cold: '饵料：腥香味型、小颗粒，蚯蚓红虫', mid: '饵料：腥香、谷香都可以', warm: '饵料：清淡、果酸、谷物' },
    lure: { cold: '饵型：慢沉饵、贴底慢拖', mid: '饵型：米诺、软饵', warm: '饵型：早晚用水面系，白天打深层' },
    water: {
      reservoir: '找位：回水湾、岬角、老河道', river: '找位：回水湾、缓流区、桥墩下游', lake: '找位：草边、进出水口',
      pond: '找位：增氧机附近、进水口、深水区',
    },
    seasonal: {
      spring: '季节：春季繁殖期，鲫鱼、鲤鱼靠浅滩草边，尽量少打扰，早晚更好',
      summer: '季节：夏季高温，早晚和夜间为主，白天钓深水、树荫、进水口',
      summerSnakehead: '季节：黑鱼护崽期，看到鱼群别下竿',
      autumn: '季节：秋季育肥，鱼口好，找浅滩、结构、回水湾，降温前抓紧',
      winter: '季节：冬季鱼扎深水，钓深、向阳、背风；冰钓先测冰厚',
    },
    tides: (list) => `潮水：当天 ${list.map((e) => (e.kind === 'high' ? '高潮 ' : '低潮 ') + e.t).join('、')}；平潮前后半小时口差，涨落潮开始后 0.5–2.5 小时水流起来最好`,
    noTides: '潮水：没有潮位数据，以当地潮汐表为准',
    listSep: '、',
  },
  en: {
    season: { cold: 'when the water is cold', mild: 'in mild water', hot: 'in hot weather' },
    temp: (W, sp, lo, hi, st, tmin, tmax) => {
      let d;
      if (W >= lo && W <= hi) d = 'just right, fish are feeding';
      else if (W < lo) d = st < 60 ? 'too cold, fish are sluggish, the whole day is marked down' : 'a bit cool, so-so bite';
      else d = st < 60 ? 'too warm, fish are sluggish, the whole day is marked down' : 'a bit warm, so-so bite';
      return `Estimated water ${W.toFixed(1)}°C, ${sp} like ${lo}–${hi}°C: ${d}`;
    },
    pressure: (P, d24, parts) => `Pressure ${P.toFixed(0)} hPa (${d24 == null ? 'no data for' : sgn(d24) + ' vs'} this time yesterday): ${parts.join(', ')}`,
    pLow: 'low pressure', pHigh: 'high pressure', pDrop: 'dropping fast, a front is passing', pFall: 'falling', pJump: 'jumping, post-front high shuts the bite', pRise: 'rising', pStable: 'steady',
    pShort: 'dropping over the last 3 hours, fish often feed', pHypoxia: 'low, hot and still: fish may gasp for oxygen', pMissing: 'No pressure data, treated as average',
    trend: (dT, s, desc) => `Average air temp vs yesterday ${dT == null ? 'n/a' : sgn(dT) + '°C'}: ${desc}`,
    tCrash: 'sharp drop, bite shuts down', tDrop: 'cooling, bite weakens', tUpCold: 'warming, great in the cold season', tUpMild: 'warming, slight plus', tUpHot: 'warming, even stuffier in the heat', tStable: 'stable', tNone: 'treated as stable',
    wind: (v, bf, dir, desc) => `Wind ${v.toFixed(1)} m/s (Beaufort ${bf}${dir ? ', from the ' + dir : ''}): ${desc}`,
    wCalm: 'nearly calm, water is stuffy', wBest: 'light ripple, ideal', wOk: 'moderate breeze, fine', wStrong: 'fresh wind, casting gets hard', wGale: 'strong wind, hard to fish', wStorm: 'gale, stay home', wNorth: ', north wind chills', wMissing: 'No wind data, treated as average',
    sky: (cond, s, S) => `${cond}: ${S >= 80 ? 'good' : S >= 50 ? 'so-so' : 'bad'} ${T.en.season[s]}`,
    skyThunder: 'Thunderstorm', skySnow: 'Snow', skyLight: (p) => `Light rain (${p.toFixed(1)} mm/h)`, skyMod: (p) => `Moderate rain (${p.toFixed(1)} mm/h)`, skyHeavy: (p) => `Heavy rain (${p.toFixed(1)} mm/h)`,
    skyClear: 'Clear', skyPartly: 'Partly cloudy', skyOvercast: 'Overcast',
    time: { dawn: 'Morning bite: around sunrise, prime time', dusk: 'Evening bite: around sunset, prime time', noon: { hot: 'Midday: too sunny in the heat, fish go deep', mild: 'Midday: average', cold: 'Midday: the water is warmest now in cold weather, best' }, night: { hot: 'Night: cool night fishing, fish feed near the bank', mild: 'Night: average', cold: 'Night: too cold, fish barely move' }, day: 'Ordinary daytime hour' },
    major: ', plus a major moon period (moon overhead or underfoot)', iceMode: '; crucian ice fishing still works, marked down less', minor: ', plus a minor moon period (moonrise or moonset)',
    moon: (a, d) => `Moon ${Math.round(a)} days old: ${d <= 2 ? 'near new or full moon, fish are active' : d <= 4 ? 'close to new or full moon' : 'around half moon, little effect'}`,
    tide: {
      slack: '; tide: slack water, no current', run: '; tide: just turned, current picking up', mid: '; tide: mid-flow',
      detail: (r, c, p) => {
        const bits = [];
        if (r != null) bits.push(`tide range ~${r.toFixed(1)} m`);
        if (c != null) bits.push(`current ~${c.toFixed(1)} km/h`);
        if (p != null) bits.push(`wave period ~${p.toFixed(0)} s`);
        return bits.length ? `; ${bits.join(', ')}` : '';
      },
    },
    geo: {
      riverFlood: (r) => `River: ${r.toFixed(0)} mm of rain in 48 h, high muddy water, look for back-eddies`,
      river: 'River: flowing, oxygen-rich, normal', reservoirHot: 'Reservoir: deep water stays cool in the heat', reservoir: 'Reservoir: big water, fish structure',
      lake: 'Lake: normal', pondHot: 'Small water, hot and still: low oxygen', pond: 'Pond: dense fish, normal',
      seaRough: (w) => `Waves ${w.toFixed(1)} m, rough`, sea: 'Calm sea', unknown: 'Could not tell what water this is; scored as generic water, please pick it above',
      riverRise: ', flow rising, fish may move to the bank', riverFall: ', flow falling, fish move to deeper water and the main channel',
      reservoirRise: ', inflow rising, fish may move into bays and to the bank', reservoirFall: ', water level falling, fish move deeper',
    },
    layer: { cold: 'Depth: deep, near the bottom; sunny banks in the afternoon', cool: 'Depth: mid to low; sunny shallows, afternoon best', mild: 'Depth: shallows morning and evening, deep water at midday', hot: 'Depth: shallows at dawn, dusk and night; deep water, shade and inflows by day' },
    spot: (from, to) => `Spot: wind from the ${from}, fish the ${to} bank (downwind); wind pushes food and oxygen there`,
    spotColdNorth: 'Spot: cold north wind, switch to the sheltered, sunny north bank',
    spotStrong: 'Spot: wind Beaufort 4+, pick a sheltered bank with stable footing; safety first',
    bait: { cold: 'Bait: fishy scents, small particles, worms and bloodworms', mid: 'Bait: fishy or grain scents both work', warm: 'Bait: light flavours, fruity/sour, grains' },
    lure: { cold: 'Lures: slow sinkers, slow bottom drags', mid: 'Lures: minnows, soft plastics', warm: 'Lures: topwater at dawn/dusk, deep baits by day' },
    water: {
      reservoir: 'Where: back bays, points, old river channels', river: 'Where: back-eddies, slow current, downstream of bridge piers', lake: 'Where: weed edges, inflows and outflows',
      pond: 'Where: near aerators, inflows, deep holes',
    },
    seasonal: {
      spring: 'Season: spring spawning; crucian and carp hold on shallow weed edges, keep disturbance low, dawn/dusk best',
      summer: 'Season: summer heat; fish dawn, dusk and night, deep water, shade and inflows by day',
      summerSnakehead: 'Season: snakehead guarding fry; do not cast at the school',
      autumn: 'Season: autumn feeding; fish shallows, structure and back bays before the cold',
      winter: 'Season: winter; fish deep, sunny and sheltered water; test ice before ice fishing',
    },
    tides: (list) => `Tide today: ${list.map((e) => (e.kind === 'high' ? 'high ' : 'low ') + e.t).join(', ')}. The bite slows ±30 min around slack water; 0.5–2.5 h into the flood/ebb is best`,
    noTides: 'Tide: no tide data here, check a local tide table',
    listSep: ', ',
  },
};

// ───────────────────────── 分项（§3） ─────────────────────────
function sTemp(W, sp) {
  const { tmin, opt_lo: lo, opt_hi: hi, tmax } = sp;
  let s;
  if (W >= lo && W <= hi) s = 100;
  else if (W >= tmin && W < lo) s = 20 + 80 * (W - tmin) / (lo - tmin);
  else if (W > hi && W <= tmax) s = 20 + 80 * (tmax - W) / (tmax - hi);
  else if (W < tmin) s = Math.max(0, 20 - 5 * (tmin - W));
  else s = Math.max(0, 20 - 5 * (W - tmax));
  return clamp(s);
}

function pressureNormal(elevation) {
  const h = Number.isFinite(elevation) ? Math.max(0, elevation) : 0;
  return 1013.25 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
}
function floodTrend(flood, date) {
  const d = flood && flood.daily;
  if (!d || !Array.isArray(d.time) || !Array.isArray(d.river_discharge)) return { trend: 'unknown', q: null };
  const i = d.time.indexOf(date);
  const q = i >= 0 ? d.river_discharge[i] : null;
  if (i <= 0 || q == null || d.river_discharge[i - 1] == null) return { trend: 'unknown', q };
  const prev = d.river_discharge[i - 1];
  const pct = (q - prev) / Math.max(Math.abs(prev), 0.1);
  return { trend: pct > 0.15 ? 'rising' : pct < -0.15 ? 'falling' : 'stable', q };
}
function tideRangeForDay(mar, date) {
  let min = Infinity, max = -Infinity;
  for (let h = 0; h < 24; h++) {
    const m = mar[`${date}T${pad(h)}:00`];
    if (m && m.sl != null) { min = Math.min(min, m.sl); max = Math.max(max, m.sl); }
  }
  return min === Infinity ? null : max - min;
}
function rangeScore(r) { return r == null ? null : r >= 2 ? 100 : r >= 1 ? 80 : r >= 0.5 ? 60 : 40; }
function currentScore(c) { return c == null ? null : c < 0.2 ? 60 : c <= 2.0 ? 100 : c <= 4.0 ? 70 : 40; }
function periodScore(p) { return p == null ? null : p < 3 ? 60 : p < 8 ? 80 : p <= 12 ? 100 : 70; }
function oxygenRisk({ water, season, wind, P, pNorm, t, ice }) {
  const tod = ((t % 1440) + 1440) % 1440;
  const night = tod < 480 || tod >= 1200;
  const smallWater = water === 'pond' || water === 'lake';
  const severe = smallWater && !ice && season === 'hot' && wind != null && wind < 2
    && P != null && pNorm != null && P < pNorm - 5 && night;
  return { severe, iceLow: ice && smallWater };
}
function seasonalAdvice(date, sp, L) {
  const month = Number(String(date).slice(5, 7));
  if (month >= 3 && month <= 5) return L.seasonal.spring;
  if (month >= 6 && month <= 8) return sp.key === 'snakehead' ? L.seasonal.summerSnakehead : L.seasonal.summer;
  if (month >= 9 && month <= 11) return L.seasonal.autumn;
  return L.seasonal.winter;
}

function sPressure(P, P3, P24, tempC, v, L, low = 1000, high = 1030, hypoxia = 1005) {
  if (P == null) return { s: 70, reason: L.pMissing };   // 缺数据按中性 70（与 Python 一致）
  let s = 100;
  const parts = [];
  if (P < low) { s -= Math.min(30, 3 * (low - P)); parts.push(L.pLow); }
  if (P > high) { s -= Math.min(20, 2 * (P - high)); parts.push(L.pHigh); }
  const d24 = P24 != null ? P - P24 : null;
  const d3 = P3 != null ? P - P3 : null;
  if (d24 != null) {
    if (d24 <= -6) { s -= 25; parts.push(L.pDrop); }
    else if (d24 <= -3) { s -= 10; parts.push(L.pFall); }
    else if (d24 >= 6) { s -= 25; parts.push(L.pJump); }
    else if (d24 >= 3) { s -= 10; parts.push(L.pRise); }
    else parts.push(L.pStable);
  }
  if (d3 != null && d3 <= -1.0 && (d24 == null || d24 > -6)) { s += 5; parts.push(L.pShort); }
  if (P < hypoxia && tempC != null && tempC >= 30 && v != null && v < 2) { s -= 20; parts.push(L.pHypoxia); }
  if (!parts.length) parts.push(L.pStable);
  return { s: clamp(s), reason: L.pressure(P, d24, parts) };
}

function sTrend(dT, season, L) {
  let s = 80, desc;
  if (dT == null) { desc = L.tNone; }
  else if (dT <= -6) { s -= 50; desc = L.tCrash; }
  else if (dT <= -3) { s -= 25; desc = L.tDrop; }
  else if (dT >= 3) {
    if (season === 'cold') { s += 20; desc = L.tUpCold; }
    else if (season === 'mild') { s += 10; desc = L.tUpMild; }
    else { s -= 20; desc = L.tUpHot; }
  } else { s += 10; desc = L.tStable; }
  return { s: clamp(s), reason: L.trend(dT, season, desc) };
}

function sWind(v, dir, season, L, lang) {
  if (v == null) return { s: 70, reason: L.wMissing };
  let s, desc;
  if (v < 0.5) { s = season === 'cold' ? 70 : season === 'mild' ? 60 : 50; desc = L.wCalm; }
  else if (v < 3.4) { s = 100; desc = L.wBest; }
  else if (v < 5.5) { s = 85; desc = L.wOk; }
  else if (v < 8.0) { s = 60; desc = L.wStrong; }
  else if (v < 10.8) { s = 30; desc = L.wGale; }
  else { s = 0; desc = L.wStorm; }
  if (season === 'cold' && isNorth(dir) && v >= 3.4) { s -= 15; desc += L.wNorth; }
  return { s: clamp(s), reason: L.wind(v, beaufort(v), dir != null && v >= 0.5 ? dirName(dir, lang) : '', desc) };
}

const SKY_TABLE = {
  //        晴   多云  阴   小雨  中雨  大雨
  hot: [55, 80, 100, 100, 60, 20],
  mild: [80, 100, 90, 85, 55, 20],
  cold: [100, 85, 65, 50, 50, 20],
};
function sSky(c, p, code, season, L) {
  let s, cond;
  if (code != null && code >= 95 && code <= 99) { s = 0; cond = L.skyThunder; }
  else if (code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86)) { s = 40; cond = L.skySnow; }
  else {
    const row = SKY_TABLE[season];
    p = p || 0;
    if (p >= 0.1) {
      if (p < 2.5) { s = row[3]; cond = L.skyLight(p); }
      else if (p < 8) { s = row[4]; cond = L.skyMod(p); }
      else { s = row[5]; cond = L.skyHeavy(p); }
    } else {
      c = c ?? 50;
      if (c < 30) { s = row[0]; cond = L.skyClear; }
      else if (c < 70) { s = row[1]; cond = L.skyPartly; }
      else { s = row[2]; cond = L.skyOvercast; }
    }
  }
  return { s: clamp(s), reason: L.sky(cond, season, s) };
}

// sr/ss 取「该小时所在日历日」的日出日落；majors/minors 取该日及前后各一天的月亮事件（跨午夜也算上）。
// 午间取半开区间 [11:00, 15:00)。这三处 model.md 没写死，按 Python 基准实现对齐。
function sTime(t, day, season, L) {
  const { sr, ss, majors, minors } = day;
  let s, slot;
  const tod = ((t % 1440) + 1440) % 1440;
  if (sr != null && t >= sr - 60 && t <= sr + 120) { s = 100; slot = L.time.dawn; }
  else if (ss != null && t >= ss - 120 && t <= ss + 60) { s = 100; slot = L.time.dusk; }
  else if (tod >= 660 && tod < 900) { s = season === 'hot' ? 30 : season === 'mild' ? 70 : 100; slot = L.time.noon[season]; }
  else if ((ss != null && t > ss + 60) || (sr != null && t < sr - 60)) { s = season === 'hot' ? 75 : season === 'mild' ? 45 : 20; slot = L.time.night[season]; }
  else { s = 70; slot = L.time.day; }
  let bonus = 0, extra = '';
  if (majors.some((m) => Math.abs(t - m) <= 60)) { bonus = 15; extra = L.major; }
  else if (minors.some((m) => Math.abs(t - m) <= 30)) { bonus = 8; extra = L.minor; }
  return { s: clamp(Math.min(100, s + bonus)), reason: slot + extra };
}

function sMoon(realMs, t, tide, range, current, period, L) {
  const a = moonIllumination(realMs).phase * 29.53;
  const d = Math.min(a, Math.abs(a - 14.77), 29.53 - a);
  const ms = d <= 2 ? 100 : d <= 4 ? 75 : 55;
  let reason = L.moon(a, d);
  if (!tide || !tide.length) return { s: ms, reason };
  // 潮分：距最近极值 ≤30 min 平潮 60；极值后 30 min–2.5 h 100；其余 75
  let T = 75, nearest = Infinity, lastBefore = null;
  for (const { t: x } of tide) {
    nearest = Math.min(nearest, Math.abs(t - x));
    if (x <= t && (lastBefore == null || x > lastBefore)) lastBefore = x;
  }
  if (nearest <= 30) { T = 60; reason += L.tide.slack; }
  else if (lastBefore != null && t - lastBefore > 30 && t - lastBefore <= 150) { T = 100; reason += L.tide.run; }
  else reason += L.tide.mid;
  // v0.4：潮差/流速/浪周期折进潮分，不新增权重；缺数据时保持原 T
  const rs = rangeScore(range), cs = currentScore(current), ps = periodScore(period);
  const comps = [[T, 0.4]];
  if (rs != null) comps.push([rs, 0.2]);
  if (cs != null) comps.push([cs, 0.2]);
  if (ps != null) comps.push([ps, 0.2]);
  if (comps.length > 1) {
    const tw = comps.reduce((a, [, w]) => a + w, 0);
    T = comps.reduce((a, [v, w]) => a + v * w, 0) / tw;
  }
  reason += L.tide.detail(range, current, period);
  return { s: clamp(0.5 * ms + 0.5 * T), reason };
}

function sGeo(water, season, v, rain48, wave, trend, L) {
  const G = L.geo;
  const trendReason = (rise, fall) => trend === 'rising' ? rise : trend === 'falling' ? fall : '';
  switch (water) {
    case 'river': {
      const flood = rain48 > 30;
      const s = flood ? 30 : clamp(80 + (trend === 'rising' ? 5 : trend === 'falling' ? -10 : 0));
      return { s, reason: (flood ? G.riverFlood(rain48) : G.river) + trendReason(G.riverRise, G.riverFall) };
    }
    case 'reservoir': {
      const base = season === 'hot' ? 80 : 75;
      const s = clamp(base + (trend === 'rising' ? 3 : trend === 'falling' ? -5 : 0));
      return { s, reason: (season === 'hot' ? G.reservoirHot : G.reservoir) + trendReason(G.reservoirRise, G.reservoirFall) };
    }
    case 'lake': return { s: 75, reason: G.lake };
    case 'pond': return season === 'hot' && v < 2 ? { s: 50, reason: G.pondHot } : { s: 80, reason: G.pond };
    case 'sea': return wave != null && wave >= 1.5 ? { s: 20, reason: G.seaRough(wave) } : { s: 80, reason: G.sea };
    default: return { s: 70, reason: G.unknown };
  }
}

const TIDE_MIN_RANGE = 0.10;
export const WEIGHTS = { temp: 25, pressure: 20, trend: 15, wind: 10, sky: 10, time: 10, moon: 5, geo: 5 };
const SUB_KEYS = Object.keys(WEIGHTS);

// ───────────────────────── 主函数 ─────────────────────────
/**
 * @param {object} o
 * @param {object} o.forecast   Open-Meteo forecast 原始响应（past_days=7, forecast_days=8）
 * @param {object} [o.marine]   Open-Meteo marine 原始响应，或 null
 * @param {object} [o.flood]    Open-Meteo flood 原始响应，或 null
 * @param {object} [o.oxygen]   城市平均实测溶解氧 { value, unit, count, time, source }；只作用于第一个显示日
 * @param {string} [o.species]  鱼种 key，默认 crucian
 * @param {string} [o.water]    reservoir|lake|river|pond|sea|unknown
 * @param {string} [o.waterSource] osm|user|default
 * @param {string} [o.name]     地名
 * @param {string} [o.lang]     zh（口径）| en
 * @param {string} [o.now]      当地今天 YYYY-MM-DD；15 天响应（7 past + 8 forecast）必须传，否则会从最后 N 天开始
 * @param {number} [o.days]     输出天数，默认 7；传了 now 就从 now 当天起取 N 天
 * @returns §8 结构（另附 sunrise/sunset/ice/alerts、hours[].flags 等界面用的附加字段）
 */
export function computeForecast(o) {
  const fc = o.forecast;
  if (!fc || !fc.hourly || !fc.daily) throw new Error('forecast 响应缺 hourly/daily');
  const lang = o.lang === 'en' ? 'en' : 'zh';
  const L = T[lang];
  const S = SAFETY[lang];
  const sp = SPECIES.find((x) => x.key === o.species) || SPECIES.find((x) => x.key === DEFAULT_SPECIES);
  const spName = lang === 'en' ? sp.en : sp.name;
  const water = WATER_TYPES.includes(o.water) ? o.water : 'unknown';
  const ox = o.oxygen && Number.isFinite(o.oxygen.value) ? o.oxygen : null;
  const offMs = (fc.utc_offset_seconds || 0) * 1000;
  const lat = fc.latitude, lon = fc.longitude;
  const H = fc.hourly;
  const n = H.time.length;
  const tMin = H.time.map(localMin);
  const t0 = tMin[0];
  const idxOf = (min) => {
    const i = Math.round((min - t0) / 60);
    return i >= 0 && i < n && tMin[i] === min ? i : -1;
  };
  const col = (k) => H[k] || [];
  const temp = col('temperature_2m'), pres = col('pressure_msl'), surf = col('surface_pressure'), cloud = col('cloud_cover'), prec = col('precipitation');
  const code = col('weather_code'), wind = col('wind_speed_10m'), wdir = col('wind_direction_10m'), gust = col('wind_gusts_10m');
  // v0.4：有 surface_pressure 就用站点气压，并按海拔平移绝对阈值；没有就退回 pressure_msl（旧口径）。
  const useSurf = surf.some((x) => x != null);
  const P = useSurf ? surf : pres;
  const pNorm = pressureNormal(fc.elevation);
  const pShift = useSurf ? Math.max(0, 1013.25 - pNorm) : 0;
  const pLow = 1000 - pShift, pHigh = 1030 - pShift, pHyp = 1005 - pShift;

  // 海况：按时间字符串对齐
  const hasMarine = marineAvailable(o.marine);
  const mar = {};
  if (hasMarine) {
    const mh = o.marine.hourly;
    mh.time.forEach((ts, j) => {
      mar[ts] = {
        wave: mh.wave_height?.[j], period: mh.wave_period?.[j], sst: mh.sea_surface_temperature?.[j],
        sl: mh.sea_level_height_msl?.[j], cur: mh.ocean_current_velocity?.[j],
      };
    });
  }
  const isSea = water === 'sea';
  // 潮汐极值（仅 sea 且 sea_level_height_msl 可用）：非空点按时间排好，取局部极值；
  // 相邻高低潮落差 < 0.10 m 视为数据毛刺成对剔除（model.md 没写，按 Python 基准 TIDE_MIN_RANGE 对齐）
  let tide = [];
  if (isSea && hasMarine) {
    const pts = Object.keys(mar).filter((k) => mar[k].sl != null).sort().map((k) => ({ t: localMin(k), v: mar[k].sl }));
    let ext = [];
    for (let j = 1; j < pts.length - 1; j++) {
      const a = pts[j - 1].v, b = pts[j].v, c = pts[j + 1].v;
      if (a < b && b >= c) ext.push({ t: pts[j].t, v: b, kind: 'high' });
      else if (a > b && b <= c) ext.push({ t: pts[j].t, v: b, kind: 'low' });
    }
    for (let changed = true; changed;) {
      changed = false;
      for (let k = 0; k < ext.length - 1; k++) {
        if (Math.abs(ext[k].v - ext[k + 1].v) < TIDE_MIN_RANGE) { ext.splice(k, 2); changed = true; break; }
      }
    }
    tide = ext;
  }

  // ── 逐日派生量（§2）──
  const D = fc.daily;
  const nd = D.time.length;
  const dayStart = D.time.map((d) => localMin(d));
  const Ta = dayStart.map((s) => {
    const i = idxOf(s);
    if (i < 0) return null;
    return mean(temp.slice(i, i + 24));
  });
  const WK = [0.35, 0.25, 0.18, 0.12, 0.10];
  const Wf = (di) => {
    let sw = 0, sv = 0;
    for (let k = 0; k < 5; k++) {
      const x = Ta[di - k];
      if (di - k < 0 || x == null) continue;
      sw += WK[k]; sv += WK[k] * x;
    }
    return sw ? Math.max(0.5, sv / sw) : null;
  };
  const sstMean = (date) => {
    if (!hasMarine) return null;
    const v = [];
    for (let h = 0; h < 24; h++) { const m = mar[`${date}T${pad(h)}:00`]; if (m && m.sst != null) v.push(m.sst); }
    return mean(v);
  };

  // 每个日历日的日出日落与月亮事件（小时按「自己所在的日历日」取，跨午夜的夜钓小时也对得上）
  const dIdx = new Map(D.time.map((d, i) => [d, i]));
  const dayOf = (min) => fmtISO(min).slice(0, 10);
  const toLocal = (ms) => (ms + offMs) / 60000;
  const moonCache = new Map();
  const moonEvents = (date) => {
    if (moonCache.has(date)) return moonCache.get(date);
    const ds = localMin(date);
    const realMidnight = ds * 60000 - offMs;
    // 上/下中天：当日每 10 分钟采样月亮高度，取最大/最小值时刻
    let maxAlt = -Infinity, minAlt = Infinity, maxK = 0, minK = 0;
    for (let k = 0; k < 144; k++) {
      const alt = moonAltitude(realMidnight + k * 600000, lat, lon);
      if (alt > maxAlt) { maxAlt = alt; maxK = k; }
      if (alt < minAlt) { minAlt = alt; minK = k; }
    }
    const mt = moonTimes(realMidnight, lat, lon);
    const ev = {
      majors: [ds + maxK * 10, ds + minK * 10],
      minors: [mt.rise, mt.set].filter((x) => x != null).map(toLocal),
      rise: mt.rise != null ? toLocal(mt.rise) : null, set: mt.set != null ? toLocal(mt.set) : null,
    };
    moonCache.set(date, ev);
    return ev;
  };
  const hourCtx = (t) => {
    const date = dayOf(t), di = dIdx.get(date);
    const ds = localMin(date);
    const around = [-1, 0, 1].map((k) => moonEvents(dayOf(ds + k * 1440)));
    return {
      sr: di != null && D.sunrise?.[di] ? localMin(D.sunrise[di]) : null,
      ss: di != null && D.sunset?.[di] ? localMin(D.sunset[di]) : null,
      majors: around.flatMap((e) => e.majors), minors: around.flatMap((e) => e.minors),
    };
  };

  // 输出哪几天：给了 now（当地时刻）就从 now 当天起取 N 天；否则取 daily 的最后 N 天（= forecast_days）
  const nWant = o.days || 7;
  let firstDi = Math.max(0, nd - nWant);
  if (o.now) { const k = D.time.findIndex((d) => d >= String(o.now).slice(0, 10)); if (k >= 0) firstDi = k; }
  const lastDi = Math.min(nd, firstDi + nWant);
  const out = {
    place: { name: o.name || '', lat, lon, elevation: fc.elevation ?? null, water, water_source: o.waterSource || (water === 'unknown' ? 'default' : 'user') },
    species: sp.key,
    model_version: MODEL_VERSION,
    timezone: fc.timezone || '',
    oxygen: ox ? { ...ox, applied_date: D.time[firstDi] || null } : null,
    days: [],
  };

  for (let di = firstDi; di < lastDi; di++) {
    const date = D.time[di];
    let W = Wf(di);
    if (isSea) { const sst = sstMean(date); if (sst != null) W = sst; }
    if (W == null) continue;
    // 结冰提示：W ≤ 2 且「前 5 天」（d−1..d−5，有几天算几天）最低气温全 < −5
    const mins = [];
    for (let k = 1; k <= 5; k++) if (di - k >= 0 && D.temperature_2m_min?.[di - k] != null) mins.push(D.temperature_2m_min[di - k]);
    const ice = W <= 2 && mins.length > 0 && mins.every((x) => x < -5);
    const season = W < 12 ? 'cold' : W <= 26 ? 'mild' : 'hot';
    const dT = Ta[di] != null && di > 0 && Ta[di - 1] != null ? Ta[di] - Ta[di - 1] : null;
    const ft = floodTrend(o.flood, date);
    const tideRange = isSea ? tideRangeForDay(mar, date) : null;
    const measuredOxygen = ox && di === firstDi ? ox : null;   // 实测值只覆盖第一个显示日

    const ds = dayStart[di];
    const me = moonEvents(date);
    const dayCtxOut = { moonrise: me.rise != null ? fmtHM(me.rise) : null, moonset: me.set != null ? fmtHM(me.set) : null, transit: fmtHM(me.majors[0]) };

    // 参与小时：04:00–22:00；hot 加 22:00–次日 02:00
    const endMin = season === 'hot' ? ds + 1440 + 120 : ds + 22 * 60;
    const idxs = [];
    for (let m = ds + 240; m <= endMin; m += 60) { const i = idxOf(m); if (i >= 0) idxs.push(i); }
    if (!idxs.length) continue;

    const hours = [];
    const safetyHits = {};
    for (const i of idxs) {
      const t = tMin[i];
      const v = wind[i];
      const ts = H.time[i];
      const m = mar[ts] || {};
      const wave = isSea ? (m.wave ?? null) : null;
      const r48 = prec.slice(Math.max(0, i - 47), i + 1).reduce((a, b) => a + (b || 0), 0);
      const sub = {}, why = {};
      const put = (k, r) => { sub[k] = r.s; why[k] = r.reason; };
      const st = sTemp(W, sp);
      put('temp', { s: st, reason: L.temp(W, spName, sp.opt_lo, sp.opt_hi, st, sp.tmin, sp.tmax) });
      put('pressure', sPressure(P[i], i >= 3 ? P[i - 3] : null, i >= 24 ? P[i - 24] : null, temp[i], wind[i], L, pLow, pHigh, pHyp));
      put('trend', sTrend(dT, season, L));
      put('wind', sWind(v, wdir[i], season, L, lang));
      put('sky', sSky(cloud[i], prec[i], code[i], season, L));
      put('time', sTime(t, hourCtx(t), season, L));
      put('moon', sMoon(t * 60000 - offMs, t, m.sl != null ? tide : null, tideRange, m.cur ?? null, m.period ?? null, L));
      put('geo', sGeo(water, season, v ?? 3.0, r48, wave, ft.trend, L));
      // §3.9 水温闸门：g = 0.5 + 0.5·S_temp/100；结冰且鲫鱼（冰钓）g ≥ 0.7。闸门在硬封顶之前，sub.temp 不受影响
      let g = 0.5 + 0.5 * sub.temp / 100;
      if (ice && sp.key === 'crucian') { g = Math.max(g, 0.7); why.temp += L.iceMode; }
      let h = 0;
      for (const k of SUB_KEYS) h += WEIGHTS[k] * sub[k] / 100;
      h *= g;
      // §4 硬封顶
      const flags = [];
      const c = code[i];
      if (c != null && c >= 95 && c <= 99) { h = Math.min(h, 10); flags.push('thunder'); }
      if ((gust[i] != null && gust[i] >= 13.9) || (v != null && v >= 10.8)) { h = Math.min(h, 20); flags.push('gale'); }
      if (isSea && wave != null && wave >= 2.5) { h = Math.min(h, 15); flags.push('wave'); }
      if (prec[i] != null && prec[i] >= 8) { h = Math.min(h, 35); flags.push('rain'); }
      if (temp[i] != null && temp[i] >= 35) flags.push('heat');
      const oxr = oxygenRisk({ water, season, wind: v, P: P[i], pNorm, t, ice });
      if (measuredOxygen) {
        if (measuredOxygen.value < 3) { h = Math.min(h, 45); flags.push('oxygen'); }
        else if (measuredOxygen.value < 5) flags.push('oxygenWarn');
      } else if (oxr.severe) { h = Math.min(h, 45); flags.push('oxygen'); }
      if (oxr.iceLow) flags.push('oxygenIce');
      for (const f of flags) (safetyHits[f] = safetyHits[f] || []).push(t);
      hours.push({ t: fmtISO(t), h, g, sub, why, flags });
    }

    // §6 三小时居中滑动平均（端点只用现有邻居）
    for (let j = 0; j < hours.length; j++) {
      const w = hours.slice(Math.max(0, j - 1), j + 2);
      hours[j].hs = w.reduce((a, b) => a + b.h, 0) / w.length;
    }
    // §6 日分 = round(0.6·最好 6 小时 Hs 均值 + 0.4·全部参与小时 Hs 均值)
    const top = hours.map((x) => x.hs).sort((a, b) => b - a).slice(0, 6);
    const aAll = hours.reduce((a, b) => a + b.hs, 0) / hours.length;
    let score = Math.round(0.6 * top.reduce((a, b) => a + b, 0) / top.length + 0.4 * aAll);
    // §6 危险封顶：雷暴 ≥3h 或（海边）浪 ≥2.5 m ≥3h → ≤45；否则雷暴 1–2h 或任一小时阵风 7 级 → ≤60
    const nHit = (k) => (safetyHits[k] || []).length;
    let dayCap = null;
    if (nHit('thunder') >= 3 || nHit('wave') >= 3) dayCap = 45;
    else if (nHit('thunder') >= 1 || nHit('gale') >= 1) dayCap = 60;
    const capKinds = dayCap == null ? [] : ['thunder', 'gale', 'wave'].filter((k) => nHit(k));
    if (dayCap != null && score > dayCap) score = dayCap;

    // 最佳时段：贪心取最高 Hs，窗口 = 中心 ±1h，屏蔽中心 ±2h，最多 3 段，< 35 不列
    const masked = new Array(hours.length).fill(false);
    const windows = [];
    while (windows.length < 3) {
      let best = -1;
      for (let j = 0; j < hours.length; j++) if (!masked[j] && (best < 0 || hours[j].hs > hours[best].hs)) best = j;
      if (best < 0 || hours[best].hs < 35) break;
      const c = localMin(hours[best].t);
      windows.push({ start: fmtHM(c - 60), end: fmtHM(c + 60), score: Math.round(hours[best].hs) });
      for (let j = 0; j < hours.length; j++) if (Math.abs(localMin(hours[j].t) - c) <= 120) masked[j] = true;
    }

    // sub / reasons：取当日「最高分那一小时」——按平滑分 Hs 取最大、并列取最早（model.md 没说用 H 还是 Hs，按 Python 基准）
    let bi = 0;
    for (let j = 1; j < hours.length; j++) if (hours[j].hs > hours[bi].hs) bi = j;
    const bh = hours[bi];
    const sub = {};
    for (const k of SUB_KEYS) sub[k] = Math.round(bh.sub[k]);
    const reasons = SUB_KEYS.map((k) => bh.why[k]);

    // §7 建议
    const advice = [];
    advice.push(W < 10 ? L.layer.cold : W < 18 ? L.layer.cool : W <= 26 ? L.layer.mild : L.layer.hot);
    const bIdx = idxs[bi];
    const bv = wind[bIdx], bdir = wdir[bIdx];
    // 风速 < 0.5 或缺数据：不给钓位句（impl-notes §7）
    if (bv != null && bdir != null && bv >= 0.5) {
      if (season === 'cold' && isNorth(bdir)) advice.push(L.spotColdNorth);
      else if (bv < 5.5) advice.push(L.spot(dirName(bdir, lang), dirName(bdir + 180, lang)));
      else advice.push(L.spotStrong);
    }
    const band = W < 12 ? 'cold' : W <= 22 ? 'mid' : 'warm';
    advice.push(sp.lure ? L.lure[band] : L.bait[band]);
    const dayTides = tide.filter((x) => x.t >= ds && x.t < ds + 1440).map((x) => ({ t: fmtHM(x.t), kind: x.kind, level: x.v }));
    if (water === 'sea') advice.push(dayTides.length ? L.tides(dayTides) : L.noTides);
    else if (water !== 'unknown') advice.push(L.water[water]);
    advice.push(seasonalAdvice(date, sp, L));

    // 安全提示（§4）：每类一天一条；连续命中的小时合成「09:00–11:00」，不连续的用顿号分开「09:00、18:00」；结冰整天一条
    const order = ['thunder', 'gale', 'wave', 'rain', 'heat', 'oxygen', 'oxygenWarn', 'oxygenIce'];
    const alerts = order.filter((k) => safetyHits[k]).map((k) => {
      const ts = safetyHits[k];
      const runs = [[ts[0], ts[0]]];
      for (const t of ts.slice(1)) { if (t - runs[runs.length - 1][1] <= 60) runs[runs.length - 1][1] = t; else runs.push([t, t]); }
      const span = runs.map(([a, b]) => (a === b ? fmtHM(a) : `${fmtHM(a)}–${fmtHM(b)}`)).join(L.listSep);
      return { key: k, text: S[k], hours: ts.map(fmtHM), line: `${span} ${S[k]}` };
    });
    if (ice) alerts.push({ key: 'ice', text: S.ice, hours: [], line: S.ice });

    const li = levelIndex(score);
    let levelText = LEVEL_TEXT[lang][li];
    if (dayCap != null) levelText += (lang === 'en' ? '; ' : '；') + capText(lang, capKinds.map((k) => DANGER_WORDS[lang][k]));
    out.days.push({
      date, score, level: LEVELS[lang][li], level_index: li, level_text: levelText, day_cap: dayCap, cap_kinds: capKinds,
      water_temp: round1(W), season,
      windows, sub, reasons, advice,
      safety: alerts.map((a) => a.line),
      alerts, ice,
      air_mean: Ta[di] != null ? round1(Ta[di]) : null,
      air_max: D.temperature_2m_max?.[di] ?? null, air_min: D.temperature_2m_min?.[di] ?? null,
      precip: D.precipitation_sum?.[di] ?? null,
      sunrise: D.sunrise?.[di] ? fmtHM(localMin(D.sunrise[di])) : null, sunset: D.sunset?.[di] ? fmtHM(localMin(D.sunset[di])) : null, ...dayCtxOut,
      best_hour: bh.t,
      gate: Math.round(bh.g * 100) / 100,
      tides: dayTides,
      discharge_trend: ft.trend,
      river_discharge: ft.q,
      tide_range: tideRange,
      oxygen_risk: hours.some((x) => x.flags.includes('oxygen')),
      oxygen_warn: hours.some((x) => x.flags.includes('oxygenWarn')),
      hours: hours.map((x) => ({ t: x.t, h: round1(x.h), hs: round1(x.hs), flags: x.flags })),
    });
  }
  return out;
}
