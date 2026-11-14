import { Icon } from './ui/Icon';
import { useStore } from '../state/store';
import * as actions from '../state/actions';

export function MediaStrip() {
  const files = useStore((s) => s.files), activeId = useStore((s) => s.activeId), thumbs = useStore((s) => s.fileThumbs);
  return (
    <section className="media-strip" aria-label="Médias importés">
      <div className="strip-label"><Icon name="folder" /><span>Médias <b id="media-count">{files.length}</b></span></div>
      <div id="media-list" className="media-list">
        {files.map((f) => (
          <div key={f.id} className={'media-item' + (f.id === activeId ? ' selected' : '')}>
            <button data-media={f.id} aria-label={`Sélectionner ${f.name}`} aria-pressed={f.id === activeId} onClick={() => actions.attempt(() => actions.selectMedia(f.id))}>
              {thumbs[f.id] ? <img src={thumbs[f.id]} alt="" draggable={false} /> : <span className="media-placeholder"><Icon name={f.type === 'video' ? 'clapperboard' : 'image'} /></span>}
              <span className="media-type">{f.type === 'video' ? 'VIDÉO' : 'PHOTO'}</span>
            </button>
            <button className="remove-media" data-remove-media={f.id} aria-label={`Retirer ${f.name} du projet`} onClick={() => actions.removeMedia(f.id)}><Icon name="x" /></button>
            <span className="name" title={f.name}>{f.name}</span>
          </div>
        ))}
      </div>
      <button className="add-media" id="add-media" aria-label="Ajouter des médias" title="Ajouter des médias" onClick={() => actions.attempt(actions.importMedia)}><Icon name="plus" /></button>
    </section>
  );
}
