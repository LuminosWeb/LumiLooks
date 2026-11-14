import { defaults, groups } from '../../lib/color';
import type { Tab } from '../../state/store';
export const lightKeys = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'gamma', 'fade'];
export const colorKeys = ['temperature', 'tint', 'vibrance', 'saturation', 'hueShift', 'dehaze', 'redGain', 'greenGain', 'blueGain'];
export function adjustmentKeys(tab: Tab): string[] {
  if (tab === 'light') return lightKeys;
  if (tab === 'color') return colorKeys;
  if (tab === 'mixer') return Object.keys(defaults).filter((k) => k.startsWith('hsl'));
  if (tab === 'curves') return Object.keys(defaults).filter((k) => k.startsWith('curve'));
  return (groups as Record<string, string[]>)[tab] || [];
}
