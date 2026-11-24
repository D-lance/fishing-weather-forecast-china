// fish.satloot.com 前端：搜水体 / 地图点水面 / 定位 → 浏览器直连 Open-Meteo / Overpass / Nominatim → engine.js 算分 → 渲染。
// 中英文由 <html lang> 决定；页面静态文案在构建期翻译（i18n/en.json），这里只放动态文案。
// 没有后端：所有请求都从浏览器发出。坐标一律以 WGS-84 保存；只有画到高德底图上时才换成 GCJ-02（coord.js）。
import {
  computeForecast, forecastUrl, marineUrl, floodUrl, localToday, geocodeUrl, OVERPASS_MIRRORS, overpassQuery,
  classifyWater, marineAvailable, SPECIES, WATER_TYPES, WEIGHTS,
  PRIMARY_FORECAST_MODEL, FALLBACK_FORECAST_MODEL, FORECAST_DAYS,
} from './engine.js';
import { wgs84ToGcj02, gcj02ToWgs84, snapToGeom, geomSpanM, distM } from './coord.js';
import { bestByDate, mergeAlerts, dayFlagKeys, allOptimal } from './rank.js';
import { summarizeDay, mergeForecast } from './weather.js';
import { cnKind, cnWindParts } from './cnweather.js';

// Nominatim 使用规范建议带联系邮箱（浏览器改不了 User-Agent，会自动带 Referer）。上线前填站点联系邮箱；留空则不带。
const NOMINATIM_EMAIL = 'admin@satloot.com';

const LANG = /^en/i.test(document.documentElement.lang) ? 'en' : 'zh';
const $ = (id) => document.getElementById(id);
const RECENT_KEY = 'fishcast.recent';
const BASEMAP_KEY = 'fishcast.basemap';
const BASE_TITLE = document.title;
const LONG_RIVER_M = 8000;   // 河道外包框对角线超过 8 km 就要求用户点选河段
const SNAP_MAX_M = 3000;     // 点击离已选水体 3 km 以内才吸附，否则当作点了别处
// 鹰潭专用模式：保留地图，限制在鹰潭市；城市固定，溶氧用城市平均。
const YINGTAN_ONLY = true;
const YINGTAN_CITY = '鹰潭市';
const YINGTAN_BOUNDS = { minLat: 27.8, maxLat: 28.7, minLon: 116.6, maxLon: 117.4 };
const DEFAULT_POINT = { lat: 28.26, lon: 117.03, name: '信江（鹰潭段）' };
const TARGET_SPECIES = ['crucian', 'bream', 'culter', 'mandarin'];
const insideYingtan = (lat, lon) => lat >= YINGTAN_BOUNDS.minLat && lat <= YINGTAN_BOUNDS.maxLat
  && lon >= YINGTAN_BOUNDS.minLon && lon <= YINGTAN_BOUNDS.maxLon;

