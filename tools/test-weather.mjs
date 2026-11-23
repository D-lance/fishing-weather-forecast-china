import assert from 'node:assert/strict';
import { summarizeDay } from '../web/weather.js';

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

console.log('test-weather: 通过');
