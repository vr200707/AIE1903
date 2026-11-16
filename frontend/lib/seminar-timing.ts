/** Speaker time is canonical. Screen time = speaker time + offset. */
export function overlapSeconds(speaker: number, screen: number, offset: number): [number, number] | null {
  if (![speaker, screen, offset].every(Number.isFinite)) return null;
  const start = Math.max(0, -offset);
  const end = Math.min(speaker, screen - offset);
  return end > start ? [start, end] : null;
}
export function synchronizedTimes(time: number, offset: number, bounds: [number, number]): [number, number] {
  const speaker = Math.max(bounds[0], Math.min(bounds[1], time));
  return [speaker, speaker + offset];
}
