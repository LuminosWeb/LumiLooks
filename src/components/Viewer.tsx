import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icon';
import { Slider } from './ui/controls';
import { useStore, setState, getState, useActive } from '../state/store';
import * as actions from '../state/actions';
import * as engine from '../engine/engine';
import { clipTime, timecode } from './time';

function FullscreenControls() {
  const file = useActive(), playing = useStore((s) => s.playing), time = useStore((s) => s.time), compare = useStore((s) => s.compare), bypass = useStore((s) => s.bypass);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let timer = setTimeout(() => setVisible(false), 2600);
    const wake = () => { setVisible(true); clearTimeout(timer); timer = setTimeout(() => setVisible(false), 2600); };
    window.addEventListener('pointermove', wake); window.addEventListener('keydown', wake);
    return () => { clearTimeout(timer); window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', wake); };
  }, []);
  useEffect(() => { document.body.classList.toggle('fs-idle', !visible); return () => document.body.classList.remove('fs-idle'); }, [visible]);
  if (!file) return null;
  return (
    <div className={'fs-controls' + (visible ? '' : ' idle')} role="toolbar" aria-label="Commandes du plein écran" onDoubleClick={(e) => e.stopPropagation()}>
      <span className="fs-title">{file.name}</span>
      {file.type === 'video' && (
        <div className="fs-transport">
          <button className="icon-button" aria-label="Image précédente" onClick={() => engine.stepFrame(-1)}><Icon name="skip-back" /></button>
          <button className="play-button" id="fs-play" aria-label={playing ? 'Mettre en pause' : 'Lire la vidéo'} onClick={() => actions.attempt(engine.playPause)}><Icon name={playing ? 'pause' : 'play'} /></button>
          <button className="icon-button" aria-label="Image suivante" onClick={() => engine.stepFrame(1)}><Icon name="skip-forward" /></button>
          <Slider className="fs-seek" ariaLabel="Position de lecture" min={0} max={file.duration || 1} step={0.001} value={time} ariaValueText={clipTime(time)} onChange={engine.seek} />
          <span className="fs-time">{timecode(time)} / {timecode(file.duration)}</span>
        </div>
      )}
      <div className="fs-actions">
        <button className={'compare-button' + (compare ? ' active' : '')} aria-pressed={compare} onClick={() => setState({ compare: !getState().compare })}><Icon name="compare" /><span>Avant / Après</span></button>
        <button className={'icon-button' + (bypass ? ' active' : '')} aria-pressed={bypass} aria-label="Afficher l’original" title="Afficher l’original · B" onClick={() => setState({ bypass: !getState().bypass })}><Icon name="eye" /></button>
        <button className="icon-button" id="exit-fullscreen" aria-label="Quitter le plein écran" title="Quitter le plein écran · Échap" onClick={() => actions.setFullscreen(false)}><Icon name="exit-fullscreen" /></button>
      </div>
    </div>
  );
}