const TXT = {
  zh: {
    waterAuto: '自动识别', water: { reservoir: '水库', lake: '湖泊', river: '河流 / 运河', pond: '池塘 / 鱼塘', sea: '海边', unknown: '不确定（按一般水体）' },
    kind: { river: '江河', lake: '湖泊', reservoir: '水库', sea: '海湾 / 海域', pond: '池塘 / 鱼塘', place: '地名' },
    searching: '正在搜索…', noResult: '没找到，换个说法试试（比如加上省市，或直接在地图上点水面）。', searchErr: '搜索暂时用不了，稍后再试，或直接在地图上点水面。',
    gpsAsk: '正在获取定位…', gpsErr: '定位失败：浏览器没给位置权限，或当前环境不支持定位。', gpsNo: '浏览器不支持定位。',
    mapLoading: '正在加载地图…', mapErr: '地图没加载出来，可以改用上面的搜索。',
    loadingWx: '正在取天气…', wxErr: '天气数据暂时没取到，稍后再试。', noDays: '这段时间没有可用的天气数据，换个钓点或稍后再试。',
    detecting: '正在认附近是什么水…',
    detected: (w) => `认出来是「${w}」，不对可以手动改。`,
    detectNone: '没认出是什么水，请在「水域类型」里手动选一下。',
    detectFail: '附近水域没查到，可以直接在地图上点水面或手动选类型。',
    userWater: (w) => `已手动选「${w}」。`,
    selWater: (n, k, w) => `已选「${n}」（${k}），按${w}来算。在地图上高亮的水面上点一下可以换个位置。`,
    longRiver: (n) => `「${n}」是条长河：请在地图上高亮的河道上点一下你要去的那一段，会自动挪到最近的河面上再算。`,
    longRiverNoMap: (n) => `地图没加载出来，先按「${n}」离你选中点最近的河段算；想换河段可以再搜一个更具体的地名。`,
    tooFar: '离选中的水面太远，按你点的位置重新算。',
    onlyYingtan: '只支持鹰潭市：请点在鹰潭范围内的水面上。',
    nearbyLoading: '正在找附近 1.5 公里内有名字的水面…', nearbyTitle: '附近有名字的水面（点一个就按它算）：', nearbyNone: '附近 1.5 公里内没有带名字的水面，就按你点的位置算。',
    nearbyFail: '附近水域没查到，就按你点的位置算；也可以手动选水域类型。', usePoint: '都不是，就按我点的位置', inside: '就在水面上',
    segment: (river, place) => `${river}·${place}段`,
    recent: '最近：', unnamed: '地图选点', copied: '链接已复制', copyFail: '复制失败，请直接复制地址栏',
    shotWorking: '正在生成整页截图…', shotSaved: '整页截图已生成', shotCanceled: '已取消分享',
    shotUnsupported: '当前浏览器不支持整页截图', shotFail: '生成整页截图失败，请重试', close: '关闭',
    cardBrand: '今日鱼情', cardBackup: '备选排行', cardFooter: '按天气经验估算，不保证有鱼',
    today: '今天', tomorrow: '明天', week: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    dateFmt: (m, d, w) => `${m}月${d}日 ${w}`, shortDate: (m, d) => `${m}/${d}`,
    waterTemp: (t) => `水温约 ${t}℃`, noWin: '没有好时段',
    meta: (d) => `估算水温 ${d.water_temp}℃${d.gate != null ? ` · 水温闸门 ×${Number(d.gate).toFixed(2)}` : ''} · 降水 ${fmt(d.precip)} 毫米 · 日出 ${d.sunrise} · 日落 ${d.sunset}${d.moonrise ? ' · 月出 ' + d.moonrise : ''}${d.moonset ? ' · 月落 ' + d.moonset : ''}`,
    placeMeta: (p, w, src) => `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)} · 海拔 ${p.elevation ?? '—'} 米 · 水域：${w}（${src}）`,
    oxygenMeta: (o) => `城市平均溶解氧 ${fmt(o.value)} mg/L（${o.count} 个站${o.time ? '，' + o.time : ''}）`,
    shadow: (ver, score) => `旧模型 ${ver}：${score} 分（对比，不参与当前评分）`,
    bestLabel: '主钓', viewLabel: '查看', bestWindow: '最佳', winWhyLabel: '为什么是这段', rankLabel: '按鱼种鱼情排序',
    focusLabel: (n, isTop) => `查看：${n}${isTop ? '（主钓）' : ''}`,
    topBadge: '主钓', expand: (n) => `展开全部 ${n} 种`, collapse: '收起',
    closeGap: '差距很小，可以都准备',
    tempWhy: (name, temp, lo, hi) => `水温 ${temp}℃，${name}适温 ${lo}–${hi}℃；鱼种权重见下方`,
    allOptimalTitle: (n) => `${n} 种都适温`,
    allOptimal: (n) => `${n} 种都适温，按你常钓的鱼和饵准备`,
    allOptimalShort: '都适温',
    wxPlace: '鹰潭 · 信江', now: '现在', daytime: '白天',
    wxSourceCn: '天气/温度：中国天气网 · 降水/湿度：Open-Meteo', wxSourceOm: '天气：Open-Meteo',
    weather: { clear: '晴', mainlyClear: '晴间多云', partlyCloudy: '多云', overcast: '阴', fog: '雾', drizzle: '毛毛雨', rain: '雨', heavyRain: '大雨', snow: '雪', thunder: '雷雨', unknown: '—' },
    dirs: ['北', '东北', '东', '东南', '南', '西南', '西', '西北'],
    tempRange: (lo, hi) => `${lo}–${hi}℃`,
    wind: (dir, level) => `${dir}风 ${level}级`,
    rainProb: (p) => `降水 ${p}%`,
    humidity: (h) => `湿度 ${h}%`,
    wsrc: { osm: '地图自动认出', user: '手动选择', default: '没认出' },
    lvDesc: ['挑对时段去，大概率连竿', '挑对时段去，有鱼口', '能钓，口不会太好', '难钓，想去就只挑最佳时段', '天气不好或不安全，建议改天'],
    weight: (w) => `占 ${w}%`, km: (m) => (m < 1000 ? `${Math.round(m)} 米` : `${(m / 1000).toFixed(1)} 公里`),
    subs: { temp: '水温', pressure: '气压', trend: '温变', wind: '风', sky: '天空', time: '时段', moon: '月相/潮', geo: '水域' },
    alertTitle: '安全警告', alertItem: (day, line) => `${day}：${line}`,
    kinds: { thunder: '雷暴', gale: '大风', wave: '大浪', rain: '强降水', oxygen: '低氧', oxygenWarn: '溶氧偏低', heat: '高温', ice: '结冰' },
    capped: (ks) => `${ks.join('、')}封顶`,
    sunrise: '日出', sunset: '日落', tip: (t, h, hs) => `${t}  这一小时 ${h} 分 · 前后三小时平均 ${hs} 分`, tipHint: '在曲线上点按或滑动，看每个小时的分数',
    title: (n, rel, s) => `${n} 钓鱼天气 ${rel}出钓指数${s} - 今日鱼情`,
    amap: '高德底图', osm: 'OSM 底图',
    amapAttr: '底图 © 高德地图', osmAttr: '底图 © OpenStreetMap 贡献者',
    sep: ' · ', colon: '：',
  },
  en: {
    waterAuto: 'Auto-detect', water: { reservoir: 'Reservoir', lake: 'Lake', river: 'River / canal', pond: 'Pond', sea: 'Sea / coast', unknown: 'Not sure (generic)' },
    kind: { river: 'River', lake: 'Lake', reservoir: 'Reservoir', sea: 'Bay / sea', pond: 'Pond', place: 'Place' },
    searching: 'Searching…', noResult: 'No match. Try another spelling, add the province/city, or tap the water on the map.', searchErr: 'Search is unavailable right now. Try again later, or tap the water on the map.',
    gpsAsk: 'Getting your location…', gpsErr: 'Location failed: permission denied or not supported here.', gpsNo: 'This browser does not support geolocation.',
    mapLoading: 'Loading map…', mapErr: 'Map failed to load; use the search box instead.',
    loadingWx: 'Getting the weather…', wxErr: 'Could not get the weather right now, please try again later.', noDays: 'No usable weather data for these days; try another spot or come back later.',
    detecting: 'Working out what water this is…',
    detected: (w) => `Looks like a ${w.toLowerCase()}. Change it if that is wrong.`,
    detectNone: 'Could not tell what water this is; please pick the water type yourself.',
    detectFail: 'Could not look up the water nearby. Tap the water on the map or pick the type yourself.',
    userWater: (w) => `Set manually to “${w}”.`,
    selWater: (n, k, w) => `Selected “${n}” (${k}), scored as ${w.toLowerCase()}. Tap the highlighted water on the map to move your spot.`,
    longRiver: (n) => `“${n}” is a long river: tap the stretch you are heading to on the highlighted line, and the spot moves onto the nearest bit of river.`,
    longRiverNoMap: (n) => `The map did not load; scoring the stretch of “${n}” nearest your selected point. Search for a more specific place to move it.`,
    tooFar: 'Too far from the selected water; scoring the point you tapped instead.',
    onlyYingtan: 'Yingtan only: tap a water point inside Yingtan.',
    nearbyLoading: 'Looking for named water within 1.5 km…', nearbyTitle: 'Named water nearby (tap one to use it):', nearbyNone: 'No named water within 1.5 km; using the point you tapped.',
    nearbyFail: 'Could not look up the water nearby; using the point you tapped. You can also pick the water type yourself.', usePoint: 'None of these, use my point', inside: 'you are on it',
    segment: (river, place) => `${river} · ${place}`,
    recent: 'Recent:', unnamed: 'Map point', copied: 'Link copied', copyFail: 'Copy failed, copy the address bar instead',
    shotWorking: 'Generating full-page image…', shotSaved: 'Full-page image ready', shotCanceled: 'Share cancelled',
    shotUnsupported: 'This browser cannot generate a full-page image', shotFail: 'Could not generate the full-page image; try again', close: 'Close',
    cardBrand: 'Fishing Forecast', cardBackup: 'Alternatives', cardFooter: 'Weather-based estimate; no guarantee of fish',
    today: 'Today', tomorrow: 'Tomorrow', week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    dateFmt: (m, d, w) => `${w} ${m}/${d}`, shortDate: (m, d) => `${m}/${d}`,
    waterTemp: (t) => `Water about ${t}°C`, noWin: 'No good window',
    meta: (d) => `Est. water ${d.water_temp}°C${d.gate != null ? ` · water-temp gate ×${Number(d.gate).toFixed(2)}` : ''} · rain ${fmt(d.precip)} mm · sunrise ${d.sunrise} · sunset ${d.sunset}${d.moonrise ? ' · moonrise ' + d.moonrise : ''}${d.moonset ? ' · moonset ' + d.moonset : ''}`,
    placeMeta: (p, w, src) => `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)} · elevation ${p.elevation ?? '—'} m · water: ${w.toLowerCase()} (${src})`,
    oxygenMeta: (o) => `City avg. DO ${fmt(o.value)} mg/L (${o.count} station${o.count === 1 ? '' : 's'}${o.time ? ', ' + o.time : ''})`,
    shadow: (ver, score) => `Old model ${ver}: ${score} (comparison only; not used for the live score)`,
    bestLabel: 'Top pick', viewLabel: 'Viewing', bestWindow: 'Best', winWhyLabel: 'Why this window', rankLabel: 'Ranked by species profile',
    focusLabel: (n, isTop) => `Viewing: ${n}${isTop ? ' (top pick)' : ''}`,
    topBadge: 'Top', expand: (n) => `Show all ${n}`, collapse: 'Show less',
    closeGap: 'Very close — prepare for both',
    tempWhy: (name, temp, lo, hi) => `Water ${temp}°C; ${name} optimal ${lo}–${hi}°C; see species weights below`,
    allOptimalTitle: (n) => `All ${n} in range`,
    allOptimal: (n) => `All ${n} are in range; choose by your usual target and bait`,
    allOptimalShort: 'In range',
    wxPlace: 'Yingtan · Xinjiang', now: 'Now', daytime: 'Daytime',
    wxSourceCn: 'Weather/temperature: China Weather · rain/humidity: Open-Meteo', wxSourceOm: 'Weather: Open-Meteo',
    weather: { clear: 'Clear', mainlyClear: 'Mostly clear', partlyCloudy: 'Partly cloudy', overcast: 'Overcast', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', heavyRain: 'Heavy rain', snow: 'Snow', thunder: 'Thunderstorm', unknown: '—' },
    dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    tempRange: (lo, hi) => `${lo}–${hi}°C`,
    wind: (dir, level) => `${dir} wind, force ${level}`,
    rainProb: (p) => `${p}% rain`,
    humidity: (h) => `${h}% humidity`,
    wsrc: { osm: 'recognised from the map', user: 'picked by you', default: 'not recognised' },
    lvDesc: ['Pick the right hours and expect steady bites', 'Pick the right hours and you should get bites', 'Fishable, but the bite will be slow', 'Tough; if you go, stick to the best window', 'Bad or unsafe weather; try another day'],
    weight: (w) => `${w}%`, km: (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`),
    subs: { temp: 'Water temp', pressure: 'Pressure', trend: 'Temp trend', wind: 'Wind', sky: 'Sky', time: 'Time of day', moon: 'Moon / tide', geo: 'Water body' },
    alertTitle: 'Safety warning', alertItem: (day, line) => `${day}: ${line}`,
    kinds: { thunder: 'Storm', gale: 'Gale', wave: 'High waves', rain: 'Heavy rain', oxygen: 'Low oxygen', oxygenWarn: 'Low DO', heat: 'Heat', ice: 'Ice' },
    capped: (ks) => `Capped: ${ks.join(', ').toLowerCase()}`,
    sunrise: 'Sunrise', sunset: 'Sunset', tip: (t, h, hs) => `${t}  this hour ${h} · 3-hour average ${hs}`, tipHint: 'Tap or drag on the curve to read each hour',
    title: (n, rel, s) => `${n} fishing weather – ${rel} bite index ${s} | Fishing Forecast`,
    amap: 'AMap tiles', osm: 'OSM tiles',
    amapAttr: 'Map © AMap', osmAttr: 'Map © OpenStreetMap contributors',
    sep: ', ', colon: ': ',
  },
}[LANG];
const LV_COLORS = ['#15803d', '#4d7c0f', '#b45309', '#c2410c', '#b91c1c'];
const WX_ICONS = { clear: '☀️', mainlyClear: '🌤️', partlyCloudy: '⛅', overcast: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', heavyRain: '🌧️', snow: '❄️', thunder: '⛈️', unknown: '•' };
const KIND_COLORS = { river: '#2563eb', lake: '#0891b2', reservoir: '#0f766e', sea: '#1e40af', pond: '#65a30d', place: '#78716c' };
const KIND_ORDER = ['river', 'lake', 'reservoir', 'sea', 'pond', 'place'];
const fmt = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString());
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDist = (m) => (!Number.isFinite(m) ? '—' : m < 1 ? TXT.inside : TXT.km(m));

// ───────── 状态 ─────────
const S = {
  lat: null, lon: null, name: '',
  focus: null,          // 当前查看鱼种；S.out 永远指向 S.outs[S.focus]
  outs: null,           // { [speciesKey]: computeForecast 输出 }
  days: null,           // bestByDate：每天 top + ranking
  alerts: [],           // mergeAlerts：全鱼种去重后的安全提示
  rankOpen: false,      // 备选排行是否展开
  wUser: null,          // 下拉手动选的水域类型（null = 自动）
  wAuto: null,          // 自动结果：null 未开始 / 'pending' / 类型 / 'fail'
  wPreset: null,        // 由所选水体直接决定的类型（搜索结果 / 附近水体），来源记 osm，不再跑 Overpass
  wSel: null,           // 当前选中的水体 {name, kind, water, geom}（WGS-84 GeoJSON），用于高亮与吸附
  fc: null, marine: null, flood: null, out: null, sel: 0,
  today: null,          // 取到 forecast 时冻结的“当地今天”，跨午夜重算也不漂移
  city: null,           // 反向地名得到的城市，用于城市平均溶解氧
  oxygenData: null,     // /data/oxygen.json（城市平均溶解氧）
  weatherCn: null,      // /data/weather-cn.json（中国天气网口径，定时脚本生成）
  token: 0,
  basemap: 'amap',
};

// ───────── 本地存储（全部 try/catch） ─────────
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式等，忽略 */ } }
function loadRecent() {
  try {
    const a = JSON.parse(lsGet(RECENT_KEY, '[]'));
    if (!Array.isArray(a)) return [];
    return a.filter((p) => p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon)
      && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (!YINGTAN_ONLY || insideYingtan(p.lat, p.lon))).slice(0, 8);
  } catch { return []; }
}
function saveRecent() {
  if (!S.name) return;
  const a = loadRecent().filter((x) => x.name !== S.name && (Math.abs(x.lat - S.lat) > 1e-3 || Math.abs(x.lon - S.lon) > 1e-3));
  a.unshift({ name: S.name, lat: +S.lat.toFixed(4), lon: +S.lon.toFixed(4), w: S.wPreset || undefined });
  lsSet(RECENT_KEY, JSON.stringify(a.slice(0, 8)));
  if ($('recent')) renderRecent();
}
function renderRecent() {
  const a = loadRecent();
  const box = $('recent');
  if (!a.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<span class="small muted">${esc(TXT.recent)}</span>` + a.map((p, i) => `<button type="button" data-i="${i}">${esc(p.name || `${p.lat}, ${p.lon}`)}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const p = a[+b.dataset.i];
    S.wSel = null;
    choosePlace(p.lat, p.lon, p.name, { water: WATER_TYPES.includes(p.w) ? p.w : null });
  }));
}

function setStatus(msg, err) {
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('err', !!err);
}
function showForecastError(msg) {
  const el = $('error');
  el.textContent = msg || TXT.wxErr;
  el.hidden = false;
}
function hideForecastError() { $('error').hidden = true; }

// ───────── 下拉框 ─────────
function initSelects() {
  const waters = YINGTAN_ONLY ? WATER_TYPES.filter((w) => w !== 'sea') : WATER_TYPES;
  $('w').innerHTML = `<option value="">${esc(TXT.waterAuto)}</option>` + waters.map((w) => `<option value="${w}">${esc(TXT.water[w])}</option>`).join('');
  $('w').addEventListener('change', () => {
    S.wUser = $('w').value || null;
    syncUrl();
    if (S.wUser) setStatus(TXT.userWater(TXT.water[S.wUser]));
    else if (S.wPreset && S.wSel) setStatus(TXT.selWater(S.wSel.name, TXT.kind[S.wSel.kind], TXT.water[S.wPreset]));
    else if (S.lat != null && !S.wPreset) detectWater(S.token);
    recompute();
  });
}

// ───────── URL ─────────
// ?lat=&lon=&w=（手选类型）&wt=（所选水体决定的类型）&n=（地名 / 水体名）；旧 sp= 忽略
function syncUrl() {
  if (S.lat == null) return;
  const q = new URLSearchParams();
  q.set('lat', S.lat.toFixed(4));
  q.set('lon', S.lon.toFixed(4));
  if (S.wUser) q.set('w', S.wUser);
  if (S.wPreset) q.set('wt', S.wPreset);
  if (S.name) q.set('n', S.name);
  try { history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`); } catch { /* file:// 等 */ }
}
function readUrl() {
  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
  const w = q.get('w'), wt = q.get('wt');
  if (w && WATER_TYPES.includes(w) && (!YINGTAN_ONLY || w !== 'sea')) S.wUser = w;
  $('w').value = S.wUser || '';
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    choosePlace(lat, lon, (q.get('n') || '').slice(0, 80), { water: WATER_TYPES.includes(wt) ? wt : null });
  }
}

// ───────── 网络 ─────────
async function getJSON(url, opt = {}, timeout = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}
// Nominatim：全站共用一个节流阀，两次请求至少隔 1.1 s（使用规范：≤ 1 次/秒）
let nomiLast = 0;
async function nomi(path, params) {
  const wait = nomiLast + 1100 - Date.now();
  nomiLast = Date.now() + Math.max(0, wait);
  if (wait > 0) await sleep(wait);
  const q = new URLSearchParams({ ...params, format: 'jsonv2', 'accept-language': LANG === 'en' ? 'en' : 'zh' });
  if (NOMINATIM_EMAIL) q.set('email', NOMINATIM_EMAIL);
  return getJSON(`https://nominatim.openstreetmap.org/${path}?${q.toString()}`, {}, 15000);
}

// ───────── 搜索：Nominatim 优先（水体排前、按类分组），没结果再退回 Open-Meteo 地名库 ─────────
/** Nominatim 结果 → {kind, water}；kind ∈ river/lake/reservoir/sea/pond/place */
function nomiKind(r) {
  const c = r.category || r.class || '', t = r.type || '', et = r.extratags || {};
  if (c === 'waterway' && /^(river|stream|canal|riverbank|tidal_channel)$/.test(t)) return { kind: 'river', water: 'river' };
  if ((c === 'natural' && t === 'water') || c === 'water') {
    const w = et.water || (c === 'water' ? t : '');
    if (w === 'reservoir') return { kind: 'reservoir', water: 'reservoir' };
    if (/^(pond|fishpond|basin)$/.test(w)) return { kind: 'pond', water: 'pond' };
    if (/^(river|canal|stream|oxbow)$/.test(w)) return { kind: 'river', water: 'river' };
    return { kind: 'lake', water: 'lake' };
  }
  if (c === 'landuse' && t === 'reservoir') return { kind: 'reservoir', water: 'reservoir' };
  if (c === 'landuse' && (t === 'aquaculture' || t === 'basin')) return { kind: 'pond', water: 'pond' };
  if (c === 'leisure' && t === 'fishing') return { kind: 'pond', water: 'pond' };
  if ((c === 'natural' && /^(bay|strait|coastline|beach|cape)$/.test(t)) || (c === 'place' && /^(sea|ocean)$/.test(t))) return { kind: 'sea', water: 'sea' };
  return { kind: 'place', water: null };
}
const baseName = (n) => String(n || '').replace(/(县|市|区)$/, '');

async function searchNominatim(q) {
  const j = await nomi('search', { q, countrycodes: 'cn', polygon_geojson: '1', polygon_threshold: '0.0005', extratags: '1', limit: '10' });
  const out = [];
  for (const r of j || []) {
    const c = r.category || r.class;
    if (c === 'railway' || c === 'highway') continue;
    const { kind, water } = nomiKind(r);
    const parts = String(r.display_name || '').split(/,\s*/);
    const name = r.name || parts[0];
    const cand = { name, sub: parts.slice(1, 4).join(TXT.sep), lat: +r.lat, lon: +r.lon, kind, water, geom: kind === 'place' ? null : r.geojson };
    // 同名（去掉末尾县/市/区）且相距 < 20 km 的合并；同一条河被拆成多段时把几何并起来
    const dup = out.find((x) => baseName(x.name) === baseName(name) && x.kind === kind && distM(x.lat, x.lon, cand.lat, cand.lon) < 20000);
    if (dup) {
      if (dup.geom && cand.geom) dup.geom = { type: 'GeometryCollection', geometries: [dup.geom, cand.geom] };
      continue;
    }
    out.push(cand);
  }
  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
async function searchOpenMeteo(q) {
  const j = await getJSON(geocodeUrl(q, LANG));
  return (j.results || []).map((r) => ({
    name: r.name, sub: [r.admin2, r.admin1, r.country].filter((x, k, a) => x && a.indexOf(x) === k && x !== r.name).join(TXT.sep),
    lat: r.latitude, lon: r.longitude, kind: 'place', water: null, geom: null, label: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : ''].filter(Boolean).join(TXT.sep),
  }));
}

let searching = false;
let searchTimer = 0;
let pickToken = 0;   // 取消过期的 pickCandidate（慢地图加载时用户又选了别的地点）
async function search(ev) {
  ev.preventDefault();
  const q = $('q').value.trim();
  if (!q || searching) return;        // 只在提交时发请求；上一次没回来就不再发
  searching = true;
  clearTimeout(searchTimer);
  setStatus(TXT.searching);
  $('search-btn').disabled = true;
  let list = [], anyOk = false;
  try { list = await searchNominatim(q); anyOk = true; } catch { list = []; }
  if (!list.length) { try { list = await searchOpenMeteo(q); anyOk = true; } catch { /* 两个都失败 */ } }
  searching = false;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (!searching) $('search-btn').disabled = false; }, 1000);   // 按钮至少冷却 1 s
  const ul = $('results');
  if (!list.length) { setStatus(anyOk ? TXT.noResult : TXT.searchErr, true); ul.hidden = true; return; }
  setStatus('');
  let html = '', lastKind = null;
  list.forEach((c, i) => {
    if (c.kind !== lastKind) { html += `<li class="grp"><i style="background:${KIND_COLORS[c.kind]}"></i>${esc(TXT.kind[c.kind])}</li>`; lastKind = c.kind; }
    html += `<li><button type="button" data-i="${i}"><span class="kchip" style="background:${KIND_COLORS[c.kind]}">${esc(TXT.kind[c.kind])}</span><span class="nm">${esc(c.name)}</span><div class="sub">${esc(c.sub)}</div></button></li>`;
  });
  ul.innerHTML = html;
  ul.hidden = false;
  ul.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { ul.hidden = true; pickCandidate(list[+b.dataset.i]); }));
}

