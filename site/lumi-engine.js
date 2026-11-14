/* Moteur couleur LumiLooks 1.6.2, généré par site/work/build-engine.mjs. Ne pas modifier à la main. */
(() => {
"use strict";
// ---- shared/color.mjs
/* Shared, deterministic color pipeline. Used by preview, thumbnails and exports. */
const defaults = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temperature: 0,
  tint: 0, fade: 0, gamma: 0, shadowHue: 220, shadowAmount: 0, midHue: 285,
  midAmount: 0, highHue: 40, highAmount: 0, grain: 0, vignette: 0, glow: 0,
  sharpness: 0, intensity: 100,
};
const hslBands=[
  {id:'Red',name:'Rouges',hue:0,radius:40,color:'#df6b76'},
  {id:'Orange',name:'Oranges',hue:30,radius:30,color:'#d6a16c'},
  {id:'Yellow',name:'Jaunes',hue:60,radius:40,color:'#c4b96e'},
  {id:'Green',name:'Verts',hue:120,radius:60,color:'#76b68c'},
  {id:'Aqua',name:'Turquoises',hue:180,radius:60,color:'#6bb9b7'},
  {id:'Blue',name:'Bleus',hue:240,radius:40,color:'#729bd7'},
  {id:'Purple',name:'Violets',hue:270,radius:30,color:'#a986cf'},
  {id:'Magenta',name:'Magentas',hue:300,radius:40,color:'#cf83b5'},
];
const curveChannels=['Master','Red','Green','Blue'];
Object.assign(defaults,{brightness:0,whites:0,blacks:0,vibrance:0,hueShift:0,dehaze:0,redGain:0,greenGain:0,blueGain:0,clarity:0,texture:0,denoise:0,vignetteMidpoint:50,vignetteSoftness:50,vignetteRoundness:50,glowRadius:50,grainSize:50,grainColor:0,flipHorizontal:0,flipVertical:0});
for(const band of hslBands)for(const suffix of ['H','S','L'])defaults['hsl'+band.id+suffix]=0;
for(const channel of curveChannels)for(const point of ['Low','Mid','High'])defaults['curve'+channel+point]=0;
const advancedColorKeys=['brightness','whites','blacks','vibrance','hueShift','dehaze','redGain','greenGain','blueGain',...Object.keys(defaults).filter(k=>k.startsWith('hsl')||k.startsWith('curve'))];
const groups = {
  color: ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'temperature', 'tint', 'fade', 'gamma',...advancedColorKeys],
  wheels: ['shadowHue', 'shadowAmount', 'midHue', 'midAmount', 'highHue', 'highAmount'],
  lens: ['glow', 'vignette', 'sharpness','clarity','texture','denoise','vignetteMidpoint','vignetteSoftness','vignetteRoundness','glowRadius'], film: ['grain','grainSize','grainColor'], lut: [],crop:['flipHorizontal','flipVertical'],
};
const clamp = (v, a=0, b=1) => Math.max(a, Math.min(b,v));
function settingRange(key){
  if(key==='exposure')return[-4,4];if(key==='hueShift')return[-180,180];if(/^hsl.*H$/.test(key))return[-45,45];
  if(['shadowHue','midHue','highHue'].includes(key))return[0,360];if(key.startsWith('flip'))return[0,1];
  if(['intensity','grain','vignette','glow','sharpness','denoise','vignetteMidpoint','vignetteSoftness','vignetteRoundness','glowRadius','grainSize','grainColor','shadowAmount','midAmount','highAmount'].includes(key))return[0,100];return[-100,100];
}
function normalizedSettings(input = {}) {
  const out = {...defaults};
  for (const k of Object.keys(out)) if (Number.isFinite(input[k])) out[k] = clamp(input[k],...settingRange(k));
  out.intensity = clamp(out.intensity,0,100);
  return out;
}
function effectiveSettings(s, enabled={}) {
  const out=normalizedSettings(s);
  for(const [group,keys] of Object.entries(groups)) if(enabled[group] === false) for(const k of keys) out[k]=defaults[k];
  return out;
}
function hueRGB(hue) {
  const h=hue/60, x=1-Math.abs(h%2-1);
  return h<1?[1,x,0]:h<2?[x,1,0]:h<3?[0,1,x]:h<4?[0,x,1]:h<5?[x,0,1]:[1,0,x];
}
function rgbToHsl(r,g,b){
  r=clamp(r);g=clamp(g);b=clamp(b);const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,l=(hi+lo)/2;if(d<1e-9)return[0,0,l];
  let h=hi===r?(g-b)/d+(g<b?6:0):hi===g?(b-r)/d+2:(r-g)/d+4;return[h*60,d/(1-Math.abs(2*l-1)),l];
}
function hslToRgb(h,s,l){
  h=((h%360)+360)%360;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
  const a=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return a.map(v=>v+m);
}
function adjustHsl(r,g,b,s){
  let [h,sat,l]=rgbToHsl(r,g,b),dh=0,ds=0,dl=0,total=0;
  for(const band of hslBands){let w=clamp(1-Math.abs(((h-band.hue+540)%360)-180)/band.radius);w=w*w*(3-2*w);total+=w;dh+=w*s['hsl'+band.id+'H'];ds+=w*s['hsl'+band.id+'S'];dl+=w*s['hsl'+band.id+'L'];}
  const weight=Math.max(total,.00001);return hslToRgb(h+s.hueShift+dh/weight,clamp(sat*(1+ds/weight/100)),clamp(l+dl/weight*.003));
}
function curveSample(x,points){
  const p=[0,clamp(.25+points[0]/400),clamp(.5+points[1]/400),clamp(.75+points[2]/400),1],t=clamp(x)*4,i=Math.min(3,Math.floor(t));return p[i]+(p[i+1]-p[i])*(t-i);
}
function makeTransform(settings, enabled={}, imported=null) {
  const s=effectiveSettings(settings, enabled), exp=2**s.exposure, con=1+s.contrast/100, sat=1+s.saturation/100, gam=2**(-s.gamma/100);
  const t=s.temperature/350, tint=s.tint/400, fade=s.fade/500, amount=s.intensity/100;
  const wheels=[['shadow',s.shadowHue],['mid',s.midHue],['high',s.highHue]].map(([name,h])=>hueRGB(h).map(v=>(v-0.5)*s[name+'Amount']/220));
  const hslEnabled=s.hueShift!==0||Object.keys(s).some(k=>k.startsWith('hsl')&&s[k]!==0),curves=curveChannels.map(channel=>['Low','Mid','High'].map(point=>s['curve'+channel+point])),curvesEnabled=curves.some(points=>points.some(v=>v!==0)),gains=[s.redGain,s.greenGain,s.blueGain].map(v=>2**(v/100)),haze=s.dehaze*.0035;
  return (r,g,b)=> {
    const orig=[r,g,b];
    r*=exp;g*=exp;b*=exp;
    r+=t+tint*.4;g-=tint;b-=t;
    r=((r+s.brightness*.003)*gains[0]-.7*haze)/(1-haze);g=((g+s.brightness*.003)*gains[1]-.7*haze)/(1-haze);b=((b+s.brightness*.003)*gains[2]-.7*haze)/(1-haze);
    let y=.2126*r+.7152*g+.0722*b;
    const low=(1-clamp(y))**2, high=clamp(y)**2;
    const lift=s.shadows/220*low+s.highlights/220*high+s.blacks/200*low*low+s.whites/200*high*high;
    r+=lift;g+=lift;b+=lift;
    r=(r-.5)*con+.5;g=(g-.5)*con+.5;b=(b-.5)*con+.5;
    if(hslEnabled)[r,g,b]=adjustHsl(r,g,b,s);
    y=.2126*r+.7152*g+.0722*b;
    const saturation=sat*(1+s.vibrance/100*(1-clamp(Math.max(r,g,b)-Math.min(r,g,b)))*.9);
    r=y+(r-y)*saturation;g=y+(g-y)*saturation;b=y+(b-y)*saturation;
    const weights=[(1-clamp(y))**2,1-Math.abs(clamp(y)*2-1),clamp(y)**2];
    let result=[r,g,b].map((v,c)=> {
      v=Math.pow(clamp(v),gam);
      for(let i=0;i<3;i++)v+=wheels[i][c]*weights[i];
      return clamp(v*(1-fade)+fade);
    });
    if(curvesEnabled)result=result.map((v,c)=>curveSample(curveSample(v,curves[0]),curves[c+1]));
    if(imported && enabled.lut!==false)result=sampleLUT(imported,...result);
    return result.map((v,i)=>clamp(orig[i]+(v-orig[i])*amount));
  };
}
function buildLUT(s, enabled, imported=null, size=33) {
  const transform=makeTransform(s,enabled,imported), data=new Float32Array(size*size*size*3);let n=0;
  for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++)for(const c of transform(r/(size-1),g/(size-1),b/(size-1)))data[n++]=c;
  return {size,data};
}
function sampleLUT(lut,r,g,b) {
  const n=lut.size, max=n-1, domainMin=lut.domainMin||[0,0,0], domainMax=lut.domainMax||[1,1,1];
  const p=[r,g,b].map((v,i)=>clamp((v-domainMin[i])/(domainMax[i]-domainMin[i]))*max), a=p.map(Math.floor), f=p.map((v,i)=>v-a[i]), out=[0,0,0];
  for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++) {
    const index=((Math.min(a[2]+dz,max)*n+Math.min(a[1]+dy,max))*n+Math.min(a[0]+dx,max))*3;
    const w=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1])*(dz?f[2]:1-f[2]);
    for(let c=0;c<3;c++)out[c]+=lut.data[index+c]*w;
  }return out;
}
function parseCube(text) {
  if(typeof text!=='string'||text.length>40e6)throw Error('Fichier LUT trop volumineux.');
  let size=0, values=[], domainMin=[0,0,0], domainMax=[1,1,1];
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.split('#')[0].trim();if(!line)continue;
    if(line.startsWith('LUT_3D_SIZE'))size=Number(line.split(/\s+/)[1]);
    else if(line.startsWith('DOMAIN_MIN'))domainMin=line.split(/\s+/).slice(1).map(Number);
    else if(line.startsWith('DOMAIN_MAX'))domainMax=line.split(/\s+/).slice(1).map(Number);
    else if(/^[+\-.\d]/.test(line)){const row=line.split(/\s+/).map(Number);if(row.length!==3||row.some(v=>!Number.isFinite(v)))throw Error('Valeurs LUT invalides.');values.push(...row);}
  }
  if(!Number.isInteger(size)||size<2||size>65||values.length!==size**3*3)throw Error('Utilisez une LUT 3D .cube de 2 à 65 points.');
  if(domainMin.length!==3||domainMax.length!==3||domainMin.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(domainMax[i])||domainMax[i]<=v))throw Error('Domaine LUT invalide.');
  return {size,data:new Float32Array(values),domainMin,domainMax};
}
function serializeCube(lut) {
  let text=`TITLE "LumiLooks"\nLUT_3D_SIZE ${lut.size}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n`;
  for(let i=0;i<lut.data.length;i+=3)text+=`${lut.data[i].toFixed(7)} ${lut.data[i+1].toFixed(7)} ${lut.data[i+2].toFixed(7)}\n`;
  return text;
}
const presets = [
  {id:'original',name:'Original',category:'Essentiels',description:'Votre image, sans correction.',color:'#c6c3cc',settings:{}},
  {id:'luminos',name:'Luminos signature',category:'Signature',description:'Des ombres violettes, une lumière douce.',color:'#a569f1',settings:{contrast:15,temperature:7,shadowHue:272,shadowAmount:17,highHue:38,highAmount:10,fade:7,vignette:16,glow:14}},
  {id:'cinema',name:'Teal & amber',category:'Cinéma',description:'Ombres cyan et hautes lumières ambrées.',color:'#5eb9b1',settings:{contrast:22,saturation:-8,shadowHue:186,shadowAmount:28,highHue:35,highAmount:24,vignette:20,grain:10}},
  {id:'golden',name:'Golden hour',category:'Cinéma',description:'La chaleur des dernières heures du jour.',color:'#e8b376',settings:{temperature:30,contrast:9,highlights:-16,shadows:12,highHue:35,highAmount:16,glow:22}},
  {id:'noir',name:'Noir absolu',category:'Argentique',description:'Un noir et blanc dense et contrasté.',color:'#c0bbc8',settings:{saturation:-100,contrast:32,shadows:-10,grain:23,vignette:25}},
  {id:'portra',name:'Portrait doux',category:'Argentique',description:'Des tons chair délicats et des noirs relevés.',color:'#d6b5a5',settings:{temperature:10,contrast:-9,saturation:-12,fade:18,highlights:-18,grain:15,glow:10}},
  {id:'midnight',name:'Midnight violet',category:'Signature',description:'Une nuit aux reflets de l’univers Luminos.',color:'#9b81de',settings:{exposure:-.3,contrast:18,temperature:-20,shadowHue:262,shadowAmount:30,midHue:289,midAmount:12,vignette:28}},
  {id:'chrome',name:'Chrome 200',category:'Argentique',description:'Des couleurs franches, un grain discret.',color:'#89bfc0',settings:{contrast:20,saturation:16,temperature:-7,highlights:-15,grain:18,fade:5}},
  {id:'desert',name:'Dune',category:'Cinéma',description:'Une palette solaire, minérale et désaturée.',color:'#d4b78a',settings:{temperature:23,saturation:-28,contrast:19,fade:10,shadowHue:32,shadowAmount:16,vignette:13}},
  {id:'nordic',name:'Nordic blue',category:'Cinéma',description:'Une lumière froide, calme et aérienne.',color:'#8cbbda',settings:{temperature:-25,contrast:-8,saturation:-15,shadows:18,fade:8,highHue:207,highAmount:10}},
  {id:'retro',name:'Super 8',category:'Argentique',description:'Une pellicule chaude aux noirs délavés.',color:'#d2a67d',settings:{temperature:18,contrast:8,saturation:-15,fade:32,grain:40,vignette:35,glow:20}},
  {id:'clean',name:'Clarté',category:'Essentiels',description:'Une image lumineuse et des détails précis.',color:'#d5e6dd',settings:{exposure:.16,contrast:12,highlights:-15,shadows:15,saturation:8,sharpness:30}},
  {id:'moody',name:'Forest mood',category:'Cinéma',description:'Des verts profonds et une lumière feutrée.',color:'#7ca58f',settings:{exposure:-.2,contrast:25,saturation:-18,temperature:-8,shadowHue:155,shadowAmount:16,vignette:30}},
  {id:'rose',name:'Rose quartz',category:'Signature',description:'Une teinte rosée, tendre et lumineuse.',color:'#d99bc1',settings:{exposure:.1,tint:18,contrast:-8,fade:16,highHue:326,highAmount:15,glow:20}},
  {id:'bleach',name:'Silver bypass',category:'Argentique',description:'Des noirs denses et des couleurs retenues.',color:'#b1b7c4',settings:{saturation:-65,contrast:38,temperature:-10,sharpness:20,grain:18}},
  {id:'vivid',name:'Couleurs vives',category:'Essentiels',description:'Des couleurs riches pour vos images du quotidien.',color:'#a5c681',settings:{saturation:28,contrast:12,highlights:-12,shadows:8}},
];

