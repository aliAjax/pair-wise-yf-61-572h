import type { DeviceGroup, FirmwareVersion, ReleaseBatch } from './release.models';

export interface PathResult {
  path: string[];
  valid: boolean;
  error: string | null;
}

/** 语义化版本比较：a < b 返回负数，a > b 返回正数，相等返回 0。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number(part) || 0);
  const pb = b.split('.').map((part) => Number(part) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 按设备分组的型号，在固件仓库里算一条从回滚版本到目标版本的升级路径。
 * 同一型号的版本挨着排，路径取两者之间的连续子序列；任一端缺失、降级，
 * 或链路中夹着已撤销版本，都算接不上，不放行审批。
 */
export function computeUpgradePath(
  versions: FirmwareVersion[],
  model: string,
  from: string,
  to: string
): PathResult {
  const line = versions
    .filter((v) => v.model === model)
    .sort((a, b) => compareVersions(a.version, b.version));

  if (line.length === 0) {
    return { path: [], valid: false, error: `型号 ${model} 暂无固件仓库` };
  }

  const fromIdx = line.findIndex((v) => v.version === from);
  const toIdx = line.findIndex((v) => v.version === to);

  if (fromIdx < 0) {
    return { path: [], valid: false, error: `回滚版本 ${from} 不在 ${model} 仓库中` };
  }
  if (toIdx < 0) {
    return { path: [], valid: false, error: `目标版本 ${to} 不在 ${model} 仓库中` };
  }
  if (fromIdx > toIdx) {
    return { path: [], valid: false, error: `目标 ${to} 低于回滚版本 ${from}，不能降级` };
  }

  const slice = line.slice(fromIdx, toIdx + 1);
  const revoked = slice.find((v) => v.status === 'revoked');
  if (revoked) {
    return {
      path: slice.map((v) => v.version),
      valid: false,
      error: `升级路径中的 ${revoked.version} 已撤销，链路断开`,
    };
  }

  return { path: slice.map((v) => v.version), valid: true, error: null };
}

/** 升级清单改动后，对所有未完成批次重算升级路径。 */
export function recalculateAllPaths(
  versions: FirmwareVersion[],
  groups: DeviceGroup[],
  batches: ReleaseBatch[]
): ReleaseBatch[] {
  return batches.map((batch) => {
    if (batch.status === 'rolled_back') return batch;
    const group = groups.find((g) => g.id === batch.groupId);
    if (!group) {
      return { ...batch, upgradePath: [], pathValid: false, pathError: '设备分组不存在' };
    }
    const result = computeUpgradePath(versions, group.model, batch.rollbackVersion, batch.firmware);
    return { ...batch, upgradePath: result.path, pathValid: result.valid, pathError: result.error };
  });
}
