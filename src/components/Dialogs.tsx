import { useEffect, useState } from 'react';
import { Icon } from './ui/Icon';
import { Dialog, TextField } from './ui/controls';
import { usePrompt, resolvePrompt } from '../state/actions';
import { useStore, setState } from '../state/store';
import { APP_VERSION, DOWNLOAD_URL, openWebsite } from '../lib/platform';

export function NameDialog() {
  const prompt = usePrompt((s) => s.prompt);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { if (prompt) { setValue(prompt.value); setInvalid(false); } }, [prompt]);
  useEffect(() => { if (prompt) requestAnimationFrame(() => (document.querySelector('#text-dialog-input input') as HTMLInputElement | null)?.select()); }, [prompt]);
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!value.trim()) { setInvalid(true); return; } resolvePrompt(value); };
  return (
    <Dialog open={!!prompt} onClose={() => resolvePrompt(null)} id="text-dialog" label={prompt?.title || 'Nom'}>
      <form onSubmit={submit} noValidate>
        <div className="dialog-heading"><h2 id="text-dialog-title">{prompt?.title}</h2><button type="button" className="icon-button" aria-label="Fermer" onClick={() => resolvePrompt(null)}><Icon name="x" /></button></div>
        <TextField id="text-dialog-input" value={value} maxLength={80} ariaLabel={prompt?.title || 'Nom'} invalid={invalid} onChange={(v) => { setValue(v); setInvalid(false); }} />
        {invalid && <p className="ll-field-error" role="alert">Renseignez un nom pour continuer.</p>}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => resolvePrompt(null)}>Annuler</button><button type="submit" className="button primary">Enregistrer</button></div>
      </form>
    </Dialog>
  );
}

export function HelpDialog() {
  const open = useStore((s) => s.dialog === 'help');
  const close = () => setState({ dialog: null });
  const keys: [string, string][] = [['Importer des médias', 'Ctrl O'], ['Enregistrer le projet', 'Ctrl S'], ['Exporter', 'Ctrl E'], ['Annuler / Rétablir', 'Ctrl Z / Ctrl Maj Z'], ['Avant / Après', 'C'], ['Afficher l’original', 'B'], ['Plein écran', 'F · double-clic'], ['Quitter le plein écran', 'Échap'], ['Lire / Pause', 'Espace'], ['Points d’entrée / sortie', 'I / O'], ['Réduire les looks / réglages', 'Ctrl [ / Ctrl ]'], ['Réinitialiser un curseur', 'Double-clic']];
  return (
    <Dialog open={open} onClose={close} id="help-dialog" label="Aide et raccourcis LumiLooks">
      <div className="dialog-heading"><div><h2>Une image. Votre regard.</h2></div><button className="icon-button" id="close-help" aria-label="Fermer l’aide" onClick={close}><Icon name="x" /></button></div>
      <p>Importez un média, choisissez un look puis ajustez la lumière, les couleurs et les effets d’objectif. Les blocs de la chaîne permettent d’activer ou de désactiver chaque groupe d’effets.</p>
      <div className="help-keys">{keys.flatMap(([label, key]) => [<span key={label}>{label}</span>, <kbd key={label + 'k'}>{key}</kbd>])}</div>
      <p className="help-note">Les projets conservent les liens vers vos médias : gardez les originaux au même emplacement. Un fichier .cube exporté par LumiLooks contient aussi tous vos réglages : réimporté dans LumiLooks, il restaure la correction complète.</p>
      <div className="help-brand">
        <span className="help-logo"><img src="/assets/lumilooks-logo.png" alt="" width={56} height={56} draggable={false} /></span>
        <span>LumiLooks {APP_VERSION} · Studio indépendant par LuminosWeb<br />
          <button type="button" className="text-link" onClick={() => openWebsite(DOWNLOAD_URL)}>lumilooks.luminosweb.com</button><br />
          Icônes : MingCute via Iconify · DAEDAL : 8 LUTs · CC0<br />slay : 5 LUTs · CC BY 4.0 · OpenLUTs : 14 LUTs · CC0<br />Film argentique : 24 looks · Pat David, Pavlov Dmitry, Michael Ezra · CC BY-SA 4.0</span>
      </div>
    </Dialog>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  return (
    <>
      <div className="sr-only" id="app-status" role="status" aria-live="polite">{toast?.message}</div>
      {toast && <div className={'toast' + (toast.error ? ' error' : '')} id="toast" role={toast.error ? 'alert' : 'status'} key={toast.id}>{toast.message}</div>}
    </>
  );
}
