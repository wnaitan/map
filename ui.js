'use strict';
/* NAVI OFFLINE - interface: telas, busca, cartão de destino, bússola, offline, ajustes, extras */
const el=(tag,props,...kids)=>{const e=document.createElement(tag);if(props)for(const k in props){if(k==='class')e.className=props[k];else if(k==='text')e.textContent=props[k];else if(k.startsWith('on'))e[k]=props[k];else e.setAttribute(k,props[k])}for(const c of kids)if(c)e.append(c);return e};
const userRef=()=>GPS.fix?{lat:GPS.fix.lat,lon:GPS.fix.lon}:{lat:yToLat(view.cy),lon:((xToLon(view.cx)+540)%360)-180};
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return true}catch(e){}
  try{const a=el('textarea',{});a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.append(a);a.select();const ok=document.execCommand('copy');a.remove();return ok}catch(e){return false}
}

/* ============ painéis e telas ============ */
const sheets={places:$('#sPlaces'),offline:$('#sOffline'),more:$('#sMore')};
const tabBtns={map:$('#nMap'),compass:$('#nCompass'),places:$('#nPlaces'),offline:$('#nOffline'),more:$('#nMore')};
let screenOpen=null;
function setTab(n){for(const k in tabBtns)tabBtns[k].classList.toggle('on',k===n)}
function closeSheets(){for(const k in sheets)sheets[k].classList.remove('open')}
function closeScreen(){
  if(!screenOpen)return;screenOpen=null;$('#screenCompass').hidden=true;
  if(S.mapMode!=='heading'&&!Nav.active)Compass.stop();
}
function goTab(n){
  closeSearch();
  if(n==='map'){closeSheets();closeScreen();setTab('map');return}
  if(n==='compass'){
    closeSheets();if(screenOpen==='compass'){goTab('map');return}
    screenOpen='compass';$('#screenCompass').hidden=false;setTab('compass');hideDest();
    if(!Compass.on)Compass.start();
    renderCompassScreen();return;
  }
  closeScreen();
  const open=sheets[n].classList.contains('open');
  closeSheets();
  if(open){setTab('map');return}
  sheets[n].classList.add('open');setTab(n);
  if(n==='places')renderPlaces();if(n==='offline')renderOffline();if(n==='more')renderMore();
}
for(const k in tabBtns)tabBtns[k].onclick=()=>goTab(k);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>goTab('map'));
Hooks.pdown=()=>{closeSearch();if(!$('#dcard').hidden||true){closeSheets();if(!screenOpen)setTab('map')}};

/* ============ modo do mapa (bússola) e seguir posição ============ */
const Follow={on:false,flyOnFix:false};
function setMapMode(m,quiet){
  const bm=$('#bMode');
  if(m==='heading'){
    Compass.start().then(ok=>{
      if(!ok){S.mapMode='north';saveS();bm.classList.remove('on');return}
      S.mapMode='heading';saveS();bm.classList.add('on');if(!quiet)toast('Bússola ligada: o mapa gira com você');applyCamera();updateChips();renderCompassScreen();
    });
  }else{
    S.mapMode='north';saveS();bm.classList.remove('on');
    if(!screenOpen&&!Nav.active)Compass.stop();
    flyTo({cx:view.cx,cy:view.cy,z:view.z,bearing:view.bearing>180?360:0},350,()=>{view.bearing=0});
    if(!quiet)toast('Norte fixo no topo');updateChips();renderCompassScreen();
  }
}
$('#bMode').onclick=()=>setMapMode(S.mapMode==='heading'?'north':'heading');
function applyCamera(){
  if(anim){return}
  const f=GPS.fix;
  if(S.mapMode==='heading'){const h=getHeading();if(h)view.bearing=wrap360(view.bearing+angD(view.bearing,h.deg)*0.5)}
  if(Follow.on&&f&&GPS.on){
    view.cx=lonToX(f.lon);view.cy=latToY(f.lat);
    if(Nav.active){const p=unproject(W/2,H/2-H*0.18);view.cx=p[0];view.cy=p[1]}
  }
  invalidate();
}
Hooks.frame=()=>{ // gira o mapa suavemente até o rumo real (bússola ou GPS), independente da taxa do sensor
  if(S.mapMode!=='heading')return;const h=getHeading();if(!h)return;
  const d=angD(view.bearing,h.deg);if(Math.abs(d)>0.2){view.bearing=wrap360(view.bearing+d*(S.saver?0.4:0.25));invalidate()}
};
Hooks.interact=()=>{if(Follow.on){Follow.on=false;$('#bLocate').classList.remove('on')}};
function goToMe(){
  if(!GPS.on){GPS.start();Follow.flyOnFix=true;toast('Ligando o GPS… aguarde o sinal',3000);return}
  const st=GPS.status();
  if(!GPS.fix){toast(st.text+'. '+st.help,4000);Follow.flyOnFix=true;return}
  if(st.code==='nosignal')toast(st.text+'. A posição mostrada é antiga.',4000);
  Follow.on=true;$('#bLocate').classList.add('on');
  const f=GPS.fix;flyTo({cx:lonToX(f.lon),cy:latToY(f.lat),z:Math.max(view.z,16)},600,()=>applyCamera());
}
$('#bLocate').onclick=goToMe;

/* ============ chips de estado ============ */
let lastHeadChip=0;
function updateChips(){
  const gs=GPS.status(),c=$('#chipGps');
  c.className='chip '+gs.cls;c.querySelector('span').textContent=gs.text;
  const M=MapData,o=$('#chipOff');let txt,cls='';
  if(!M.regions.length){txt='Sem mapa de ruas · toque para baixar';cls='weak'}
  else{
    const here=GPS.fix&&coveredAt(GPS.fix.lat,GPS.fix.lon);
    txt=M.regions.length+(M.regions.length>1?' mapas offline':' mapa offline')+(GPS.fix?(here?' · você está na área ✓':' · você está fora da área'):'');cls=GPS.fix&&!here?'weak':'ok';
  }
  o.className='chip '+cls;o.querySelector('span').textContent=txt;
  const h=$('#chipHead'),hd=getHeading();
  if(S.mapMode==='heading'||screenOpen==='compass'){
    h.hidden=false;
    if(hd)h.textContent='Rumo '+Math.round(hd.deg)+'° '+cardSigla(hd.deg)+' · '+(hd.src==='gps'?'GPS':'bússola');
    else h.textContent=Compass.on?'Bússola sem leitura':'Bússola desligada';
  }else h.hidden=true;
}
$('#chipGps').onclick=()=>{const st=GPS.status();if(st.code==='off'||st.code==='denied'){GPS.start();if(st.code==='denied')toast(st.help,5000)}else goToMe()};
$('#chipOff').onclick=()=>goTab('offline');

