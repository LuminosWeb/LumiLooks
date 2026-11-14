import { activeFile, setState } from '../state/store';
import { stopPlayback } from '../engine/engine';
export function showExport() {
  if (!activeFile()) return;
  stopPlayback();
  setState({ dialog: 'export' });
}
