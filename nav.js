'use strict';
/* NAVI OFFLINE - rotas, navegação passo a passo, recálculo, voz e marcadores de posição */

/* ============ dados do usuário (favoritos, pontos, histórico) ============ */
const User={fav:[],pt:[],hist:[],srch:[],
  async load(){const u=(await DB.get('kv','user'))||{};this.fav=u.fav||[];this.pt=u.pt||[];this.hist=u.hist||[];this.srch=u.srch||[]},
  async save(){try{await DB.put('kv',{fav:this.fav,pt:this.pt,hist:this.hist,srch:this.srch},'user')}catch(e){}},
  list(kind){return this[kind]},
  find(kind,lat,lon){return this[kind].find(p=>Math.abs(p.lat-lat)<2e-5&&Math.abs(p.lon-lon)<2e-5)},
  add(kind,p){
    const a=this[kind],i=a.findIndex(x=>Math.abs(x.lat-p.lat)<3e-4&&Math.abs(x.lon-p.lon)<3e-4&&(kind==='hist'||x.n===p.n));
    if(i>=0)a.splice(i,1);
    a.unshift({n:p.n,sub:p.sub||'',lat:p.lat,lon:p.lon,t:Date.now()});
    if(kind==='hist'&&a.length>40)a.length=40;if(kind==='srch'&&a.length>300)a.length=300;
    this.save();invalidate();
  },
  remove(kind,lat,lon){this[kind]=this[kind].filter(x=>!(x.lat===lat&&x.lon===lon));this.save();invalidate()}
};

/* ============ estado da navegação ============ */
const Nav={dest:null,mode:'car',route:null,active:false,s:0,seg:0,offN:0,lastRe:0,spoken:{},arrived:false,alert:'',snap:null,wake:null,rerouting:false,from:null,startedAt:0};
const ERR_TXT={
  nomap:'Ainda não há mapa de ruas baixado. Vá em “Offline” e baixe a sua região.',
  start:'O ponto de partida está fora do mapa baixado ou longe de ruas. Baixe a região onde você está em “Offline”.',
  end:'O destino está fora do mapa baixado ou longe de ruas. Baixe a região do destino em “Offline”.',
  noroute:'Não achei caminho com os mapas baixados (ruas desconectadas, mão única ou trecho não baixado). Se o trajeto passa por outra região, baixe-a também.'
};
async function planRoute(dest,mode,from){
  const g=await getGraph();
  if(!g)return{ok:false,err:'nomap'};
  if(!from)return{ok:false,err:'start'};
  const r=Routing.route(g,{lat:from.lat,lon:from.lon},{lat:dest.lat,lon:dest.lon},mode,{maxSnap:500});
  if(r.ok){
    const n=r.coords.length,mx=new Float64Array(n*2);
    for(let i=0;i<n;i++){mx[2*i]=lonToX(r.coords[i][1]);mx[2*i+1]=latToY(r.coords[i][0])}
    r.mx=mx;
  }
  return r;
}
function setRoute(dest,mode,r,from){Nav.dest=dest;Nav.mode=mode;Nav.route=r&&r.ok?r:null;Nav.from=from||null;Nav.s=0;Nav.seg=0;Nav.offN=0;Nav.spoken={};Nav.arrived=false;Nav.snap=null;invalidate()}
function clearRoute(){Nav.dest=null;Nav.route=null;Nav.from=null;invalidate()}

/* ============ voz ============ */
function speak(t){
  if(!S.voice||!('speechSynthesis' in window))return;
  try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang='pt-BR';u.rate=1;speechSynthesis.speak(u)}catch(e){}
}
const lc=t=>t.charAt(0).toLowerCase()+t.slice(1);
function distSpoken(d){d=Math.round(d/50)*50;return d>=1000?(d/1000).toFixed(1).replace('.',',')+' quilômetros':d+' metros'}