/* ============ GPS: tudo que depende de uma nova posição ============ */
GPS.onChange(fix=>{
  updateChips();
  if(fix){
    if(Follow.flyOnFix){Follow.flyOnFix=false;Follow.on=true;$('#bLocate').classList.add('on');flyTo({cx:lonToX(fix.lon),cy:latToY(fix.lat),z:Math.max(view.z,16)},700,()=>applyCamera())}
    else applyCamera();
    navOnFix(fix);
  }else if(Nav.active)renderNav();
  if(screenOpen==='compass')renderCompassScreen();
  if($('#sMore').classList.contains('open'))renderDeclInfo();
  invalidate();
});
let headTimer=0;
Compass.onChange(()=>{
  applyCamera();
  const n=performance.now(),upd=()=>{lastHeadChip=performance.now();updateChips();if(screenOpen==='compass')renderCompassScreen()};
  if(n-lastHeadChip>250){clearTimeout(headTimer);headTimer=0;upd()}
  else if(!headTimer)headTimer=setTimeout(()=>{headTimer=0;upd()},260); // garante a última leitura na tela
});

/* ============ busca ============ */
let worldIdx=[];
function buildWorldIdx(){
  worldIdx=[];if(!world)return;
  for(const co of world)worldIdx.push({t:'país',n:co.pt,k:norm(co.pt)+' '+norm(co.name),sub:'País',co,pri:9});
  for(const c of cities)worldIdx.push({t:'cidade',n:c[0],k:norm(c[0]),sub:(c[5]?'Capital · ':'Cidade · ')+(c[1]||''),lat:c[2],lon:c[3],pri:c[4]>1e6?2:0,c});
}
function mineIdx(){
  const a=[];
  for(const p of User.fav)a.push({t:'fav',n:p.n,k:norm(p.n),sub:'⭐ Favorito',lat:p.lat,lon:p.lon,pri:5});
  for(const p of User.pt)a.push({t:'pt',n:p.n,k:norm(p.n),sub:'📍 Meu ponto',lat:p.lat,lon:p.lon,pri:5});
  for(const p of User.srch)a.push({t:'srch',n:p.n,k:norm(p.n),sub:'Lugar salvo · '+(p.sub||''),lat:p.lat,lon:p.lon,pri:3});
  for(const p of User.hist)a.push({t:'hist',n:p.n,k:norm(p.n),sub:'Destino recente',lat:p.lat,lon:p.lon,pri:2});
  return a;
}
function parseCoords(q){
  const m=/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(q);if(!m)return null;
  const a=parseFloat(m[1].replace(',','.')),b=parseFloat(m[2].replace(',','.'));
  return Math.abs(a)<=90&&Math.abs(b)<=180?{lat:a,lon:b}:null;
}
function searchAll(q){
  const ref=userRef(),cc=parseCoords(q);
  if(cc)return[{t:'pt',n:fmtCoord(cc.lat,cc.lon),sub:'Coordenadas digitadas',lat:cc.lat,lon:cc.lon,pri:9,k:''}];
  const mine=searchList(mineIdx(),q,ref).slice(0,6),loc=searchList(MapData.idx,q,ref).slice(0,16),wd=searchList(worldIdx,q,ref).slice(0,8);
  const seen=new Set(),out=[];
  for(const it of [...mine,...loc,...wd]){const k=it.t+'|'+it.n+'|'+(it.lat?it.lat.toFixed(3):'');if(seen.has(k))continue;seen.add(k);out.push(it)}
  return out;
}
const qEl=$('#q'),resEl=$('#results');
function closeSearch(){resEl.hidden=true;qEl.blur()}
function renderResults(r,q){
  resEl.hidden=false;resEl.innerHTML='';
  if(!r.length)resEl.append(el('div',{class:'vazio',text:MapData.regions.length?'Nada encontrado nos mapas e lugares salvos no aparelho.':'Nada encontrado. Ainda não há mapa de ruas baixado: abra “Offline” e baixe sua cidade.'}));
  for(const it of r){
    const sub=it.sub+(it.d&&it.t!=='país'&&it.d>0?' · '+fmtDist(it.d):'');
    resEl.append(el('button',{onclick:()=>pickResult(it)},el('span',{text:it.n}),el('small',{text:sub})));
  }
  const o=el('button',{class:'on',text:navigator.onLine?'Buscar “'+q+'” na internet (endereços, outras cidades)':'Sem internet: só mapas e lugares salvos',onclick:()=>onlineSearch(q)});
  o.disabled=!navigator.onLine;resEl.append(o);
}
function msgResults(txt){resEl.hidden=false;resEl.innerHTML='';resEl.append(el('div',{class:'vazio',text:txt}))}
qEl.addEventListener('input',()=>{
  $('#qx').hidden=!qEl.value;const q=qEl.value.trim();
  if(q.length<2){resEl.hidden=true;return}
  renderResults(searchAll(q),q);
});
qEl.addEventListener('keydown',e=>{if(e.key==='Enter'){const q=qEl.value.trim();if(q.length>=2&&navigator.onLine&&!searchAll(q).length)onlineSearch(q);else qEl.blur()}});
qEl.addEventListener('focus',()=>{goTab('map');const q=qEl.value.trim();if(q.length>=2)renderResults(searchAll(q),q)});
$('#qx').onclick=()=>{qEl.value='';$('#qx').hidden=true;resEl.hidden=true;hideDest()};
function pickResult(it){
  closeSearch();qEl.value=it.n;$('#qx').hidden=false;
  if(it.t==='país'){hideDest();const co=it.co,b=co.lbb,w=b[2]-b[0],h=b[3]-b[1];flyTo({cx:(b[0]+b[2])/2,cy:(b[1]+b[3])/2,z:clamp(Math.log2(Math.min(W/(w*256),H/(h*256)))-0.25,MINZ,9)},900);return}
  const z=it.t==='cidade'?(it.c[4]>5e6?10:11):it.t==='rua'?16:it.t==='bairro'?14.5:17;
  showDest({n:it.n,sub:it.sub,lat:it.lat,lon:it.lon,custom:it.t==='pt'});
  Follow.on=false;$('#bLocate').classList.remove('on');
  flyToLL(it.lat,it.lon,z,900);
}
async function onlineSearch(q){
  msgResults('Buscando na internet…');
  try{
    const arr=await nominatim(q,8);
    if(!arr.length){msgResults('Nada encontrado na internet.');return}
    resEl.innerHTML='';
    for(const p of arr){
      const nome=p.name||String(p.display_name||'').split(',')[0]||q;
      resEl.append(el('button',{onclick:()=>pickOnline(p,nome)},el('span',{text:nome}),el('small',{text:p.display_name||''})));
    }
  }catch(e){msgResults('Não foi possível buscar agora. Verifique a internet e tente de novo.')}
}
function pickOnline(p,nome){
  const lat=+p.lat,lon=+p.lon;if(!isFinite(lat)||!isFinite(lon))return;
  const sub=String(p.display_name||'').split(',').slice(1,4).join(',').trim();
  User.add('srch',{n:nome,sub,lat,lon});
  closeSearch();qEl.value=nome;$('#qx').hidden=false;
  showDest({n:nome,sub,lat,lon});
  let z=15;if(Array.isArray(p.boundingbox)&&p.boundingbox.length===4)z=clamp(fitBBox({s:+p.boundingbox[0],n:+p.boundingbox[1],w:+p.boundingbox[2],e:+p.boundingbox[3]},0.8),3,17);
  Follow.on=false;$('#bLocate').classList.remove('on');
  flyToLL(lat,lon,z,900);
  toast('Lugar salvo: depois você acha ele sem internet.',3000);
}

