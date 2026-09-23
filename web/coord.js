// WGS-84 ↔ GCJ-02（「火星坐标」）换算 + 几何小工具。纯函数，浏览器与 Node 都能 import。
//
// 为什么要换：高德瓦片是 GCJ-02 坐标系，而 Open-Meteo / Nominatim / Overpass / GPS 全是 WGS-84。
//   - 画到高德底图之前：wgs84ToGcj02
//   - 用户在高德底图上点的位置：gcj02ToWgs84 反算回 WGS-84 再去查天气 / Overpass
//   - OSM 底图本身就是 WGS-84，不用换
// 境外（outOfChina）不做偏移，与高德行为一致。
// 正算公式为公开流传的 GCJ-02 近似算法（与 coordtransform 等开源实现一致）；反算用迭代，误差 < 1e-7 度（约 1 cm）。

const A = 6378245.0;
const EE = 0.00669342162296594323;
const PI = Math.PI;

export function outOfChina(lat, lon) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function tLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  r += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return r;
}
function tLon(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  r += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return r;
}
function delta(lat, lon) {
  let dLat = tLat(lon - 105.0, lat - 35.0);
  let dLon = tLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLon = (dLon * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [dLat, dLon];
}

/** WGS-84 → GCJ-02，返回 [lat, lon] */
export function wgs84ToGcj02(lat, lon) {
  if (outOfChina(lat, lon)) return [lat, lon];
  const [dLat, dLon] = delta(lat, lon);
  return [lat + dLat, lon + dLon];
}

/** GCJ-02 → WGS-84（迭代反解），返回 [lat, lon] */
export function gcj02ToWgs84(lat, lon) {
  if (outOfChina(lat, lon)) return [lat, lon];
  let wLat = lat, wLon = lon;
  for (let i = 0; i < 30; i++) {
    const [gLat, gLon] = wgs84ToGcj02(wLat, wLon);
    const eLat = gLat - lat, eLon = gLon - lon;
    wLat -= eLat; wLon -= eLon;
    if (Math.abs(eLat) < 1e-10 && Math.abs(eLon) < 1e-10) break;
  }
  return [wLat, wLon];
}

// ───────── 几何：吸附 / 距离（WGS-84 经纬度，局部等距投影，几公里量级足够准） ─────────
const R = 6371008.8;
/** 两点间大圆距离（米） */
export function distM(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * PI / 180, p2 = lat2 * PI / 180, dp = p2 - p1, dl = (lon2 - lon1) * PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 把 GeoJSON 几何拆成若干条线（多边形取边界环），坐标为 [lon, lat] */
export function geomLines(g) {
  if (!g) return [];
  switch (g.type) {
    case 'Point': return [[g.coordinates]];
    case 'MultiPoint': return g.coordinates.map((c) => [c]);
    case 'LineString': return [g.coordinates];
    case 'MultiLineString': return g.coordinates;
    case 'Polygon': return g.coordinates;
    case 'MultiPolygon': return g.coordinates.flat();
    case 'GeometryCollection': return g.geometries.flatMap(geomLines);
    default: return [];
  }
}

function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** 点是否落在（多）多边形水面里 */
export function pointInGeom(lat, lon, g) {
  if (!g) return false;
  if (g.type === 'GeometryCollection') return g.geometries.some((x) => pointInGeom(lat, lon, x));
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((rings) => pointInRing(lat, lon, rings[0]) && !rings.slice(1).some((h) => pointInRing(lat, lon, h)));
}

/**
 * 把点吸附到几何上最近的点。多边形：点在水面内就原样返回（距离 0）。
 * @returns {{lat:number, lon:number, dist:number}} dist 单位米
 */
export function snapToGeom(lat, lon, g) {
  if (pointInGeom(lat, lon, g)) return { lat, lon, dist: 0 };
  const kx = Math.cos(lat * PI / 180) * PI / 180 * R, ky = PI / 180 * R;   // 度 → 米
  let best = { lat, lon, dist: Infinity };
  for (const line of geomLines(g)) {
    if (!line.length) continue;
    if (line.length === 1) {
      const d = distM(lat, lon, line[0][1], line[0][0]);
      if (d < best.dist) best = { lat: line[0][1], lon: line[0][0], dist: d };
      continue;
    }
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][0] - lon) * kx, ay = (line[i - 1][1] - lat) * ky;
      const bx = (line[i][0] - lon) * kx, by = (line[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let t = L2 ? -(ax * dx + ay * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (d < best.dist) best = { lat: lat + py / ky, lon: lon + px / kx, dist: d };
    }
  }
  return best;
}

/** 几何外包框对角线长度（米），用来判断是不是「长河」 */
export function geomSpanM(g) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const line of geomLines(g)) for (const [x, y] of line) { s = Math.min(s, y); n = Math.max(n, y); w = Math.min(w, x); e = Math.max(e, x); }
  return Number.isFinite(s) ? distM(s, w, n, e) : 0;
}
