import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SongMetadata } from '../types'
import type { SongMetadataSearchResult } from '../../../shared/songMetadata'
import { publishAlbumArtUpdate } from '../utils/albumArtEvents'
import './SongMetadataLookupModal.css'

export function SongMetadataLookupModal({
  metadata,
  folderPath,
  onApply,
  onClose
}: {
  metadata: SongMetadata
  folderPath: string
  onApply: (metadata: Partial<SongMetadata>, artworkApplied: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const initialArtist = /^unknown(?: artist)?$/i.test(metadata.artist.trim()) ? '' : metadata.artist
  const [artist, setArtist] = useState(initialArtist)
  const [title, setTitle] = useState(metadata.name)
  const [results, setResults] = useState<SongMetadataSearchResult[]>([])
  const [selected, setSelected] = useState<SongMetadataSearchResult | null>(null)
  const [artwork, setArtwork] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingArtwork, setIsLoadingArtwork] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (searchArtist: string, searchTitle: string): Promise<void> => {
      const trimmedTitle = searchTitle.trim()
      if (!trimmedTitle) return
      setIsSearching(true)
      setError(null)
      setSelected(null)
      setArtwork(null)
      try {
        setResults(
          await window.api.searchSongMetadata({
            artist: searchArtist.trim(),
            title: trimmedTitle,
            durationMs: metadata.song_length
          })
        )
      } catch (searchError) {
        setResults([])
        setError(searchError instanceof Error ? searchError.message : String(searchError))
      } finally {
        setIsSearching(false)
      }
    },
    [metadata.song_length]
  )

  useEffect(() => {
    void search(initialArtist, metadata.name)
    // Search once when the freshly opened modal mounts; subsequent searches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isApplying) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isApplying, onClose])

  const selectResult = async (result: SongMetadataSearchResult): Promise<void> => {
    setSelected(result)
    setArtwork(null)
    setError(null)
    if (!result.artwork) return
    setIsLoadingArtwork(true)
    try {
      setArtwork(await window.api.fetchMetadataArtwork(result.artwork))
    } catch (artError) {
      setError(artError instanceof Error ? artError.message : String(artError))
    } finally {
      setIsLoadingArtwork(false)
    }
  }

  const applyResult = async (): Promise<void> => {
    if (!selected) return
    setIsApplying(true)
    setError(null)
    try {
      let artworkApplied = false
      if (artwork) {
        artworkApplied = await window.api.writeAlbumArt(folderPath, artwork)
        if (!artworkApplied) throw new Error(t('songMetadataModal.artworkSaveError'))
        publishAlbumArtUpdate({ folderPath, dataUrl: artwork })
      }
      onApply(
        {
          name: selected.title,
          artist: selected.artist,
          ...(selected.album ? { album: selected.album } : {}),
          ...(selected.year ? { year: selected.year } : {}),
          ...(selected.genre ? { genre: selected.genre } : {})
        },
        artworkApplied
      )
      onClose()
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError))
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div
      className="metadata-lookup-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isApplying) onClose()
      }}
    >
      <div
        className="metadata-lookup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-lookup-title"
      >
        <div className="metadata-lookup-header">
          <div>
            <h2 id="metadata-lookup-title">
              <span className="metadata-lookup-title-icon" aria-hidden="true">
                ♪
              </span>
              {t('songMetadataModal.title')}
            </h2>
            <p>{t('songMetadataModal.subtitle')}</p>
          </div>
          <button
            type="button"
            className="metadata-lookup-close"
            onClick={onClose}
            disabled={isApplying}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <form
          className="metadata-lookup-search"
          onSubmit={(event) => {
            event.preventDefault()
            void search(artist, title)
          }}
        >
          <label>
            <span>{t('songMetadataModal.fieldTitle')}</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label={t('songMetadataModal.fieldTitle')}
            />
          </label>
          <label>
            <span>{t('songMetadataModal.fieldArtist')}</span>
            <input
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              aria-label={t('songMetadataModal.fieldArtist')}
              placeholder={t('songMetadataModal.artistPlaceholder')}
            />
          </label>
          <button type="submit" disabled={isSearching || !title.trim()}>
            {isSearching ? t('songMetadataModal.searching') : t('songMetadataModal.search')}
          </button>
        </form>

        {error && <div className="metadata-lookup-error">{error}</div>}

        <div className="metadata-lookup-content">
          <div
            className="metadata-lookup-results"
            role="listbox"
            aria-label={t('songMetadataModal.resultsAriaLabel')}
          >
            {!isSearching && results.length === 0 && (
              <div className="metadata-lookup-empty">{t('songMetadataModal.noMatches')}</div>
            )}
            {results.map((result) => (
              <button
                type="button"
                role="option"
                aria-selected={selected?.id === result.id}
                className={`metadata-lookup-result ${selected?.id === result.id ? 'selected' : ''}`}
                key={result.id}
                onClick={() => void selectResult(result)}
              >
                <div className="metadata-lookup-result-header">
                  <strong>{result.title}</strong>
                  <em>
                    {result.sources
                      .map((source) =>
                        source === 'musicbrainz'
                          ? t('songMetadataModal.sourceMusicbrainz')
                          : t('songMetadataModal.sourceTheaudiodb')
                      )
                      .join(' + ')}
                  </em>
                </div>
                <span>{result.artist}</span>
                <small>
                  {[result.album, result.year, result.genre].filter(Boolean).join(' · ') ||
                    t('songMetadataModal.recordingMetadataOnly')}
                </small>
              </button>
            ))}
          </div>

          <div className="metadata-lookup-preview">
            {selected ? (
              <>
                <div className="metadata-lookup-art">
                  {artwork ? (
                    <img
                      src={artwork}
                      alt={t('songMetadataModal.coverAlt', {
                        name: selected.album ?? selected.title
                      })}
                    />
                  ) : (
                    <span>
                      {isLoadingArtwork
                        ? t('songMetadataModal.loadingArtwork')
                        : t('songMetadataModal.noArtworkFound')}
                    </span>
                  )}
                </div>
                <dl>
                  <dt>{t('songMetadataModal.fieldTitle')}</dt>
                  <dd>{selected.title}</dd>
                  <dt>{t('songMetadataModal.fieldArtist')}</dt>
                  <dd>{selected.artist}</dd>
                  <dt>{t('songMetadataModal.fieldAlbum')}</dt>
                  <dd>{selected.album ?? '—'}</dd>
                  <dt>{t('songMetadataModal.fieldYear')}</dt>
                  <dd>{selected.year ?? '—'}</dd>
                  <dt>{t('songMetadataModal.fieldGenre')}</dt>
                  <dd>{selected.genre ?? '—'}</dd>
                </dl>
              </>
            ) : (
              <div className="metadata-lookup-empty">{t('songMetadataModal.selectPrompt')}</div>
            )}
          </div>
        </div>

        <div className="metadata-lookup-footer">
          <span>{t('songMetadataModal.footerCredits')}</span>
          <div>
            <button type="button" className="secondary" onClick={onClose} disabled={isApplying}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void applyResult()}
              disabled={!selected || isApplying || isLoadingArtwork}
            >
              {isApplying ? t('songMetadataModal.applying') : t('songMetadataModal.applyMetadata')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
