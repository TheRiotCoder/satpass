const { ok, near, done, snapshot } = require('./harness');
const Sky = require('../js/sky'), P = require('../js/passes'), V = require('../js/visible'), T = require('../js/tle');
const size = 360, c = size / 2, radius = c - 38;
for (const [az, x, y] of [[0,c,c-radius],[90,c-radius,c],[180,c,c+radius],[270,c+radius,c]]) {
  const p = Sky.project(az, 0, size);
  near('looking-up horizon x for bearing ' + az, p.x, x, 1e-10);
  near('looking-up horizon y for bearing ' + az, p.y, y, 1e-10);
}
ok('all zenith bearings meet at overhead', [0,45,90,180,270,359].every(az => { const p = Sky.project(az,90,size); return p.x === c && p.y === c; }));
const mid = Sky.project(0,45,size);
near('45 degrees elevation halfway from horizon to overhead', Math.hypot(mid.x-c,mid.y-c), radius/2, 1e-10);
near('azimuth wraps through 360', Sky.project(360,30,size).x, Sky.project(0,30,size).x, 1e-10);
ok('below-horizon and invalid positions are not plotted', [[0,-1],[0,91],[NaN,45],[0,NaN]].every(([a,e]) => Sky.project(a,e,size) === null));
const hits = [{id:1,x:20,y:30},{id:2,x:28,y:30}];
ok('tap selects nearest marker', Sky.pick(hits,27,30).id === 2);
ok('tap tolerance works at its boundary', Sky.pick(hits,4,30).id === 1);
ok('empty space selects nothing', Sky.pick(hits,100,100) === null && Sky.pick([],0,0) === null);

// Renderer contract: hit coordinates remain in CSS pixels at high DPI; shared
// rows from SGP4 supply exactly the same above-horizon objects as the other tabs.
const texts = [], arcs = [];
const ctx = new Proxy({
  createRadialGradient: () => ({addColorStop(){}}), measureText: t => ({width:t.length*7}),
  fillText: t => texts.push(t), arc: (...a) => arcs.push(a)
}, {get:(o,k)=>k in o?o[k]:()=>{}});
const canvas = {style:{},getContext:()=>ctx}; global.window = {devicePixelRatio:2};
const entries = T.parse(snapshot().tle).sats, at = entries.find(e=>e.norad===25544).epochMs;
const rows = V.scan(entries,P.makeObserver(30,-97,150),at,{}).rows;
const items = rows.map((r,i)=>({id:r.norad,name:'Satellite '+r.norad,az:r.state.az,el:r.state.el,selected:i===0,color:'#fbbf24'}));
const result = Sky.draw(canvas,size,items,{minEl:10});
ok('all real above-horizon satellites get sky markers', result.hits.length === rows.length && result.hits.every(h=>rows.some(r=>r.norad===h.id)));
ok('projected satellites remain inside horizon', result.hits.every(h=>Math.hypot(h.x-c,h.y-c) <= radius + 1e-9));
ok('DPI does not change CSS-space hit coordinates', canvas.width === size*2 && canvas.height === size*2 && canvas.style.width === size+'px' && result.size===size);
ok('cardinal directions and overhead are labeled', ['N','E','S','W','Overhead · 90°'].every(t=>texts.includes(t)));
ok('selected marker keeps identity and highlight', result.hits.find(h=>h.id===items[0].id).selected);
ok('tap on selected marker resolves to its identity', Sky.pick(result.hits,result.hits[0].x,result.hits[0].y).id === items[0].id);
const before = arcs.length, empty = Sky.draw(canvas,280,[],{});
ok('empty sky keeps horizon chart and has no hit targets', empty.hits.length === 0 && arcs.length > before);
Sky.draw(canvas,1000,items,{labels:true});
ok('desktop chart has a readable size cap', canvas.width===1280 && canvas.style.width==='640px');
const overlay = Sky.draw(canvas,360,[items[0],{id:'body:Moon',name:'Moon',kind:'moon',az:120,el:50,color:'#e2e8f0'},{id:'body:Venus',name:'Venus',kind:'planet',az:250,el:40,color:'#fb923c'},{id:'body:Mars',name:'Mars',kind:'planet',az:0,el:-20}],{labels:false});
ok('celestial markers keep separate identities and below-horizon bodies stay off chart', overlay.hits.length===3 && overlay.hits.find(h=>h.id==='body:Moon').kind==='moon' && overlay.hits.find(h=>h.id==='body:Venus').kind==='planet');
const moon=overlay.hits.find(h=>h.id==='body:Moon');
ok('tapping a reference object preserves its type', Sky.pick(overlay.hits,moon.x,moon.y).kind==='moon');
ok('reference names are labeled even when satellite labels are off', texts.includes('Moon') && texts.includes('Venus'));
const starChart=Sky.draw(canvas,360,[{id:'star:Polaris',name:'Polaris · North Star',kind:'star',az:0.8,el:40,color:'#c4b5fd'}],{labels:false});
ok('Polaris gets a labeled star reference marker', starChart.hits.length===1 && starChart.hits[0].kind==='star' && texts.includes('Polaris · North Star'));
ok('Polaris tap returns its star identity', Sky.pick(starChart.hits,starChart.hits[0].x,starChart.hits[0].y).id==='star:Polaris');
const expanded = Sky.draw(canvas, 1200, [], {maxSize:900});
ok('expanded chart grows past the dashboard cap while fitting available height', expanded.size === 900 && canvas.width === 1800 && canvas.height === 1800);
done();
