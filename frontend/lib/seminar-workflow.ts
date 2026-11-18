import type { Seminar } from './seminar';

export function lastUnlockedStep(record: Seminar | null, alignmentConfirmed = Boolean(record?.aligned), partsDirty = false): number {
  if (!record) return 0;
  if (!record.videos.speaker || record.uploading_views.length || record.recordings_submitted === false || (!record.videos.screen && !(record.recordings_submitted ?? record.aligned))) return 1;
  if (record.videos.screen && !alignmentConfirmed) return 2;
  if (!record.segments?.length || partsDirty) return 3;
  return ['completed', 'completed_with_warnings'].includes(record.status) ? 5 : 4;
}
export function allowedStep(requested: number, maximum: number): number {
  return Number.isInteger(requested) ? Math.max(0, Math.min(maximum, requested)) : 0;
}

export function workflowSteps(record: Seminar | null): number[] {
  return record?.recordings_submitted && record.videos.speaker && !record.videos.screen
    ? [0, 1, 3, 4, 5] : [0, 1, 2, 3, 4, 5];
}
export function availableStep(requested: number, maximum: number, visible: number[]): number {
  const clamped = allowedStep(requested, maximum);
  return clamped === 2 && !visible.includes(2) ? Math.min(3, maximum) : clamped;
}
