/* First-run safety net: installs FFmpeg automatically when the bundled copy is missing or cannot start. */
import { create } from 'zustand';
import { Icon } from './ui/Icon';
import { Dialog, Progress } from './ui/controls';
import { toast } from '../state/store';
import * as platform from '../lib/platform';

type Phase = { kind: 'idle' } | { kind: 'installing'; percent: number; detail: string } | { kind: 'error'; message: string };
const useFfmpeg = create<{ phase: Phase; hidden: boolean }>(() => ({ phase: { kind: 'idle' }, hidden: false }));

let pending: Promise<void> | null = null;
const mb = (bytes: number) => (bytes / 1e6).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function describe(progress: platform.FfmpegProgress) {
  if (progress.stage === 'verify') return { percent: 96, detail: 'Vérification de l’intégrité du fichier…' };
  if (progress.stage === 'install' || progress.stage === 'done') return { percent: 99, detail: 'Installation…' };
  const total = Math.max(1, progress.total);
  return { percent: Math.min(95, Math.round((progress.downloaded / total) * 95)), detail: `${mb(progress.downloaded)} / ${mb(total)} Mo téléchargés` };
}

async function install() {
  useFfmpeg.setState({ phase: { kind: 'installing', percent: 0, detail: 'Connexion…' }, hidden: false });
  try {
    await platform.installFfmpeg((progress) => useFfmpeg.setState({ phase: { kind: 'installing', ...describe(progress) } }));
    useFfmpeg.setState({ phase: { kind: 'idle' } });
    toast('FFmpeg est installé : l’import et l’export vidéo sont prêts.');
  } catch (error) {
    useFfmpeg.setState({ phase: { kind: 'error', message: String(error) }, hidden: false });
  }
}

/** Checks FFmpeg at startup and installs it when needed. Safe to call several times. */
export function ensureFfmpeg(): Promise<void> {
  if (!platform.isTauri) return Promise.resolve();
  if (!pending) {
    pending = platform.ffmpegStatus()
      .then((status) => (status.ready ? undefined : install()))
      .catch(() => install())
      .finally(() => { if (useFfmpeg.getState().phase.kind === 'error') pending = null; });
  }
  return pending;
}

/** Waits for an installation already in progress (video imports need FFmpeg). */
export const ffmpegReady = () => pending ?? Promise.resolve();

export function FfmpegDialog() {
  const { phase, hidden } = useFfmpeg();
  const open = phase.kind !== 'idle' && !hidden;
  const hide = () => useFfmpeg.setState({ hidden: true });
  return (
    <Dialog open={open} onClose={hide} id="ffmpeg-dialog" label="Installation de FFmpeg">
      {phase.kind === 'installing' && (
        <>
          <div className="dialog-heading"><div><h2>Préparation de la vidéo</h2></div></div>
          <p>LumiLooks installe FFmpeg, le moteur qui lit et exporte vos vidéos. Cette étape n’a lieu qu’une seule fois. Vos photos restent utilisables pendant ce temps.</p>
          <div className="export-progress" id="ffmpeg-progress">
            <div><span>Installation de FFmpeg</span><b>{phase.percent} %</b></div>
            <Progress value={phase.percent} label="Progression de l’installation de FFmpeg" />
            <small>{phase.detail}</small>
          </div>
          <div className="dialog-actions"><button type="button" className="button secondary" onClick={hide}>Continuer en arrière-plan</button></div>
        </>
      )}
      {phase.kind === 'error' && (
        <>
          <div className="dialog-heading"><div><h2>FFmpeg n’a pas pu être installé</h2></div>
            <button type="button" className="icon-button" aria-label="Fermer" onClick={hide}><Icon name="x" /></button></div>
          <p id="ffmpeg-error">{phase.message}</p>
          <p>Vos photos restent utilisables. Pour les vidéos, réessayez une fois connecté à Internet, ou installez FFmpeg sur votre ordinateur puis redémarrez LumiLooks.</p>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={hide}>Plus tard</button>
            <button type="button" className="button primary" id="ffmpeg-retry" onClick={() => { void ensureFfmpeg(); }}>Réessayer</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