/* ============ cartão do destino ============ */
let Sel=null,plan={car:null,foot:null};
function showDest(d){
  Sel=d;plan={car:null,foot:null};goTab('map');
  if(Nav.active)return;
  if(Nav.route&&!(Nav.dest&&Nav.dest.lat===d.lat&&Nav.dest.lon===d.lon))clearRoute();
  $('#dTitle').textContent=d.n;
  $('#dSub').textContent=(d.sub?d.sub+' · ':'')+fmtCoord(d.lat,d.lon)+(GPS.fix&&GPS.usable()?' · a '+fmtDist(Routing.dist(GPS.fix.lat,GPS.fix.lon,d.lat,d.lon))+' em linha reta':'');
  $('#dSum').hidden=true;$('#dStart').hidden=true;$('#dSteps').hidden=true;$('#dStepList').hidden=true;
  refreshFavBtn();$('#dcard').hidden=false;invalidate();
}
function hideDest(){Sel=null;$('#dcard').hidden=true;if(!Nav.active)clearRoute();invalidate()}
function refreshFavBtn(){
  if(!Sel)return;const kind=Sel.custom?'pt':'fav',has=User.find(kind,Sel.lat,Sel.lon);
  $('#dFav').textContent=has?(kind==='pt'?'📍 Salvo':'⭐ Favorito'):(kind==='pt'?'📍 Salvar ponto':'☆ Favoritar');
}
$('#dClose').onclick=()=>{hideDest();qEl.value='';$('#qx').hidden=true};
$('#dFav').onclick=()=>{
  if(!Sel)return;const kind=Sel.custom?'pt':'fav',has=User.find(kind,Sel.lat,Sel.lon);
  if(has){User.remove(kind,has.lat,has.lon);toast('Removido de “Meus lugares”')}
  else{
    let n=Sel.n;if(Sel.custom){const v=prompt('Nome do ponto:',n==='Ponto no mapa'?'Meu ponto':n);if(v===null)return;n=v.trim()||'Meu ponto';Sel.n=n;$('#dTitle').textContent=n}
    User.add(kind,{n,sub:Sel.sub,lat:Sel.lat,lon:Sel.lon});toast('Salvo em “Meus lugares”')
  }
  refreshFavBtn();
};
$('#dCopy').onclick=async()=>{if(!Sel)return;toast(await copyText(Sel.lat.toFixed(6)+', '+Sel.lon.toFixed(6))?'Latitude e longitude copiadas':'Não consegui copiar')};
async function shareCoords(lat,lon,n){
  const url='https://www.openstreetmap.org/?mlat='+lat.toFixed(6)+'&mlon='+lon.toFixed(6)+'#map=17/'+lat.toFixed(5)+'/'+lon.toFixed(5),txt=(n?n+'\n':'')+lat.toFixed(6)+', '+lon.toFixed(6)+'\n'+url;
  if(navigator.share){try{await navigator.share({title:n||'Coordenadas',text:txt});return}catch(e){if(e&&e.name==='AbortError')return}}
  toast(await copyText(txt)?'Coordenadas copiadas (compartilhar não é suportado aqui)':'Não consegui compartilhar');
}
$('#dShare').onclick=()=>{if(Sel)shareCoords(Sel.lat,Sel.lon,Sel.n)};
$('#dMeasure').onclick=()=>{if(!Sel)return;const s=Sel;hideDest();startMeasure(s)};
async function dRoute(mode){
  if(!Sel)return;
  const gpsOk=GPS.usable()&&GPS.fix,from=gpsOk?{lat:GPS.fix.lat,lon:GPS.fix.lon}:userRef();
  const sum=$('#dSum');sum.hidden=false;sum.textContent='Calculando a rota offline…';$('#dStart').hidden=true;
  const r=await planRoute(Sel,mode,from);
  if(!r.ok){sum.textContent=ERR_TXT[r.err]||'Não foi possível calcular a rota.';clearRoute();return}
  plan[mode]=r;setRoute(Sel,mode,r,from);
  sum.textContent=(mode==='car'?'🚗 ':'🚶 ')+fmtDist(r.dist)+' · '+fmtDur(r.time)+(gpsOk?'':' · partindo do centro do mapa (GPS sem sinal utilizável: só planejamento)');
  $('#dStart').hidden=!gpsOk;$('#dSteps').hidden=false;$('#dStepList').hidden=true;
  const cs=r.coords,b={s:Math.min(...cs.map(c=>c[0])),n:Math.max(...cs.map(c=>c[0])),w:Math.min(...cs.map(c=>c[1])),e:Math.max(...cs.map(c=>c[1]))};
  Follow.on=false;$('#bLocate').classList.remove('on');
  flyTo({cx:(lonToX(b.w)+lonToX(b.e))/2,cy:(latToY(b.s)+latToY(b.n))/2,z:clamp(fitBBox(b,0.55),3,18)},700);
}
$('#dCar').onclick=()=>dRoute('car');$('#dFoot').onclick=()=>dRoute('foot');
$('#dSteps').onclick=()=>{
  const L=$('#dStepList');if(!L.hidden){L.hidden=true;return}
  L.innerHTML='';if(Nav.route)for(const s of Nav.route.steps)L.append(el('div',{text:(ICON[s.mod]||'⬆')+'  '+s.text+(s.type==='arrive'?'':'  ·  '+fmtDist(s.d))}));
  L.hidden=false;
};
$('#dStart').onclick=()=>{if(startNav()){hideDestKeepRoute()}};
function hideDestKeepRoute(){Sel=null;$('#dcard').hidden=true;invalidate()}
function onNavState(){
  const on=Nav.active;
  document.body.classList.toggle('navigating',on);
  $('#navTop').hidden=!on;$('#navBottom').hidden=!on;$('#top').hidden=on;
  if(on){
    closeSheets();closeScreen();setTab('map');Follow.on=true;$('#bLocate').classList.add('on');
    if(S.mapMode!=='heading')setMapMode('heading',true);
    flyTo({cx:view.cx,cy:view.cy,z:Math.max(view.z,16.5)},500,()=>applyCamera());
    $('#nvVoice').textContent=S.voice?'🔊 Voz':'🔇 Voz';renderNav();
  }else{Nav.alert='';updateChips()}
  invalidate();
}
$('#nvVoice').onclick=()=>{S.voice=!S.voice;saveS();$('#nvVoice').textContent=S.voice?'🔊 Voz':'🔇 Voz';if(!S.voice)try{speechSynthesis.cancel()}catch(e){}};
$('#nvRecalc').onclick=()=>{if(GPS.fix)reroute(GPS.fix);else toast('Sem posição de GPS para recalcular')};
$('#nvStop').onclick=()=>{if(Nav.arrived||confirm('Encerrar a navegação?')){stopNav();setMapMode('north',true)}};
/* mapa: toque e segurar */
Hooks.longpress=(x,y)=>{
  if(Nav.active)return;
  const p=screenToLL(x,y);
  if(Measure.on){addMeasurePoint(p.lat,p.lon);return}
  qEl.value='';$('#qx').hidden=true;
  showDest({n:'Ponto no mapa',sub:'Ponto marcado',lat:p.lat,lon:p.lon,custom:true});
};
Hooks.tap=(x,y)=>{
  const p=screenToLL(x,y);
  if(Measure.on){addMeasurePoint(p.lat,p.lon);return}
  if(Nav.active)return;
  const F=frame();
  for(const kind of ['fav','pt']){for(const u of User[kind]){const q=projLL(u.lat,u.lon,F);if(Math.hypot(q[0]-x,q[1]-(y+14))<26){showDest({n:u.n,sub:kind==='fav'?'⭐ Favorito':'📍 Meu ponto',lat:u.lat,lon:u.lon,custom:kind==='pt'});return}}}
  const poi=poiAt(x,y);
  if(poi){showDest({n:poi.n,sub:poi.c,lat:poi.lat,lon:poi.lon});return}
  if(!$('#dcard').hidden)hideDest();
};

