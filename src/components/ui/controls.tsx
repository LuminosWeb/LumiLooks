import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/* One floating popup (select list or menu) at a time. */
let floating: (() => void) | null = null;
export function closePopups() { const close = floating; floating = null; close?.(); }
export function claimPopup(close: () => void) { if (floating !== close) closePopups(); floating = close; }
export function releasePopup(close: () => void) { if (floating === close) floating = null; }

const clampTo = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const roundTo = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));

/* ---------- Slider ---------- */
export interface SliderProps {
  value: number; min?: number; max?: number; step?: number; id?: string; className?: string; disabled?: boolean; title?: string;
  ariaLabel: string; ariaValueText?: string; onChange: (value: number) => void; onCommit?: () => void; onReset?: () => void; style?: CSSProperties;
}
export function Slider({ value, min = 0, max = 100, step = 1, id, className = '', disabled, title, ariaLabel, ariaValueText, onChange, onCommit, onReset, style }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const v = clampTo(Number.isFinite(value) ? value : min, min, max);
  const fill = ((v - min) / Math.max(0.000001, max - min)) * 100;
  const set = (next: number) => { const n = roundTo(clampTo(next, min, max), step); if (n !== v) onChange(n); };
  const down = (event: RPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const el = ref.current!;
    el.focus();
    const rect = el.getBoundingClientRect();
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent | RPointerEvent) => set(min + ((clampTo((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * (max - min)) / step) * step);
    move(event);
    const stop = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', stop); el.removeEventListener('pointercancel', stop); onCommit?.(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = step * (event.shiftKey ? 10 : 1);
    let next = v;
    if (['ArrowRight', 'ArrowUp'].includes(event.key)) next += big;
    else if (['ArrowLeft', 'ArrowDown'].includes(event.key)) next -= big;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key === 'PageUp') next += step * 10;
    else if (event.key === 'PageDown') next -= step * 10;
    else return;
    event.preventDefault(); event.stopPropagation();
    set(next); onCommit?.();
  };
  return (
    <div ref={ref} id={id} className={'ll-slider ' + className} role="slider" tabIndex={disabled ? -1 : 0} title={title} aria-label={ariaLabel}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={v} aria-valuetext={ariaValueText ?? String(v).replace('.', ',')} aria-disabled={disabled}
      data-disabled={disabled || undefined} style={{ ...style, ['--fill' as string]: fill + '%' }} onPointerDown={down} onKeyDown={key} onDoubleClick={onReset}>
      <span className="ll-slider-track"><span className="ll-slider-fill" /></span>
      <span className="ll-slider-thumb" />
    </div>
  );
}

/* ---------- Select ---------- */
export interface Option { value: string; label: string; disabled?: boolean }
export function Select({ value, options, onChange, ariaLabel, id, className = '', disabled }: { value: string; options: Option[]; onChange: (value: string) => void; ariaLabel: string; id?: string; className?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const listId = useId(), typed = useRef({ text: '', at: 0 });
  const [pos, setPos] = useState<CSSProperties>({});
  const selected = options.find((o) => o.value === value) || options[0];
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { if (open) claimPopup(close); else releasePopup(close); return () => releasePopup(close); }, [open, close]);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 190), innerWidth - 24);
    const height = Math.min(options.length * 34 + 12, 300, innerHeight - 24);
    setPos({ width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), maxHeight: height, top: rect.bottom + height + 6 > innerHeight ? Math.max(12, rect.top - height - 5) : rect.bottom + 5 });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useEffect(() => { list.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false); button.current?.focus();
    if (option.value !== value) onChange(option.value);
  };
  const openList = () => { if (disabled || !options.length) return; setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const key = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { setOpen(false); return; }
      if (event.key === 'Enter' || event.key === ' ') { if (open) choose(active); else openList(); return; }
      if (!open) { openList(); return; }
      if (event.key === 'ArrowDown') setActive((a) => (a + 1) % options.length);
      if (event.key === 'ArrowUp') setActive((a) => (a + options.length - 1) % options.length);
      if (event.key === 'Home') setActive(0);
      if (event.key === 'End') setActive(options.length - 1);
      return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const t = typed.current;
      t.text = (Date.now() - t.at > 700 ? '' : t.text) + event.key.toLocaleLowerCase('fr'); t.at = Date.now();
      const index = options.findIndex((o) => o.label.toLocaleLowerCase('fr').startsWith(t.text));
      if (index >= 0) { if (open) setActive(index); else choose(index); }
    }
  };
  return (
    <div className={'ll-select ' + className} id={id}>
      <button ref={button} type="button" className="ll-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined} aria-label={`${ariaLabel} : ${selected?.label || ''}`} title={selected?.label} disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={key}>
        <span>{selected?.label}</span><Icon name="chevron-down" />
      </button>
      {open && createPortal(
        <div ref={list} className="ll-listbox" id={listId} role="listbox" aria-label={ariaLabel} style={{ ...pos, position: 'fixed' }}>
          {options.map((option, index) => (
            <div key={option.value} id={`${listId}-${index}`} className={'ll-option' + (index === active ? ' active' : '')} role="option" aria-selected={option.value === value} aria-disabled={!!option.disabled}
              onPointerDown={(e) => e.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
              <span>{option.label}</span>{option.value === value && <Icon name="check" />}
            </div>
          ))}
        </div>, document.body)}
    </div>
  );
}

