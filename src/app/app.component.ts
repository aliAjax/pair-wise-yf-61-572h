import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { map } from 'rxjs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { TranslocoPipe } from '@jsverse/transloco';
import { approveBatch, computePath, createBatch, pauseBatch, restoreFirmware, resumeBatch, revokeFirmware, rollbackBatch, telemetryTick, updateManifest } from './state/release.actions';
import { selectAudits, selectBatches, selectFirmware, selectGroups, selectRelease, selectRepairs } from './state/release.selectors';
import { STORAGE_KEY } from './state/release.reducer';
import type { FirmwareVersion, ReleaseBatch } from './state/release.models';

interface FirmwareGroup {
  model: string;
  items: FirmwareVersion[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatTableModule, TranslocoPipe],
  template: `
    <header class="hero">
      <div><span class="eyebrow">OTA CONTROL</span><h1>{{ 'title' | transloco }}</h1><p>{{ 'subtitle' | transloco }}</p></div>
      <mat-chip-set><mat-chip highlighted>升级路径逐版衔接</mat-chip><mat-chip>撤销联动返修</mat-chip><mat-chip>失败阈值自动暂停</mat-chip></mat-chip-set>
    </header>

    <main>
      <section class="stats">
        <mat-card appearance="outlined"><span>批次数</span><strong>{{ (batches$ | async)?.length ?? 0 }}</strong></mat-card>
        <mat-card appearance="outlined"><span>固件版本</span><strong>{{ (firmware$ | async)?.length ?? 0 }}</strong></mat-card>
        <mat-card appearance="outlined"><span>已暂停</span><strong>{{ pausedCount$ | async }}</strong></mat-card>
        <mat-card appearance="outlined"><span>待返修设备</span><strong>{{ repairDeviceCount$ | async }}</strong></mat-card>
        <mat-card appearance="outlined"><span>审计记录</span><strong>{{ (audits$ | async)?.length ?? 0 }}</strong></mat-card>
      </section>

      <section class="grid">
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>{{ 'newBatch' | transloco }}</mat-card-title></mat-card-header>
          <mat-card-content class="form-grid">
            <mat-form-field><mat-label>批次名称</mat-label><input matInput [(ngModel)]="draft.name"></mat-form-field>
            <mat-form-field><mat-label>目标版本</mat-label><input matInput [(ngModel)]="draft.firmware"></mat-form-field>
            <mat-form-field><mat-label>回滚版本</mat-label><input matInput [(ngModel)]="draft.rollbackVersion"></mat-form-field>
            <mat-form-field><mat-label>设备分组</mat-label><mat-select [(ngModel)]="draft.groupId"><mat-option *ngFor="let group of groups$ | async" [value]="group.id" [disabled]="!group.compatible">{{ group.name }} · {{ group.model }}@{{ group.currentVersion }}</mat-option></mat-select></mat-form-field>
            <mat-form-field><mat-label>灰度比例 %</mat-label><input matInput type="number" [(ngModel)]="draft.rolloutPercent"></mat-form-field>
            <mat-form-field><mat-label>失败阈值 %</mat-label><input matInput type="number" [(ngModel)]="draft.failureThreshold"></mat-form-field>
            <button mat-flat-button color="primary" (click)="create()">创建兼容批次</button>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined" class="batch-panel">
          <mat-card-header><mat-card-title>{{ 'batches' | transloco }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <cdk-virtual-scroll-viewport itemSize="210" class="viewport">
              <article class="batch" *cdkVirtualFor="let batch of batches$ | async">
                <div class="row"><div><b>{{ batch.name }}</b><small>目标 {{ batch.firmware }} · 回滚 {{ batch.rollbackVersion }}</small></div><mat-chip [color]="batch.status === 'paused' || batch.status === 'rolled_back' ? 'warn' : 'primary'" highlighted>{{ batch.status }}</mat-chip></div>
                <div class="path" [class.blocked]="batch.path?.blocked" [class.stale]="batch.pathStale">
                  <ng-container *ngIf="batch.pathStale">升级清单或仓库已改动，需重算路径</ng-container>
                  <ng-container *ngIf="!batch.pathStale && batch.path?.blocked">路径接不上：{{ batch.path?.blocked }}</ng-container>
                  <ng-container *ngIf="!batch.pathStale && batch.path && !batch.path.blocked">路径 {{ batch.path!.from }} → {{ batch.path!.steps.join(' → ') }}</ng-container>
                  <ng-container *ngIf="!batch.path">尚未计算升级路径</ng-container>
                </div>
                <mat-progress-bar mode="determinate" [value]="batch.progress"></mat-progress-bar>
                <div class="row"><span>{{ batch.downloaded }} 台已更新 · 失败 {{ batch.failed }} · 阈值 {{ batch.failureThreshold }}%</span><span>{{ batch.progress }}%</span></div>
                <div class="manifest-edit" *ngIf="editingManifest === batch.id">
                  <mat-form-field><mat-label>目标版本</mat-label><input matInput [(ngModel)]="manifestDraft.firmware"></mat-form-field>
                  <mat-form-field><mat-label>回滚版本</mat-label><input matInput [(ngModel)]="manifestDraft.rollbackVersion"></mat-form-field>
                  <mat-form-field><mat-label>设备分组</mat-label><mat-select [(ngModel)]="manifestDraft.groupId"><mat-option *ngFor="let group of groups$ | async" [value]="group.id" [disabled]="!group.compatible">{{ group.name }} · {{ group.model }}@{{ group.currentVersion }}</mat-option></mat-select></mat-form-field>
                  <button mat-flat-button color="primary" (click)="saveManifest(batch.id)">保存清单</button>
                  <button mat-stroked-button (click)="editingManifest = null">取消</button>
                </div>
                <div class="actions">
                  <button mat-stroked-button *ngIf="batch.status === 'draft'" [disabled]="!canApprove(batch)" (click)="approve(batch.id)">审批</button>
                  <button mat-stroked-button *ngIf="batch.status === 'draft' && needsRecompute(batch)" (click)="recompute(batch.id)">重算路径</button>
                  <button mat-stroked-button *ngIf="batch.status === 'draft'" (click)="editManifest(batch)">编辑清单</button>
                  <button mat-stroked-button *ngIf="batch.status === 'approved'" (click)="resume(batch.id)">开始发布</button>
                  <button mat-stroked-button *ngIf="batch.status === 'running'" (click)="pause(batch.id)">暂停</button>
                  <button mat-stroked-button *ngIf="batch.status === 'paused'" (click)="resume(batch.id)">继续</button>
                  <button mat-flat-button color="warn" [disabled]="batch.status === 'completed' || batch.status === 'rolled_back'" (click)="rollback(batch.id)">紧急回滚</button>
                </div>
              </article>
            </cdk-virtual-scroll-viewport>
          </mat-card-content>
        </mat-card>
      </section>

      <section class="grid">
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>固件仓库</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="fw-model" *ngFor="let group of firmwareGroups$ | async">
              <b>{{ group.model }}</b>
              <div class="fw-chain">
                <span class="fw" *ngFor="let item of group.items" [class.revoked]="item.status === 'revoked'">
                  {{ item.version }}
                  <button mat-stroked-button *ngIf="item.status === 'published'" (click)="revoke(item.id)">撤销</button>
                  <button mat-stroked-button *ngIf="item.status === 'revoked'" (click)="restore(item.id)">重开</button>
                </span>
              </div>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>返修清单（已装上撤销版本的设备）</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="repair" *ngFor="let item of repairs$ | async">
              <div><b>{{ item.batchName }}</b><small>{{ item.model }} · {{ item.version }} · {{ item.at | date:'MM-dd HH:mm' }}</small></div>
              <span>{{ item.deviceCount }} 台待返修</span>
            </div>
            <p class="empty" *ngIf="!(repairs$ | async)?.length">暂无待返修设备</p>
          </mat-card-content>
        </mat-card>
      </section>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>{{ 'audit' | transloco }}</mat-card-title></mat-card-header>
        <mat-card-content class="audit-list"><div class="audit" *ngFor="let item of audits$ | async"><span>{{ item.at | date:'MM-dd HH:mm:ss' }}</span><b>{{ item.actor }}</b><p>{{ item.message }}</p></div></mat-card-content>
      </mat-card>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:#edf4f5; }
    .hero { padding:36px max(24px,6vw) 28px; color:#fff; background:linear-gradient(125deg,#053b46,#0f6f6c 62%,#2a9d8f); display:flex; justify-content:space-between; gap:24px; align-items:end; }
    .hero h1 { margin:8px 0; font-size:clamp(30px,4vw,52px); letter-spacing:-.04em; } .hero p { margin:0; opacity:.8 } .eyebrow { letter-spacing:.2em; font-size:12px; opacity:.7 }
    main { padding:22px max(18px,5vw) 60px; display:grid; gap:20px; } .stats { display:grid; grid-template-columns:repeat(5,1fr); gap:16px; } .stats span { display:block;color:#607d86 } .stats strong { font-size:30px }
    .grid { display:grid; grid-template-columns:minmax(300px,.8fr) minmax(420px,1.2fr); gap:20px; } .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding-top:16px }
    .viewport { height:560px; } .batch { min-height:190px; border-bottom:1px solid #dde7e8; padding:12px 4px; display:grid; gap:10px } .row { display:flex;justify-content:space-between;gap:12px;align-items:center } small { display:block;color:#71858c } .actions { display:flex;gap:8px;flex-wrap:wrap }
    .path { font-size:13px; color:#0f6f6c } .path.blocked, .path.stale { color:#b23b3b }
    .manifest-edit { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:8px; background:#f4f9f9; border-radius:8px }
    .fw-model { padding:10px 0; border-bottom:1px solid #dde7e8 } .fw-chain { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px }
    .fw { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border:1px solid #bcd6d4; border-radius:16px } .fw.revoked { color:#b23b3b; border-color:#e0b4b4; text-decoration:line-through } .fw.revoked button { text-decoration:none }
    .repair { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 4px; border-bottom:1px solid #e5ecee } .repair span { color:#b23b3b; white-space:nowrap } .empty { color:#71858c }
    .audit-list { max-height:320px; overflow:auto } .audit { display:grid;grid-template-columns:120px 110px 1fr;border-bottom:1px solid #e5ecee;padding:10px 4px } .audit p { margin:0 }
    @media(max-width:900px){ .hero{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.manifest-edit{grid-template-columns:1fr}.audit{grid-template-columns:1fr}.viewport{height:420px} }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  readonly groups$ = this.store.select(selectGroups);
  readonly firmware$ = this.store.select(selectFirmware);
  readonly firmwareGroups$ = this.firmware$.pipe(map((items) => this.groupByModel(items)));
  readonly batches$ = this.store.select(selectBatches);
  readonly repairs$ = this.store.select(selectRepairs);
  readonly audits$ = this.store.select(selectAudits);
  readonly pausedCount$ = this.batches$.pipe(map((items) => items.filter((item) => item.status === 'paused').length));
  readonly repairDeviceCount$ = this.repairs$.pipe(map((items) => items.reduce((sum, item) => sum + item.deviceCount, 0)));
  private timer?: number;
  draft = { name: '', firmware: '3.0.0', rollbackVersion: '2.9.0', groupId: 'g-edge', rolloutPercent: 10, failureThreshold: 3 };
  editingManifest: string | null = null;
  manifestDraft = { firmware: '', rollbackVersion: '', groupId: '' };

  ngOnInit() {
    this.timer = window.setInterval(() => this.store.dispatch(telemetryTick()), 1400);
    this.store.select(selectRelease).subscribe((state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)));
  }
  ngOnDestroy() { if (this.timer) window.clearInterval(this.timer); }
  create() {
    if (!this.draft.name || !this.draft.firmware || !this.draft.groupId) return;
    const batch: ReleaseBatch = { ...this.draft, id: crypto.randomUUID(), status: 'draft', progress: 0, downloaded: 0, failed: 0, updatedAt: new Date().toISOString(), path: null, pathStale: false };
    this.store.dispatch(createBatch({ batch }));
    this.draft = { ...this.draft, name: '' };
  }
  canApprove(batch: ReleaseBatch) { return !!batch.path && !batch.pathStale && !batch.path.blocked; }
  needsRecompute(batch: ReleaseBatch) { return !batch.path || batch.pathStale || !!batch.path.blocked; }
  editManifest(batch: ReleaseBatch) {
    this.editingManifest = batch.id;
    this.manifestDraft = { firmware: batch.firmware, rollbackVersion: batch.rollbackVersion, groupId: batch.groupId };
  }
  saveManifest(id: string) {
    this.store.dispatch(updateManifest({ id, ...this.manifestDraft, actor: '发布负责人' }));
    this.editingManifest = null;
  }
  approve(id: string) { this.store.dispatch(approveBatch({ id, actor: '发布负责人' })); }
  recompute(id: string) { this.store.dispatch(computePath({ id, actor: '运维值班' })); }
  pause(id: string) { this.store.dispatch(pauseBatch({ id, actor: '值班人员' })); }
  resume(id: string) { this.store.dispatch(resumeBatch({ id, actor: '运维人员' })); }
  rollback(id: string) { this.store.dispatch(rollbackBatch({ id, actor: '发布负责人' })); }
  revoke(firmwareId: string) { this.store.dispatch(revokeFirmware({ firmwareId, actor: '运维值班' })); }
  restore(firmwareId: string) { this.store.dispatch(restoreFirmware({ firmwareId, actor: '运维值班' })); }
  private groupByModel(items: FirmwareVersion[]): FirmwareGroup[] {
    const groups: FirmwareGroup[] = [];
    for (const item of items) {
      const last = groups[groups.length - 1];
      if (last && last.model === item.model) last.items.push(item);
      else groups.push({ model: item.model, items: [item] });
    }
    return groups;
  }
}
