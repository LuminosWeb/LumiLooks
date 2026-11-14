import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui/Icon';
import { Check, Dialog, NumberField, Progress, Select, Slider } from './ui/controls';
import { activeFile, getState, setState, toast, useActive, useStore, type MediaFile } from '../state/store';
import { ColorRenderer } from '../lib/renderer';
import { defaultVideoResolution, exportGeometry, geometry, linkedSize } from '../lib/geometry';
import { imageFormat, imageFormats, videoFormat, videoFormats } from '../lib/exportFormats';
import { clampBitrate, encoderNotes, estimateBytes, estimateImageBytes, formatBytes, qualityLabels, recommendedBitrate, MAX_KBPS, MIN_KBPS, type EncoderKind, type Quality } from '../lib/videoEstimate';
import * as platform from '../lib/platform';
import * as engine from '../engine/engine';
import { duration as formatDuration } from './time';

type Phase = { kind: 'options' } | { kind: 'progress'; label: string; percent: number; detail: string } | { kind: 'done'; path: string | null };

function ImageOptions({ file, onRun, busy }: { file: MediaFile; onRun: (opts: { format: string; width: number; height: number }) => void; busy: boolean }) {
  const base = geometry(file.width, file.height, file.rotation, file.aspect), ratio = base.width / base.height;
  const [format, setFormat] = useState('png');
  const [size, setSize] = useState({ width: base.width, height: base.height });
  const [locked, setLocked] = useState(true);
  const max = 16384;
  const change = (key: 'width' | 'height', value: number) => setSize((s) => (locked ? linkedSize(key, value, ratio, max) : { ...s, [key]: Math.max(1, Math.min(max, Math.round(value))) }));
  const longest = (target: number) => { const scale = target / Math.max(base.width, base.height); setSize({ width: Math.max(1, Math.round(base.width * scale)), height: Math.max(1, Math.round(base.height * scale)) }); setLocked(true); };
  const upscale = size.width > base.width || size.height > base.height, stretched = Math.abs(size.width / size.height - ratio) > 0.01;
  return (
    <>
      <div className="export-options" id="export-options">
        <label>Format <Select id="export-format" ariaLabel="Format image" value={format} options={imageFormats.map((f) => ({ value: f.value, label: f.label }))} onChange={setFormat} /></label>
        <div className="export-size">
          <label>Largeur <NumberField id="export-width" min={1} max={max} value={size.width} ariaLabel="Largeur en pixels" onChange={(v) => change('width', v)} /> px</label>
          <button type="button" className={'icon-button link-toggle' + (locked ? ' active' : '')} id="export-link" aria-pressed={locked} aria-label={locked ? 'Délier largeur et hauteur' : 'Lier largeur et hauteur'} title={locked ? 'Proportions conservées' : 'Proportions libres'}
            onClick={() => { const next = !locked; setLocked(next); if (next) setSize((s) => linkedSize('width', s.width, ratio, max)); }}>
            <Icon name={locked ? 'link' : 'unlink'} />
          </button>
          <label>Hauteur <NumberField id="export-height" min={1} max={max} value={size.height} ariaLabel="Hauteur en pixels" onChange={(v) => change('height', v)} /> px</label>
        </div>
        <Check id="export-lock" checked={locked} label="Conserver les proportions d’origine" onChange={(v) => { setLocked(v); if (v) setSize((s) => linkedSize('width', s.width, ratio, max)); }} />
        <div className="export-presets" role="group" aria-label="Tailles rapides">
          <button type="button" className="chip" onClick={() => longest(Math.max(base.width, base.height))}>Origine · {base.width} × {base.height}</button>
          <button type="button" className="chip" onClick={() => longest(Math.max(base.width, base.height) / 2)}>50 %</button>
          <button type="button" className="chip" onClick={() => longest(3840)}>3840 px</button>
          <button type="button" className="chip" onClick={() => longest(1920)}>1920 px</button>
          <button type="button" className="chip" onClick={() => longest(1080)}>1080 px</button>
        </div>
        <output id="export-dimensions" aria-live="polite">Fichier final : {size.width} × {size.height} pixels · ≈ {formatBytes(estimateImageBytes(size.width, size.height, format))}</output>
        {(upscale || stretched) && <small className="export-warning"><Icon name="info" />{upscale ? 'Agrandir l’image l’interpole : aucun détail n’est ajouté. ' : ''}{stretched ? 'Les proportions sont modifiées : l’image sera étirée.' : ''}</small>}
        <small>Couleurs, effets, grain, optique et cadrage appliqués. Le PDF contient l’image pleine page ; la transparence y devient blanche.</small>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button secondary" id="export-cancel" onClick={() => setState({ dialog: null })}>Annuler</button>
        <button type="button" className="button primary" id="export-confirm" disabled={busy} onClick={() => onRun({ format, ...size })}><Icon name="export" /> Exporter</button>
      </div>
    </>
  );
}

