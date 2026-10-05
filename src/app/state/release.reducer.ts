import { createReducer, on } from '@ngrx/store';
import type { MetaReducer } from '@ngrx/store';
import type { AuditEntry, DeviceGroup, FirmwareVersion, ReleaseBatch, ReleaseState, RepairEntry, VersionStatus } from './release.models';
import { approveBatch, createBatch, pauseBatch, recalculatePaths, reopenVersion, resumeBatch, revokeVersion, rollbackBatch, telemetryTick } from './release.actions';
import { computeUpgradePath, recalculateAllPaths } from './upgrade-path';

export const STORAGE_KEY = 'firmware-release-v1';

const initialGroups: DeviceGroup[] = [
  { id: 'g-edge', name: '华东边缘网关', region: '华东', model: 'EDGE-GW', count: 680, compatible: true, offlineGateways: 4 },
  { id: 'g-plant', name: '工业采集终端', region: '华南', model: 'PLANT-IO', count: 1240, compatible: false, offlineGateways: 12 },
  { id: 'g-clinic', name: '远程诊疗终端', region: '新加坡', model: 'CLINIC-DX', count: 310, compatible: true, offlineGateways: 2 },
];

const initialVersions: FirmwareVersion[] = [
  { id: 'fw-edge-279', model: 'EDGE-GW', version: '2.7.9', status: 'active', releasedAt: '2026-01-15T00:00:00.000Z' },
  { id: 'fw-edge-280', model: 'EDGE-GW', version: '2.8.0', status: 'active', releasedAt: '2026-03-20T00:00:00.000Z' },
  { id: 'fw-edge-281', model: 'EDGE-GW', version: '2.8.1', status: 'active', releasedAt: '2026-05-10T00:00:00.000Z' },
  { id: 'fw-edge-290', model: 'EDGE-GW', version: '2.9.0', status: 'active', releasedAt: '2026-07-01T00:00:00.000Z' },
  { id: 'fw-edge-292', model: 'EDGE-GW', version: '2.9.2', status: 'active', releasedAt: '2026-08-18T00:00:00.000Z' },
  { id: 'fw-edge-300', model: 'EDGE-GW', version: '3.0.0', status: 'active', releasedAt: '2026-09-30T00:00:00.000Z' },
  { id: 'fw-plant-100', model: 'PLANT-IO', version: '1.0.0', status: 'active', releasedAt: '2025-11-01T00:00:00.000Z' },
  { id: 'fw-plant-110', model: 'PLANT-IO', version: '1.1.0', status: 'active', releasedAt: '2026-02-14T00:00:00.000Z' },
  { id: 'fw-plant-120', model: 'PLANT-IO', version: '1.2.0', status: 'active', releasedAt: '2026-06-22T00:00:00.000Z' },
  { id: 'fw-clinic-500', model: 'CLINIC-DX', version: '5.0.0', status: 'active', releasedAt: '2026-04-05T00:00:00.000Z' },
  { id: 'fw-clinic-501', model: 'CLINIC-DX', version: '5.0.1', status: 'revoked', releasedAt: '2026-05-19T00:00:00.000Z' },
  { id: 'fw-clinic-510', model: 'CLINIC-DX', version: '5.1.0', status: 'active', releasedAt: '2026-08-08T00:00:00.000Z' },
];

const now = new Date().toISOString();
const initialBatches: ReleaseBatch[] = [
  { id: 'batch-demo', name: '边缘网关安全补丁 2.8.1', firmware: '2.8.1', rollbackVersion: '2.7.9', groupId: 'g-edge', rolloutPercent: 20, failureThreshold: 5, status: 'approved', progress: 0, downloaded: 0, failed: 0, upgradePath: ['2.7.9', '2.8.0', '2.8.1'], pathValid: true, pathError: null, updatedAt: now },
  { id: 'batch-done', name: '边缘网关 2.8.0 全覆盖', firmware: '2.8.0', rollbackVersion: '2.7.9', groupId: 'g-edge', rolloutPercent: 100, failureThreshold: 5, status: 'completed', progress: 100, downloaded: 680, failed: 0, upgradePath: ['2.7.9', '2.8.0'], pathValid: true, pathError: null, updatedAt: now },
  { id: 'batch-running', name: '边缘网关 2.9.0 灰度', firmware: '2.9.0', rollbackVersion: '2.8.1', groupId: 'g-edge', rolloutPercent: 50, failureThreshold: 5, status: 'running', progress: 29, downloaded: 100, failed: 2, upgradePath: ['2.8.1', '2.9.0'], pathValid: true, pathError: null, updatedAt: now },
];
const initialAudits: AuditEntry[] = [{ id: 'audit-1', at: now, actor: '运维值班', message: '批次 batch-demo 完成兼容性检查并进入已审批' }];

