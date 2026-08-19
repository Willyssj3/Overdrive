// Builds (and rebuilds on audio load) the waveform texture for a song. Split
// out of HighwayWaveform.tsx so that file exports only the display component
// (keeps Fast Refresh happy for both files).
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { onAudioLoaded } from '../../services/audioService'
import { buildTickAlignedWaveformPeaks } from '../../services/waveformService'
import type { TempoEvent } from '../../types'

// Texture resolution: rows along the song (time axis), columns across the track.
const WAVEFORM_ROWS = 4096
const WAVEFORM_TEX_WIDTH = 64
// Cap per-row sample scans so texture build stays fast on long songs.
const MAX_SAMPLES_PER_ROW = 256

export interface HighwayWaveformData {
  texture: THREE.CanvasTexture
  totalTicks: number
}

/**
 * Builds (and rebuilds on audio load) the waveform texture for a song.
 * Returns null when disabled or no audio is loaded.
 */
export function useHighwayWaveform(
  songId: string,
  tempoEvents: TempoEvent[],
  enabled: boolean,
  sourcePath?: string
): HighwayWaveformData | null {
  const [audioVersion, setAudioVersion] = useState(0)
  useEffect(() => onAudioLoaded(songId, () => setAudioVersion((v) => v + 1)), [songId])

  const data = useMemo<HighwayWaveformData | null>(() => {
    void audioVersion
    if (!enabled) return null
    const waveform = buildTickAlignedWaveformPeaks({
      songId,
      tempoEvents,
      rows: WAVEFORM_ROWS,
      sourcePath,
      maxSamplesPerRow: MAX_SAMPLES_PER_ROW
    })
    if (!waveform) return null
    const { peaks, totalTicks } = waveform

    const canvas = document.createElement('canvas')
    canvas.width = WAVEFORM_TEX_WIDTH
    canvas.height = WAVEFORM_ROWS
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, WAVEFORM_TEX_WIDTH, WAVEFORM_ROWS)
    ctx.fillStyle = '#FFFFFF'
    for (let row = 0; row < WAVEFORM_ROWS; row++) {
      // Mild power curve lifts quiet passages so they stay visible.
      const norm = Math.pow(peaks[row], 0.7)
      const w = Math.max(norm > 0 ? 1 : 0, Math.round(norm * WAVEFORM_TEX_WIDTH))
      if (w === 0) continue
      // Tick 0 at the canvas bottom (v=0 with default flipY).
      ctx.fillRect((WAVEFORM_TEX_WIDTH - w) / 2, WAVEFORM_ROWS - 1 - row, w, 1)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    return { texture, totalTicks }
  }, [songId, tempoEvents, enabled, audioVersion, sourcePath])

  // Free GPU memory when the texture is replaced or unmounted.
  useEffect(() => {
    return () => {
      data?.texture.dispose()
    }
  }, [data])

  return data
}