// ---- shared/geometry.mjs
function cropGeometry(width,height,rotation=0,aspect='original'){
  if(rotation%2)[width,height]=[height,width];
  const ratio=aspect==='original'?width/height:aspect.split(':').map(Number).reduce((a,b)=>a/b);
  const sourceRatio=width/height,crop=sourceRatio>ratio?[ratio/sourceRatio,1]:[1,sourceRatio/ratio];
  return {width:Math.max(2,Math.floor(width*crop[0])),height:Math.max(2,Math.floor(height*crop[1])),crop};
}
function exportGeometry(width,height,rotation=0,aspect='original',resolution='1080'){
  const g=cropGeometry(width,height,rotation,aspect);
  if(resolution==='original')return {...g,width:Math.max(2,Math.floor(g.width/2)*2),height:Math.max(2,Math.floor(g.height/2)*2)};
  const p=Number(resolution);if(![720,1080,2160].includes(p))throw Error('Choisissez une résolution 720p, 1080p ou 4K.');
  // A resolution names the short edge, also for non-16:9 footage. Bounding
  // everything to a 16:9 box silently turned ultrawide "1080p" into 810p.
  const scale=p/Math.min(g.width,g.height);
  return {...g,width:Math.max(2,Math.round(g.width*scale/2)*2),height:Math.max(2,Math.round(g.height*scale/2)*2)};
}
function defaultVideoResolution(width,height){
  const equivalent=Math.max(Math.min(width,height),Math.max(width,height)*9/16);
  return String([720,1080,2160].reduce((best,p)=>Math.abs(p-equivalent)<Math.abs(best-equivalent)?p:best));
}