async function pickCandidate(c) {
  const tk = ++pickToken;
  const tokenAtStart = S.token;
  if (c.kind === 'place') {
    S.wSel = null;
    drawOverlays();
    choosePlace(c.lat, c.lon, c.label || [c.name, c.sub.split(TXT.sep)[0]].filter(Boolean).join(TXT.sep), {});
    return;
  }
  S.wSel = { name: c.name, kind: c.kind, water: c.water, geom: c.geom };
  hideNearby();
  const mapOk = await openMap();
  if (tk !== pickToken || S.token !== tokenAtStart) return;   // 地图加载期间用户又选了别的地点
  drawOverlays(true);
  if (c.kind === 'river' && c.geom && geomSpanM(c.geom) > LONG_RIVER_M) {
    if (mapOk) {
      // 长河：等用户在高亮线上点一下再算
      setStatus(TXT.longRiver(c.name));
      $('map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // 地图不可用：退化为离候选点最近的河段，别让用户对着隐藏的地图干瞪眼
    const s = snapToGeom(c.lat, c.lon, c.geom);
    await choosePlace(s.lat, s.lon, c.name, { water: c.water, keepSel: true, segment: c.name });
    if (S.out && Math.abs(S.lat - s.lat) < 1e-9 && Math.abs(S.lon - s.lon) < 1e-9) setStatus(TXT.longRiverNoMap(c.name), true);
    return;
  }
  let lat = c.lat, lon = c.lon;
  if (c.kind === 'river' && c.geom) { const s = snapToGeom(lat, lon, c.geom); lat = s.lat; lon = s.lon; }
  choosePlace(lat, lon, c.name, { water: c.water, keepSel: true });
}

// 反查地名（Nominatim，失败就不显示）。segment=水体名时拼成「汉江·襄阳段」
async function reverseName(lat, lon, token, segment, setName = true) {
  try {
    const j = await nomi('reverse', { lat: lat.toFixed(5), lon: lon.toFixed(5), zoom: segment ? '10' : '12' });
    if (token !== S.token) return;
    const a = j.address || {};
    const city = a.city || a.county || a.town || a.state || '';
    const cityChanged = city && city !== S.city;
    S.city = city;
    let label;
    if (segment) {
      const pl = String(a.city || a.county || a.district || a.town || a.state || '').replace(/(市|县|区)$/, '');
      label = pl ? TXT.segment(segment, pl) : segment;
    } else {
      const nm = j.name || a.water || a.village || a.town || a.suburb || a.city_district || a.county || a.city || a.state || '';
      const up = a.city || a.county || a.state || '';
      label = [nm, up && up !== nm ? up : ''].filter(Boolean).join(TXT.sep);
    }
    if (label && (setName || segment)) {
      S.name = label;
      syncUrl();
      saveRecent();
      recompute();
    } else if (cityChanged) {
      recompute();
    }
  } catch { /* 不显示地名 */ }
}

// ───────── Overpass：水域识别 + 附近有名字的水体（同一个请求，带裁剪几何） ─────────
const overpassCache = new Map();
function overpassAround(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (overpassCache.has(key)) return overpassCache.get(key);
  const p = (async () => {
    const body = 'data=' + encodeURIComponent(overpassQuery(lat, lon, true));
    for (const url of OVERPASS_MIRRORS) {   // 镜像依次试，单个 12 s，不重试
      try {
        const j = await getJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 12000);
        if (j && Array.isArray(j.elements)) return j;
      } catch { /* 换下一个镜像 */ }
    }
    return null;
  })();
  overpassCache.set(key, p);
  p.then((j) => { if (!j) overpassCache.delete(key); });
  return p;
}
async function detectWater(token) {
  if (S.wUser || S.wPreset) return;
  S.wAuto = 'pending';
  setStatus(TXT.detecting);
  const j = await overpassAround(S.lat, S.lon);
  if (token !== S.token) return;
  if (!j) { S.wAuto = 'fail'; if (!S.wUser) setStatus(TXT.detectFail); recompute(); return; }
  S.wAuto = classifyWater(j, marineAvailable(S.marine));   // coastline 且 marine 非空才判 sea
  if (!S.wUser) setStatus(S.wAuto === 'unknown' ? TXT.detectNone : TXT.detected(TXT.water[S.wAuto]));
  recompute();
}

/** Overpass 元素 → {kind, water}（与 classifyWater 同口径，但逐个元素判） */
function tagKind(t) {
  if (/^(river|stream|canal)$/.test(t.waterway || '')) return { kind: 'river', water: 'river' };
  if (t.water === 'reservoir' || t.landuse === 'reservoir') return { kind: 'reservoir', water: 'reservoir' };
  if (t.water === 'lake') return { kind: 'lake', water: 'lake' };
  if (t.water === 'pond' || t.water === 'fishpond' || t.landuse === 'aquaculture') return { kind: 'pond', water: 'pond' };
  if (t.water === 'river' || t.water === 'canal') return { kind: 'river', water: 'river' };
  if (t.natural === 'coastline') return { kind: 'sea', water: 'sea' };
  if (t.natural === 'water') return { kind: 'lake', water: 'lake' };
  return null;
}
/** Overpass out geom → GeoJSON（闭合的水面 way 当多边形；relation 的成员当线，裁剪后的断点拆开） */
function elGeom(el) {
  const toLines = (pts) => {
    const lines = [[]];
    for (const p of pts || []) { if (p && p.lat != null) lines[lines.length - 1].push([p.lon, p.lat]); else if (lines[lines.length - 1].length) lines.push([]); }
    return lines.filter((l) => l.length);
  };
  if (el.type === 'way') {
    const ls = toLines(el.geometry);
    const t = el.tags || {};
    if (ls.length === 1 && ls[0].length > 3 && !t.waterway) {
      const a = ls[0][0], b = ls[0][ls[0].length - 1];
      if (a[0] === b[0] && a[1] === b[1]) return { type: 'Polygon', coordinates: ls };
    }
    return { type: 'MultiLineString', coordinates: ls };
  }
  if (el.type === 'relation') return { type: 'MultiLineString', coordinates: (el.members || []).flatMap((m) => toLines(m.geometry)) };
  if (el.type === 'node') return { type: 'Point', coordinates: [el.lon, el.lat] };
  return null;
}

let nearbyToken = 0;
async function showNearby(lat, lon) {
  const tk = ++nearbyToken;
  const box = $('nearby');
  box.hidden = false;
  box.innerHTML = `<p class="small muted">${esc(TXT.nearbyLoading)}</p>`;
  const j = await overpassAround(lat, lon);
  if (tk !== nearbyToken) return;
  if (!j) { box.innerHTML = `<p class="small muted">${esc(TXT.nearbyFail)}</p>`; return; }
  const groups = new Map();
  for (const el of j.elements) {
    const t = el.tags || {};
    if (!t.name) continue;
    const k = tagKind(t);
    if (!k) continue;
    const g = elGeom(el);
    if (!g) continue;
    const key = `${k.kind}|${t.name}`;
    if (!groups.has(key)) groups.set(key, { name: t.name, kind: k.kind, water: k.water, geoms: [] });
    groups.get(key).geoms.push(g);
  }
  const cands = [...groups.values()].map((c) => {
    const geom = c.geoms.length === 1 ? c.geoms[0] : { type: 'GeometryCollection', geometries: c.geoms };
    return { ...c, geom, dist: snapToGeom(lat, lon, geom).dist };
  }).filter((c) => Number.isFinite(c.dist)).sort((a, b) => a.dist - b.dist).slice(0, 8);
  S.nearby = cands;
  drawOverlays();
  if (!cands.length) { box.innerHTML = `<p class="small muted">${esc(TXT.nearbyNone)}</p>`; return; }
  box.innerHTML = `<p class="small">${esc(TXT.nearbyTitle)}</p><div class="near-list">` +
    cands.map((c, i) => `<button type="button" data-i="${i}"><span class="kchip" style="background:${KIND_COLORS[c.kind]}">${esc(TXT.kind[c.kind])}</span>${esc(c.name)} <span class="muted small">${esc(fmtDist(c.dist))}</span></button>`).join('') +
    `<button type="button" class="use-point">${esc(TXT.usePoint)}</button></div>`;
  box.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
    const c = cands[+b.dataset.i];
    S.wSel = { name: c.name, kind: c.kind, water: c.water, geom: c.geom };
    hideNearby();
    const s = snapToGeom(lat, lon, c.geom);
    choosePlace(s.lat, s.lon, c.kind === 'river' ? c.name : c.name, { water: c.water, keepSel: true, segment: c.kind === 'river' ? c.name : null });
    drawOverlays();
  }));
  box.querySelector('.use-point').addEventListener('click', hideNearby);
}
function hideNearby() {
  nearbyToken++;
  S.nearby = [];
  const box = $('nearby');
  if (box) box.hidden = true;
  drawOverlays();
}