/* ============ medir distância ============ */
const Measure={on:false,pts:[]};
function startMeasure(first){
  goTab('map');Measure.on=true;Measure.pts=[];if(first)Measure.pts.push({lat:first.lat,lon:first.lon});
  $('#measure').hidden=false;renderMeasure();toast('Toque no mapa para marcar os pontos',3000);
}
function addMeasurePoint(lat,lon){Measure.pts.push({lat,lon});renderMeasure()}
function measureTotal(){let t=0;for(let i=1;i<Measure.pts.length;i++)t+=Routing.dist(Measure.pts[i-1].lat,Measure.pts[i-1].lon,Measure.pts[i].lat,Measure.pts[i].lon);return t}
function renderMeasure(){
  const P=Measure.pts,t=$('#mTxt');
  if(!P.length)t.textContent='Toque no mapa para marcar o primeiro ponto.';
  else if(P.length===1)t.textContent='Ponto 1 marcado. Toque no mapa para marcar o próximo.';
  else{const a=P[P.length-2],b=P[P.length-1];t.innerHTML='Total: <b>'+fmtDist(measureTotal())+'</b> em '+P.length+' pontos<br>Último trecho: '+fmtDist(Routing.dist(a.lat,a.lon,b.lat,b.lon))+' · rumo '+Math.round(Routing.bearing(a.lat,a.lon,b.lat,b.lon))+'° '+cardSigla(Routing.bearing(a.lat,a.lon,b.lat,b.lon))+'<br><span class="nota">Linha reta sobre a Terra (não é a distância por rua).</span>'}
  invalidate();
}
$('#mUndo').onclick=()=>{Measure.pts.pop();renderMeasure()};
$('#mClear').onclick=()=>{Measure.pts=[];renderMeasure()};
$('#mDone').onclick=()=>{Measure.on=false;Measure.pts=[];$('#measure').hidden=true;invalidate()};
$('#mMe').onclick=()=>{if(GPS.fix&&GPS.usable()){Measure.pts.unshift({lat:GPS.fix.lat,lon:GPS.fix.lon});renderMeasure()}else toast('GPS sem sinal utilizável agora')};

