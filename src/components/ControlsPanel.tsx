import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './ui/Icon';
import { NumberField, Select, Slider } from './ui/controls';
import { useActive, useStore, setState, updateActive, type MediaFile, type Tab } from '../state/store';
import * as actions from '../state/actions';
import { defaults, hslBands, curveChannels } from '../lib/color';
import { geometry } from '../lib/geometry';
import { attachHistogram, drawHistogram } from '../engine/engine';

const tabs: [Tab, string, IconName][] = [
  ['light', 'Lumière', 'sun'], ['color', 'Couleur', 'droplets'], ['mixer', 'Mélangeur', 'mixer'], ['curves', 'Courbes', 'curve'],
  ['wheels', 'Colorimétrie', 'paintbrush'], ['lens', 'Détails', 'focus'], ['optics', 'Effets', 'lens'], ['film', 'Pellicule', 'film'], ['crop', 'Cadrage', 'crop'],
];
const titles: Record<Tab, string> = { light: 'Lumière', color: 'Couleur', mixer: 'Mélangeur de couleurs', curves: 'Courbes de tonalité', wheels: 'Colorimétrie', lens: 'Détails & optique', optics: 'Effets d’objectif', film: 'Pellicule & LUT', crop: 'Cadrage' };

function Adjust({ file, k, label, min = -100, max = 100, step = 1, className = '' }: { file: MediaFile; k: string; label: string; min?: number; max?: number; step?: number; className?: string }) {
  const value = file.settings[k] ?? defaults[k];
  return (
    <div className={`slider-control ${k} ${className}`}>
      <label className="slider-label"><span>{label}</span>
        <NumberField min={min} max={max} step={step} value={value} ariaLabel={`Valeur ${label}`} onChange={(v) => { actions.setSetting(k, v); actions.commit(); }} />
      </label>
      <Slider id={`setting-${k}`} min={min} max={max} step={step} value={value} ariaLabel={label} onChange={(v) => actions.setSetting(k, v)} onCommit={actions.commit}
        onReset={() => { actions.setSetting(k, defaults[k]); actions.commit(); }} />
    </div>
  );
}

function Wheels({ file }: { file: MediaFile }) {
  const dragging = useRef(false);
  return (
    <>
      <p className="control-tip">Teintez séparément les ombres, les tons moyens et les hautes lumières.</p>
      {([['shadow', 'Ombres'], ['mid', 'Tons moyens'], ['high', 'Hautes lumières']] as const).map(([key, name]) => {
        const h = file.settings[key + 'Hue'], a = file.settings[key + 'Amount'];
        const move = (event: { clientX: number; clientY: number }, rect: DOMRect) => {
          const x = event.clientX - (rect.left + rect.width / 2), y = rect.top + rect.height / 2 - event.clientY;
          actions.setSettings({ [key + 'Hue']: Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360), [key + 'Amount']: Math.min(100, Math.round((Math.hypot(x, y) / (rect.width * 0.43)) * 100)) });
        };
        return (
          <div className="wheel-row" key={key}>
            <div className="color-wheel" data-wheel={key} tabIndex={0} role="slider" aria-label={`Teinte ${name}`} aria-valuemin={0} aria-valuemax={360} aria-valuenow={h}
              onPointerDown={(event) => {
                event.preventDefault();
                const el = event.currentTarget, rect = el.getBoundingClientRect();
                el.setPointerCapture(event.pointerId); dragging.current = true; move(event, rect);
                const pm = (e: PointerEvent) => move(e, rect);
                const up = () => { el.removeEventListener('pointermove', pm); el.removeEventListener('pointerup', up); dragging.current = false; actions.commit(); };
                el.addEventListener('pointermove', pm); el.addEventListener('pointerup', up);
              }}
              onDoubleClick={() => { actions.setSetting(key + 'Amount', 0); actions.commit(); }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') actions.setSetting(key + 'Hue', (h + (event.key === 'ArrowRight' ? 5 : 355)) % 360);
                else actions.setSetting(key + 'Amount', Math.max(0, Math.min(100, a + (event.key === 'ArrowUp' ? 5 : -5))));
                actions.commit();
              }}>
              <span className="wheel-handle" style={{ left: `${50 + Math.cos((h * Math.PI) / 180) * a * 0.43}%`, top: `${50 - Math.sin((h * Math.PI) / 180) * a * 0.43}%` }} />
            </div>
            <div className="wheel-info">
              <strong>{name}</strong>
              <label>Teinte <NumberField min={0} max={360} value={h} ariaLabel={`Teinte des ${name.toLowerCase()}`} onChange={(v) => { actions.setSetting(key + 'Hue', v); actions.commit(); }} /></label>
              <label>Force <NumberField min={0} max={100} value={a} ariaLabel={`Force des ${name.toLowerCase()}`} onChange={(v) => { actions.setSetting(key + 'Amount', v); actions.commit(); }} /></label>
            </div>
          </div>
        );
      })}
    </>
  );
}

