import assert from 'node:assert/strict';
import { rankDay, bestByDate, mergeAlerts, dayFlagKeys, allOptimal } from '../web/rank.js';

const day = (date, score, extra = {}) => ({
  date,
  score,
  level: score >= 80 ? '极佳' : '好',
  level_index: score >= 80 ? 0 : 1,
  windows: extra.windows || [{ start: '05:00', end: '07:00', score }],
  alerts: extra.alerts || [],
  day_cap: extra.day_cap ?? null,
  sub: extra.sub || { temp: 100 },
});
const output = (key, name, days) => ({ key, name, out: { days } });

const a = output('a', 'A', [day('2026-11-23', 70)]);
const b = output('b', 'B', [day('2026-11-23', 80)]);
const c = output('c', 'C', [day('2026-11-23', 80)]);
const d = output('d', 'D', [day('2026-11-24', 90)]);

// 分数降序；同分按输入顺序（b 在 c 前）
assert.deepEqual(rankDay([a, b, c], '2026-11-23').map((x) => x.key), ['b', 'c', 'a']);
assert.equal(rankDay([a, b, c], '2026-11-23')[0].score, 80);

// 缺某天的鱼种跳过；单鱼种也能排
assert.deepEqual(rankDay([a, d], '2026-11-23').map((x) => x.key), ['a']);
assert.deepEqual(rankDay([a], '2026-11-23').map((x) => x.key), ['a']);

// 每天 top + ranking；没有数据的日期 top 为 null
const merged = bestByDate([a, b], ['2026-11-23', '2026-11-24']);
assert.equal(merged[0].top.key, 'b');
assert.deepEqual(merged[0].ranking.map((x) => x.key), ['b', 'a']);
assert.equal(merged[1].top, null);
assert.deepEqual(merged[1].ranking, []);

// 同一天同一条安全提示只保留一次；不同日期保留
const x = output('x', 'X', [day('2026-11-23', 70, { alerts: [{ key: 'thunder', line: '09:00 雷暴' }] })]);
const y = output('y', 'Y', [day('2026-11-23', 80, { alerts: [{ key: 'thunder', line: '09:00 雷暴' }] })]);
const z = output('z', 'Z', [day('2026-11-23', 80, { alerts: [{ key: 'gale', line: '10:00 大风' }] })]);
const w = output('w', 'W', [day('2026-11-24', 60, { alerts: [{ key: 'rain', line: '08:00 强降水' }] })]);
assert.deepEqual(mergeAlerts([w, x, y, z]).map((a) => `${a.date}|${a.line}`), [
  '2026-11-23|09:00 雷暴',
  '2026-11-23|10:00 大风',
  '2026-11-24|08:00 强降水',
]);

// 封顶/低氧显示标记：有 day_cap 时只给 cap（cap_kinds 里已含雷暴/大风/浪），
// 没有 day_cap 时保留强降水/低氧等逐项标记。
const capped = day('2026-11-23', 45, { day_cap: 45, alerts: [{ key: 'thunder', line: '09:00 雷暴' }] });
assert.deepEqual(dayFlagKeys(capped), ['cap']);
const cappedOxygen = day('2026-11-23', 45, { day_cap: 45, alerts: [{ key: 'oxygen', line: '01:00 低氧' }] });
assert.deepEqual(dayFlagKeys(cappedOxygen), ['cap', 'oxygen']);
const oxygen = day('2026-11-23', 50, { alerts: [{ key: 'oxygen', line: '01:00 低氧' }] });
assert.deepEqual(dayFlagKeys(oxygen), ['oxygen']);
const rain = day('2026-11-23', 40, { alerts: [{ key: 'rain', line: '09:00 强降水' }] });
assert.deepEqual(dayFlagKeys(rain), ['rain']);

// 多鱼种都处在水温适温区时，主钓不应被当成唯一优势
const warmEntry = bestByDate([
  output('crucian', '鲫鱼', [day('2026-11-23', 80)]),
  output('bream', '鳊鱼', [day('2026-11-23', 80)]),
], ['2026-11-23'])[0];
assert.equal(allOptimal(warmEntry), true);
const mixedEntry = bestByDate([
  output('crucian', '鲫鱼', [day('2026-11-23', 80)]),
  output('bream', '鳊鱼', [day('2026-11-23', 75, { sub: { temp: 99 } })]),
], ['2026-11-23'])[0];
assert.equal(allOptimal(mixedEntry), false);
const warmDifferentScores = bestByDate([
  output('crucian', '鲫鱼', [day('2026-11-23', 80)]),
  output('bream', '鳊鱼', [day('2026-11-23', 79)]),
], ['2026-11-23'])[0];
assert.equal(allOptimal(warmDifferentScores), false);
assert.equal(allOptimal({ ranking: [] }), false);

console.log('test-rank: 通过');
