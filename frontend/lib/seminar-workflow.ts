import type { Seminar } from './seminar';

export function lastUnlockedStep(record: Seminar | null, alignmentConfirmed = Boolean(record?.aligned), partsDirty = false): number {
  if (!record) return 0;
  if (!record.videos.speaker || !record.videos.screen || record.uploading_views.length) return 1;
  if (!alignmentConfirmed) return 2;
  if (!record.segments?.length || partsDirty) return 3;
  return ['completed', 'completed_with_warnings'].includes(record.status) ? 5 : 4;
}
export function allowedStep(requested: number, maximum: number): number {
  return Number.isInteger(requested) ? Math.max(0, Math.min(maximum, requested)) : 0;
}
