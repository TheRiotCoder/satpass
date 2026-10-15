"""Brute-force (1 s, numpy + python-sgp4) pass finder compared against SatPasses.findPasses over the matrix from dump_matrix.js.
Adapted from the peer-review script in /workspace/satpass-review/check.py. Usage: python3 brute_passes.py matrix.json
Exit status 1 if any pass is missed, spurious, or has AOS/LOS off by > 2.5 s; passes cut by the window end must be kept with
losAfterWindow=true and a LOS beyond the window."""
import json, math, numpy as np, datetime
from sgp4.api import Satrec, SatrecArray, jday
import sys
d=json.load(open(sys.argv[1]))
A=6378.137;F=1/298.257223563;E2=F*(2-F);W=7.292115146706979e-5
def prep(la,lo,h):
    la=math.radians(la);lo=math.radians(lo);N=A/math.sqrt(1-E2*math.sin(la)**2);h/=1000
    o=np.array([(N+h)*math.cos(la)*math.cos(lo),(N+h)*math.cos(la)*math.sin(lo),(N*(1-E2)+h)*math.sin(la)])
    E=np.array([-math.sin(lo),math.cos(lo),0]);Nn=np.array([-math.sin(la)*math.cos(lo),-math.sin(la)*math.sin(lo),math.cos(la)]);U=np.array([math.cos(la)*math.cos(lo),math.cos(la)*math.sin(lo),math.sin(la)])
    return o,E,Nn,U
def series(rec,ts,la,lo,al):
    jd0=2440587.5; days=ts/86400000.0
    jd=np.floor(jd0+days); fr=(jd0+days)-jd
    e,r,v=rec.sgp4_array(jd,fr)
    T=((jd-2451545.0)+fr)/36525.0
    g=67310.54841+(876600*3600+8640184.812866)*T+0.093104*T*T-6.2e-6*T**3
    g=np.radians((g%86400)/240.0);c,s=np.cos(g),np.sin(g)
    rx=c*r[:,0]+s*r[:,1];ry=-s*r[:,0]+c*r[:,1];rz=r[:,2]
    vx=c*v[:,0]+s*v[:,1]+W*ry;vy=-s*v[:,0]+c*v[:,1]-W*rx;vz=v[:,2]
    o,E,N,U=prep(la,lo,al)
    rho=np.stack([rx-o[0],ry-o[1],rz-o[2]],1);rng=np.linalg.norm(rho,axis=1)
    el=np.degrees(np.arcsin((rho@U)/rng))
    rr=(rho[:,0]*vx+rho[:,1]*vy+rho[:,2]*vz)/rng
    el[e!=0]=-90
    return el
tot=0;bad=0;problems=0
for o in d:
    rec=Satrec.twoline2rv(o['l1'],o['l2'])
    ts=np.arange(o['t0'],o['t1']+1,1000).astype(float)
    els=series(rec,ts,o['la'],o['lo'],o['al']);above=els>=o['minEl']
    passes=[];i=0
    while i<len(ts):
        if above[i]:
            j=i
            while j+1<len(ts) and above[j+1]: j+=1
            passes.append((ts[i],ts[j],els[i:j+1].max(),i==0,j==len(ts)-1));i=j+1
        else: i+=1
    ours=o['passes'];used=set()
    for (a,b,m,sc,ec) in passes:
        match=[k for k,p in enumerate(ours) if p['aos']-3000<=b and p['los']+3000>=a and k not in used]
        tot+=1
        if not match:
            bad+=1;problems+=1;print("MISSED",o['name'],o['obs'],o['minEl'],datetime.datetime.utcfromtimestamp(a/1000),"dur",(b-a)/1000,"max",round(m,2),"startcut",sc,"endcut",ec);continue
        k=match[0];used.add(k);p=ours[k]
        if not sc and abs(p['aos']-a)>2500: problems+=1;print("AOS off",o['name'],o['obs'],o['minEl'],p['aos']-a)
        if not ec and abs(p['los']-b)>2500: problems+=1;print("LOS off",o['name'],o['obs'],o['minEl'],p['los']-b)
        if ec and not (p.get('losAfterWindow') and p['los']>o['t1']): problems+=1;print("window-end pass not flagged/extended",o['name'],o['obs'],o['minEl'],p)
        if sc and not p.get('aosBeforeStart'): problems+=1;print("window-start pass not flagged",o['name'],o['obs'],o['minEl'],p)
        if p.get('truncated'): problems+=1;print("unexpected truncated",o['name'],o['obs'],o['minEl'])
        if not(sc or ec) and p['maxEl']<m-0.05: problems+=1;print("maxEl low",o['name'],o['obs'],p['maxEl'],m)
    for k,p in enumerate(ours):
        if k not in used: problems+=1;print("EXTRA",o['name'],o['obs'],o['minEl'],p)
print("brute passes",tot,"missed",bad,"problems",problems)
sys.exit(1 if problems else 0)
