import assert from 'node:assert/strict';
import { parseWeatherPage, parseCurrentScript, cnKind, cnWindParts, buildWeatherCn } from '../web/cnweather.js';

const html = `
<script>var hour3data={"7d":[
["24日11时,d01,多云,16℃,东北风,<3级,2","25日08时,d01,多云,7℃,东风,<3级,3"],
["25日11时,d01,多云,13℃,东风,<3级,3","26日08时,d00,晴,8℃,东风,<3级,0"]
]};</script>
<h1>24日（今天）</h1><p title="多云" class="wea">多云</p><p class="tem"><span>17</span>/<i>7℃</i></p>
<h1>25日（明天）</h1><p title="多云" class="wea">多云</p><p class="tem"><span>16</span>/<i>8℃</i></p>
`;
const currentText = 'var dataSK ={"temp":"15.8","weather":"阴","WD":"西风","WS":"2级","SD":"69%","time":"13:25","date":"11月24日(星期二)"};';
const now = new Date('2026-11-24T05:30:00Z');

const days = parseWeatherPage(html, now);
assert.equal(days.length, 2);
assert.equal(days[0].date, '2026-11-24');
assert.equal(days[0].text, '多云');
assert.equal(days[0].high, 17);
assert.equal(days[0].low, 7);
assert.equal(days[0].hourly[0].time, '11:00');
assert.equal(days[0].hourly[0].temp, 16);
assert.equal(days[0].hourly[0].windDir, '东北风');
assert.equal(days[1].date, '2026-11-25');
assert.equal(days[1].high, 16);
assert.equal(days[1].low, 8);

const cur = parseCurrentScript(currentText);
assert.equal(cur.temp, 15.8);
assert.equal(cur.text, '阴');
assert.equal(cur.windDir, '西风');
assert.equal(cur.windLevel, '2级');
assert.equal(cur.humidity, 69);

assert.equal(cnKind('多云'), 'partlyCloudy');
assert.equal(cnKind('阴'), 'overcast');
assert.equal(cnKind('雷阵雨'), 'thunder');
assert.equal(cnKind('小雨'), 'rain');
assert.deepEqual(cnWindParts('东风', '<3级'), { dir: 2, level: 2 });
assert.deepEqual(cnWindParts('西北风', '3-4级'), { dir: 7, level: 4 });

const out = buildWeatherCn({ html, currentText, now });
assert.equal(out.source, '中国天气网');
assert.equal(out.days.length, 2);
assert.equal(out.current.temp, 15.8);
assert.equal(out.fetched_at, now.toISOString());

console.log('test-cn-weather: 通过');
