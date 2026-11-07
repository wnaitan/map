'use strict';
/* NAVI OFFLINE - mapas offline: download (Overpass/OpenStreetMap), armazenamento, desenho vetorial e busca offline */
const MapData={ways:[],parks:[],water:[],lines:[],places:[],pois:[],cells:[],regions:[],idx:[],ver:0,graph:null,graphVer:-1,shown:false,vis:[[],[],[],[],[],[],[]],byRank:[[],[],[],[],[],[],[]],bytes:0};
const CELL={full:0.05,main:0.5},CAP={full:40,main:100};
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- blocos (células) ---------- */
function cellsFor(b,mode){
  const sz=CELL[mode],eps=1e-9,out=[];
  const ix0=Math.floor((b.w+180)/sz),ix1=Math.floor((b.e+180-eps)/sz),iy0=Math.floor((b.s+90)/sz),iy1=Math.floor((b.n+90-eps)/sz);
  for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){
    out.push({key:mode+':'+ix+':'+iy,mode,ix,iy,w:+(ix*sz-180).toFixed(6),e:+((ix+1)*sz-180).toFixed(6),s:+(iy*sz-90).toFixed(6),n:+((iy+1)*sz-90).toFixed(6)});
  }
  return out;
}
function planArea(b,mode){
  let cells=cellsFor(b,mode),total=cells.length,trimmed=false;
  if(cells.length>CAP[mode]){
    const cx=(b.w+b.e)/2,cy=(b.s+b.n)/2;
    cells.sort((a,c)=>Math.hypot((a.w+a.e)/2-cx,(a.s+a.n)/2-cy)-Math.hypot((c.w+c.e)/2-cx,(c.s+c.n)/2-cy));
    cells=cells.slice(0,CAP[mode]);trimmed=true;
  }
  const bb={w:Math.min(...cells.map(c=>c.w)),e:Math.max(...cells.map(c=>c.e)),s:Math.min(...cells.map(c=>c.s)),n:Math.max(...cells.map(c=>c.n))};
  return{cells,total,trimmed,bbox:bb};
}
function qFull(c){
  const b=c.s+','+c.w+','+c.n+','+c.e;
  return '[out:json][timeout:120];(way["highway"]('+b+');way["waterway"~"^(river|stream|canal|drain)$"]('+b+');way["natural"~"^(water|wood|grassland|scrub)$"]('+b+');way["landuse"~"^(reservoir|basin|forest|grass|recreation_ground|village_green|meadow|cemetery)$"]('+b+');way["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"]('+b+'););out geom;'+
  '(node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|quarter|locality|borough)$"]('+b+');nwr["name"]["amenity"]('+b+');nwr["name"]["tourism"]('+b+');nwr["name"]["historic"]('+b+');nwr["name"]["healthcare"]('+b+');nwr["name"]["shop"~"^(supermarket|mall|department_store|bakery|convenience|hardware|car_repair|butcher|clothes)$"]('+b+');nwr["name"]["leisure"~"^(stadium|sports_centre|park)$"]('+b+'););out center;';
}
function qMain(c){
  const b=c.s+','+c.w+','+c.n+','+c.e;
  return '[out:json][timeout:150];way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"]('+b+');out geom;node["place"~"^(city|town|village|suburb)$"]('+b+');out center;';
}
async function fetchCell(c,signal,log){
  const q=c.mode==='main'?qMain(c):qFull(c);let lastErr=null;
  for(let attempt=0;attempt<6;attempt++){
    if(signal.aborted)throw new Error('cancelado');
    const url=OVERPASS[attempt%OVERPASS.length];
    const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),170000),ab=()=>ctl.abort();
    signal.addEventListener('abort',ab);
    try{
      const r=await fetch(url,{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:ctl.signal});
      if([429,502,503,504].includes(r.status)){lastErr=new Error('servidor ocupado ('+r.status+')');log&&log('Servidor ocupado, tentando de novo…');await sleep(4000*(attempt+1));continue}
      if(!r.ok)throw new Error('HTTP '+r.status);
      const txt=await r.text(),json=JSON.parse(txt);
      if(json.remark&&/runtime error|out of memory|timed out/i.test(json.remark)){lastErr=new Error('servidor sem fôlego');await sleep(3000*(attempt+1));continue}
      return{json,size:txt.length};
    }catch(e){
      if(signal.aborted)throw new Error('cancelado');
      lastErr=e;await sleep(2500*(attempt+1));
    }finally{clearTimeout(to);signal.removeEventListener('abort',ab)}
  }
  throw lastErr||new Error('falha de rede');
}
async function ingestCell(c,json,size){
  const p=Routing.parseOverpass(json);
  const rec={key:c.key,mode:c.mode,ix:c.ix,iy:c.iy,s:c.s,w:c.w,n:c.n,e:c.e,date:Date.now(),size:size||0,ways:p.ways,water:p.water,waterLines:p.waterLines,parks:p.parks,places:p.places,pois:p.pois};
  await DB.put('cells',rec,c.key);
  return rec;
}

