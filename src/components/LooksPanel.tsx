import { useMemo, useRef } from 'react';
import { Icon } from './ui/Icon';
import { Select, TextField } from './ui/controls';
import { useStore, setState, type Collection } from '../state/store';
import * as actions from '../state/actions';
import { presets } from '../lib/color';

const categories = ['Tous', 'Essentiels', 'Cinéma', 'Argentique', 'Signature', 'Optique', 'DAEDAL Cinematic', 'Film argentique', 'slay Cinematic', 'OpenLUTs', 'OpenLUTs · Technique'];

export function LooksPanel() {
  const collapsed = useStore((s) => s.leftCollapsed), bundled = useStore((s) => s.bundled), customLooks = useStore((s) => s.customLooks);
  const favorites = useStore((s) => s.favorites), collection = useStore((s) => s.collection), category = useStore((s) => s.category), search = useStore((s) => s.search);
  const selected = useStore((s) => s.files.find((f) => f.id === s.activeId)?.preset), lookThumbs = useStore((s) => s.lookThumbs);
  const fileThumb = useStore((s) => (s.activeId ? s.fileThumbs[s.activeId] : undefined));
  const searchInput = useRef<HTMLInputElement>(null);
  const all = useMemo(() => [...presets, ...bundled, ...customLooks], [bundled, customLooks]);
  const fav = useMemo(() => new Set(favorites), [favorites]);
  const matching = all.filter((p) => (!search || (p.name + ' ' + p.category).toLowerCase().includes(search.toLowerCase()))
    && (category === 'Tous' || p.category === category)
    && (collection === 'Tous' || (collection === 'Packs' && p.pack) || (collection === 'Favoris' && fav.has(p.id)) || (collection === 'Mes looks' && p.custom)));

  if (collapsed) return (
    <aside className="looks-panel collapsed" aria-label="Les looks (réduit)">
      <button className="icon-button rail-toggle" id="expand-left" aria-label="Afficher les looks" title="Afficher les looks" onClick={actions.toggleLeft}><Icon name="expand-left" /></button>
      <span className="rail-label">Les looks</span>
    </aside>
  );
  return (
    <aside className="looks-panel" aria-label="Les looks">
      <div className="panel-heading">
        <div><h1>Les looks<span className="small-count" id="look-count">{all.length}</span></h1></div>
        <div className="panel-heading-actions">
          <button className="icon-button" id="save-look" aria-label="Enregistrer mon look" title="Enregistrer mon look" onClick={() => actions.attempt(actions.saveLook)}><Icon name="bookmark-plus" /></button>
          <button className="icon-button" id="collapse-left" aria-label="Réduire le panneau des looks" title="Réduire le panneau des looks" onClick={actions.toggleLeft}><Icon name="collapse-left" /></button>
        </div>
      </div>
      <div className="search-box" onClick={() => searchInput.current?.focus()}>
        <Icon name="search" />
        <TextField id="search" inputRef={searchInput} value={search} placeholder="Rechercher un look…" ariaLabel="Rechercher un look" onChange={(value) => setState({ search: value })} />
        <kbd>/</kbd>
      </div>
      <div className="collection-tabs" role="group" aria-label="Collections">
        {(['Tous', 'Packs', 'Favoris', 'Mes looks'] as Collection[]).map((c) => (
          <button key={c} data-collection={c} className={collection === c ? 'active' : ''} aria-pressed={collection === c} aria-label={c === 'Favoris' ? 'Looks favoris' : c === 'Mes looks' ? 'Mes looks' : undefined} title={c}
            onClick={() => setState({ collection: c })}>
            {c === 'Favoris' ? <Icon name="heart" /> : c === 'Mes looks' ? <Icon name="bookmark" /> : c}
          </button>
        ))}
      </div>
      <div className="collection-heading">
        <span id="collection-label">{collection === 'Tous' ? 'LA COLLECTION LUMINOS' : collection.toUpperCase()}</span>
        <Select id="category" ariaLabel="Catégorie de looks" value={category} options={categories.map((c) => ({ value: c, label: c === 'Tous' ? 'Tout voir' : c }))} onChange={(value) => setState({ category: value })} />
      </div>
      <div className="preset-grid" id="preset-grid">
        {matching.length ? matching.map((p) => (
          <div key={p.id} className={'preset-card' + (selected === p.id ? ' selected' : '')} data-preset-card={p.id}>
            <button className="preset-select" data-preset={p.id} title={p.description} aria-pressed={selected === p.id} onClick={() => actions.applyPreset(p.id)}>
              <div className="preset-image">
                {lookThumbs[p.id] || fileThumb ? <img src={lookThumbs[p.id] || fileThumb} alt="" loading="lazy" draggable={false} /> : <span className="preset-placeholder" style={{ background: p.color }} />}
                {selected === p.id && <span className="preset-check"><Icon name="check" /></span>}
              </div>
              <span className="preset-name">{p.name}</span>
              <span className="preset-category">{p.category}</span>
            </button>
            <button className={'preset-favorite' + (fav.has(p.id) ? ' saved' : '')} data-favorite={p.id} aria-pressed={fav.has(p.id)}
              aria-label={`${fav.has(p.id) ? 'Retirer' : 'Ajouter'} ${p.name} ${fav.has(p.id) ? 'des' : 'aux'} favoris`} onClick={() => actions.toggleFavorite(p.id)}><Icon name="heart" /></button>
            {p.custom && <button className="preset-remove" data-remove-look={p.id} aria-label={`Supprimer le look ${p.name}`} onClick={() => actions.removeLook(p.id)}><Icon name="x" /></button>}
          </div>
        )) : (
          <p className="preset-empty">{collection === 'Mes looks' ? 'Enregistrez vos réglages avec le bouton marque-page pour créer votre collection.' : collection === 'Favoris' ? 'Cliquez sur le cœur d’un look pour le retrouver ici.' : 'Aucun look ne correspond à votre recherche.'}</p>
        )}
      </div>
    </aside>
  );
}
