export type BatchStatus = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'rolled_back';
export type FirmwareStatus = 'published' | 'revoked';

export interface FirmwareVersion {
  id: string;
  model: string;
  version: string;
  status: FirmwareStatus;
  releasedAt: string;
}

export interface DeviceGroup {
  id: string;
  name: string;
  region: string;
  count: number;
  compatible: boolean;
  offlineGateways: number;
  model: string;
  currentVersion: string;
}

export interface UpgradePath {
  model: string;
  from: string;
  to: string;
  /** 沿固件仓库顺序逐版本衔接的升级步骤，不含当前版本、含目标版本。 */
  steps: string[];
  /** 接不上时的原因；为 null 表示路径可用。 */
  blocked: string | null;
  computedAt: string;
}

export interface RepairEntry {
  id: string;
  batchId: string;
  batchName: string;
  groupId: string;
  model: string;
  version: string;
  deviceCount: number;
  at: string;
  status: 'pending';
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
  updatedAt: string;
  path: UpgradePath | null;
  /** 升级清单或固件仓库改动后置为 true，审批前必须重算路径。 */
  pathStale: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
}

export interface ReleaseState {
  groups: DeviceGroup[];
  firmware: FirmwareVersion[];
  batches: ReleaseBatch[];
  repairs: RepairEntry[];
  audits: AuditEntry[];
}
