/*
 * WebGL 2 color renderer, multi-pass:
 *   1. grade     – lens distortion + chromatic aberration sampling, color grade, detail (sharpness, clarity, texture, denoise, glow)
 *   2. diffusion – soft-threshold prefilter and a dual-filter blur pyramid (optical diffusion / Pro-Mist)
 *   3. streak    – thresholded highlights stretched horizontally (anamorphic flare)
 *   4. composite – diffusion, anamorphic flare, haze/flare light, vignette and film grain
 * The same class renders the preview, the look thumbnails and every exported photo / video frame.
 */
import { effectiveSettings, hueRGB, hslBands, curveChannels, type Enabled, type Lut, type Settings } from './color';
export { geometry } from './geometry';

const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main(){ uv=position*.5+.5; gl_Position=vec4(position,0,1); }`;

const gradeFragment = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 outColor;
uniform sampler2D image;
uniform sampler3D lut;
uniform vec2 resolution;
uniform float lutSize,glow,sharpness,split,intensity;
uniform int compare,bypass,flipY,rotation;
uniform vec2 crop;
uniform float exposureFactor,contrastFactor,saturationFactor,gammaFactor,temperature,tint,fade,shadowLift,highLift;
uniform vec3 shadowColor,midColor,highColor,lutDomainMin,lutDomainMax;
uniform int lutEnabled;
uniform float brightness,whiteLift,blackLift,vibrance,hueShift,dehaze,clarity,textureAmount,denoise,glowRadius;
uniform vec3 channelGains,hslAdjust[8],curveMaster,curveRed,curveGreen,curveBlue;
uniform int hslEnabled,curvesEnabled,flipHorizontal,flipVertical;
uniform float distortion,aberration,frameAspect;
const vec2 bandInfo[8]=vec2[8](${hslBands.map((b) => 'vec2(' + b.hue.toFixed(1) + ',' + b.radius.toFixed(1) + ')').join(',')});
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
// Radial lens distortion in the output frame. k>0: barrel (bulging), k<0: pincushion. Barrel zooms in so no border appears.
vec2 lensUV(vec2 q){
 if(distortion==0.)return q;
 vec2 corner=vec2(frameAspect*.5,.5),d=(q-.5)*vec2(frameAspect,1.);
 float r2=dot(d,d)/dot(corner,corner),fill=distortion>0.?1./(1.+distortion):1.;
 d*=(1.+distortion*r2)*fill;
 return d/vec2(frameAspect,1.)+.5;
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
void main(){
 vec4 orig=texture(image,sourceUV(uv));
 if(bypass==1||(compare==1&&uv.x<split)){outColor=orig;return;}
 vec2 q=lensUV(uv),p=sourceUV(q);
 vec4 src=texture(image,p);
 if(aberration!=0.){
   vec2 dir=(q-.5)/(1.+abs(aberration));
   src.r=texture(image,sourceUV(.5+dir*(1.+aberration))).r;
   src.g=texture(image,sourceUV(.5+dir)).g;
   src.b=texture(image,sourceUV(.5+dir*(1.-aberration))).b;
 }
 vec3 c=grade(src.rgb);
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
 outColor=vec4(clamp(c,0.,1.),orig.a);
}`;

