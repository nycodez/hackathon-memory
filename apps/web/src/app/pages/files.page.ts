import { DatePipe, DecimalPipe } from '@angular/common'
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser'
import { ActivatedRoute, Router } from '@angular/router'
import type { KnowledgeDocument, LibraryListing } from '@hackathon/shared'
import { distinctUntilChanged, finalize, map, switchMap } from 'rxjs'
import { ApiService } from '../core/api.service'
import { MarkdownPipe } from '../core/markdown.pipe'

type PreviewType = 'pdf' | 'image' | 'markdown' | 'text'
type PreviewableDocument = KnowledgeDocument & { previewType: PreviewType | null }

interface FilePreview {
  document: PreviewableDocument
  loading: boolean
  error: string
  markdown: string
  text: string
  pdfUrl: SafeResourceUrl | null
  imageUrl: string
}

const emptyListing: LibraryListing = {
  currentFolder: null,
  breadcrumbs: [],
  folders: [],
  documents: [],
}

@Component({
  standalone: true,
  imports: [DatePipe, DecimalPipe, MarkdownPipe],
  template: `
    <section class="page">
      <header class="page-header compact-header">
        <div><span class="eyebrow">Library</span><h1>{{ listing().currentFolder?.name ?? 'Learning library' }}</h1><p>Organize source material into folders and query it once processing is complete.</p></div>
        <div class="library-actions">
          <button class="button secondary" type="button" (click)="showFolderForm.set(true)">New folder</button>
          <button class="button primary" type="button" (click)="fileInput.click()" [disabled]="uploading()">{{ uploading() ? 'Processing…' : 'Upload file' }}</button>
        </div>
        <input #fileInput type="file" hidden accept=".txt,.md,.csv,.json,.html,.pdf,image/png,image/jpeg,image/webp" (change)="selectFile($event)">
      </header>

      <nav class="library-breadcrumbs" aria-label="Library folders">
        <button type="button" (click)="openFolder(null)" [class.current]="!currentFolderId()">Library</button>
        @for (folder of listing().breadcrumbs; track folder.id) {
          <span aria-hidden="true">›</span>
          <button type="button" (click)="openFolder(folder.id)" [class.current]="folder.id === currentFolderId()">{{ folder.name }}</button>
        }
      </nav>

      @if (showFolderForm()) {
        <form class="new-folder-form" (submit)="createFolder($event)">
          <input #folderName type="text" maxlength="80" autocomplete="off" placeholder="Folder name" [value]="folderDraft()" (input)="folderDraft.set(folderName.value)">
          <button class="button primary" type="submit" [disabled]="!folderDraft().trim() || creatingFolder()">Create</button>
          <button class="button secondary" type="button" (click)="cancelFolder()">Cancel</button>
        </form>
      }

      <div class="upload-note"><span>↑</span><div><strong>Upload limit: 4 MB</strong><small>New files are saved in the current folder, then extracted, summarized, and indexed.</small></div></div>

      @if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      }
      @if (loading()) {
        <div class="state-card" role="status">Loading library…</div>
      } @else {
        @if (listing().folders.length) {
          <div class="folder-grid" aria-label="Folders">
            @for (folder of listing().folders; track folder.id) {
              <article class="folder-item">
                <button class="folder-card" type="button" (click)="openFolder(folder.id)">
                  <span class="folder-icon">▰</span>
                  <span><strong>{{ folder.name }}</strong><small>Folder</small></span>
                  <i aria-hidden="true">›</i>
                </button>
                <button class="folder-delete" type="button" [disabled]="deletingId() === folder.id" (click)="deleteFolder(folder.id)" aria-label="Delete folder">×</button>
              </article>
            }
          </div>
        }

        @if (!hasItems()) {
          <div class="empty-card"><span>▱</span><h2>This folder is empty</h2><p>Add a folder or upload source material here.</p></div>
        } @else if (listing().documents.length) {
          <div class="file-table" role="table" aria-label="Library documents">
            <div class="file-row file-head" role="row"><span>File</span><span>Pipeline</span><span>Size</span><span>Updated</span></div>
            @for (document of previewableDocuments(); track document.id) {
              <article class="file-row" role="row">
                <div class="file-name">
                  <span class="file-icon">▱</span>
                  <div>
                    @if (document.previewType) {
                      <button class="file-preview-link" type="button" (click)="openPreview(document)">{{ document.name }}</button>
                    } @else {
                      <strong>{{ document.name }}</strong>
                    }
                    <small>{{ document.mimeType }} · {{ document.chunkCount }} chunks</small>
                  </div>
                </div>
                <div><span class="status-pill" [attr.data-status]="document.status"><i></i>{{ document.status }}</span>@if (document.errorMessage) { <small class="file-error">{{ document.errorMessage }}</small> }</div>
                <span>{{ document.sizeBytes / 1024 | number:'1.0-1' }} KB</span>
                <span>{{ document.updatedAt | date:'short' }}</span>
                <button class="file-delete" type="button" [disabled]="deletingId() === document.id" (click)="deleteDocument(document.id)" aria-label="Delete document">×</button>
              </article>
            }
          </div>
        }
      }
    </section>

    @if (preview(); as filePreview) {
      <section class="file-preview-modal" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
        <header class="file-preview-header">
          <div>
            <span class="eyebrow">File preview</span>
            <h2 id="file-preview-title">{{ filePreview.document.name }}</h2>
            <small>{{ filePreview.document.mimeType }} · {{ filePreview.document.sizeBytes / 1024 | number:'1.0-1' }} KB</small>
          </div>
          <button #previewClose class="file-preview-close" type="button" (click)="closePreview()" aria-label="Close file preview">×</button>
        </header>

        <div class="file-preview-body">
          @if (filePreview.loading) {
            <div class="file-preview-state" role="status">Loading preview…</div>
          } @else if (filePreview.error) {
            <div class="file-preview-state error" role="alert">
              <strong>Preview unavailable</strong>
              <p>{{ filePreview.error }}</p>
            </div>
          } @else if (filePreview.pdfUrl) {
            <iframe class="file-preview-pdf" [src]="filePreview.pdfUrl" [title]="filePreview.document.name"></iframe>
          } @else if (filePreview.imageUrl) {
            <div class="file-preview-image-stage"><img [src]="filePreview.imageUrl" [alt]="filePreview.document.name"></div>
          } @else if (filePreview.document.previewType === 'markdown') {
            <article class="file-preview-markdown markdown-content" [innerHTML]="filePreview.markdown | markdown"></article>
          } @else {
            <pre class="file-preview-text">{{ filePreview.text }}</pre>
          }
        </div>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilesPage implements OnInit {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>
  @ViewChild('previewClose') private previewClose?: ElementRef<HTMLButtonElement>
  private readonly api = inject(ApiService)
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly destroyRef = inject(DestroyRef)
  private readonly sanitizer = inject(DomSanitizer)
  private previewObjectUrl: string | null = null
  private previewRequest = 0
  protected readonly listing = signal<LibraryListing>(emptyListing)
  protected readonly currentFolderId = signal<string | null>(null)
  protected readonly loading = signal(true)
  protected readonly uploading = signal(false)
  protected readonly deletingId = signal<string | null>(null)
  protected readonly creatingFolder = signal(false)
  protected readonly showFolderForm = signal(false)
  protected readonly folderDraft = signal('')
  protected readonly error = signal('')
  protected readonly hasItems = computed(() => Boolean(this.listing().folders.length || this.listing().documents.length))
  protected readonly previewableDocuments = computed<PreviewableDocument[]>(() => this.listing().documents.map((document) => ({
    ...document,
    previewType: documentPreviewType(document),
  })))
  protected readonly preview = signal<FilePreview | null>(null)

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreviewObjectUrl())
  }

  ngOnInit(): void {
    this.route.queryParamMap.pipe(
      map((params) => params.get('folder')),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((folderId) => {
      this.currentFolderId.set(folderId)
      this.load()
    })
  }

  protected openFolder(folderId: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { folder: folderId },
      queryParamsHandling: 'merge',
    })
  }

  protected createFolder(event: Event): void {
    event.preventDefault()
    const name = this.folderDraft().trim()
    if (!name || this.creatingFolder()) return
    this.creatingFolder.set(true)
    this.error.set('')
    this.api.createFolder(name, this.currentFolderId()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.creatingFolder.set(false))
    ).subscribe({
      next: () => {
        this.cancelFolder()
        this.load()
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected cancelFolder(): void {
    this.folderDraft.set('')
    this.showFolderForm.set(false)
  }

  protected selectFile(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || this.uploading()) return
    this.uploading.set(true)
    this.error.set('')
    this.api.upload(file, this.currentFolderId()).pipe(
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

  protected deleteDocument(id: string): void {
    if (this.deletingId()) return
    this.deletingId.set(id)
    this.error.set('')
    this.api.deleteDocument(id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.deletingId.set(null))
    ).subscribe({
      next: () => {
        if (this.preview()?.document.id === id) this.closePreview()
        this.listing.update((listing) => ({
          ...listing,
          documents: listing.documents.filter((document) => document.id !== id),
        }))
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected openPreview(document: PreviewableDocument): void {
    if (!document.previewType) return
    const request = ++this.previewRequest
    this.revokePreviewObjectUrl()
    this.preview.set({ document, loading: true, error: '', markdown: '', text: '', pdfUrl: null, imageUrl: '' })
    setTimeout(() => this.previewClose?.nativeElement.focus())

    this.api.documentContent(document.id).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (content) => {
        if (request !== this.previewRequest || this.preview()?.document.id !== document.id) return
        if (document.previewType === 'pdf' || document.previewType === 'image') {
          this.previewObjectUrl = URL.createObjectURL(content)
          this.preview.update((current) => current ? {
            ...current,
            loading: false,
            pdfUrl: document.previewType === 'pdf'
              ? this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl ?? '')
              : null,
            imageUrl: document.previewType === 'image' ? this.previewObjectUrl ?? '' : '',
          } : null)
          return
        }

        void content.text().then((value) => {
          if (request !== this.previewRequest || this.preview()?.document.id !== document.id) return
          this.preview.update((current) => current ? {
            ...current,
            loading: false,
            markdown: document.previewType === 'markdown' ? value : '',
            text: document.previewType === 'text' ? value : '',
          } : null)
        }).catch(() => this.setPreviewError(request, document.id, 'The file could not be read.'))
      },
      error: (error: unknown) => this.setPreviewError(request, document.id, this.api.message(error)),
    })
  }

  protected closePreview(): void {
    this.previewRequest += 1
    this.revokePreviewObjectUrl()
    this.preview.set(null)
  }

  @HostListener('document:keydown.escape')
  protected closePreviewWithEscape(): void {
    if (this.preview()) this.closePreview()
  }

  protected deleteFolder(id: string): void {
    if (this.deletingId()) return
    this.deletingId.set(id)
    this.error.set('')
    this.api.deleteFolder(id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.deletingId.set(null))
    ).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private load(): void {
    this.loading.set(true)
    this.error.set('')
    this.api.library(this.currentFolderId()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (listing) => this.listing.set(listing),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private setPreviewError(request: number, documentId: string, message: string): void {
    if (request !== this.previewRequest || this.preview()?.document.id !== documentId) return
    this.preview.update((current) => current ? { ...current, loading: false, error: message } : null)
  }

  private revokePreviewObjectUrl(): void {
    if (!this.previewObjectUrl) return
    URL.revokeObjectURL(this.previewObjectUrl)
    this.previewObjectUrl = null
  }
}

function documentPreviewType(document: KnowledgeDocument): PreviewType | null {
  const name = document.name.toLowerCase()
  const mimeType = document.mimeType.toLowerCase().split(';', 1)[0]?.trim()
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType ?? '') ||
    /\.(png|jpe?g|webp|gif)$/.test(name)
  ) return 'image'
  if (mimeType === 'text/markdown' || name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown'
  if (
    mimeType?.startsWith('text/') ||
    ['application/json', 'application/xml'].includes(mimeType ?? '') ||
    /\.(txt|csv|json|html?|xml)$/.test(name)
  ) return 'text'
  return null
}