function Curves({ file }: { file: MediaFile }) {
  const channel = useStore((s) => s.curveChannel), plot = useRef<HTMLDivElement>(null);
  const names: Record<string, string> = { Master: 'RVB', Red: 'Rouge', Green: 'Vert', Blue: 'Bleu' };
  const points = (['Low', 'Mid', 'High'] as const).map((point, i) => {
    const key = 'curve' + channel + point, value = file.settings[key], x = (i + 1) * 25, y = 100 - (x + value / 4);
    return { key, value, x, y, i };
  });
  const d = [[0, 100], ...points.map((p) => [p.x, p.y]), [100, 0]].map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join('');
  return (
    <>
      <div className="curve-channels" role="group" aria-label="Canal de la courbe">
        {curveChannels.map((c) => <button key={c} data-curve-channel={c} aria-pressed={c === channel} onClick={() => setState({ curveChannel: c })}>{names[c]}</button>)}
      </div>
      <p className="control-tip">Déplacez les points verticalement. Double-cliquez pour les rétablir.</p>
      <div className="curve-plot" id="curve-plot" ref={plot} style={{ ['--curve-color' as string]: ({ Red: '#df6b76', Green: '#76b68c', Blue: '#729bd7' } as Record<string, string>)[channel] || 'var(--site-accent)' }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="curve-grid" fill="none" d="M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" /><path className="curve-guide" d="M0 100L100 0" /><path className="curve-line" id="curve-line" d={d} />
        </svg>
        {points.map((p) => (
          <button key={p.key} className="curve-handle" data-curve-key={p.key} role="slider" aria-orientation="vertical" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={p.value}
            aria-label={`Courbe ${names[channel]}, ${['basses lumières', 'tons moyens', 'hautes lumières'][p.i]}`} style={{ left: p.x + '%', top: p.y + '%' }}
            onPointerDown={(event) => {
              event.preventDefault(); event.currentTarget.focus();
              const el = event.currentTarget, rect = plot.current!.getBoundingClientRect();
              el.setPointerCapture(event.pointerId);
              const move = (e: { clientY: number }) => actions.setSetting(p.key, Math.max(-100, Math.min(100, Math.round((1 - (e.clientY - rect.top) / rect.height - (p.i + 1) / 4) * 400))));
              move(event);
              const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); actions.commit(); };
              el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
            }}
            onDoubleClick={() => { actions.setSetting(p.key, 0); actions.commit(); }}
            onKeyDown={(event) => {
              if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault(); event.stopPropagation();
              const step = event.shiftKey ? 10 : 1, value = event.key === 'Home' ? -100 : event.key === 'End' ? 100 : p.value + (['ArrowUp', 'ArrowRight'].includes(event.key) ? step : -step);
              actions.setSetting(p.key, Math.max(-100, Math.min(100, value))); actions.commit();
            }} />
        ))}
      </div>
      <Adjust file={file} k={`curve${channel}Low`} label="Basses lumières" />
      <Adjust file={file} k={`curve${channel}Mid`} label="Tons moyens" />
      <Adjust file={file} k={`curve${channel}High`} label="Hautes lumières" />
    </>
  );
}

function OpticsSection({ icon, title, tip, active, children }: { icon: IconName; title: string; tip: string; active: boolean; children: React.ReactNode }) {
  return (
    <section className={'optics-section' + (active ? ' active' : '')}>
      <h4 className="control-section-title"><Icon name={icon} />{title}{active && <small>Actif</small>}</h4>
      <p className="control-tip">{tip}</p>
      {children}
    </section>
  );
}

