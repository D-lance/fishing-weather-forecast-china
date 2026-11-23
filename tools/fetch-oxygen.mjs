// 国家地表水水质自动监测实时数据发布系统 → 鹰潭断面溶解氧
// 用法：
//   node tools/fetch-oxygen.mjs
//   node tools/fetch-oxygen.mjs --out web/data/oxygen.json
//
// 注意：该接口的 CORS 只允许 https://szzdjc.cnemc.cn，浏览器不能从本站直连；
// 这个脚本应在本地/CI/定时任务里跑，再把 JSON 给静态站。建议 30–60 分钟抓一次，尊重公共接口。
import fs from 'node:fs';
import path from 'node:path';

const ENDPOINT = 'https://szzdjc.cnemc.cn:8070/GJZ/Ajax/Publish.ashx';
// 站点 → 城市映射。先做鹰潭；站点改名/新增时同步这里。
const CITY_STATIONS = {
  '鹰潭市': ['炭埠周家', '白塔河河口', '土桥', '流口村'],
};
const ALL_STATIONS = Object.values(CITY_STATIONS).flat();
const FORM = 'AreaID=360000&RiverID=&MNName=&PageIndex=1&PageSize=200&action=getRealDatas';

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent': 'fishing-weather-forecast-china/0.1 (+https://fish.satloot.com)',
  },
  body: FORM,
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const text = await res.text();
let json;
try { json = JSON.parse(text); } catch { throw new Error(`非 JSON 响应：${text.slice(0, 200)}`); }
if (json.result !== 1 || !Array.isArray(json.tbody)) throw new Error(`接口返回异常：${text.slice(0, 200)}`);

const thead = json.thead || [];
const doIdx = thead.findIndex((h) => String(h).includes('溶解氧'));
if (doIdx < 0) throw new Error('响应里找不到「溶解氧」列');

const num = (html) => {
  const s = String(html ?? '');
  const m = s.match(/原始值：\s*([0-9.]+)/);
  const n = m ? Number(m[1]) : Number(s.replace(/<[^>]+>/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

const stations = (json.tbody || [])
  .filter((r) => ALL_STATIONS.includes(String(r[2])))
  .map((r) => ({
    name: String(r[2]),
    province: String(r[0]),
    basin: String(r[1]),
    time: String(r[3]),
    do: num(r[doIdx]),
    water_class: String(r[4] ?? ''),
  }));

if (!stations.length) throw new Error(`没有找到目标断面：${ALL_STATIONS.join('、')}`);

const round2 = (n) => Math.round(n * 100) / 100;
const cities = {};
for (const [city, names] of Object.entries(CITY_STATIONS)) {
  const list = stations.filter((s) => names.includes(s.name));
  const values = list.map((s) => s.do).filter((v) => Number.isFinite(v));
  const times = list.map((s) => s.time).filter(Boolean).sort();
  cities[city] = {
    do: values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null,
    count: values.length,
    station_count: names.length,
    time: times.length ? (times[0] === times[times.length - 1] ? times[0] : `${times[0]}–${times[times.length - 1]}`) : null,
    stations: list,
  };
}

const out = {
  source: '国家地表水水质自动监测实时数据发布系统',
  endpoint: ENDPOINT,
  fetched_at: new Date().toISOString(),
  cities,
  stations,
};

const outIdx = process.argv.indexOf('--out');
if (outIdx >= 0 && process.argv[outIdx + 1]) {
  const file = path.resolve(process.argv[outIdx + 1]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.error(`written ${file}`);
} else {
  console.log(JSON.stringify(out, null, 2));
}
