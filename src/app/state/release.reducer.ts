import { createReducer, on } from '@ngrx/store';
import type { AuditEntry, DeviceGroup, FirmwareVersion, ReleaseBatch, ReleaseState, RepairEntry } from './release.models';
import { approveBatch, computePath, createBatch, pauseBatch, restoreFirmware, resumeBatch, revokeFirmware, rollbackBatch, telemetryTick, updateManifest } from './release.actions';
import { batchTouchesVersion, computeUpgradePath } from './release.path';

const initialGroups: DeviceGroup[] = [
  { id: 'g-edge', name: '华东边缘网关', region: '华东', count: 680, compatible: true, offlineGateways: 4, model: 'EG-400', currentVersion: '2.7.9' },
  { id: 'g-plant', name: '工业采集终端', region: '华南', count: 1240, compatible: false, offlineGateways: 12, model: 'IC-210', currentVersion: '1.9.4' },
  { id: 'g-clinic', name: '远程诊疗终端', region: '新加坡', count: 310, compatible: true, offlineGateways: 2, model: 'MD-120', currentVersion: '5.2.0' }
];
// 同一型号的版本在仓库中挨着排，数组顺序即升级链顺序。
const initialFirmware: FirmwareVersion[] = [
  { id: 'fw-eg-278', model: 'EG-400', version: '2.7.8', status: 'published', releasedAt: '2026-05-11T02:00:00.000Z' },
  { id: 'fw-eg-279', model: 'EG-400', version: '2.7.9', status: 'published', releasedAt: '2026-06-02T02:00:00.000Z' },
  { id: 'fw-eg-280', model: 'EG-400', version: '2.8.0', status: 'published', releasedAt: '2026-07-18T02:00:00.000Z' },
  { id: 'fw-eg-281', model: 'EG-400', version: '2.8.1', status: 'published', releasedAt: '2026-08-26T02:00:00.000Z' },
  { id: 'fw-eg-290', model: 'EG-400', version: '2.9.0', status: 'published', releasedAt: '2026-09-15T02:00:00.000Z' },
  { id: 'fw-eg-300', model: 'EG-400', version: '3.0.0', status: 'published', releasedAt: '2026-09-28T02:00:00.000Z' },
  { id: 'fw-ic-194', model: 'IC-210', version: '1.9.4', status: 'published', releasedAt: '2026-04-09T02:00:00.000Z' },
  { id: 'fw-ic-195', model: 'IC-210', version: '1.9.5', status: 'published', releasedAt: '2026-06-21T02:00:00.000Z' },
  { id: 'fw-ic-200', model: 'IC-210', version: '2.0.0', status: 'published', releasedAt: '2026-08-30T02:00:00.000Z' },
  { id: 'fw-md-520', model: 'MD-120', version: '5.2.0', status: 'published', releasedAt: '2026-03-14T02:00:00.000Z' },
  { id: 'fw-md-521', model: 'MD-120', version: '5.2.1', status: 'published', releasedAt: '2026-07-07T02:00:00.000Z' },
  { id: 'fw-md-530', model: 'MD-120', version: '5.3.0', status: 'published', releasedAt: '2026-09-19T02:00:00.000Z' }
];
const now = new Date().toISOString();
const initialBatches: ReleaseBatch[] = [
  { id: 'batch-demo', name: '边缘网关安全补丁 2.8.1', firmware: '2.8.1', rollbackVersion: '2.7.9', groupId: 'g-edge', rolloutPercent: 20, failureThreshold: 5, status: 'approved', progress: 0, downloaded: 0, failed: 0, updatedAt: now, path: { model: 'EG-400', from: '2.7.9', to: '2.8.1', steps: ['2.8.0', '2.8.1'], blocked: null, computedAt: now }, pathStale: false }
];
const initialAudits: AuditEntry[] = [{ id: 'audit-1', at: now, actor: '运维值班', message: '批次 batch-demo 完成兼容性检查并进入已审批' }];
export const STORAGE_KEY = 'firmware-release-v2';
const fallback: ReleaseState = { groups: initialGroups, firmware: initialFirmware, batches: initialBatches, repairs: [], audits: initialAudits };
const stored = typeof localStorage === 'undefined' ? fallback : JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ReleaseState | null;
const initialState = stored ?? fallback;

function audit(state: ReleaseState, actor: string, message: string): AuditEntry[] {
  return [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor, message }, ...state.audits];
}

function pathOf(state: ReleaseState, batch: Pick<ReleaseBatch, 'groupId' | 'firmware' | 'rollbackVersion'>) {
  return computeUpgradePath(state.firmware, state.groups.find((item) => item.id === batch.groupId), batch.firmware, batch.rollbackVersion);
}