// ───────── 主流程 ─────────
/**
 * @param {object} opts  water：由所选水体直接决定的类型（不跑 Overpass）；keepSel：保留水体高亮；segment：河名（反查城市拼「河·城市段」）
 */
async function choosePlace(lat, lon, name, opts = {}) {
  const token = ++S.token;
  if (YINGTAN_ONLY && !insideYingtan(+lat, +lon)) { lat = DEFAULT_POINT.lat; lon = DEFAULT_POINT.lon; name = DEFAULT_POINT.name; }
  S.lat = +lat; S.lon = ((+lon + 540) % 360) - 180; S.name = name || '';
  S.fc = null; S.marine = null; S.flood = null; S.out = null; S.sel = 0; S.wAuto = null; S.today = null;
  S.city = YINGTAN_ONLY ? YINGTAN_CITY : null;
  S.wPreset = opts.water || null;
  if (!opts.keepSel) S.wSel = null;
  hideNearby();   // 换钓点时清掉旧点的附近水体、旧高亮和在途请求
  syncUrl();
  document.title = S.name ? `${S.name} - ${BASE_TITLE}` : BASE_TITLE;
  $('empty').hidden = true;
  hideForecastError();
  $('result').hidden = true;
  $('loading').hidden = false;
  $('loading').textContent = TXT.loadingWx;
  drawOverlays();
  const marineP = getJSON(marineUrl(S.lat, S.lon), {}, 15000).catch(() => null);
  const floodP = getJSON(floodUrl(S.lat, S.lon), {}, 15000).catch(() => null);
  const fcPrimaryP = getJSON(forecastUrl(S.lat, S.lon, { model: PRIMARY_FORECAST_MODEL }), {}, 20000).catch(() => null);
  const fcFallbackP = getJSON(forecastUrl(S.lat, S.lon, { model: FALLBACK_FORECAST_MODEL }), {}, 20000).catch(() => null);
  if (YINGTAN_ONLY) {
    if (S.name) saveRecent();
  } else {
    reverseName(S.lat, S.lon, token, opts.segment, !S.name);
    if (S.name) saveRecent();
  }
  try {
    const [primary, fallback, marine, flood] = await Promise.all([fcPrimaryP, fcFallbackP, marineP, floodP]);
    if (token !== S.token) return;
    const fc = mergeForecast(primary, fallback);
    if (!fc) throw new Error('no forecast');
    S.fc = fc; S.marine = marine; S.flood = flood;
    S.today = localToday(fc);
    recompute();
    if (!S.out || !S.out.days.length) return;
    if (S.wUser) setStatus(TXT.userWater(TXT.water[S.wUser]));
    else if (S.wPreset) setStatus(S.wSel ? TXT.selWater(S.wSel.name, TXT.kind[S.wSel.kind], TXT.water[S.wPreset]) : TXT.detected(TXT.water[S.wPreset]));
    else detectWater(token);
  } catch {
    if (token !== S.token) return;
    if (!S.fc) {
      $('loading').hidden = true;
      $('result').hidden = true;
      $('empty').hidden = true;
      showForecastError(TXT.wxErr);
      setStatus('');
    }
  }
}