interface VideoChoice { format: string; resolution: string; fps: number; quality: Quality; bitrate: number; encoder: EncoderKind }

function VideoOptions({ file, onRun, busy }: { file: MediaFile; onRun: (choice: VideoChoice) => void; busy: boolean }) {
  const sourceFps = [24, 25, 30, 60].reduce((best, p) => (Math.abs(p - (file.video?.fps || 30)) < Math.abs(best - (file.video?.fps || 30)) ? p : best));
  const [choice, setChoice] = useState<VideoChoice>(() => {
    const resolution = defaultVideoResolution(file.width, file.height), g = exportGeometry(file.width, file.height, file.rotation, file.aspect, resolution);
    return { format: 'mp4', resolution, fps: sourceFps, quality: 'high', bitrate: recommendedBitrate(g.width, g.height, sourceFps, 'high', 'mp4'), encoder: 'cpu' };
  });
  const [support, setSupport] = useState<platform.EncoderSupport | null | 'pending'>('pending');
  const [customBitrate, setCustomBitrate] = useState(false);
  const g = exportGeometry(file.width, file.height, file.rotation, file.aspect, choice.resolution);
  const recommended = recommendedBitrate(g.width, g.height, choice.fps, choice.quality, choice.format);
  const bitrate = customBitrate ? choice.bitrate : recommended;
  const fmt = videoFormat(choice.format), seconds = (file.end - file.start) / file.speed;
  const audioKbps = file.audio && (file.video?.audioCodec || !platform.isTauri) ? fmt.audioKbps : 0;
  const bytes = estimateBytes(bitrate, audioKbps, seconds);
  useEffect(() => {
    if (!platform.isTauri) { setSupport(null); return; }
    let live = true;
    setSupport('pending');
    platform.detectEncoders({ format: choice.format, width: g.width, height: g.height, fps: choice.fps }).then((s) => live && setSupport(s)).catch(() => live && setSupport(null));
    return () => { live = false; };
  }, [choice.format, g.width, g.height, choice.fps]);
  const gpu = support && support !== 'pending' ? support.gpu : null;
  const gpuAllowed = fmt.gpu && !!gpu;
  const encoder: EncoderKind = choice.encoder === 'gpu' && gpuAllowed ? 'gpu' : 'cpu';
  const notes = encoderNotes(encoder, choice.format, gpu?.label);
  const set = (patch: Partial<VideoChoice>) => setChoice((c) => ({ ...c, ...patch }));
  const sizes = (['720', '1080', '2160', 'original'] as const).map((value) => {
    const s = exportGeometry(file.width, file.height, file.rotation, file.aspect, value);
    return { value, label: `${value === 'original' ? 'Originale' : value === '2160' ? '4K · 2160p' : value + 'p'} — ${s.width} × ${s.height}` };
  });
  const gpuLabel = support === 'pending' ? 'Carte graphique (GPU) · détection…' : !fmt.gpu ? 'Carte graphique (GPU) · indisponible pour WMV' : gpu ? `Carte graphique (GPU) · ${gpu.label}` : 'Carte graphique (GPU) · non détectée';
  return (
    <>
      <div className="export-options" id="export-options">
        <label>Format <Select id="export-format" ariaLabel="Format vidéo" value={choice.format} options={videoFormats.map((f) => ({ value: f.value, label: f.label }))} onChange={(v) => set({ format: v })} /></label>
        <label>Résolution <Select id="export-size" ariaLabel="Résolution vidéo" value={choice.resolution} options={sizes} onChange={(v) => set({ resolution: v })} /></label>
        <label>Images par seconde <Select id="export-fps" ariaLabel="Images par seconde" value={String(choice.fps)} options={[24, 25, 30, 60].map((p) => ({ value: String(p), label: `${p} ips` }))} onChange={(v) => set({ fps: Number(v) })} /></label>
        <label>Qualité <Select id="export-quality" ariaLabel="Qualité vidéo" value={choice.quality} options={(Object.keys(qualityLabels) as Quality[]).map((q) => ({ value: q, label: qualityLabels[q] }))} onChange={(v) => { set({ quality: v as Quality }); setCustomBitrate(false); }} /></label>
        <div className="bitrate-control">
          <label>Débit vidéo
            <span className="bitrate-value"><NumberField id="export-bitrate" min={MIN_KBPS} max={MAX_KBPS} step={100} value={bitrate} ariaLabel="Débit vidéo en kilobits par seconde" onChange={(v) => { setCustomBitrate(true); set({ bitrate: clampBitrate(v) }); }} /> kbit/s</span>
          </label>
          <Slider id="export-bitrate-slider" min={MIN_KBPS} max={Math.max(60000, recommended * 3)} step={100} value={bitrate} ariaLabel="Débit vidéo" ariaValueText={`${bitrate} kilobits par seconde`} onChange={(v) => { setCustomBitrate(true); set({ bitrate: v }); }} />
          <small>{customBitrate ? <>Débit personnalisé · <button type="button" className="text-link" onClick={() => setCustomBitrate(false)}>revenir au débit conseillé ({recommended.toLocaleString('fr-FR')} kbit/s)</button></> : `Débit conseillé pour « ${qualityLabels[choice.quality]} » en ${g.width} × ${g.height} à ${choice.fps} ips.`}</small>
        </div>
        <label>Rendu <Select id="export-encoder" ariaLabel="Moteur d’encodage" value={encoder}
          options={[{ value: 'cpu', label: `Processeur (CPU) · ${choice.format === 'webm' ? 'VP9' : choice.format === 'wmv' ? 'WMV' : 'x264'}` }, { value: 'gpu', label: gpuLabel, disabled: !gpuAllowed }]}
          onChange={(v) => set({ encoder: v as EncoderKind })} /></label>
        <div className={'encoder-notes ' + encoder} id="encoder-notes">
          <strong><Icon name={encoder === 'gpu' ? 'gpu' : 'cpu'} />{notes.title}</strong>
          <ul>{notes.lines.map((line) => <li key={line}>{line}</li>)}</ul>
          <small>L’étalonnage et les effets sont toujours calculés par la carte graphique (WebGL) ; ce choix concerne l’encodage du fichier.</small>
        </div>
        <div className="size-estimate" id="export-estimate" aria-live="polite">
          <span>Taille estimée</span><strong>≈ {formatBytes(bytes)}</strong>
          <small>{g.width} × {g.height} · {formatDuration(seconds)} · vidéo {bitrate.toLocaleString('fr-FR')} kbit/s{audioKbps ? ` · audio ${audioKbps} kbit/s` : ' · sans audio'}</small>
        </div>
        <small>{seconds.toFixed(2).replace('.', ',')} s de vidéo · {file.audio ? 'Audio conservé' : 'Sans audio'} · Proportions et cadrage conservés. Agrandir une petite source n’ajoute pas de détails.</small>
        {!platform.isTauri && <small className="export-warning"><Icon name="info" />L’export vidéo est disponible dans l’application de bureau.</small>}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button secondary" id="export-cancel" onClick={() => setState({ dialog: null })}>Annuler</button>
        <button type="button" className="button primary" id="export-confirm" disabled={busy || !platform.isTauri} onClick={() => onRun({ ...choice, encoder, bitrate })}><Icon name="export" /> Exporter</button>
      </div>
    </>
  );
}