// Soft-knee highlight extraction with a 4-tap box downsample.
const prefilterFragment = `#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;
uniform sampler2D tex;uniform vec2 texel;uniform float threshold,knee;uniform int desaturate;
void main(){
 vec3 s=(texture(tex,uv+texel*vec2(-.5,-.5)).rgb+texture(tex,uv+texel*vec2(.5,-.5)).rgb+texture(tex,uv+texel*vec2(-.5,.5)).rgb+texture(tex,uv+texel*vec2(.5,.5)).rgb)*.25;
 float br=max(s.r,max(s.g,s.b));
 vec3 c;
 if(desaturate==1){
   // Anamorphic streaks: only the brightest points, with a steep (squared) response.
   float x=max(0.,br-threshold)/max(.0001,1.-threshold);
   c=s*(x*x)/max(br,.00001);
   c=mix(c,vec3(dot(c,vec3(.2126,.7152,.0722))),.65);
 }else{
   float soft=clamp(br-threshold+knee,0.,2.*knee);soft=soft*soft/(4.*knee+.00001);
   c=s*max(soft,br-threshold)/max(br,.00001);
 }
 outColor=vec4(c,1.);
}`;
const downFragment = `#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;uniform sampler2D tex;uniform vec2 texel;
void main(){
 vec3 sum=texture(tex,uv).rgb*4.;
 sum+=texture(tex,uv-texel).rgb+texture(tex,uv+texel).rgb+texture(tex,uv+vec2(texel.x,-texel.y)).rgb+texture(tex,uv-vec2(texel.x,-texel.y)).rgb;
 outColor=vec4(sum/8.,1.);
}`;
const upFragment = `#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;uniform sampler2D tex;uniform vec2 texel;
void main(){
 vec2 h=texel;
 vec3 sum=texture(tex,uv+vec2(-h.x*2.,0.)).rgb+texture(tex,uv+vec2(-h.x,h.y)).rgb*2.+texture(tex,uv+vec2(0.,h.y*2.)).rgb+texture(tex,uv+vec2(h.x,h.y)).rgb*2.
   +texture(tex,uv+vec2(h.x*2.,0.)).rgb+texture(tex,uv+vec2(h.x,-h.y)).rgb*2.+texture(tex,uv+vec2(0.,-h.y*2.)).rgb+texture(tex,uv+vec2(-h.x,-h.y)).rgb*2.;
 outColor=vec4(sum/12.,1.);
}`;
const streakFragment = `#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;uniform sampler2D tex;uniform vec2 texel;uniform float stepSize,falloff;
void main(){
 vec3 sum=vec3(0.);float total=0.;
 for(int i=-7;i<=7;i++){float w=exp(-abs(float(i))*falloff);sum+=texture(tex,uv+vec2(float(i)*stepSize*texel.x,0.)).rgb*w;total+=w;}
 outColor=vec4(sum/total*1.6,1.);
}`;
const compositeFragment = `#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;
uniform sampler2D baseTex,bloomTex,streakTex;
uniform vec2 resolution;
uniform float intensity,split,seed,frameAspect;
uniform int compare,bypass,bloomOn,streakOn;
uniform float vignette,vignetteMidpoint,vignetteSoftness,vignetteRoundness,grain,grainSize,grainColor;
uniform float diffusionAmount,flareAmount,hazeAmount,hazeSize;
uniform vec2 hazePos;uniform vec3 hazeColor,flareColor;
float rand(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+seed)*43758.5453);}
void main(){
 vec4 base=texture(baseTex,uv);vec3 c=base.rgb;
 if(bypass==1||(compare==1&&uv.x<split)){outColor=base;return;}
 if(bloomOn==1&&diffusionAmount>0.){
   vec3 d=texture(bloomTex,uv).rgb;
   c=1.-(1.-c)*(1.-clamp(d*diffusionAmount*3.2,0.,1.));
   c=mix(c,mix(c,d+c*.6,.5),diffusionAmount*.3);
 }
 if(streakOn==1&&flareAmount>0.){
   vec3 s=texture(streakTex,uv).rgb;
   c+=s*flareColor*flareAmount*1.5;
 }
 if(hazeAmount>0.){
   vec2 d=(uv-hazePos)*vec2(frameAspect,1.);
   float g=exp(-dot(d,d)/(hazeSize*hazeSize));
   float veil=hazeAmount*(.1+.45*g);
   c=mix(c,c*(1.-veil)+hazeColor*veil,.85);
   c=1.-(1.-c)*(1.-hazeColor*g*hazeAmount*1.15);
 }
 float roundness=exp2((vignetteRoundness-50.)/100.);
 float dist=length((uv-.5)*vec2(roundness,1./roundness)*1.41421356)*exp2((50.-vignetteMidpoint)/50.);
 c*=1.-vignette*.009*pow(clamp(dist,0.,1.),1.7+(50.-vignetteSoftness)*.028)*intensity;
 vec2 noiseUV=uv*resolution;if(grainSize!=50.){float size=exp2((grainSize-50.)/25.);noiseUV=floor(noiseUV/size)*size;}
 vec3 noise=mix(vec3(rand(noiseUV)),vec3(rand(noiseUV),rand(noiseUV+vec2(37.,19.)),rand(noiseUV+vec2(11.,53.))),grainColor*.01);
 c+=(noise-.5)*grain*.0025*intensity;
 outColor=vec4(clamp(c,0.,1.),base.a);
}`;