export function Viewer() {
  const file = useActive(), fullscreen = useStore((s) => s.fullscreen), compare = useStore((s) => s.compare), bypass = useStore((s) => s.bypass), split = useStore((s) => s.split);
  const undo = useStore((s) => s.undo), zoom = useStore((s) => s.zoom), dragging = useStore((s) => s.dragging), playing = useStore((s) => s.playing), time = useStore((s) => s.time);
  const canvas = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null);
  useEffect(() => engine.attachPreview(canvas.current!, stage.current!, wrap.current!), []);
  const hasMedia = !!file;

  const dragSplit = (event: React.PointerEvent<HTMLButtonElement>) => {
    const el = event.currentTarget, rect = wrap.current!.getBoundingClientRect();
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setState({ split: Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width)) });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };

  return (
    <section className="viewer" aria-label="Prévisualisation">
      {hasMedia && !fullscreen && (
        <div className="viewer-toolbar">
          <div className="media-heading">
            <Icon name={file.type === 'video' ? 'clapperboard' : 'image'} />
            <span id="media-name">{file.name}</span>
            <span id="dimensions" className="source-dimensions" aria-label="Dimensions d’origine" title={`Dimensions d’origine : ${file.width} × ${file.height} pixels`}>{file.width ? `${file.width} × ${file.height}` : '—'}</span>
          </div>
          <div className="viewer-actions">
            <button className="icon-button" id="undo" aria-label="Annuler" title="Annuler · Ctrl Z" disabled={!undo.canUndo} onClick={() => engine.undoRedo(-1)}><Icon name="undo" /></button>
            <button className="icon-button" id="redo" aria-label="Rétablir" title="Rétablir · Ctrl Maj Z" disabled={!undo.canRedo} onClick={() => engine.undoRedo(1)}><Icon name="redo" /></button>
            <span className="separator" />
            <button className={'compare-button' + (compare ? ' active' : '')} id="compare" aria-pressed={compare} title="Comparer avant / après · C" onClick={() => setState({ compare: !compare })}><Icon name="compare" /><span>Avant / Après</span></button>
            <button className={'icon-button' + (bypass ? ' active' : '')} id="bypass" aria-pressed={bypass} aria-label="Afficher l’original" title="Afficher l’original · B" onClick={() => setState({ bypass: !bypass })}><Icon name="eye" /></button>
            <button className="icon-button" id="fullscreen" aria-label="Plein écran" title="Plein écran · F" onClick={() => actions.setFullscreen(true)}><Icon name="fullscreen" /></button>
          </div>
        </div>
      )}
      <div className={'preview-stage' + (dragging ? ' dragging' : '')} id="drop-zone" ref={stage} tabIndex={0} aria-label="Aperçu : molette pour zoomer, glisser pour déplacer, touche 0 pour adapter"
        onDoubleClick={(e) => { if (hasMedia && !(e.target as Element).closest('button,.zoom-control,.fs-controls,.comparison-line')) actions.setFullscreen(!fullscreen); }}>
        <div className="canvas-wrap" id="canvas-wrap" ref={wrap} hidden={!hasMedia}>
          <canvas id="preview" ref={canvas} role="img" aria-label="Image retouchée" />
          {compare && (
            <div className="comparison-line" id="comparison-line" style={{ left: `${split * 100}%` }}>
              <span>AVANT</span>
              <button aria-label="Déplacer la comparaison" id="split-handle" onPointerDown={dragSplit}
                onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setState({ split: Math.max(0.02, Math.min(0.98, split + (e.key === 'ArrowRight' ? 0.03 : -0.03))) }); } }}>
                <Icon name="move-horizontal" />
              </button>
              <span>APRÈS</span>
            </div>
          )}
        </div>
        {!hasMedia && (
          <div className="preview-empty" id="preview-empty">
            <a className="empty-logo" href="https://lumilooks.luminosweb.com" target="_blank" rel="noopener noreferrer" aria-label="Visiter le site de LumiLooks" draggable={false}
              onClick={(e) => { e.preventDefault(); import('../lib/platform').then((p) => p.openWebsite(p.DOWNLOAD_URL)); }}>
              <img src="/assets/lumilooks-logo.png" alt="LumiLooks" width={144} height={144} draggable={false} />
            </a>
            <h2>Donnez une couleur à vos idées.</h2>
            <p>Glissez une photo ou une vidéo pour commencer.</p>
            <button className="button primary" id="empty-import" onClick={() => actions.attempt(actions.importMedia)}><Icon name="plus" /> Importer un média</button>
          </div>
        )}
        <div className="drop-overlay"><Icon name="download" /><h2>Déposez vos images et vidéos</h2><p>JPG, PNG, WebP · MP4, MOV, WebM, MKV</p></div>
        {hasMedia && bypass && <span className="original-label" id="original-label">ORIGINAL</span>}
        {hasMedia && !fullscreen && (
          <div className="zoom-control" role="group" aria-label="Zoom de l’aperçu">
            <button className="icon-button" id="zoom-out" aria-label="Dézoomer" title="Dézoomer · −" disabled={!zoom.canZoomOut} onClick={() => engine.zoomBy(1 / 1.25)}><Icon name="minus" /></button>
            <output id="zoom-level" aria-label="Niveau de zoom">{Math.round(zoom.scale * 100)} %</output>
            <button className="icon-button" id="zoom-in" aria-label="Zoomer" title="Zoomer · +" disabled={!zoom.canZoomIn} onClick={() => engine.zoomBy(1.25)}><Icon name="plus" /></button>
            <button className="icon-button" id="zoom-fit" aria-label="Adapter à la fenêtre" title="Adapter à la fenêtre · 0" aria-pressed={zoom.fit} onClick={engine.zoomFit}><Icon name="fit" /></button>
          </div>
        )}
        {fullscreen && <FullscreenControls />}
      </div>
      {file?.type === 'video' && !fullscreen && (
        <div className="viewer-bottom" id="viewer-bottom">
          <div className="viewer-meta"><span className="live-dot" /><span>sRGB · {file.video?.fps ? `${Math.round(file.video.fps * 100) / 100} ips` : 'vidéo'}</span></div>
          <div className="playback">
            <button className="icon-button" id="step-back" aria-label="Image précédente" onClick={() => engine.stepFrame(-1)}><Icon name="skip-back" /></button>
            <button className="play-button" id="play" aria-label={playing ? 'Mettre en pause' : 'Lire la vidéo'} onClick={() => actions.attempt(engine.playPause)}><Icon name={playing ? 'pause' : 'play'} /></button>
            <button className="icon-button" id="step-forward" aria-label="Image suivante" onClick={() => engine.stepFrame(1)}><Icon name="skip-forward" /></button>
            <span id="timecode">{timecode(time)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
