import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
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
import { approveBatch, createBatch, pauseBatch, reopenVersion, resumeBatch, revokeVersion, rollbackBatch, telemetryTick } from './state/release.actions';
import { selectAudits, selectBatches, selectGroups, selectRepairs, selectVersions } from './state/release.selectors';
import type { ReleaseBatch, FirmwareVersion } from './state/release.models';
import { computeUpgradePath, compareVersions } from './state/upgrade-path';

interface Draft {
  name: string;
  firmware: string;
  rollbackVersion: string;
  groupId: string;
  rolloutPercent: number;
  failureThreshold: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatTableModule, TranslocoPipe],
  template: `
    <header class="hero">
      <div><span class="eyebrow">OTA CONTROL</span><h1>{{ 'title' | transloco }}</h1><p>{{ 'subtitle' | transloco }}</p></div>
      <mat-chip-set><mat-chip highlighted>审计可追踪</mat-chip><mat-chip>失败阈值自动暂停</mat-chip><mat-chip>升级路径校验</mat-chip></mat-chip-set>
    </header>

    <main>
      <section class="stats">
        <mat-card appearance="outlined"><span>批次数</span><strong>{{ batches().length }}</strong></mat-card>
        <mat-card appearance="outlined"><span>兼容分组</span><strong>{{ groups().length }}</strong></mat-card>
        <mat-card appearance="outlined"><span>已暂停</span><strong>{{ pausedCount() }}</strong></mat-card>
        <mat-card appearance="outlined"><span>待返修</span><strong>{{ repairs().length }}</strong></mat-card>
      </section>

      <section class="grid">
        <div class="col">
          <mat-card appearance="outlined">
            <mat-card-header><mat-card-title>{{ 'newBatch' | transloco }}</mat-card-title></mat-card-header>
            <mat-card-content class="form-grid">
              <mat-form-field><mat-label>{{ 'batchName' | transloco }}</mat-label><input matInput [ngModel]="draft().name" (ngModelChange)="updateDraft('name', $event)"></mat-form-field>
              <mat-form-field><mat-label>{{ 'targetVersion' | transloco }}</mat-label><input matInput [ngModel]="draft().firmware" (ngModelChange)="updateDraft('firmware', $event)"></mat-form-field>
              <mat-form-field><mat-label>{{ 'rollbackVersion' | transloco }}</mat-label><input matInput [ngModel]="draft().rollbackVersion" (ngModelChange)="updateDraft('rollbackVersion', $event)"></mat-form-field>
              <mat-form-field><mat-label>{{ 'deviceGroup' | transloco }}</mat-label><mat-select [ngModel]="draft().groupId" (ngModelChange)="updateDraft('groupId', $event)"><mat-option *ngFor="let group of groups()" [value]="group.id" [disabled]="!group.compatible">{{ group.name }} · {{ group.region }} · {{ group.model }}</mat-option></mat-select></mat-form-field>
              <mat-form-field><mat-label>{{ 'rolloutPercent' | transloco }}</mat-label><input matInput type="number" [ngModel]="draft().rolloutPercent" (ngModelChange)="updateDraft('rolloutPercent', $event)"></mat-form-field>
              <mat-form-field><mat-label>{{ 'failureThreshold' | transloco }}</mat-label><input matInput type="number" [ngModel]="draft().failureThreshold" (ngModelChange)="updateDraft('failureThreshold', $event)"></mat-form-field>
              <div class="path-preview" [class.invalid]="!pathPreview().valid">
                <span class="path-label">{{ 'pathPreview' | transloco }}</span>
                @if (pathPreview().valid) {
                  <div class="path-flow">
                    @for (step of pathPreview().path; track step; let last = $last) {
                      <mat-chip highlighted>{{ step }}</mat-chip>
                      @if (!last) { <span class="arrow">→</span> }
                    }
                  </div>
                } @else {
                  <p class="path-error">{{ pathPreview().error }}</p>
                }
              </div>
              <button mat-flat-button color="primary" (click)="create()">{{ 'createBatch' | transloco }}</button>
            </mat-card-content>
          </mat-card>

          <mat-card appearance="outlined">
            <mat-card-header><mat-card-title>{{ 'firmwareRepo' | transloco }}</mat-card-title></mat-card-header>
            <mat-card-content>
              @for (group of groupedVersions(); track group.model) {
                <div class="repo-group">
                  <h3>{{ group.model }}</h3>
                  <div class="repo-versions">
                    @for (version of group.versions; track version.id) {
                      <div class="repo-version" [class.revoked]="version.status === 'revoked'">
                        <span class="version-num">{{ version.version }}</span>
                        <mat-chip [color]="version.status === 'revoked' ? 'warn' : 'primary'" highlighted>{{ version.status === 'revoked' ? ('revoked' | transloco) : ('active' | transloco) }}</mat-chip>
                        @if (version.status === 'active') {
                          <button mat-stroked-button color="warn" (click)="revoke(version.id)">{{ 'revoke' | transloco }}</button>
                        } @else {
                          <button mat-stroked-button (click)="reopen(version.id)">{{ 'reopen' | transloco }}</button>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </mat-card-content>
          </mat-card>
        </div>

        <div class="col">
          <mat-card appearance="outlined" class="batch-panel">
            <mat-card-header><mat-card-title>{{ 'batches' | transloco }}</mat-card-title></mat-card-header>
            <mat-card-content>
              <cdk-virtual-scroll-viewport itemSize="170" class="viewport">
                <article class="batch" *cdkVirtualFor="let batch of batches()">
                  <div class="row"><div><b>{{ batch.name }}</b><small>{{ batch.firmware }} → {{ 'rollbackVersion' | transloco }} {{ batch.rollbackVersion }}</small></div><mat-chip [color]="batch.status === 'paused' || batch.status === 'rolled_back' ? 'warn' : 'primary'" highlighted>{{ batch.status }}</mat-chip></div>
                  <div class="batch-path" [class.invalid]="!batch.pathValid">
                    <span class="path-label">{{ 'upgradePath' | transloco }}</span>
                    @if (batch.pathValid) {
                      <div class="path-flow">
                        @for (step of batch.upgradePath; track step; let last = $last) {
                          <mat-chip [highlighted]="step === batch.firmware">{{ step }}</mat-chip>
                          @if (!last) { <span class="arrow">→</span> }
                        }
                      </div>
                    } @else {
                      <p class="path-error">{{ batch.pathError }}</p>
                    }
                  </div>
                  <mat-progress-bar mode="determinate" [value]="batch.progress"></mat-progress-bar>
                  <div class="row"><span>{{ batch.downloaded }} {{ 'installed' | transloco }} · {{ 'failed' | transloco }} {{ batch.failed }} · {{ 'threshold' | transloco }} {{ batch.failureThreshold }}%</span><span>{{ batch.progress }}%</span></div>
                  <div class="actions">
                    <button mat-stroked-button *ngIf="batch.status === 'draft'" [disabled]="!batch.pathValid" (click)="approve(batch.id)">{{ 'approve' | transloco }}</button>
                    <button mat-stroked-button *ngIf="batch.status === 'approved'" [disabled]="!batch.pathValid" (click)="resume(batch.id)">{{ 'startRelease' | transloco }}</button>
                    <button mat-stroked-button *ngIf="batch.status === 'running'" (click)="pause(batch.id)">{{ 'pause' | transloco }}</button>
                    <button mat-stroked-button *ngIf="batch.status === 'paused'" [disabled]="!batch.pathValid" (click)="resume(batch.id)">{{ 'resume' | transloco }}</button>
                    <button mat-flat-button color="warn" [disabled]="batch.status === 'completed' || batch.status === 'rolled_back'" (click)="rollback(batch.id)">{{ 'emergencyRollback' | transloco }}</button>
                  </div>
                </article>
              </cdk-virtual-scroll-viewport>
            </mat-card-content>
          </mat-card>

          <mat-card appearance="outlined">
            <mat-card-header><mat-card-title>{{ 'repairList' | transloco }}</mat-card-title></mat-card-header>
            <mat-card-content>
              @if (repairs().length === 0) {
                <p class="empty">{{ 'noRepairs' | transloco }}</p>
              } @else {
                <div class="repair-list">
                  @for (repair of repairs(); track repair.id) {
                    <div class="repair">
                      <div class="row"><b>{{ repair.batchName }}</b><mat-chip color="warn" highlighted>{{ repair.model }} · {{ repair.version }}</mat-chip></div>
                      <p>{{ repair.reason }}</p>
                      <small>{{ repair.count }} {{ 'installedCount' | transloco }} · {{ repair.at | date:'MM-dd HH:mm:ss' }}</small>
                    </div>
                  }
                </div>
              }
            </mat-card-content>
          </mat-card>
        </div>
      </section>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>{{ 'audit' | transloco }}</mat-card-title></mat-card-header>
        <mat-card-content class="audit-list"><div class="audit" *ngFor="let item of audits()"><span>{{ item.at | date:'MM-dd HH:mm:ss' }}</span><b>{{ item.actor }}</b><p>{{ item.message }}</p></div></mat-card-content>
      </mat-card>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:#edf4f5; }
    .hero { padding:36px max(24px,6vw) 28px; color:#fff; background:linear-gradient(125deg,#053b46,#0f6f6c 62%,#2a9d8f); display:flex; justify-content:space-between; gap:24px; align-items:end; }
    .hero h1 { margin:8px 0; font-size:clamp(30px,4vw,52px); letter-spacing:-.04em; } .hero p { margin:0; opacity:.8 } .eyebrow { letter-spacing:.2em; font-size:12px; opacity:.7 }
    main { padding:22px max(18px,5vw) 60px; display:grid; gap:20px; } .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; } .stats span { display:block;color:#607d86 } .stats strong { font-size:30px }
    .grid { display:grid; grid-template-columns:minmax(320px,.8fr) minmax(420px,1.2fr); gap:20px; align-items:start; } .col { display:grid; gap:20px; }
    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding-top:16px }
    .path-preview { grid-column:1 / -1; padding:10px 12px; border:1px dashed #b0bec5; border-radius:8px; background:#f7fafb; display:grid; gap:6px; }
    .path-preview.invalid { border-color:#e57373; background:#fff5f5; }
    .path-label { font-size:12px; color:#607d86; letter-spacing:.04em; }
    .path-flow { display:flex; flex-wrap:wrap; align-items:center; gap:6px; } .arrow { color:#2a9d8f; font-weight:600; }
    .path-error { margin:0; color:#c62828; font-size:13px; }
    .repo-group { margin-bottom:14px; } .repo-group h3 { margin:0 0 8px; font-size:14px; color:#0f6f6c; }
    .repo-versions { display:grid; gap:6px; } .repo-version { display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:6px; background:#f7fafb; } .repo-version.revoked { background:#fff5f5; }
    .version-num { font-weight:600; font-variant-numeric:tabular-nums; min-width:64px; }
    .batch-path { padding:8px 10px; border:1px dashed #b0bec5; border-radius:8px; background:#f7fafb; display:grid; gap:4px; }
    .batch-path.invalid { border-color:#e57373; background:#fff5f5; }
    .viewport { height:560px; } .batch { min-height:160px; border-bottom:1px solid #dde7e8; padding:12px 4px; display:grid; gap:10px } .row { display:flex;justify-content:space-between;gap:12px;align-items:center } small { display:block;color:#71858c } .actions { display:flex;gap:8px;flex-wrap:wrap }
    .repair-list { display:grid; gap:10px; } .repair { padding:10px 12px; border:1px solid #ffcdd2; border-radius:8px; background:#fff5f5; display:grid; gap:4px; } .repair p { margin:0; font-size:13px; color:#c62828; }
    .empty { color:#90a4ae; font-size:13px; margin:8px 0; }
    .audit-list { max-height:320px; overflow:auto } .audit { display:grid;grid-template-columns:120px 110px 1fr;border-bottom:1px solid #e5ecee;padding:10px 4px } .audit p { margin:0 }
    @media(max-width:900px){ .hero{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.audit{grid-template-columns:1fr}.viewport{height:400px} }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  readonly groups = this.store.selectSignal(selectGroups);
  readonly batches = this.store.selectSignal(selectBatches);
  readonly audits = this.store.selectSignal(selectAudits);
  readonly versions = this.store.selectSignal(selectVersions);
  readonly repairs = this.store.selectSignal(selectRepairs);
  private timer?: number;

  readonly draft = signal<Draft>({ name: '', firmware: '2.8.1', rollbackVersion: '2.7.9', groupId: 'g-edge', rolloutPercent: 20, failureThreshold: 5 });

  readonly pathPreview = computed(() => {
    const d = this.draft();
    const group = this.groups().find((g) => g.id === d.groupId);
    if (!group) return { path: [], valid: false, error: '请选择设备分组' };
    return computeUpgradePath(this.versions(), group.model, d.rollbackVersion, d.firmware);
  });

  readonly groupedVersions = computed(() => {
    const map = new Map<string, FirmwareVersion[]>();
    for (const v of this.versions()) {
      const list = map.get(v.model) ?? [];
      list.push(v);
      map.set(v.model, list);
    }
    return Array.from(map.entries()).map(([model, list]) => ({ model, versions: list.sort((a, b) => compareVersions(a.version, b.version)) }));
  });

  readonly pausedCount = computed(() => this.batches().filter((b) => b.status === 'paused').length);

  ngOnInit() {
    this.timer = window.setInterval(() => this.store.dispatch(telemetryTick()), 1400);
  }
  ngOnDestroy() { if (this.timer) window.clearInterval(this.timer); }

  updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  create() {
    if (!this.draft().name || !this.draft().firmware || !this.draft().groupId) return;
    const batch: ReleaseBatch = { ...this.draft(), id: crypto.randomUUID(), status: 'draft', progress: 0, downloaded: 0, failed: 0, upgradePath: [], pathValid: false, pathError: null, updatedAt: new Date().toISOString() };
    this.store.dispatch(createBatch({ batch }));
    this.draft.update((d) => ({ ...d, name: '' }));
  }
  approve(id: string) { this.store.dispatch(approveBatch({ id, actor: '发布负责人' })); }
  pause(id: string) { this.store.dispatch(pauseBatch({ id, actor: '值班人员' })); }
  resume(id: string) { this.store.dispatch(resumeBatch({ id, actor: '运维人员' })); }
  rollback(id: string) { this.store.dispatch(rollbackBatch({ id, actor: '发布负责人' })); }
  revoke(id: string) { this.store.dispatch(revokeVersion({ versionId: id, actor: '发布负责人' })); }
  reopen(id: string) { this.store.dispatch(reopenVersion({ versionId: id, actor: '发布负责人' })); }
}
