import { createAction, props } from '@ngrx/store';
import type { ReleaseBatch } from './release.models';

export const createBatch = createAction('[Release] Create batch', props<{ batch: ReleaseBatch }>());
export const approveBatch = createAction('[Release] Approve batch', props<{ id: string; actor: string }>());
export const pauseBatch = createAction('[Release] Pause batch', props<{ id: string; actor: string }>());
export const resumeBatch = createAction('[Release] Resume batch', props<{ id: string; actor: string }>());
export const rollbackBatch = createAction('[Release] Rollback batch', props<{ id: string; actor: string }>());
export const computePath = createAction('[Release] Compute path', props<{ id: string; actor: string }>());
export const updateManifest = createAction('[Release] Update manifest', props<{ id: string; firmware: string; rollbackVersion: string; groupId: string; actor: string }>());
export const revokeFirmware = createAction('[Release] Revoke firmware', props<{ firmwareId: string; actor: string }>());
export const restoreFirmware = createAction('[Release] Restore firmware', props<{ firmwareId: string; actor: string }>());
export const telemetryTick = createAction('[Release] Telemetry tick');
