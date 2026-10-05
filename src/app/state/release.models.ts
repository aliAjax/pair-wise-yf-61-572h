export type BatchStatus = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'rolled_back';

export type VersionStatus = 'active' | 'revoked';

export interface FirmwareVersion {
  id: string;
  model: string;
  version: string;
  status: VersionStatus;
  releasedAt: string;
}

export interface DeviceGroup {
  id: string;
  name: string;
  region: string;
  model: string;
  count: number;
  compatible: boolean;
  offlineGateways: number;
}

export interface ReleaseBatch {
  id: string;
  name: string;
  firmware: string;
  rollbackVersion: string;
  groupId: string;
  rolloutPercent: number;
  failureThreshold: number;
  status: BatchStatus;
  progress: number;
  downloaded: number;
  failed: number;
  upgradePath: string[];
  pathValid: boolean;
  pathError: string | null;
  updatedAt: string;
}

export interface RepairEntry {
  id: string;
  batchId: string;
  batchName: string;
  model: string;
  version: string;
  count: number;
  reason: string;
  at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
}

export interface ReleaseState {
  groups: DeviceGroup[];
  versions: FirmwareVersion[];
  batches: ReleaseBatch[];
  repairs: RepairEntry[];
  audits: AuditEntry[];
}
