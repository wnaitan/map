'use strict';
/* NAVI OFFLINE - núcleo: utilidades, armazenamento, mundo, câmera, desenho e gestos */
const $=s=>document.querySelector(s);
const TAU=Math.PI*2,D2R=Math.PI/180;
const lonToX=l=>(l+180)/360;
const latToY=l=>{l=Math.max(-85.0511,Math.min(85.0511,l));const r=l*D2R;return .5-Math.log(Math.tan(Math.PI/4+r/2))/TAU};
const xToLon=x=>x*360-180;
const yToLat=y=>Math.atan(Math.sinh(Math.PI-TAU*y))/D2R;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const norm=s=>String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const wrap360=d=>((d%360)+360)%360;
const angD=(a,b)=>((b-a+540)%360)-180;
let toastTimer;
function toast(t,ms=2800){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),ms)}
function fmtDist(m){if(!isFinite(m))return '—';if(m<950)return Math.round(m/(m<100?5:10))*(m<100?5:10)+' m';if(m<10000)return (m/1000).toFixed(1).replace('.',',')+' km';return Math.round(m/1000)+' km'}
function fmtDur(s){if(!isFinite(s))return '—';s=Math.max(0,Math.round(s/60));if(s<1)return '< 1 min';if(s<60)return s+' min';const h=Math.floor(s/60),m=s%60;return h+' h'+(m?' '+m+' min':'')}
function fmtClock(ms){const d=new Date(ms);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
const fmtMB=b=>b>=1e6?(b/1e6).toFixed(1)+' MB':Math.max(1,Math.round(b/1e3))+' KB';
const fmtCoord=(la,lo)=>la.toFixed(5)+', '+lo.toFixed(5);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ============ ajustes ============ */
const S={night:false,voice:true,saver:false,wake:true,decl:0,mapMode:'north',gpsOpt:false};
try{Object.assign(S,JSON.parse(localStorage.getItem('navi.settings')||'{}'))}catch(e){}
function saveS(){try{localStorage.setItem('navi.settings',JSON.stringify(S))}catch(e){}}

/* ============ armazenamento (IndexedDB) ============ */
const DB={db:null,
  open(){return new Promise((res,rej)=>{const r=indexedDB.open('navi-offline',1);
    r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('kv');d.createObjectStore('cells')};
    r.onsuccess=()=>{this.db=r.result;res()};r.onerror=()=>rej(r.error)})},
  tx(store,mode,fn){return new Promise((res,rej)=>{const t=this.db.transaction(store,mode);const s=t.objectStore(store);let out;const rq=fn(s);
    if(rq)rq.onsuccess=()=>{out=rq.result};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})},
  get(st,k){return this.tx(st,'readonly',s=>s.get(k))},
  put(st,v,k){return this.tx(st,'readwrite',s=>s.put(v,k))},
  del(st,k){return this.tx(st,'readwrite',s=>s.delete(k))},
  all(st){return this.tx(st,'readonly',s=>s.getAll())},
  keys(st){return this.tx(st,'readonly',s=>s.getAllKeys())}
};