// ---- src/renderer.js


const vertex=`#version 300 es
in vec2 position;
out vec2 uv;
void main(){ uv=position*.5+.5; gl_Position=vec4(position,0,1); }`;
const fragment=`#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 outColor;
uniform sampler2D image;
uniform sampler3D lut;
uniform vec2 resolution;
uniform float lutSize,grain,vignette,glow,sharpness,split,seed,intensity;
uniform int compare,bypass,flipY,rotation;
uniform vec2 crop;
uniform float exposureFactor,contrastFactor,saturationFactor,gammaFactor,temperature,tint,fade,shadowLift,highLift;
uniform vec3 shadowColor,midColor,highColor,lutDomainMin,lutDomainMax;
uniform int lutEnabled;
uniform float brightness,whiteLift,blackLift,vibrance,hueShift,dehaze,clarity,textureAmount,denoise,vignetteMidpoint,vignetteSoftness,vignetteRoundness,glowRadius,grainSize,grainColor;
uniform vec3 channelGains,hslAdjust[8],curveMaster,curveRed,curveGreen,curveBlue;
uniform int hslEnabled,curvesEnabled,flipHorizontal,flipVertical;
const vec2 bandInfo[8]=vec2[8](${hslBands.map(b=>'vec2('+b.hue.toFixed(1)+','+b.radius.toFixed(1)+')').join(',')});
vec3 toHsl(vec3 c){
 c=clamp(c,0.,1.);float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),d=hi-lo,l=(hi+lo)*.5;if(d<.000000001)return vec3(0.,0.,l);
 float h=hi==c.r?(c.g-c.b)/d+(c.g<c.b?6.:0.):hi==c.g?(c.b-c.r)/d+2.:(c.r-c.g)/d+4.;return vec3(h*60.,d/(1.-abs(2.*l-1.)),l);
}
vec3 fromHsl(vec3 hsl){
 float h=mod(mod(hsl.x,360.)+360.,360.),c=(1.-abs(2.*hsl.z-1.))*hsl.y,x=c*(1.-abs(mod(h/60.,2.)-1.)),m=hsl.z-c*.5;
 vec3 a=h<60.?vec3(c,x,0.):h<120.?vec3(x,c,0.):h<180.?vec3(0.,c,x):h<240.?vec3(0.,x,c):h<300.?vec3(x,0.,c):vec3(c,0.,x);return a+m;
}
vec3 mixHsl(vec3 c){
 vec3 hsl=toHsl(c),shift=vec3(0.);float total=0.;
 for(int i=0;i<8;i++){float w=clamp(1.-abs(mod(hsl.x-bandInfo[i].x+540.,360.)-180.)/bandInfo[i].y,0.,1.);w=w*w*(3.-2.*w);total+=w;shift+=hslAdjust[i]*w;}
 shift/=max(total,.00001);return fromHsl(vec3(hsl.x+hueShift+shift.x,clamp(hsl.y*(1.+shift.y/100.),0.,1.),clamp(hsl.z+shift.z*.003,0.,1.)));
}
float toneCurve(float x,vec3 points){
 vec3 y=clamp(vec3(.25,.5,.75)+points*.0025,0.,1.);float t=clamp(x,0.,1.)*4.;
 if(t<1.)return mix(0.,y.x,t);if(t<2.)return mix(y.x,y.y,t-1.);if(t<3.)return mix(y.y,y.z,t-2.);return mix(y.z,1.,t-3.);
}
vec2 sourceUV(vec2 p){
 if(flipHorizontal==1)p.x=1.-p.x;if(flipVertical==1)p.y=1.-p.y;
 p=(p-.5)*crop+.5;
 if(rotation==1)p=vec2(p.y,1.-p.x);
 if(rotation==2)p=1.-p;
 if(rotation==3)p=vec2(1.-p.y,p.x);
 if(flipY==1)p.y=1.-p.y;
 return p;
}
vec3 grade(vec3 original){
 vec3 c=original*exposureFactor+vec3(temperature+tint*.4,-tint,-temperature);
 c=((c+brightness)*channelGains-vec3(.7)*dehaze)/(1.-dehaze);
 float y=dot(c,vec3(.2126,.7152,.0722));
 float l=clamp(y,0.,1.);
 c+=shadowLift*pow(1.-l,2.)+highLift*l*l+blackLift*pow(1.-l,4.)+whiteLift*pow(l,4.);
 c=(c-.5)*contrastFactor+.5;
 if(hslEnabled==1)c=mixHsl(c);
 y=dot(c,vec3(.2126,.7152,.0722));
 float saturation=saturationFactor*(1.+vibrance*(1.-clamp(max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)),0.,1.))*.9);
 c=vec3(y)+(c-y)*saturation;
 l=clamp(y,0.,1.);
 c=pow(clamp(c,0.,1.),vec3(gammaFactor));
 c+=shadowColor*pow(1.-l,2.)+midColor*(1.-abs(l*2.-1.))+highColor*l*l;
 c=clamp(c*(1.-fade)+fade,0.,1.);
 if(curvesEnabled==1)c=vec3(toneCurve(toneCurve(c.r,curveMaster),curveRed),toneCurve(toneCurve(c.g,curveMaster),curveGreen),toneCurve(toneCurve(c.b,curveMaster),curveBlue));
 if(lutEnabled==1){
   vec3 pos=clamp((c-lutDomainMin)/(lutDomainMax-lutDomainMin),0.,1.);
   c=texture(lut,(pos*(lutSize-1.)+.5)/lutSize).rgb;
 }
 return clamp(mix(original,c,intensity),0.,1.);
}
float rand(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+seed)*43758.5453);}
void main(){
 vec2 p=sourceUV(uv);
 vec4 orig=texture(image,p);
 if(bypass==1||(compare==1&&uv.x<split)){outColor=orig;return;}
 vec3 c=grade(orig.rgb);
 vec2 pixel=1./resolution;
 if(sharpness>0.||glow>0.){
   vec3 blur=vec3(0.);
   for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)blur+=grade(texture(image,p+vec2(float(x),float(y))*pixel*(1.+glow*.08)*(.5+glowRadius*.01)).rgb)/9.;
   c+=(c-blur)*sharpness*.014*intensity;
   c=mix(c,1.-(1.-c)*(1.-blur),glow*.004*intensity);
 }
 if(textureAmount!=0.||denoise>0.){
   vec3 fine=(c+grade(texture(image,p+vec2(pixel.x,0.)).rgb)+grade(texture(image,p-vec2(pixel.x,0.)).rgb)+grade(texture(image,p+vec2(0.,pixel.y)).rgb)+grade(texture(image,p-vec2(0.,pixel.y)).rgb))/5.;
   float edge=1.-smoothstep(.02,.18,length(c-fine));c=mix(c,fine,denoise*.006*edge*intensity);c+=(c-fine)*textureAmount*.014*intensity;
 }
 if(clarity!=0.){
   vec3 wide=(grade(texture(image,p+vec2(pixel.x*12.,0.)).rgb)+grade(texture(image,p-vec2(pixel.x*12.,0.)).rgb)+grade(texture(image,p+vec2(0.,pixel.y*12.)).rgb)+grade(texture(image,p-vec2(0.,pixel.y*12.)).rgb))/4.;c+=(c-wide)*clarity*.012*intensity;
 }
 float roundness=exp2((vignetteRoundness-50.)/100.);
 float dist=length((uv-.5)*vec2(roundness,1./roundness)*1.41421356)*exp2((50.-vignetteMidpoint)/50.);
 c*=1.-vignette*.009*pow(clamp(dist,0.,1.),1.7+(50.-vignetteSoftness)*.028)*intensity;
 vec2 noiseUV=uv*resolution;if(grainSize!=50.){float size=exp2((grainSize-50.)/25.);noiseUV=floor(noiseUV/size)*size;}
 vec3 noise=mix(vec3(rand(noiseUV)),vec3(rand(noiseUV),rand(noiseUV+vec2(37.,19.)),rand(noiseUV+vec2(11.,53.))),grainColor*.01);
 c+=(noise-.5)*grain*.0025*intensity;
 outColor=vec4(clamp(c,0.,1.),orig.a);
}`;