/* ============ desenho: marcadores do usuário, destino, medição ============ */
function drawSel(F){
  if(!Sel||Nav.active)return;
  const[x,y]=projLL(Sel.lat,Sel.lon,F);if(x<-30||x>W+30||y<-40||y>H+30)return;
  ctx.save();ctx.translate(x,y);
  ctx.beginPath();ctx.moveTo(0,0);ctx.bezierCurveTo(-4,-9,-12,-14,-12,-22);ctx.arc(0,-22,12,Math.PI,0);ctx.bezierCurveTo(12,-14,4,-9,0,0);
  ctx.fillStyle='#e53935';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
  ctx.beginPath();ctx.arc(0,-22,4.5,0,TAU);ctx.fillStyle='#fff';ctx.fill();ctx.restore();
}
function drawMine(F,ext){
  if(view.z<7)return;
  ctx.font='20px system-ui,"Apple Color Emoji","Noto Color Emoji",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  for(const kind of ['pt','fav']){
    const emo=kind==='fav'?'⭐':'📍';
    for(const u of User[kind]){
      const[x,y]=projLL(u.lat,u.lon,F);if(x<-20||x>W+20||y<-20||y>H+20)continue;
      ctx.fillText(emo,x,y-10);
      if(view.z>=13&&!(view.z>=16.2&&MapData.pois.some(p=>p.n===u.n&&Math.abs(p.lat-u.lat)<6e-4&&Math.abs(p.lon-u.lon)<6e-4))){ctx.font='600 12px system-ui,Arial,sans-serif';ctx.lineWidth=3;ctx.strokeStyle=pal().halo;ctx.strokeText(u.n,x,y+8);ctx.fillStyle=pal().text;ctx.fillText(u.n,x,y+8);ctx.font='20px system-ui,"Apple Color Emoji","Noto Color Emoji",sans-serif'}
    }
  }
}
function drawMeasure(F){
  if(!Measure.on||!Measure.pts.length)return;
  const P=Measure.pts;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();P.forEach((p,i)=>{const[x,y]=projLL(p.lat,p.lon,F);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
  ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle='#e8710a';ctx.lineWidth=3;ctx.setLineDash([8,6]);ctx.stroke();ctx.setLineDash([]);
  ctx.font='700 12px system-ui,Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  P.forEach((p,i)=>{
    const[x,y]=projLL(p.lat,p.lon,F);ctx.beginPath();ctx.arc(x,y,10,0,TAU);ctx.fillStyle='#e8710a';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';ctx.fillText(String(i+1),x,y+0.5);
    if(i>0){const a=P[i-1],[ax,ay]=projLL(a.lat,a.lon,F),mx=(x+ax)/2,my=(y+ay)/2,t=fmtDist(Routing.dist(a.lat,a.lon,p.lat,p.lon)),tw=ctx.measureText(t).width;
      ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillRect(mx-tw/2-4,my-9,tw+8,18);ctx.fillStyle='#7a3b00';ctx.fillText(t,mx,my)}
  });
}
overlays.push(drawMine,drawSel,drawMeasure);