/* ---------- regiões salvas ---------- */
async function loadRegions(){MapData.regions=(await DB.get('kv','regions'))||[]}
async function saveRegions(){await DB.put('kv',MapData.regions,'regions')}
let dl=null;
async function downloadArea(plan,mode,name,prog){
  if(dl)throw new Error('já existe um download em andamento');
  const ctl=new AbortController();dl={ctl};
  const have=new Set(await DB.keys('cells'));
  const total=plan.cells.length;let done=0,fail=0,bytes=0,lastErr='';
  const keys=[];
  try{
    for(const c of plan.cells){
      if(ctl.signal.aborted)break;
      if(have.has(c.key)){const r=await DB.get('cells',c.key);bytes+=r?r.size:0;keys.push(c.key);done++;prog&&prog({done,total,fail,bytes});continue}
      try{
        const {json,size}=await fetchCell(c,ctl.signal,m=>prog&&prog({done,total,fail,bytes,msg:m}));
        await ingestCell(c,json,size);keys.push(c.key);bytes+=size;
      }catch(e){if(ctl.signal.aborted)break;fail++;lastErr=e&&e.message||'erro'}
      done++;prog&&prog({done,total,fail,bytes});
      await sleep(900);
    }
  }finally{dl=null}
  const aborted=ctl.signal.aborted;
  if(keys.length){
    const id='r'+Date.now();
    MapData.regions.push({id,name:name||'Região '+(MapData.regions.length+1),mode,bbox:plan.bbox,keys,date:Date.now(),size:bytes,failed:fail+(aborted?total-done:0)});
    await saveRegions();await reloadMapData();
  }
  return{aborted,fail,ok:keys.length,total,lastErr};
}
function cancelDownload(){if(dl)dl.ctl.abort()}
async function deleteRegion(id){
  const r=MapData.regions.find(x=>x.id===id);if(!r)return;
  const keep=new Set();for(const o of MapData.regions)if(o.id!==id)for(const k of o.keys)keep.add(k);
  for(const k of r.keys)if(!keep.has(k))await DB.del('cells',k);
  MapData.regions=MapData.regions.filter(x=>x.id!==id);await saveRegions();await reloadMapData();
}

/* ---------- carregar tudo na memória ---------- */
function polyPrep(a){
  const p=a.p,n=p.length/2,x=new Float64Array(p.length);let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(let i=0;i<n;i++){const lx=lonToX(p[2*i+1]),ly=latToY(p[2*i]);x[2*i]=lx;x[2*i+1]=ly;if(lx<x0)x0=lx;if(lx>x1)x1=lx;if(ly<y0)y0=ly;if(ly>y1)y1=ly}
  a.x=x;a.bb=[x0,y0,x1,y1];return a;
}
async function reloadMapData(){
  const recs=await DB.all('cells'),M=MapData;
  M.cells=[];M.ways=[];M.parks=[];M.water=[];M.lines=[];M.places=[];M.pois=[];M.bytes=0;
  M.byRank=[[],[],[],[],[],[],[]];
  const seenW=new Set(),seenP=new Set(),seenA=new Set();
  for(const r of recs){
    M.cells.push({key:r.key,mode:r.mode,s:r.s,w:r.w,n:r.n,e:r.e,x0:lonToX(r.w),x1:lonToX(r.e),y0:latToY(r.n),y1:latToY(r.s)});
    M.bytes+=r.size||0;
    for(const w of r.ways){if(seenW.has(w.id))continue;seenW.add(w.id);polyPrep(w);w.rk=Routing.rankOf(w.h);M.ways.push(w);M.byRank[w.rk].push(w)}
    for(const a of r.parks){const k='p'+a.p[0]+','+a.p[1]+','+a.p.length;if(seenA.has(k))continue;seenA.add(k);M.parks.push(polyPrep(a))}
    for(const a of r.water){const k='w'+a.p[0]+','+a.p[1]+','+a.p.length;if(seenA.has(k))continue;seenA.add(k);M.water.push(polyPrep(a))}
    for(const a of r.waterLines){const k='l'+a.p[0]+','+a.p[1]+','+a.p.length;if(seenA.has(k))continue;seenA.add(k);M.lines.push(polyPrep(a))}
    for(const p of r.places){const k=p.n+'|'+p.lat.toFixed(4)+p.lon.toFixed(4);if(seenP.has(k))continue;seenP.add(k);p.mx=lonToX(p.lon);p.my=latToY(p.lat);M.places.push(p)}
    for(const p of r.pois){const k=p.n+'|'+p.lat.toFixed(4)+p.lon.toFixed(4);if(seenP.has(k))continue;seenP.add(k);p.mx=lonToX(p.lon);p.my=latToY(p.lat);M.pois.push(p)}
  }
  M.idx=Routing.buildNameIndex(M.ways,M.places,M.pois);
  M.ver++;M.graph=null;M.graphVer=-1;
  invalidate();
  if(typeof onMapDataChanged==='function')onMapDataChanged();
}
async function getGraph(){
  const M=MapData;
  if(M.graph&&M.graphVer===M.ver)return M.graph;
  if(!M.ways.length)return null;
  await sleep(20);
  M.graph=Routing.buildGraph([M.ways]);M.graphVer=M.ver;
  return M.graph;
}
function coveredAt(lat,lon){for(const c of MapData.cells)if(lat>=c.s&&lat<=c.n&&lon>=c.w&&lon<=c.e)return true;return false}

