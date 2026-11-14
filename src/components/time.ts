export const clipTime = (seconds: number) => { const s = Math.max(0, seconds || 0); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
export const timecode = (seconds: number, fps = 30) => { const s = Math.max(0, seconds || 0); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}:${String(Math.floor((s % 1) * fps)).padStart(2, '0')}`; };
export const duration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return m < 60 ? `${m} min ${String(r).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
