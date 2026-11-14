import { Icon, type IconName } from './ui/Icon';
import { useActive, useStore } from '../state/store';
import * as actions from '../state/actions';
import { allPresets } from '../engine/engine';
import type { GroupKey } from '../lib/color';
import type { Tab } from '../state/store';

export function ChainPanel() {
  const f = useActive(), tab = useStore((s) => s.tab), visible = useStore((s) => s.chainVisible);
  useStore((s) => s.bundled.length + s.customLooks.length);
  if (!f) return null;
  const preset = allPresets().find((p) => p.id === f.preset);
  const s = f.settings;
  const opticsCount = [s.hazeAmount > 0, s.flareAmount > 0, s.aberration !== 0, s.distortion !== 0, s.diffusionAmount > 0].filter(Boolean).length;
  const nodes: [GroupKey, string, IconName, string, Tab][] = [
    ['color', 'Couleur', 'sliders', 'Lumière & balance', 'light'],
    ['wheels', 'Colorimétrie', 'palette', 'Ombres · tons · lumières', 'wheels'],
    ['lens', 'Détails', 'focus', 'Netteté, diffusion & vignette', 'lens'],
    ['optics', 'Effets d’objectif', 'lens', opticsCount ? `${opticsCount} effet${opticsCount > 1 ? 's' : ''} actif${opticsCount > 1 ? 's' : ''}` : 'Haze, flare, aberration…', 'optics'],
    ['film', 'Pellicule', 'film', 'Grain argentique', 'film'],
    ['lut', 'LUT 3D', 'file-image', f.lut ? (f.lutName || 'LUT personnalisée') : 'Aucune LUT', 'film'],
  ];
  const selectedFor = (key: GroupKey) => (key === 'color' ? ['light', 'color', 'mixer', 'curves'].includes(tab) : key === 'lut' ? false : tab === key);
  return (
    <section className={'chain-panel' + (visible ? '' : ' collapsed')} id="chain-panel" aria-label="Chaîne d’effets">
      <div className="chain-heading">
        <div><Icon name="workflow" /><strong>Chaîne d’effets</strong><span>Façonnez votre lumière, un effet à la fois.</span></div>
        <div className="chain-tools">
          {visible && (
            <div className="chain-actions" id="chain-actions">
              <button className="text-button" id="import-correction" onClick={() => actions.attempt(actions.importCorrection)}><Icon name="upload" /> Importer une correction</button>
              <button className="text-button" id="export-cube" title="LUT 3D universelle. Réimportée dans LumiLooks, elle restaure tous les réglages." onClick={() => actions.attempt(() => actions.exportCorrection('cube'))}><Icon name="download" /> Exporter en .cube</button>
              <button className="text-button" id="export-lumilook" title="Réglages LumiLooks complets (sans table LUT)" onClick={() => actions.attempt(() => actions.exportCorrection('lumilook'))}><Icon name="file" /> .lumilook</button>
            </div>
          )}
          <button className="icon-button chain-collapse" id="toggle-chain" aria-expanded={visible} aria-label={visible ? 'Réduire la chaîne d’effets' : 'Développer la chaîne d’effets'} title={visible ? 'Réduire la chaîne d’effets' : 'Développer la chaîne d’effets'} onClick={() => actions.setChainVisible(!visible)}>
            <Icon name={visible ? 'chevron-down' : 'chevron-up'} />
          </button>
        </div>
      </div>
      {visible && (
        <div className="effect-chain" id="effect-chain">
          <div className="chain-end"><div><Icon name={f.type === 'video' ? 'clapperboard' : 'image'} /></div><span>Source<small>sRGB · ORIGINAL</small></span></div>
          {nodes.map(([key, name, icon, sub, target]) => (
            <div key={key} className="chain-node-wrap">
              <span className="chain-connector" aria-hidden="true" />
              <div className={'effect-node' + (selectedFor(key) ? ' selected' : '') + (f.enabled[key] === false ? ' disabled' : '')} data-node={key} tabIndex={0} role="button" aria-label={`Régler ${name}`}
                onClick={(e) => { if (!(e.target as Element).closest('[data-toggle]')) actions.activateTab(target); }}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actions.activateTab(target); } }}>
                <span className="node-icon"><Icon name={icon} /></span>
                <span className="node-content"><strong>{name}</strong><small>{sub}</small></span>
                <button className="node-toggle" data-toggle={key} aria-label={`${f.enabled[key] === false ? 'Activer' : 'Désactiver'} ${name}`} aria-pressed={f.enabled[key] !== false} onClick={(e) => { e.stopPropagation(); actions.toggleGroup(key); }}><Icon name="power" /></button>
              </div>
            </div>
          ))}
          <span className="chain-connector" aria-hidden="true" />
          <div className="chain-end"><div><Icon name="sparkle" /></div><span>Votre look<small>{(preset?.name || 'Original').toUpperCase()}</small></span></div>
        </div>
      )}
    </section>
  );
}