/* ============ dados do mundo ============ */
const COUNTRY_URLS=[
  'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json',
  'https://unpkg.com/world-atlas@2.0.2/countries-50m.json',
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json'];
const CITY_URLS=[
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_10m_populated_places_simple.geojson',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson',
  'https://fastly.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson'];
async function fetchFirst(urls){let err;for(const u of urls){try{const r=await fetch(u,{cache:'no-cache'});if(r.ok)return await r.json();err=new Error('HTTP '+r.status)}catch(e){err=e}}throw err||new Error('falha de rede')}
const PT=Object.fromEntries(`Afghanistan:Afeganistão|Albania:Albânia|Algeria:Argélia|Andorra:Andorra|Angola:Angola|Antarctica:Antártida|Antigua and Barb.:Antígua e Barbuda|Argentina:Argentina|Armenia:Armênia|Aruba:Aruba|Australia:Austrália|Austria:Áustria|Azerbaijan:Azerbaijão|Bahamas:Bahamas|Bahrain:Bahrein|Bangladesh:Bangladesh|Barbados:Barbados|Belarus:Belarus|Belgium:Bélgica|Belize:Belize|Benin:Benin|Bhutan:Butão|Bolivia:Bolívia|Bosnia and Herz.:Bósnia e Herzegovina|Botswana:Botsuana|Brazil:Brasil|Brunei:Brunei|Bulgaria:Bulgária|Burkina Faso:Burkina Faso|Burundi:Burundi|Cambodia:Camboja|Cameroon:Camarões|Canada:Canadá|Cape Verde:Cabo Verde|Central African Rep.:República Centro-Africana|Chad:Chade|Chile:Chile|China:China|Colombia:Colômbia|Comoros:Comores|Congo:Congo|Costa Rica:Costa Rica|Croatia:Croácia|Cuba:Cuba|Cyprus:Chipre|Czechia:Tchéquia|Dem. Rep. Congo:República Democrática do Congo|Denmark:Dinamarca|Djibouti:Djibuti|Dominica:Dominica|Dominican Rep.:República Dominicana|Ecuador:Equador|Egypt:Egito|El Salvador:El Salvador|Eq. Guinea:Guiné Equatorial|Eritrea:Eritreia|Estonia:Estônia|eSwatini:Essuatíni|Ethiopia:Etiópia|Falkland Is.:Ilhas Malvinas|Fiji:Fiji|Finland:Finlândia|France:França|Fr. S. Antarctic Lands:Terras Austrais Francesas|French Polynesia:Polinésia Francesa|Gabon:Gabão|Gambia:Gâmbia|Georgia:Geórgia|Germany:Alemanha|Ghana:Gana|Greece:Grécia|Greenland:Groenlândia|Grenada:Granada|Guatemala:Guatemala|Guinea:Guiné|Guinea-Bissau:Guiné-Bissau|Guyana:Guiana|Haiti:Haiti|Honduras:Honduras|Hungary:Hungria|Iceland:Islândia|India:Índia|Indonesia:Indonésia|Iran:Irã|Iraq:Iraque|Ireland:Irlanda|Israel:Israel|Italy:Itália|Ivory Coast:Costa do Marfim|Côte d'Ivoire:Costa do Marfim|Jamaica:Jamaica|Japan:Japão|Jordan:Jordânia|Kazakhstan:Cazaquistão|Kenya:Quênia|Kiribati:Quiribati|Kosovo:Kosovo|Kuwait:Kuwait|Kyrgyzstan:Quirguistão|Laos:Laos|Latvia:Letônia|Lebanon:Líbano|Lesotho:Lesoto|Liberia:Libéria|Libya:Líbia|Liechtenstein:Liechtenstein|Lithuania:Lituânia|Luxembourg:Luxemburgo|Madagascar:Madagascar|Malawi:Malawi|Malaysia:Malásia|Maldives:Maldivas|Mali:Mali|Malta:Malta|Mauritania:Mauritânia|Mauritius:Maurício|Mexico:México|Micronesia:Micronésia|Moldova:Moldávia|Monaco:Mônaco|Mongolia:Mongólia|Montenegro:Montenegro|Morocco:Marrocos|Mozambique:Moçambique|Myanmar:Mianmar|Namibia:Namíbia|Nauru:Nauru|Nepal:Nepal|Netherlands:Países Baixos|New Caledonia:Nova Caledônia|New Zealand:Nova Zelândia|Nicaragua:Nicarágua|Niger:Níger|Nigeria:Nigéria|North Korea:Coreia do Norte|North Macedonia:Macedônia do Norte|Macedonia:Macedônia do Norte|N. Cyprus:Chipre do Norte|Norway:Noruega|Oman:Omã|Pakistan:Paquistão|Palau:Palau|Palestine:Palestina|Panama:Panamá|Papua New Guinea:Papua-Nova Guiné|Paraguay:Paraguai|Peru:Peru|Philippines:Filipinas|Poland:Polônia|Portugal:Portugal|Puerto Rico:Porto Rico|Qatar:Catar|Romania:Romênia|Russia:Rússia|Rwanda:Ruanda|S. Sudan:Sudão do Sul|Saint Lucia:Santa Lúcia|Samoa:Samoa|San Marino:San Marino|São Tomé and Principe:São Tomé e Príncipe|Saudi Arabia:Arábia Saudita|Senegal:Senegal|Serbia:Sérvia|Seychelles:Seicheles|Sierra Leone:Serra Leoa|Singapore:Singapura|Slovakia:Eslováquia|Slovenia:Eslovênia|Solomon Is.:Ilhas Salomão|Somalia:Somália|Somaliland:Somalilândia|South Africa:África do Sul|South Korea:Coreia do Sul|South Sudan:Sudão do Sul|Spain:Espanha|Sri Lanka:Sri Lanka|St. Kitts and Nevis:São Cristóvão e Névis|St. Vin. and Gren.:São Vicente e Granadinas|Sudan:Sudão|Suriname:Suriname|Sweden:Suécia|Switzerland:Suíça|Syria:Síria|Taiwan:Taiwan|Tajikistan:Tadjiquistão|Tanzania:Tanzânia|Thailand:Tailândia|Timor-Leste:Timor-Leste|Togo:Togo|Tonga:Tonga|Trinidad and Tobago:Trinidad e Tobago|Tunisia:Tunísia|Turkey:Turquia|Turkmenistan:Turcomenistão|Tuvalu:Tuvalu|Uganda:Uganda|Ukraine:Ucrânia|United Arab Emirates:Emirados Árabes Unidos|United Kingdom:Reino Unido|United States of America:Estados Unidos|Uruguay:Uruguai|Uzbekistan:Uzbequistão|Vanuatu:Vanuatu|Vatican:Vaticano|Venezuela:Venezuela|Vietnam:Vietnã|W. Sahara:Saara Ocidental|Yemen:Iêmen|Zambia:Zâmbia|Zimbabwe:Zimbábue`.split('|').map(p=>{const i=p.lastIndexOf(':');return [p.slice(0,i),p.slice(i+1)]}));
const PALETA=['#f3ead0','#dcebc6','#f2d9d3','#d9e4f2','#ecdcf0','#f6e3c4'];
const PALETA_N=['#2b3a30','#33362a','#3a2f33','#2a3542','#352c3d','#3b3426'];
function buildCountries(topo){
  const tr=topo.transform;
  const arcs=topo.arcs.map(a=>{let x=0,y=0;return a.map(p=>{if(tr){x+=p[0];y+=p[1];return [x*tr.scale[0]+tr.translate[0],y*tr.scale[1]+tr.translate[1]]}return [p[0],p[1]]})});
  const obj=topo.objects.countries||Object.values(topo.objects)[0];
  const ringPts=idx=>{const pts=[];for(const i of idx){const a=i>=0?arcs[i]:arcs[~i].slice().reverse();for(let k=pts.length?1:0;k<a.length;k++)pts.push(a[k])}return pts};
  const out=[];let n=0;
  for(const g of obj.geometries){
    const polysArcs=g.type==='Polygon'?[g.arcs]:g.type==='MultiPolygon'?g.arcs:[];
    const polys=[];let bb=[1e9,1e9,-1e9,-1e9],best=null,bestA=-1;
    for(const pa of polysArcs){
      const rings=pa.map(r=>{const pts=ringPts(r),f=new Float64Array(pts.length*2);for(let i=0;i<pts.length;i++){f[2*i]=lonToX(pts[i][0]);f[2*i+1]=latToY(pts[i][1])}return f});
      if(!rings.length||rings[0].length<6)continue;
      const o=rings[0];let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,A=0,cxs=0,cys=0;
      for(let i=0;i<o.length;i+=2){const x=o[i],y=o[i+1];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
        const j=(i+2)%o.length,xx=o[j],yy=o[j+1],cr=x*yy-xx*y;A+=cr;cxs+=(x+xx)*cr;cys+=(y+yy)*cr}
      const poly={rings,bbox:[x0,y0,x1,y1]};polys.push(poly);
      bb=[Math.min(bb[0],x0),Math.min(bb[1],y0),Math.max(bb[2],x1),Math.max(bb[3],y1)];
      const ba=(x1-x0)*(y1-y0);
      if(ba>bestA){bestA=ba;A/=2;best={poly,x:Math.abs(A)>1e-12?cxs/(6*A):(x0+x1)/2,y:Math.abs(A)>1e-12?cys/(6*A):(y0+y1)/2}}
    }
    if(!polys.length)continue;
    const nm=(g.properties&&g.properties.name)||'?';
    let lx=best.x,ly=best.y;const pb=best.poly.bbox;
    if(!(lx>pb[0]&&lx<pb[2]&&ly>pb[1]&&ly<pb[3])){lx=(pb[0]+pb[2])/2;ly=(pb[1]+pb[3])/2}
    out.push({name:nm,pt:PT[nm]||nm,polys,bbox:bb,lx,ly,lw:pb[2]-pb[0],lbb:pb,ci:n++%PALETA.length});
  }
  return out;
}
function buildCities(geo){
  const out=[];
  for(const f of geo.features||[]){
    const p=f.properties||{},c=f.geometry&&f.geometry.coordinates;if(!c)continue;
    const pop=+p.pop_max||+p.pop_min||0;
    out.push([p.name||p.nameascii||'?',p.adm0name||'',c[1],c[0],pop,/capital/i.test(p.featurecla||'')&&!/admin-1/i.test(p.featurecla||'')?1:0]);
  }
  out.sort((a,b)=>b[4]-a[4]);
  return out;
}
let world=null,cities=[];

/* ============ câmera ============ */
const cv=$('#map'),ctx=cv.getContext('2d');
let dpr=1,W=0,H=0,dirty=true,anim=null;
const view={cx:lonToX(-50),cy:latToY(-14),z:3.4,bearing:0};
const MINZ=1.3,MAXZ=19.5;
try{const v=JSON.parse(localStorage.getItem('navi.view')||'null');if(v&&isFinite(v.cx)&&isFinite(v.cy)&&isFinite(v.z)){view.cx=v.cx;view.cy=clamp(v.cy,0,1);view.z=clamp(v.z,MINZ,MAXZ)}}catch(e){}
const worldSize=z=>256*Math.pow(2,z);
function frame(){const S_=worldSize(view.z),t=view.bearing*D2R;return{S:S_,c:Math.cos(t),s:Math.sin(t),cx:view.cx,cy:view.cy,hw:W/2,hh:H/2}}
function project(wx,wy,F=frame()){const u=wx-F.cx,v=wy-F.cy;return[F.hw+F.S*(F.c*u+F.s*v),F.hh+F.S*(-F.s*u+F.c*v)]}
function unproject(sx,sy,F=frame()){const dx=sx-F.hw,dy=sy-F.hh;return[F.cx+(F.c*dx-F.s*dy)/F.S,F.cy+(F.s*dx+F.c*dy)/F.S]}
const projLL=(lat,lon,F)=>project(lonToX(lon),latToY(lat),F);
function screenToLL(sx,sy,F=frame()){const p=unproject(sx,sy,F);return{lat:yToLat(p[1]),lon:((xToLon(p[0])+540)%360)-180}}
function viewExtent(F=frame()){const p=[[0,0],[W,0],[0,H],[W,H]].map(q=>unproject(q[0],q[1],F));
  return{x0:Math.min(...p.map(a=>a[0])),x1:Math.max(...p.map(a=>a[0])),y0:Math.min(...p.map(a=>a[1])),y1:Math.max(...p.map(a=>a[1]))}}
function normalizeView(){view.cx=((view.cx%1)+1)%1;view.cy=clamp(view.cy,0.001,0.999);view.z=clamp(view.z,MINZ,MAXZ);view.bearing=wrap360(view.bearing)}
const invalidate=()=>{dirty=true};
function resize(){dpr=Math.min(window.devicePixelRatio||1,3);W=cv.clientWidth;H=cv.clientHeight;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);invalidate()}
window.addEventListener('resize',resize);
function flyTo(b,ms=800,done){
  if(S.saver)ms=Math.min(ms,200);
  const a={cx:view.cx,cy:view.cy,z:view.z,bearing:view.bearing};
  let dx=b.cx-a.cx;if(dx>.5)a.cx+=1;else if(dx<-.5)a.cx-=1;
  const nb={cx:b.cx,cy:b.cy,z:b.z===undefined?view.z:b.z};
  if(b.bearing!==undefined){nb.bearing=b.bearing;nb.bearing=a.bearing+angD(a.bearing,nb.bearing)}
  anim={a,b:nb,t0:performance.now(),ms,done};
}
function flyToLL(lat,lon,z,ms){flyTo({cx:lonToX(lon),cy:latToY(lat),z},ms)}
function fitBBox(b,pad=0.9){ // b={w,e,s,n}
  const bw=Math.max(lonToX(b.e)-lonToX(b.w),1e-7),bh=Math.max(latToY(b.s)-latToY(b.n),1e-7);
  return clamp(Math.log2(Math.min(W/(bw*256),H/(bh*256)))+Math.log2(pad),MINZ,MAXZ);
}

