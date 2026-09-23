// coord.js 单测：node tools/test-coord.mjs
// 参考值：wgs84→gcj02(116.404, 39.915) = [116.41024449916938, 39.91640428150164]（coordtransform 开源库 README 的示例值）
import { wgs84ToGcj02, gcj02ToWgs84, outOfChina, snapToGeom, distM, pointInGeom, geomSpanM } from '../web/coord.js';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '通过' : '失败'}  ${msg}`); if (!cond) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. 北京（天安门附近）正算对上参考值
{
  const [lat, lon] = wgs84ToGcj02(39.915, 116.404);
  ok(near(lat, 39.91640428150164, 1e-9) && near(lon, 116.41024449916938, 1e-9), `北京 wgs→gcj = ${lat.toFixed(8)}, ${lon.toFixed(8)}`);
}
// 2. 偏移量级：国内几百米
for (const [name, la, lo] of [['上海', 31.2304, 121.4737], ['太湖', 31.2389, 120.1417], ['乌鲁木齐', 43.8256, 87.6168], ['三亚', 18.2528, 109.512], ['哈尔滨', 45.75, 126.65]]) {
  const [g1, g2] = wgs84ToGcj02(la, lo);
  const d = distM(la, lo, g1, g2);
  ok(d > 50 && d < 1000, `${name} 偏移 ${d.toFixed(0)} m（应在 50–1000 m）`);
  const [w1, w2] = gcj02ToWgs84(g1, g2);
  const back = distM(la, lo, w1, w2);
  ok(back < 0.01, `${name} 往返误差 ${(back * 100).toFixed(4)} cm`);
}
// 3. 境外不偏移
{
  ok(outOfChina(51.5, -0.12), '伦敦判为境外');
  const [la, lo] = wgs84ToGcj02(51.5, -0.12);
  ok(la === 51.5 && lo === -0.12, '伦敦不偏移');
  const [a, b] = gcj02ToWgs84(35.68, 139.76);
  ok(a === 35.68 && b === 139.76, '东京反算不偏移');
}
// 4. 吸附到线：水平线 y=30，从正上方 0.01° 吸附
{
  const line = { type: 'LineString', coordinates: [[120, 30], [120.1, 30]] };
  const s = snapToGeom(30.01, 120.05, line);
  ok(near(s.lat, 30, 1e-6) && near(s.lon, 120.05, 1e-6) && near(s.dist, 1112, 5), `吸附到河道：${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}，距离 ${s.dist.toFixed(0)} m`);
  const e = snapToGeom(30, 119.9, line);
  ok(near(e.lon, 120, 1e-9), '越过端点吸到端点');
}
// 5. 多边形：内部原样返回，外部吸到边
{
  const poly = { type: 'Polygon', coordinates: [[[120, 30], [120.1, 30], [120.1, 30.1], [120, 30.1], [120, 30]]] };
  ok(pointInGeom(30.05, 120.05, poly), '点在湖面内');
  const s = snapToGeom(30.05, 120.05, poly);
  ok(s.dist === 0, '湖面内不吸附');
  const o = snapToGeom(30.05, 120.2, poly);
  ok(near(o.lon, 120.1, 1e-9) && near(o.lat, 30.05, 1e-9), '湖外吸到湖岸');
  ok(near(geomSpanM(poly), distM(30, 120, 30.1, 120.1), 1), '外包框对角线');
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