/* ============ Meus lugares ============ */
let plTab='fav';
document.querySelectorAll('#plTabs button').forEach(b=>b.onclick=()=>{plTab=b.dataset.t;renderPlaces()});
function renderPlaces(){
  document.querySelectorAll('#plTabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===plTab));
  const L=$('#plList');L.innerHTML='';const a=User[plTab];
  if(!a.length)L.append(el('p',{class:'nota',text:plTab==='fav'?'Nenhum favorito ainda. Abra um lugar e toque em “Favoritar”.':plTab==='pt'?'Nenhum ponto seu ainda. Segure o dedo no mapa e toque em “Salvar ponto”.':'Nenhum destino ainda. Os destinos em que você iniciar navegação aparecem aqui.'}));
  for(const p of a){
    const ref=userRef();
    L.append(el('div',{class:'item'},el('b',{text:p.n}),el('small',{text:(p.sub?p.sub+' · ':'')+fmtCoord(p.lat,p.lon)+' · '+fmtDist(Routing.dist(ref.lat,ref.lon,p.lat,p.lon))}),
      el('div',{class:'row'},
        el('button',{class:'btn peq',text:'Ir / Rota',onclick:()=>{goTab('map');showDest({n:p.n,sub:p.sub,lat:p.lat,lon:p.lon,custom:plTab==='pt'});Follow.on=false;flyToLL(p.lat,p.lon,16,800)}}),
        el('button',{class:'btn sec peq',text:'Copiar',onclick:async()=>toast(await copyText(p.lat.toFixed(6)+', '+p.lon.toFixed(6))?'Coordenadas copiadas':'Não consegui copiar')}),
        el('button',{class:'btn perigo peq',text:'Apagar',onclick:()=>{User.remove(plTab,p.lat,p.lon);renderPlaces()}}))));
  }
}

/* ============ Offline: baixar, listar, apagar ============ */
let Area=null; // {bbox,name}
function mapBox(){const e=viewExtent();return{w:xToLon(clamp(e.x0,0,1)),e:xToLon(clamp(e.x1,0,1)),n:yToLat(clamp(e.y0,0,1)),s:yToLat(clamp(e.y1,0,1))}}
function setArea(bbox,name){Area={bbox,name};$('#areaBox').hidden=false;$('#areaName').value=name;refreshArea()}
function refreshArea(){
  if(!Area)return;const mode=$('#areaMode').value,pl=planArea(Area.bbox,mode);Area.plan=pl;
  const b=pl.bbox,kmH=(b.n-b.s)*111.2,kmW=(b.e-b.w)*111.2*Math.cos((b.n+b.s)/2*D2R),n=pl.cells.length;
  $('#areaTitle').textContent=Area.name||'Área escolhida';
  const lo=mode==='full'?0.3:0.1,hi=mode==='full'?2:0.5;
  $('#areaInfo').textContent=n+' bloco'+(n>1?'s':'')+' · cerca de '+Math.round(kmW)+' × '+Math.round(kmH)+' km · tamanho estimado '+(n*lo).toFixed(0)+' a '+(n*hi).toFixed(0)+' MB'+(pl.trimmed?'. A área pedida é maior que o limite ('+CAP[mode]+' blocos por vez): vou baixar os '+n+' blocos mais próximos do centro. Depois baixe o restante movendo o mapa.':'');
  $('#areaGo').disabled=!!dl;
}
$('#areaMode').onchange=refreshArea;
$('#areaView').onclick=()=>{setArea(mapBox(),'Área da tela');if(!$('#areaName').value||$('#areaName').value==='Área da tela')$('#areaName').value=''};
$('#areaFind').onclick=async()=>{
  const q=$('#areaQ').value.trim();if(q.length<2)return;
  const R=$('#areaRes');R.innerHTML='';
  if(!navigator.onLine){R.append(el('p',{class:'nota',text:'Sem internet. Use “Área da tela”: aproxime o mapa da cidade e toque.'}));return}
  R.append(el('p',{class:'nota',text:'Procurando…'}));
  try{
    const arr=await nominatim(q,6);R.innerHTML='';
    if(!arr.length)R.append(el('p',{class:'nota',text:'Nada encontrado.'}));
    for(const p of arr){
      if(!Array.isArray(p.boundingbox))continue;
      const nome=p.name||String(p.display_name).split(',')[0];
      R.append(el('button',{class:'btn sec',style:'text-align:left;font-size:14px',onclick:()=>{
        const bb={s:+p.boundingbox[0],n:+p.boundingbox[1],w:+p.boundingbox[2],e:+p.boundingbox[3]};
        const big=(bb.n-bb.s)>0.6||(bb.e-bb.w)>0.6;
        if(big)$('#areaMode').value='main';
        setArea(bb,nome);R.innerHTML='';flyTo({cx:(lonToX(bb.w)+lonToX(bb.e))/2,cy:(latToY(bb.s)+latToY(bb.n))/2,z:clamp(fitBBox(bb,0.8),3,13)},700);
        if(big)toast('Área grande: escolhi “só estradas principais”. Para ruas, baixe por partes.',4500);
      },text:p.display_name}));
    }
  }catch(e){R.innerHTML='';R.append(el('p',{class:'nota',text:'Não foi possível buscar agora.'}))}
};
$('#areaGo').onclick=async()=>{
  if(!Area||!Area.plan||dl)return;
  if(!navigator.onLine){toast('Sem internet agora. Conecte-se para baixar.');return}
  const mode=$('#areaMode').value,name=($('#areaName').value||Area.name||'Região').trim();
  $('#areaProg').hidden=false;$('#areaGo').disabled=true;$('#areaBar').style.width='0%';
  wakeOn();
  const prog=p=>{$('#areaBar').style.width=Math.round(100*p.done/p.total)+'%';$('#areaTxt').textContent='Baixando bloco '+Math.min(p.done+1,p.total)+' de '+p.total+' · '+fmtMB(p.bytes)+' recebidos'+(p.fail?' · '+p.fail+' falha(s)':'')+(p.msg?' · '+p.msg:'')};
  prog({done:0,total:Area.plan.cells.length,fail:0,bytes:0});
  let res;
  try{res=await downloadArea(Area.plan,mode,name,prog)}catch(e){res={ok:0,fail:1,lastErr:e.message}}
  wakeOff();$('#areaProg').hidden=true;
  if(res.aborted)toast(res.ok?'Cancelado. O que foi baixado ficou salvo.':'Download cancelado',4000);
  else if(!res.ok)toast('Não foi possível baixar ('+(res.lastErr||'erro')+'). Tente de novo mais tarde.',6000);
  else if(res.fail)toast('Mapa salvo, mas '+res.fail+' bloco(s) falharam. Baixe a mesma área de novo para completar.',6000);
  else toast('Mapa salvo! Já funciona sem internet.',4000);
  if(res.ok&&navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  Area=null;$('#areaBox').hidden=true;renderOffline();
};
$('#areaCancel').onclick=cancelDownload;
function renderOffline(){
  const M=MapData,L=$('#regList');L.innerHTML='';
  $('#offStatus').textContent=M.regions.length?M.regions.length+' mapa(s) salvo(s) · '+M.ways.length.toLocaleString('pt-BR')+' ruas/caminhos · '+M.pois.length.toLocaleString('pt-BR')+' locais · '+M.idx.length.toLocaleString('pt-BR')+' nomes pesquisáveis':'Nenhum mapa de ruas baixado ainda.';
  if(!M.regions.length)L.append(el('p',{class:'nota',text:'Nada salvo ainda.'}));
  for(const r of M.regions){
    L.append(el('div',{class:'item'},el('b',{text:r.name}),
      el('small',{text:(r.mode==='main'?'Estradas principais':'Detalhado')+' · '+r.keys.length+' blocos · '+fmtMB(r.size)+' · '+new Date(r.date).toLocaleDateString('pt-BR')+(r.failed?' · incompleto ('+r.failed+' bloco(s) faltando)':'')}),
      el('div',{class:'row'},el('button',{class:'btn sec peq',text:'Ver no mapa',onclick:()=>{goTab('map');flyTo({cx:(lonToX(r.bbox.w)+lonToX(r.bbox.e))/2,cy:(latToY(r.bbox.s)+latToY(r.bbox.n))/2,z:clamp(fitBBox(r.bbox,0.85),3,14)},900)}}),
        el('button',{class:'btn perigo peq',text:'Apagar',onclick:async()=>{if(confirm('Apagar “'+r.name+'” do celular?')){await deleteRegion(r.id);renderOffline();updateChips()}}}))));
  }
  $('#worldInfo').textContent=world?'Salvo no aparelho: '+world.length+' países e '+cities.length.toLocaleString('pt-BR')+' cidades.':'Ainda não baixado (o mapa fica só com as ruas que você baixar).';
  $('#worldGo').hidden=!!world;
  if(navigator.storage&&navigator.storage.estimate)navigator.storage.estimate().then(e=>{$('#storeInfo').textContent='Espaço usado pelo app: '+fmtMB(e.usage||0)+(e.quota?' de '+fmtMB(e.quota)+' disponíveis':'')}).catch(()=>{});
  $('#areaGo').disabled=!!dl;
  if(Area)refreshArea();
}
function onMapDataChanged(){updateChips();if(sheets.offline.classList.contains('open'))renderOffline()}

/* ============ mundo (países e cidades) ============ */
async function loadWorldFromDB(){
  const [topo,cs]=await Promise.all([DB.get('kv','topo'),DB.get('kv','cities')]);
  if(!topo||!cs)return false;
  world=buildCountries(topo);cities=cs;buildWorldIdx();invalidate();return true;
}
async function downloadWorld(){
  const bar=$('#setupBar'),txt=$('#setupTxt'),go=$('#setupGo');
  if(!navigator.onLine){txt.textContent='Sem internet agora. Conecte-se e tente de novo, ou pule: o app funciona só com os mapas de ruas que você baixar.';return false}
  go.disabled=true;
  try{
    txt.textContent='Baixando os países do mundo…';bar.style.width='10%';
    const topo=await fetchFirst(COUNTRY_URLS);await DB.put('kv',topo,'topo');bar.style.width='50%';
    txt.textContent='Baixando as cidades do mundo…';
    const geo=await fetchFirst(CITY_URLS);bar.style.width='90%';
    await DB.put('kv',buildCities(geo),'cities');bar.style.width='100%';
    await loadWorldFromDB();$('#setup').hidden=true;toast('Mapa-múndi salvo. Funciona sem internet.',3500);renderOffline();return true;
  }catch(e){txt.textContent='Não foi possível baixar ('+(e&&e.message||'erro')+'). Tente de novo.';bar.style.width='0%';go.disabled=false;return false}
}
$('#setupGo').onclick=downloadWorld;
$('#setupSkip').onclick=()=>{try{localStorage.setItem('navi.skipWorld','1')}catch(e){}$('#setup').hidden=true;goTab('offline')};
$('#worldGo').onclick=()=>{$('#setup').hidden=false;$('#setupGo').disabled=false};

/* ============ tela da bússola ============ */
(function buildDial(){
  const svg=$('#dial');let h='<circle r="156" fill="var(--chip)" stroke="var(--linha)" stroke-width="2"/><g id="dialRot">';
  for(let a=0;a<360;a+=5){
    const long=a%30===0,mid=a%10===0,r1=150,r2=long?132:mid?138:144;
    h+='<line x1="0" y1="'+(-r1)+'" x2="0" y2="'+(-r2)+'" stroke="var(--texto)" stroke-width="'+(long?2.2:1)+'" opacity="'+(long?1:.55)+'" transform="rotate('+a+')"/>';
  }
  for(let a=30;a<360;a+=30){if(a%90===0)continue;h+='<text x="0" y="-116" text-anchor="middle" font-size="13" fill="var(--suave)" transform="rotate('+a+')">'+a+'</text>'}
  const L=[['N',0,'#d32f2f'],['L',90,'var(--texto)'],['S',180,'var(--texto)'],['O',270,'var(--texto)']];
  for(const[t,a,c]of L)h+='<text x="0" y="-108" text-anchor="middle" font-size="30" font-weight="800" fill="'+c+'" transform="rotate('+a+')">'+t+'</text>';
  h+='<path d="M0 -60 L9 0 L-9 0 Z" fill="#d32f2f"/><path d="M0 60 L9 0 L-9 0 Z" fill="#90a4ae"/></g>';
  h+='<path d="M0 -164 L9 -150 L-9 -150 Z" fill="var(--azul2)"/><circle r="5" fill="var(--fundo)" stroke="var(--texto)" stroke-width="2"/>';
  svg.innerHTML=h;
})();
function renderCompassScreen(){
  if(screenOpen!=='compass')return;
  const rot=$('#dialRot'),hd=getHeading();
  const sensorDeg=Compass.fresh()?Compass.trueDeg():null;
  const shown=sensorDeg!==null?sensorDeg:(hd?hd.deg:null);
  if(shown!==null){rot.setAttribute('transform','rotate('+(-shown).toFixed(1)+')');$('#deg').textContent=String(Math.round(shown)%360).padStart(3,'0')+'°';$('#card8').textContent=cardName(shown)+' ('+cardSigla(shown)+')'+(sensorDeg===null?' · rumo do GPS':'')}
  else{$('#deg').textContent='—';$('#card8').textContent='Sem leitura da bússola'}
  const W_=$('#cWarn');let html='';
  if(!Compass.on)html+='<div class="warn aviso">Bússola desligada.</div>';
  else if(Compass.cal.need)html+='<div class="warn aviso"><b>Calibração necessária.</b> '+esc(Compass.cal.why)+' Movimente o celular desenhando um “8” no ar, girando o pulso, afastado de metais e ímãs.</div>';
  else if(Compass.fresh())html+='<div class="warn ok">Bússola funcionando.</div>';
  if(S.decl===0)html+='<div class="warn aviso">Referência: <b>norte magnético</b>. Para o norte verdadeiro informe a declinação em Mais → Ajustes (no Brasil costuma estar entre −10° e −25°).</div>';
  W_.innerHTML=html;
  const f=GPS.fix,gs=GPS.status(),sp=GPS.speedInfo();
  $('#cLat').textContent=f&&GPS.on?f.lat.toFixed(5):'—';$('#cLon').textContent=f&&GPS.on?f.lon.toFixed(5):'—';
  $('#cAcc').textContent=gs.code==='off'?'GPS desligado':f?'±'+Math.round(f.acc)+' m · '+(gs.code==='ok'?'boa':gs.code==='weak'?'baixa':gs.code==='bad'?'muito baixa':'sem sinal'):gs.text;
  $('#cSpd').textContent=sp?Math.round(sp.ms*3.6)+' km/h'+(sp.src==='calc'?' (calc.)':''):'—';
  $('#cRef').textContent=S.decl?'Norte verdadeiro (decl. '+S.decl.toFixed(1).replace('.',',')+'°)':'Norte magnético';
  $('#cMag').textContent=Compass.mag!==null?Math.round(Compass.mag)+' µT':'indisponível';
  $('#cMode').textContent=S.mapMode==='heading'?'Mapa: gira com a bússola':'Mapa: norte fixo no topo';
  $('#cGps').textContent=GPS.on?'Desligar GPS':'Ligar GPS';
  $('#cSensors').innerHTML='Sensores: orientação absoluta (magnetômetro + acelerômetro + giroscópio, combinados pelo sistema) '+(Compass.got?'✓ recebendo':'✗ sem leitura')+' · giroscópio (velocidade de giro) '+(Compass.hasMotion?'✓':'não informado')+' · magnetômetro bruto '+(Compass.mag!==null?'✓':'não exposto pelo navegador')+'.'+(!f?'<br>Toque em “Ligar GPS” para ver as coordenadas.':'');
}
$('#cMode').onclick=()=>setMapMode(S.mapMode==='heading'?'north':'heading');
$('#cGps').onclick=()=>{GPS.on?GPS.stop():GPS.start();renderCompassScreen()};
$('#cCopy').onclick=async()=>{const f=GPS.fix;if(!f||!GPS.on){toast('Ligue o GPS para copiar sua posição');return}toast(await copyText(f.lat.toFixed(6)+', '+f.lon.toFixed(6))?'Latitude e longitude copiadas':'Não consegui copiar')};
$('#cShare').onclick=()=>{const f=GPS.fix;if(!f||!GPS.on){toast('Ligue o GPS para compartilhar sua posição');return}shareCoords(f.lat,f.lon,'Minha posição')};

/* ============ ajustes ============ */
function applyNight(){document.body.classList.toggle('night',!!S.night);const m=document.querySelector('meta[name=theme-color]');if(m)m.content=S.night?'#0f1a24':'#0b3a5b';invalidate()}
function renderDeclInfo(){
  const e=Compass.declEstimate();let t='Declinação em uso: '+(S.decl?S.decl.toFixed(1).replace('.',',')+'°':'nenhuma (norte magnético)')+'.';
  if(Compass.measuring)t+=' Medindo: '+Compass.declSamples.length+' amostras'+(e?' · estimativa '+e.deg.toFixed(1).replace('.',',')+'° (±'+e.std.toFixed(0)+'°)':' (precisa de pelo menos 12; ande ou dirija em linha reta a mais de 18 km/h, com o topo do celular apontando para a frente)')+'.';
  $('#declInfo').textContent=t;
  $('#declAuto').textContent=Compass.measuring?'Parar e aplicar':'Medir pelo GPS';
}
function renderMore(){
  $('#swNight').checked=!!S.night;$('#swVoice').checked=!!S.voice;$('#swSaver').checked=!!S.saver;$('#swWake').checked=!!S.wake;
  $('#declIn').value=S.decl?String(S.decl):'';renderDeclInfo();
  $('#helpStatus').textContent=(world?'Mundo salvo ✓. ':'Mundo não baixado. ')+(navigator.onLine?'Você está online. ':'Você está offline. ')+'Mapas de ruas: '+MapData.regions.length+'.';
}
$('#swNight').onchange=e=>{S.night=e.target.checked;saveS();applyNight()};
$('#swVoice').onchange=e=>{S.voice=e.target.checked;saveS();if(S.voice)speak('Instruções por voz ligadas')};
$('#swSaver').onchange=e=>{S.saver=e.target.checked;saveS();GPS.restart();toast(S.saver?'Economia de bateria ligada':'Economia de bateria desligada')};
$('#swWake').onchange=e=>{S.wake=e.target.checked;saveS()};
$('#declSave').onclick=()=>{const v=parseFloat($('#declIn').value.replace(',','.'));S.decl=isFinite(v)?clamp(v,-60,60):0;saveS();renderDeclInfo();renderCompassScreen();toast('Declinação salva');applyCamera()};
$('#declAuto').onclick=()=>{
  if(!Compass.measuring){
    if(!GPS.on)GPS.start();if(!Compass.on)Compass.start();
    Compass.measuring=true;Compass.declSamples=[];toast('Medindo: ande ou dirija em linha reta, topo do celular para a frente',5000);
  }else{
    const e=Compass.declEstimate();Compass.measuring=false;
    if(e&&e.std<12){S.decl=e.deg;saveS();$('#declIn').value=String(e.deg);toast('Declinação aplicada: '+e.deg.toFixed(1)+'°',4000)}
    else toast('Poucas amostras ou leituras muito dispersas. Tente de novo em linha reta e mais rápido.',5000);
  }
  renderDeclInfo();
};
let installEvt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvt=e;$('#installBtn').hidden=false});
$('#installBtn').onclick=async()=>{if(!installEvt)return;installEvt.prompt();await installEvt.userChoice.catch(()=>{});installEvt=null;$('#installBtn').hidden=true};