/* ============ paletas ============ */
const PAL={
  light:{ocean:'#cfe6f5',land:'#f2efe9',park:'#cde8c2',water:'#aad3df',waterLine:'#8fc0d2',border:'#7b8794',
    casing:['#c9607a','#d79a58','#cdb45a','#b9b9b9','#c8c8c8','#d2d2d2','#c0645a'],
    fill:['#f6a5b4','#fdc88e','#fdeaa6','#ffffff','#ffffff','#f6f6f6','#c0645a'],
    text:'#2a2f33',halo:'rgba(255,255,255,.88)',place:'#4a5560',poi:'#1a73e8',country:'#3d5160'},
  dark:{ocean:'#0f1a24',land:'#232b33',park:'#233a2c',water:'#1d3e52',waterLine:'#2a5a75',border:'#5e6b77',
    casing:['#5c2434','#5c4220','#55471c','#3a444d','#394650','#323c45','#9b5a52'],
    fill:['#a8566a','#b3834a','#a8913c','#58656f','#4d5a64','#424d56','#9b5a52'],
    text:'#dde6ec',halo:'rgba(15,26,36,.85)',place:'#b5c3ce',poi:'#6fb1ff',country:'#a9bbc8'}
};
const pal=()=>S.night?PAL.dark:PAL.light;