/* ---------- Number field ---------- */
export function NumberField({ value, min = -Infinity, max = Infinity, step = 1, onChange, ariaLabel, id, className = '', disabled, decimals }: { value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void; ariaLabel: string; id?: string; className?: string; disabled?: boolean; decimals?: number }) {
  const format = (v: number) => (decimals !== undefined ? v.toFixed(decimals) : String(Number(v.toFixed(6)))).replace('.', ',');
  const [text, setText] = useState(format(value));
  const input = useRef<HTMLInputElement>(null), editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(format(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitText = () => {
    editing.current = false;
    const parsed = Number(text.replace(/\s/g, '').replace(',', '.'));
    if (!text.trim() || !Number.isFinite(parsed)) { setText(format(value)); return; }
    const next = clampTo(parsed, min, max);
    setText(format(next));
    if (next !== value) onChange(next);
  };
  const stepBy = (direction: number) => { const next = Number(clampTo(value + direction * step, min, max).toFixed(6)); setText(format(next)); if (next !== value) onChange(next); };
  return (
    <div className={'ll-number ' + className} id={id} data-disabled={disabled || undefined}>
      <input ref={input} className="ll-number-input" type="text" inputMode="decimal" spellCheck={false} role="spinbutton" aria-label={ariaLabel} aria-valuenow={value}
        aria-valuemin={Number.isFinite(min) ? min : undefined} aria-valuemax={Number.isFinite(max) ? max : undefined} disabled={disabled} value={text}
        onChange={(e) => { editing.current = true; setText(e.target.value); }} onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); stepBy((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
          if (e.key === 'Enter') { e.preventDefault(); commitText(); input.current?.blur(); }
        }} />
      <span className="ll-number-steps">
        {([[1, 'Augmenter', 'chevron-up'], [-1, 'Diminuer', 'chevron-down']] as const).map(([dir, name, ic]) => (
          <button key={dir} type="button" tabIndex={-1} aria-label={`${name} ${ariaLabel}`} onPointerDown={(e) => e.preventDefault()} onClick={() => stepBy(dir)} disabled={disabled}><Icon name={ic} /></button>
        ))}
      </span>
    </div>
  );
}

/* ---------- Text field ---------- */
export function TextField({ value, onChange, ariaLabel, placeholder, id, className = '', maxLength, invalid, autoFocus, inputRef }: { value: string; onChange: (value: string) => void; ariaLabel: string; placeholder?: string; id?: string; className?: string; maxLength?: number; invalid?: boolean; autoFocus?: boolean; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className={'ll-text ' + className} id={id} aria-invalid={invalid || undefined}>
      <input ref={inputRef} className="ll-text-input" type="text" autoComplete="off" spellCheck={false} aria-label={ariaLabel} placeholder={placeholder} maxLength={maxLength}
        value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ---------- Checkbox ---------- */
export function Check({ checked, onChange, label, id, disabled, title }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; id?: string; disabled?: boolean; title?: string }) {
  return (
    <div className="ll-check" id={id}>
      <button type="button" className="ll-check-button" role="checkbox" aria-checked={checked} disabled={disabled} title={title} onClick={() => onChange(!checked)}>
        <span className="ll-check-mark"><Icon name="check" /></span><span>{label}</span>
      </button>
    </div>
  );
}

/* ---------- Progress ---------- */
export function Progress({ value, max = 100, label = 'Progression de l’export' }: { value: number; max?: number; label?: string }) {
  const pct = clampTo((value / Math.max(1, max)) * 100, 0, 100);
  return <div className="ll-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} style={{ ['--progress' as string]: pct + '%' }}><span className="ll-progress-fill" /></div>;
}

/* ---------- Disclosure ---------- */
export function Disclosure({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="ll-disclosure" id={id}>
      <button type="button" className="ll-disclosure-trigger" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}><Icon name="chevron-right" /><span>{label}</span></button>
      <div id={panelId} className="ll-disclosure-panel" hidden={!open}>{children}</div>
    </div>
  );
}

/* ---------- Dialog ---------- */
export function Dialog({ open, onClose, id, label, children, className = '', canClose = true }: { open: boolean; onClose: () => void; id: string; label: string; children: ReactNode; className?: string; canClose?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), previous = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    closePopups();
    previous.current = document.activeElement;
    const app = document.querySelector('.app') as HTMLElement | null;
    if (app) app.inert = true;
    const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]') || [])].filter((el) => el.getClientRects().length && !el.closest('[hidden]'));
    requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('[autofocus],.ll-text-input') || focusables()[0] || ref.current)?.focus());
    return () => {
      if (app) app.inert = false;
      const prev = previous.current as HTMLElement | null;
      if (prev?.getClientRects().length) prev.focus();
    };
  }, [open]);
  if (!open) return null;
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (canClose) onClose(); }
    if (event.key === 'Tab') {
      const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]') || [])].filter((el) => el.getClientRects().length && !el.closest('[hidden]'));
      const first = nodes[0], last = nodes.at(-1);
      if (!nodes.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  return createPortal(
    <div ref={ref} className={'ll-dialog ' + className} id={id} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} data-open="" onKeyDown={key}>
      <div className="ll-dialog-backdrop" aria-hidden="true" onClick={() => canClose && onClose()} />
      <div className="ll-dialog-panel">{children}</div>
    </div>, document.body);
}