function Optics({ file }: { file: MediaFile }) {
  const s = file.settings;
  return (
    <>
      <p className="control-tip">Des effets d’objectif inspirés de Magic Bullet Looks, appliqués à l’aperçu et à l’export.</p>
      <OpticsSection icon="haze" title="Haze / Flare" tip="Un voile lumineux venu d’une source hors champ : il adoucit le contraste et colore la lumière." active={s.hazeAmount > 0}>
        <Adjust file={file} k="hazeAmount" label="Intensité du voile" min={0} max={100} />
        <Adjust file={file} k="hazeSize" label="Étendue" min={0} max={100} />
        <Adjust file={file} k="hazeHue" label="Teinte du voile" min={0} max={360} className="hue" />
        <Adjust file={file} k="hazeX" label="Position horizontale" min={0} max={100} />
        <Adjust file={file} k="hazeY" label="Position verticale" min={0} max={100} />
      </OpticsSection>
      <div className="control-divider" />
      <OpticsSection icon="flare" title="Flare anamorphique" tip="Des traînées horizontales naissent des hautes lumières, comme avec un objectif anamorphique." active={s.flareAmount > 0}>
        <Adjust file={file} k="flareAmount" label="Intensité du flare" min={0} max={100} />
        <Adjust file={file} k="flareThreshold" label="Seuil des hautes lumières" min={0} max={100} />
        <Adjust file={file} k="flareLength" label="Longueur des traînées" min={0} max={100} />
        <Adjust file={file} k="flareHue" label="Teinte du flare" min={0} max={360} className="hue" />
      </OpticsSection>
      <div className="control-divider" />
      <OpticsSection icon="aberration" title="Aberration chromatique" tip="Décale les canaux rouge et bleu vers les bords de l’image. Les valeurs négatives inversent les franges." active={s.aberration !== 0}>
        <Adjust file={file} k="aberration" label="Aberration" />
      </OpticsSection>
      <div className="control-divider" />
      <OpticsSection icon="distortion" title="Distorsion de l’objectif" tip="Positif : barillet (image bombée), recadré automatiquement. Négatif : coussinet." active={s.distortion !== 0}>
        <Adjust file={file} k="distortion" label="Distorsion" />
      </OpticsSection>
      <div className="control-divider" />
      <OpticsSection icon="diffusion" title="Diffusion optique" tip="Un halo doux autour des hautes lumières, façon filtre Pro-Mist : peau adoucie, contraste plus tendre." active={s.diffusionAmount > 0}>
        <Adjust file={file} k="diffusionAmount" label="Intensité de la diffusion" min={0} max={100} />
        <Adjust file={file} k="diffusionSize" label="Taille du halo" min={0} max={100} />
        <Adjust file={file} k="diffusionThreshold" label="Hautes lumières seulement" min={0} max={100} />
      </OpticsSection>
    </>
  );
}

function Crop({ file }: { file: MediaFile }) {
  const g = file.width ? geometry(file.width, file.height, file.rotation, file.aspect) : null;
  return (
    <>
      <label className="select-control">Format
        <Select id="aspect" ariaLabel="Format du cadrage" value={file.aspect} onChange={(v) => { updateActive({ aspect: v as MediaFile['aspect'] }); actions.commit(); }}
          options={[['original', 'Format original'], ['16:9', 'Paysage · 16:9'], ['9:16', 'Vertical · 9:16'], ['1:1', 'Carré · 1:1'], ['4:5', 'Portrait · 4:5'], ['4:3', 'Photo · 4:3']].map(([value, label]) => ({ value, label }))} />
      </label>
      <div className="rotation-controls">
        <button className="button secondary" id="rotate-left" onClick={() => actions.rotate(-1)}><Icon name="rotate-ccw" /> −90°</button>
        <button className="button secondary" id="rotate-right" onClick={() => actions.rotate(1)}><Icon name="rotate-cw" /> +90°</button>
      </div>
      <div className="flip-controls">
        <button className="button secondary" id="flip-horizontal" aria-pressed={file.settings.flipHorizontal >= 0.5} onClick={() => { actions.setSetting('flipHorizontal', file.settings.flipHorizontal >= 0.5 ? 0 : 1); actions.commit(); }}><Icon name="flip-horizontal" /> Miroir H</button>
        <button className="button secondary" id="flip-vertical" aria-pressed={file.settings.flipVertical >= 0.5} onClick={() => { actions.setSetting('flipVertical', file.settings.flipVertical >= 0.5 ? 0 : 1); actions.commit(); }}><Icon name="flip-vertical" /> Miroir V</button>
      </div>
      <p className="control-tip">Le recadrage conserve les proportions. Le zoom de consultation ne modifie pas le fichier exporté.</p>
      {g && <div className="effect-explainer" id="crop-size">Sortie : {g.width} × {g.height} px · Rotation : {file.rotation * 90}°</div>}
    </>
  );
}

