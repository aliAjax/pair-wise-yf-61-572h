import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { ReleaseState } from './release.models';

export const selectRelease = createFeatureSelector<ReleaseState>('release');
export const selectGroups = createSelector(selectRelease, (state) => state.groups);
export const selectBatches = createSelector(selectRelease, (state) => state.batches);
export const selectAudits = createSelector(selectRelease, (state) => state.audits);
export const selectVersions = createSelector(selectRelease, (state) => state.versions);
export const selectRepairs = createSelector(selectRelease, (state) => state.repairs);

export const selectVersionsByModel = createSelector(selectVersions, (versions) => {
  const grouped = new Map<string, typeof versions>();
  for (const version of versions) {
    const list = grouped.get(version.model) ?? [];
    list.push(version);
    grouped.set(version.model, list);
  }
  return grouped;
});

export const selectRevokedVersions = createSelector(selectVersions, (versions) =>
  versions.filter((v) => v.status === 'revoked')
);
