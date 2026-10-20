// Node 22+ and Chrome. No npm dependency. Exercises real layout through CDP.
// CHROME_BIN=/path/to/chrome node tests/responsive-smoke.cjs
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'satpass-responsive-'));
const shots=path.join(os.tmpdir(),'satpass-responsive-shots');fs.mkdirSync(shots,{recursive:true});
const mime=require('../electron/policy.cjs').contentType;
const server=http.createServer((req,res)=>{
  let file;try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/satpass\//,'');file=path.resolve(root,name||'index.html');}catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':mime(file),'Cache-Control':'no-store'});res.end(err?'Not found':data);});
});
let chrome,ws,id=0,passed=0;const pending=new Map(),errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(name,value,detail){assert(value,name+(detail?' '+JSON.stringify(detail):''));passed++;}
function send(method,params={}){const n=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method));},20000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(expr){for(let i=0;i<150;i++){if(await ev(expr))return;await sleep(100);}throw new Error('Timed out: '+expr);}
async function go(route){await ev(`location.hash=${JSON.stringify('#/'+route)}`);await until(`document.querySelector('#app').classList.contains(${JSON.stringify('page-'+route.split('/')[0])})`);await sleep(100);}
async function resize(width,height,dpr=1){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});await sleep(150);await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function geometry(label,width,height){
  const g=await ev(`(()=>{const nav=document.querySelector('#tabs').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,nav:{x:nav.x,y:nav.y,w:nav.width,h:nav.height,b:nav.bottom},main:document.querySelector('#app').clientWidth,error:document.querySelector('#app>.err')?.textContent,canvases:[...document.querySelectorAll('canvas')].filter(c=>c.getBoundingClientRect().width>0).map(c=>{const r=c.getBoundingClientRect();return {id:c.id,w:r.width,h:r.height,p:c.parentElement.clientWidth,bw:c.width,bh:c.height}})}})()`);
  check(label+' no viewport overflow',g.overflow<=1,g);
  check(label+' route renders without an error',!g.error,g.error);
  check(label+' navigation follows available width',width>=1200?g.nav.x===0&&g.nav.w<=220&&g.nav.h>=height*.9:width>=600?g.nav.y>=44&&g.nav.b<=160:Math.abs(g.nav.b-height)<2&&g.nav.h>=56,g.nav);
  for(const c of g.canvases){
    check(label+' '+c.id+' fits its own panel',c.w<=c.p+1,c);
    if(/^(sky|liveSkyCanvas|visibleSkyMap)$/.test(c.id))check(label+' '+c.id+' is circular',Math.abs(c.w-c.h)<1,c);
    if(/^(map|visibleMap)$/.test(c.id))check(label+' '+c.id+' keeps 2:1 map geometry',Math.abs(c.w/2-c.h)<=1,c);
  }
}
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  let stderr='';chrome=spawn(process.env.CHROME_BIN||'google-chrome',['--headless=new','--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0','--user-data-dir='+path.join(temp,'profile'),'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
  let launchError;chrome.on('error',e=>launchError=e);chrome.stderr.on('data',d=>stderr+=d);
  let port;for(let i=0;i<150;i++){if(launchError)throw launchError;const m=stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);if(m){port=m[1];break;}await sleep(100);}assert(port,'Chrome did not start: '+stderr);
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  ws.addEventListener('close',()=>{for(const p of pending.values())p.reject(new Error('Chrome closed'));pending.clear();});
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(navigator,'onLine',{get:()=>false});
    window.__layout={intervals:new Set(),observers:new Map()};
    const si=window.setInterval,ci=window.clearInterval;
    window.setInterval=function(fn,ms,...args){const id=si(()=>{if(!__layout.pause)fn(...args);},ms);__layout.intervals.add(id);return id;};
    window.clearInterval=function(id){__layout.intervals.delete(id);return ci(id);};
    const RO=window.ResizeObserver;
    window.ResizeObserver=class extends RO{constructor(fn){super(fn);__layout.observers.set(this,new Set());}observe(el,...a){__layout.observers.get(this).add(el);return super.observe(el,...a);}unobserve(el){__layout.observers.get(this).delete(el);return super.unobserve(el);}disconnect(){__layout.observers.get(this).clear();return super.disconnect();}};
  `});
  await send('Page.navigate',{url:origin+'/satpass/'});await until('!!window.SatApp');
  await ev(`SatStore.set({lat:30.2672,lon:-97.7431,alt:150,favs:[25544,43017],theme:'dark'});SatApp.route();document.querySelector('#themeBtn').click();document.querySelector('#themeBtn').click();document.querySelector('#themeBtn').click();`);
  await until('!!document.querySelector(".pass")');
  const pass=await ev(`(()=>{const b=document.querySelector('.pass[data-n="25544"]');return b.dataset.n+'/'+b.dataset.aos})()`);
  const sizes=[[375,812],[812,375],[768,1024],[1024,768],[1440,900],[1920,1080],[2560,1440],[3440,1440],[320,812],[599,850],[600,850],[899,850],[900,850],[1199,850],[1200,850],[1365,768],[1799,1000],[1800,1000]];
  for(const [w,h] of sizes){
    await resize(w,h,w===375?2:1);
    for(const route of ['passes','pass/'+pass,'live/25544','visible','doppler/25544','doppler/39634','sats','settings']){
      await go(route);if(route==='passes')await until('!!document.querySelector(".pass")');if(route==='visible')await until('SatStore.allLoaded() && !document.querySelector("#visibleResults").hidden');
      await geometry(w+'x'+h+' '+route,w,h);
      if([375,768,1440,3440].includes(w)&&['passes','live/25544','settings'].includes(route))fs.writeFileSync(path.join(shots,w+'-'+route.split('/')[0]+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    console.log('PASS all screens at '+w+' × '+h);
  }
  await resize(1440,900);await go('passes');await until('!!document.querySelector("#passPreview #sky")');
  const chosen=await ev(`(()=>{const b=document.querySelectorAll('.pass')[1];b.click();return b.dataset.n+'/'+b.dataset.aos;})()`);
  check('desktop selection previews without losing list/deep link',await ev(`location.hash==='#/passes' && document.querySelector('#passPreview').dataset.pass===${JSON.stringify(chosen)} && !!document.querySelector('a[href="#/pass/${chosen}"]')`));
  await resize(375,812,2);await resize(1440,900);
  check('selected pass survives responsive transitions',await ev(`document.querySelector('#passPreview').dataset.pass===${JSON.stringify(chosen)} && document.querySelector('.pass.selected').dataset.n+'/'+document.querySelector('.pass.selected').dataset.aos===${JSON.stringify(chosen)}`));
  await ev('document.querySelector("#passPreview .preview-heading a").click()');await until('location.hash.startsWith("#/pass/")');
  check('pass detail deep link uses the selected pass',await ev('location.hash')==='#/pass/'+chosen);
  await resize(375,812,2);await go('passes');await ev('document.querySelector(".pass").click()');await until('location.hash.startsWith("#/pass/")');
  check('phone pass selection still navigates to detail',true);
  await resize(1440,900);await go('live/25544');await ev('document.querySelector("#tab2d").click()');
  const intervals=await ev('__layout.intervals.size');
  await ev(`window.__mapNode=document.querySelector('#map');window.__layout.pause=true;window.__calls=0;const old=SatPasses.stateAt;SatPasses.stateAt=function(...args){__calls++;return old(...args)};document.querySelector('.tracker-visual').style.width='85%';`);
  await until('Math.abs(parseFloat(__mapNode.style.width)-__mapNode.parentElement.clientWidth)<=1');
  check('container-only resize redraws map at its panel width',await ev(`Math.abs(parseFloat(__mapNode.style.width)-__mapNode.parentElement.clientWidth)<=1`));
  check('container resize does not rescan orbits',await ev('__calls')===0);
  await ev(`window.__layout.pause=false;document.querySelector('.tracker-visual').style.width='';window.__selectedSat=document.querySelector('#liveSel').value;`);
  for(const [w,h] of sizes)await resize(w,h);
  check('resize preserves selected satellite and renderer DOM',await ev(`document.querySelector('#map')===__mapNode && document.querySelector('#liveSel').value===__selectedSat`));
  check('resize does not add live update timers',await ev('__layout.intervals.size')===intervals);
  const clock=await ev('document.querySelector("#liveHead").textContent');await sleep(1200);
  check('live tracking still updates after resizing',clock!==await ev('document.querySelector("#liveHead").textContent'));
  for(const tab of ['3d','sky','ground']){await ev(`document.querySelector('#tab${tab}').click()`);if(tab==='ground')await until('document.querySelector("#liveGround .ground-message").hidden');for(const [w,h] of [[375,812],[1024,768],[3440,1440]]){await resize(w,h);await geometry('Live '+tab+' '+w,w,h);}}
  await go('visible');for(const tab of ['3d','sky','ground']){await ev(`document.querySelector('#visibleTab${tab}').click()`);if(tab==='ground')await until('document.querySelector("#visibleGround .ground-message").hidden');for(const [w,h] of [[375,812],[1024,768],[3440,1440]]){await resize(w,h);await geometry('Visible '+tab+' '+w,w,h);}}
  // All eight visualization panels share a reversible expansion lifecycle.
  async function clickAt(selector,touch=false){
    const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if(touch){await send('Emulation.setTouchEmulationEnabled',{enabled:true});await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await send('Emulation.setTouchEmulationEnabled',{enabled:false});}
    else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}
  }
  async function escape(){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}
  for(const route of ['live/25544','visible']){
    const visible=route==='visible',tab=visible?'visibleTab':'tab',panel=visible?'visiblePanel':'panel',host=visible?'visibleGround':'liveGround';
    await go(route);if(visible){await until('SatStore.allLoaded() && !!document.querySelector(".visible-pick")');await ev('document.querySelector(".visible-pick").click()');}
    for(const [w,h] of [[1440,900],[375,812],[812,375],[1024,768],[3440,1440]]){
      await resize(w,h);
      for(const mode of ['2d','3d','sky','ground']){
        await ev(`document.querySelector('#${tab+mode}').click()`);
        if(mode==='ground'){await until(`document.querySelector('#${host} .ground-message')?.hidden`);await ev(`document.querySelector('#${host}E').click()`);await until(`document.querySelector('#${host} .ground-hud').textContent.includes('LOOKING E · 90°')`);}
        await ev(`document.querySelector('#${panel+mode} .visual-expand').scrollIntoView({block:'center'});window.__visualCanvas=document.querySelector('#${panel+mode} canvas');window.__visualSettings=JSON.stringify(SatStore.settings);window.__visualTimers=__layout.intervals.size;window.__visualHud=document.querySelector('#${host} .ground-hud')?.textContent;window.__visualScroll=scrollY;`);
        await clickAt('#'+panel+mode+' .visual-expand',w===375&&mode==='2d');
        await until('!!document.querySelector(".visual-expanded")');
        await until(`(()=>{const c=document.querySelector('#${panel+mode} canvas'),stage=c.closest('.visual-stage'),area=SatExpand.dimensions(c,${mode==='2d'?2:mode==='sky'?1:0});const dpr=Math.min(devicePixelRatio||1,${mode==='3d'||mode==='ground'?2:3});return Math.abs(c.width/dpr-area.width)<2 && Math.abs(c.height/dpr-${mode==='2d'?'area.width/2':mode==='sky'?'area.width':'area.height'})<2;})()`);
        const g=await ev(`(()=>{const card=document.querySelector('.visual-expanded'),r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom}},p=card.querySelector('[role=tabpanel]:not([hidden])'),stage=p.querySelector('.visual-stage'),c=stage.querySelector('canvas');return {card:r(card),stage:r(stage),canvas:r(c),header:r(document.querySelector('.top')),nav:r(document.querySelector('#tabs')),pressed:p.querySelector('.visual-expand').getAttribute('aria-pressed'),inert:document.querySelector('#app').inert,viewportWidth:document.documentElement.clientWidth,overlays:document.querySelectorAll('.visual-expanded').length};})()`);
        const label=route+' '+mode+' expanded '+w;
        check(label+' fills space below visible header',g.header.y>=-.5&&g.card.y>=g.header.bottom-.5&&g.card.y<g.header.bottom+(w>=600&&w<1200?60:1),g);
        check(label+' preserves navigation',w>=1200?g.card.x>=g.nav.right-.5:w<600?g.card.bottom<=g.nav.y+.5:g.card.y>=g.nav.bottom-.5,g);
        check(label+' fits and fills the available viewport',Math.abs(g.card.right-g.viewportWidth)<2&&Math.abs(g.card.bottom-(w<600?g.nav.y:h))<2,g);
        check(label+' canvas stays within visualization',g.canvas.w>0&&g.canvas.h>0&&g.canvas.w<=g.stage.w+1&&g.canvas.h<=g.stage.h+1,g);
        check(label+' one accessible expansion, existing state and timer cadence',g.overlays===1&&g.pressed==='true'&&g.inert&&await ev('document.querySelector(".visual-expanded canvas")===__visualCanvas || [...document.querySelectorAll(".visual-expanded canvas")].includes(__visualCanvas)')&&await ev('JSON.stringify(SatStore.settings)===__visualSettings && __layout.intervals.size===__visualTimers'));
        if(mode==='2d'||mode==='sky')check(label+' preserves projection proportions',Math.abs(g.canvas.w/(mode==='2d'?2:1)-g.canvas.h)<1.5,g.canvas);
        if(mode==='ground')check(label+' preserves the viewing direction and zoom',await ev(`document.querySelector('#${host} .ground-hud').textContent===__visualHud`));
        if(w===1440)fs.writeFileSync(path.join(shots,'expanded-'+route.split('/')[0]+'-'+mode+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
        if(mode==='3d'){await clickAt('#'+panel+mode+' .visual-expand');}else await escape();
        await until('!document.querySelector(".visual-expanded")');
        check(label+' restores DOM, focus, scrolling and normal page',await ev(`!document.querySelector('#app').inert && document.querySelector('#app').contains(__visualCanvas) && document.activeElement.matches('#${panel+mode} .visual-expand') && document.querySelector('#${panel+mode} .visual-expand').getAttribute('aria-pressed')==='false' && Math.abs(scrollY-__visualScroll)<2`));
      }
      console.log('PASS '+route+' expanded views at '+w+' × '+h);
    }
    await resize(1440,900);await ev(`document.querySelector('#${tab}2d').click();document.querySelector('#${panel}2d .visual-expand').scrollIntoView({block:'center'});`);await clickAt('#'+panel+'2d .visual-expand');
    for(const mode of ['3d','sky','ground','2d']){await clickAt('#'+tab+mode);check(route+' switches tab '+mode+' without leaving expanded view',await ev(`!!document.querySelector('.visual-expanded #${panel+mode}:not([hidden])')`));}
    for(const [w,h] of [[375,812],[812,375],[1024,768],[1440,900]]){await resize(w,h);check(route+' expansion follows shell resize '+w,await ev('(()=>{const c=document.querySelector(".visual-expanded").getBoundingClientRect(),h=document.querySelector(".top").getBoundingClientRect(),n=document.querySelector("#tabs").getBoundingClientRect();return h.y>=0&&c.y>=h.bottom-.5&&c.height>100&&(innerWidth>=1200?c.x>=n.right-.5:innerWidth<600?c.bottom<=n.y+.5:c.y>=n.bottom-.5);})()'));}
    await clickAt('#tabs [data-tab="settings"]');await until('document.querySelector("#app").classList.contains("page-settings")');
    check(route+' navigation cleans up expansion and focus restrictions',await ev('!document.querySelector(".visual-expanded") && !document.querySelector(".visual-placeholder") && !document.querySelector("#app").inert && !document.documentElement.classList.contains("visual-expanded-open")'));
  }
  for(let i=0;i<6;i++){await go('live/25544');await go('settings');await go('passes');await ev('document.querySelectorAll(".pass")[1].click()');}
  await go('settings');
  const beforeSkip=await ev('location.hash');await ev('document.querySelector(".skip-link").click()');
  check('keyboard skip link preserves route and focuses content',await ev('location.hash')===beforeSkip&&await ev('document.activeElement.id')==='app');
  check('replacing routes disconnects observers for removed panels',await ev('[...__layout.observers.values()].every(set=>[...set].every(el=>el.isConnected))'));
  check('replacing routes releases old live/pass timers',await ev('__layout.intervals.size')<=4);
  for(const theme of ['light','auto','dark']){await ev(`SatStore.set({theme:${JSON.stringify(theme)}});document.querySelector('#themeBtn').click();document.querySelector('#themeBtn').click();document.querySelector('#themeBtn').click();`);check('theme '+theme+' preserves usable shell',await ev('document.documentElement.dataset.theme')===theme);}
  for(const [w,h] of [[375,812],[812,375],[1440,900]]){
    await resize(w,h);await ev(`document.querySelector('#install-banner').hidden=false;document.body.classList.add('has-banner');document.querySelector('#toast').hidden=false;document.querySelector('#toast').classList.add('show');`);
    check('install, toast and navigation do not overlap at '+w,await ev(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),n=r('#tabs'),i=r('#install-banner'),t=r('#toast'),over=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return !over(n,i)&&!over(n,t)&&!over(i,t);})()`));
    await ev(`document.querySelector('#install-banner').hidden=true;document.body.classList.remove('has-banner');document.querySelector('#toast').hidden=true;`);
  }
  check('no renderer errors during transitions',errors.length===0,errors);
  await ev('navigator.serviceWorker.ready');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await send('Page.reload');await until('!!window.SatApp && !!document.querySelector("#locCard")');
  check('updated app shell and observing location work offline',await ev('!!navigator.serviceWorker.controller && SatStore.settings.lat===30.2672'));
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  let open;const opened=new Promise(r=>open=r),location=require('../electron/location.cjs').requestLocation({openExternal:url=>{open(url);return Promise.resolve();}});
  const locationURL=await opened;
  await send('Browser.grantPermissions',{permissions:['geolocation'],origin:new URL(locationURL).origin});
  await send('Emulation.setGeolocationOverride',{latitude:51.5074,longitude:-0.1278,accuracy:25});
  await send('Page.navigate',{url:locationURL});await until('!!document.querySelector("#share")');
  await ev('document.querySelector("#share").click()');await until('document.querySelector("#status").textContent.includes("Location sent")');
  const fix=await location;check('browser consent page sends a location back over loopback',fix.ok&&fix.coords.latitude===51.5074&&fix.coords.longitude===-0.1278);
  console.log(passed+' responsive checks passed. Screenshots: '+shots);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(ws)ws.close();if(chrome&&chrome.exitCode===null){chrome.kill();await sleep(300);}server.closeAllConnections();server.close();fs.rmSync(temp,{recursive:true,force:true});});