function currentWater() {
  if (S.wUser) return { water: S.wUser, src: 'user' };
  if (S.wPreset) return { water: S.wPreset, src: 'osm' };
  if (S.wAuto && !['pending', 'fail', 'unknown'].includes(S.wAuto)) return { water: S.wAuto, src: 'osm' };
  return { water: 'unknown', src: 'default' };
}

const CITY_ALIASES = {
  '鹰潭': '鹰潭市', '贵溪': '鹰潭市', '贵溪市': '鹰潭市',
  '余江': '鹰潭市', '余江区': '鹰潭市', '月湖': '鹰潭市', '月湖区': '鹰潭市',
};
function cityKey(c) { const s = String(c || '').trim(); return CITY_ALIASES[s] || s; }
function currentOxygen() {
  const city = cityKey(S.city);
  const c = city && S.oxygenData?.cities?.[city];
  if (!c || c.do == null) return null;
  return { value: c.do, unit: 'mg/L', count: c.count, time: c.time, source: 'national-city-average' };
}
async function loadOxygenData() {
  try {
    const r = await fetch('/data/oxygen.json', { cache: 'no-store' });
    if (!r.ok) return;
    S.oxygenData = await r.json();
    recompute();
  } catch { /* 没有数据就用 v0.4 代理 */ }
}
const CN_TTL_MS = 12 * 3600 * 1000;
function cnFresh() {
  const t = Date.parse(S.weatherCn?.fetched_at || '');
  return Number.isFinite(t) && Date.now() - t <= CN_TTL_MS;
}
async function loadWeatherCnData() {
  try {
    const r = await fetch('/data/weather-cn.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!Array.isArray(j?.days)) return;
    S.weatherCn = j;
    if (S.days && S.days[S.sel]) renderWeather(S.days[S.sel]);
  } catch { /* 没有数据/过期就回退 Open-Meteo */ }
}

function recompute() {
  if (!S.fc) return;
  const { water, src } = currentWater();
  const opts = {
    forecast: S.fc, marine: S.marine, flood: S.flood, oxygen: currentOxygen(),
    water, waterSource: src, name: S.name, lang: LANG,
    now: S.today || localToday(S.fc), days: FORECAST_DAYS, style: YINGTAN_ONLY ? 'taiwan' : undefined,
  };
  const outputs = [];
  for (const key of TARGET_SPECIES) {
    try {
      const out = computeForecast({ ...opts, species: key });
      // v0.5 旧模型：只附带对比数据，不替换 v0.7 主分数
      try {
        const shadow = computeForecast({ ...opts, species: key, model: '0.5' });
        out.shadow = {
          model_version: shadow.model_version,
          weights: shadow.weights,
          days: shadow.days.map((d) => ({ date: d.date, score: d.score, level: d.level, day_cap: d.day_cap })),
        };
      } catch { /* 影子模型失败不影响主结果 */ }
      const sp = SPECIES.find((s) => s.key === key);
      outputs.push({ key, name: LANG === 'en' ? (sp?.en || key) : (sp?.name || key), out });
    } catch (e) {
      console.error(`[${key}]`, e);
    }
  }
  if (!outputs.length) {
    S.out = null;
    S.outs = null;
    S.days = null;
    S.alerts = [];
    $('loading').hidden = true;
    $('result').hidden = true;
    $('empty').hidden = true;
    showForecastError(TXT.wxErr);
    setStatus('');
    return;
  }
  S.outs = Object.fromEntries(outputs.map((o) => [o.key, o.out]));
  const dates = outputs[0].out.days.map((d) => d.date);
  S.days = bestByDate(outputs, dates).filter((x) => x.ranking.length);
  S.alerts = mergeAlerts(outputs);
  if (!S.days.length) {
    S.out = null;
    $('loading').hidden = true;
    $('result').hidden = true;
    $('empty').hidden = true;
    showForecastError(TXT.noDays);
    setStatus('');
    return;
  }
  if (S.sel >= S.days.length) S.sel = 0;
  const entry = S.days[S.sel];
  if (!entry.ranking.some((r) => r.key === S.focus)) S.focus = entry.top.key;
  S.out = S.outs[S.focus];
  $('loading').hidden = true;
  hideForecastError();
  $('empty').hidden = true;
  $('result').hidden = false;
  renderPlace();
  renderAlerts();
  renderDays();
  renderDetail();
}

// ───────── 渲染 ─────────
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function dateLabel(date, i) {
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const today = S.today || (S.fc ? localToday(S.fc) : null);
  let rel = TXT.week[w];
  if (today && date === today) rel = TXT.today;
  else if (today && date === addDays(today, 1)) rel = TXT.tomorrow;
  return { rel, full: TXT.dateFmt(m, d, TXT.week[w]), short: TXT.shortDate(m, d) };
}

function flagLabels(day) {
  return dayFlagKeys(day).map((k) => (k === 'cap'
    ? TXT.capped((day.cap_kinds || []).map((x) => TXT.kinds[x]))
    : TXT.kinds[k])).filter(Boolean);
}

function renderPlace() {
  if (!S.out) return;
  const p = S.out.place;
  $('place-name').textContent = S.name || TXT.unnamed;
  $('place-meta').textContent = TXT.placeMeta(p, TXT.water[p.water], TXT.wsrc[p.water_source])
    + (S.out.oxygen ? `${TXT.sep}${TXT.oxygenMeta(S.out.oxygen)}` : '');
}
function updateTitle() {
  const top = S.days?.[S.sel]?.top;
  if (!top) return;
  const lb = dateLabel(S.days[S.sel].date, S.sel);
  document.title = TXT.title(S.name || TXT.unnamed, lb.rel, top.score);
}

function renderAlerts() {
  const idx = new Map((S.days || []).map((d, i) => [d.date, i]));
  const items = (S.alerts || []).map((a) => {
    const i = idx.get(a.date);
    if (i == null) return null;
    const lb = dateLabel(a.date, i);
    return TXT.alertItem(`${lb.rel} ${lb.short}`, a.line);
  }).filter(Boolean);
  $('alert-box').hidden = !items.length;
  $('alert-title').textContent = TXT.alertTitle;
  $('alert-list').innerHTML = items.map((x) => `<li>${esc(x)}</li>`).join('');
}

function renderDays() {
  const box = $('days');
  box.innerHTML = (S.days || []).map((entry, i) => {
    const top = entry.top;
    if (!top) return '';
    const d = top.day;
    const lb = dateLabel(entry.date, i);
    const win = top.windows[0] ? `${top.windows[0].start}–${top.windows[0].end}` : TXT.noWin;
    const flags = flagLabels(d);
    const warm = allOptimal(entry);
    return `<button type="button" class="day" data-i="${i}" aria-pressed="${i === S.sel}">
      <div class="dname">${esc(lb.rel)} ${esc(lb.short)}</div>
      <div class="score c${top.level_index}">${top.score}</div>
      <div class="sp">${esc(warm ? TXT.allOptimalShort : top.name)}</div>
      <span class="lv b${top.level_index}">${esc(top.level)}</span>
      <div class="wt">${esc(TXT.waterTemp(d.water_temp))}</div>
      <div class="win">${esc(win)}</div>
      ${flags.length ? `<div class="flag${d.day_cap != null ? ' cap' : ''}">${esc(flags.join(' · '))}</div>` : ''}
    </button>`;
  }).join('');
  box.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => {
    S.sel = +b.dataset.i;
    const entry = S.days[S.sel];
    S.focus = entry.top.key;
    S.rankOpen = false;
    S.out = S.outs[S.focus];
    box.querySelectorAll('.day').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderDetail();
  }));
}