/* ============ navegação ============ */
async function wakeOn(){if(S.wake&&'wakeLock' in navigator){try{Nav.wake=await navigator.wakeLock.request('screen')}catch(e){}}}
function wakeOff(){try{Nav.wake&&Nav.wake.release()}catch(e){}Nav.wake=null}
function startNav(){
  if(!Nav.route)return false;
  if(!GPS.usable()){toast('Sem GPS utilizável agora. Ligue o GPS e aguarde o sinal.',3500);return false}
  Nav.active=true;Nav.s=0;Nav.seg=0;Nav.offN=0;Nav.spoken={};Nav.arrived=false;Nav.alert='';Nav.startedAt=Date.now();
  User.add('hist',Nav.dest);
  wakeOn();GPS.restart();
  speak(Nav.route.steps[0].text);Nav.spoken['0:near']=1;
  if(typeof onNavState==='function')onNavState();
  if(GPS.fix)navOnFix(GPS.fix);
  return true;
}
function stopNav(){
  Nav.active=false;wakeOff();try{speechSynthesis.cancel()}catch(e){}
  clearRoute();GPS.restart();
  if(typeof onNavState==='function')onNavState();
}
async function reroute(fix){
  if(Nav.rerouting||!Nav.dest)return;
  Nav.rerouting=true;Nav.lastRe=Date.now();Nav.alert='Recalculando a rota…';renderNav();
  try{
    const r=await planRoute(Nav.dest,Nav.mode,{lat:fix.lat,lon:fix.lon});
    if(r.ok&&Nav.active){
      Nav.route=r;Nav.s=0;Nav.seg=0;Nav.offN=0;Nav.spoken={};Nav.alert='';invalidate();
      speak('Rota recalculada. '+r.steps[0].text);Nav.spoken['0:near']=1;
    }else if(!r.ok)Nav.alert='Não consegui recalcular: '+(ERR_TXT[r.err]||'erro')
  }catch(e){Nav.alert='Erro ao recalcular a rota.'}
  Nav.rerouting=false;renderNav();
}
function navOnFix(fix){
  if(!Nav.active||!Nav.route||Nav.arrived)return;
  const rt=Nav.route,loc=Routing.locate(rt,fix.lat,fix.lon,Nav.seg);
  const tol=Math.max(35,Math.min(2*fix.acc,90));
  if(fix.acc>100){Nav.alert='Precisão do GPS muito baixa (±'+Math.round(fix.acc)+' m). Instruções podem estar erradas.'}
  else{
    if(loc.off>tol){
      Nav.offN++;
      if(!Nav.rerouting)Nav.alert='Você saiu da rota ('+Math.round(loc.off)+' m).';
      if((Nav.offN>=3||loc.off>150)&&Date.now()-Nav.lastRe>8000)reroute(fix);
    }else{Nav.offN=0;if(!Nav.rerouting)Nav.alert=''}
  }
  if(loc.off<=Math.max(tol,60)){
    if(loc.s>=Nav.s-30||loc.off<tol){Nav.s=loc.s;Nav.seg=loc.seg}
    const c=rt.coords,i=loc.seg,span=rt.cum[i+1]-rt.cum[i],t=span>0?clamp((loc.s-rt.cum[i])/span,0,1):0;
    Nav.snap=[c[i][0]+(c[i+1][0]-c[i][0])*t,c[i][1]+(c[i+1][1]-c[i][1])*t];
  }
  const rem=rt.dist-Nav.s;
  if(rem<=Math.max(22,Math.min(fix.acc,40))){Nav.arrived=true;Nav.alert='';speak('Você chegou ao destino');renderNav();if(typeof onNavState==='function')onNavState();return}
  const idx=Routing.nextStep(rt,Nav.s),st=rt.steps[idx],dS=st.d-Nav.s;
  if(st.type!=='arrive'){
    if(dS<=60&&!Nav.spoken[idx+':near']){Nav.spoken[idx+':near']=1;Nav.spoken[idx+':far']=1;speak(st.text)}
    else if(dS<=320&&dS>110&&!Nav.spoken[idx+':far']){Nav.spoken[idx+':far']=1;speak('Em '+distSpoken(dS)+', '+lc(st.text))}
  }
  renderNav();
}
const ICON={depart:'⬆',straight:'⬆',slight_right:'↗',right:'➡',sharp_right:'↘',uturn:'↩',sharp_left:'↙',left:'⬅',slight_left:'↖',roundabout:'⟳',arrive:'🏁'};
function renderNav(){
  if(!Nav.active||!Nav.route)return;
  const rt=Nav.route;
  if(Nav.arrived){
    $('#nIco').textContent='🏁';$('#nDist').textContent='Chegou';$('#nText').textContent='Você chegou ao destino';$('#nNext').textContent=Nav.dest?Nav.dest.n:'';
    $('#nvRem').textContent='0 m';$('#nvEta').textContent=fmtClock(Date.now());$('#nvLeft').textContent='—';
  }else{
    const idx=Routing.nextStep(rt,Nav.s),st=rt.steps[idx],dS=Math.max(0,st.d-Nav.s),nx=rt.steps[idx+1];
    $('#nIco').textContent=ICON[st.mod]||'⬆';$('#nDist').textContent=fmtDist(dS);$('#nText').textContent=st.text;
    $('#nNext').textContent=nx&&st.type!=='arrive'?'Depois: '+nx.text+' ('+fmtDist(nx.d-st.d)+')':'';
    const remT=Math.max(0,rt.time-Routing.timeAt(rt,Nav.s));
    $('#nvRem').textContent=fmtDist(rt.dist-Nav.s);$('#nvEta').textContent=fmtClock(Date.now()+remT*1000);$('#nvLeft').textContent=fmtDur(remT);
  }
  const sp=GPS.speedInfo();$('#nvSpd').textContent=sp?String(Math.round(sp.ms*3.6)):'—';
  const gs=GPS.status();let al=Nav.alert;
  if(gs.code==='nosignal'||gs.code==='bad'||gs.code==='searching')al=gs.text+'. '+(gs.help||'');
  else if(gs.code==='weak'&&!al)al=gs.text;
  const e=$('#navAlert');e.textContent=al||'';e.style.color=al?(gs.cls==='bad'||/saiu|Não consegui/.test(al)?'var(--erro)':'var(--aviso)'):'';e.hidden=!al;
}

