'use strict';
/* NAVI OFFLINE - sensores reais: GPS (geolocalização) e bússola (orientação absoluta + giroscópio + magnetômetro).
   Nada aqui inventa dados: sem leitura do sensor, o valor fica vazio ("—") e o estado avisa. */

/* ============ GPS ============ */
const GPS={on:false,wid:null,fix:null,hist:[],err:null,timer:0,cbs:[],startedAt:0,
  onChange(fn){this.cbs.push(fn)},
  notify(newFix){for(const f of this.cbs){try{f(newFix||null)}catch(e){console.error(e)}}},
  wantHigh(){return !S.saver||(typeof Nav!=='undefined'&&Nav.active)},
  start(){
    if(this.on)return;
    if(!navigator.geolocation){this.err='unavail';this.notify();return}
    this.on=true;this.err=null;this.startedAt=Date.now();
    const hi=this.wantHigh();this.hi=hi;
    this.wid=navigator.geolocation.watchPosition(p=>this.onPos(p),e=>this.onErr(e),{enableHighAccuracy:hi,maximumAge:hi?0:5000,timeout:30000});
    clearInterval(this.timer);this.timer=setInterval(()=>this.notify(),1000);
    S.gpsOpt=true;saveS();this.notify();
  },
  stop(keepOpt){
    if(!this.on)return;
    navigator.geolocation.clearWatch(this.wid);this.on=false;this.wid=null;clearInterval(this.timer);
    if(!keepOpt){S.gpsOpt=false;saveS()}
    this.notify();
  },
  restart(){if(!this.on)return;this.stop(true);this.start()},
  onPos(p){
    const c=p.coords;
    const f={lat:c.latitude,lon:c.longitude,acc:isFinite(c.accuracy)?c.accuracy:9999,alt:isFinite(c.altitude)?c.altitude:null,
      speed:(typeof c.speed==='number'&&isFinite(c.speed)&&c.speed>=0)?c.speed:null,
      heading:(typeof c.heading==='number'&&isFinite(c.heading))?wrap360(c.heading):null,t:p.timestamp,rx:Date.now()};
    this.err=null;this.fix=f;this.hist.push(f);
    while(this.hist.length>25||(this.hist.length>2&&f.rx-this.hist[0].rx>40000))this.hist.shift();
    this.notify(f);
  },
  onErr(e){
    this.err=e.code===1?'denied':e.code===2?'nosignal':'timeout';
    if(e.code===1){this.on=false;clearInterval(this.timer);navigator.geolocation.clearWatch(this.wid)}
    this.notify();
  },
  age(){return this.fix?(Date.now()-this.fix.rx)/1000:Infinity},
  status(){
    if(this.err==='denied')return{code:'denied',text:'GPS sem permissão',cls:'bad',help:'A localização está bloqueada para este site. Toque no cadeado do Chrome > Permissões > Localização > Permitir.'};
    if(!this.on)return{code:'off',text:'GPS desligado',cls:'',help:'Toque para ligar o GPS.'};
    if(this.err==='unavail')return{code:'nosignal',text:'GPS indisponível',cls:'bad',help:'Este aparelho ou navegador não oferece localização.'};
    const f=this.fix;
    if(!f){
      const wait=(Date.now()-this.startedAt)/1000;
      if(this.err==='nosignal'||wait>45)return{code:'nosignal',text:'GPS sem sinal',cls:'bad',help:'Sem satélites no momento. Vá para um local aberto e confira se a localização do aparelho está ligada.'};
      return{code:'searching',text:'Procurando satélites…',cls:'weak',help:'Aguarde. Em local aberto costuma levar de 5 a 30 segundos.'};
    }
    const age=(Date.now()-f.rx)/1000,a=Math.round(f.acc);
    if(age>15)return{code:'nosignal',text:'GPS sem sinal há '+Math.round(age)+' s',cls:'bad',help:'A última posição é antiga. Não confie nela.',age};
    if(f.acc>100)return{code:'bad',text:'Precisão muito baixa (±'+a+' m)',cls:'bad',help:'Posição aproximada demais para navegar. Vá para céu aberto.',age};
    if(f.acc>30)return{code:'weak',text:'Precisão baixa (±'+a+' m)',cls:'weak',help:'Posição pouco precisa. Em ruas estreitas ou prédios isso é comum.',age};
    return{code:'ok',text:'GPS ok (±'+a+' m)',cls:'ok',help:'',age};
  },
  usable(){const s=this.status();return s.code==='ok'||s.code==='weak'},
  /* velocidade: do próprio GPS; se o aparelho não informar, calcula só a partir de posições reais; senão vazio */
  speedInfo(){
    const f=this.fix;if(!f||this.age()>6||f.acc>100)return null;
    if(f.speed!==null)return{ms:f.speed,src:'gps'};
    const h=this.hist;let a=null;
    for(let i=h.length-2;i>=0;i--){if(f.rx-h[i].rx>=3000&&f.rx-h[i].rx<=12000){a=h[i];break}}
    if(!a)return null;
    const d=Routing.dist(a.lat,a.lon,f.lat,f.lon),dt=(f.rx-a.rx)/1000;
    if(d<Math.max(a.acc,f.acc)*0.8)return null;
    if(d/dt>70)return null; // salto de GPS, não é velocidade de verdade
    return{ms:d/dt,src:'calc'};
  },
  /* rumo de deslocamento (só vale se estiver andando) */
  course(){
    const f=this.fix,sp=this.speedInfo();if(!f||!sp||sp.ms<1.5)return null;
    if(f.heading!==null&&sp.src==='gps')return{deg:f.heading,src:'gps'};
    const h=this.hist;
    for(let i=h.length-2;i>=0;i--){if(f.rx-h[i].rx>=3000){const d=Routing.dist(h[i].lat,h[i].lon,f.lat,f.lon);if(d>Math.max(h[i].acc,f.acc))return{deg:Routing.bearing(h[i].lat,h[i].lon,f.lat,f.lon),src:'calc'};break}}
    return null;
  }
};