type Source = TexImageSource | Uint8Array;
interface Program { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation> }
interface Target { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
export interface RenderOptions {
  width?: number; height?: number; rotation?: number; compare?: boolean; bypass?: boolean; split?: number; seed?: number; crop?: [number, number];
}

export class ColorRenderer {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGL2RenderingContext;
  settings: Settings = effectiveSettings({});
  private programs: Record<'grade' | 'prefilter' | 'down' | 'up' | 'streak' | 'composite', Program>;
  private imageTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutSource: unknown = null;
  private targets = new Map<string, Target>();
  private vao: WebGLVertexArrayObject;
  lutUploads = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw Error('Votre carte graphique ne prend pas en charge WebGL 2. Mettez à jour son pilote.');
    this.gl = gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.vao = vao;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.programs = {
      grade: this.compile(gradeFragment), prefilter: this.compile(prefilterFragment), down: this.compile(downFragment),
      up: this.compile(upFragment), streak: this.compile(streakFragment), composite: this.compile(compositeFragment),
    };
    this.imageTex = this.texture2D();
    this.lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, 1, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([0, 0, 0, 1]));
    const g = this.programs.grade;
    gl.useProgram(g.program);
    gl.uniform1i(g.uniforms.image, 0);
    gl.uniform1i(g.uniforms.lut, 1);
    this.update({});
  }

  get maxSize() { return Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE), this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE)) as number; }

  private compile(fragment: string): Program {
    const gl = this.gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) || 'Shader invalide.');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || 'Programme invalide.');
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uniforms: Record<string, WebGLUniformLocation> = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)!;
      uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name)!;
    }
    return { program, uniforms };
  }

  private texture2D() {
    const gl = this.gl, tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    return tex;
  }

  private target(name: string, width: number, height: number): Target {
    const gl = this.gl;
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    const existing = this.targets.get(name);
    if (existing && existing.width === width && existing.height === height) return existing;
    if (existing) { gl.deleteTexture(existing.texture); gl.deleteFramebuffer(existing.framebuffer); }
    const texture = this.texture2D();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const t = { texture, framebuffer, width, height };
    this.targets.set(name, t);
    return t;
  }

  private draw(program: Program, target: Target | null, inputs: Record<string, WebGLTexture>, set: (u: Record<string, WebGLUniformLocation>) => void) {
    const gl = this.gl;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, target ? target.width : this.canvas.width, target ? target.height : this.canvas.height);
    let unit = 2;
    for (const [name, texture] of Object.entries(inputs)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(program.uniforms[name], unit);
      unit++;
    }
    set(program.uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  update(settings: Partial<Settings>, enabled: Partial<Enabled> = {}, imported: Lut | null = null) {
    this.settings = effectiveSettings(settings, enabled);
    const gl = this.gl, { program, uniforms: u } = this.programs.grade, s = this.settings;
    gl.useProgram(program);
    const values: Record<string, number> = {
      exposureFactor: 2 ** s.exposure, contrastFactor: 1 + s.contrast / 100, saturationFactor: 1 + s.saturation / 100, gammaFactor: 2 ** (-s.gamma / 100),
      temperature: s.temperature / 350, tint: s.tint / 400, fade: s.fade / 500, shadowLift: s.shadows / 220, highLift: s.highlights / 220, intensity: s.intensity / 100,
      brightness: s.brightness * 0.003, whiteLift: s.whites / 200, blackLift: s.blacks / 200, vibrance: s.vibrance / 100, hueShift: s.hueShift, dehaze: s.dehaze * 0.0035,
    };
    for (const [key, value] of Object.entries(values)) if (u[key]) gl.uniform1f(u[key], value);
    gl.uniform3fv(u.channelGains, [s.redGain, s.greenGain, s.blueGain].map((value) => 2 ** (value / 100)));
    gl.uniform1i(u.hslEnabled, s.hueShift !== 0 || Object.keys(s).some((key) => key.startsWith('hsl') && s[key] !== 0) ? 1 : 0);
    gl.uniform3fv(u.hslAdjust, hslBands.flatMap((band) => ['H', 'S', 'L'].map((suffix) => s['hsl' + band.id + suffix])));
    gl.uniform1i(u.curvesEnabled, Object.keys(s).some((key) => key.startsWith('curve') && s[key] !== 0) ? 1 : 0);
    for (const channel of curveChannels) gl.uniform3fv(u['curve' + channel], ['Low', 'Mid', 'High'].map((point) => s['curve' + channel + point]));
    for (const key of ['shadow', 'mid', 'high']) gl.uniform3fv(u[key + 'Color'], hueRGB(s[key + 'Hue']).map((v) => ((v - 0.5) * s[key + 'Amount']) / 220));
    const useLut = !!imported && enabled.lut !== false;
    gl.uniform1i(u.lutEnabled, useLut ? 1 : 0);
    gl.uniform1f(u.lutSize, imported?.size || 1);
    gl.uniform3fv(u.lutDomainMin, imported?.domainMin || [0, 0, 0]);
    gl.uniform3fv(u.lutDomainMax, imported?.domainMax || [1, 1, 1]);
    if (!imported || this.lutSource === imported.data) return;
    this.lutSource = imported.data; this.lutUploads++;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    // DOM-image uploads use flipped rows, but WebGL forbids that unpack state on 3D textures.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const data = new Float32Array(imported.size ** 3 * 4);
    for (let i = 0, j = 0; i < imported.data.length; i += 3, j += 4) { data[j] = imported.data[i] as number; data[j + 1] = imported.data[i + 1] as number; data[j + 2] = imported.data[i + 2] as number; data[j + 3] = 1; }
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, imported.size, imported.size, imported.size, 0, gl.RGBA, gl.FLOAT, data);
  }

  /** True when the current settings use an effect that needs the extra passes. */
  get usesOptics() {
    const s = this.settings;
    return s.diffusionAmount > 0 || s.flareAmount > 0 || s.hazeAmount > 0 || s.aberration !== 0 || s.distortion !== 0;
  }

  render(source: Source, width: number, height: number, options: RenderOptions = {}) {
    const gl = this.gl, s = this.settings;
    const w = Math.max(1, Math.round(options.width || width)), h = Math.max(1, Math.round(options.height || height));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const amount = s.intensity / 100, frameAspect = w / h;
    gl.disable(gl.BLEND);

    // Source upload
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    const raw = source instanceof Uint8Array;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !raw);
    if (raw) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // 1. Grade
    const base = this.target('base', w, h);
    this.draw(this.programs.grade, base, {}, (u) => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.imageTex); gl.uniform1i(u.image, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.lutTex); gl.uniform1i(u.lut, 1);
      gl.uniform2f(u.resolution, width, height);
      gl.uniform1f(u.glow, Math.max(0, s.glow)); gl.uniform1f(u.sharpness, Math.max(0, s.sharpness));
      for (const key of ['clarity', 'denoise', 'glowRadius']) gl.uniform1f(u[key], s[key]);
      gl.uniform1f(u.textureAmount, s.texture);
      gl.uniform1i(u.flipHorizontal, s.flipHorizontal >= 0.5 ? 1 : 0); gl.uniform1i(u.flipVertical, s.flipVertical >= 0.5 ? 1 : 0);
      gl.uniform1f(u.intensity, amount);
      gl.uniform1f(u.split, options.split ?? 0.5);
      gl.uniform1i(u.compare, options.compare ? 1 : 0); gl.uniform1i(u.bypass, options.bypass ? 1 : 0);
      gl.uniform1i(u.flipY, raw ? 1 : 0); gl.uniform1i(u.rotation, options.rotation || 0);
      gl.uniform2f(u.crop, ...(options.crop || [1, 1]));
      gl.uniform1f(u.distortion, (s.distortion / 100) * 0.45 * amount);
      gl.uniform1f(u.aberration, (s.aberration / 100) * 0.012 * amount);
      gl.uniform1f(u.frameAspect, frameAspect);
    });

    // 2. Optical diffusion pyramid
    const diffusion = s.diffusionAmount > 0 && amount > 0;
    let bloom: Target | null = null;
    if (diffusion) {
      const levels = 2 + Math.round((s.diffusionSize / 100) * 5);
      const chain: Target[] = [this.target('bloom0', w / 2, h / 2)];
      const threshold = 0.25 + (s.diffusionThreshold / 100) * 0.7;
      this.draw(this.programs.prefilter, chain[0], { tex: base.texture }, (u) => {
        gl.uniform2f(u.texel, 1 / w, 1 / h); gl.uniform1f(u.threshold, threshold); gl.uniform1f(u.knee, 0.25); gl.uniform1i(u.desaturate, 0);
      });
      for (let i = 1; i < levels; i++) {
        const prev = chain[i - 1];
        if (prev.width < 6 || prev.height < 6) break;
        const next = this.target('bloom' + i, prev.width / 2, prev.height / 2);
        this.draw(this.programs.down, next, { tex: prev.texture }, (u) => gl.uniform2f(u.texel, 0.5 / prev.width, 0.5 / prev.height));
        chain.push(next);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, 0.62);
      for (let i = chain.length - 1; i > 0; i--) {
        const from = chain[i], to = chain[i - 1];
        this.draw(this.programs.up, to, { tex: from.texture }, (u) => gl.uniform2f(u.texel, 0.5 / from.width, 0.5 / from.height));
      }
      gl.disable(gl.BLEND);
      bloom = chain[0];
    }

    // 3. Anamorphic streaks
    const flare = s.flareAmount > 0 && amount > 0;
    let streak: Target | null = null;
    if (flare) {
      const sw = Math.max(8, w / 6), sh = Math.max(4, h / 4);
      let a = this.target('streakA', sw, sh), b = this.target('streakB', sw, sh);
      this.draw(this.programs.prefilter, a, { tex: base.texture }, (u) => {
        gl.uniform2f(u.texel, 1 / w, 1 / h); gl.uniform1f(u.threshold, 0.6 + (s.flareThreshold / 100) * 0.38); gl.uniform1f(u.knee, 0.1); gl.uniform1i(u.desaturate, 1);
      });
      const passes = s.flareLength > 66 ? 4 : s.flareLength > 25 ? 3 : 2, falloff = 0.55 - (s.flareLength / 100) * 0.4;
      for (let i = 0; i < passes; i++) {
        const source = a;
        this.draw(this.programs.streak, b, { tex: source.texture }, (u) => {
          gl.uniform2f(u.texel, 1 / sw, 1 / sh); gl.uniform1f(u.stepSize, 3 ** i); gl.uniform1f(u.falloff, falloff);
        });
        [a, b] = [b, a];
      }
      streak = a;
    }

    // 4. Composite
    const hue = (value: number, keep: number) => hueRGB(value).map((v) => keep + v * (1 - keep));
    this.draw(this.programs.composite, null, { baseTex: base.texture, bloomTex: (bloom || base).texture, streakTex: (streak || base).texture }, (u) => {
      gl.uniform2f(u.resolution, width, height);
      gl.uniform1f(u.intensity, amount); gl.uniform1f(u.split, options.split ?? 0.5); gl.uniform1f(u.seed, options.seed || 1); gl.uniform1f(u.frameAspect, frameAspect);
      gl.uniform1i(u.compare, options.compare ? 1 : 0); gl.uniform1i(u.bypass, options.bypass ? 1 : 0);
      gl.uniform1i(u.bloomOn, bloom ? 1 : 0); gl.uniform1i(u.streakOn, streak ? 1 : 0);
      for (const key of ['vignetteMidpoint', 'vignetteSoftness', 'vignetteRoundness', 'grainSize', 'grainColor']) gl.uniform1f(u[key], s[key]);
      gl.uniform1f(u.vignette, Math.max(0, s.vignette)); gl.uniform1f(u.grain, Math.max(0, s.grain));
      gl.uniform1f(u.diffusionAmount, (s.diffusionAmount / 100) * amount);
      gl.uniform1f(u.flareAmount, (s.flareAmount / 100) * amount);
      gl.uniform3fv(u.flareColor, hue(s.flareHue, 0.25));
      gl.uniform1f(u.hazeAmount, (s.hazeAmount / 100) * amount);
      gl.uniform1f(u.hazeSize, 0.15 + (s.hazeSize / 100) * 1.1);
      gl.uniform2f(u.hazePos, s.hazeX / 100 * 1.4 - 0.2, 1 - (s.hazeY / 100 * 1.4 - 0.2));
      gl.uniform3fv(u.hazeColor, hue(s.hazeHue, 0.35));
    });
  }

  readPixelsTopDown() {
    const { gl, canvas } = this, data = new Uint8Array(canvas.width * canvas.height * 4), output = new Uint8Array(data.length), row = canvas.width * 4;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    for (let y = 0; y < canvas.height; y++) output.set(data.subarray(y * row, (y + 1) * row), (canvas.height - 1 - y) * row);
    return output;
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.targets.values()) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer); }
    this.targets.clear();
    gl.deleteTexture(this.imageTex); gl.deleteTexture(this.lutTex);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