function renderWeather(entry) {
  const el = $('d-weather');
  const w = summarizeDay(S.fc, entry.date);
  const cn = cnFresh() ? S.weatherCn : null;
  const cnDay = cn?.days?.find((d) => d.date === entry.date);
  if (!w && !cnDay) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;

  const isToday = entry.date === (S.today || (S.fc ? localToday(S.fc) : null));
  const omWind = w && w.windDir != null && w.windLevel != null ? TXT.wind(TXT.dirs[w.windDir], w.windLevel) : '—';
  const omRain = w?.rainProb == null ? '—' : TXT.rainProb(Math.round(w.rainProb));
  const omHum = w?.humidity == null ? '—' : TXT.humidity(Math.round(w.humidity));
  let kind;
  let temp;
  let wind;
  let rain;
  let hum;
  let label;
  let source;

  if (cnDay) {
    const cur = isToday ? cn.current : null;
    const text = cur?.text || cnDay.text || '';
    kind = cnKind(text);
    if (kind === 'unknown' && w?.kind) kind = w.kind;
    const showNow = isToday && cur?.temp != null;
    const range = cnDay.low == null || cnDay.high == null ? '—' : TXT.tempRange(fmt(cnDay.low), fmt(cnDay.high));
    temp = showNow
      ? (range === '—' ? `${fmt(cur.temp)}℃` : `${fmt(cur.temp)}℃（${fmt(cnDay.low)}–${fmt(cnDay.high)}℃）`)
      : range;
    const h = cnDay.hourly?.find((x) => x.time === '14:00') || cnDay.hourly?.[0];
    const wp = cnWindParts(cur?.windDir || h?.windDir, cur?.windLevel || h?.windLevel);
    wind = wp.dir != null && wp.level != null ? TXT.wind(TXT.dirs[wp.dir], wp.level) : omWind;
    rain = omRain;
    hum = cur?.humidity != null ? TXT.humidity(Math.round(cur.humidity)) : omHum;
    label = `${showNow ? TXT.now : TXT.daytime} ${TXT.weather[kind] || TXT.weather.unknown}`;
    source = TXT.wxSourceCn;
  } else {
    kind = w.kind;
    const range = w.tempMin == null || w.tempMax == null ? '—' : TXT.tempRange(fmt(w.tempMin), fmt(w.tempMax));
    temp = w.now && w.temp != null
      ? (range === '—' ? `${fmt(w.temp)}℃` : `${fmt(w.temp)}℃（${fmt(w.tempMin)}–${fmt(w.tempMax)}℃）`)
      : range;
    wind = omWind;
    rain = omRain;
    hum = omHum;
    label = `${w.now ? TXT.now : TXT.daytime} ${TXT.weather[w.kind] || TXT.weather.unknown}`;
    source = TXT.wxSourceOm;
  }

  const icon = WX_ICONS[kind] || WX_ICONS.unknown;
  const lb = dateLabel(entry.date, S.sel);
  el.innerHTML = `<div class="wx-main">
      <span class="wx-place">${esc(TXT.wxPlace)} · ${esc(lb.rel)} ${esc(lb.short)}</span>
      <span class="wx-icon" aria-hidden="true">${icon}</span>
      <span class="wx-kind">${esc(label)}</span>
      <span class="wx-temp">${esc(temp)}</span>
    </div>
    <div class="wx-sub">${esc([wind, rain, hum].join(TXT.sep))}</div>
    <div class="wx-source">${esc(source)}</div>`;
}