/* ============ bússola ============ */
const Compass={on:false,got:false,smooth:null,lastT:0,rate:0,hasMotion:false,mag:null,acc:null,samples:[],cb:[],
  cal:{need:false,why:'',stable:0},declSamples:[],measuring:false,ev:null,h:null,hm:null,timer:0,calTimer:0,absOk:true,
  onChange(fn){this.cb.push(fn)},
  emit(){for(const f of this.cb){try{f()}catch(e){console.error(e)}}},
  screenAngle(){return(screen.orientation&&typeof screen.orientation.angle==='number'?screen.orientation.angle:window.orientation)||0},
  calc(e){
    if(typeof e.webkitCompassHeading==='number'&&!isNaN(e.webkitCompassHeading)){this.acc=typeof e.webkitCompassAccuracy==='number'?e.webkitCompassAccuracy:null;return e.webkitCompassHeading}
    if(e.alpha==null||e.beta==null||e.gamma==null)return null;
    if(!this.abs&&!e.absolute){this.absOk=false;return null}
    const a=e.alpha*D2R,b=e.beta*D2R,g=e.gamma*D2R,cA=Math.cos(a),sA=Math.sin(a),cB=Math.cos(b),sB=Math.sin(b),cG=Math.cos(g),sG=Math.sin(g);
    const m12=-cB*sA,m22=cA*cB,m32=sB,m13=cG*sA*sB+cA*sG,m23=sA*sG-cA*cG*sB;
    const h=Math.abs(m32)<0.75?Math.atan2(m12,m22):Math.atan2(-m13,-m23); // deitado: topo do aparelho; em pé: câmera traseira
    return wrap360(h/D2R);
  },
  onOrient(e){
    const h0=this.calc(e);if(h0===null)return;
    const raw=wrap360(h0+this.screenAngle()),now=performance.now();
    this.got=true;this.rawT=now;this.raw=raw;
    this.samples.push({t:Date.now(),h:raw,rate:this.rate});if(this.samples.length>60)this.samples.shift();
    if(S.saver&&now-this.lastT<100)return;
    if(this.smooth===null)this.smooth=raw;
    else{
      const d=angD(this.smooth,raw);
      if(Math.abs(d)<0.25&&this.rate<2){this.lastT=now;return}
      const a=this.hasMotion?clamp(0.14+this.rate/140,0.14,0.75):0.25; // giroscópio: gira rápido => segue mais rápido
      this.smooth=wrap360(this.smooth+d*a);
    }
    this.lastT=now;this.emit();
  },
  onMotion(e){const r=e.rotationRate;if(r&&r.alpha!=null&&r.beta!=null&&r.gamma!=null){this.hasMotion=true;this.rate=Math.hypot(r.alpha,r.beta,r.gamma)}},
  evalCal(){
    const now=Date.now(),c=this.cal;let why='';
    if(this.on&&!this.got&&now-this.since>2500)why='Sem leitura do sensor. O aparelho pode não ter bússola ou o navegador bloqueou os sensores de movimento.';
    if(!why&&!this.absOk)why='O navegador não entrega a orientação absoluta (magnética) deste aparelho.';
    if(!why&&this.acc!==null&&(this.acc<0||this.acc>25))why='O sistema informa baixa precisão da bússola.';
    if(!why&&this.mag!==null&&(this.mag<18||this.mag>75))why='Campo magnético fora do normal ('+Math.round(this.mag)+' µT). Afaste-se de ímãs, capas magnéticas, metais e eletrônicos.';
    const rec=this.samples.filter(s=>now-s.t<3500);
    if(!why&&rec.length>=12){
      let sx=0,sy=0;for(const s of rec){sx+=Math.cos(s.h*D2R);sy+=Math.sin(s.h*D2R)}
      const R=Math.min(1,Math.hypot(sx,sy)/rec.length),std=Math.sqrt(-2*Math.log(Math.max(R,1e-6)))/D2R;
      const still=this.hasMotion?rec.every(s=>s.rate<5):null;
      let jumps=0;for(let i=1;i<rec.length;i++)if(Math.abs(angD(rec[i-1].h,rec[i].h))>30)jumps++;
      if(still===true&&std>9)why='A leitura oscila mesmo com o aparelho parado.';
      else if(still===null&&jumps>=3)why='A leitura está instável.';
    }
    if(why){c.need=true;c.why=why;c.stable=0}
    else if(c.need){if(!c.stable)c.stable=now;else if(now-c.stable>6000){c.need=false;c.why=''}}
    this.emit();
  },
  trueDeg(){return this.smooth===null?null:wrap360(this.smooth+(S.decl||0))},
  fresh(){return this.on&&this.got&&performance.now()-this.rawT<2500},
  async start(){
    if(this.on)return true;
    if(typeof DeviceOrientationEvent==='undefined'){toast('Este aparelho não tem sensor de orientação');return false}
    try{
      if(typeof DeviceOrientationEvent.requestPermission==='function'){const p=await DeviceOrientationEvent.requestPermission();if(p!=='granted'){toast('Permissão da bússola negada');return false}}
      if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission==='function')await DeviceMotionEvent.requestPermission().catch(()=>{});
    }catch(e){toast('Não foi possível ativar a bússola');return false}
    this.abs='ondeviceorientationabsolute' in window;
    this.ev=this.abs?'deviceorientationabsolute':'deviceorientation';
    this.h=e=>this.onOrient(e);this.hm=e=>this.onMotion(e);
    window.addEventListener(this.ev,this.h,true);window.addEventListener('devicemotion',this.hm,true);
    try{if('Magnetometer' in window){const m=new Magnetometer({frequency:4});m.addEventListener('reading',()=>{this.mag=Math.hypot(m.x,m.y,m.z)});m.addEventListener('error',()=>{});m.start();this.msensor=m}}catch(e){}
    this.on=true;this.got=false;this.smooth=null;this.since=Date.now();this.absOk=true;this.samples=[];this.rate=0;
    clearInterval(this.calTimer);this.calTimer=setInterval(()=>this.evalCal(),1000);
    this.emit();return true;
  },
  stop(){
    if(!this.on)return;
    window.removeEventListener(this.ev,this.h,true);window.removeEventListener('devicemotion',this.hm,true);
    try{this.msensor&&this.msensor.stop()}catch(e){}this.msensor=null;this.mag=null;
    this.on=false;this.smooth=null;this.got=false;clearInterval(this.calTimer);this.cal.need=false;this.emit();
  },
  /* medir a declinação: compara o rumo do GPS (norte verdadeiro) com a bússola (magnética) em movimento real */
  feedDecl(fix){
    if(!this.measuring||!this.fresh()||this.smooth===null)return;
    const sp=GPS.speedInfo();if(!sp||sp.src!=='gps'||sp.ms<5||fix.heading===null||fix.acc>25)return;
    if(this.rate>8)return;
    this.declSamples.push(angD(this.smooth,fix.heading));if(this.declSamples.length>80)this.declSamples.shift();
  },
  declEstimate(){
    const a=this.declSamples;if(a.length<12)return null;
    let sx=0,sy=0;for(const d of a){sx+=Math.cos(d*D2R);sy+=Math.sin(d*D2R)}
    const R=Math.hypot(sx,sy)/a.length,mean=Math.atan2(sy,sx)/D2R,std=Math.sqrt(-2*Math.log(Math.max(R,1e-6)))/D2R;
    return{deg:+mean.toFixed(1),std:+std.toFixed(1),n:a.length};
  }
};
GPS.onChange(f=>{if(f)Compass.feedDecl(f)});

/* melhor estimativa de para onde o usuário aponta/anda (sempre de sensor real) */
function getHeading(){
  const sp=GPS.speedInfo(),c=GPS.course();
  if(c&&sp&&sp.ms>=2.5)return{deg:c.deg,src:'gps'};
  if(Compass.fresh())return{deg:Compass.trueDeg(),src:'bússola'};
  if(c)return{deg:c.deg,src:'gps'};
  return null;
}
const CARD8N=['Norte','Nordeste','Leste','Sudeste','Sul','Sudoeste','Oeste','Noroeste'],CARD8S=['N','NE','L','SE','S','SO','O','NO'];
const cardName=d=>CARD8N[Math.round(wrap360(d)/45)%8],cardSigla=d=>CARD8S[Math.round(wrap360(d)/45)%8];
