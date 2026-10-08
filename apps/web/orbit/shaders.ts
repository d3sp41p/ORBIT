// GLSL copied unchanged from reference/ORBIT_prototype.html (checked by shaders.test.ts).
// Do not edit by hand.

export const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p,int oct){float t=0.0,a=0.5,n=0.0;for(int i=0;i<8;i++){if(i>=oct)break;t+=snoise(p)*a;n+=a;a*=0.5;p=p*2.03+vec3(1.7,-3.1,2.3);}return t/n;}
vec3 hash3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return fract(sin(p)*43758.5453);}
vec3 craters(vec3 p,float density){
  vec3 i=floor(p),f=fract(p);float best=9.0;vec3 bh=vec3(0.0);
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 g=vec3(float(x),float(y),float(z));vec3 o=hash3(i+g);vec3 r=g+o*0.8+0.1-f;float d=dot(r,r);if(d<best){best=d;bh=o;}}
  float d=sqrt(best);float rr=0.18+0.3*bh.y;float on=step(bh.x,density);
  float inside=smoothstep(rr,rr*0.65,d)*on;float rim=smoothstep(rr*0.7,rr,d)*smoothstep(rr*1.3,rr,d)*on;
  return vec3(inside,rim,0.0);
}`;

export const PLANET_VS = `
varying vec3 vObj;varying vec3 vN;varying vec3 vW;
void main(){vObj=position;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;

export const PLANET_FS = `
uniform float uType;uniform vec3 uSeed;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;
uniform float uBands;uniform float uCrater;uniform float uTime;uniform vec3 uStorm;uniform float uStormOn;uniform vec3 uTint;uniform float uHi;uniform float uSize;uniform float uPx;
uniform float uLava;uniform float uWater;uniform float uBio;uniform float uCity;uniform float uIce;uniform float uAsh;uniform float uDim;
varying vec3 vObj;varying vec3 vN;varying vec3 vW;
${NOISE}
void main(){
  vec3 p=normalize(vObj);
  vec3 N=normalize(vN);vec3 L=normalize(-vW);vec3 V=normalize(cameraPosition-vW);
  float ndl=dot(N,L);
  float day=smoothstep(-0.06,0.28,ndl);
  vec3 col;vec3 emis=vec3(0.0);float spec=0.0;float atm=0.0;
  float cityOn=uCity*(1.0-uDim*0.85);
  if(uType<0.5){
    float w=fbm(p*vec3(1.6,5.5,1.6)+uSeed,uHi>0.5?5:3);
    float lat=p.y+w*0.13+0.025*snoise(p*vec3(1.5,26.0,1.5)+uSeed);
    float b=sin(lat*uBands)*0.5+0.5;float b2=sin(lat*uBands*2.63+1.3)*0.5+0.5;
    col=mix(uC1,uC2,smoothstep(0.15,0.85,b));col=mix(col,uC3,b2*0.4);
    col*=0.9+0.2*snoise(p*vec3(3.0,40.0,3.0)+uSeed);
    vec3 sp=p-uStorm;float st=smoothstep(0.22,0.0,length(sp*vec3(1.0,2.0,1.0)));
    float swirl=0.5+0.5*sin(length(sp*vec3(1.0,2.0,1.0))*60.0+fbm(p*8.0+uSeed,2)*4.0);
    col=mix(col,mix(vec3(0.62,0.28,0.16),vec3(0.85,0.55,0.38),swirl),st*uStormOn);
    if(cityOn>0.0){float n=snoise(p*36.0+uSeed)*0.5+0.5;float th=mix(0.975,0.9,cityOn);float cm=smoothstep(0.15,0.5,snoise(p*2.5+uSeed+11.0));emis+=vec3(1.0,0.78,0.5)*smoothstep(th,th+0.02,n)*cm*(1.0-day)*2.0;}
    atm=1.0;
  } else if(uType<1.5){
    float w=fbm(p*vec3(2.0,4.0,2.0)+uSeed,3);
    float lat=p.y+w*0.06;
    col=mix(uC1,uC2,smoothstep(-0.6,0.6,sin(lat*uBands)));
    col=mix(col,uC3,smoothstep(0.55,0.75,fbm(p*vec3(3.0,9.0,3.0)+uSeed+4.0,3))*0.6);
    col*=0.95+0.1*snoise(p*vec3(2.0,30.0,2.0)+uSeed);
    if(cityOn>0.0){float n=snoise(p*40.0+uSeed)*0.5+0.5;float th=mix(0.975,0.9,cityOn);float cm=smoothstep(0.15,0.5,snoise(p*2.5+uSeed+11.0));emis+=vec3(0.75,0.9,1.0)*smoothstep(th,th+0.02,n)*cm*(1.0-day)*1.8;}
    atm=1.0;
  } else {
    int oct=uHi>0.5?7:5;
    vec3 q=p*2.1+uSeed;
    vec3 wp=q+0.55*vec3(fbm(q*0.9+3.1,3),fbm(q*0.9+7.7,3),fbm(q*0.9+1.3,3));
    float hb=fbm(wp,oct);float h=hb+0.18*fbm(p*9.0+uSeed,3);
    float lava=uLava;
    float sea=smoothstep(0.02,0.15,uWater)*(1.0-lava);
    float seaLevel=mix(-1.4,mix(-0.25,0.32,uWater),sea);
    float water=smoothstep(seaLevel+0.004,seaLevel-0.004,h);
    float hl=max(hb,seaLevel);
    float lat=abs(p.y);
    vec3 rock=mix(vec3(0.24,0.21,0.18),vec3(0.46,0.40,0.34),smoothstep(-0.2,0.5,h))*uTint;
    float moist=fbm(p*2.6+uSeed+5.0,4)*0.5+0.5-lat*0.25;
    float veg=smoothstep(0.0,0.6,uBio)*smoothstep(0.78,0.35,lat);
    vec3 forest=mix(vec3(0.05,0.12,0.04),vec3(0.13,0.2,0.07),fbm(p*14.0+uSeed,3)*0.5+0.5);
    vec3 grass=vec3(0.26,0.3,0.13);
    vec3 desert=vec3(0.6,0.5,0.36)*uTint;
    vec3 biome=mix(desert,mix(grass,forest,smoothstep(0.5,0.65,moist)),smoothstep(0.38,0.5,moist));
    vec3 land=mix(rock,biome,veg*0.92);
    land=mix(land,rock*1.05,smoothstep(0.34,0.52,h));
    float snowLine=mix(0.82,0.25,uIce);
    float snow=(smoothstep(snowLine,snowLine+0.1,lat+h*0.18)+smoothstep(0.5,0.62,h))*sea;
    land=mix(land,vec3(0.88,0.91,0.95),clamp(snow,0.0,1.0));
    vec3 oc=mix(vec3(0.006,0.03,0.09),vec3(0.02,0.12,0.22),smoothstep(seaLevel-0.25,seaLevel,h));
    oc=mix(oc,vec3(0.75,0.82,0.9),smoothstep(snowLine+0.05,snowLine+0.15,lat)*uIce);
    col=mix(land,oc,water);
    if(uCrater>0.0){vec3 c=craters(p*7.0+uSeed,uCrater);vec3 c2=craters(p*16.0+uSeed*1.7,uCrater);float k=(1.0-water);col*=1.0-(c.x*0.3+c2.x*0.2)*k;col+=(c.y*0.08+c2.y*0.05)*k;hl-=(c.x*0.04+c2.x*0.02)*k;}
    vec3 dpdx=dFdx(vW),dpdy=dFdy(vW);float dhx=dFdx(hl),dhy=dFdy(hl);
    vec3 r1=cross(dpdy,N),r2=cross(N,dpdx);float det=dot(dpdx,r1);
    vec3 grad=sign(det)*(dhx*r1+dhy*r2);
    N=normalize(abs(det)*N-grad*uSize*0.015*(1.0-water));
    ndl=dot(N,L);day=smoothstep(-0.06,0.28,ndl);
    float crack=1.0-smoothstep(0.0,0.06,abs(snoise(p*4.5+uSeed)));
    float crack2=1.0-smoothstep(0.0,0.04,abs(snoise(p*12.0+uSeed*1.3)));
    vec3 basalt=mix(vec3(0.05,0.04,0.04),vec3(0.14,0.11,0.09),h+0.5);
    col=mix(col,basalt,lava);
    emis+=vec3(1.0,0.30,0.04)*(crack*1.0+crack2*0.45)*lava*2.4;
    vec3 cq=p*3.0+uSeed*1.3+vec3(uTime*0.004,0.0,0.0);
    float cn=fbm(cq+0.6*vec3(fbm(cq*1.3,3),fbm(cq*1.3+4.0,3),0.0),oct);
    float cl=smoothstep(0.12,0.55,cn)*sea*0.92;
    float sm=smoothstep(0.0,1.0,1.0-lava)*(1.0-sea)*0.6;
    cl=max(cl,smoothstep(0.1,0.6,fbm(p*2.0+uSeed+9.0,3))*sm);
    cl=max(cl,smoothstep(-0.2,0.4,cn)*uAsh*0.8);
    vec3 H=normalize(L+V);
    spec=pow(max(dot(N,H),0.0),140.0)*0.45*water*(1.0-cl);
    if(cityOn>0.0){
      float n=snoise(p*22.0+uSeed)*0.5+0.5;float n2=snoise(p*85.0+uSeed)*0.5+0.5;float n3=snoise(p*240.0+uSeed)*0.5+0.5;
      float th=mix(0.86,0.5,cityOn);
      float lights=smoothstep(th,th+0.12,n*0.55+n2*0.3+n3*0.15)*(1.0-water)*smoothstep(0.88,0.6,lat)*(1.0-clamp(snow,0.0,1.0)*0.8);
      emis+=vec3(1.0,0.68,0.34)*lights*(1.0-day)*(1.0-cl*0.85)*2.0;
    }
    vec3 cloudCol=mix(vec3(0.94),vec3(0.42,0.38,0.35),uAsh);
    col=mix(col,cloudCol,cl);
    atm=sea;
  }
  vec3 lin=pow(max(col,0.0),vec3(2.2));
  vec3 lit=lin*(day*1.2+0.003);
  lit*=mix(vec3(1.0),mix(vec3(1.0,0.5,0.3),vec3(1.0),smoothstep(-0.05,0.4,ndl)),atm);
  lit+=spec*vec3(1.0,0.92,0.8)*day;
  lit+=emis*smoothstep(2.0,12.0,uPx);
  gl_FragColor=vec4(lit,1.0);
}`;

export const ATMO_VS = `varying vec3 vN;varying vec3 vW;void main(){vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
export const ATMO_FS = `
uniform vec3 uColor;uniform float uPower;uniform float uStrength;uniform float uFade;
varying vec3 vN;varying vec3 vW;
void main(){
  vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);vec3 L=normalize(-vW);
  float fres=pow(1.0-abs(dot(N,V)),uPower);
  float lit=smoothstep(-0.35,0.55,dot(N,L));
  gl_FragColor=vec4(uColor*fres*lit*uStrength*uFade,1.0);
}`;
export const RING_VS = `varying vec3 vL;varying vec3 vW;void main(){vL=position;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
export const RING_FS = `
uniform float uIn;uniform float uOut;uniform vec3 uColor;uniform vec3 uCenter;uniform float uR;uniform float uSeedF;
varying vec3 vL;varying vec3 vW;
void main(){
  float r=length(vL.xy);float t=(r-uIn)/(uOut-uIn);
  if(t<0.0||t>1.0)discard;
  float b=0.55+0.25*sin(t*90.0+uSeedF)+0.2*sin(t*31.0+uSeedF*2.0)+0.15*sin(t*230.0);
  float gap=smoothstep(0.015,0.0,abs(t-0.62))+smoothstep(0.008,0.0,abs(t-0.31))*0.7;
  float edge=smoothstep(0.0,0.06,t)*smoothstep(1.0,0.9,t);
  float a=clamp(b,0.0,1.0)*edge*(1.0-gap)*0.85;
  vec3 L=normalize(-vW);vec3 toC=uCenter-vW;float tc=dot(toC,L);vec3 cl=vW+L*tc-uCenter;
  float shadow=(tc>0.0&&length(cl)<uR)?0.08:1.0;
  vec3 c=pow(uColor*(0.8+0.4*b),vec3(2.2))*1.2*shadow;
  gl_FragColor=vec4(c*a,a);
}`;
export const STAR_FS = `
uniform float uTime;uniform vec3 uCore;uniform vec3 uEdge;
varying vec3 vObj;varying vec3 vN;varying vec3 vW;
${NOISE}
void main(){
  vec3 p=normalize(vObj);vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);
  float n=fbm(p*3.5+vec3(0.0,uTime*0.03,uTime*0.02),5);
  float g=fbm(p*16.0-vec3(uTime*0.08),3);
  float k=clamp(0.55+n*0.9+g*0.35,0.0,1.0);
  vec3 c=mix(uEdge,uCore,k);
  float mu=max(dot(N,V),0.0);
  float limb=pow(mu,0.5);
  vec3 lin=pow(c,vec3(2.2))*(0.6+2.6*limb)*2.2;
  gl_FragColor=vec4(lin,1.0);
}`;

export const SKY_VS = `varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
export const SKY_FS = `
varying vec3 vD;
uniform vec3 uGN;uniform vec3 uGC;
${NOISE}
float h1(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
vec3 starCell(vec3 p,float dens,float rad,float gain){
  vec3 i=floor(p),f=fract(p);
  vec3 h=hash3(i);
  if(h.x>dens)return vec3(0.0);
  vec3 c=h.yzx*0.7+0.15;float d=length(f-c);
  float m=pow(h1(i+3.1),5.0);
  float s=exp(-d*d/(rad*rad))*(0.18+m*gain);
  float tmp=h1(i+7.7);
  vec3 col=tmp<0.15?vec3(1.0,0.62,0.42):tmp<0.4?vec3(1.0,0.86,0.68):tmp<0.8?vec3(0.95,0.96,1.0):vec3(0.66,0.78,1.0);
  return col*s;
}
void main(){
  vec3 d=normalize(vD);
  float sb=dot(d,uGN);float b=asin(clamp(sb,-1.0,1.0));
  vec3 inPlane=normalize(d-uGN*sb);
  float la=acos(clamp(dot(inPlane,uGC),-1.0,1.0));
  float warp=fbm(d*2.0+4.0,3)*0.07;
  float bw=b+warp;
  float band=exp(-pow(bw/0.15,2.0));
  float wide=exp(-pow(bw/0.42,2.0));
  float bulge=exp(-pow(la/0.62,2.0))*exp(-pow(bw/0.24,2.0));
  float along=0.55+0.45*exp(-pow(la/1.4,2.0));
  float n1=fbm(d*3.2+1.0,6)*0.5+0.5;
  float n2=fbm(d*11.0+5.0,5)*0.5+0.5;
  float glow=(band*(0.3+0.7*n1)*along+wide*0.12*n1+bulge*1.1*(0.55+0.45*n2));
  float dn=fbm(d*4.5+11.0,6);
  float dust=smoothstep(-0.02,0.3,dn)*exp(-pow((bw-0.012)/0.055,2.0));
  float dn2=fbm(d*13.0+3.0,5);
  float dust2=smoothstep(0.05,0.45,dn2)*exp(-pow(bw/0.11,2.0));
  glow*=1.0-clamp(dust*0.92+dust2*0.55,0.0,0.96);
  vec3 bandCol=mix(vec3(0.5,0.58,0.78),vec3(1.0,0.84,0.62),clamp(bulge*1.6,0.0,1.0));
  vec3 col=bandCol*glow*0.2;
  float neb=smoothstep(0.62,0.9,fbm(d*5.0+20.0,5)*0.5+0.5)*band;
  col+=vec3(0.7,0.16,0.28)*neb*0.09;
  float neb2=smoothstep(0.6,0.92,fbm(d*2.2+40.0,5)*0.5+0.5)*(0.3+wide);
  col+=vec3(0.12,0.22,0.5)*neb2*0.03;
  col+=vec3(0.0025,0.003,0.006);
  float sd=0.04+0.5*band+0.25*bulge;
  col+=starCell(d*140.0,sd,0.18,0.6)*(0.3+0.7*band)*0.6;
  col+=starCell(d*260.0+17.0,0.10+0.6*band,0.17,0.2)*0.35;
  gl_FragColor=vec4(col,1.0);
}`;

export const NEAR_STARS_VS = `attribute float size;attribute float phase;attribute vec3 color;varying vec3 vC;varying float vA;varying float size_v;uniform float uTime;uniform float uDpr;void main(){vC=color;size_v=size;vA=0.75+0.25*sin(uTime*(0.6+phase*0.3)+phase*6.0);gl_PointSize=size*uDpr;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
export const NEAR_STARS_FS = `varying vec3 vC;varying float vA;varying float size_v;void main(){vec2 q=gl_PointCoord-0.5;float d=length(q);float a=smoothstep(0.5,0.0,d);a=a*a;gl_FragColor=vec4(vC*a*vA*(0.35+0.25*size_v),a);}`;