function renderBest(entry, focus) {
  const el = $('d-best');
  const top = entry.top;
  const item = focus || top;
  el.hidden = !item;
  if (!item) { el.innerHTML = ''; return; }
  const win = item.windows[0] ? `${item.windows[0].start}–${item.windows[0].end}` : TXT.noWin;
  const winWhy = item.day.best_why ? [item.day.best_why.time, item.day.best_why.wind].filter(Boolean).join(TXT.sep) : '';
  const warm = allOptimal(entry);
  const gap = item.key === top.key && entry.ranking[1] && top.score - entry.ranking[1].score <= 3;
  const flags = flagLabels(item.day);
  const n = entry.ranking.length;
  const sp = SPECIES.find((x) => x.key === item.key);
  const why = !warm && sp ? TXT.tempWhy(item.name, fmt(item.day.water_temp), sp.opt_lo, sp.opt_hi) : '';
  const label = warm ? TXT.rankLabel : item.key === top.key ? TXT.bestLabel : TXT.viewLabel;
  const title = warm ? TXT.allOptimalTitle(n) : item.name;
  el.innerHTML = `<div class="best-head">
      <span class="best-label">${esc(label + TXT.colon)}</span>
      <span class="best-sp">${esc(title)}</span>
      <span class="big c${item.level_index}">${item.score}</span>
      <span class="lv b${item.level_index}">${esc(item.level)}</span>
      ${flags.length ? `<span class="best-flag">${esc(flags.join(' · '))}</span>` : ''}
    </div>
    ${warm
      ? `<p class="best-why">${esc(TXT.allOptimal(n))}</p>`
      : `<p class="best-why">${esc(TXT.rankLabel)}${esc(TXT.colon)}${esc(why)}</p>`}
    <div class="best-win">${esc(TXT.bestWindow)} ${esc(win)}</div>
    ${winWhy ? `<div class="best-win-why">${esc(TXT.winWhyLabel)}${esc(TXT.colon)}${esc(winWhy)}</div>` : ''}
    ${warm ? '' : `<ul class="best-tips">${(item.day.advice || []).slice(0, 3).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`}
    ${!warm && gap ? `<p class="best-gap">${esc(TXT.closeGap)}</p>` : ''}`;
}

function renderRank(entry) {
  const el = $('d-rank');
  const ranking = entry.ranking;
  const top = entry.top;
  el.hidden = ranking.length < 2;
  if (el.hidden) { el.innerHTML = ''; return; }
  const warm = allOptimal(entry);
  const shown = S.rankOpen ? ranking : ranking.slice(0, 3);
  el.innerHTML = `<div class="rank-head">${esc(TXT.rankLabel)}</div>` + shown.map((r) => {
    const win = r.windows[0] ? `${r.windows[0].start}–${r.windows[0].end}` : TXT.noWin;
    const flags = flagLabels(r.day);
    return `<button type="button" class="rank-row" data-key="${esc(r.key)}" aria-pressed="${r.key === S.focus}">
      <span class="rank-sp">${esc(r.name)}${!warm && r.key === top.key ? `<span class="top-badge">${esc(TXT.topBadge)}</span>` : ''}${flags.length ? `<span class="rank-flag">${esc(flags.join(' · '))}</span>` : ''}</span>
      <span class="rank-score c${r.level_index}">${r.score}</span>
      <span class="rank-lv b${r.level_index}">${esc(r.level)}</span>
      <span class="rank-win">${esc(win)}</span>
    </button>`;
  }).join('') + (ranking.length > 3 ? `<button type="button" class="rank-more">${esc(S.rankOpen ? TXT.collapse : TXT.expand(ranking.length))}</button>` : '');
  el.querySelectorAll('.rank-row').forEach((b) => b.addEventListener('click', () => {
    S.focus = b.dataset.key;
    S.out = S.outs[S.focus];
    renderDetail();
  }));
  const more = el.querySelector('.rank-more');
  if (more) more.addEventListener('click', () => { S.rankOpen = !S.rankOpen; renderDetail(); });
}

function renderDetail() {
  const entry = S.days && S.days[S.sel];
  const top = entry && entry.top;
  const out = S.focus && S.outs && S.outs[S.focus];
  if (!entry || !top || !out) { $('result').hidden = true; return; }
  const focusItem = entry.ranking.find((r) => r.key === S.focus) || top;
  const d = out.days.find((x) => x.date === entry.date) || focusItem.day;
  const lb = dateLabel(entry.date, S.sel);
  $('d-title').textContent = lb.rel === TXT.week[new Date(entry.date + 'T00:00Z').getUTCDay()] ? lb.full : `${lb.rel} ${lb.full}`;
  $('d-score').textContent = focusItem.score;
  $('d-score').className = 'big c' + focusItem.level_index;
  $('d-level').textContent = focusItem.level;
  $('d-level').className = 'lv b' + focusItem.level_index;
  $('d-lvdesc').textContent = focusItem.day.level_text || TXT.lvDesc[focusItem.level_index];
  renderWeather(entry);
  renderBest(entry, focusItem);
  renderRank(entry);
  const sp = SPECIES.find((x) => x.key === S.focus);
  const warm = allOptimal(entry);
  $('d-focus').textContent = TXT.focusLabel(LANG === 'en' ? (sp?.en || S.focus) : (sp?.name || S.focus), !warm && S.focus === top.key);
  $('d-meta').textContent = TXT.meta(d);
  const sh = (S.out.shadow?.days || []).find((x) => x.date === entry.date);
  const shEl = $('d-shadow');
  shEl.hidden = !sh;
  shEl.textContent = sh ? TXT.shadow(S.out.shadow.model_version, sh.score) : '';
  $('d-wins').innerHTML = d.windows.length ? d.windows.map((w) => `<span>${w.start}–${w.end} · ${w.score}</span>`).join('') : `<span>${esc(TXT.noWin)}</span>`;
  const weights = S.out.weights || WEIGHTS;
  const keys = Object.keys(weights);
  $('d-subs').innerHTML = keys.map((k, i) => {
    const v = d.sub[k];
    const col = v >= 80 ? LV_COLORS[0] : v >= 65 ? LV_COLORS[1] : v >= 50 ? LV_COLORS[2] : v >= 35 ? LV_COLORS[3] : LV_COLORS[4];
    return `<div class="sub-row"><div class="top-line"><span><b>${esc(TXT.subs[k])}</b> <span class="small muted">${esc(TXT.weight(weights[k]))}</span></span><b>${v}</b></div>
      <div class="bar"><i style="width:${v}%;background:${col}"></i></div><div class="why">${esc(d.reasons[i] || '')}</div></div>`;
  }).join('');
  $('d-advice').innerHTML = d.advice.map((a) => `<li>${esc(a)}</li>`).join('');
  $('d-safety-wrap').hidden = !d.alerts.length;
  $('d-safety').innerHTML = d.alerts.map((a) => `<li>${esc(a.line)}</li>`).join('');
  $('d-ice').hidden = !d.ice;
  $('tip').textContent = TXT.tipHint;
  updateTitle();
  drawChart();
}

// ───────── 小时曲线（canvas 手绘） ─────────
let chartGeom = null;
function drawChart(hover = -1) {
  const date = S.days?.[S.sel]?.date;
  const d = S.out && date ? S.out.days.find((x) => x.date === date) : null;
  const cv = $('chart');
  if (!d || !cv.clientWidth) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = cv.clientWidth, Hh = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, Hh);
  const pad = { l: 30, r: 10, t: 18, b: 24 };
  const hrs = d.hours;
  const tm = (s) => { const [dd, hm] = s.split('T'); const [y, mo, da] = dd.split('-').map(Number); const [h, mi] = hm.split(':').map(Number); return Date.UTC(y, mo - 1, da, h, mi) / 60000; };
  const t0 = tm(hrs[0].t) - 30, t1 = tm(hrs[hrs.length - 1].t) + 30;
  const X = (t) => pad.l + (t - t0) / (t1 - t0) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - v / 100) * (Hh - pad.t - pad.b);
  const base = tm(d.date + 'T00:00');
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const winT = (w) => {
    let a = base + hm(w.start), b = base + hm(w.end);
    if (b < a) b += 1440;
    // 热季参与小时跨到次日 02:00：00:00/01:00/02:00 开头的窗口属于次日，不能画到当天早上
    if (hm(w.start) < 180) { a += 1440; b += 1440; }
    return [a, b];
  };

  // 危险红区（雷暴 / 大风 / 大浪）：先把连续小时合并成段，避免半透明色块叠加变深
  g.fillStyle = 'rgba(220,38,38,.16)';
  const danger = [];
  for (const h of hrs) {
    if (!h.flags.some((f) => f === 'thunder' || f === 'gale' || f === 'wave')) continue;
    const t = tm(h.t);
    const last = danger[danger.length - 1];
    if (last && t - last[1] <= 60) last[1] = t;
    else danger.push([t, t]);
  }
  for (const [a, b] of danger) g.fillRect(X(a - 30), pad.t, X(b + 30) - X(a - 30), Hh - pad.t - pad.b);
  // 最佳时段
  g.fillStyle = 'rgba(21,128,61,.14)';
  for (const w of d.windows) { const [a, b] = winT(w); const x0 = X(Math.max(a, t0)), x1 = X(Math.min(b, t1)); if (x1 > x0) g.fillRect(x0, pad.t, x1 - x0, Hh - pad.t - pad.b); }
  // 网格
  g.font = '11px ' + getComputedStyle(document.body).fontFamily;
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  for (const v of [0, 35, 50, 65, 80, 100]) {
    g.strokeStyle = v === 0 ? '#d6d3d1' : '#eeebe7';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad.l, Y(v) + .5); g.lineTo(W - pad.r, Y(v) + .5); g.stroke();
    g.fillStyle = '#a8a29e'; g.fillText(String(v), pad.l - 5, Y(v));
  }
  // 时间刻度
  g.textAlign = 'center'; g.textBaseline = 'top';
  const step = W < 420 ? 4 : 2;
  for (const h of hrs) {
    const t = tm(h.t), hh = new Date(t * 60000).getUTCHours();
    if (hh % step === 0) { g.fillStyle = '#78716c'; g.fillText(String(hh).padStart(2, '0'), X(t), Hh - pad.b + 6); }
  }
  // 日出日落
  g.strokeStyle = '#d97706'; g.setLineDash([4, 3]); g.lineWidth = 1.2; g.fillStyle = '#b45309'; g.textBaseline = 'bottom';
  for (const [lab, s] of [[TXT.sunrise, d.sunrise], [TXT.sunset, d.sunset]]) {
    if (!s) continue;
    const t = base + hm(s);
    if (t < t0 || t > t1) continue;
    g.beginPath(); g.moveTo(X(t), pad.t); g.lineTo(X(t), Hh - pad.b); g.stroke();
    g.fillText(`${lab} ${s}`, Math.min(Math.max(X(t), 40), W - 40), pad.t - 2);
  }
  g.setLineDash([]);
  // 小时分（细灰）
  g.strokeStyle = '#a8a29e'; g.lineWidth = 1.2;
  g.beginPath(); hrs.forEach((h, i) => { const x = X(tm(h.t)), y = Y(h.h); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  // 平滑分（粗）
  g.strokeStyle = '#0f766e'; g.lineWidth = 2.6; g.lineJoin = 'round';
  g.beginPath(); hrs.forEach((h, i) => { const x = X(tm(h.t)), y = Y(h.hs); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  // 悬停点
  if (hover >= 0 && hrs[hover]) {
    const h = hrs[hover], x = X(tm(h.t));
    g.strokeStyle = 'rgba(28,25,23,.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, Hh - pad.b); g.stroke();
    g.fillStyle = '#0f766e'; g.beginPath(); g.arc(x, Y(h.hs), 4, 0, Math.PI * 2); g.fill();
  }
  chartGeom = { X, tm, hrs };
}
function chartPointer(ev) {
  if (!chartGeom) return;
  const r = $('chart').getBoundingClientRect();
  const x = ev.clientX - r.left;
  let best = 0, bd = Infinity;
  chartGeom.hrs.forEach((h, i) => { const dd = Math.abs(chartGeom.X(chartGeom.tm(h.t)) - x); if (dd < bd) { bd = dd; best = i; } });
  const h = chartGeom.hrs[best];
  $('tip').textContent = TXT.tip(h.t.slice(11), h.h.toFixed(1), h.hs.toFixed(1));
  drawChart(best);
}

// ───────── 定位 ─────────
function gps() {
  if (!navigator.geolocation) { setStatus(TXT.gpsNo, true); return; }
  setStatus(TXT.gpsAsk);
  navigator.geolocation.getCurrentPosition(
    (p) => { setStatus(''); S.wSel = null; hideNearby(); choosePlace(p.coords.latitude, p.coords.longitude, ''); },   // GPS 本来就是 WGS-84
    () => setStatus(TXT.gpsErr, true),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
  );
}

// ───────── 地图（Leaflet，cdnjs 按需加载；默认高德底图，可切 OSM） ─────────
let map = null, tiles = null, overlay = null;
let leafletPromise = null;   // 共享加载 Promise，避免并发插入多份 Leaflet
let mapPromise = null;       // 共享初始化 Promise，避免 L.map('map') 被调用两次
const LEAFLET_TIMEOUT = 10000; // CDN 被挂起时别让整个选点流程卡死
const toMap = (lat, lon) => (S.basemap === 'amap' ? wgs84ToGcj02(lat, lon) : [lat, lon]);
const fromMap = (ll) => (S.basemap === 'amap' ? gcj02ToWgs84(ll.lat, ll.lng) : [ll.lat, ll.lng]);

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    const timer = setTimeout(() => {
      s.onload = s.onerror = null;
      rej(new Error('leaflet timeout'));
    }, LEAFLET_TIMEOUT);
    const done = (fn) => { clearTimeout(timer); s.onload = s.onerror = null; fn(); };
    s.onload = () => done(() => (window.L ? res(window.L) : rej(new Error('no L'))));
    s.onerror = () => done(() => rej(new Error('leaflet load error')));
    document.head.appendChild(s);
  });
  // 失败后清空，允许用户再点一次重试；如果脚本后来自己加载成功，window.L 仍在。
  leafletPromise.catch(() => { leafletPromise = null; });
  return leafletPromise;
}
function setTiles() {
  const L = window.L;
  if (tiles) map.removeLayer(tiles);
  const osmAttr = LANG === 'en'
    ? 'Map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    : '底图 &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 贡献者';
  tiles = S.basemap === 'amap'
    ? L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: '1234', maxZoom: 18, attribution: TXT.amapAttr })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: osmAttr });
  tiles.addTo(map);
  $('map-attr').textContent = S.basemap === 'amap' ? TXT.amapAttr : TXT.osmAttr;
  document.querySelectorAll('.bm-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bm === S.basemap)));
}
/** 把 WGS-84 的标记 / 水体高亮 / 附近水体画到当前底图上（高德时逐点换成 GCJ-02） */
function drawOverlays(fit = false) {
  if (!map) return;
  const L = window.L;
  if (overlay) map.removeLayer(overlay);
  overlay = L.layerGroup().addTo(map);
  const c2l = (c) => L.latLng(...toMap(c[1], c[0]));
  for (const c of S.nearby || []) {
    L.geoJSON(c.geom, { coordsToLatLng: c2l, style: { color: KIND_COLORS[c.kind], weight: 3, opacity: 0.45, dashArray: '4 4', fillOpacity: 0.05 }, pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 4 }) }).addTo(overlay);
  }
  let hl = null;
  if (S.wSel && S.wSel.geom) {
    hl = L.geoJSON(S.wSel.geom, { coordsToLatLng: c2l, style: { color: KIND_COLORS[S.wSel.kind], weight: 5, opacity: 0.85, fillOpacity: 0.18 }, pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6 }) }).addTo(overlay);
  }
  if (S.lat != null) L.circleMarker(toMap(S.lat, S.lon), { radius: 7, color: '#fff', weight: 2, fillColor: '#b91c1c', fillOpacity: 1 }).addTo(overlay);
  if (fit && hl) { try { map.fitBounds(hl.getBounds(), { padding: [20, 20], maxZoom: 13 }); } catch { /* 空几何 */ } }
  else if (fit && S.lat != null) map.setView(toMap(S.lat, S.lon), 11);
}
async function openMap() {
  $('map-wrap').hidden = false;
  if (map) { map.invalidateSize(); return true; }
  if (mapPromise) return mapPromise;
  setStatus(TXT.mapLoading);
  mapPromise = (async () => {
    try {
      const L = await loadLeaflet();
      if (map) { map.invalidateSize(); return true; }
      const center = S.lat != null ? toMap(S.lat, S.lon) : YINGTAN_ONLY ? toMap(DEFAULT_POINT.lat, DEFAULT_POINT.lon) : [32, 112];
      const opts = { zoomControl: true };
      if (YINGTAN_ONLY) opts.maxBounds = L.latLngBounds(
        toMap(YINGTAN_BOUNDS.minLat, YINGTAN_BOUNDS.minLon),
        toMap(YINGTAN_BOUNDS.maxLat, YINGTAN_BOUNDS.maxLon));
      map = L.map('map', opts).setView(center, YINGTAN_ONLY ? 11 : S.lat != null ? 10 : 4);
      setTiles();
      map.on('click', (e) => onMapClick(fromMap(e.latlng)));
      drawOverlays();
      setStatus('');
      return true;
    } catch {
      setStatus(TXT.mapErr, true);
      $('map-wrap').hidden = true;
      return false;
    }
  })();
  try { return await mapPromise; } finally { mapPromise = null; }
}
function onMapClick([lat, lon]) {
  if (YINGTAN_ONLY && !insideYingtan(lat, lon)) { setStatus(TXT.onlyYingtan, true); return; }
  // 已选水体：点在它附近就吸附过去（长河就是在这里选河段）
  if (S.wSel && S.wSel.geom) {
    const s = snapToGeom(lat, lon, S.wSel.geom);
    if (s.dist <= SNAP_MAX_M) {
      hideNearby();
      choosePlace(s.lat, s.lon, S.wSel.name, { water: S.wSel.water, keepSel: true, segment: S.wSel.kind === 'river' ? S.wSel.name : null });
      return;
    }
    setStatus(TXT.tooFar);
  }
  // 点了别处：按原来的逻辑算这个点，同时列出附近有名字的水体供点选
  S.wSel = null;
  choosePlace(lat, lon, '', {});
  showNearby(lat, lon);
}
function switchBasemap(bm) {
  if (bm === S.basemap) return;
  const center = map ? fromMap(map.getCenter()) : null, zoom = map ? map.getZoom() : null;
  S.basemap = bm;
  lsSet(BASEMAP_KEY, bm);
  if (!map) return;
  setTiles();
  if (YINGTAN_ONLY) map.setMaxBounds(window.L.latLngBounds(
    toMap(YINGTAN_BOUNDS.minLat, YINGTAN_BOUNDS.minLon),
    toMap(YINGTAN_BOUNDS.maxLat, YINGTAN_BOUNDS.maxLon)));
  map.setView(toMap(center[0], center[1]), zoom, { animate: false });
  drawOverlays();
}

