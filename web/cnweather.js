// 中国天气网（weather.com.cn）页面解析：纯函数，不碰 DOM。
// 该站页面没有 CORS，浏览器不能直连；由 tools/fetch-weather-cn.mjs 定时抓成 /data/weather-cn.json。
export const CN_STATION = '101241101';
export const CN_CITY = '鹰潭';
export const CN_PAGE = 'http://www.weather.com.cn/weather/101241101.shtml';
export const CN_CURRENT = 'http://d1.weather.com.cn/weather_index/101241101.html';

const KINDS = [
  ['雷阵雨', 'thunder'], ['雷雨', 'thunder'],
  ['暴雨', 'heavyRain'], ['大雨', 'heavyRain'],
  ['中雨', 'rain'], ['小雨', 'rain'], ['阵雨', 'rain'], ['雨', 'rain'],
  ['大雪', 'snow'], ['中雪', 'snow'], ['小雪', 'snow'], ['雨夹雪', 'snow'], ['雪', 'snow'],
  ['雾', 'fog'], ['霾', 'fog'], ['浮尘', 'fog'], ['扬沙', 'fog'],
  ['阴', 'overcast'], ['多云', 'partlyCloudy'], ['晴', 'clear'],
];
const DIRS = { 北风: 0, 东北风: 1, 东风: 2, 东南风: 3, 南风: 4, 西南风: 5, 西风: 6, 西北风: 7 };

export function cnKind(text) {
  const s = String(text || '');
  for (const [k, kind] of KINDS) if (s.includes(k)) return kind;
  return 'unknown';
}

export function cnWindParts(dirText, levelText) {
  const dir = DIRS[String(dirText || '').trim()] ?? null;
  const raw = String(levelText || '');
  const nums = raw.match(/\d+/g) || [];
  let level = nums.length ? Math.max(...nums.map(Number)) : null;
  if (/^<\s*3/.test(raw)) level = 2;
  return { dir, level };
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const pad = (n) => String(n).padStart(2, '0');

function chinaToday(now) {
  const s = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function baseDate(firstDay, now) {
  const { y, m, d } = chinaToday(now);
  if (firstDay < d - 15) return Date.UTC(y, m, firstDay);       // 跨到下个月
  if (firstDay > d + 15) return Date.UTC(y, m - 2, firstDay);   // 跨到上个月
  return Date.UTC(y, m - 1, firstDay);
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function parseHourly(s) {
  const parts = String(s || '').split(',');
  const m = parts[0]?.match(/(\d+)日(\d+)时/);
  if (!m) return null;
  return {
    time: `${pad(+m[2])}:00`,
    text: parts[2] || '',
    temp: num(parts[3]),
    windDir: parts[4] || '',
    windLevel: parts[5] || '',
  };
}

export function parseWeatherPage(html, now = new Date()) {
  const start = html.indexOf('var hour3data=');
  const end = html.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('页面里找不到 hour3data');
  const seg = html.slice(start, end);
  const data = JSON.parse(seg.slice(seg.indexOf('{'), seg.lastIndexOf('}') + 1));
  const groups = data['7d'];
  if (!Array.isArray(groups) || !groups.length) throw new Error('hour3data 里没有 7d');
  const firstDay = +(groups[0][0].match(/(\d+)日/)?.[1] || 0);
  if (!firstDay) throw new Error('hour3data 首日无法解析');
  const base = baseDate(firstDay, now);

  const chunkRe = /<h1>(\d+)日（[^<]*）<\/h1>([\s\S]*?)(?=<h1>|<\/ul>|$)/g;
  const chunks = [...html.matchAll(chunkRe)].map((m) => ({ day: +m[1], block: m[2] }));

  return groups.map((group, i) => {
    const dayNum = +(group[0]?.match(/(\d+)日/)?.[1] || 0);
    const chunk = chunks.find((c) => c.day === dayNum) || chunks[i];
    const text = chunk?.block.match(/<p title="([^"]+)" class="wea">/)?.[1] || group[0]?.split(',')[2] || '';
    const hi = chunk?.block.match(/<span>(-?\d+)<\/span>\s*\/\s*<i>(-?\d+)℃<\/i>/);
    const hourly = group.map(parseHourly).filter(Boolean);
    const temps = hourly.map((h) => h.temp).filter((v) => v != null);
    return {
      date: isoDay(base + i * 86400000),
      text,
      high: hi ? +hi[1] : (temps.length ? Math.max(...temps) : null),
      low: hi ? +hi[2] : (temps.length ? Math.min(...temps) : null),
      hourly,
    };
  });
}

export function parseCurrentScript(text) {
  const start = String(text || '').indexOf('var dataSK =');
  if (start < 0) return null;
  const end = text.indexOf('};', start);
  if (end < 0) return null;
  const seg = text.slice(start, end + 2);
  const obj = JSON.parse(seg.slice(seg.indexOf('{'), seg.lastIndexOf('}') + 1));
  return {
    time: obj.time || null,
    temp: num(obj.temp),
    text: obj.weather || '',
    windDir: obj.WD || '',
    windLevel: obj.WS || '',
    humidity: num(obj.SD),
    aqi: num(obj.aqi),
  };
}

export function buildWeatherCn({ html, currentText = '', now = new Date() }) {
  return {
    source: '中国天气网',
    station: CN_STATION,
    city: CN_CITY,
    endpoint: CN_PAGE,
    fetched_at: now.toISOString(),
    current: parseCurrentScript(currentText),
    days: parseWeatherPage(html, now),
  };
}
