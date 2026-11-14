import { useRef } from 'react';
import { Icon } from './ui/Icon';
import { Check, Disclosure, NumberField, Select, Slider } from './ui/controls';
import { useActive, useStore, updateActive } from '../state/store';
import * as actions from '../state/actions';
import * as engine from '../engine/engine';
import { clipTime } from './time';

export function Timeline() {
  const f = useActive(), time = useStore((s) => s.time), filmstrip = useStore((s) => (f ? s.filmstrips[f.id] : undefined)), thumb = useStore((s) => (f ? s.fileThumbs[f.id] : undefined));
  const track = useRef<HTMLDivElement>(null);
  if (!f || f.type !== 'video') return null;
  const left = (f.start / f.duration) * 100, right = (f.end / f.duration) * 100;
  const frames = filmstrip || (thumb ? Array(10).fill(thumb) : []);
  const handle = (key: 'start' | 'end') => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault(); engine.videoOf(f)?.pause();
      const el = event.currentTarget, rect = track.current!.getBoundingClientRect();
      el.setPointerCapture(event.pointerId); el.classList.add('dragging');
      const move = (e: PointerEvent) => actions.trim(key, Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * f.duration, false);
      const done = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); el.classList.remove('dragging'); actions.commit(); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); engine.videoOf(f)?.pause();
      const value = event.key === 'Home' ? 0 : event.key === 'End' ? f.duration : f[key] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 1 / 30);
      actions.trim(key, value, true);
    },
  });
  const fps = Math.max(1, Number(f.video?.fps) || 30);
  return (
    <section className="timeline" id="timeline" aria-label="Découpe de la vidéo">
      <div className="timeline-top">
        <span><Icon name="scissors" /> Cliquez pour naviguer · Poignées pour couper</span>
        <span id="trim-duration">{((f.end - f.start) / f.speed).toFixed(2)} s conservées</span>
        <Disclosure id="trim-precise" label="Réglage précis">
          <label>Entrée <NumberField id="trim-start" min={0} max={Math.max(0, f.end - 0.01)} step={0.01} decimals={2} value={f.start} ariaLabel="Point d’entrée en secondes" onChange={(v) => actions.trim('start', v)} /> s</label>
          <button className="icon-button" id="set-in" aria-label="Définir le point d’entrée ici" title="Point d’entrée ici · I" onClick={() => actions.trim('start', engine.videoOf(f)?.currentTime ?? 0)}><Icon name="bracket" /></button>
          <label>Sortie <NumberField id="trim-end" min={f.start + 0.01} max={f.duration} step={0.01} decimals={2} value={f.end} ariaLabel="Point de sortie en secondes" onChange={(v) => actions.trim('end', v)} /> s</label>
          <button className="icon-button" id="set-out" aria-label="Définir le point de sortie ici" title="Point de sortie ici · O" onClick={() => actions.trim('end', engine.videoOf(f)?.currentTime ?? f.duration)}><Icon name="bracket" /></button>
        </Disclosure>
      </div>
      <div className="clip-track" id="clip-track" ref={track}>
        <div className="clip-filmstrip" id="clip-filmstrip">{frames.map((src, i) => <img key={i} src={src} alt="" draggable={false} />)}</div>
        <div className="trim-shade trim-shade-left" style={{ width: left + '%' }} />
        <div className="trim-shade trim-shade-right" style={{ width: 100 - right + '%' }} />
        <div className="trim-selection" style={{ left: left + '%', width: right - left + '%' }} />
        <Slider id="seek" min={0} max={f.duration} step={1 / fps} value={time} ariaLabel="Position de lecture" ariaValueText={`Position ${clipTime(time)} sur ${clipTime(f.duration)}`}
          title="Cliquez ou glissez pour parcourir la vidéo. Flèches : une image à la fois." onChange={engine.seek} />
        <button className="trim-handle" id="trim-in" role="slider" aria-label="Début de la vidéo" aria-valuemin={0} aria-valuemax={Number(f.duration.toFixed(2))} aria-valuenow={Number(f.start.toFixed(2))} aria-valuetext={clipTime(f.start)} style={{ left: left + '%' }} {...handle('start')}><Icon name="grip" /></button>
        <button className="trim-handle" id="trim-out" role="slider" aria-label="Fin de la vidéo" aria-valuemin={0} aria-valuemax={Number(f.duration.toFixed(2))} aria-valuenow={Number(f.end.toFixed(2))} aria-valuetext={clipTime(f.end)} style={{ left: right + '%' }} {...handle('end')}><Icon name="grip" /></button>
      </div>
      <div className="trim-time-labels"><output id="trim-in-label">Début {clipTime(f.start)}</output><output id="seek-position">Position {clipTime(time)}</output><output id="trim-out-label">Fin {clipTime(f.end)}</output></div>
      <div className="timeline-bottom">
        <label>Vitesse <Select id="speed" ariaLabel="Vitesse de la vidéo" value={String(f.speed)} options={[['0.5', '0,5 ×'], ['1', '1 ×'], ['1.5', '1,5 ×'], ['2', '2 ×']].map(([value, label]) => ({ value, label }))} onChange={(v) => { updateActive({ speed: Number(v) }); actions.commit(); }} /></label>
        <label><Icon name={f.audio && f.volume > 0 ? 'volume' : 'volume-off'} /><Slider id="volume" min={0} max={100} value={f.volume} ariaLabel="Volume audio" onChange={(v) => updateActive({ volume: v })} onCommit={actions.commit} /><output id="volume-value">{Math.round(f.volume)} %</output>
          <button id="volume-original" type="button" title="Rétablir le volume d’origine" aria-label="Rétablir le volume d’origine" disabled={f.volume === 100} onClick={() => { updateActive({ volume: 100 }); actions.commit(); }}>Original</button></label>
        <Check id="audio" checked={f.audio} label="Conserver l’audio" onChange={(v) => { updateActive({ audio: v }); actions.commit(); }} />
        <span>Un clip · découpe et vitesse</span>
      </div>
    </section>
  );
}
