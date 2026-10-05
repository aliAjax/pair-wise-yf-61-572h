import type { DeviceGroup, FirmwareVersion, UpgradePath } from './release.models';

/**
 * 按设备分组的型号计算升级路径。
 * 固件仓库中同一型号的版本挨着排，路径必须沿仓库顺序逐版本衔接：
 * 不允许跳版（途经每个相邻版本），不允许途经或落到已撤销版本，回滚版本同样不能已撤销。
 */
export function computeUpgradePath(
  firmware: FirmwareVersion[],
  group: DeviceGroup | undefined,
  to: string,
  rollbackVersion: string
): UpgradePath {
  const computedAt = new Date().toISOString();
  const fail = (model: string, from: string, blocked: string): UpgradePath => ({ model, from, to, steps: [], blocked, computedAt });
  if (!group) return fail('', '', '设备分组不存在');
  const { model } = group;
  const from = group.currentVersion;
  const chain = firmware.filter((item) => item.model === model);
  const fromIndex = chain.findIndex((item) => item.version === from);
  const toIndex = chain.findIndex((item) => item.version === to);
  if (fromIndex === -1) return fail(model, from, `型号 ${model} 当前版本 ${from} 不在固件仓库`);
  if (toIndex === -1) return fail(model, from, `目标版本 ${to} 不在固件仓库`);
  if (chain[toIndex].status === 'revoked') return fail(model, from, `目标版本 ${to} 已撤销`);
  const rollback = chain.find((item) => item.version === rollbackVersion);
  if (!rollback) return fail(model, from, `回滚版本 ${rollbackVersion} 不在固件仓库`);
  if (rollback.status === 'revoked') return fail(model, from, `回滚版本 ${rollbackVersion} 已撤销，不可回退`);
  if (fromIndex === toIndex) return fail(model, from, '目标版本与当前版本相同');
  const step = fromIndex < toIndex ? 1 : -1;
  const steps: string[] = [];
  for (let index = fromIndex + step; index !== toIndex + step; index += step) {
    const item = chain[index];
    if (item.status === 'revoked') return fail(model, from, `路径经过已撤销版本 ${item.version}`);
    steps.push(item.version);
  }
  return { model, from, to, steps, blocked: null, computedAt };
}

/** 批次是否受某个固件版本撤销影响：目标、回滚或已算路径途经该版本（型号需一致）。 */
export function batchTouchesVersion(
  batch: { firmware: string; rollbackVersion: string; path: UpgradePath | null },
  model: string,
  version: string
): boolean {
  if (batch.path && batch.path.model !== model) return false;
  return batch.firmware === version || batch.rollbackVersion === version || (batch.path?.steps.includes(version) ?? false);
}