/* ============ ciclo de vida: bateria ============ */
let paused={gps:false,compass:false};
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    if(S.saver&&!Nav.active){paused.gps=GPS.on;paused.compass=Compass.on;if(GPS.on)GPS.stop(true);if(Compass.on)Compass.stop()}
  }else{
    if(paused.gps)GPS.start();if(paused.compass)Compass.start();paused={gps:false,compass:false};
    if(Nav.active)wakeOn();invalidate();
  }
});
window.addEventListener('online',updateChips);window.addEventListener('offline',updateChips);

/* ============ início ============ */
(async function init(){
  applyNight();resize();requestAnimationFrame(loop);
  if(S.mapMode==='heading')$('#bMode').classList.add('on');
  if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{})}
  try{
    await DB.open();await User.load();await loadRegions();await reloadMapData();
    const ok=await loadWorldFromDB();
    let skip=false;try{skip=!!localStorage.getItem('navi.skipWorld')}catch(e){}
    if(!ok&&!skip&&!MapData.regions.length)$('#setup').hidden=false;
  }catch(e){toast('Erro ao abrir o armazenamento do aparelho',5000)}
  if(S.gpsOpt)GPS.start();
  if(S.mapMode==='heading')Compass.start().then(ok=>{if(!ok){S.mapMode='north';$('#bMode').classList.remove('on')}});
  updateChips();invalidate();
})();
window.__navi={view,GPS,Compass,Nav,MapData,User,S,Measure,Follow,showDest,planRoute,startNav,stopNav,searchAll,goTab,setMapMode,projLL,screenToLL,frame,getHeading,reloadMapData,ingestCell,downloadArea,planArea,get world(){return world},get anim(){return anim},get Sel(){return Sel},get dl(){return dl},coveredAt,flyToLL};
