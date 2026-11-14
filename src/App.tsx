import { useEffect } from 'react';
import { Header } from './components/Header';
import { LooksPanel } from './components/LooksPanel';
import { Viewer } from './components/Viewer';
import { MediaStrip } from './components/MediaStrip';
import { Timeline } from './components/Timeline';
import { ControlsPanel } from './components/ControlsPanel';
import { ChainPanel } from './components/ChainPanel';
import { ExportDialog } from './components/ExportDialog';
import { HelpDialog, NameDialog, Toast } from './components/Dialogs';
import { closePopups } from './components/ui/controls';
import { showExport } from './components/exportController';
import { useStore, getState, setState, activeFile } from './state/store';
import * as actions from './state/actions';
import * as engine from './engine/engine';
import * as platform from './lib/platform';

function useGlobalEvents() {
  useEffect(() => {
    actions.init();
    // Interface images (logos, thumbnails) must never be dragged into the app as media.
    const dragstart = (event: DragEvent) => { if (!(event.target as HTMLElement)?.closest?.('[draggable="true"]')) event.preventDefault(); };
    document.addEventListener('dragstart', dragstart);
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = getState(), k = e.key.toLowerCase();
      if (s.fullscreen && e.key === 'Escape') { e.preventDefault(); actions.setFullscreen(false); return; }
      if (document.querySelector('.ll-dialog[data-open]')) return;
      if (e.ctrlKey || e.metaKey) {
        if (['o', 's', 'e'].includes(k)) {
          e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); closePopups();
          if (k === 'o') actions.attempt(e.shiftKey ? actions.openProject : actions.importMedia);
          if (k === 's') actions.attempt(actions.saveProject);
          if (k === 'e') showExport();
          return;
        }
        if (e.key === '[') { e.preventDefault(); actions.toggleLeft(); return; }
        if (e.key === ']') { e.preventDefault(); actions.toggleRight(); return; }
        if (k === 'z' && !(document.activeElement as HTMLElement | null)?.matches('input,textarea')) { e.preventDefault(); engine.undoRedo(e.shiftKey ? 1 : -1); }
        if (k === 'y' && !(document.activeElement as HTMLElement | null)?.matches('input,textarea')) { e.preventDefault(); engine.undoRedo(1); }
        return;
      }
      if ((document.activeElement as HTMLElement | null)?.closest('input,textarea,.ll-select,.ll-slider,.ll-number,.ll-check,[role="menu"]')) return;
      if (e.key === 'F2') { e.preventDefault(); actions.attempt(actions.renameProject); return; }
      if (e.key === 'F11') { e.preventDefault(); actions.setFullscreen(!s.fullscreen); return; }
      if (e.key === ' ' && (document.activeElement as HTMLElement | null)?.closest('button,summary')) return;
      if (!activeFile()) { if (k === '?') setState({ dialog: 'help' }); return; }
      if (k === 'c') setState({ compare: !s.compare });
      if (k === 'b') setState({ bypass: !s.bypass });
      if (k === 'f') actions.setFullscreen(!s.fullscreen);
      if (k === ' ') { e.preventDefault(); actions.attempt(engine.playPause); }
      if (k === 'i' && activeFile()?.type === 'video') actions.trim('start', engine.videoOf(activeFile())?.currentTime ?? 0);
      if (k === 'o' && activeFile()?.type === 'video') actions.trim('end', engine.videoOf(activeFile())?.currentTime ?? 0);
      if (k === '/' && !s.leftCollapsed) { e.preventDefault(); (document.querySelector('#search input') as HTMLInputElement | null)?.focus(); }
      if (k === '?') setState({ dialog: 'help' });
      if (k === 'arrowleft' && s.fullscreen && activeFile()?.type === 'video') engine.stepFrame(-1);
      if (k === 'arrowright' && s.fullscreen && activeFile()?.type === 'video') engine.stepFrame(1);
    };
    document.addEventListener('keydown', key);
    const cleanups: (() => void)[] = [() => document.removeEventListener('keydown', key), () => document.removeEventListener('dragstart', dragstart)];
    if (platform.isTauri) {
      import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === 'enter') setState({ dragging: p.paths.length > 0 });
          else if (p.type === 'leave') setState({ dragging: false });
          else if (p.type === 'drop') { setState({ dragging: false }); if (p.paths.length) actions.attempt(() => actions.importPaths(p.paths)); }
        });
        cleanups.push(unlisten);
      });
      platform.appWindow().then(async (w) => {
        const unlisten = await w.onCloseRequested(async (event) => {
          const s = getState();
          if (s.exporting && !(await platform.askConfirm('Quitter arrêtera l’export en cours.', 'Un export est en cours', 'Quitter', 'Continuer l’export'))) { event.preventDefault(); return; }
          if (s.dirty && s.files.length && !(await platform.askConfirm('Enregistrez votre projet pour retrouver vos réglages lors de la prochaine ouverture.', 'Modifications non enregistrées', 'Quitter sans enregistrer', 'Revenir au projet'))) event.preventDefault();
          else if (s.exporting) await platform.exportCancel().catch(() => {});
        });
        cleanups.push(unlisten);
      });
      // Test hook: lets automated checks import files without the native dialog.
      (window as unknown as Record<string, unknown>).__lumilooks = { importPaths: actions.importPaths, applyPreset: actions.applyPreset, setSettings: actions.setSettings, getState, applyCorrectionText: actions.applyCorrectionText };
    } else {
      let depth = 0;
      const over = (e: DragEvent) => e.preventDefault();
      const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setState({ dragging: true }); } };
      const leave = () => { if (--depth <= 0) { depth = 0; setState({ dragging: false }); } };
      const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setState({ dragging: false }); if (e.dataTransfer?.files.length) actions.attempt(() => actions.addImported(actions.browserFiles([...e.dataTransfer!.files]))); };
      document.addEventListener('dragover', over); document.addEventListener('dragenter', enter); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop);
      cleanups.push(() => { document.removeEventListener('dragover', over); document.removeEventListener('dragenter', enter); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop); });
      (window as unknown as Record<string, unknown>).__lumilooks = { applyPreset: actions.applyPreset, setSettings: actions.setSettings, getState, addImported: actions.addImported, applyCorrectionText: actions.applyCorrectionText };
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);
}

export default function App() {
  useGlobalEvents();
  const hasMedia = useStore((s) => s.files.length > 0), fullscreen = useStore((s) => s.fullscreen), workspace = useStore((s) => s.workspace);
  const isVideo = useStore((s) => s.files.find((f) => f.id === s.activeId)?.type === 'video');
  const left = useStore((s) => s.leftCollapsed), right = useStore((s) => s.rightCollapsed);
  const chrome = hasMedia && !fullscreen;
  return (
    <>
      <div className={'app' + (hasMedia ? '' : ' is-empty') + (fullscreen ? ' is-fullscreen' : '') + (left ? ' left-collapsed' : '') + (right ? ' right-collapsed' : '')}>
        {!fullscreen && <Header />}
        <div className="workspace">
          {chrome && <LooksPanel />}
          <main className="editor">
            <Viewer />
            {chrome && <MediaStrip />}
            {chrome && isVideo && workspace === 'edit' && <Timeline />}
          </main>
          {chrome && <ControlsPanel />}
        </div>
        {chrome && <ChainPanel />}
      </div>
      <ExportDialog />
      <NameDialog />
      <HelpDialog />
      <Toast />
    </>
  );
}
