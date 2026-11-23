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
  assert(/fetch\('\/data\/oxygen\.json'/.test(app), 'app.js 没有加载 /data/oxygen.json');
  assert(/oxygen:\s*currentOxygen\(\)/.test(app), 'app.js 没有把城市平均溶氧传给 computeForecast');
  assert(/S\.city\s*=\s*city/.test(app), 'app.js 没有从反向地名设置 S.city');
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

// ── v0.4：城市平均实测溶氧覆盖今日代理 ──
test('实测城市平均溶氧 <3 覆盖今日代理并封顶', () => {
  const out = engine.computeForecast({
    forecast: makeWeather({ base: 30, amp: 1, wind: 2.5, surfacePressure: 1015, pressure: 1015 }),
    species: 'crucian', water: 'pond', now: '2026-11-23', days: 7,
    oxygen: { value: 2.5, unit: 'mg/L', count: 4, time: '11-23 16:00', source: 'national-city-average' },
  });
  assert(out.oxygen && out.oxygen.value === 2.5, 'out.oxygen 缺失');
  assert(out.days[0].oxygen_risk === true, '第一日未触发 oxygen');
  assert(out.days[0].alerts.some((a) => a.key === 'oxygen'), '第一日缺 oxygen 警报');
  assert(out.days[0].hours.every((h) => h.h <= 45), '第一日未封顶 45');
  assert(out.days[1].oxygen_risk !== true, '第二日不应使用第一日实测值');
});

test('实测溶氧 3–5 触发 warning 但不封顶', () => {
  const out = engine.computeForecast({
    forecast: makeWeather({ base: 30, amp: 1, wind: 2.5, surfacePressure: 1015, pressure: 1015 }),
    species: 'crucian', water: 'pond', now: '2026-11-23', days: 7,
    oxygen: { value: 4.0, unit: 'mg/L', count: 4, time: '11-23 16:00', source: 'national-city-average' },
  });
  assert(out.days[0].oxygen_warn === true, '未触发 oxygen_warn');
  assert(out.days[0].oxygen_risk !== true, '4.0 不应触发 severe');
  assert(out.days[0].alerts.some((a) => a.key === 'oxygenWarn'), '缺 oxygenWarn 警报');
});

test('实测溶氧 >=5 不触发低氧 flag', () => {
  const out = engine.computeForecast({
    forecast: makeWeather({ base: 30, amp: 1, wind: 2.5, surfacePressure: 1015, pressure: 1015 }),
    species: 'crucian', water: 'pond', now: '2026-11-23', days: 7,
    oxygen: { value: 6.0, unit: 'mg/L', count: 4, time: '11-23 16:00', source: 'national-city-average' },
  });
  assert(out.oxygen && out.oxygen.value === 6, 'out.oxygen 缺失');
  assert(out.days[0].oxygen_risk !== true && out.days[0].oxygen_warn !== true, '6.0 不应触发低氧提示');
});

// ── 方案 3：鳊鱼 + 台钓建议 + 鹰潭专用模式接线 ──
test('鳊鱼鱼种和台钓粉饵/虾建议', () => {
  assert(engine.SPECIES.some((s) => s.key === 'bream'), '缺少鳊鱼鱼种');
  const out = engine.computeForecast({ forecast: makeWeather({ base: 22 }), species: 'bream', water: 'river', now: '2026-11-23', days: 7, style: 'taiwan' });
  assert(out.species === 'bream', `species=${out.species}`);
  assert(out.days[0].advice.some((a) => a.includes('台钓')), out.days[0].advice.join(' | '));
  const predator = engine.computeForecast({ forecast: makeWeather({ base: 22 }), species: 'culter', water: 'river', now: '2026-11-23', days: 7, style: 'taiwan' });
  assert(predator.days[0].advice.some((a) => a.includes('虾')), predator.days[0].advice.join(' | '));
  const bass = engine.computeForecast({ forecast: makeWeather({ base: 22 }), species: 'bass', water: 'river', now: '2026-11-23', days: 7, style: 'taiwan' });
  assert(bass.days[0].advice.some((a) => a.includes('虾肉/虾饵')), bass.days[0].advice.join(' | '));
});

test('app.js 鹰潭专用模式：默认点、边界、台钓、四种鱼主钓排行', () => {
  const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
  assert(/const YINGTAN_ONLY = true/.test(app), '未开启鹰潭专用模式');
  assert(/const DEFAULT_POINT = \{ lat: 28\.26, lon: 117\.03/.test(app), '缺默认点');
  assert(/const TARGET_SPECIES = \['crucian', 'bream', 'culter', 'mandarin'\]/.test(app), '四种目标鱼列表不对');
  assert(!/S\.sp\b/.test(app), '不应再有单鱼种状态 S.sp');
  assert(!/sp-row/.test(app), '不应再有鱼种勾选控件');
  assert(!/q\.set\('sp'/.test(app), 'URL 不应再写 sp');
  assert(/import \{ bestByDate, mergeAlerts, dayFlagKeys, allOptimal \} from '\.\/rank\.js'/.test(app), '未引入排行模块');
  assert(/S\.outs/.test(app) && /S\.days/.test(app) && /S\.alerts/.test(app), '缺少多鱼种合并状态');
  assert(/\$\('d-best'\)/.test(app) && /\$\('d-rank'\)/.test(app) && /\$\('d-focus'\)/.test(app), '缺少主钓/排行/查看元素');
  assert(/S\.focus/.test(app), '缺少查看鱼种状态');
  assert(/dayFlagKeys/.test(app) && /best-flag/.test(app) && /rank-flag/.test(app), '主钓/排行没有封顶/低氧标记');
  assert(/allOptimal/.test(app) && /tempWhy/.test(app) && /水温闸门/.test(app), '缺少水温排序说明');
  assert(/summarizeDay/.test(app) && /\$\('d-weather'\)/.test(app), '缺少日期天气带');
  assert(/renderWeather/.test(app), '缺少天气渲染');
  assert(/TXT\.wxPlace/.test(app), '缺少天气地点文案');
  assert(/\$\('notes-open'\)/.test(app) && /showModal/.test(app), '缺少出钓指数说明弹窗');
  assert(/\$\('notes-close'\)/.test(app), '缺少说明弹窗关闭');
  assert(/renderFullPage/.test(app) && /html2canvas/.test(app), '缺少整页截图');
  assert(/windowWidth: 1080/.test(app), '整页截图宽度不对');
  assert(/\$\('shot-link'\)/.test(app), '缺少截图按钮事件');
  assert(/shotSaved/.test(app) && /shotCanceled/.test(app), '缺少截图状态文案');
  assert(/insideYingtan/.test(app), '缺鹰潭边界校验');
  assert(/style: YINGTAN_ONLY \? 'taiwan'/.test(app), '未传台钓 style');
  assert(/S\.out\.weights \|\| WEIGHTS/.test(app), '详情没有使用当前水域权重');
  assert(/S\.wUser = 'river'/.test(app), '默认水域没有设为河流');
  assert(/model: '0\.5'/.test(app), '没有计算旧模型对比');
  assert(/S\.out\.shadow/.test(app), '没有附带影子数据');
  assert(/\$\('d-shadow'\)/.test(app), '详情没有影子分展示');
});

// ── v0.5：水域类型作为上下文，切换八项权重 ──
test('水域权重表每类合计 100 且河流/水库/池塘有区别', () => {
  for (const [w, ws] of Object.entries(engine.WATER_WEIGHTS)) {
    const sum = Object.values(ws).reduce((a, b) => a + b, 0);
    assert(sum === 100, `${w} 权重合计 ${sum}`);
  }
  assert(engine.WATER_WEIGHTS.river.wind < engine.WATER_WEIGHTS.reservoir.wind, '河流风权重应低于水库');
  assert(engine.WATER_WEIGHTS.pond.pressure > engine.WATER_WEIGHTS.unknown.pressure, '池塘气压权重应高于默认');
});

test('v0.5 旧模型输出当前水域权重', () => {
  const river = engine.computeForecast({ forecast: makeWeather(), species: 'crucian', water: 'river', now: '2026-11-23', days: 7, model: '0.5' });
  assert(river.weights.wind === 6 && river.weights.geo === 11, `river ${JSON.stringify(river.weights)}`);
  const pond = engine.computeForecast({ forecast: makeWeather(), species: 'crucian', water: 'pond', now: '2026-11-23', days: 7, model: '0.5' });
  assert(pond.weights.pressure === 22 && pond.weights.wind === 12, `pond ${JSON.stringify(pond.weights)}`);
  assert(Object.values(pond.weights).reduce((a, b) => a + b, 0) === 100, 'pond 权重合计不是 100');
});

test('v0.6 影子模型独立输出，不替换 v0.5', () => {
  const fc = makeWeather();
  const v5 = engine.computeForecast({ forecast: fc, species: 'crucian', water: 'river', now: '2026-11-23', days: 7, model: '0.5' });
  const v6 = engine.computeForecast({ forecast: fc, species: 'crucian', water: 'river', now: '2026-11-23', days: 7, model: '0.6' });
  assert(v5.model_version === '0.5', `v5=${v5.model_version}`);
  assert(v6.model_version === '0.6-shadow', `v6=${v6.model_version}`);
  assert(v6.weights.time === 14 && v6.weights.pressure === 15 && v6.weights.moon === 3 && v6.weights.geo === 14, `v6 weights=${JSON.stringify(v6.weights)}`);
  for (const [w, ws] of Object.entries(engine.SHADOW_WEIGHTS)) {
    assert(Object.values(ws).reduce((a, b) => a + b, 0) === 100, `${w} 影子权重合计不是 100`);
  }
  assert(v5.days.length === 7 && v6.days.length === 7, `days ${v5.days.length}/${v6.days.length}`);
  assert(Number.isFinite(v6.days[0].score), `v6 score=${v6.days[0].score}`);
});

test('v0.7 线上鱼种权重与 v0.5 对比', () => {
  for (const [key, ws] of Object.entries(engine.SPECIES_WEIGHTS)) {
    assert(Object.values(ws).reduce((a, b) => a + b, 0) === 100, `${key} 权重合计不是 100`);
  }
  const v7 = engine.computeForecast({ forecast: makeWeather(), species: 'crucian', water: 'river', now: '2026-11-23', days: 7 });
  assert(v7.model_version === '0.7', `v7=${v7.model_version}`);
  assert(JSON.stringify(v7.weights) === JSON.stringify(engine.SPECIES_WEIGHTS.crucian), `v7 weights=${JSON.stringify(v7.weights)}`);
  assert(typeof v7.days[0].best_why?.time === 'string' && v7.days[0].best_why.time.length > 0, '缺少最佳小时理由');
  const legacy = engine.computeForecast({ forecast: makeWeather(), species: 'crucian', water: 'river', now: '2026-11-23', days: 7, model: '0.5' });
  assert(legacy.model_version === '0.5', `legacy=${legacy.model_version}`);
});

console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