class ColorRenderer {
  constructor(canvas) {
    this.canvas=canvas;
    const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,alpha:true,premultipliedAlpha:false,antialias:false});
    if(!gl)throw Error('Votre carte graphique ne prend pas en charge WebGL 2. Mettez à jour son pilote.');
    this.gl=gl;
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    this.program=program;gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    this.uniforms=Object.fromEntries(['image','lut','resolution','lutSize','grain','vignette','glow','sharpness','split','seed','intensity','compare','bypass','flipY','rotation','crop','exposureFactor','contrastFactor','saturationFactor','gammaFactor','temperature','tint','fade','shadowLift','highLift','shadowColor','midColor','highColor','lutDomainMin','lutDomainMax','lutEnabled','brightness','whiteLift','blackLift','vibrance','hueShift','dehaze','channelGains','hslEnabled','hslAdjust','curvesEnabled','curveMaster','curveRed','curveGreen','curveBlue','clarity','textureAmount','denoise','vignetteMidpoint','vignetteSoftness','vignetteRoundness','glowRadius','grainSize','grainColor','flipHorizontal','flipVertical'].map(k=>[k,gl.getUniformLocation(program,k==='hslAdjust'?'hslAdjust[0]':k)]));
    this.imageTex=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.imageTex);
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
    for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);
    this.lutTex=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,this.lutTex);
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.CLAMP_TO_EDGE);
    for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,p,gl.LINEAR);
    gl.uniform1i(this.uniforms.image,0);gl.uniform1i(this.uniforms.lut,1);
    gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA16F,1,1,1,0,gl.RGBA,gl.FLOAT,new Float32Array([0,0,0,1]));
    this.lutSource=null;this.lutUploads=0;
    this.update({});
  }
  update(settings,enabled={},imported=null) {
    this.settings=effectiveSettings(settings,enabled);
    const gl=this.gl,u=this.uniforms,s=this.settings;
    gl.useProgram(this.program);
    const values={exposureFactor:2**s.exposure,contrastFactor:1+s.contrast/100,saturationFactor:1+s.saturation/100,gammaFactor:2**(-s.gamma/100),temperature:s.temperature/350,tint:s.tint/400,fade:s.fade/500,shadowLift:s.shadows/220,highLift:s.highlights/220,intensity:s.intensity/100};
    for(const [key,value] of Object.entries(values))gl.uniform1f(u[key],value);
    for(const [key,value] of Object.entries({brightness:s.brightness*.003,whiteLift:s.whites/200,blackLift:s.blacks/200,vibrance:s.vibrance/100,hueShift:s.hueShift,dehaze:s.dehaze*.0035}))gl.uniform1f(u[key],value);
    gl.uniform3fv(u.channelGains,[s.redGain,s.greenGain,s.blueGain].map(value=>2**(value/100)));
    gl.uniform1i(u.hslEnabled,s.hueShift!==0||Object.keys(s).some(key=>key.startsWith('hsl')&&s[key]!==0)?1:0);
    gl.uniform3fv(u.hslAdjust,hslBands.flatMap(band=>['H','S','L'].map(suffix=>s['hsl'+band.id+suffix])));
    gl.uniform1i(u.curvesEnabled,Object.keys(s).some(key=>key.startsWith('curve')&&s[key]!==0)?1:0);
    for(const channel of curveChannels)gl.uniform3fv(u['curve'+channel],['Low','Mid','High'].map(point=>s['curve'+channel+point]));
    for(const key of ['shadow','mid','high'])gl.uniform3fv(u[key+'Color'],hueRGB(s[key+'Hue']).map(v=>(v-.5)*s[key+'Amount']/220));
    gl.uniform1i(u.lutEnabled,imported&&enabled.lut!==false?1:0);
    gl.uniform1f(u.lutSize,imported?.size||1);
    gl.uniform3fv(u.lutDomainMin,imported?.domainMin||[0,0,0]);gl.uniform3fv(u.lutDomainMax,imported?.domainMax||[1,1,1]);
    if(!imported||this.lutSource===imported.data)return;
    this.lutSource=imported.data;this.lutUploads++;
    gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,this.lutTex);
    // DOM-image uploads use flipped rows, but WebGL forbids that unpack state on 3D LUTs.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    const data=new Float32Array(imported.size**3*4);
    for(let i=0,j=0;i<imported.data.length;i+=3,j+=4){data[j]=imported.data[i];data[j+1]=imported.data[i+1];data[j+2]=imported.data[i+2];data[j+3]=1;}
    gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA16F,imported.size,imported.size,imported.size,0,gl.RGBA,gl.FLOAT,data);
  }
  render(source,width,height,options={}) {
    const gl=this.gl,u=this.uniforms;
    const w=options.width||width,h=options.height||height;
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.viewport(0,0,w,h);gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.imageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,!(source instanceof Uint8Array));
    if(source instanceof Uint8Array)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
    else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    gl.uniform2f(u.resolution,width,height);
    for(const key of ['grain','vignette','glow','sharpness'])gl.uniform1f(u[key],Math.max(0,this.settings[key]));
    for(const key of ['clarity','denoise','vignetteMidpoint','vignetteSoftness','vignetteRoundness','glowRadius','grainSize','grainColor'])gl.uniform1f(u[key],this.settings[key]);
    gl.uniform1f(u.textureAmount,this.settings.texture);gl.uniform1i(u.flipHorizontal,this.settings.flipHorizontal>=.5?1:0);gl.uniform1i(u.flipVertical,this.settings.flipVertical>=.5?1:0);
    gl.uniform1f(u.intensity,this.settings.intensity/100);
    gl.uniform1f(u.seed,options.seed||1);gl.uniform1f(u.split,options.split??.5);
    gl.uniform1i(u.compare,options.compare?1:0);gl.uniform1i(u.bypass,options.bypass?1:0);
    gl.uniform1i(u.flipY,source instanceof Uint8Array?1:0);gl.uniform1i(u.rotation,options.rotation||0);
    gl.uniform2f(u.crop,...(options.crop||[1,1]));
    gl.drawArrays(gl.TRIANGLES,0,6);
  }
  readPixelsTopDown() {
    const {gl,canvas}=this, data=new Uint8Array(canvas.width*canvas.height*4), output=new Uint8Array(data.length),row=canvas.width*4;
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    for(let y=0;y<canvas.height;y++)output.set(data.subarray(y*row,(y+1)*row),(canvas.height-1-y)*row);
    return output;
  }
  dispose(){const gl=this.gl;gl.deleteTexture(this.imageTex);gl.deleteTexture(this.lutTex);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}

function geometry(width,height,rotation=0,aspect='original',max=Infinity) {
  const {crop,width:baseWidth,height:baseHeight}=cropGeometry(width,height,rotation,aspect);
  let w=baseWidth,h=baseHeight;
  const scale=Math.min(1,max/Math.max(w,h));w=Math.max(2,Math.floor(w*scale));h=Math.max(2,Math.floor(h*scale));
  return {width:w,height:h,crop};
}

window.LumiEngine = { ColorRenderer, presets };
})();