/* ============ desenho do mundo ============ */
function drawCountries(F,ext){
  const P=pal();ctx.lineJoin='round';ctx.strokeStyle=P.border;
  ctx.lineWidth=clamp(0.6+view.z*0.12,0.7,1.8);
  const minPx=0.8/F.S,cols=S.night?PALETA_N:PALETA;
  for(const co of world){
    for(let k=-2;k<=2;k++){
      const b=co.bbox;if(b[2]+k<ext.x0||b[0]+k>ext.x1||b[3]<ext.y0||b[1]>ext.y1)continue;
      ctx.beginPath();let any=false;
      for(const poly of co.polys){
        const pb=poly.bbox;
        if(pb[2]+k<ext.x0||pb[0]+k>ext.x1||pb[3]<ext.y0||pb[1]>ext.y1)continue;
        if(pb[2]-pb[0]<minPx&&pb[3]-pb[1]<minPx)continue;
        for(const r of poly.rings){
          let lx=-1e9,ly=-1e9,first=true;
          for(let i=0;i<r.length;i+=2){
            const u=r[i]+k-F.cx,v=r[i+1]-F.cy,x=F.hw+F.S*(F.c*u+F.s*v),y=F.hh+F.S*(-F.s*u+F.c*v);
            if(!first&&i<r.length-2&&(x-lx)*(x-lx)+(y-ly)*(y-ly)<0.36)continue;
            if(first){ctx.moveTo(x,y);first=false}else ctx.lineTo(x,y);lx=x;ly=y}
          ctx.closePath();any=true}
      }
      if(!any)continue;
      ctx.fillStyle=cols[co.ci];ctx.fill('evenodd');ctx.stroke();
    }
  }
}
function cityThreshold(z){return z<2.4?5e6:z<3.2?2.5e6:z<4?1.2e6:z<4.8?6e5:z<5.6?3e5:z<6.4?1.5e5:z<7.2?8e4:z<8?4e4:z<9?1e4:0}
function drawWorldLabels(F,ext,boxes,free){
  const P=pal();
  ctx.textBaseline='middle';ctx.lineJoin='round';
  if(view.z<7.5){
    const fs=clamp(10+view.z*1.1,11,16);
    ctx.font='600 '+fs+'px system-ui,Arial,sans-serif';ctx.textAlign='center';
    for(const co of world){
      for(let k=-2;k<=2;k++){
        const wx=co.lx+k;if(wx<ext.x0||wx>ext.x1||co.ly<ext.y0||co.ly>ext.y1)continue;
        const txt=co.pt,tw=ctx.measureText(txt).width,[x,y]=project(wx,co.ly,F);
        if(x<-40||x>W+40||y<-20||y>H+20)continue;
        if(co.lw*F.S<tw*0.55&&view.z<5)continue;
        if(!free(x-tw/2-2,y-fs/2-1,tw+4,fs+2))continue;
        ctx.lineWidth=3;ctx.strokeStyle=P.halo;ctx.strokeText(txt,x,y);
        ctx.fillStyle=P.country;ctx.fillText(txt,x,y);
      }
    }
  }
  const thr=cityThreshold(view.z);let drawn=0;
  ctx.textAlign='left';
  for(let i=0;i<cities.length&&drawn<260;i++){
    const c=cities[i],pop=c[4],cap=c[5];
    const show=cap?(view.z>=3&&pop>=thr/6)||(view.z>=4.5):pop>=thr;
    if(!show)continue;
    const wy=latToY(c[2]);if(wy<ext.y0||wy>ext.y1)continue;
    for(let k=-2;k<=2;k++){
      const wx=lonToX(c[3])+k;if(wx<ext.x0||wx>ext.x1)continue;
      const[x,y]=project(wx,wy,F);if(x<-10||x>W+10||y<-10||y>H+10)continue;
      const r=cap?5:pop>=1e6?4.2:pop>=2.5e5?3.2:2.4,fs=cap?13:12;
      ctx.font=(cap||pop>=1e6?'600 ':'400 ')+fs+'px system-ui,Arial,sans-serif';
      const tw=ctx.measureText(c[0]).width;
      if(!free(x-r-1,y-r-1,r*2+2,r*2+2))continue;
      const lx=x+r+4,okLabel=free(lx-1,y-fs/2-1,tw+3,fs+2);
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);
      if(cap){ctx.fillStyle='#c62828';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke()}
      else{ctx.fillStyle=pop>=1e6?'#37474f':'#78909c';if(S.night)ctx.fillStyle='#b0bec5';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=P.halo;ctx.stroke()}
      if(okLabel){ctx.lineWidth=3;ctx.strokeStyle=P.halo;ctx.strokeText(c[0],lx,y);ctx.fillStyle=P.text;ctx.fillText(c[0],lx,y)}
      drawn++;
    }
  }
}

