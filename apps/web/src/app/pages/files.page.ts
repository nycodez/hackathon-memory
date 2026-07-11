import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { DatePipe, DecimalPipe } from '@angular/common'
import type { KnowledgeDocument } from '@hackathon/shared'
import { finalize, switchMap, tap } from 'rxjs'
import { ApiService } from '../core/api.service'

@Component({
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  template: `
    <section class="page">
      <header class="page-header compact-header">
        <div><span class="eyebrow">Files</span><h1>Learning library</h1><p>Upload source material, follow each processing stage, and query it once ready.</p></div>
        <button class="button primary" type="button" (click)="fileInput.click()" [disabled]="uploading()">{{ uploading() ? 'Processing…' : 'Upload file' }}</button>
        <input #fileInput type="file" hidden accept=".txt,.md,.csv,.json,.html,.pdf,image/png,image/jpeg,image/webp" (change)="selectFile($event)">
      </header>

      <div class="upload-note"><span>↑</span><div><strong>Serverless upload limit: 4 MB</strong><small>Text, Markdown, CSV, JSON, HTML, PDF, PNG, JPEG, or WebP. Scanned content requires the optional OCR key.</small></div></div>

      @if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      }
      @if (loading()) {
        <div class="state-card" role="status">Loading files…</div>
      } @else if (!documents().length) {
        <div class="empty-card"><span>▱</span><h2>Your corpus is empty</h2><p>Add a file to ingest, summarize, chunk, and vectorize it.</p><button class="button primary" type="button" (click)="fileInput.click()">Choose a file</button></div>
      } @else {
        <div class="file-table" role="table" aria-label="Knowledge files">
          <div class="file-row file-head" role="row"><span>File</span><span>Pipeline</span><span>Size</span><span>Updated</span></div>
          @for (document of documents(); track document.id) {
            <article class="file-row" role="row">
              <div class="file-name"><span class="file-icon">▱</span><div><strong>{{ document.name }}</strong><small>{{ document.mimeType }} · {{ document.chunkCount }} chunks</small></div></div>
              <div><span class="status-pill" [attr.data-status]="document.status"><i></i>{{ document.status }}</span>@if (document.errorMessage) { <small class="file-error">{{ document.errorMessage }}</small> }</div>
              <span>{{ document.sizeBytes / 1024 | number:'1.0-1' }} KB</span>
              <span>{{ document.updatedAt | date:'short' }}</span>
            </article>
          }
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilesPage implements OnInit {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>
  private readonly api = inject(ApiService)
  private readonly destroyRef = inject(DestroyRef)
  protected readonly documents = signal<KnowledgeDocument[]>([])
  protected readonly loading = signal(true)
  protected readonly uploading = signal(false)
  protected readonly error = signal('')

  ngOnInit(): void {
    this.load()
  }

  protected selectFile(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || this.uploading()) return
    this.uploading.set(true)
    this.error.set('')
    this.api.upload(file).pipe(
      tap((document) => this.documents.update((documents) => [document, ...documents.filter((item) => item.id !== document.id)])),
      switchMap((document) => this.api.processDocument(document.id)),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.uploading.set(false)
        if (this.fileInput) this.fileInput.nativeElement.value = ''
      })
    ).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private load(): void {
    this.loading.set(true)
    this.api.documents().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (documents) => this.documents.set(documents),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }
}
