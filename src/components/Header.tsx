import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './ui/Icon';
import { claimPopup, closePopups, releasePopup } from './ui/controls';
import { useStore, getState, setState } from '../state/store';
import * as actions from '../state/actions';
import * as platform from '../lib/platform';
import { zoomFit } from '../engine/engine';
import { showExport } from './exportController';

type MenuItem = { kind: 'item'; id: string; label: string; icon?: IconName; shortcut?: string; action: () => void; disabled?: boolean; hidden?: boolean }
  | { kind: 'check'; id: string; label: string; checked: boolean; action: () => void; role?: 'menuitemcheckbox' | 'menuitemradio' }
  | { kind: 'sub'; id: string; label: string; icon: IconName; items: MenuItem[] }
  | { kind: 'rule' };

function MenuPanel({ items, style, onClose, label, id, autoFocus }: { items: MenuItem[]; style: React.CSSProperties; onClose: (restore: boolean) => void; label: string; id: string; autoFocus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ id: string; style: React.CSSProperties; focus: boolean } | null>(null);
  useEffect(() => { if (autoFocus) ref.current?.querySelector<HTMLButtonElement>(':scope > button:not(:disabled)')?.focus(); }, [autoFocus]);
  const rows = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') || [])];
  const key = (event: KeyboardEvent) => {
    const list = rows(), index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    if (event.key === 'ArrowDown') list[(index + 1) % list.length]?.focus();
    if (event.key === 'ArrowUp') list[(index + list.length - 1) % list.length]?.focus();
    if (event.key === 'Home') list[0]?.focus();
    if (event.key === 'End') list.at(-1)?.focus();
    if (event.key === 'Escape' || event.key === 'Tab') onClose(true);
    if (event.key === 'ArrowRight') { const el = document.activeElement as HTMLElement; if (el?.dataset.submenu) { event.preventDefault(); openSub(el, el.dataset.submenu, true); } }
  };
  const openSub = (el: HTMLElement, subId: string, focus: boolean) => {
    const rect = el.getBoundingClientRect();
    setSub({ id: subId, focus, style: { left: Math.min(rect.right + 4, innerWidth - 290), top: rect.top } });
  };
  return (
    <>
      <div ref={ref} className="app-menu" id={id} role="menu" aria-label={label} style={style} onKeyDown={key}>
        {items.map((item, i) => {
          if (item.kind === 'rule') return <div key={'r' + i} className="menu-rule" role="separator" />;
          if (item.kind === 'sub') return (
            <button key={item.id} role="menuitem" data-submenu={item.id} aria-haspopup="menu" aria-expanded={sub?.id === item.id}
              onPointerEnter={(e) => openSub(e.currentTarget, item.id, false)} onClick={(e) => openSub(e.currentTarget, item.id, true)}>
              <Icon name={item.icon} />{item.label}<span className="menu-arrow"><Icon name="chevron-right" /></span>
            </button>
          );
          if (item.kind === 'check') return (
            <button key={item.id} id={item.id} role={item.role || 'menuitemcheckbox'} aria-checked={item.checked} onPointerEnter={() => setSub(null)} onClick={() => { onClose(true); item.action(); }}>
              <span className="menu-check"><Icon name="check" /></span>{item.label}
            </button>
          );
          if (item.hidden) return null;
          return (
            <button key={item.id} id={item.id} role="menuitem" disabled={item.disabled} onPointerEnter={() => setSub(null)} onClick={() => { onClose(true); item.action(); }}>
              {item.icon && <Icon name={item.icon} />}{item.label}{item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
            </button>
          );
        })}
      </div>
      {sub && (() => {
        const parent = items.find((x) => x.kind === 'sub' && x.id === sub.id) as Extract<MenuItem, { kind: 'sub' }>;
        return <MenuPanel items={parent.items} style={sub.style} label={parent.label} id={sub.id} autoFocus={sub.focus} onClose={(restore) => { setSub(null); onClose(restore); }} />;
      })()}
    </>
  );
}

export function Header() {
  const projectName = useStore((s) => s.projectName), dirty = useStore((s) => s.dirty), theme = useStore((s) => s.theme);
  const chainVisible = useStore((s) => s.chainVisible), workspace = useStore((s) => s.workspace), hasMedia = useStore((s) => s.files.length > 0);
  const activeType = useStore((s) => s.files.find((f) => f.id === s.activeId)?.type);
  const [menu, setMenu] = useState<{ id: string; focus: boolean } | null>(null);
  const [maximized, setMaximized] = useState(false);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!platform.isTauri) return;
    let unlisten: (() => void) | undefined;
    platform.appWindow().then(async (w) => {
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => unlisten?.();
  }, []);

  const close = (restore = false) => {
    const current = menu;
    setMenu(null);
    if (restore && current) triggers.current[current.id]?.focus();
  };
  const closeRef = useRef(() => setMenu(null));
  useEffect(() => { if (menu) claimPopup(closeRef.current); else releasePopup(closeRef.current); }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('.app-menu,[data-open-menu]')) setMenu(null); };
    const blur = () => setMenu(null);
    document.addEventListener('pointerdown', outside, true); window.addEventListener('blur', blur); window.addEventListener('resize', blur);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, [menu]);
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey) return;
      const k = event.key.toLowerCase();
      if (k !== 'f' && k !== 'p') return;
      event.preventDefault();
      if (document.querySelector('.ll-dialog[data-open]')) return;
      closePopups();
      setMenu({ id: k === 'f' ? 'file-menu-panel' : 'settings-menu-panel', focus: true });
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const fileItems: MenuItem[] = [
    { kind: 'item', id: 'import', label: 'Importer des médias…', icon: 'plus', shortcut: 'Ctrl O', action: () => actions.attempt(actions.importMedia) },
    { kind: 'item', id: 'open-project', label: 'Ouvrir un projet…', icon: 'folder', shortcut: 'Ctrl Maj O', action: () => actions.attempt(actions.openProject) },
    { kind: 'rule' },
    { kind: 'item', id: 'save-project', label: 'Enregistrer le projet…', icon: 'save', shortcut: 'Ctrl S', action: () => actions.attempt(actions.saveProject), disabled: !hasMedia },
    { kind: 'item', id: 'rename-project', label: 'Renommer le projet…', icon: 'pencil', shortcut: 'F2', action: () => actions.attempt(actions.renameProject) },
    { kind: 'rule' },
    { kind: 'item', id: 'import-correction-menu', label: 'Importer une correction…', icon: 'upload', action: () => actions.attempt(actions.importCorrection), disabled: !hasMedia },
    { kind: 'item', id: 'export-cube-menu', label: 'Exporter la correction (.cube)…', icon: 'download', action: () => actions.attempt(() => actions.exportCorrection('cube')), disabled: !hasMedia },
    { kind: 'item', id: 'export-lumilook-menu', label: 'Exporter la correction (.lumilook)…', icon: 'file', action: () => actions.attempt(() => actions.exportCorrection('lumilook')), disabled: !hasMedia },
    { kind: 'rule' },
    { kind: 'item', id: 'export', label: 'Exporter le média…', icon: 'export', shortcut: 'Ctrl E', action: showExport, disabled: !hasMedia },
    { kind: 'rule' },
    { kind: 'item', id: 'quit-app', label: 'Quitter', icon: 'x', shortcut: 'Alt F4', action: async () => (await platform.appWindow()).close(), hidden: !platform.isTauri },
  ];
  const settingsItems: MenuItem[] = [
    { kind: 'sub', id: 'appearance-menu', label: 'Apparence', icon: 'palette', items: [
      { kind: 'check', id: 'theme-dark', label: 'Mode sombre', checked: theme === 'dark', role: 'menuitemradio', action: () => actions.applyTheme('dark') },
      { kind: 'check', id: 'theme-light', label: 'Mode clair', checked: theme === 'light', role: 'menuitemradio', action: () => actions.applyTheme('light') },
    ] },
    { kind: 'check', id: 'view-chain', label: 'Afficher la chaîne d’effets', checked: chainVisible, action: () => actions.setChainVisible(!getState().chainVisible) },
    { kind: 'item', id: 'toggle-left', label: 'Afficher / masquer les looks', icon: 'collapse-left', action: actions.toggleLeft },
    { kind: 'item', id: 'toggle-right', label: 'Afficher / masquer les réglages', icon: 'collapse-right', action: actions.toggleRight },
    { kind: 'item', id: 'fullscreen-menu', label: 'Plein écran', icon: 'fullscreen', shortcut: 'F', action: () => actions.setFullscreen(true), disabled: !hasMedia },
    { kind: 'item', id: 'reset-view', label: 'Adapter l’aperçu à la fenêtre', icon: 'fit', action: zoomFit, disabled: !hasMedia },
    { kind: 'rule' },
    { kind: 'item', id: 'reset-menu', label: 'Réinitialiser les réglages', icon: 'reset', action: actions.resetAll, disabled: !hasMedia },
    { kind: 'item', id: 'show-help', label: 'Aide et raccourcis', icon: 'help', shortcut: '?', action: () => setState({ dialog: 'help' }) },
  ];

  const openMenu = (id: string, focus: boolean) => setMenu({ id, focus });
  const menuStyle = (id: string): React.CSSProperties => {
    const rect = triggers.current[id]?.getBoundingClientRect();
    return rect ? { left: Math.max(8, Math.min(rect.left, innerWidth - 290)), top: rect.bottom + 4 } : {};
  };
  const triggerKey = (event: KeyboardEvent, id: string) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openMenu(id, true); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = id === 'file-menu-panel' ? 'settings-menu-panel' : 'file-menu-panel';
      triggers.current[next]?.focus();
      if (menu) openMenu(next, true);
    } else if (event.key === 'Escape') { event.preventDefault(); close(true); }
  };
  const windowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    const w = await platform.appWindow();
    if (action === 'minimize') await w.minimize();
    if (action === 'maximize') await w.toggleMaximize();
    if (action === 'close') await w.close();
  };

  return (
    <header className="app-header" data-tauri-drag-region>
      <nav className="app-menubar" role="menubar" aria-label="Menus de l’application">
        {[['file-menu-panel', 'Fichier', 'file-menu'], ['settings-menu-panel', 'Paramètres', 'settings-menu']].map(([panel, label, id]) => (
          <button key={panel} id={id} ref={(el) => { triggers.current[panel] = el; }} role="menuitem" data-open-menu={panel} aria-haspopup="menu" aria-controls={panel} aria-expanded={menu?.id === panel}
            onClick={() => (menu?.id === panel ? close(true) : openMenu(panel, true))} onPointerEnter={() => menu && menu.id !== panel && openMenu(panel, false)} onKeyDown={(e) => triggerKey(e, panel)}>
            {label}
          </button>
        ))}
      </nav>
      <button className="project-name" id="project-name" title="Renommer le projet" onClick={() => actions.attempt(actions.renameProject)}>
        <span id="window-project">{projectName}{dirty && hasMedia ? ' · Modifié' : ''}</span><Icon name="pencil" />
      </button>
      <nav className="workspace-tabs" aria-label="Espace de travail" data-tauri-drag-region>
        <button id="grade-tab" className={workspace === 'grade' ? 'active' : ''} aria-pressed={workspace === 'grade'} onClick={() => actions.setWorkspace('grade')}><Icon name="sliders" /> Étalonnage</button>
        <button id="edit-tab" className={workspace === 'edit' ? 'active' : ''} aria-pressed={workspace === 'edit'} disabled={activeType !== 'video'} title={activeType === 'video' ? 'Découpe, vitesse et audio' : 'Importez une vidéo pour la monter'} onClick={() => actions.setWorkspace('edit')}><Icon name="clapperboard" /> Montage</button>
      </nav>
      <a className="website-logo" data-luminos-link href={platform.WEBSITE_URL} target="_blank" rel="noopener noreferrer" aria-label="Visiter le site LuminosWeb" title="Visiter luminosweb.com" draggable={false}
        onClick={(e) => { e.preventDefault(); actions.attempt(() => platform.openWebsite()); }}>
        <img src="/assets/icon.png" alt="LuminosWeb" draggable={false} />
      </a>
      {platform.isTauri && (
        <div className="window-buttons">
          <button data-window="minimize" aria-label="Réduire" onClick={() => windowAction('minimize')}><Icon name="minus" /></button>
          <button data-window="maximize" aria-label={maximized ? 'Restaurer' : 'Agrandir'} onClick={() => windowAction('maximize')}><Icon name={maximized ? 'window-restore' : 'square'} /></button>
          <button data-window="close" aria-label="Fermer" onClick={() => windowAction('close')}><Icon name="x" /></button>
        </div>
      )}
      {menu?.id === 'file-menu-panel' && <MenuPanel items={fileItems} id="file-menu-panel" label="Fichier" style={menuStyle('file-menu-panel')} autoFocus={menu.focus} onClose={close} />}
      {menu?.id === 'settings-menu-panel' && <MenuPanel items={settingsItems} id="settings-menu-panel" label="Paramètres" style={menuStyle('settings-menu-panel')} autoFocus={menu.focus} onClose={close} />}
    </header>
  );
}
