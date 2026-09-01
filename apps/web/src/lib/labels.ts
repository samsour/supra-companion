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
  meet: '📍',
}

/** Der letzte Stopp der Route ist das Ziel — er bekommt die Zielflagge. */
export const stopIcon = (kind: CheckpointKind, isLast: boolean): string =>
  isLast ? '🏁' : checkpointIcon[kind]

export const checkpointLabel: Record<CheckpointKind, string> = {
  fuel: 'Tanken',
  food: 'Essen',
  photo: 'Foto',
  meet: 'Treffpunkt',
}
