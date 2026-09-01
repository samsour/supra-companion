import type { CheckpointKind, TripStatus } from '@supra/core'

export const statusLabel: Record<TripStatus, string> = {
  draft: 'Entwurf',
  live: 'Live',
  ended: 'Beendet',
}

export const checkpointIcon: Record<CheckpointKind, string> = {
  fuel: '⛽',
  food: '🍔',
  photo: '📸',
  meet: '🏁',
}

export const checkpointLabel: Record<CheckpointKind, string> = {
  fuel: 'Tanken',
  food: 'Essen',
  photo: 'Foto',
  meet: 'Treffpunkt',
}