const fallback: ReleaseState = { groups: initialGroups, versions: initialVersions, batches: initialBatches, repairs: [], audits: initialAudits };

function loadState(): ReleaseState {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ReleaseState> | null;
    if (!stored) return fallback;
    const versions = stored.versions ?? initialVersions;
    const groups = (stored.groups ?? initialGroups).map((group) => {
      if (group.model) return group;
      const initial = initialGroups.find((g) => g.id === group.id);
      return { ...group, model: initial?.model ?? 'UNKNOWN' };
    });
    const rawBatches = stored.batches ?? initialBatches;
    const batches = rawBatches.map((batch) => {
      if (batch.pathValid !== undefined) return batch;
      const group = groups.find((g) => g.id === batch.groupId);
      if (!group) return { ...batch, upgradePath: [], pathValid: false, pathError: '设备分组不存在' };
      const result = computeUpgradePath(versions, group.model, batch.rollbackVersion, batch.firmware);
      return { ...batch, upgradePath: result.path, pathValid: result.valid, pathError: result.error };
    });
    return {
      groups,
      versions,
      batches,
      repairs: stored.repairs ?? [],
      audits: stored.audits ?? initialAudits,
    };
  } catch {
    return fallback;
  }
}

const initialState = loadState();

function auditMany(state: ReleaseState, entries: { actor: string; message: string }[]): AuditEntry[] {
  const at = new Date().toISOString();
  const fresh = entries.map((entry) => ({ id: crypto.randomUUID(), at, actor: entry.actor, message: entry.message }));
  return [...fresh, ...state.audits];
}

function computeBatchPath(state: ReleaseState, batch: ReleaseBatch): ReleaseBatch {
  const group = state.groups.find((g) => g.id === batch.groupId);
  if (!group) {
    return { ...batch, upgradePath: [], pathValid: false, pathError: '设备分组不存在' };
  }
  const result = computeUpgradePath(state.versions, group.model, batch.rollbackVersion, batch.firmware);
  return { ...batch, upgradePath: result.path, pathValid: result.valid, pathError: result.error };
}

