// Exercise the actual Live route with controlled orbit/location states. This
// covers UI branches without requiring Chrome or a GPU.
const {ok, done} = require('./harness'), fs = require('fs'), vm = require('vm');
const Sky = require('../js/sky'), V = require('../js/visible');
const app = fs.readFileSync(require.resolve('../js/app'), 'utf8');
const route = app.slice(app.indexOf('  function celestialHtml'), app.indexOf('  /* ===================== VISIBLE NOW'));
function fixture(hasLocation, initialState, validSat = true, bodies = []) {
  const nodes = {}, stored = {liveView:'sky'}, skyDraws = [], groundDraws = [], mapDraws = [], focus = {id:null};
  const ground = {update:(items,options)=>groundDraws.push({items,options}),suspend(){this.stopped=true;},dispose(){this.disposed=true;},look(a,e){this.aim=[a,e];},find(){this.found=true;},zoom(){},reset(){}};
  let state = initialState;
  function $(id, parent) {
    var key = parent ? parent.selector + ' ' + id : id;
    return nodes[key] || (nodes[key] = { selector:key, hidden:false, textContent:'', innerHTML:'', clientWidth:320, attrs:{},
      getBoundingClientRect(){return {left:0,top:0,width:320,height:320};},
      setAttribute(k,v){this.attrs[k]=v;}, focus(){focus.id=id;} });
  }
  $('#liveCelestialToggle').checked = true;
  const obs = {latDeg:30,lonDeg:-97}, context = {
    ROUTES:{}, S:{load:(k,d)=>k in stored?stored[k]:d,save:(k,v)=>{stored[k]=v;},hasLocation:()=>hasLocation,
      settings:{lat:30,lon:-97,alt:150,minEl:10},isFav:()=>false},
    P:{makeObserver:()=>({dummy:true}),groundTrack:()=>[],stateAt:()=>state,footprintAngleDeg:()=>20},
    R:{radios:()=>[]},F:{age:()=>'1h'},Dr:{worldmap:(...args)=>mapDraws.push(args)},
    window:{SatGround:{create:(host,pick)=>{ground.pick=pick;return ground;}},SatVisible:V,SatCelestial:{positions:()=>bodies},SatSky:{pick:Sky.pick,draw:(canvas,w,items,options)=>{
      skyDraws.push({items,options,points:items.map(s=>Sky.project(s.az,s.el,w)).filter(Boolean)});
      return {size:w,hits:items.map(s=>({...s,...Sky.project(s.az,s.el,w)}))};
    }}}, main:{innerHTML:''},view:{token:1},passCache:{},$,$$:()=>[],watchSize:()=>()=>{},Date,
    entry:()=>({epochMs:0}),satObj:()=>validSat?{}:null,satSelectHtml:()=>'',setTitle:()=>{},radarInfoOf:()=>null,
    observer:()=>obs,panelWidth:()=>320,nameOf:n=>'Satellite '+n,esc:String,fmt:(n,d)=>n.toFixed(d),az:n=>Math.round(n)+'° E',
    go:()=>{},refreshNextBar:()=>{},every:()=>{},setTimeout:()=>{},computePasses:()=>{},passesCurrent:()=>false
  };
  vm.runInNewContext(route,context);context.ROUTES.live([25544]);
  return {nodes,stored,skyDraws,groundDraws,ground,mapDraws,context,focus,setState:s=>{state=s;context.view.tick();}};
}
const state = {el:45,az:90,latDeg:30,lonDeg:-97,altKm:400,rangeKm:600,rrKmS:1,speedKmS:7.6,sunlit:true,sunEl:-10};
let f = fixture(true,state);
ok('Live has a third Sky View tab and linked panel', /id="tabsky" aria-controls="panelsky"/.test(f.context.main.innerHTML));
ok('saved Sky View opens directly and hides map/globe', f.nodes['#tabsky'].attrs['aria-selected']==='true' && f.nodes['#panel2d'].hidden && f.nodes['#panel3d'].hidden && !f.nodes['#panelsky'].hidden);
ok('selected satellite plots from observer azimuth/elevation', f.skyDraws.length===1 && f.skyDraws[0].items[0].id===25544 && f.skyDraws[0].points.length===1);
ok('readouts include bearing, elevation, range and conditions', /Satellite 25544.*Bearing 90° E.*Elevation 45.0°.*Range 600 km.*Sunlit · dark sky/.test(f.nodes['#liveSkyReadout'].textContent));
ok('minimum elevation ring uses saved setting', f.skyDraws[0].options.minEl===10);
f.setState({...state,el:-20});
ok('below-horizon satellite gets an explanation and no sky marker', /Below your horizon/.test(f.nodes['#liveSkyStatus'].textContent) && f.skyDraws.at(-1).points.length===0);
f.setState({...state,el:5});
ok('above-horizon satellite stays plotted below min elevation', /below your 10° minimum/.test(f.nodes['#liveSkyStatus'].textContent) && f.skyDraws.at(-1).points.length===1);
f.setState(null);
ok('propagation failure hides stale chart/readouts', f.nodes['#liveSkyChart'].hidden && !f.nodes['#liveSkyReadout'].textContent && /No valid orbital position/.test(f.nodes['#liveSkyStatus'].textContent));
f.setState(state);
ok('chart recovers on next valid position', !f.nodes['#liveSkyChart'].hidden);
f.nodes['#tabsky'].onkeydown({key:'ArrowRight',preventDefault(){}});
ok('keyboard advances from Sky View to 3D Sky', f.stored.liveView==='ground' && f.focus.id==='#tabground' && f.nodes['#panelsky'].hidden && f.groundDraws.length===1);
f.nodes['#tabground'].onkeydown({key:'ArrowRight',preventDefault(){}});
ok('keyboard wraps 3D Sky to map and suspends rendering', f.stored.liveView==='2d' && f.focus.id==='#tab2d' && f.ground.stopped && f.mapDraws.length===1);
f.nodes['#tab2d'].onkeydown({key:'End',preventDefault(){}});
ok('End activates the fourth tab', f.stored.liveView==='ground' && f.focus.id==='#tabground');
f = fixture(false,state);
ok('missing observing location prompts Setup without plotting dummy coordinates', !f.nodes['#liveSkyLocation'].hidden && f.nodes['#liveSkyChart'].hidden && f.skyDraws.length===0);
f = fixture(true,state,false);
ok('invalid satellite orbit does not show an empty stale canvas', f.nodes['#liveSkyChart'].hidden && f.skyDraws.length===0);
const moon = {id:'body:Moon',name:'Moon',kind:'moon',az:180,el:30,illumination:0.5,color:'#e2e8f0'};
f = fixture(true,state,true,[moon,{id:'body:Mars',name:'Mars',kind:'planet',az:200,el:-10}]);
ok('Live overlay adds only above-horizon bodies without replacing satellite', f.skyDraws[0].items.length===2 && f.skyDraws[0].items[0].id===25544 && f.skyDraws[0].items[1].id==='body:Moon');
ok('Moon readout includes illuminated percentage', f.nodes['#liveCelestialList [data-body="body:Moon"] .celestial-position'].textContent.includes('50% illuminated'));
f.nodes['#liveCelestialList'].onclick({target:{closest:()=>({dataset:{body:'body:Moon'}})}});
ok('body selection highlights reference independently of satellite', f.skyDraws.at(-1).items[0].selected && f.skyDraws.at(-1).items[1].selected);
f.setState({...state,el:-20});
ok('Moon stays on the chart while selected satellite is below horizon', f.skyDraws.at(-1).points.length===1 && /Below your horizon/.test(f.nodes['#liveSkyStatus'].textContent));
f.setState(state);
f.nodes['#liveCelestialToggle'].checked=false; f.nodes['#liveCelestialToggle'].onchange();
ok('toggle disables overlay and persists shared preference', f.stored.skyCelestial===false && f.skyDraws.at(-1).items.length===1 && f.nodes['#liveCelestialList'].hidden);
f.nodes['#liveCelestialToggle'].checked=true; f.context.window.SatCelestial.positions=()=>{throw new Error('unavailable');}; f.context.view.tick();
ok('astronomy failure leaves satellite sky tracking working', f.skyDraws.at(-1).items.length===1 && /unavailable/.test(f.nodes['#liveCelestialList'].textContent));
const polaris={id:'star:Polaris',name:'Polaris · North Star',kind:'star',az:0.8,el:30,color:'#c4b5fd',illumination:null};
f=fixture(true,state,true,[polaris]);
f.nodes['#liveCelestialList'].onclick({target:{closest:()=>({dataset:{body:'star:Polaris'}})}});
ok('Polaris is selectable in Live with a bearing/elevation readout', f.skyDraws.at(-1).items.some(b=>b.id==='star:Polaris' && b.kind==='star' && b.selected) && /Bearing.*Elevation/.test(f.nodes['#liveCelestialList [data-body="star:Polaris"] .celestial-position'].textContent));
f=fixture(true,state,true,[{...polaris,el:-30}]);
ok('Live hides below-horizon Polaris', !f.skyDraws.at(-1).items.some(b=>b.id==='star:Polaris'));
f=fixture(true,state,true,[polaris]);
f.nodes['#tabground'].onclick();
ok('3D Sky uses the same observer positions and sky conditions', f.groundDraws.at(-1).items[0].az===90 && f.groundDraws.at(-1).options.sunEl===-10 && f.groundDraws.at(-1).options.minEl===10);
f.ground.pick(polaris);
ok('3D reference selection gets the correct readout', /Polaris.*Bearing/.test(f.nodes['#liveGroundSelection'].textContent) && f.groundDraws.at(-1).items.some(b=>b.id===polaris.id && b.selected));
f.nodes['#liveGroundE'].onclick();f.nodes['#liveGroundFind'].onclick();
ok('3D compass and find controls reach the renderer', f.ground.aim[0]===90 && f.ground.found);
f.setState(null);
ok('failed propagation hides and suspends stale 3D rendering', f.nodes['#liveGround'].hidden && f.ground.stopped && /No valid/.test(f.nodes['#liveGroundStatus'].textContent));
f.setState(state);
ok('valid propagation restores the 3D view', !f.nodes['#liveGround'].hidden);
f.context.view.dispose();
ok('leaving Live releases the 3D renderer', f.ground.disposed);
f=fixture(false,state);f.nodes['#tabground'].onclick();
ok('3D Sky requires an actual observer, with a Setup link', f.groundDraws.length===0 && f.nodes['#liveGround'].hidden && /href="#\/settings"/.test(f.nodes['#liveGroundStatus'].innerHTML));
done();