// 安卓 App 里页面地址是 https://appassets.androidplatform.net/…，分享出去要换成线上网址
const SITE_ORIGIN = 'https://fish.satloot.com';
function shareUrl() {
  if (location.hostname === 'appassets.androidplatform.net') return SITE_ORIGIN + location.pathname + location.search + location.hash;
  return location.href;
}
async function copyShare(ev) {
  ev.preventDefault();
  const url = shareUrl();
  // App 里调起系统分享面板（微信、QQ 等）
  if (window.FishApp && typeof window.FishApp.share === 'function') {
    try { window.FishApp.share(url, document.title); return; } catch { /* 退回复制 */ }
  }
  try { await navigator.clipboard.writeText(url); setStatus(TXT.copied); } catch { setStatus(TXT.copyFail, true); }
}

function shotFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `fish-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.png`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderFullPage() {
  if (!window.html2canvas) throw new Error('html2canvas missing');
  return window.html2canvas(document.body, {
    backgroundColor: '#f7f6f3',
    scale: 1,
    useCORS: true,
    logging: false,
    windowWidth: 1080,
    windowHeight: Math.max(document.documentElement.scrollHeight, 1440),
    scrollX: 0,
    scrollY: -window.scrollY,
    onclone: (doc) => {
      const top = doc.querySelector('.top');
      if (top) top.style.position = 'static';
      const status = doc.getElementById('status');
      if (status) status.style.visibility = 'hidden';
      const shot = doc.getElementById('shot-link');
      if (shot) shot.style.visibility = 'hidden';
      const modal = doc.getElementById('notes-modal');
      if (modal) modal.remove();
    },
  });
}

async function shareCard() {
  if (!S.days || !S.days[S.sel] || !S.days[S.sel].top) {
    setStatus(TXT.shotFail, true);
    return;
  }
  setStatus(TXT.shotWorking);
  try {
    const canvas = await renderFullPage();
    if (!canvas) throw new Error('no card');
    const name = shotFilename();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no blob');
    const file = new File([blob], name, { type: 'image/png' });
    let canShare = false;
    try { canShare = !!navigator.canShare && navigator.canShare({ files: [file] }); } catch { /* 下载兜底 */ }
    const mobileShare = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (mobileShare && canShare && typeof navigator.share === 'function') {
      try {
        await navigator.share({ files: [file], title: document.title, text: S.name || '' });
        setStatus(TXT.shotSaved);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { setStatus(TXT.shotCanceled); return; }
      }
    }
    downloadBlob(blob, name);
    setStatus(TXT.shotSaved);
  } catch (e) {
    setStatus(TXT.shotFail, true);
  }
}

// ───────── 启动 ─────────
S.basemap = lsGet(BASEMAP_KEY, 'amap') === 'osm' ? 'osm' : 'amap';
S.nearby = [];
initSelects();
function openNotes(ev) {
  if (ev) ev.preventDefault();
  const d = $('notes-modal');
  if (!d) return;
  if (typeof d.showModal === 'function') {
    if (!d.open) d.showModal();
  } else {
    d.setAttribute('open', '');
  }
}

function closeNotes() {
  const d = $('notes-modal');
  if (!d) return;
  if (typeof d.close === 'function') d.close();
  else d.removeAttribute('open');
}

$('share-link').addEventListener('click', copyShare);
$('shot-link').addEventListener('click', (ev) => { ev.preventDefault(); shareCard(); });
$('notes-open').addEventListener('click', openNotes);
document.querySelector('a[href="#notes"]')?.addEventListener('click', openNotes);
$('notes-close').addEventListener('click', closeNotes);
$('notes-close').setAttribute('aria-label', TXT.close);
$('notes-modal').addEventListener('click', (ev) => { if (ev.target === $('notes-modal')) closeNotes(); });
const cv = $('chart');
cv.addEventListener('pointermove', chartPointer);
cv.addEventListener('pointerdown', chartPointer);
let rT = 0;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => drawChart(), 120); });
readUrl();
loadOxygenData();
loadWeatherCnData();
if (YINGTAN_ONLY && S.lat == null) {
  S.wUser = 'river';
  $('w').value = 'river';
  choosePlace(DEFAULT_POINT.lat, DEFAULT_POINT.lon, DEFAULT_POINT.name, { water: 'river' });
}