export const releaseReducer = createReducer(
  initialState,
  on(createBatch, (state, { batch }) => {
    const path = pathOf(state, batch);
    const message = path.blocked ? `创建批次 ${batch.name}，升级路径不可用：${path.blocked}` : `创建批次 ${batch.name}，升级路径 ${path.from} → ${path.steps.join(' → ')}`;
    return { ...state, batches: [{ ...batch, path, pathStale: false }, ...state.batches], audits: audit(state, '发布负责人', message) };
  }),
  on(updateManifest, (state, { id, firmware, rollbackVersion, groupId, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch || batch.status !== 'draft') return state;
    const batches = state.batches.map((item) => item.id === id ? { ...item, firmware, rollbackVersion, groupId, pathStale: true, updatedAt: new Date().toISOString() } : item);
    return { ...state, batches, audits: audit(state, actor, `批次 ${id} 升级清单已改动，需重算升级路径`) };
  }),
  on(computePath, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch) return state;
    const path = pathOf(state, batch);
    const batches = state.batches.map((item) => item.id === id ? { ...item, path, pathStale: false, updatedAt: new Date().toISOString() } : item);
    const message = path.blocked ? `批次 ${id} 升级路径重算失败：${path.blocked}` : `批次 ${id} 升级路径重算通过：${path.from} → ${path.steps.join(' → ')}`;
    return { ...state, batches, audits: audit(state, actor, message) };
  }),
  on(approveBatch, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch || batch.status !== 'draft') return state;
    if (!batch.path || batch.pathStale) {
      return { ...state, audits: audit(state, actor, `批次 ${id} 缺少有效升级路径，审批未放行`) };
    }
    if (batch.path.blocked) {
      return { ...state, audits: audit(state, actor, `批次 ${id} 升级路径接不上：${batch.path.blocked}，审批未放行`) };
    }
    const batches = state.batches.map((item) => item.id === id ? { ...item, status: 'approved' as const, updatedAt: new Date().toISOString() } : item);
    return { ...state, batches, audits: audit(state, actor, `批次 ${id} 审批通过，升级路径 ${batch.path.from} → ${batch.path.steps.join(' → ')}`) };
  }),
  on(pauseBatch, (state, { id, actor }) => ({ ...state, batches: state.batches.map((batch) => batch.id === id ? { ...batch, status: 'paused', updatedAt: new Date().toISOString() } : batch), audits: audit(state, actor, `批次 ${id} 已暂停`) })),
  on(resumeBatch, (state, { id, actor }) => ({ ...state, batches: state.batches.map((batch) => batch.id === id ? { ...batch, status: 'running', updatedAt: new Date().toISOString() } : batch), audits: audit(state, actor, `批次 ${id} 恢复发布`) })),
  on(rollbackBatch, (state, { id, actor }) => ({ ...state, batches: state.batches.map((batch) => batch.id === id ? { ...batch, status: 'rolled_back', updatedAt: new Date().toISOString() } : batch), audits: audit(state, actor, `批次 ${id} 已紧急回滚`) })),
  on(revokeFirmware, (state, { firmwareId, actor }) => {
    const target = state.firmware.find((item) => item.id === firmwareId);
    if (!target || target.status === 'revoked') return state;
    const firmware = state.firmware.map((item) => item.id === firmwareId ? { ...item, status: 'revoked' as const } : item);
    const repairs: RepairEntry[] = [...state.repairs];
    const batches = state.batches.map((batch) => {
      const group = state.groups.find((item) => item.id === batch.groupId);
      if (group?.model !== target.model || !batchTouchesVersion(batch, target.model, target.version)) return batch;
      // 已装上被撤销版本的设备单列出来等返修。
      if (batch.firmware === target.version && batch.downloaded > 0 && (batch.status === 'running' || batch.status === 'paused' || batch.status === 'completed')) {
        repairs.push({ id: crypto.randomUUID(), batchId: batch.id, batchName: batch.name, groupId: batch.groupId, model: target.model, version: target.version, deviceCount: batch.downloaded, at: new Date().toISOString(), status: 'pending' });
      }
      // 没开始的退回草稿，推进中的停在下一次下发前，其余保留状态；路径一律作废待重算。
      if (batch.status === 'approved') return { ...batch, status: 'draft' as const, pathStale: true, updatedAt: new Date().toISOString() };
      if (batch.status === 'running') return { ...batch, status: 'paused' as const, pathStale: true, updatedAt: new Date().toISOString() };
      if (batch.status === 'draft' || batch.status === 'paused') return { ...batch, pathStale: true, updatedAt: new Date().toISOString() };
      return batch;
    });
    const affected = batches.filter((batch, index) => batch !== state.batches[index]).length;
    const message = affected ? `固件 ${target.model} ${target.version} 已撤销，${affected} 个批次受影响，已装设备转入返修清单` : `固件 ${target.model} ${target.version} 已撤销`;
    return { ...state, firmware, batches, repairs, audits: audit(state, actor, message) };
  }),
  on(restoreFirmware, (state, { firmwareId, actor }) => {
    const target = state.firmware.find((item) => item.id === firmwareId);
    if (!target || target.status !== 'revoked') return state;
    const firmware = state.firmware.map((item) => item.id === firmwareId ? { ...item, status: 'published' as const } : item);
    // 重开后返修清单与批次处置结果保留，相关批次路径仍需重算后才可继续。
    const batches = state.batches.map((batch) => {
      const group = state.groups.find((item) => item.id === batch.groupId);
      if (group?.model !== target.model || !batchTouchesVersion(batch, target.model, target.version)) return batch;
      if (batch.status === 'draft' || batch.status === 'paused' || batch.status === 'approved') return { ...batch, pathStale: true, updatedAt: new Date().toISOString() };
      return batch;
    });
    return { ...state, firmware, batches, audits: audit(state, actor, `固件 ${target.model} ${target.version} 已重新上架，历史处置与返修清单保留`) };
  }),
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
    return { ...state, batches, audits: overflow ? audit(state, '系统', '失败率超过阈值，已自动暂停发布') : state.audits };
  })
);