function Histogram() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { attachHistogram(ref.current); drawHistogram(); return () => attachHistogram(null); }, []);
  return (
    <section className="histogram-panel">
      <div><span>HISTOGRAMME RVB</span><span className="live-dot" /></div>
      <canvas id="histogram" ref={ref} width={560} height={130} role="img" aria-label="Histogramme des couleurs de l’image" />
      <div className="histogram-scale"><span>0</span><span>64</span><span>128</span><span>192</span><span>255</span></div>
    </section>
  );
}

export function ControlsPanel() {
  const file = useActive(), tab = useStore((s) => s.tab), collapsed = useStore((s) => s.rightCollapsed), hslBand = useStore((s) => s.hslBand);
  if (collapsed) return (
    <aside className="controls-panel collapsed" aria-label="Réglages (réduit)">
      <button className="icon-button rail-toggle" id="expand-right" aria-label="Afficher les réglages" title="Afficher les réglages" onClick={actions.toggleRight}><Icon name="expand-right" /></button>
      <span className="rail-label">Réglages</span>
    </aside>
  );
  if (!file) return null;
  const title = titles[tab], band = hslBands.find((b) => b.id === hslBand) || hslBands[0];
  return (
    <aside className="controls-panel" aria-label="Réglages">
      <div className="controls-heading">
        <button className="icon-button" id="collapse-right" aria-label="Réduire le panneau des réglages" title="Réduire le panneau des réglages" onClick={actions.toggleRight}><Icon name="collapse-right" /></button>
        <div><h2>Réglages</h2></div>
        <button className="icon-button" id="reset" aria-label="Réinitialiser tous les réglages" title="Réinitialiser les réglages" onClick={actions.resetAll}><Icon name="reset" /></button>
      </div>
      <div className="intensity-control">
        <label htmlFor="intensity">Intensité du look <output id="intensity-value">{file.settings.intensity} <span>%</span></output></label>
        <Slider id="intensity" min={0} max={100} value={file.settings.intensity} ariaLabel="Intensité du look" onChange={actions.setIntensity} onCommit={actions.commit} onReset={() => { actions.setIntensity(100); actions.commit(); }} />
      </div>
      <div className="control-tabs" role="group" aria-label="Outils de réglage">
        {tabs.map(([key, label, icon]) => (
          <button key={key} className={tab === key ? 'active' : ''} data-tab={key} aria-pressed={tab === key} aria-label={label} title={label} onClick={() => actions.activateTab(key)}>
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="controls-scroll" id="controls-scroll">
        <div className="panel-title"><h3>{title}</h3><button id="reset-panel" title="Réinitialiser cet outil" aria-label={`Réinitialiser ${title}`} onClick={() => actions.resetPanel(tab)}><Icon name="reset" /></button></div>
        {tab === 'light' && <>
          <div className="panel-tools"><button className="button secondary" id="auto-exposure" onClick={() => actions.autoAdjust('exposure')}><Icon name="sun" />Exposition auto</button></div>
          <Adjust file={file} k="exposure" label="Exposition" min={-4} max={4} step={0.01} />
          <Adjust file={file} k="brightness" label="Luminosité" /><Adjust file={file} k="contrast" label="Contraste" />
          <Adjust file={file} k="highlights" label="Hautes lumières" /><Adjust file={file} k="shadows" label="Ombres" />
          <Adjust file={file} k="whites" label="Blancs" /><Adjust file={file} k="blacks" label="Noirs" />
          <Adjust file={file} k="gamma" label="Tons moyens" /><Adjust file={file} k="fade" label="Noirs délavés" min={0} max={100} />
        </>}
        {tab === 'color' && <>
          <div className="panel-tools"><button className="button secondary" id="auto-balance" onClick={() => actions.autoAdjust('balance')}><Icon name="thermometer" />Balance auto</button></div>
          <Adjust file={file} k="temperature" label="Température" /><Adjust file={file} k="tint" label="Teinte" />
          <Adjust file={file} k="vibrance" label="Vibrance" /><Adjust file={file} k="saturation" label="Saturation" />
          <Adjust file={file} k="hueShift" label="Rotation de teinte" min={-180} max={180} /><Adjust file={file} k="dehaze" label="Correction du voile" />
          <div className="control-divider" /><p className="control-tip">Balance des canaux</p>
          <Adjust file={file} k="redGain" label="Gain rouge" /><Adjust file={file} k="greenGain" label="Gain vert" /><Adjust file={file} k="blueGain" label="Gain bleu" />
        </>}
        {tab === 'mixer' && <>
          <p className="control-tip">Ajustez une plage de couleur sans modifier les autres.</p>
          <div className="hsl-bands" role="group" aria-label="Plages de couleur">
            {hslBands.map((b) => <button key={b.id} className="hsl-band" data-hsl-band={b.id} style={{ ['--swatch' as string]: b.color }} aria-label={b.name} title={b.name} aria-pressed={band.id === b.id} onClick={() => setState({ hslBand: b.id })} />)}
          </div>
          <p className="control-tip">{band.name}</p>
          <Adjust file={file} k={`hsl${band.id}H`} label={`Teinte des ${band.name.toLowerCase()}`} min={-45} max={45} />
          <Adjust file={file} k={`hsl${band.id}S`} label={`Saturation des ${band.name.toLowerCase()}`} />
          <Adjust file={file} k={`hsl${band.id}L`} label={`Luminance des ${band.name.toLowerCase()}`} />
        </>}
        {tab === 'curves' && <Curves file={file} />}
        {tab === 'wheels' && <Wheels file={file} />}
        {tab === 'lens' && <>
          <Adjust file={file} k="sharpness" label="Netteté" min={0} max={100} /><Adjust file={file} k="clarity" label="Clarté" />
          <Adjust file={file} k="texture" label="Texture" /><Adjust file={file} k="denoise" label="Réduction du bruit" min={0} max={100} />
          <div className="control-divider" />
          <Adjust file={file} k="glow" label="Diffusion lumineuse" min={0} max={100} /><Adjust file={file} k="glowRadius" label="Rayon de diffusion" min={0} max={100} />
          <div className="control-divider" />
          <Adjust file={file} k="vignette" label="Vignettage" min={0} max={100} /><Adjust file={file} k="vignetteMidpoint" label="Taille du vignettage" min={0} max={100} />
          <Adjust file={file} k="vignetteSoftness" label="Progressivité" min={0} max={100} /><Adjust file={file} k="vignetteRoundness" label="Forme du vignettage" min={0} max={100} />
          <p className="control-tip">La réduction du bruit lisse les zones uniformes en préservant les contours marqués.</p>
        </>}
        {tab === 'optics' && <Optics file={file} />}
        {tab === 'film' && <>
          <Adjust file={file} k="grain" label="Grain de pellicule" min={0} max={100} /><Adjust file={file} k="grainSize" label="Taille du grain" min={0} max={100} />
          <Adjust file={file} k="grainColor" label="Couleur du grain" min={0} max={100} />
          <div className="control-divider" />
          {file.lut ? (
            <div className="lut-name"><Icon name="file-image" /><span>{file.lutName}</span><button className="icon-button" id="remove-lut" aria-label="Retirer la LUT" onClick={actions.removeLut}><Icon name="x" /></button></div>
          ) : (
            <div className="lut-box"><Icon name="upload" /><strong>LUT 3D ou correction</strong><p>Importez un fichier .cube ou .lumilook. Un .cube exporté par LumiLooks restaure tous vos réglages.</p>
              <button className="button secondary" onClick={() => actions.attempt(actions.importCorrection)}><Icon name="upload" /> Importer…</button></div>
          )}
        </>}
        {tab === 'crop' && <Crop file={file} />}
      </div>
      <Histogram />
    </aside>
  );
}
