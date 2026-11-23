// 引擎回归测试：用合成 Open-Meteo 响应跑 computeForecast，并检查网页端的关键接线。
// 这是仓库内可重复运行的引擎测试；Python 基准对齐仍用 check-fixtures.mjs（需要外部 fixtures）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as engine from '../web/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── 合成 15 天 Open-Meteo 响应（7 天 past + 8 天 forecast）──
const pad = (n) => String(n).padStart(2, '0');
const NDAYS = 15;
const START = Date.UTC(2026, 10, 16); // 2026-11-16
const dateRange = (start = START, ndays = NDAYS) => Array.from({ length: ndays }, (_, d) => {
  const x = new Date(start + d * 86400000);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
});

function makeWeather({ base = 30, amp = 2, cloud = 30, wind = 2, precip = 0, code = 3, start = START, ndays = NDAYS, elevation = 5, surfacePressure = null, pressure = 1015 } = {}) {
  const dates = dateRange(start, ndays);
  const time = [], temperature_2m = [], pressure_msl = [], surface_pressure = [], cloud_cover = [], precipitation = [],
    precipitation_probability = [], weather_code = [], wind_speed_10m = [], wind_direction_10m = [], wind_gusts_10m = [];
  for (let d = 0; d < ndays; d++) for (let h = 0; h < 24; h++) {
    time.push(`${dates[d]}T${pad(h)}:00`);
    temperature_2m.push(base + amp * Math.sin(((h - 9) / 24) * 2 * Math.PI));
    pressure_msl.push(pressure);
    surface_pressure.push(surfacePressure ?? pressure);
    cloud_cover.push(cloud);
    precipitation.push(precip);
    precipitation_probability.push(10);
    weather_code.push(code);
    wind_speed_10m.push(wind);
    wind_direction_10m.push(180);
    wind_gusts_10m.push(6);
  }
  return {
    latitude: 31.2, longitude: 121.5, elevation, timezone: 'Asia/Shanghai', utc_offset_seconds: 28800,
    hourly: { time, temperature_2m, pressure_msl, surface_pressure, cloud_cover, precipitation, precipitation_probability, weather_code, wind_speed_10m, wind_direction_10m, wind_gusts_10m },
    daily: {
      time: dates,
      sunrise: dates.map((d) => `${d}T06:30`), sunset: dates.map((d) => `${d}T17:30`),
      temperature_2m_max: dates.map(() => base + amp + 2), temperature_2m_min: dates.map(() => base - amp),
      precipitation_sum: dates.map(() => 0),
    },
  };
}

function makeMarine({ wave = 0.8, sst = 19, current = 0.5, period = 8, start = START, ndays = NDAYS } = {}) {
  const dates = dateRange(start, ndays);
  const time = [], wave_height = [], wave_period = [], sea_surface_temperature = [], sea_level_height_msl = [],
    ocean_current_velocity = [], ocean_current_direction = [];
  for (let d = 0; d < ndays; d++) for (let h = 0; h < 24; h++) {
    time.push(`${dates[d]}T${pad(h)}:00`);
    wave_height.push(wave); wave_period.push(period); sea_surface_temperature.push(sst);
    sea_level_height_msl.push(1.2 + 0.8 * Math.sin((h / 12) * 2 * Math.PI));
    ocean_current_velocity.push(current); ocean_current_direction.push(90);
  }
  return { hourly: { time, wave_height, wave_period, sea_surface_temperature, sea_level_height_msl, ocean_current_velocity, ocean_current_direction } };
}

function makeFlood({ values = null, start = START, ndays = NDAYS } = {}) {
  const dates = dateRange(start, ndays);
  return { daily: { time: dates, river_discharge: values || dates.map(() => 10) } };
}

