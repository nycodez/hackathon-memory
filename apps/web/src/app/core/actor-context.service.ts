import { Injectable, signal } from '@angular/core'

const actorStorageKey = 'hackathon-memory-demo-actor'

@Injectable({ providedIn: 'root' })
export class ActorContextService {
  readonly selectedActorId = signal(readStoredActor())

  select(actorId: string): void {
    this.selectedActorId.set(actorId)
    try {
      if (actorId) localStorage.setItem(actorStorageKey, actorId)
      else localStorage.removeItem(actorStorageKey)
    } catch {
      // The selected actor still works for this session when storage is unavailable.
    }
  }
}

function readStoredActor(): string {
  try {
    return localStorage.getItem(actorStorageKey) ?? ''
  } catch {
    return ''
  }
}
