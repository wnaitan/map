/* NAVI OFFLINE - motor de rotas e dados de mapa (roda no navegador e no Node).
   Tudo aqui é cálculo sobre dados do OpenStreetMap guardados no aparelho. Nada de internet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Routing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const R = 6371008.8, D2R = Math.PI / 180, FOOT_V = 1.35;

  /* ---------- geometria ---------- */
  function dist(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / D2R + 360) % 360;
  }
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
  const CARD8 = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const CARD_FULL = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];
  const cardinal = d => CARD8[Math.round((((d % 360) + 360) % 360) / 45) % 8];
  const cardinalFull = d => CARD_FULL[Math.round((((d % 360) + 360) % 360) / 45) % 8];
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /* ---------- classes de vias ---------- */
  const HW = {
    motorway: { car: 90, foot: 0, rank: 0 }, motorway_link: { car: 60, foot: 0, rank: 0 },
    trunk: { car: 80, foot: 0, rank: 0 }, trunk_link: { car: 55, foot: 0, rank: 0 },
    primary: { car: 60, foot: 1, rank: 1 }, primary_link: { car: 40, foot: 1, rank: 1 },
    secondary: { car: 50, foot: 1, rank: 2 }, secondary_link: { car: 35, foot: 1, rank: 2 },
    tertiary: { car: 40, foot: 1, rank: 3 }, tertiary_link: { car: 30, foot: 1, rank: 3 },
    unclassified: { car: 35, foot: 1, rank: 4 }, residential: { car: 30, foot: 1, rank: 4 },
    living_street: { car: 15, foot: 1, rank: 4 }, road: { car: 30, foot: 1, rank: 4 },
    service: { car: 20, foot: 1, rank: 5, pen: 1.5 }, track: { car: 15, foot: 1, rank: 5, pen: 2.5 },
    pedestrian: { car: 0, foot: 1, rank: 6 }, footway: { car: 0, foot: 1, rank: 6 }, path: { car: 0, foot: 1, rank: 6 },
    steps: { car: 0, foot: 1, rank: 6, fpen: 2 }, cycleway: { car: 0, foot: 1, rank: 6 },
    bridleway: { car: 0, foot: 1, rank: 6 }, corridor: { car: 0, foot: 1, rank: 6 }
  };
  const rankOf = h => (HW[h] ? HW[h].rank : 6);

  /* ---------- leitura de dados do Overpass ---------- */
  const POI_PT = {
    hospital: 'Hospital', clinic: 'Clínica', pharmacy: 'Farmácia', doctors: 'Consultório', dentist: 'Dentista',
    school: 'Escola', university: 'Universidade', college: 'Faculdade', kindergarten: 'Creche', library: 'Biblioteca',
    fuel: 'Posto de combustível', restaurant: 'Restaurante', fast_food: 'Lanchonete', cafe: 'Café', bar: 'Bar', pub: 'Bar',
    bank: 'Banco', atm: 'Caixa eletrônico', police: 'Polícia', fire_station: 'Bombeiros', post_office: 'Correios',
    townhall: 'Prefeitura', courthouse: 'Fórum', place_of_worship: 'Igreja/Templo', marketplace: 'Mercado',
    bus_station: 'Rodoviária', cinema: 'Cinema', theatre: 'Teatro', community_centre: 'Centro comunitário',
    supermarket: 'Supermercado', bakery: 'Padaria', convenience: 'Conveniência', hairdresser: 'Cabeleireiro',
    hotel: 'Hotel', museum: 'Museu', attraction: 'Atração', park: 'Parque', stadium: 'Estádio',
    sports_centre: 'Centro esportivo', mall: 'Shopping', car_repair: 'Oficina', car_wash: 'Lava-jato',
    hardware: 'Material de construção', butcher: 'Açougue', clothes: 'Roupas', monument: 'Monumento',
    memorial: 'Memorial', viewpoint: 'Mirante', hostel: 'Hostel', guest_house: 'Pousada', zoo: 'Zoológico'
  };
  const poiLabel = v => POI_PT[v] || (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') : 'Local');
  const PLACES = { city: 1, town: 1, village: 1, hamlet: 1, suburb: 1, neighbourhood: 1, quarter: 1, locality: 1, borough: 1 };

  function parseSpeed(v) {
    if (!v) return 0;
    const m = /^\s*(\d+(?:\.\d+)?)\s*(mph)?/i.exec(String(v));
    if (!m) return 0;
    let s = parseFloat(m[1]); if (m[2]) s *= 1.609;
    return s > 0 && s <= 160 ? s : 0;
  }
  const NO = { no: 1, private: 1 }, YES = { yes: 1, permissive: 1, destination: 1, designated: 1, delivery: 1, customers: 1 };

  function parseOverpass(json) {
    const out = { ways: [], water: [], waterLines: [], parks: [], places: [], pois: [] };
    const els = (json && json.elements) || [];
    for (const e of els) {
      const t = e.tags || {};
      if (e.type === 'way') {
        // geometria (pode ter buracos null quando o Overpass corta)
        const segs = []; let cur = null;
        if (Array.isArray(e.geometry)) {
          for (let i = 0; i < e.geometry.length; i++) {
            const g = e.geometry[i];
            if (!g) { cur = null; continue; }
            if (!cur) { cur = { p: [], ids: [] }; segs.push(cur); }
            cur.p.push(+(+g.lat).toFixed(6), +(+g.lon).toFixed(6));
            cur.ids.push(e.nodes ? e.nodes[i] : e.id * 1000 + i);
          }
        }
        const hw = t.highway;
        if (hw && HW[hw]) {
          let o = 0;
          const ow = t.oneway;
          if (ow === 'yes' || ow === 'true' || ow === '1') o = 1;
          else if (ow === '-1' || ow === 'reverse') o = -1;
          else if (ow === 'no') o = 0;
          else if (t.junction === 'roundabout' || hw === 'motorway' || hw === 'motorway_link') o = 1;
          let noCar = !!(NO[t.access] || NO[t.vehicle] || NO[t.motor_vehicle]);
          if (YES[t.motor_vehicle]) noCar = false;
          let noFoot = !!(t.foot === 'no' || (t.access === 'no' && !YES[t.foot]));
          const a = (noCar ? 1 : 0) | (noFoot ? 2 : 0);
          const s = parseSpeed(t.maxspeed);
          const nm = t.name || t.ref || '';
          segs.forEach((sg, k) => {
            if (sg.ids.length < 2) return;
            out.ways.push({ id: segs.length > 1 ? e.id + ':' + k : e.id, h: hw, n: nm, o, s, a, rb: t.junction === 'roundabout' ? 1 : 0, p: sg.p, ids: sg.ids });
          });
          continue;
        }
        const wl = t.waterway;
        if (wl === 'river' || wl === 'stream' || wl === 'canal' || wl === 'drain') {
          for (const sg of segs) if (sg.ids.length >= 2) out.waterLines.push({ n: t.name || '', p: sg.p, big: wl === 'river' || wl === 'canal' ? 1 : 0 });
          continue;
        }
        const isWater = t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank' || t.water;
        const isPark = ['park', 'garden', 'nature_reserve', 'recreation_ground'].includes(t.leisure) ||
          ['forest', 'grass', 'recreation_ground', 'village_green', 'meadow', 'cemetery'].includes(t.landuse) ||
          ['wood', 'grassland', 'scrub'].includes(t.natural);
        if ((isWater || isPark) && segs.length === 1) {
          const sg = segs[0];
          if (sg.ids.length >= 4 && sg.ids[0] === sg.ids[sg.ids.length - 1]) (isWater ? out.water : out.parks).push({ n: t.name || '', p: sg.p });
        }
      }
      // pontos de interesse e bairros (nós, ou áreas com centro)
      const lat = e.lat !== undefined ? e.lat : e.center && e.center.lat, lon = e.lon !== undefined ? e.lon : e.center && e.center.lon;
      if (!t.name || lat === undefined || lon === undefined) continue;
      if (e.type === 'node' && PLACES[t.place]) { out.places.push({ n: t.name, lat: +lat, lon: +lon, pl: t.place }); continue; }
      const key = ['amenity', 'shop', 'tourism', 'historic', 'leisure', 'healthcare'].find(k => t[k]);
      if (key && t[key] !== 'yes') out.pois.push({ n: t.name, lat: +lat, lon: +lon, c: poiLabel(t[key]) });
    }
    return out;
  }

  /* ---------- grafo ---------- */
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    const k = this.k, v = this.v; if (!k.length) return -1;
    const rv = v[0], lk = k.pop(), lv = v.pop(), m = k.length;
    if (m) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= m) break; if (c + 1 < m && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return rv;
  };

  function buildGraph(lists) {
    const wm = new Map();
    for (const l of lists) for (const w of l) if (!wm.has(w.id)) wm.set(w.id, w);
    const idx = new Map(), nlat = [], nlon = [];
    const E = { from: [], to: [], len: [], car: [], foot: [], way: [] }, meta = [];
    const nid = (id, la, lo) => { let i = idx.get(id); if (i === undefined) { i = nlat.length; idx.set(id, i); nlat.push(la); nlon.push(lo); } return i; };
    for (const w of wm.values()) {
      const cls = HW[w.h]; if (!cls || !w.ids || w.ids.length < 2) continue;
      const mi = meta.length; meta.push({ n: w.n || '', h: w.h, rb: w.rb ? 1 : 0 });
      const cs = (cls.car && !(w.a & 1)) ? ((w.s > 0 ? Math.min(w.s * 0.85, 130) : cls.car) / 3.6) : 0;
      const pen = cls.pen || 1, footOk = cls.foot && !(w.a & 2), fpen = cls.fpen || 1;
      for (let k = 0; k + 1 < w.ids.length; k++) {
        const a = nid(w.ids[k], w.p[2 * k], w.p[2 * k + 1]), b = nid(w.ids[k + 1], w.p[2 * k + 2], w.p[2 * k + 3]);
        if (a === b) continue;
        const L = dist(nlat[a], nlon[a], nlat[b], nlon[b]);
        const tc = cs > 0 ? L / cs * pen : -1, tf = footOk ? L / FOOT_V * fpen : -1;
        E.from.push(a, b); E.to.push(b, a); E.len.push(L, L);
        E.car.push(w.o === -1 ? -1 : tc, w.o === 1 ? -1 : tc);
        E.foot.push(tf, tf); E.way.push(mi, mi);
      }
    }
    const N = nlat.length, M = E.from.length;
    const off = new Int32Array(N + 1);
    for (let i = 0; i < M; i++) off[E.from[i] + 1]++;
    for (let i = 0; i < N; i++) off[i + 1] += off[i];
    const pos = off.slice(0, N), where = new Int32Array(M);
    for (let i = 0; i < M; i++) where[i] = pos[E.from[i]]++;
    const to = new Int32Array(M), from = new Int32Array(M), len = new Float32Array(M), car = new Float32Array(M),
      foot = new Float32Array(M), way = new Int32Array(M), rev = new Int32Array(M);
    for (let i = 0; i < M; i++) {
      const s = where[i];
      to[s] = E.to[i]; from[s] = E.from[i]; len[s] = E.len[i]; car[s] = E.car[i]; foot[s] = E.foot[i]; way[s] = E.way[i]; rev[s] = where[i ^ 1];
    }
    const lat = Float64Array.from(nlat), lon = Float64Array.from(nlon);
    const cs = 0.002, grid = new Map(), key = (ix, iy) => (ix + 100000) * 400000 + (iy + 100000);
    for (let i = 0; i < M; i += 2) {
      const a = E.from[i], b = E.to[i], s = where[i];
      const x0 = Math.floor(Math.min(lon[a], lon[b]) / cs), x1 = Math.floor(Math.max(lon[a], lon[b]) / cs);
      const y0 = Math.floor(Math.min(lat[a], lat[b]) / cs), y1 = Math.floor(Math.max(lat[a], lat[b]) / cs);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = key(x, y); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(s);
      }
    }
    return { N, M, lat, lon, off, to, from, len, car, foot, way, rev, meta, grid, cs, key };
  }

  function snap(g, lat, lon, mode, maxD) {
    maxD = maxD || 300;
    const cost = mode === 'foot' ? g.foot : g.car, cs = g.cs;
    const ix0 = Math.floor(lon / cs), iy0 = Math.floor(lat / cs);
    const mx = 111320 * Math.cos(lat * D2R), my = 110574;
    const maxRing = Math.ceil(maxD / (cs * Math.min(mx, my))) + 1;
    let best = null; const seen = new Set();
    for (let r = 0; r <= maxRing; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const list = g.grid.get(g.key(ix0 + dx, iy0 + dy)); if (!list) continue;
        for (const s of list) {
          if (seen.has(s)) continue; seen.add(s);
          const fOk = cost[s] >= 0, bOk = cost[g.rev[s]] >= 0; if (!fOk && !bOk) continue;
          const a = g.from[s], b = g.to[s];
          const ax = (g.lon[a] - lon) * mx, ay = (g.lat[a] - lat) * my, bx = (g.lon[b] - lon) * mx, by = (g.lat[b] - lat) * my;
          const ddx = bx - ax, ddy = by - ay, L2 = ddx * ddx + ddy * ddy;
          let t = L2 > 0 ? -(ax * ddx + ay * ddy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(ax + t * ddx, ay + t * ddy);
          if (!best || d < best.d) best = { s, a, b, t, d, fOk, bOk };
        }
      }
      if (best && best.d <= r * cs * Math.min(mx, my)) break;
    }
    if (!best || best.d > maxD) return null;
    best.lat = g.lat[best.a] + (g.lat[best.b] - g.lat[best.a]) * best.t;
    best.lon = g.lon[best.a] + (g.lon[best.b] - g.lon[best.a]) * best.t;
    return best;
  }

  function astar(g, seeds, goals, goalLat, goalLon, mode) {
    const cost = mode === 'foot' ? g.foot : g.car, vmax = mode === 'foot' ? 1.5 : 40, N = g.N;
    const G = new Float64Array(N + 1).fill(Infinity), prev = new Int32Array(N + 1).fill(-1), prevE = new Int32Array(N + 1).fill(-1);
    const closed = new Uint8Array(N + 1), seedOf = new Int32Array(N + 1).fill(-1), heap = new Heap();
    const h = v => dist(g.lat[v], g.lon[v], goalLat, goalLon) / vmax;
    seeds.forEach((sd, i) => { if (sd.cost < G[sd.node]) { G[sd.node] = sd.cost; prev[sd.node] = -2; seedOf[sd.node] = i; heap.push(sd.cost + h(sd.node), sd.node); } });
    while (heap.k.length) {
      const u = heap.pop();
      if (u === N) {
        const path = []; let gn = prev[N]; const goal = goals.get(gn);
        let v = gn;
        while (prev[v] >= 0) { path.push(prevE[v]); v = prev[v]; }
        path.reverse();
        return { cost: G[N], seed: seedOf[v], seedNode: v, edges: path, goalNode: gn, goal };
      }
      if (closed[u]) continue; closed[u] = 1;
      const ge = goals.get(u);
      if (ge) { const c = G[u] + ge.cost; if (c < G[N]) { G[N] = c; prev[N] = u; heap.push(c, N); } }
      for (let e = g.off[u]; e < g.off[u + 1]; e++) {
        const c = cost[e]; if (c < 0) continue;
        const v = g.to[e], ng = G[u] + c;
        if (ng < G[v]) { G[v] = ng; prev[v] = u; prevE[v] = e; heap.push(ng + h(v), v); }
      }
    }
    return null;
  }

  /* ---------- rota ---------- */
  function route(g, from, to, mode, opts) {
    mode = mode === 'foot' ? 'foot' : 'car';
    const cost = mode === 'foot' ? g.foot : g.car, maxSnap = (opts && opts.maxSnap) || 400;
    const S = snap(g, from.lat, from.lon, mode, maxSnap); if (!S) return { ok: false, err: 'start' };
    const D = snap(g, to.lat, to.lon, mode, maxSnap); if (!D) return { ok: false, err: 'end' };
    const seeds = [], goals = new Map();
    const cf = cost[S.s], cb = cost[g.rev[S.s]];
    if (S.fOk) seeds.push({ node: S.b, cost: cf * (1 - S.t), dir: 1 });
    if (S.bOk) seeds.push({ node: S.a, cost: cb * S.t, dir: -1 });
    if (D.fOk) goals.set(D.a, { cost: cost[D.s] * D.t, dir: 1 });
    if (D.bOk) { const c = cost[g.rev[D.s]] * (1 - D.t); const p = goals.get(D.b); if (!p || c < p.cost) goals.set(D.b, { cost: c, dir: -1 }); }
    let best = null;
    const res = astar(g, seeds, goals, D.lat, D.lon, mode);
    if (res) best = { kind: 'graph', cost: res.cost, res };
    if (S.s === D.s) { // mesmo trecho de rua
      let c = -1;
      if (D.t >= S.t && S.fOk) c = cf * (D.t - S.t); else if (D.t < S.t && S.bOk) c = cb * (S.t - D.t);
      if (c >= 0 && (!best || c <= best.cost)) best = { kind: 'direct', cost: c };
    }
    if (!best) return { ok: false, err: 'noroute' };

    const P = []; // peças: trechos retos
    const pt = (la, lo) => [la, lo];
    const addP = (a, b, len, time, way, nA, nB) => P.push({ a, b, len, time, way, nA, nB, rb: way >= 0 && g.meta[way].rb ? 1 : 0 });
    const conSpeed = mode === 'foot' ? FOOT_V : 6;
    const dFrom = dist(from.lat, from.lon, S.lat, S.lon);
    if (dFrom > 2) addP(pt(from.lat, from.lon), pt(S.lat, S.lon), dFrom, dFrom / conSpeed, -1, -1, -1);
    const wayS = g.way[S.s], wayD = g.way[D.s];
    const Lseg = g.len[S.s];
    if (best.kind === 'direct') {
      const L = Math.abs(D.t - S.t) * Lseg;
      addP(pt(S.lat, S.lon), pt(D.lat, D.lon), L, best.cost, wayS, -1, -1);
    } else {
      const r = best.res, sd = seeds[r.seed];
      const sn = sd.node, L0 = (sd.dir === 1 ? (1 - S.t) : S.t) * Lseg;
      addP(pt(S.lat, S.lon), pt(g.lat[sn], g.lon[sn]), L0, sd.cost, wayS, -1, sn);
      for (const e of r.edges) addP(pt(g.lat[g.from[e]], g.lon[g.from[e]]), pt(g.lat[g.to[e]], g.lon[g.to[e]]), g.len[e], cost[e], g.way[e], g.from[e], g.to[e]);
      const gl = r.goal, L1 = (gl.dir === 1 ? D.t : (1 - D.t)) * g.len[D.s];
      if (L1 > 0.01) addP(pt(g.lat[r.goalNode], g.lon[r.goalNode]), pt(D.lat, D.lon), L1, gl.cost, wayD, r.goalNode, -1);
    }
    const dTo = dist(D.lat, D.lon, to.lat, to.lon);
    if (dTo > 2) addP(pt(D.lat, D.lon), pt(to.lat, to.lon), dTo, dTo / conSpeed, -1, -1, -1);

    const coords = [P[0].a], cum = [0], cumT = [0];
    let dd = 0, tt = 0;
    for (const p of P) { coords.push(p.b); dd += p.len; tt += p.time; cum.push(dd); cumT.push(tt); }
    const steps = makeSteps(g, P, mode);
    return { ok: true, mode, dist: dd, time: tt, coords, cum, cumT, steps, snapStart: S.d, snapEnd: D.d };
  }

  /* ---------- instruções ---------- */
  const FEM = /^(r\.|rua|av\.|avenida|alameda|travessa|estrada|rodovia|pra[cç]a|via|ladeira|passagem|marginal|rotat[oó]ria|vila|trilha|vereda|servid[aã]o|[a-z]{2,3}-\d+)/i;
  const MASC = /^(viaduto|largo|beco|parque|anel|trevo|contorno|acesso|caminho|corredor|elevado|t[uú]nel)/i;
  function prep(name) {
    if (!name) return null;
    if (FEM.test(name)) return { em: 'na ' + name, por: 'pela ' + name };
    if (MASC.test(name)) return { em: 'no ' + name, por: 'pelo ' + name };
    return { em: 'em ' + name, por: 'por ' + name };
  }
  const em = n => { const p = prep(n); return p ? ' ' + p.em : ''; };
  const por = n => { const p = prep(n); return p ? ' ' + p.por : ''; };

  function degree(g, n) { const s = new Set(); for (let e = g.off[n]; e < g.off[n + 1]; e++) s.add(g.to[e]); return s.size; }
  function hasNonRbExit(g, n, mode) {
    const cost = mode === 'foot' ? g.foot : g.car;
    for (let e = g.off[n]; e < g.off[n + 1]; e++) if (cost[e] >= 0 && !g.meta[g.way[e]].rb) return true;
    return false;
  }

  function makeSteps(g, P, mode) {
    const steps = [], cd = [], ct = [];
    let sd = 0, st = 0;
    for (const p of P) { sd += p.len; st += p.time; cd.push(sd); ct.push(st); }
    const total = sd, totalT = st;
    const first = P.find(p => p.way >= 0);
    const nm0 = first ? g.meta[first.way].n : '';
    const b0 = first ? bearing(first.a[0], first.a[1], first.b[0], first.b[1]) : 0;
    steps.push({ type: 'depart', mod: 'depart', name: nm0, text: 'Siga para o ' + cardinalFull(b0) + por(nm0), at: P[0].a, d: 0, t: 0, bearing: b0 });
    const inB = i => {
      let j = i, acc = 0, sx = P[i].a;
      while (j >= 0 && P[j].way >= 0) { sx = P[j].a; acc += P[j].len; if (acc >= 25) break; j--; }
      return bearing(sx[0], sx[1], P[i].b[0], P[i].b[1]);
    };
    const outB = i => {
      let j = i, acc = 0, ex = P[i].b;
      while (j < P.length && P[j].way >= 0) { ex = P[j].b; acc += P[j].len; if (acc >= 25) break; j++; }
      return bearing(P[i].a[0], P[i].a[1], ex[0], ex[1]);
    };
    const push = s => { const l = steps[steps.length - 1]; if (l && Math.abs(l.d - s.d) < 8 && l.type !== 'depart') return; steps.push(s); };
    let i = 0;
    while (i + 1 < P.length) {
      const pi = P[i], po = P[i + 1];
      const n = pi.nB;
      if (n < 0 || pi.way < 0 || po.way < 0) { i++; continue; }
      if (!pi.rb && po.rb) {
        let k = i + 1, exits = 0, exitIdx = -1;
        while (k < P.length && P[k].rb) {
          const nn = P[k].nB;
          if (k + 1 < P.length && !P[k + 1].rb) { exits++; exitIdx = k + 1; break; }
          if (nn >= 0 && hasNonRbExit(g, nn, mode)) exits++;
          k++;
        }
        if (exitIdx < 0) break;
        const nmOut = P[exitIdx].way >= 0 ? g.meta[P[exitIdx].way].n : '';
        push({ type: 'roundabout', mod: 'roundabout', exit: exits, name: nmOut, text: 'Na rotatória, pegue a ' + exits + 'ª saída' + (nmOut ? ' para ' + nmOut : ''), at: pi.b, d: cd[i], t: ct[i] });
        i = exitIdx; continue;
      }
      const nameIn = g.meta[pi.way].n, nameOut = g.meta[po.way].n, changed = nameIn !== nameOut;
      const a = angDiff(inB(i), outB(i + 1)), aa = Math.abs(a), dg = degree(g, n);
      let emit = false;
      if (dg >= 3) {
        if (aa > 45) emit = 'turn';
        else if (aa > 20 && !(nameIn && nameIn === nameOut)) emit = 'turn';
        else if (aa <= 20 && changed && nameOut) emit = 'continue';
      } else if (changed && nameOut) emit = aa > 20 ? 'turn' : 'continue';
      if (emit) {
        const side = a > 0 ? 'direita' : 'esquerda', sk = a > 0 ? 'right' : 'left';
        let kind = aa <= 20 ? 'straight' : aa <= 45 ? 'slight' : aa <= 110 ? 'turn' : aa <= 160 ? 'sharp' : 'uturn';
        if (emit === 'continue') kind = 'straight';
        let text, mod;
        if (kind === 'straight') { text = 'Continue' + (nameOut ? por(nameOut) : ' em frente'); mod = 'straight'; }
        else if (kind === 'slight') { text = 'Vire levemente à ' + side + em(nameOut); mod = 'slight_' + sk; }
        else if (kind === 'turn') { text = 'Vire à ' + side + em(nameOut); mod = sk; }
        else if (kind === 'sharp') { text = 'Faça uma curva fechada à ' + side + em(nameOut); mod = 'sharp_' + sk; }
        else { text = 'Faça o retorno' + em(nameOut); mod = 'uturn'; }
        push({ type: 'turn', mod, name: nameOut, text, at: pi.b, d: cd[i], t: ct[i], angle: Math.round(a) });
      }
      i++;
    }
    const last = P[P.length - 1];
    steps.push({ type: 'arrive', mod: 'arrive', name: '', text: 'Você chegou ao destino', at: last.b, d: total, t: totalT });
    return steps;
  }

  /* ---------- acompanhar a rota com a posição real ---------- */
  function locate(rt, lat, lon, hint) {
    const c = rt.coords, mx = 111320 * Math.cos(lat * D2R), my = 110574;
    const scan = (i0, i1) => {
      let best = null;
      for (let i = i0; i < i1; i++) {
        const ax = (c[i][1] - lon) * mx, ay = (c[i][0] - lat) * my, bx = (c[i + 1][1] - lon) * mx, by = (c[i + 1][0] - lat) * my;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? -(ax * dx + ay * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (!best || d < best.off) best = { off: d, seg: i, s: rt.cum[i] + t * (rt.cum[i + 1] - rt.cum[i]) };
      }
      return best;
    };
    const n = c.length - 1; if (n < 1) return { off: 0, seg: 0, s: 0 };
    let r = null;
    if (hint !== undefined) r = scan(Math.max(0, hint - 4), Math.min(n, hint + 80));
    if (!r || r.off > 60) { const f = scan(0, n); if (!r || f.off < r.off) r = f; }
    return r;
  }
  function nextStep(rt, s) {
    for (let i = 1; i < rt.steps.length; i++) if (rt.steps[i].d > s + 3) return i;
    return rt.steps.length - 1;
  }
  function timeAt(rt, s) {
    const c = rt.cum; let lo = 0, hi = c.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const span = c[hi] - c[lo]; return rt.cumT[lo] + (span > 0 ? (s - c[lo]) / span : 0) * (rt.cumT[hi] - rt.cumT[lo]);
  }

  /* ---------- índice de nomes para busca offline ---------- */
  function buildNameIndex(ways, places, pois) {
    const out = [], byName = new Map();
    for (const w of ways) {
      if (!w.n || rankOf(w.h) > 5) continue;
      let a = byName.get(w.n); if (!a) byName.set(w.n, a = []);
      const k = Math.floor(w.p.length / 4) * 2; // vértice do meio
      a.push([w.p[k], w.p[k + 1]]);
    }
    for (const [name, pts] of byName) {
      const cl = [];
      for (const p of pts) {
        let c = cl.find(x => dist(x.pts[0][0], x.pts[0][1], p[0], p[1]) < 1500);
        if (!c) cl.push({ pts: [p] }); else c.pts.push(p);
      }
      for (const c of cl) {
        let ml = 0, mo = 0; for (const p of c.pts) { ml += p[0]; mo += p[1]; } ml /= c.pts.length; mo /= c.pts.length;
        let b = c.pts[0], bd = 1e18; for (const p of c.pts) { const d = dist(p[0], p[1], ml, mo); if (d < bd) { bd = d; b = p; } }
        out.push({ t: 'rua', n: name, k: norm(name), lat: b[0], lon: b[1], sub: 'Rua / avenida' });
      }
    }
    for (const p of places || []) out.push({ t: 'bairro', n: p.n, k: norm(p.n), lat: p.lat, lon: p.lon, sub: (p.pl === 'suburb' || p.pl === 'neighbourhood' || p.pl === 'quarter' || p.pl === 'borough' ? 'Bairro' : p.pl === 'city' ? 'Cidade' : p.pl === 'town' ? 'Cidade' : 'Localidade') });
    for (const p of pois || []) out.push({ t: 'ponto', n: p.n, k: norm(p.n), lat: p.lat, lon: p.lon, sub: p.c });
    return out;
  }

  return { dist, bearing, angDiff, cardinal, cardinalFull, norm, HW, rankOf, parseOverpass, buildGraph, snap, route, locate, nextStep, timeAt, buildNameIndex, FOOT_V };
});