/* ---------- desenho ---------- */
const ROAD_MINZ=[8.2,8.2,10,11.5,13,15,15.5],ROAD_W=[8,7,6.2,5.4,4.6,3,1.6];
function tracePath(x,F,close){
  let lx=0,ly=0,first=true;const n=x.length;
  for(let i=0;i<n;i+=2){
    const u=x[i]-F.cx,v=x[i+1]-F.cy,sx=F.hw+F.S*(F.c*u+F.s*v),sy=F.hh+F.S*(-F.s*u+F.c*v);
    if(!first&&i<n-2&&(sx-lx)*(sx-lx)+(sy-ly)*(sy-ly)<2.25)continue;
    if(first){ctx.moveTo(sx,sy);first=false}else ctx.lineTo(sx,sy);lx=sx;ly=sy;
  }
  if(close)ctx.closePath();
}
const vis_=(b,ext)=>!(b[2]<ext.x0||b[0]>ext.x1||b[3]<ext.y0||b[1]>ext.y1);
function drawVector(F,ext){
  const M=MapData,P=pal(),z=view.z;M.shown=false;
  for(const v of M.vis)v.length=0;
  if(!M.cells.length||z<8.2)return;
  ctx.fillStyle=P.land;ctx.strokeStyle=P.land;ctx.lineWidth=1;
  for(const c of M.cells){
    if(c.x1<ext.x0||c.x0>ext.x1||c.y1<ext.y0||c.y0>ext.y1)continue;
    const a=project(c.x0,c.y0,F),b=project(c.x1,c.y0,F),d=project(c.x1,c.y1,F),e=project(c.x0,c.y1,F);
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(d[0],d[1]);ctx.lineTo(e[0],e[1]);ctx.closePath();ctx.fill();ctx.stroke();M.shown=true;
  }
  if(!M.shown)return;
  const minPx=2/F.S;
  const fillAreas=(arr,color)=>{
    ctx.fillStyle=color;ctx.beginPath();let any=false;
    for(const a of arr){const b=a.bb;if(!vis_(b,ext)||(b[2]-b[0]<minPx&&b[3]-b[1]<minPx))continue;tracePath(a.x,F,true);any=true}
    if(any)ctx.fill();
  };
  fillAreas(M.parks,P.park);fillAreas(M.water,P.water);
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle=P.waterLine;
  for(const big of [0,1]){
    ctx.lineWidth=(big?3.2:1.4)*clamp(Math.pow(2,(z-14)*0.5),0.6,2);ctx.beginPath();let any=false;
    for(const a of M.lines){if(a.big!==big||!vis_(a.bb,ext))continue;tracePath(a.x,F,false);any=true}
    if(any)ctx.stroke();
  }
  const f=clamp(Math.pow(2,(z-16)*0.75),0.3,2.4);
  for(let r=0;r<7;r++){
    if(z<ROAD_MINZ[r])continue;
    const vr=M.vis[r];
    for(const w of M.byRank[r])if(vis_(w.bb,ext))vr.push(w);
  }
  // pistas: contorno de todas, depois preenchimento
  for(let r=5;r>=0;r--){
    const vr=M.vis[r];if(!vr.length)continue;
    const w=Math.max(ROAD_W[r]*f,r<=3?1.3:0.9);
    ctx.strokeStyle=P.casing[r];ctx.lineWidth=w+(w>2.6?1.6:0.9);ctx.beginPath();
    for(const way of vr)tracePath(way.x,F,false);ctx.stroke();
  }
  for(let r=5;r>=0;r--){
    const vr=M.vis[r];if(!vr.length)continue;
    const w=Math.max(ROAD_W[r]*f,r<=3?1.3:0.9);
    if(w<2.2&&r>=4)continue;
    ctx.strokeStyle=P.fill[r];ctx.lineWidth=w;ctx.beginPath();
    for(const way of vr)tracePath(way.x,F,false);ctx.stroke();
  }
  const v6=M.vis[6];
  if(v6.length){ctx.strokeStyle=P.fill[6];ctx.lineWidth=clamp(1.4*f+0.4,1,2.2);ctx.setLineDash([4,3]);ctx.beginPath();for(const way of v6)tracePath(way.x,F,false);ctx.stroke();ctx.setLineDash([])}
}
const PLACE_Z={city:8.5,town:9.5,village:11,hamlet:12.5,locality:13,suburb:12,quarter:13,neighbourhood:13.5,borough:11.5};
function drawVectorLabels(F,ext,boxes,free){
  const M=MapData,P=pal(),z=view.z;if(!M.shown)return;
  ctx.textBaseline='middle';ctx.textAlign='center';ctx.lineJoin='round';
  // bairros e cidades
  let n=0;
  for(const pl of M.places){
    if(z<(PLACE_Z[pl.pl]||12)||pl.my<ext.y0||pl.my>ext.y1||pl.mx<ext.x0||pl.mx>ext.x1)continue;
    const [x,y]=project(pl.mx,pl.my,F);if(x<-60||x>W+60||y<-20||y>H+20)continue;
    const big=pl.pl==='city'||pl.pl==='town',fs=big?15:12;
    ctx.font=(big?'700 ':'600 ')+fs+'px system-ui,Arial,sans-serif';
    const t=big?pl.n:pl.n.toUpperCase(),tw=ctx.measureText(t).width;
    if(!free(x-tw/2-2,y-fs/2-1,tw+4,fs+2))continue;
    ctx.lineWidth=3;ctx.strokeStyle=P.halo;ctx.strokeText(t,x,y);ctx.fillStyle=P.place;ctx.fillText(t,x,y);if(++n>60)break;
  }
  // nomes de ruas ao longo do traçado
  if(z>=14.2){
    const fs=clamp(9+(z-14)*1.1,10,14);ctx.font='500 '+fs+'px system-ui,Arial,sans-serif';
    let cnt=0,tried=0;const sw=1.2*W;
    for(let r=0;r<=5&&cnt<80;r++){
      for(const way of M.vis[r]){
        if(!way.n||cnt>=80||tried++>700)break;
        const x=way.x,len=x.length/2,pts=[];
        for(let i=0;i<len;i++){const u=x[2*i]-F.cx,v=x[2*i+1]-F.cy;pts.push(F.hw+F.S*(F.c*u+F.s*v),F.hh+F.S*(-F.s*u+F.c*v))}
        // maior trecho contínuo dentro da tela
        let bestA=-1,bestB=-1,bestL=0,a=-1,L=0;
        const inside=(px,py)=>px>-10&&px<W+10&&py>-10&&py<H+10;
        for(let i=0;i<len;i++){
          const ins=inside(pts[2*i],pts[2*i+1]);
          if(ins){if(a<0){a=i;L=0}else L+=Math.hypot(pts[2*i]-pts[2*i-2],pts[2*i+1]-pts[2*i-1]);if(L>bestL){bestL=L;bestA=a;bestB=i}}
          else a=-1;
        }
        if(bestA<0)continue;
        const tw=ctx.measureText(way.n).width;
        if(bestL<tw+14||bestA===bestB)continue;
        // ponto no meio do trecho
        let acc=0,half=bestL/2,mx=0,my=0,ia=bestA;
        for(let i=bestA;i<bestB;i++){const sl=Math.hypot(pts[2*i+2]-pts[2*i],pts[2*i+3]-pts[2*i+1]);if(acc+sl>=half){const t=(half-acc)/(sl||1);mx=pts[2*i]+t*(pts[2*i+2]-pts[2*i]);my=pts[2*i+1]+t*(pts[2*i+3]-pts[2*i+1]);ia=i;break}acc+=sl}
        // direção: corda entre pontos a ±tw/2 do meio
        const dirAt=(from,sign)=>{let px=mx,py=my,rem=tw/2,i=ia;if(sign>0){for(;i<bestB&&rem>0;i++){const ex=pts[2*i+2],ey=pts[2*i+3],sl=Math.hypot(ex-px,ey-py);if(sl>=rem){px+=(ex-px)*rem/sl;py+=(ey-py)*rem/sl;rem=0;break}rem-=sl;px=ex;py=ey}}
          else{px=mx;py=my;let j=ia;for(;j>=bestA&&rem>0;j--){const ex=pts[2*j],ey=pts[2*j+1],sl=Math.hypot(ex-px,ey-py);if(sl>=rem){px+=(ex-px)*rem/sl;py+=(ey-py)*rem/sl;rem=0;break}rem-=sl;px=ex;py=ey}}return[px,py]};
        const p1=dirAt(0,-1),p2=dirAt(0,1);
        let ang=Math.atan2(p2[1]-p1[1],p2[0]-p1[0]);
        if(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])<tw*0.8)continue;
        if(ang>Math.PI/2||ang<-Math.PI/2)ang+=Math.PI;
        const c=Math.abs(Math.cos(ang)),s=Math.abs(Math.sin(ang)),bw=tw*c+fs*s+4,bh=tw*s+fs*c+4;
        if(!free(mx-bw/2,my-bh/2,bw,bh))continue;
        ctx.save();ctx.translate(mx,my);ctx.rotate(ang);
        ctx.lineWidth=3;ctx.strokeStyle=P.halo;ctx.strokeText(way.n,0,0);ctx.fillStyle=P.text;ctx.fillText(way.n,0,0);ctx.restore();cnt++;
      }
    }
  }
  // pontos de referência
  if(z>=15.2){
    let cnt=0;const lab=z>=16.2;ctx.textAlign='left';ctx.font='500 12px system-ui,Arial,sans-serif';
    for(const p of M.pois){
      if(p.mx<ext.x0||p.mx>ext.x1||p.my<ext.y0||p.my>ext.y1)continue;
      const [x,y]=project(p.mx,p.my,F);if(x<-10||x>W+10||y<-10||y>H+10)continue;
      if(!free(x-5,y-5,10,10))continue;
      ctx.beginPath();ctx.arc(x,y,4.5,0,TAU);ctx.fillStyle=P.poi;ctx.fill();ctx.lineWidth=1.6;ctx.strokeStyle='#fff';ctx.stroke();
      if(lab){const tw=ctx.measureText(p.n).width;if(free(x+7,y-8,tw+4,16)){ctx.lineWidth=3;ctx.strokeStyle=P.halo;ctx.strokeText(p.n,x+8,y);ctx.fillStyle=P.text;ctx.fillText(p.n,x+8,y)}}
      if(++cnt>220)break;
    }
  }
}
labelPass.push(drawVectorLabels);
function poiAt(sx,sy){
  const M=MapData;if(view.z<15.2||!M.shown)return null;
  const F=frame(),ext=viewExtent(F);let best=null,bd=22;
  for(const p of M.pois){
    if(p.mx<ext.x0||p.mx>ext.x1||p.my<ext.y0||p.my>ext.y1)continue;
    const [x,y]=project(p.mx,p.my,F),d=Math.hypot(x-sx,y-sy);if(d<bd){bd=d;best=p}
  }
  return best;
}

/* ---------- busca offline ---------- */
function searchList(list,q,ref){
  const toks=norm(q).split(/\s+/).filter(Boolean);if(!toks.length||norm(q).length<2)return[];
  const out=[];
  for(const it of list){
    const k=it.k;let ok=true,sc=2;
    for(const t of toks){const i=k.indexOf(t);if(i<0){ok=false;break}}
    if(!ok)continue;
    if(k.startsWith(toks[0]))sc=0;else if(k.indexOf(' '+toks[0])>=0)sc=1;
    const d=ref&&it.lat!==undefined?Routing.dist(ref.lat,ref.lon,it.lat,it.lon):0;
    out.push({it,sc,d,pri:it.pri||0});
  }
  out.sort((a,b)=>a.sc-b.sc||b.pri-a.pri||a.d-b.d);
  return out.slice(0,30).map(o=>Object.assign({},o.it,{d:o.d}));
}
