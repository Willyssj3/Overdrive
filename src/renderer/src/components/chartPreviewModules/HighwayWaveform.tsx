// Highway Waveform overlay (issue #7) — renders the song's audio waveform
// down the 3D note highway so charters can see where notes land against the
// actual audio. The whole song is pre-rendered once into a texture whose rows
// are linear in *ticks* (matching the highway's tick→Z mapping, including
// tempo changes), then scrolled per frame via texture offset — no per-frame
// geometry or canvas work.
import { TRACK_WIDTH, STRIKE_LINE_POS, HIGHWAY_LENGTH } from './constants'
import type { HighwayWaveformData } from './useHighwayWaveform'

/** Translucent waveform strip lying on a single highway. */
export function HighwayWaveform({
  waveform,
  currentTick,
  pixelsPerTick,
  offsetX = 0
}: {
  waveform: HighwayWaveformData
  currentTick: number
  pixelsPerTick: number
  offsetX?: number
}): React.JSX.Element {
  const { texture, totalTicks } = waveform
  // Scroll by mapping the visible tick window onto the song-long texture.
  const visibleTicks = HIGHWAY_LENGTH / pixelsPerTick
  texture.repeat.set(1, visibleTicks / totalTicks)
  texture.offset.set(0, currentTick / totalTicks)
  return (
    <mesh
      position={[offsetX, 0.0005, STRIKE_LINE_POS - HIGHWAY_LENGTH / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[TRACK_WIDTH, HIGHWAY_LENGTH]} />
      <meshBasicMaterial map={texture} transparent opacity={0.4} color="#4DD0E1" depthWrite={false} />
    </mesh>
  )
}
