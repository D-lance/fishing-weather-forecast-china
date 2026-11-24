import assert from 'node:assert/strict';
import { summarizeDay, mergeForecast } from '../web/weather.js';

const date = '2026-11-23';
const time = Array.from({ length: 13 }, (_, i) => `${date}T${String(6 + i).padStart(2, '0')}:00`);
const fc = {
  daily: { time: [date], temperature_2m_max: [18], temperature_2m_min: [12] },
  hourly: {
    time,
    weather_code: time.map((_, i) => (i === 9 ? 95 : 0)),          // 15:00 雷雨
    temperature_2m: time.map((_, i) => 12 + (i / 12) * 6),
    wind_speed_10m: time.map((_, i) => (i === 8 ? 7 : 2)),         // 14:00 最大风
    wind_direction_10m: time.map((_, i) => (i === 8 ? 90 : 0)),    // 东风
    precipitation_probability: time.map((_, i) => (i === 10 ? 40 : 10)),
    relative_humidity_2m: time.map(() => 70),
  },
};
const w = summarizeDay(fc, date);
assert.equal(w.kind, 'thunder');
assert.equal(w.tempMax, 18);
assert.equal(w.tempMin, 12);
assert.equal(w.windSpeed, 7);
assert.equal(w.windDir, 2);
assert.equal(w.windLevel, 4);
assert.equal(w.rainProb, 40);
assert.equal(w.humidity, 70);

// 没有白天小时时退回当天全部小时
const night = {
  daily: { time: [date], temperature_2m_max: [16], temperature_2m_min: [10] },
  hourly: {
    time: [`${date}T20:00`], weather_code: [0], temperature_2m: [14],
    wind_speed_10m: [3], wind_direction_10m: [180], precipitation_probability: [0], relative_humidity_2m: [80],
  },
};
assert.equal(summarizeDay(night, date).kind, 'clear');

// daily 缺失时用小时温度兜底
const noDaily = { hourly: { time: [`${date}T12:00`], temperature_2m: [14] } };
const n = summarizeDay(noDaily, date);
assert.equal(n.tempMax, 14);
assert.equal(n.tempMin, 14);

// 缺字段返回 null，不是整条消失
const missing = { hourly: { time: [`${date}T12:00`] } };
const m = summarizeDay(missing, date);
assert.equal(m.kind, 'unknown');
assert.equal(m.tempMax, null);
assert.equal(m.rainProb, null);
assert.equal(m.humidity, null);
assert.equal(summarizeDay(fc, '2026-11-24'), null);

// 今天有 current 时优先显示实况，不再用白天最差天气
const withCurrent = {
  ...fc,
  current: {
    time: `${date}T13:15`, weather_code: 2, temperature_2m: 15.9,
    relative_humidity_2m: 49, wind_speed_10m: 5.32, wind_direction_10m: 28,
  },
};
const cw = summarizeDay(withCurrent, date);
assert.equal(cw.now, true);
assert.equal(cw.kind, 'partlyCloudy');
assert.equal(cw.temp, 15.9);
assert.equal(cw.humidity, 49);
assert.equal(cw.windSpeed, 5.32);

// 未来天不能因为一个小时阴就把整天显示成阴；降水/雷暴仍取最严重
const cloudOnly = {
  daily: { time: [date], temperature_2m_max: [18], temperature_2m_min: [12] },
  hourly: {
    time,
    weather_code: time.map((_, i) => (i === 0 ? 3 : 0)),
    temperature_2m: time.map(() => 15),
    wind_speed_10m: time.map(() => 2),
    wind_direction_10m: time.map(() => 90),
    precipitation_probability: time.map(() => 0),
    relative_humidity_2m: time.map(() => 60),
  },
};
assert.equal(summarizeDay(cloudOnly, date).kind, 'clear');

// 主源优先；主源 null 的字段/小时/天由回退源补齐
const primary = {
  latitude: 28.26, longitude: 117.03, elevation: 50, timezone: 'Asia/Shanghai', utc_offset_seconds: 28800,
  current: {
    time: `${date}T13:15`, temperature_2m: 15.9, weather_code: 2, cloud_cover: 75,
    relative_humidity_2m: 49, wind_speed_10m: 5.32, wind_direction_10m: 28,
  },
  hourly: {
    time: [`${date}T12:00`, `${date}T13:00`, `${date}T14:00`],
    temperature_2m: [15.8, 15.9, null],
    precipitation_probability: [null, null, null],
    weather_code: [2, 2, null],
    surface_pressure: [null, 1005, null],
    wind_gusts_10m: [null, null, null],
  },
  daily: {
    time: [date, '2026-11-24'],
    temperature_2m_max: [16, null], temperature_2m_min: [8, null],
    precipitation_sum: [0, null], sunrise: [`${date}T06:40`, null],
  },
};
const fallback = {
  latitude: 28.26, longitude: 117.03, elevation: 51, timezone: 'Asia/Shanghai', utc_offset_seconds: 28800,
  current: {
    time: `${date}T13:15`, temperature_2m: 17.4, weather_code: 3, cloud_cover: 99,
    relative_humidity_2m: 32, wind_speed_10m: 4, wind_direction_10m: 20,
  },
  hourly: {
    time: [`${date}T12:00`, `${date}T13:00`, `${date}T14:00`],
    temperature_2m: [17.3, 17.4, 17.5],
    precipitation_probability: [10, 20, 30],
    weather_code: [3, 3, 3],
    surface_pressure: [1008, 1008, 1008],
    wind_gusts_10m: [8, 8, 9],
  },
  daily: {
    time: [date, '2026-11-24'],
    temperature_2m_max: [17.5, 18], temperature_2m_min: [8.9, 9],
    precipitation_sum: [0.1, 0], sunrise: [`${date}T06:41`, '2026-11-24T06:42'],
  },
};
const merged = mergeForecast(primary, fallback);
// 预报温度用 best_match（CMA 对鹰潭最高温偏低）；当前实况仍用 CMA。
assert.deepEqual(merged.hourly.temperature_2m, [17.3, 17.4, 17.5]);
assert.deepEqual(merged.daily.temperature_2m_max, [17.5, 18]);
assert.deepEqual(merged.daily.temperature_2m_min, [8.9, 9]);
assert.equal(merged.current.temperature_2m, 15.9);
assert.deepEqual(merged.hourly.precipitation_probability, [10, 20, 30]);
assert.deepEqual(merged.hourly.surface_pressure, [1008, 1005, 1008]);
assert.deepEqual(merged.hourly.wind_gusts_10m, [8, 8, 9]);
assert.equal(merged.daily.sunrise[0], `${date}T06:40`);
assert.equal(merged.daily.sunrise[1], '2026-11-24T06:42');
assert.equal(merged.current.cloud_cover, 75);
assert.equal(merged.elevation, 50);
assert.equal(mergeForecast(null, fallback), fallback);
assert.equal(mergeForecast(primary, null), primary);

console.log('test-weather: 通过');
