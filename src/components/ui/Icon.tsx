import icons from '../../generated/icons.json';

export type IconName = keyof typeof icons;
/** Solid SVG icon (MingCute fill set from Iconify). */
export function Icon({ name, className, title }: { name: IconName; className?: string; title?: string }) {
  const data = icons[name];
  if (!data) throw Error(`Icône inconnue : ${name}`);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${data.width} ${data.height}`} data-icon={data.id} className={className} aria-hidden={title ? undefined : true} focusable="false"
      role={title ? 'img' : undefined} dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + data.body }} />
  );
}
