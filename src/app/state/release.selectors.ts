import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { ReleaseState } from './release.models';

export const selectRelease = createFeatureSelector<ReleaseState>('release');
export const selectGroups = createSelector(selectRelease, (state) => state.groups);
export const selectFirmware = createSelector(selectRelease, (state) => state.firmware);
export const selectBatches = createSelector(selectRelease, (state) => state.batches);
export const selectRepairs = createSelector(selectRelease, (state) => state.repairs);
export const selectAudits = createSelector(selectRelease, (state) => state.audits);