/* ============ quadro ============ */
const overlays=[];   // funções (F, ext) desenhadas acima do mapa (rota, usuário, marcadores)
const labelPass=[];  // funções (F, ext, boxes, free) que desenham rótulos do mapa vetorial
function niceDist(m){const p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;return(f>=5?5:f>=2?2:1)*p}
function updateHud(F){
  const lat=yToLat(view.cy),mpp=40075016.686*Math.cos(lat*D2R)/F.S;
  const d=niceDist(mpp*90),px=d/mpp;
  $('#scaleBar').style.width=Math.round(px)+'px';
  $('#scaleTxt').textContent=d>=1000?(d/1000)+' km':d+' m';
  const lon=((xToLon(view.cx)+540)%360)-180;
  $('#coords').textContent='centro '+lat.toFixed(4)+', '+lon.toFixed(4);
  $('#needle').style.transform='rotate('+(-view.bearing)+'deg)';
  $('#attr').hidden=!(typeof MapData!=='undefined'&&MapData.shown);
}
let lastRender=0;
function render(){
  if(!W||!H)return;
  const P=pal(),F=frame(),ext=viewExtent(F);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle=P.ocean;ctx.fillRect(0,0,W,H);
  if(world)drawCountries(F,ext);
  if(typeof drawVector==='function')drawVector(F,ext);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const boxes=[],free=(x,y,w,h)=>{for(const b of boxes)if(x<b[2]&&x+w>b[0]&&y<b[3]&&y+h>b[1])return false;boxes.push([x,y,x+w,y+h]);return true};
  const covered=typeof MapData!=='undefined'&&MapData.shown&&view.z>=9.5;
  for(const f of labelPass)f(F,ext,boxes,free);
  if(world&&!covered)drawWorldLabels(F,ext,boxes,free);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  for(const f of overlays)f(F,ext);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  updateHud(F);
}
let saveT=0;
function loop(t){
  if(anim){
    const k=Math.min(1,(t-anim.t0)/anim.ms),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    view.cx=anim.a.cx+(anim.b.cx-anim.a.cx)*e;view.cy=anim.a.cy+(anim.b.cy-anim.a.cy)*e;
    view.z=anim.a.z+(anim.b.z-anim.a.z)*e;
    if(anim.b.bearing!==undefined)view.bearing=anim.a.bearing+(anim.b.bearing-anim.a.bearing)*e;
    if(k>=1){const done=anim.done;anim=null;normalizeView();done&&done()}
    dirty=true;
  }
  if(Hooks.frame&&!anim)Hooks.frame(t);
  const minGap=S.saver?55:0;
  if(dirty&&t-lastRender>=minGap){dirty=false;lastRender=t;normalizeView();render();
    if(t-saveT>2000){saveT=t;try{localStorage.setItem('navi.view',JSON.stringify({cx:view.cx,cy:view.cy,z:view.z}))}catch(e){}}}
  requestAnimationFrame(loop);
}