export const releaseReducer = createReducer(
  initialState,
  on(createBatch, (state, { batch }) => {
    const enriched = computeBatchPath(state, batch);
    const audits = auditMany(state, [
      { actor: '发布负责人', message: `创建批次 ${batch.name}` },
      { actor: '系统', message: enriched.pathValid ? `升级路径校验通过：${enriched.upgradePath.join(' → ')}` : `升级路径接不上，不予审批：${enriched.pathError ?? '未知错误'}` },
    ]);
    return { ...state, batches: [enriched, ...state.batches], audits };
  }),
  on(approveBatch, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    if (!batch.pathValid) {
      return { ...state, audits: auditMany(state, [{ actor, message: `批次 ${batch.name} 升级路径接不上（${batch.pathError ?? '未知错误'}），不予审批` }]) };
    }
    return { ...state, batches: state.batches.map((b) => b.id === id ? { ...b, status: 'approved', updatedAt: new Date().toISOString() } : b), audits: auditMany(state, [{ actor, message: `批次 ${batch.name} 审批通过` }]) };
  }),
  on(pauseBatch, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    return { ...state, batches: state.batches.map((b) => b.id === id ? { ...b, status: 'paused', updatedAt: new Date().toISOString() } : b), audits: auditMany(state, [{ actor, message: `批次 ${batch.name} 已暂停` }]) };
  }),
  on(resumeBatch, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    if (!batch.pathValid) {
      return { ...state, audits: auditMany(state, [{ actor, message: `批次 ${batch.name} 升级路径接不上（${batch.pathError ?? '未知错误'}），不能继续下发` }]) };
    }
    return { ...state, batches: state.batches.map((b) => b.id === id ? { ...b, status: 'running', updatedAt: new Date().toISOString() } : b), audits: auditMany(state, [{ actor, message: `批次 ${batch.name} 恢复发布` }]) };
  }),
  on(rollbackBatch, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    return { ...state, batches: state.batches.map((b) => b.id === id ? { ...b, status: 'rolled_back', updatedAt: new Date().toISOString() } : b), audits: auditMany(state, [{ actor, message: `批次 ${batch.name} 已紧急回滚` }]) };
  }),
  on(revokeVersion, (state, { versionId, actor }) => {
    const version = state.versions.find((v) => v.id === versionId);
    if (!version || version.status === 'revoked') return state;
    const revokedVersion = version.version;
    const at = new Date().toISOString();

    const versions = state.versions.map((v) => v.id === versionId ? { ...v, status: 'revoked' as VersionStatus } : v);

    const newRepairs: RepairEntry[] = [];
    const batchAudits: { actor: string; message: string }[] = [];

    const batches = state.batches.map((batch) => {
      const affected = batch.firmware === revokedVersion
        || batch.rollbackVersion === revokedVersion
        || batch.upgradePath.includes(revokedVersion);
      if (!affected) return batch;

      let newStatus = batch.status;
      if (batch.status === 'draft' || batch.status === 'approved') {
        newStatus = 'draft';
        batchAudits.push({ actor: '系统', message: `批次 ${batch.name} 未开始，已退回草稿` });
      } else if (batch.status === 'running') {
        newStatus = 'paused';
        batchAudits.push({ actor: '系统', message: `批次 ${batch.name} 推进中，已停在下一次下发前` });
      }

      if (batch.firmware === revokedVersion && batch.downloaded > 0 && batch.status !== 'rolled_back') {
        const group = state.groups.find((g) => g.id === batch.groupId);
        const count = batch.status === 'completed' ? (group?.count ?? batch.downloaded) : batch.downloaded;
        newRepairs.push({
          id: crypto.randomUUID(),
          batchId: batch.id,
          batchName: batch.name,
          model: group?.model ?? version.model,
          version: revokedVersion,
          count,
          reason: `版本 ${revokedVersion} 已撤销，已装机设备待返修`,
          at,
        });
      }

      return { ...batch, status: newStatus, updatedAt: at };
    });

    const recalculated = recalculateAllPaths(versions, state.groups, batches);

    const totalRepair = newRepairs.reduce((sum, r) => sum + r.count, 0);
    const audits = auditMany(state, [
      { actor, message: `固件版本 ${version.model} ${revokedVersion} 已撤销` },
      ...batchAudits,
      ...(newRepairs.length > 0 ? [{ actor: '系统', message: `${newRepairs.length} 个批次共 ${totalRepair} 台已装机设备列入返修单` }] : []),
    ]);

    return { ...state, versions, batches: recalculated, repairs: [...newRepairs, ...state.repairs], audits };
  }),
  on(reopenVersion, (state, { versionId, actor }) => {
    const version = state.versions.find((v) => v.id === versionId);
    if (!version || version.status === 'active') return state;
    const versions = state.versions.map((v) => v.id === versionId ? { ...v, status: 'active' as VersionStatus } : v);
    const batches = recalculateAllPaths(versions, state.groups, state.batches);
    const audits = auditMany(state, [
      { actor, message: `固件版本 ${version.model} ${version.version} 已重开` },
      { actor: '系统', message: '升级清单已变更，所有批次升级路径已重算；批次状态与返修记录保留' },
    ]);
    return { ...state, versions, batches, audits };
  }),
  on(recalculatePaths, (state) => ({ ...state, batches: recalculateAllPaths(state.versions, state.groups, state.batches) })),
  on(telemetryTick, (state) => {
    const batches = state.batches.map((batch) => {
      if (batch.status !== 'running') return batch;
      const group = state.groups.find((item) => item.id === batch.groupId);
      const target = Math.round((group?.count ?? 0) * batch.rolloutPercent / 100);
      const increment = Math.max(4, Math.round(target * 0.055));
      const downloaded = Math.min(target, batch.downloaded + increment);
      const failed = batch.failed + (Math.random() < 0.08 ? 1 : 0);
      const failureRate = downloaded ? failed / downloaded * 100 : 0;
      const status: ReleaseBatch['status'] = failureRate > batch.failureThreshold ? 'paused' : downloaded >= target ? 'completed' : 'running';
      return { ...batch, downloaded, failed, progress: target ? Math.round(downloaded / target * 100) : 0, status, updatedAt: new Date().toISOString() };
    });
    const overflow = batches.some((batch, index) => batch.status === 'paused' && state.batches[index]?.status === 'running');
    return { ...state, batches, audits: overflow ? auditMany(state, [{ actor: '系统', message: '失败率超过阈值，已自动暂停发布' }]) : state.audits };
  })
);

export const persistenceReducer: MetaReducer = (reducer) => (state, action) => {
  const nextState = reducer(state, action);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }
  return nextState;
};