// ── URL：热季最后一天需要次日 00–02 点 ──
test('forecastUrl 请求 8 个预报日', () => {
  const url = engine.forecastUrl(31.2, 120.2);
  assert(/[?&]forecast_days=8(?:&|$)/.test(url), `实际：${url}`);
});
test('marineUrl 请求 8 个预报日', () => {
  const url = engine.marineUrl(31.2, 120.2);
  assert(/[?&]forecast_days=8(?:&|$)/.test(url), `实际：${url}`);
});
test('数据源包含 surface_pressure / 浪周期 / 海流 / 径流', () => {
  assert(/surface_pressure/.test(engine.forecastUrl(31.2, 120.2)), 'forecastUrl 缺 surface_pressure');
  const m = engine.marineUrl(31.2, 120.2);
  assert(/wave_period/.test(m) && /ocean_current_velocity/.test(m), `marineUrl 缺浪周期/海流：${m}`);
  assert(/river_discharge/.test(engine.floodUrl(31.2, 120.2)), 'floodUrl 缺 river_discharge');
});

// ── 本地日期：按接口时区算“今天”，不能依赖浏览器本地日期 ──
test('localToday 按 utc_offset_seconds 换算本地日期', () => {
  assert(typeof engine.localToday === 'function', 'engine.localToday 未导出');
  assert(engine.localToday({ utc_offset_seconds: 28800 }, Date.UTC(2026, 10, 23, 16, 30)) === '2026-11-24', 'UTC 16:30 +8 应是 11-24');
  assert(engine.localToday({ utc_offset_seconds: 0 }, Date.UTC(2026, 10, 23, 16, 30)) === '2026-11-23', 'UTC+0 应是 11-23');
});

// ── 网页接线：取到 forecast 时冻结“今天”，避免跨午夜重算时窗口整体后移 ──
test('app.js 在取到 forecast 时冻结 localToday', () => {
  const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
  assert(/import\s*\{[^}]*localToday[^}]*\}\s*from\s*'\.\/engine\.js'/.test(app), 'app.js 没有从 engine.js 导入 localToday');
  assert(/S\.today\s*=\s*localToday\(/.test(app), 'app.js 没有在取到 forecast 时设置 S.today = localToday(fc)');
  assert(/now:\s*S\.today/.test(app), 'app.js 没有给 computeForecast 传 now: S.today');
});