/* ============ desenho: rota, posição do usuário ============ */
function drawRoute(F,ext){
  const rt=Nav.route;if(!rt)return;
  const mx=rt.mx,n=mx.length,w=clamp(3.2*Math.pow(2,(view.z-14)*0.6),4,16);
  const path=(a,b)=>{ // vértices a..b
    ctx.beginPath();
    for(let i=a;i<=b;i++){const u=mx[2*i]-F.cx,v=mx[2*i+1]-F.cy,x=F.hw+F.S*(F.c*u+F.s*v),y=F.hh+F.S*(-F.s*u+F.c*v);i===a?ctx.moveTo(x,y):ctx.lineTo(x,y)}
  };
  ctx.lineCap='round';ctx.lineJoin='round';
  path(0,n/2-1);ctx.strokeStyle='#fff';ctx.lineWidth=w+4;ctx.stroke();
  path(0,n/2-1);ctx.strokeStyle='#1769aa';ctx.lineWidth=w;ctx.stroke();
  if(Nav.active&&Nav.seg>0&&Nav.snap){ // trecho já percorrido
    path(0,Nav.seg);const[sx,sy]=projLL(Nav.snap[0],Nav.snap[1],F);ctx.lineTo(sx,sy);ctx.strokeStyle='#8fa3b3';ctx.lineWidth=w;ctx.stroke();
  }
  if(Nav.active&&!Nav.arrived){
    const idx=Routing.nextStep(rt,Nav.s),st=rt.steps[idx];
    if(st&&st.type!=='arrive'){const[x,y]=projLL(st.at[0],st.at[1],F);ctx.beginPath();ctx.arc(x,y,w*0.9+3,0,TAU);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#e8710a';ctx.stroke()}
  }
}
function drawFlag(F,lat,lon,emoji){
  const[x,y]=projLL(lat,lon,F);if(x<-30||x>W+30||y<-40||y>H+30)return;
  ctx.font='26px system-ui,"Apple Color Emoji","Noto Color Emoji",sans-serif';ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(emoji,x-4,y+2);ctx.textBaseline='middle';
}
function drawDest(F){if(Nav.dest)drawFlag(F,Nav.dest.lat,Nav.dest.lon,'🚩')}
function drawUser(F){
  const f=GPS.fix;if(!f||!GPS.on)return;
  const st=GPS.status(),stale=st.code==='nosignal',[x,y]=projLL(f.lat,f.lon,F);
  if(x<-80||x>W+80||y<-80||y>H+80)return;
  const mpp=40075016.686*Math.cos(f.lat*D2R)/F.S,r=f.acc/mpp;
  if(r>7){ctx.beginPath();ctx.arc(x,y,Math.min(r,Math.max(W,H)),0,TAU);ctx.fillStyle=stale?'rgba(120,130,140,.14)':'rgba(26,115,232,.14)';ctx.fill();ctx.lineWidth=1;ctx.strokeStyle=stale?'rgba(120,130,140,.5)':'rgba(26,115,232,.5)';ctx.stroke()}
  const hd=stale?null:getHeading();
  if(hd){
    ctx.save();ctx.translate(x,y);ctx.rotate((hd.deg-view.bearing)*D2R);
    ctx.beginPath();ctx.moveTo(0,-20);ctx.lineTo(9,-4);ctx.lineTo(-9,-4);ctx.closePath();ctx.fillStyle=hd.src==='gps'?'#1a73e8':'#5a9bf0';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore();
  }
  ctx.beginPath();ctx.arc(x,y,8,0,TAU);ctx.fillStyle=stale?'#7b8794':'#1a73e8';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();
}
overlays.push(drawRoute,drawDest,drawUser);
