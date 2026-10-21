// Perspective orientation and seam interpolation, using the actual pinned Three.js.
const {ok,near,done}=require('./harness'), G=require('../js/ground');
(async function () {
  // Data URLs let Node 18 load these unchanged browser ESM files without
  // introducing a package.json/type setting into this build-free app.
  const fs=require('fs'), source=f=>fs.readFileSync(require.resolve('../js/vendor/'+f),'utf8');
  const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
  const core=data(source('three.core.min.js'));
  const T=await import(data(source('three.module.min.js').replaceAll('./three.core.min.js',core)));
  const north=G.direction(0,0),east=G.direction(90,0),up=G.direction(22,90);
  near('north points along negative Z',north.z,-1,1e-12);
  near('east points along positive X',east.x,1,1e-12);
  near('zenith points up regardless of azimuth',up.y,1,1e-12);
  near('sky direction has unit length',Math.hypot(...Object.values(G.direction(293,54))),1,1e-12);
  near('interpolation crosses north by the short path',G.interpolate({az:359,el:20},{az:1,el:40},0.5).az,0,1e-12);
  near('interpolation crosses north in reverse',G.interpolate({az:1,el:20},{az:359,el:40},0.5).az,0,1e-12);
  near('interpolation preserves elevation',G.interpolate({az:359,el:20},{az:1,el:40},0.5).el,30,1e-12);
  ok('below-horizon, nonfinite and invalid elevations cannot appear',[-1,91,NaN,Infinity].every(el=>!G.valid({az:0,el})) && !G.valid({az:NaN,el:20}));
  ok('horizon and zenith are included',[0,90].every(el=>G.valid({az:0,el})));
  const camera=new T.PerspectiveCamera(80,1.5,0.1,250);
  function project(az,el){const d=G.direction(az,el);return new T.Vector3(d.x*100,d.y*100,d.z*100).project(camera);}
  function look(az,el){camera.rotation.set(el*Math.PI/180,-az*Math.PI/180,0,'YXZ');camera.updateMatrixWorld();}
  for(const [az,el] of [[0,0],[90,30],[180,45],[270,20],[350,70],[0,90]]){
    look(az,el);const p=project(az,el);
    near('camera centers actual bearing '+az+' elevation '+el,p.x,0,1e-10);
    near('camera centers actual elevation '+el,p.y,0,1e-10);
  }
  look(0,20);
  ok('east appears to the right when looking north',project(20,20).x>0 && project(340,20).x<0);
  ok('higher elevations appear upward',project(0,40).y>0 && project(0,0).y<0);
  ok('objects behind the observer fail clip-depth test',project(180,20).z>1);
  ok('Three.js version is the pinned r180',T.REVISION==='180');
  done();
})().catch(e=>{console.error(e);process.exit(1);});
