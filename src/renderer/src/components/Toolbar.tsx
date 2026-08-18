// Top toolbar with playback controls and global actions
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore, useSettingsStore, getSongStore, removeSongStore, useUIStore } from '../stores'
import * as audioService from '../services/audioService'
import * as playbackController from '../services/playbackController'
import {
  serializeMidiBase64,
  serializeChartFile
} from '../utils/midiParser'
import { validateChartAsync } from '../utils/chartValidation'
import { SettingsModal } from './SettingsModal'
import { ExportModal } from './ExportModal'
import { ValidationPreviewCard } from './ValidationPreviewCard'
import './Toolbar.css'

type AutoChartProgressState = {
  runId: string | null
  stage: string
  message: string
  percent: number
  currentItem?: string
  isRunning: boolean
  outputDir: string
  error: string | null
  warnings: string[]
}

const EMPTY_AUTO_CHART_URL = ''
const AUTO_CHART_STAGE_ORDER: Record<string, number> = {
  bootstrap: 0,
  download: 1,
  separation: 2,
  drums: 3,
  guitar: 4,
  bass: 5,
  vocals: 6,
  keys: 7,
  merge: 8,
  complete: 9,
  error: 10
}

export function Toolbar(): React.JSX.Element {
  const { t } = useTranslation()
  const { activeSongId, setLoadedFolder, setPendingActiveSong } = useProjectStore()
  const isExportModalOpen = useUIStore((s) => s.isExportModalOpen)
  const setExportModalOpen = useUIStore((s) => s.setExportModalOpen)
  const validationIssues = useUIStore((s) => s.validationIssues)
  const setValidationIssues = useUIStore((s) => s.setValidationIssues)
  const {
    autosaveEnabled,
    highwaySpeed,
    volume,
    leftyFlip,
    enableAutoChart,
    autoChartOutputDir,
    autoChartDisableOnlineLookup,
    autoChartDownloadVideo,
    autoChartKeepStems,
    autoChartStarPower,
    autoChartImproveTempo,
    autoChartSnapDrums,
    autoChartEnabledTracks,
    updateSettings
  } = useSettingsStore()
  const [isAudioLoaded, setIsAudioLoaded] = useState(false)
  const [showOpenDropdown, setShowOpenDropdown] = useState(false)
  const [isAutoChartModalOpen, setIsAutoChartModalOpen] = useState(false)
  const [autoChartFiles, setAutoChartFiles] = useState<string[]>([])
  const [autoChartFolders, setAutoChartFolders] = useState<string[]>([])
  const [autoChartStemFolders, setAutoChartStemFolders] = useState<string[]>([])
  const [autoChartInputTab, setAutoChartInputTab] = useState<'mix' | 'stems'>('mix')
  const [autoChartFullMixSubTab, setAutoChartFullMixSubTab] = useState<
    'files' | 'folders' | 'urls'
  >('files')
  type StemSong = {
    id: string
    name: string
    stems: {
      drums: string
      bass: string
      vocals: string
      guitar: string
      piano: string
      vocalsHarm2: string
      vocalsHarm3: string
      crowd: string
    }
    extras: string[]
  }
  const makeEmptyStemSong = (): StemSong => ({
    id: `stem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    stems: {
      drums: '',
      bass: '',
      vocals: '',
      guitar: '',
      piano: '',
      vocalsHarm2: '',
      vocalsHarm3: '',
      crowd: ''
    },
    extras: []
  })
  const [autoChartStemSongs, setAutoChartStemSongs] = useState<StemSong[]>([makeEmptyStemSong()])
  const [autoChartUrls, setAutoChartUrls] = useState<string[]>([EMPTY_AUTO_CHART_URL])
  // Optional single-BPM hint typed by the user, treated as authoritative. Empty
  // = detect by beat-tracking the audio (see strum_worker _beat_track_tempo_map).
  const [autoChartManualBpm, setAutoChartManualBpm] = useState('')
  const [autoChartAdvancedOpen, setAutoChartAdvancedOpen] = useState(false)
  // Optional user-supplied tempo map. Empty = use Overdrive Engine's auto-detection.
  // First entry's BPM (sorted by timeSec) overrides initial detected tempo.
  const [autoChartTempoEvents, setAutoChartTempoEvents] = useState<
    Array<{ timeSec: string; bpm: string }>
  >([])
  const [autoChartCloseCountdown, setAutoChartCloseCountdown] = useState<number | null>(null)
  const [defaultAutoChartOutputDir, setDefaultAutoChartOutputDir] = useState('')
  const [autoChartErrorCopied, setAutoChartErrorCopied] = useState(false)
  const [autoChartProgress, setAutoChartProgress] = useState<AutoChartProgressState>({
    runId: null,
    stage: 'bootstrap',
    message: '',
    percent: 0,
    isRunning: false,
    outputDir: autoChartOutputDir ?? '',
    error: null,
    warnings: []
  })
  const [runtimeStatus, setRuntimeStatus] = useState<{
    managed: boolean
    ready: boolean
    installing: boolean
  } | null>(null)
  const [isInstallingRuntime, setIsInstallingRuntime] = useState(false)
  const [runtimeSetupError, setRuntimeSetupError] = useState<string | null>(null)
  const [runtimeSetupErrorCopied, setRuntimeSetupErrorCopied] = useState(false)

  const refreshRuntimeStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.getRuntimeStatus()
      setRuntimeStatus({ managed: next.managed, ready: next.ready, installing: next.installing })
      if (!next.installing) setIsInstallingRuntime(false)
    } catch (err) {
      console.error('runtime:status failed', err)
    }
  }, [])

  const handleSetupRuntime = useCallback(async (): Promise<void> => {
    setIsInstallingRuntime(true)
    setRuntimeSetupError(null)
    setRuntimeSetupErrorCopied(false)
    try {
      const result = await window.api.bootstrapRuntime()
      if (!result.ok) setRuntimeSetupError(result.message ?? t('toolbar.autoChart.setupFailed'))
    } catch (err) {
      setRuntimeSetupError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsInstallingRuntime(false)
      await refreshRuntimeStatus()
    }
  }, [refreshRuntimeStatus])

  const handleCopyRuntimeSetupError = useCallback(async (): Promise<void> => {
    if (!runtimeSetupError) return
    try {
      await navigator.clipboard.writeText(runtimeSetupError)
      setRuntimeSetupErrorCopied(true)
      window.setTimeout(() => setRuntimeSetupErrorCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy runtime setup error:', err)
    }
  }, [runtimeSetupError])

  const getPreferredAutoChartOutputDir = useCallback((): string => {
    return autoChartOutputDir?.trim() || defaultAutoChartOutputDir
  }, [autoChartOutputDir, defaultAutoChartOutputDir])

  // Get active song store if available
  const songStore = activeSongId ? getSongStore(activeSongId) : null

  // Reactively subscribe to song store state so UI updates when isPlaying/folderPath changes
  const [isPlaying, setIsPlaying] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_folderPath, setFolderPath] = useState<string | null>(null)
  const [songName, setSongName] = useState('')
  const [songArtist, setSongArtist] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_snapDivision, setSnapDivision] = useState(4)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_currentBpm, setCurrentBpm] = useState(120)
  const [isValidating, setIsValidating] = useState(false)

  const cleanupAllDuplicates = async (): Promise<void> => {
    if (!activeSongId) return
    const store = getSongStore(activeSongId)
    const currentSong = store.getState().song
    const notes = currentSong.notes || []

    const seen = new Set<string>()
    const duplicatesToRemove: string[] = []

    for (const note of notes) {
      const key = `${note.instrument}|${note.difficulty}|${note.lane}|${note.tick}`
      if (seen.has(key)) {
        duplicatesToRemove.push(note.id)
      } else {
        seen.add(key)
      }
    }

    if (duplicatesToRemove.length === 0) return

    for (const id of duplicatesToRemove) {
      store.getState().deleteNote(id)
    }

    try {
      const updatedState = store.getState()
      const settings = useSettingsStore.getState()
      const newIssues = await validateChartAsync(updatedState.song, settings)
      setValidationIssues(newIssues)
    } catch (err) {
      console.error('[cleanupAllDuplicates validation failed]', err)
    }
  }

  useEffect(() => {
    if (!songStore) {
      setIsPlaying(false)
      setFolderPath(null)
      setSongName('')
      setSongArtist('')
      setIsDirty(false)
      return
    }

    let lastValidationId = 0

    // Seed on mount
    const s = songStore.getState()
    setIsPlaying(s.isPlaying)
    setFolderPath(s.song.folderPath)
    setSongName(s.song.metadata.name)
    setSongArtist(s.song.metadata.artist)
    setIsDirty(s.isDirty)
    setSnapDivision(s.snapDivision)
    setCurrentBpm(s.song.tempoEvents[0]?.bpm ?? 120)

    return songStore.subscribe((state, prev) => {
      if (state.isPlaying !== prev.isPlaying) setIsPlaying(state.isPlaying)
      if (state.song.folderPath !== prev.song.folderPath) setFolderPath(state.song.folderPath)
      if (state.song.metadata.name !== prev.song.metadata.name)
        setSongName(state.song.metadata.name)
      if (state.song.metadata.artist !== prev.song.metadata.artist)
        setSongArtist(state.song.metadata.artist)
      if (state.isDirty !== prev.isDirty) setIsDirty(state.isDirty)
      if (state.snapDivision !== prev.snapDivision) setSnapDivision(state.snapDivision)
      if (state.song.tempoEvents !== prev.song.tempoEvents)
        setCurrentBpm(state.song.tempoEvents[0]?.bpm ?? 120)
      if (state.song.notes !== prev.song.notes || state.song.vocalNotes !== prev.song.vocalNotes) {
        const currentIssues = useUIStore.getState().validationIssues
        if (currentIssues !== null) {
          const validationId = ++lastValidationId
          const settings = useSettingsStore.getState()
          validateChartAsync(state.song, settings)
            .then((newIssues) => {
              if (validationId === lastValidationId) {
                useUIStore.getState().setValidationIssues(newIssues)
              }
            })
            .catch((err) => {
              if (validationId === lastValidationId) {
                console.error('[Validation Subscription Error]', err)
              }
            })
        }
      }
    })
  }, [songStore])

  // Single effect for song switching: stop old playback, load new audio
  // Only depends on activeSongId — reads folderPath directly from store, not React state
  const prevSongIdRef = useRef<string | null>(null)

  useEffect(() => {
    // 1. Stop old song completely
    const prevId = prevSongIdRef.current
    if (prevId) {
      // Stop ALL playback (audio + visual RAF) as a safety net
      playbackController.stopAll()
      if (prevId !== activeSongId) {
        const prevStore = getSongStore(prevId)
        prevStore.getState().setIsPlaying(false)
        prevStore.getState().setCurrentTick(0)
        console.log('[Toolbar] Song changed, stopped old song:', prevId)
      }
    }
    prevSongIdRef.current = activeSongId

    // 2. Load new song audio
    if (!activeSongId) {
      setIsAudioLoaded(false)
      return
    }

    const newStore = getSongStore(activeSongId)
    const newFolderPath = newStore.getState().song.folderPath

    if (!newFolderPath) {
      setIsAudioLoaded(false)
      return
    }

    setIsAudioLoaded(false)
    audioService.setActiveSong(activeSongId)

    const songId = activeSongId
    let cancelled = false
    console.log('[Toolbar] Loading audio for song:', songId, 'path:', newFolderPath)
    audioService.loadAudio(songId, newFolderPath).then(async (loaded) => {
      if (!cancelled) {
        console.log('[Toolbar] Audio loaded result:', loaded, 'for:', songId)
        setIsAudioLoaded(loaded)
        // Apply persisted volume to newly-created gain node
        if (loaded) {
          const vol = useSettingsStore.getState().volume
          audioService.setVolume(vol ?? 0.8)

          // If song is already playing (visual-only fallback), upgrade to audio
          const store = getSongStore(songId)
          if (store.getState().isPlaying) {
            const currentTick = store.getState().currentTick
            playbackController.stopPlayback(songId)
            store.getState().setCurrentTick(currentTick)
            await playbackController.startPlayback(songId)
          }
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeSongId])

  // Apply volume changes
  useEffect(() => {
    audioService.setVolume(volume ?? 0.8)
  }, [volume])

  useEffect(() => {
    let cancelled = false

    void window.api.getDefaultAutoChartOutputDir().then((defaultPath) => {
      if (cancelled) return

      setDefaultAutoChartOutputDir(defaultPath)

      const currentSettings = useSettingsStore.getState()
      const nextSettings: Partial<ReturnType<typeof useSettingsStore.getState>> = {}
      if (!currentSettings.autoChartOutputDir?.trim()) {
        nextSettings.autoChartOutputDir = defaultPath
      }
      if (!currentSettings.enableAutoChart && !currentSettings.autoChartOutputDir?.trim()) {
        nextSettings.enableAutoChart = true
      }
      if (Object.keys(nextSettings).length > 0) {
        updateSettings(nextSettings)
      }
    })

    return () => {
      cancelled = true
    }
  }, [updateSettings])

  const loadProjectFolder = useCallback(
    (folderPath: string, preferredActiveSongId?: string): void => {
      // ProjectExplorer owns metadata-first loading and IndexedDB cache validation.
      // Updating the shared folder path triggers that loader without eagerly parsing
      // every MIDI/chart on the toolbar action path.
      updateSettings({ lastOpenedFolder: folderPath })
      const project = useProjectStore.getState()
      if (project.loadedFolderPath !== folderPath) {
        for (const songId of project.songIds) removeSongStore(songId)
      }
      setLoadedFolder(folderPath)
      setPendingActiveSong(preferredActiveSongId ?? null)
    },
    [setLoadedFolder, setPendingActiveSong, updateSettings]
  )

  const handleOpenFolder = async (): Promise<void> => {
    try {
      const folderPath = await window.api.openFolder()
      if (!folderPath) return
      loadProjectFolder(folderPath)
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }

  const handleImportPackage = async (): Promise<void> => {
    try {
      const folderPath = await window.api.importSongPackage()
      if (!folderPath) return
      await loadProjectFolder(folderPath)
    } catch (error) {
      console.error('Failed to import song package:', error)
    }
  }

  useEffect(() => {
    return window.api.onAutoChartProgress((event) => {
      // Runtime setup progress (Python install on first launch) is owned by
      // SetupModal; ignore here so it doesn't latch isRunning=true on the
      // Auto-Chart modal until the next app restart.
      if (event.runId === 'runtime-setup') return
      setAutoChartProgress((prev) => {
        if (prev.runId && event.runId !== prev.runId) return prev

        const currentRank = AUTO_CHART_STAGE_ORDER[prev.stage] ?? -1
        const incomingRank = AUTO_CHART_STAGE_ORDER[event.stage] ?? -1
        if (incomingRank < currentRank && event.stage !== 'error' && event.stage !== 'complete') {
          return prev
        }

        const incomingPercent = event.percent ?? prev.percent
        const nextPercent =
          incomingRank === currentRank ? Math.max(prev.percent, incomingPercent) : incomingPercent

        return {
          ...prev,
          runId: event.runId,
          stage: event.stage,
          message: event.message,
          percent: nextPercent,
          currentItem: event.currentItem,
          isRunning: event.stage !== 'complete' && event.stage !== 'error',
          error: null
        }
      })
    })
  }, [])

  useEffect(() => {
    return window.api.onAutoChartComplete((event) => {
      if (event.runId === 'runtime-setup') return
      setAutoChartProgress((prev) => {
        if (prev.runId !== event.runId) return prev
        return {
          ...prev,
          isRunning: false,
          percent: 100,
          stage: 'complete',
          message: event.success
            ? t('toolbar.autoChart.completeMessage')
            : t('toolbar.autoChart.completeNoSuccessMessage'),
          warnings: event.errors
        }
      })

      const newSongId = event.success && event.songFolders.length > 0
        ? event.songFolders[0].split(/[\\/]/).pop()
        : undefined

      if (event.outputDir) {
        updateSettings({ autoChartOutputDir: event.outputDir, lastOpenedFolder: event.outputDir })
        // Optionally pull the source video for any URL inputs into their
        // resulting song folders so it shows up in the timeline / in-game.
        if (event.success && autoChartDownloadVideo && event.urlSongFolders && event.urlSongFolders.length > 0) {
          void Promise.allSettled(
            event.urlSongFolders.map((entry) =>
              window.api.downloadVideoUrl(entry.songFolder, entry.url).catch((err) => {
                console.warn('[auto-chart] video download failed:', entry.url, err)
                return { success: false }
              })
            )
          ).then(() => {
            loadProjectFolder(event.outputDir, newSongId)
          })
        } else {
          loadProjectFolder(event.outputDir, newSongId)
        }
      }

      if (event.success) {
        setAutoChartCloseCountdown(5)
      }
    })
  }, [autoChartDownloadVideo, loadProjectFolder, updateSettings])

  useEffect(() => {
    return window.api.onAutoChartError((event) => {
      if (event.runId === 'runtime-setup') return
      setAutoChartProgress((prev) => {
        if (prev.runId !== event.runId) return prev
        return {
          ...prev,
          isRunning: false,
          stage: 'error',
          error: event.message,
          message: event.message
        }
      })
    })
  }, [])

  // Tick the post-success countdown and auto-close the modal at 0.
  useEffect(() => {
    if (autoChartCloseCountdown === null) return
    if (autoChartCloseCountdown <= 0) {
      setIsAutoChartModalOpen(false)
      setAutoChartCloseCountdown(null)
      return
    }
    const timer = window.setTimeout(() => {
      setAutoChartCloseCountdown((prev) => (prev === null ? null : prev - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [autoChartCloseCountdown])

  const openAutoChartModal = useCallback((): void => {
    setAutoChartCloseCountdown(null)
    setAutoChartProgress((prev) => ({
      ...prev,
      outputDir: getPreferredAutoChartOutputDir(),
      error: null
    }))
    setAutoChartUrls((prev) => (prev.length > 0 ? prev : [EMPTY_AUTO_CHART_URL]))
    setRuntimeSetupError(null)
    void refreshRuntimeStatus()
    setIsAutoChartModalOpen(true)
  }, [getPreferredAutoChartOutputDir, refreshRuntimeStatus])

  const handleAddAutoChartUrl = useCallback((): void => {
    setAutoChartUrls((prev) => [...prev, EMPTY_AUTO_CHART_URL])
  }, [])

  const handleUpdateAutoChartUrl = useCallback((index: number, value: string): void => {
    setAutoChartUrls((prev) =>
      prev.map((entry, entryIndex) => (entryIndex === index ? value : entry))
    )
  }, [])

  const handleRemoveAutoChartUrl = useCallback((index: number): void => {
    setAutoChartUrls((prev) => {
      if (prev.length === 1) {
        return [EMPTY_AUTO_CHART_URL]
      }

      return prev.filter((_, entryIndex) => entryIndex !== index)
    })
  }, [])

  const handleCopyAutoChartError = useCallback(async (): Promise<void> => {
    if (!autoChartProgress.error) return

    try {
      await navigator.clipboard.writeText(autoChartProgress.error)
      setAutoChartErrorCopied(true)
      window.setTimeout(() => setAutoChartErrorCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy auto-chart error:', error)
    }
  }, [autoChartProgress.error])

  const handleStartAutoChart = useCallback(async (): Promise<void> => {
    setAutoChartCloseCountdown(null)
    const outputDir = autoChartProgress.outputDir.trim()
    const urls = autoChartUrls.map((entry) => entry.trim()).filter(Boolean)

    // Build payload-ready stem songs: drop entries that don't have at least
    // a name and one stem, and trim empty stem slots so the worker doesn't
    // try to ingest blank paths.
    const stemSongs = autoChartStemSongs
      .map((song) => {
        const stems: Record<string, string> = {}
        for (const [key, value] of Object.entries(song.stems)) {
          const trimmed = value.trim()
          if (trimmed) stems[key] = trimmed
        }
        const extras = song.extras.map((v) => v.trim()).filter(Boolean)
        return { name: song.name.trim(), stems, extras }
      })
      .filter((song) => Object.keys(song.stems).length > 0 || song.extras.length > 0)

    if (runtimeStatus && runtimeStatus.managed && !runtimeStatus.ready) {
      setAutoChartProgress((prev) => ({
        ...prev,
        error: t('toolbar.autoChart.errors.runtimeNotSetUp')
      }))
      return
    }

    if (!outputDir) {
      setAutoChartProgress((prev) => ({
        ...prev,
        error: t('toolbar.autoChart.errors.chooseOutputFolder')
      }))
      return
    }

    if (
      autoChartFiles.length === 0 &&
      autoChartFolders.length === 0 &&
      autoChartStemFolders.length === 0 &&
      stemSongs.length === 0 &&
      urls.length === 0
    ) {
      setAutoChartProgress((prev) => ({
        ...prev,
        error: t('toolbar.autoChart.errors.addAtLeastOneInput')
      }))
      return
    }

    // Each stem song needs a name and at least one charted/playable input
    // so the pipeline can produce a usable mix.
    for (const song of stemSongs) {
      if (!song.name) {
        setAutoChartProgress((prev) => ({
          ...prev,
          error: t('toolbar.autoChart.errors.everyStemSongNeedsName')
        }))
        return
      }
      const hasInstrument = [
        'drums',
        'bass',
        'vocals',
        'guitar',
        'piano',
        'vocalsHarm2',
        'vocalsHarm3',
        'crowd'
      ].some((k) => song.stems[k])
      if (!hasInstrument && song.extras.length === 0) {
        setAutoChartProgress((prev) => ({
          ...prev,
          error: t('toolbar.autoChart.errors.stemSongNoStemsSelected', { name: song.name })
        }))
        return
      }
    }

    updateSettings({ autoChartOutputDir: outputDir })
    setAutoChartErrorCopied(false)
    setAutoChartProgress((prev) => ({
      ...prev,
      isRunning: true,
      error: null,
      warnings: [],
      message: t('toolbar.autoChart.launchingMessage'),
      percent: 0
    }))

    try {
      const { runId } = await window.api.startAutoChart({
        outputDir,
        files: autoChartFiles,
        folders: autoChartFolders,
        stemFolders: autoChartStemFolders,
        stemSongs,
        urls,
        includeKeys: autoChartEnabledTracks.keys,
        disableOnlineLookup: autoChartDisableOnlineLookup,
        skipHarmonies: !autoChartEnabledTracks.harmonies,
        keepStems: autoChartKeepStems,
        starPower: autoChartStarPower,
        autoTempo: autoChartImproveTempo,
        snapDrums: autoChartSnapDrums,
        enabledTracks: autoChartEnabledTracks,
        manualBpm: (() => {
          const bpm = parseFloat(autoChartManualBpm)
          return Number.isFinite(bpm) && bpm > 0 ? bpm : undefined
        })(),
        tempoMap: (() => {
          const parsed = autoChartTempoEvents
            .map((e) => ({ timeSec: parseFloat(e.timeSec), bpm: parseFloat(e.bpm) }))
            .filter(
              (e) =>
                Number.isFinite(e.timeSec) && Number.isFinite(e.bpm) && e.bpm > 0 && e.timeSec >= 0
            )
            .sort((a, b) => a.timeSec - b.timeSec)
          return parsed.length > 0 ? parsed : undefined
        })()
      })
      setAutoChartProgress((prev) => ({ ...prev, runId }))
    } catch (error) {
      setAutoChartProgress((prev) => ({
        ...prev,
        isRunning: false,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }, [
    autoChartDisableOnlineLookup,
    autoChartEnabledTracks,
    autoChartFiles,
    autoChartFolders,
    autoChartImproveTempo,
    autoChartKeepStems,
    autoChartStarPower,
    autoChartSnapDrums,
    autoChartStemFolders,
    autoChartStemSongs,
    autoChartProgress.outputDir,
    autoChartTempoEvents,
    autoChartManualBpm,
    autoChartUrls,
    runtimeStatus,
    updateSettings
  ])

  const handleCancelAutoChart = useCallback(async (): Promise<void> => {
    if (!autoChartProgress.runId) return
    await window.api.cancelAutoChart(autoChartProgress.runId)
  }, [autoChartProgress.runId])

  const handleSave = async (): Promise<void> => {
    if (!songStore) return
    const state = songStore.getState()
    try {
      // Save song.ini
      await window.api.writeSongIni(state.song.folderPath, state.song.metadata)

      // Save notes in the original format
      const hasNotes = state.song.notes.length > 0 || state.song.vocalNotes.length > 0
      if (hasNotes) {
        if (state.song.sourceFormat === 'chart') {
          const chartText = serializeChartFile(
            state.song.notes,
            state.song.tempoEvents,
            state.song.timeSignatures,
            state.song.starPowerPhrases,
            state.song.vocalNotes,
            state.song.vocalPhrases,
            state.song.soloSections,
            state.song.songSections,
            state.song.metadata as Record<string, unknown>,
            192,
            state.song.laneMarkers,
            state.song.venueTrack
          )
          await window.api.writeSongChart(state.song.folderPath, chartText)
        } else {
          const midiBase64 = serializeMidiBase64(
            state.song.notes,
            state.song.tempoEvents,
            state.song.timeSignatures,
            480,
            state.song.starPowerPhrases,
            state.song.vocalNotes,
            state.song.vocalPhrases,
            state.song.soloSections,
            state.song.songSections,
            state.song.laneMarkers,
            state.song.venueTrack
          )
          await window.api.writeSongMidi(state.song.folderPath, midiBase64)
        }
      }

      // Save video.json
      const vs = state.song.videoSync
      if (vs.videoPath || vs.clips.length > 0) {
        await window.api.writeVideoJson(state.song.folderPath, {
          videoPath: vs.videoPath,
          clips: vs.clips,
          offsetMs: vs.offsetMs
        })
      }

      if (state.song.audioSync.clips.length > 0) {
        await window.api.writeAudioJson(state.song.folderPath, {
          clips: state.song.audioSync.clips
        })
      }

      const venueTrack = state.song.venueTrack
      if (
        venueTrack.autoGenerated ||
        venueTrack.lighting.length > 0 ||
        venueTrack.postProcessing.length > 0 ||
        venueTrack.stage.length > 0 ||
        venueTrack.performer.length > 0 ||
        venueTrack.cameraCuts.length > 0 ||
        venueTrack.preservedTextEvents?.length
      ) {
        await window.api.writeVenueJson(state.song.folderPath, venueTrack)
      }

      state.markClean()
      console.log(`Saved: ${state.song.metadata.name}`)
    } catch (error) {
      console.error('Manual save failed:', error)
    }
  }

  const handleUndo = (): void => {
    if (songStore) {
      const temporal = songStore.temporal
      temporal.getState().undo()
    }
  }

  const handleRedo = (): void => {
    if (songStore) {
      const temporal = songStore.temporal
      temporal.getState().redo()
    }
  }

  // Updater state
  type UpdaterStatusState = {
    state:
      | 'idle'
      | 'checking'
      | 'available'
      | 'downloading'
      | 'downloaded'
      | 'not-available'
      | 'error'
    version?: string
    percent?: number
    message?: string
  }
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusState>({ state: 'idle' })
  const updaterDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!window.api.onUpdaterStatus) return
    const cleanup = window.api.onUpdaterStatus((status) => {
      setUpdaterStatus(status)
      // Auto-dismiss non-active states after a few seconds
      if (updaterDismissTimer.current) clearTimeout(updaterDismissTimer.current)
      if (status.state === 'not-available') {
        updaterDismissTimer.current = setTimeout(() => setUpdaterStatus({ state: 'idle' }), 4000)
      }
    })
    return () => {
      cleanup()
      if (updaterDismissTimer.current) clearTimeout(updaterDismissTimer.current)
    }
  }, [])

  // Guard against overlapping play/pause calls
  const playPauseBusy = useRef(false)

  const handlePlayPause = useCallback(async (): Promise<void> => {
    if (!activeSongId) {
      console.log('[Toolbar] No active song')
      return
    }

    // Prevent overlapping calls
    if (playPauseBusy.current) {
      console.log('[Toolbar] Play/pause already in progress, ignoring')
      return
    }
    playPauseBusy.current = true

    try {
      await playbackController.togglePlayback(activeSongId)
    } finally {
      playPauseBusy.current = false
    }
  }, [activeSongId])

  const handleStop = useCallback((): void => {
    if (!activeSongId) return
    playbackController.stopAndReset(activeSongId)
  }, [activeSongId])

  return (
    <div className="toolbar">
      {/* File actions */}
      <div className="toolbar-group">
        <div className="toolbar-dropdown-wrapper">
          <button
            className={`toolbar-button ${showOpenDropdown ? 'active' : ''}`}
            onClick={() => setShowOpenDropdown(!showOpenDropdown)}
            title={t('toolbar.openLibraryImportPackage')}
          >
            <span className="toolbar-icon">📁</span>
            <span className="toolbar-label">{t('common.open')}</span>
          </button>
          {showOpenDropdown && (
            <>
              <div className="toolbar-dropdown-backdrop" onClick={() => setShowOpenDropdown(false)} />
              <div className="toolbar-dropdown-menu">
                <button
                  className="toolbar-dropdown-item"
                  onClick={async () => {
                    setShowOpenDropdown(false)
                    await handleOpenFolder()
                  }}
                >
                  <span className="dropdown-icon">📂</span>
                  <span className="dropdown-label">{t('toolbar.openSongLibraryFolder')}</span>
                </button>
                <button
                  className="toolbar-dropdown-item"
                  onClick={async () => {
                    setShowOpenDropdown(false)
                    await handleImportPackage()
                  }}
                >
                  <span className="dropdown-icon">📦</span>
                  <span className="dropdown-label">{t('toolbar.importSongPackage')}</span>
                </button>
              </div>
            </>
          )}
        </div>
        <button
          className="toolbar-button"
          onClick={handleSave}
          disabled={!activeSongId}
          title={t('common.save')}
        >
          <span className="toolbar-icon">💾</span>
          <span className="toolbar-label">{t('common.save')}</span>
        </button>
        <button
          className="toolbar-button"
          onClick={() => setExportModalOpen(true)}
          disabled={!activeSongId}
          title={t('common.export')}
        >
          <span className="toolbar-icon">📤</span>
          <span className="toolbar-label">{t('common.export')}</span>
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* Edit actions */}
      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={handleUndo}
          disabled={!activeSongId}
          title={t('toolbar.undoShortcut')}
        >
          <span className="toolbar-icon">↩</span>
        </button>
        <button
          className="toolbar-button"
          onClick={handleRedo}
          disabled={!activeSongId}
          title={t('toolbar.redoShortcut')}
        >
          <span className="toolbar-icon">↪</span>
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* Playback controls */}
      <div className="toolbar-group toolbar-playback">
        <button
          className="toolbar-button toolbar-button-play"
          onClick={handlePlayPause}
          disabled={!activeSongId}
          title={isAudioLoaded ? t('toolbar.playPauseShortcut') : t('toolbar.playPauseNoAudio')}
        >
          <span className="toolbar-icon">{isPlaying ? '⏸' : '▶'}</span>
        </button>
        <button
          className="toolbar-button"
          onClick={handleStop}
          disabled={!activeSongId}
          title={t('toolbar.stop')}
        >
          <span className="toolbar-icon">⏹</span>
        </button>
      </div>

      {/* Volume control */}
      <div className="toolbar-group toolbar-volume">
        <span className="toolbar-icon toolbar-volume-icon">🔊</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
          className="toolbar-volume-slider"
          title={t('toolbar.volumePercent', { percent: Math.round(volume * 100) })}
          style={{ ['--slider-fill' as string]: `${volume * 100}%` }}
        />
        <StemMixerButton activeSongId={activeSongId} />
      </div>

      <div className="toolbar-separator" />

      {/* Highway speed control */}
      <div className="toolbar-group toolbar-speed">
        <span className="toolbar-label toolbar-speed-label">{t('toolbar.speed')}</span>
        <input
          type="range"
          min="0.25"
          max="3"
          step="0.25"
          value={highwaySpeed}
          onChange={(e) => updateSettings({ highwaySpeed: parseFloat(e.target.value) })}
          className="toolbar-speed-slider"
          title={t('toolbar.highwaySpeedValue', { speed: highwaySpeed })}
          style={{ ['--slider-fill' as string]: `${((highwaySpeed - 0.25) / (3 - 0.25)) * 100}%` }}
        />
        <span className="toolbar-speed-value">{highwaySpeed}x</span>
      </div>

      {/* Song info */}
      <div className="toolbar-song-info">
        {songName ? (
          <>
            <span className="toolbar-song-name">{songName}</span>
            <span className="toolbar-song-artist">{songArtist}</span>
            {isDirty && <span className="dirty-indicator" title={t('toolbar.unsavedChanges')} />}
          </>
        ) : (
          <span className="toolbar-no-song">{t('toolbar.noSongLoaded')}</span>
        )}
      </div>

      {/* Update status indicator */}
      {updaterStatus.state !== 'idle' && (
        <div className={`toolbar-updater toolbar-updater--${updaterStatus.state}`}>
          {updaterStatus.state === 'checking' && (
            <span className="toolbar-updater-label">{t('toolbar.updater.checking')}</span>
          )}
          {updaterStatus.state === 'not-available' && (
            <span className="toolbar-updater-label">{t('toolbar.updater.upToDate')}</span>
          )}
          {updaterStatus.state === 'available' && (
            <span className="toolbar-updater-label">
              ⬇ {t('toolbar.updater.updateAvailable', { version: updaterStatus.version })}
            </span>
          )}
          {updaterStatus.state === 'downloading' && (
            <>
              <span className="toolbar-updater-label">
                {t('toolbar.updater.downloadingUpdate', { message: updaterStatus.message ?? '' })}
              </span>
              <div className="toolbar-updater-bar">
                <div
                  className="toolbar-updater-bar-fill"
                  style={{ width: `${updaterStatus.percent ?? 0}%` }}
                />
              </div>
            </>
          )}
          {updaterStatus.state === 'downloaded' && (
            <span className="toolbar-updater-label">✔ {t('toolbar.updater.updateReady')}</span>
          )}
          {updaterStatus.state === 'error' && (
            <span className="toolbar-updater-label" title={updaterStatus.message}>
              ⚠ {t('toolbar.updater.updateError')}
            </span>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="toolbar-spacer" />

      {/* Settings */}
      <div className="toolbar-group">
        <label className="toolbar-toggle" title={t('toolbar.autoSave')}>
          <input
            type="checkbox"
            checked={autosaveEnabled}
            onChange={(e) => updateSettings({ autosaveEnabled: e.target.checked })}
          />
          <span className="toolbar-toggle-label">{t('toolbar.autoSave')}</span>
        </label>
        <label
          className="toolbar-toggle"
          title={t('toolbar.leftyFlipTooltip')}
        >
          <input
            type="checkbox"
            checked={leftyFlip ?? false}
            onChange={(e) => updateSettings({ leftyFlip: e.target.checked })}
          />
          <span className="toolbar-toggle-label">{t('toolbar.leftyFlip')}</span>
        </label>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className="toolbar-button toolbar-button-accent"
          disabled={!enableAutoChart}
          title={
            enableAutoChart
              ? t('toolbar.autoChart.tooltipEnabled')
              : t('toolbar.autoChart.tooltipDisabled')
          }
          onClick={openAutoChartModal}
        >
          <span className="toolbar-icon">🤖</span>
          <span className="toolbar-label">{t('toolbar.autoChart.buttonLabel')}</span>
          <span
            className="toolbar-experimental-tag"
            title={t('toolbar.autoChart.experimentalTooltip')}
          >
            {t('toolbar.autoChart.experimentalTag')}
          </span>
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* Validate chart */}
      <div className="toolbar-group">
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <button
          className="toolbar-button"
          disabled={!activeSongId || isValidating}
          title={t('toolbar.validateChart')}
          onClick={() => {
            if (!activeSongId || isValidating) return
            setIsValidating(true)
            const startTime = Date.now()
            setTimeout(async () => {
              try {
                const state = getSongStore(activeSongId).getState()
                const settings = useSettingsStore.getState()
                const issues = await validateChartAsync(state.song, settings)

                const elapsed = Date.now() - startTime
                const remaining = Math.max(0, 500 - elapsed)
                if (remaining > 0) {
                  await new Promise((resolve) => setTimeout(resolve, remaining))
                }

                setValidationIssues(issues)
              } catch (err) {
                console.error('[Validate Action Error]', err)
              } finally {
                setIsValidating(false)
              }
            }, 50)
          }}
        >
          {isValidating ? (
            <span
              className="toolbar-icon"
              style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}
            >
              ↻
            </span>
          ) : (
            <span className="toolbar-icon">✓</span>
          )}
          <span className="toolbar-label">
            {isValidating ? t('toolbar.validating') : t('toolbar.validate')}
          </span>
        </button>
      </div>

      {/* Validation results modal */}
      {validationIssues !== null && songStore !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setValidationIssues(null)}
        >
          <div
            style={{
              backgroundColor: '#161622',
              border: '1px solid #2d2d3d',
              borderRadius: 8,
              padding: '24px',
              width: '1000px',
              maxWidth: '95vw',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const hasOverlaps = validationIssues.some((issue) =>
                issue.message.toLowerCase().includes('overlapping note')
              )
              return (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16
                  }}
                >
                  <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 700 }}>
                    {t('toolbar.validation.title')}
                  </h3>
                  {hasOverlaps && (
                    <button
                      onClick={cleanupAllDuplicates}
                      style={{
                        backgroundColor: '#ff4d4d',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginLeft: '16px',
                        marginRight: 'auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'background-color 0.2s',
                        boxShadow: '0 2px 8px rgba(255, 77, 77, 0.3)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#ff3333'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#ff4d4d'
                      }}
                    >
                      ✨ {t('toolbar.validation.cleanUpDuplicates')}
                    </button>
                  )}
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#aaa',
                      cursor: 'pointer',
                      fontSize: 20,
                      lineHeight: 1
                    }}
                    onClick={() => setValidationIssues(null)}
                  >
                    ✕
                  </button>
                </div>
              )
            })()}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
              {validationIssues.length === 0 ? (
                <p style={{ color: '#2ecc71', margin: 0, fontWeight: 600, fontSize: 14 }}>
                  ✓ {t('toolbar.validation.noIssuesFound')}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {validationIssues.map((issue, i) => (
                    <ValidationPreviewCard
                      key={i}
                      issue={issue}
                      song={songStore.getState().song}
                      activeSongId={activeSongId!}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isAutoChartModalOpen && (
        <div
          className="settings-modal-overlay"
          onClick={() => !autoChartProgress.isRunning && setIsAutoChartModalOpen(false)}
        >
          <div
            className="settings-modal auto-chart-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-modal-header">
              <div>
                <h2 className="settings-modal-title">{t('toolbar.autoChart.modalTitle')}</h2>
                <p className="settings-modal-subtitle">
                  {t('toolbar.autoChart.modalSubtitle')}
                </p>
              </div>
              <button
                className="settings-modal-close"
                onClick={() => !autoChartProgress.isRunning && setIsAutoChartModalOpen(false)}
                aria-label={t('toolbar.autoChart.closeDialogAriaLabel')}
              >
                X
              </button>
            </div>

            <div className="settings-modal-body auto-chart-body">
              {runtimeStatus && runtimeStatus.managed && !runtimeStatus.ready && (
                <div className="auto-chart-runtime-warning">
                  <h3>{t('toolbar.autoChart.runtimeNotInstalledTitle')}</h3>
                  <p>
                    {t('toolbar.autoChart.runtimeNotInstalledBody')}
                  </p>
                  <div className="auto-chart-runtime-actions">
                    <button
                      type="button"
                      className="settings-modal-primary"
                      onClick={() => void handleSetupRuntime()}
                      disabled={isInstallingRuntime || runtimeStatus.installing}
                    >
                      {isInstallingRuntime || runtimeStatus.installing
                        ? t('toolbar.autoChart.installingRuntime')
                        : t('toolbar.autoChart.setupPythonRuntime')}
                    </button>
                  </div>
                  {runtimeSetupError && (
                    <div className="auto-chart-error">
                      <div className="auto-chart-error-header">
                        <strong>{t('toolbar.autoChart.setupErrorLabel')}</strong>
                        <button
                          className="auto-chart-error-copy"
                          onClick={() => void handleCopyRuntimeSetupError()}
                          type="button"
                        >
                          {runtimeSetupErrorCopied ? t('toolbar.autoChart.copied') : t('toolbar.autoChart.copy')}
                        </button>
                      </div>
                      <pre className="auto-chart-error-text">{runtimeSetupError}</pre>
                    </div>
                  )}
                </div>
              )}
              {!autoChartProgress.isRunning && (
                <>
                  <section className="settings-preferences-group">
                    <h3 className="settings-hotkey-group-title">{t('toolbar.autoChart.inputsTitle')}</h3>
                    <fieldset
                      disabled={autoChartProgress.isRunning}
                      style={{
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        opacity: autoChartProgress.isRunning ? 0.55 : 1
                      }}
                    >
                      <div className="settings-preferences-body auto-chart-inputs">
                        {/* Top-level: Full Mix vs Stems */}
                        <div
                          role="tablist"
                          style={{
                            display: 'flex',
                            gap: 2,
                            borderBottom: '1px solid #444',
                            marginBottom: 12
                          }}
                        >
                          {(
                            [
                              {
                                id: 'mix',
                                label: t('toolbar.autoChart.fullMixTab'),
                                count:
                                  autoChartFiles.length +
                                  autoChartFolders.length +
                                  autoChartUrls.filter((u) => u.trim()).length
                              },
                              {
                                id: 'stems',
                                label: t('toolbar.autoChart.stemsTab'),
                                count: autoChartStemSongs.filter(
                                  (s) =>
                                    Object.values(s.stems).some((v) => v.trim()) ||
                                    s.extras.some((e) => e.trim())
                                ).length
                              }
                            ] as const
                          ).map((tab) => {
                            const active = autoChartInputTab === tab.id
                            return (
                              <button
                                key={tab.id}
                                role="tab"
                                aria-selected={active}
                                onClick={() => setAutoChartInputTab(tab.id)}
                                style={{
                                  padding: '10px 18px',
                                  border: 'none',
                                  borderBottom: active
                                    ? '2px solid #4a9eff'
                                    : '2px solid transparent',
                                  background: active ? '#2a2a2a' : 'transparent',
                                  color: active ? '#fff' : '#bbb',
                                  cursor: 'pointer',
                                  fontWeight: active ? 600 : 500,
                                  fontSize: 14
                                }}
                              >
                                {tab.label}
                                {tab.count > 0 && (
                                  <span
                                    style={{
                                      marginLeft: 8,
                                      padding: '1px 7px',
                                      background: '#4a9eff',
                                      color: '#fff',
                                      borderRadius: 10,
                                      fontSize: 11
                                    }}
                                  >
                                    {tab.count}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>

                        {autoChartInputTab === 'mix' && (
                          <div>
                            {/* Sub-tabs: Audio Files / Audio Folders / URLs */}
                            <div
                              role="tablist"
                              style={{
                                display: 'flex',
                                gap: 2,
                                borderBottom: '1px solid #2f2f2f',
                                marginBottom: 12
                              }}
                            >
                              {(
                                [
                                  {
                                    id: 'files',
                                    label: t('toolbar.autoChart.audioFilesTab'),
                                    count: autoChartFiles.length
                                  },
                                  {
                                    id: 'folders',
                                    label: t('toolbar.autoChart.audioFoldersTab'),
                                    count: autoChartFolders.length
                                  },
                                  {
                                    id: 'urls',
                                    label: t('toolbar.autoChart.urlsTab'),
                                    count: autoChartUrls.filter((u) => u.trim()).length
                                  }
                                ] as const
                              ).map((tab) => {
                                const active = autoChartFullMixSubTab === tab.id
                                return (
                                  <button
                                    key={tab.id}
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => setAutoChartFullMixSubTab(tab.id)}
                                    style={{
                                      padding: '6px 12px',
                                      border: 'none',
                                      borderBottom: active
                                        ? '2px solid #4a9eff'
                                        : '2px solid transparent',
                                      background: 'transparent',
                                      color: active ? '#fff' : '#999',
                                      cursor: 'pointer',
                                      fontWeight: active ? 600 : 400,
                                      fontSize: 12
                                    }}
                                  >
                                    {tab.label}
                                    {tab.count > 0 && (
                                      <span
                                        style={{
                                          marginLeft: 6,
                                          padding: '1px 6px',
                                          background: '#4a9eff',
                                          color: '#fff',
                                          borderRadius: 10,
                                          fontSize: 10
                                        }}
                                      >
                                        {tab.count}
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>

                            {autoChartFullMixSubTab === 'files' && (
                              <>
                                <div className="auto-chart-actions-row">
                                  <button
                                    className="settings-modal-secondary"
                                    onClick={async () => {
                                      const files = await window.api.openAudioFilesDialog()
                                      if (files.length > 0) {
                                        setAutoChartFiles((prev) =>
                                          Array.from(new Set([...prev, ...files]))
                                        )
                                      }
                                    }}
                                  >
                                    {t('toolbar.autoChart.addFiles')}
                                  </button>
                                </div>
                                <p style={{ fontSize: 12, opacity: 0.7, margin: '6px 0 4px' }}>
                                  {t('toolbar.autoChart.addFilesHelp')}
                                </p>
                                <div className="auto-chart-chip-list">
                                  {autoChartFiles.map((file) => (
                                    <button
                                      key={file}
                                      className="auto-chart-chip"
                                      onClick={() =>
                                        setAutoChartFiles((prev) =>
                                          prev.filter((entry) => entry !== file)
                                        )
                                      }
                                    >
                                      {file.split(/[\\/]/).pop()} ×
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}

                            {autoChartFullMixSubTab === 'folders' && (
                              <>
                                <div className="auto-chart-actions-row">
                                  <button
                                    className="settings-modal-secondary"
                                    onClick={async () => {
                                      const folder = await window.api.openAudioFolderDialog()
                                      if (folder) {
                                        setAutoChartFolders((prev) =>
                                          Array.from(new Set([...prev, folder]))
                                        )
                                      }
                                    }}
                                  >
                                    {t('toolbar.autoChart.addFolder')}
                                  </button>
                                </div>
                                <p style={{ fontSize: 12, opacity: 0.7, margin: '6px 0 4px' }}>
                                  {t('toolbar.autoChart.addFolderHelp')}
                                </p>
                                <div className="auto-chart-chip-list">
                                  {autoChartFolders.map((folder) => (
                                    <button
                                      key={folder}
                                      className="auto-chart-chip"
                                      onClick={() =>
                                        setAutoChartFolders((prev) =>
                                          prev.filter((entry) => entry !== folder)
                                        )
                                      }
                                    >
                                      {folder.split(/[\\/]/).pop()} ×
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}

                            {autoChartFullMixSubTab === 'urls' && (
                              <div className="settings-field-stack">
                                <div className="auto-chart-url-header">
                                  <label
                                    className="settings-field-label"
                                    htmlFor="auto-chart-url-0"
                                  >
                                    {t('toolbar.autoChart.audioYoutubeUrlsLabel')}
                                  </label>
                                  <button
                                    className="auto-chart-icon-button"
                                    onClick={handleAddAutoChartUrl}
                                    title={t('toolbar.autoChart.addUrlRow')}
                                    aria-label={t('toolbar.autoChart.addUrlRow')}
                                  >
                                    +
                                  </button>
                                </div>
                                <div className="auto-chart-url-list">
                                  {autoChartUrls.map((url, index) => (
                                    <div
                                      key={`auto-chart-url-${index}`}
                                      className="auto-chart-url-row"
                                    >
                                      <input
                                        id={`auto-chart-url-${index}`}
                                        className="settings-folder-input auto-chart-url-input"
                                        type="text"
                                        value={url}
                                        onChange={(event) =>
                                          handleUpdateAutoChartUrl(index, event.target.value)
                                        }
                                        placeholder={t('toolbar.autoChart.urlPlaceholder')}
                                      />
                                      <button
                                        className="auto-chart-icon-button auto-chart-delete-button"
                                        onClick={() => handleRemoveAutoChartUrl(index)}
                                        title={t('toolbar.autoChart.removeUrlRow')}
                                        aria-label={t('toolbar.autoChart.removeUrlRow')}
                                      >
                                        🗑
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {autoChartInputTab === 'stems' && (
                          <div>
                            <p style={{ fontSize: 12, opacity: 0.75, margin: '0 0 10px' }}>
                              {t('toolbar.autoChart.stemsInstructions')}
                            </p>
                            {autoChartStemSongs.map((song, songIdx) => (
                              <div
                                key={song.id}
                                style={{
                                  border: '1px solid #333',
                                  borderRadius: 6,
                                  padding: 12,
                                  marginBottom: 10,
                                  background: '#1c1c1c'
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    marginBottom: 10
                                  }}
                                >
                                  <input
                                    type="text"
                                    className="settings-folder-input"
                                    value={song.name}
                                    onChange={(event) => {
                                      const v = event.target.value
                                      setAutoChartStemSongs((prev) =>
                                        prev.map((s, i) => (i === songIdx ? { ...s, name: v } : s))
                                      )
                                    }}
                                    placeholder={t('toolbar.autoChart.songNamePlaceholder')}
                                    style={{ flex: 1 }}
                                  />
                                  {autoChartStemSongs.length > 1 && (
                                    <button
                                      type="button"
                                      className="auto-chart-icon-button auto-chart-delete-button"
                                      onClick={() =>
                                        setAutoChartStemSongs((prev) =>
                                          prev.filter((_, i) => i !== songIdx)
                                        )
                                      }
                                      title={t('toolbar.autoChart.removeStemSong')}
                                      aria-label={t('toolbar.autoChart.removeStemSong')}
                                    >
                                      🗑
                                    </button>
                                  )}
                                </div>
                                <div style={{ display: 'grid', gap: 6 }}>
                                  {(
                                    [
                                      { key: 'drums', label: t('toolbar.autoChart.stemLabels.drums') },
                                      { key: 'bass', label: t('toolbar.autoChart.stemLabels.bass') },
                                      {
                                        key: 'vocals',
                                        label: t('toolbar.autoChart.stemLabels.vocals')
                                      },
                                      {
                                        key: 'vocalsHarm2',
                                        label: t('toolbar.autoChart.stemLabels.vocalsHarm2')
                                      },
                                      {
                                        key: 'vocalsHarm3',
                                        label: t('toolbar.autoChart.stemLabels.vocalsHarm3')
                                      },
                                      { key: 'guitar', label: t('toolbar.autoChart.stemLabels.guitar') },
                                      { key: 'piano', label: t('toolbar.autoChart.stemLabels.piano') },
                                      { key: 'crowd', label: t('toolbar.autoChart.stemLabels.crowd') }
                                    ] as const
                                  ).map((row) => (
                                    <div
                                      key={row.key}
                                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                    >
                                      <label style={{ width: 140, fontSize: 12, opacity: 0.85 }}>
                                        {row.label}
                                      </label>
                                      <input
                                        type="text"
                                        className="settings-folder-input"
                                        value={song.stems[row.key]}
                                        onChange={(event) => {
                                          const v = event.target.value
                                          setAutoChartStemSongs((prev) =>
                                            prev.map((s, i) =>
                                              i === songIdx
                                                ? { ...s, stems: { ...s.stems, [row.key]: v } }
                                                : s
                                            )
                                          )
                                        }}
                                        placeholder={t('toolbar.autoChart.stemPathPlaceholder')}
                                        style={{ flex: 1 }}
                                      />
                                      <button
                                        type="button"
                                        className="settings-modal-secondary"
                                        style={{ padding: '4px 10px', fontSize: 12 }}
                                        onClick={async () => {
                                          const files = await window.api.openAudioFilesDialog()
                                          const picked = files[0]
                                          if (picked) {
                                            setAutoChartStemSongs((prev) =>
                                              prev.map((s, i) =>
                                                i === songIdx
                                                  ? {
                                                      ...s,
                                                      stems: { ...s.stems, [row.key]: picked }
                                                    }
                                                  : s
                                              )
                                            )
                                          }
                                        }}
                                      >
                                        {t('toolbar.autoChart.browse')}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <div
                                  style={{
                                    marginTop: 10,
                                    paddingTop: 10,
                                    borderTop: '1px dashed #333'
                                  }}
                                >
                                  <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                                    {t('toolbar.autoChart.extraAudioHelpPre')}{' '}
                                    <code style={{ fontSize: 11 }}>song.ogg</code>{' '}
                                    {t('toolbar.autoChart.extraAudioHelpPost')}
                                  </div>
                                  <div style={{ display: 'grid', gap: 6 }}>
                                    {song.extras.map((extra, extraIdx) => (
                                      <div
                                        key={extraIdx}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                      >
                                        <label style={{ width: 140, fontSize: 12, opacity: 0.85 }}>
                                          {t('toolbar.autoChart.extraLabel', { index: extraIdx + 1 })}
                                        </label>
                                        <input
                                          type="text"
                                          className="settings-folder-input"
                                          value={extra}
                                          onChange={(event) => {
                                            const v = event.target.value
                                            setAutoChartStemSongs((prev) =>
                                              prev.map((s, i) =>
                                                i === songIdx
                                                  ? {
                                                      ...s,
                                                      extras: s.extras.map((e, j) =>
                                                        j === extraIdx ? v : e
                                                      )
                                                    }
                                                  : s
                                              )
                                            )
                                          }}
                                          placeholder={t('toolbar.autoChart.filePathOrUrlPlaceholder')}
                                          style={{ flex: 1 }}
                                        />
                                        <button
                                          type="button"
                                          className="settings-modal-secondary"
                                          style={{ padding: '4px 10px', fontSize: 12 }}
                                          onClick={async () => {
                                            const files = await window.api.openAudioFilesDialog()
                                            const picked = files[0]
                                            if (picked) {
                                              setAutoChartStemSongs((prev) =>
                                                prev.map((s, i) =>
                                                  i === songIdx
                                                    ? {
                                                        ...s,
                                                        extras: s.extras.map((e, j) =>
                                                          j === extraIdx ? picked : e
                                                        )
                                                      }
                                                    : s
                                                )
                                              )
                                            }
                                          }}
                                        >
                                          {t('toolbar.autoChart.browse')}
                                        </button>
                                        <button
                                          type="button"
                                          className="auto-chart-icon-button auto-chart-delete-button"
                                          onClick={() =>
                                            setAutoChartStemSongs((prev) =>
                                              prev.map((s, i) =>
                                                i === songIdx
                                                  ? {
                                                      ...s,
                                                      extras: s.extras.filter(
                                                        (_, j) => j !== extraIdx
                                                      )
                                                    }
                                                  : s
                                              )
                                            )
                                          }
                                          title={t('toolbar.autoChart.removeExtra')}
                                          aria-label={t('toolbar.autoChart.removeExtra')}
                                        >
                                          🗑
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="settings-modal-secondary"
                                      style={{
                                        alignSelf: 'flex-start',
                                        padding: '4px 10px',
                                        fontSize: 12
                                      }}
                                      onClick={() =>
                                        setAutoChartStemSongs((prev) =>
                                          prev.map((s, i) =>
                                            i === songIdx ? { ...s, extras: [...s.extras, ''] } : s
                                          )
                                        )
                                      }
                                    >
                                      + {t('toolbar.autoChart.addExtraAudio')}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="settings-modal-secondary"
                              onClick={() =>
                                setAutoChartStemSongs((prev) => [...prev, makeEmptyStemSong()])
                              }
                            >
                              + {t('toolbar.autoChart.addAnotherStemSong')}
                            </button>
                          </div>
                        )}

                        <div
                          className="settings-field-stack"
                          style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #333' }}
                        >
                          <label className="settings-field-label" htmlFor="auto-chart-output">
                            {t('toolbar.autoChart.outputFolderLabel')}
                          </label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              id="auto-chart-output"
                              className="settings-folder-input"
                              type="text"
                              value={autoChartProgress.outputDir}
                              onChange={(event) =>
                                setAutoChartProgress((prev) => ({
                                  ...prev,
                                  outputDir: event.target.value
                                }))
                              }
                              placeholder={t('toolbar.autoChart.outputFolderPlaceholder')}
                              style={{ flex: 1 }}
                            />
                            <button
                              className="settings-modal-secondary"
                              onClick={async () => {
                                const folder = await window.api.openOutputFolderDialog()
                                if (folder) {
                                  setAutoChartProgress((prev) => ({
                                    ...prev,
                                    outputDir: folder,
                                    error: null
                                  }))
                                }
                              }}
                            >
                              {t('toolbar.autoChart.browse')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </fieldset>
                  </section>

                  <section className="settings-preferences-group">
                    <button
                      type="button"
                      className="auto-chart-collapse-toggle"
                      onClick={() => setAutoChartAdvancedOpen((v) => !v)}
                      aria-expanded={autoChartAdvancedOpen}
                    >
                      <span className="auto-chart-collapse-chevron" aria-hidden="true">
                        <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M4 2.5L8 6L4 9.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span>{t('toolbar.autoChart.advanced')}</span>
                    </button>
                    {autoChartAdvancedOpen && (
                      <div className="settings-preferences-body">
                        <label className="settings-checkbox-row">
                          <input
                            type="checkbox"
                            checked={autoChartDisableOnlineLookup}
                            onChange={(event) =>
                              updateSettings({
                                autoChartDisableOnlineLookup: event.target.checked
                              })
                            }
                            disabled={autoChartProgress.isRunning}
                          />
                          <span>
                            {t('toolbar.autoChart.offlineMode')}
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('toolbar.autoChart.offlineModeHelp')}
                            </small>
                          </span>
                        </label>

                        <label className="settings-checkbox-row">
                          <input
                            type="checkbox"
                            checked={autoChartDownloadVideo}
                            onChange={(event) =>
                              updateSettings({ autoChartDownloadVideo: event.target.checked })
                            }
                            disabled={autoChartProgress.isRunning}
                          />
                          <span>
                            {t('toolbar.autoChart.downloadVideo')}
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('toolbar.autoChart.downloadVideoHelp')}
                            </small>
                          </span>
                        </label>

                        <label className="settings-checkbox-row">
                          <input
                            type="checkbox"
                            checked={autoChartKeepStems}
                            onChange={(event) =>
                              updateSettings({ autoChartKeepStems: event.target.checked })
                            }
                            disabled={autoChartProgress.isRunning}
                          />
                          <span>
                            {t('toolbar.autoChart.keepStems')}
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('toolbar.autoChart.keepStemsHelp')}
                            </small>
                          </span>
                        </label>

                        <label className="settings-checkbox-row">
                          <input
                            type="checkbox"
                            checked={autoChartStarPower}
                            onChange={(event) =>
                              updateSettings({ autoChartStarPower: event.target.checked })
                            }
                            disabled={autoChartProgress.isRunning}
                          />
                          <span>
                            {t('toolbar.autoChart.generateStarPower')}
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('toolbar.autoChart.generateStarPowerHelp')}
                            </small>
                          </span>
                        </label>

                        <label className="settings-checkbox-row">
                          <input
                            type="checkbox"
                            checked={autoChartImproveTempo}
                            onChange={(event) =>
                              updateSettings({ autoChartImproveTempo: event.target.checked })
                            }
                            disabled={autoChartProgress.isRunning}
                          />
                          <span>
                            {t('toolbar.autoChart.improveTempoAccuracy')}
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('toolbar.autoChart.improveTempoAccuracyHelp')}
                            </small>
                          </span>
                        </label>

                        <div className="auto-chart-bpm-source" style={{ margin: '4px 0 2px' }}>
                          <label
                            className="settings-checkbox-row"
                            style={{ alignItems: 'flex-start' }}
                          >
                            <span style={{ flex: 1 }}>
                              {t('toolbar.autoChart.manualBpmLabel')}
                              <small style={{ display: 'block', opacity: 0.7 }}>
                                {t('toolbar.autoChart.manualBpmHelp')}
                              </small>
                            </span>
                            <input
                              type="number"
                              min={1}
                              step={0.001}
                              value={autoChartManualBpm}
                              placeholder={t('toolbar.autoChart.autoPlaceholder')}
                              disabled={autoChartProgress.isRunning}
                              style={{ width: 84, marginLeft: 12 }}
                              onChange={(event) => setAutoChartManualBpm(event.target.value)}
                            />
                          </label>
                        </div>

                        <label className="settings-checkbox-row">
                          <input
                            type="checkbox"
                            checked={autoChartSnapDrums}
                            onChange={(event) =>
                              updateSettings({ autoChartSnapDrums: event.target.checked })
                            }
                            disabled={autoChartProgress.isRunning}
                          />
                          <span>
                            {t('toolbar.autoChart.snapDrumsToGrid')}
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('toolbar.autoChart.snapDrumsHelp')}
                            </small>
                          </span>
                        </label>

                        <div style={{ marginTop: 12 }}>
                          {autoChartInputTab === 'stems' ? (
                            <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
                              {t('toolbar.autoChart.tracksAutoFromStems')}
                            </p>
                          ) : (
                            <>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginBottom: 6
                                }}
                              >
                                <strong style={{ fontSize: 13 }}>
                                  {t('toolbar.autoChart.tracksToChart')}
                                </strong>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    type="button"
                                    className="settings-modal-secondary"
                                    style={{ fontSize: 11, padding: '2px 8px' }}
                                    disabled={autoChartProgress.isRunning}
                                    onClick={() =>
                                      updateSettings({
                                        autoChartEnabledTracks: {
                                          drums: true,
                                          guitar: true,
                                          bass: true,
                                          vocals: true,
                                          harmonies: true,
                                          keys: true,
                                          proKeys: true
                                        }
                                      })
                                    }
                                  >
                                    {t('toolbar.autoChart.allTracks')}
                                  </button>
                                  <button
                                    type="button"
                                    className="settings-modal-secondary"
                                    style={{ fontSize: 11, padding: '2px 8px' }}
                                    disabled={autoChartProgress.isRunning}
                                    onClick={() =>
                                      updateSettings({
                                        autoChartEnabledTracks: {
                                          drums: false,
                                          guitar: false,
                                          bass: false,
                                          vocals: false,
                                          harmonies: false,
                                          keys: false,
                                          proKeys: false
                                        }
                                      })
                                    }
                                  >
                                    {t('toolbar.autoChart.noneTracks')}
                                  </button>
                                </div>
                              </div>
                              <p style={{ fontSize: 12, opacity: 0.7, margin: '0 0 8px' }}>
                                {t('toolbar.autoChart.tracksHelp')}
                              </p>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                  gap: '6px 16px'
                                }}
                              >
                                {(
                                  [
                                    { key: 'drums', label: t('toolbar.autoChart.trackLabels.drums') },
                                    {
                                      key: 'guitar',
                                      label: t('toolbar.autoChart.trackLabels.guitar')
                                    },
                                    { key: 'bass', label: t('toolbar.autoChart.trackLabels.bass') },
                                    { key: 'keys', label: t('toolbar.autoChart.trackLabels.keys') },
                                    {
                                      key: 'proKeys',
                                      label: t('toolbar.autoChart.trackLabels.proKeys')
                                    },
                                    {
                                      key: 'vocals',
                                      label: t('toolbar.autoChart.trackLabels.vocals')
                                    },
                                    {
                                      key: 'harmonies',
                                      label: t('toolbar.autoChart.trackLabels.harmonies')
                                    }
                                  ] as const
                                ).map((track) => (
                                  <label
                                    key={track.key}
                                    className="settings-checkbox-row"
                                    style={{ margin: 0 }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={autoChartEnabledTracks[track.key]}
                                      disabled={
                                        autoChartProgress.isRunning ||
                                        (track.key === 'harmonies' &&
                                          !autoChartEnabledTracks.vocals)
                                      }
                                      onChange={(event) =>
                                        updateSettings({
                                          autoChartEnabledTracks: (() => {
                                            const next = {
                                              ...autoChartEnabledTracks,
                                              [track.key]: event.target.checked
                                            }
                                            // Disabling vocals also disables harmonies.
                                            if (track.key === 'vocals' && !event.target.checked)
                                              next.harmonies = false
                                            return next
                                          })()
                                        })
                                      }
                                    />
                                    <span>{track.label}</span>
                                  </label>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        <div className="auto-chart-tempo-override">
                          <div className="auto-chart-tempo-header">
                            <strong>{t('toolbar.autoChart.tempoOverrideTitle')}</strong>
                            <button
                              type="button"
                              className="settings-modal-secondary"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              disabled={autoChartProgress.isRunning}
                              onClick={() =>
                                setAutoChartTempoEvents((prev) => [
                                  ...prev,
                                  { timeSec: prev.length === 0 ? '0' : '', bpm: '' }
                                ])
                              }
                            >
                              + {t('toolbar.autoChart.addTempo')}
                            </button>
                          </div>
                          <p className="auto-chart-tempo-help">
                            {t('toolbar.autoChart.tempoOverrideHelp')}
                          </p>
                          {autoChartTempoEvents.length > 0 && (
                            <div className="auto-chart-tempo-list">
                              <div className="auto-chart-tempo-row auto-chart-tempo-row-head">
                                <span>{t('toolbar.autoChart.timeSecondsLabel')}</span>
                                <span>{t('toolbar.autoChart.bpmLabel')}</span>
                                <span />
                              </div>
                              {autoChartTempoEvents.map((event, index) => (
                                <div key={index} className="auto-chart-tempo-row">
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={event.timeSec}
                                    placeholder="0"
                                    disabled={autoChartProgress.isRunning}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setAutoChartTempoEvents((prev) =>
                                        prev.map((row, i) =>
                                          i === index ? { ...row, timeSec: v } : row
                                        )
                                      )
                                    }}
                                  />
                                  <input
                                    type="number"
                                    min={1}
                                    step={0.001}
                                    value={event.bpm}
                                    placeholder="120"
                                    disabled={autoChartProgress.isRunning}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setAutoChartTempoEvents((prev) =>
                                        prev.map((row, i) =>
                                          i === index ? { ...row, bpm: v } : row
                                        )
                                      )
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="auto-chart-tempo-remove"
                                    title={t('toolbar.autoChart.removeTempoRow')}
                                    disabled={autoChartProgress.isRunning}
                                    onClick={() =>
                                      setAutoChartTempoEvents((prev) =>
                                        prev.filter((_, i) => i !== index)
                                      )
                                    }
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                </>
              )}

              <section className="settings-preferences-group">
                <h3 className="settings-hotkey-group-title">{t('toolbar.autoChart.progressTitle')}</h3>
                <div className="settings-preferences-body auto-chart-progress-panel">
                  <div className="auto-chart-progress-header">
                    <strong>{autoChartProgress.stage.toUpperCase()}</strong>
                    <span>{autoChartProgress.percent}%</span>
                  </div>
                  <div className="toolbar-updater-bar auto-chart-progress-bar">
                    <div
                      className="toolbar-updater-bar-fill"
                      style={{ width: `${autoChartProgress.percent}%` }}
                    />
                  </div>
                  <div className="auto-chart-progress-message">
                    {autoChartCloseCountdown !== null
                      ? t('toolbar.autoChart.closingCountdown', { count: autoChartCloseCountdown })
                      : autoChartProgress.message || t('common.idle')}
                  </div>
                  {autoChartProgress.currentItem && (
                    <div className="auto-chart-progress-subtle">
                      {t('toolbar.autoChart.currentItem', { item: autoChartProgress.currentItem })}
                    </div>
                  )}
                  {autoChartProgress.error && (
                    <div className="auto-chart-error">
                      <div className="auto-chart-error-header">
                        <strong>{t('toolbar.autoChart.runErrorLabel')}</strong>
                        <button
                          className="auto-chart-error-copy"
                          onClick={() => void handleCopyAutoChartError()}
                          type="button"
                        >
                          {autoChartErrorCopied ? t('toolbar.autoChart.copied') : t('toolbar.autoChart.copy')}
                        </button>
                      </div>
                      <div className="auto-chart-error-text">{autoChartProgress.error}</div>
                    </div>
                  )}
                  {autoChartProgress.warnings.length > 0 && (
                    <div className="auto-chart-warning-list">
                      {autoChartProgress.warnings.map((warning) => (
                        <div key={warning} className="auto-chart-warning-item">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="settings-modal-footer">
              {!autoChartProgress.isRunning && (
                <button
                  className="settings-modal-secondary"
                  onClick={() => {
                    setAutoChartCloseCountdown(null)
                    setAutoChartFiles([])
                    setAutoChartFolders([])
                    setAutoChartStemFolders([])
                    setAutoChartStemSongs([makeEmptyStemSong()])
                    setAutoChartUrls([EMPTY_AUTO_CHART_URL])
                    setAutoChartErrorCopied(false)
                    setAutoChartProgress({
                      runId: null,
                      stage: 'bootstrap',
                      message: '',
                      percent: 0,
                      isRunning: false,
                      outputDir: getPreferredAutoChartOutputDir(),
                      error: null,
                      warnings: []
                    })
                  }}
                >
                  {t('toolbar.autoChart.reset')}
                </button>
              )}
              <button
                className="settings-modal-secondary"
                onClick={() =>
                  autoChartProgress.isRunning
                    ? void handleCancelAutoChart()
                    : setIsAutoChartModalOpen(false)
                }
              >
                {autoChartProgress.isRunning ? t('toolbar.autoChart.cancelRun') : t('common.close')}
              </button>
              {!autoChartProgress.isRunning && (
                <button
                  className="settings-modal-primary"
                  onClick={() => void handleStartAutoChart()}
                  disabled={runtimeStatus?.managed === true && !runtimeStatus.ready}
                >
                  {t('toolbar.autoChart.startAutoChart')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <SettingsModal />
      {isExportModalOpen && <ExportModal onSaveBeforeExport={handleSave} />}
    </div>
  )
}

// Stem mixer popover button — lets the user mute/solo individual audio
// stems (drums.ogg, bass.ogg, vocals.ogg, etc.) loaded for the song.
function StemMixerButton({
  activeSongId
}: {
  activeSongId: string | null
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [stems, setStems] = useState<audioService.StemControl[]>([])
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!activeSongId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStems([])
      return
    }
    const refresh = (): void => setStems(audioService.getStemControls(activeSongId))
    refresh()
    const off = audioService.onStemControlsChange(activeSongId, refresh)
    const offLoad = audioService.onAudioLoaded(activeSongId, refresh)
    return () => {
      off()
      offLoad()
    }
  }, [activeSongId])

  if (!activeSongId) return null

  const togglePopover = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setStems(audioService.getStemControls(activeSongId))
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setPopoverPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right
      })
    }
    setOpen(true)
  }

  return (
    <div className="stem-mixer-wrapper">
      <button
        ref={buttonRef}
        className="toolbar-icon-button stem-mixer-button"
        onClick={togglePopover}
        title={t('toolbar.stemMixer.tooltip')}
        aria-label={t('toolbar.stemMixer.ariaLabel')}
      >
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <line
            x1="3"
            y1="2"
            x2="3"
            y2="14"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="8"
            y1="2"
            x2="8"
            y2="14"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="13"
            y1="2"
            x2="13"
            y2="14"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <rect x="1.5" y="9" width="3" height="3" rx="0.6" fill="currentColor" />
          <rect x="6.5" y="4" width="3" height="3" rx="0.6" fill="currentColor" />
          <rect x="11.5" y="7" width="3" height="3" rx="0.6" fill="currentColor" />
        </svg>
      </button>
      {open && popoverPos && (
        <div
          className="stem-mixer-popover"
          style={{ position: 'fixed', top: popoverPos.top, right: popoverPos.right, zIndex: 1000 }}
        >
          <div className="stem-mixer-header">
            <span>{t('toolbar.stemMixer.title')}</span>
            <button
              className="stem-mixer-close"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
            >
              ×
            </button>
          </div>
          {stems.length === 0 ? (
            <div className="stem-mixer-empty">{t('toolbar.stemMixer.noStemsLoaded')}</div>
          ) : (
            <div className="stem-mixer-list">
              {stems.map((s) => (
                <div key={s.filePath} className="stem-mixer-row">
                  <div className="stem-mixer-row-header">
                    <span className="stem-mixer-row-name" title={s.filename}>
                      {s.filename}
                    </span>
                    <button
                      className={`stem-mixer-toggle${s.muted ? ' is-mute-active' : ''}`}
                      onClick={() => audioService.setStemMute(activeSongId, s.filePath, !s.muted)}
                      title={t('toolbar.stemMixer.mute')}
                    >
                      M
                    </button>
                    <button
                      className={`stem-mixer-toggle${s.soloed ? ' is-solo-active' : ''}`}
                      onClick={() => audioService.setStemSolo(activeSongId, s.filePath, !s.soloed)}
                      title={t('toolbar.stemMixer.solo')}
                    >
                      S
                    </button>
                  </div>
                  <div className="stem-mixer-row-volume">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={s.volume}
                      onChange={(e) =>
                        audioService.setStemVolume(
                          activeSongId,
                          s.filePath,
                          parseFloat(e.target.value)
                        )
                      }
                      className="toolbar-volume-slider stem-mixer-volume-slider"
                      title={t('toolbar.volumePercent', { percent: Math.round(s.volume * 100) })}
                      style={{ ['--slider-fill' as string]: `${s.volume * 100}%` }}
                    />
                    <span className="stem-mixer-volume-value">{Math.round(s.volume * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