/* ============ gestos ============ */
const Hooks={tap:null,longpress:null,interact:null,frame:null};
const ptrs=new Map();let pinch=null,lastTap={t:0,x:0,y:0},downInfo=null,tapTimer=0,lpTimer=0;
function zoomAbout(sx,sy,newZ){
  newZ=clamp(newZ,MINZ,MAXZ);const F=frame(),p=unproject(sx,sy,F);
  view.z=newZ;const F2=frame(),dx=sx-F2.hw,dy=sy-F2.hh;
  view.cx=p[0]-(F2.c*dx-F2.s*dy)/F2.S;view.cy=p[1]-(F2.s*dx+F2.c*dy)/F2.S;invalidate()
}
cv.addEventListener('pointerdown',e=>{
  anim=null;cv.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===1){downInfo={x:e.clientX,y:e.clientY,t:performance.now(),moved:false,long:false};
    clearTimeout(lpTimer);lpTimer=setTimeout(()=>{if(downInfo&&!downInfo.moved&&ptrs.size===1){downInfo.long=true;if(navigator.vibrate)try{navigator.vibrate(25)}catch(_){}Hooks.longpress&&Hooks.longpress(downInfo.x,downInfo.y)}},550)}
  if(ptrs.size===2){const[a,b]=[...ptrs.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)};if(downInfo)downInfo.moved=true;clearTimeout(lpTimer)}
  Hooks.pdown&&Hooks.pdown();
});
cv.addEventListener('pointermove',e=>{
  const p=ptrs.get(e.pointerId);if(!p)return;
  const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
  if(downInfo&&!downInfo.moved&&Math.hypot(e.clientX-downInfo.x,e.clientY-downInfo.y)>9){downInfo.moved=true;clearTimeout(lpTimer);Hooks.interact&&Hooks.interact()}
  if(downInfo&&!downInfo.moved)return;
  if(ptrs.size===1){const F=frame();view.cx-=(F.c*dx-F.s*dy)/F.S;view.cy-=(F.s*dx+F.c*dy)/F.S;invalidate()}
  else if(ptrs.size===2&&pinch){
    const[a,b]=[...ptrs.values()],d=Math.hypot(a.x-b.x,a.y-b.y);
    if(d>0&&pinch.d>0)zoomAbout((a.x+b.x)/2,(a.y+b.y)/2,view.z+Math.log2(d/pinch.d));
    pinch.d=d;
  }
});
function endPtr(e){
  if(!ptrs.has(e.pointerId))return;ptrs.delete(e.pointerId);clearTimeout(lpTimer);
  if(ptrs.size<2)pinch=null;
  if(ptrs.size===0&&downInfo&&!downInfo.moved&&!downInfo.long&&performance.now()-downInfo.t<350&&e.type==='pointerup'){
    const now=performance.now(),x=e.clientX,y=e.clientY;
    if(now-lastTap.t<320&&Math.hypot(x-lastTap.x,y-lastTap.y)<40){
      clearTimeout(tapTimer);const p=unproject(x,y);Hooks.interact&&Hooks.interact();
      flyTo({cx:p[0],cy:p[1],z:clamp(view.z+1.2,MINZ,MAXZ)},350);lastTap.t=0}
    else{lastTap={t:now,x,y};clearTimeout(tapTimer);tapTimer=setTimeout(()=>{Hooks.tap&&Hooks.tap(x,y)},300)}
  }
  if(ptrs.size===0)downInfo=null;
}
cv.addEventListener('pointerup',endPtr);cv.addEventListener('pointercancel',endPtr);
cv.addEventListener('wheel',e=>{e.preventDefault();anim=null;Hooks.interact&&Hooks.interact();zoomAbout(e.clientX,e.clientY,view.z-e.deltaY*0.0018)},{passive:false});
$('#zin').onclick=()=>{anim=null;flyTo({cx:view.cx,cy:view.cy,z:clamp(view.z+1,MINZ,MAXZ)},250)};
$('#zout').onclick=()=>{anim=null;flyTo({cx:view.cx,cy:view.cy,z:clamp(view.z-1,MINZ,MAXZ)},250)};

/* ============ busca de lugares na internet (só quando o usuário pede) ============ */
async function nominatim(q,limit=8){
  const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit='+limit+'&accept-language=pt-BR&q='+encodeURIComponent(q),{referrerPolicy:'strict-origin-when-cross-origin'});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return await r.json();
}
