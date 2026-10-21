const {ok,done}=require('./harness');
const {requestLocation,coordinates}=require('../electron/location.cjs');
const point={latitude:30.2672,longitude:-97.7431,accuracy:25,altitude:150};
ok('location accepts finite real coordinates',JSON.stringify(coordinates(point))===JSON.stringify(point));
for(const invalid of [null,{}, {...point,latitude:91},{...point,longitude:-181},{...point,accuracy:-1},{...point,latitude:'30'},{...point,longitude:Infinity},{...point,altitude:10000}])ok('location rejects invalid coordinate input',coordinates(invalid)===null);
function start(options={}){let opened;const ready=new Promise(r=>opened=r);const result=requestLocation({openExternal:url=>opened(url),timeoutMs:10000,...options});return {ready,result};}
async function post(url,body,origin=new URL(url).origin){return fetch(new URL('result',url),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body});}
(async()=>{
 const req=start(),url=await req.ready,origin=new URL(url).origin;
 ok('browser handoff listens only on a randomized loopback URL',new URL(url).hostname==='127.0.0.1'&&/^\/[a-f0-9]{48}\/$/.test(new URL(url).pathname));
 const page=await fetch(url),html=await page.text();
 ok('consent page explains browser provider and local transfer',page.ok&&html.includes('Share location with SatPass')&&html.includes('online location provider')&&html.includes('only to the SatPass app on this computer'));
 ok('handoff page prevents framing and has no cache/referrer',page.headers.get('content-security-policy').includes("frame-ancestors 'none'")&&page.headers.get('cache-control')==='no-store'&&page.headers.get('referrer-policy')==='no-referrer');
 ok('unknown paths and local files cannot be read',(await fetch(origin+'/package.json')).status===404);
 ok('cross-origin websites cannot submit a location',(await post(url,JSON.stringify(point),'https://example.com')).status===403);
 ok('missing Origin is rejected',(await fetch(new URL('result',url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(point)})).status===403);
 ok('malformed JSON is rejected',(await post(url,'{')).status===400);
 ok('invalid coordinates are rejected without completing request',(await post(url,JSON.stringify({...point,latitude:100}))).status===400);
 ok('oversized payload is rejected',(await post(url,' '.repeat(3000))).status===413);
 const response=await post(url,JSON.stringify(point)),result=await req.result;
 ok('one valid browser result is returned to the app',response.ok&&result.ok&&JSON.stringify(result.coords)===JSON.stringify(point));
 let closed=false;try{await fetch(url);}catch{closed=true;}ok('listener closes after returning a location',closed);
 const cancel=start(),cancelURL=await cancel.ready;
 await fetch(new URL('cancel',cancelURL),{method:'POST',headers:{Origin:new URL(cancelURL).origin,'Content-Type':'application/json'},body:'{}'});
 ok('user can cancel without saving coordinates',(await cancel.result).code===1);
 const controller=new AbortController(),abort=start({signal:controller.signal});await abort.ready;controller.abort();
 ok('closing app cancels the location listener',(await abort.result).code===1);
 const timed=start({timeoutMs:30});await timed.ready;ok('abandoned browser request expires',(await timed.result).code===3);
 ok('browser launch failure returns a useful error',(await requestLocation({openExternal:()=>Promise.reject(new Error('No browser'))})).code===2);
 const alreadyAborted=new AbortController();alreadyAborted.abort();
 ok('already cancelled request never opens a browser',(await requestLocation({openExternal:()=>{throw new Error('should not open');},signal:alreadyAborted.signal})).code===1);
 done();
})().catch(err=>{console.error(err);process.exitCode=1;});