export function ExportDialog() {
  const open = useStore((s) => s.dialog === 'export'), file = useActive();
  const [phase, setPhase] = useState<Phase>({ kind: 'options' });
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => { if (open) { setPhase({ kind: 'options' }); setBusy(false); cancelled.current = false; } }, [open]);
  const key = useMemo(() => (file ? file.id + open : ''), [file?.id, open]); // reset options per media
  if (!file) return null;
  const close = () => { if (!getState().exporting) setState({ dialog: null }); };

  async function runImage(opts: { format: string; width: number; height: number }) {
    const f = activeFile()!, rt = engine.runtime.get(f.id);
    if (!rt) return;
    setBusy(true);
    try {
      const profile = imageFormat(opts.format), name = platform.stem(f.name) + '-LumiLooks.' + profile.extension;
      if (opts.format === 'pdf' && !platform.isTauri) throw Error('Utilisez l’application de bureau pour exporter un PDF.');
      let path: string | null = null;
      if (platform.isTauri) {
        path = await platform.pickSavePath('Exporter l’image', name, [{ name: profile.label, extensions: [profile.extension] }]);
        if (!path) { setBusy(false); return; }
      }
      setPhase({ kind: 'progress', label: 'Rendu de l’image', percent: 30, detail: `${opts.width} × ${opts.height} pixels` });
      await new Promise((r) => setTimeout(r, 30));
      const g = geometry(f.width, f.height, f.rotation, f.aspect);
      const canvas = document.createElement('canvas'), output = new ColorRenderer(canvas);
      try {
        if (opts.width > output.maxSize || opts.height > output.maxSize) throw Error(`Votre carte graphique accepte au plus ${output.maxSize} pixels de côté.`);
        output.update(f.settings, f.enabled, f.lut);
        output.render(rt.source, f.width, f.height, { width: opts.width, height: opts.height, crop: g.crop, rotation: f.rotation, seed: 1 });
        setPhase({ kind: 'progress', label: 'Encodage du fichier', percent: 70, detail: profile.label });
        if (opts.format === 'pdf') {
          const pixels = output.readPixelsTopDown();
          path = await platform.saveImage(path!, 'pdf', pixels, opts.width, opts.height);
        } else {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, profile.mime, 0.95));
          if (!blob) throw Error('L’image est trop grande. Choisissez une résolution plus petite.');
          if (platform.isTauri) path = await platform.saveImage(path!, opts.format, new Uint8Array(await blob.arrayBuffer()));
          else platform.downloadBlob(blob, name);
        }
      } finally { output.dispose(); }
      setPhase({ kind: 'done', path });
      toast('Export terminé. Votre création est prête.');
    } catch (error) {
      setPhase({ kind: 'options' });
      toast((error as Error).message, true);
    } finally { setBusy(false); }
  }

  async function runVideo(choice: VideoChoice) {
    const f = activeFile()!;
    setBusy(true);
    const fmt = videoFormat(choice.format);
    const path = await platform.pickSavePath('Exporter la vidéo', platform.stem(f.name) + '-LumiLooks.' + fmt.extension, [{ name: 'Vidéo ' + fmt.label, extensions: [fmt.extension] }]).catch(() => null);
    if (!path) { setBusy(false); return; }
    engine.stopPlayback();
    setState({ exporting: true });
    cancelled.current = false;
    let renderer: ColorRenderer | null = null;
    try {
      setPhase({ kind: 'progress', label: 'Préparation de l’export', percent: 0, detail: 'Analyse de la vidéo…' });
      const info = await platform.exportStart({ id: f.id, output: path, start: f.start, end: f.end, speed: f.speed, volume: f.volume, audio: f.audio, rotation: f.rotation, aspect: f.aspect, resolution: choice.resolution, fps: choice.fps, quality: choice.quality, format: choice.format, encoder: choice.encoder, bitrate: choice.bitrate });
      const canvas = document.createElement('canvas');
      renderer = new ColorRenderer(canvas);
      renderer.update(f.settings, f.enabled, f.lut);
      const started = performance.now();
      let frames = 0, next = platform.exportReadFrame();
      next.catch(() => {});
      for (;;) {
        const buffer = await next;
        if (cancelled.current) break;
        if (!buffer || buffer.byteLength === 0) break;
        next = platform.exportReadFrame();
        next.catch(() => {});
        renderer.render(new Uint8Array(buffer), info.sourceWidth, info.sourceHeight, { width: info.width, height: info.height, crop: info.crop, rotation: f.rotation, seed: 1 + Math.floor((frames * 1000) / info.fps) });
        await platform.exportWriteFrame(renderer.readPixelsTopDown());
        frames++;
        if (frames === 1 || frames % 3 === 0) {
          const elapsed = (performance.now() - started) / 1000, eta = Math.max(0, (elapsed / frames) * (info.total - frames));
          setPhase({ kind: 'progress', label: `Rendu de votre vidéo · ${info.engine.label}`, percent: Math.min(99, Math.round((frames / info.total) * 100)), detail: `${frames} / ${info.total} images · ${eta < 60 ? Math.ceil(eta) + ' s' : Math.ceil(eta / 60) + ' min'} restantes environ` });
        }
      }
      if (cancelled.current) { await platform.exportCancel(); setState({ dialog: null }); toast('Export annulé.'); return; }
      setPhase({ kind: 'progress', label: 'Finalisation du fichier', percent: 99, detail: `${frames} images encodées` });
      const output = await platform.exportFinish();
      setPhase({ kind: 'done', path: output });
      toast('Export terminé. Votre création est prête.');
    } catch (error) {
      await platform.exportCancel().catch(() => {});
      if (!cancelled.current) { setPhase({ kind: 'options' }); toast((error as Error).message || String(error), true); }
    } finally {
      renderer?.dispose();
      setState({ exporting: false });
      setBusy(false);
    }
  }

  const exporting = phase.kind === 'progress';
  return (
    <Dialog open={open} onClose={close} id="export-dialog" label="Exporter votre création" canClose={!exporting}>
      <div className="dialog-heading"><div><h2>Exporter votre création</h2></div>
        <button type="button" className="icon-button" aria-label="Fermer" disabled={exporting} onClick={close}><Icon name="x" /></button></div>
      <p id="export-summary">{file.name} · Source : {file.width} × {file.height} px{file.type === 'video' ? ` · ${formatDuration(file.duration)}` : ''}</p>
      {phase.kind === 'options' && (file.type === 'video' ? <VideoOptions key={key} file={file} onRun={runVideo} busy={busy} /> : <ImageOptions key={key} file={file} onRun={runImage} busy={busy} />)}
      {phase.kind === 'progress' && (
        <>
          <div className="export-progress" id="export-progress">
            <div><span id="export-state">{phase.label}</span><b id="export-percent">{phase.percent} %</b></div>
            <Progress value={phase.percent} />
            <small id="export-detail">{phase.detail}</small>
          </div>
          <div className="dialog-actions">
            <button type="button" className="button secondary" id="export-cancel" disabled={file.type !== 'video'} onClick={() => { cancelled.current = true; platform.exportCancel().catch(() => {}); }}>Annuler l’export</button>
          </div>
        </>
      )}
      {phase.kind === 'done' && (
        <>
          <div className="export-success" id="export-success"><Icon name="circle-check" /><strong>Votre création est prête.</strong>
            {phase.path && platform.isTauri && <button type="button" className="button secondary" id="reveal-export" onClick={() => platform.revealFile(phase.path!).catch((e) => toast(String(e), true))}><Icon name="folder" /> Afficher le fichier</button>}
          </div>
          <div className="dialog-actions"><button type="button" className="button primary" id="export-close" onClick={() => setState({ dialog: null })}>Fermer</button></div>
        </>
      )}
    </Dialog>
  );
}