// ── check-fixtures：15 天 fixture 无 input.now 时，应从 expected 首日推导锚点 ──
test('check-fixtures 从 expected 首日推导 now（15 天 fixture）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-fx-'));
  try {
    const forecast = makeWeather();
    const expected = engine.computeForecast({ forecast, marine: null, species: 'tilapia', water: 'lake', now: '2026-11-23', days: 7 });
    fs.writeFileSync(path.join(dir, 'probe.json'), JSON.stringify({ input: { species: 'tilapia', water: 'lake' }, forecast, marine: null }));
    fs.writeFileSync(path.join(dir, 'probe.expected.json'), JSON.stringify(expected));
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-fixtures.mjs'), dir], { encoding: 'utf8' });
    assert(/全部 1 份样例对齐/.test(out), out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 行为：15 天响应 + now 时，热季最后一天应有 23 个参与小时（04–23 + 次日 00–02）──
test('热季最后一天在 15 天响应下有 23 个参与小时', () => {
  const out = engine.computeForecast({
    forecast: makeWeather(), species: 'tilapia', water: 'lake', waterSource: 'osm',
    name: '热湖', now: '2026-11-23', days: 7,
  });
  assert(out.days.length === 7, `days=${out.days.length}`);
  assert(out.days[0].date === '2026-11-23', `首日=${out.days[0].date}`);
  const last = out.days[6];
  assert(last.date === '2026-11-29', `末日=${last.date}`);
  assert(last.season === 'hot', `末日季节=${last.season}`);
  assert(last.hours.length === 23, `末日小时数=${last.hours.length}`);
  const times = last.hours.map((h) => h.t.slice(11));
  assert(times.includes('00:00') && times.includes('01:00') && times.includes('02:00'), `末日小时=${times.join(',')}`);
});

// ── v0.4：海拔/站点气压 ──
test('高海拔用 surface_pressure 并按海拔平移阈值', () => {
  const out = engine.computeForecast({ forecast: makeWeather({ elevation: 2000, surfacePressure: 795 }), species: 'crucian', water: 'lake', now: '2026-11-23', days: 7 });
  const d = out.days[0];
  assert(d.sub.pressure === 100, `pressure=${d.sub.pressure}`);
  assert(d.reasons.some((r) => r.includes('795')), d.reasons.join(' | '));
});

// ── v0.4：河道径流趋势 ──
test('径流上涨/下降折进河道水域分', () => {
  const rising = Array.from({ length: NDAYS }, (_, i) => i === 7 ? 13 : 10);
  const up = engine.computeForecast({ forecast: makeWeather(), flood: makeFlood({ values: rising }), species: 'carp', water: 'river', now: '2026-11-23', days: 7 });
  assert(up.days[0].sub.geo === 85, `rising geo=${up.days[0].sub.geo}`);
  assert(up.days[0].reasons.some((r) => r.includes('流量在涨')), up.days[0].reasons.join(' | '));
  const falling = Array.from({ length: NDAYS }, (_, i) => i === 7 ? 7 : 10);
  const down = engine.computeForecast({ forecast: makeWeather(), flood: makeFlood({ values: falling }), species: 'carp', water: 'river', now: '2026-11-23', days: 7 });
  assert(down.days[0].sub.geo === 70, `falling geo=${down.days[0].sub.geo}`);
  assert(down.days[0].reasons.some((r) => r.includes('流量在退')), down.days[0].reasons.join(' | '));
});

// ── v0.4：潮差/流速/浪周期 ──
test('潮差/流速/浪周期折进海钓潮分', () => {
  const out = engine.computeForecast({ forecast: makeWeather({ base: 22 }), marine: makeMarine({ sst: 22, current: 0.5, period: 8 }), species: 'seabass', water: 'sea', now: '2026-11-23', days: 7 });
  const d = out.days[0];
  assert(d.tide_range != null, 'tide_range 缺失');
  assert(d.reasons.some((r) => r.includes('潮差') && r.includes('流速') && r.includes('浪周期')), d.reasons.join(' | '));
});

// ── v0.4：低氧风险 flag（不新增权重）──
test('高温低压无风的池塘触发低氧 flag 并封顶 45', () => {
  const out = engine.computeForecast({ forecast: makeWeather({ base: 30, amp: 1, wind: 0.5, surfacePressure: 1004, pressure: 1013 }), species: 'crucian', water: 'pond', now: '2026-11-23', days: 7 });
  const d = out.days[0];
  assert(d.oxygen_risk === true, 'oxygen_risk 未触发');
  assert(d.hours.some((h) => h.flags.includes('oxygen')), 'hours 缺 oxygen flag');
  assert(d.alerts.some((a) => a.key === 'oxygen'), 'alerts 缺 oxygen');
  assert(d.hours.filter((h) => h.flags.includes('oxygen')).every((h) => h.h <= 45), 'oxygen 小时未封顶 45');
});

// ── v0.4：季节/产卵建议（不进分数）──
test('季节建议覆盖春季、黑鱼护崽和冬季', () => {
  const spring = engine.computeForecast({ forecast: makeWeather({ start: Date.UTC(2026, 3, 1), base: 18 }), species: 'crucian', water: 'lake', now: '2026-04-08', days: 7 });
  assert(spring.days[0].advice.some((a) => a.includes('春季')), spring.days[0].advice.join(' | '));
  const summer = engine.computeForecast({ forecast: makeWeather({ start: Date.UTC(2026, 6, 1), base: 30 }), species: 'snakehead', water: 'lake', now: '2026-07-08', days: 7 });
  assert(summer.days[0].advice.some((a) => a.includes('护崽')), summer.days[0].advice.join(' | '));
  const winter = engine.computeForecast({ forecast: makeWeather({ start: Date.UTC(2026, 0, 1), base: 5 }), species: 'crucian', water: 'lake', now: '2026-01-08', days: 7 });
  assert(winter.days[0].advice.some((a) => a.includes('冬季')), winter.days[0].advice.join(' | '));
});

console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
