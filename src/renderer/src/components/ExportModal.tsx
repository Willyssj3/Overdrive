import { useEffect, useState, useCallback } from 'react'
import { useStore } from 'zustand'
import { useTranslation } from 'react-i18next'
import { useSettingsStore, useUIStore, useProjectStore, getSongStore } from '../stores'
import './ExportModal.css'

interface ExportModalProps {
  onSaveBeforeExport: () => Promise<void>
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

export function ExportModal({ onSaveBeforeExport }: ExportModalProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const isOpen = useUIStore((s) => s.isExportModalOpen)
  const setExportModalOpen = useUIStore((s) => s.setExportModalOpen)

  const activeSongId = useProjectStore((s) => s.activeSongId)
  const autoChartOutputDir = useSettingsStore((s) => s.autoChartOutputDir)
  const sngLastExportDir = useSettingsStore((s) => s.sngLastExportDir)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // Get current song data reactively
  const songStore = getSongStore(activeSongId || 'default')
  const song = useStore(songStore, (s) => s.song)

  const [outputFolder, setOutputFolder] = useState<string>(
    sngLastExportDir || autoChartOutputDir || ''
  )
  const [filename, setFilename] = useState<string>(() => {
    const name = song?.metadata.name || 'song'
    return `${sanitizeFilename(name)}.sng`
  })
  const [saveBeforeExport, setSaveBeforeExport] = useState<boolean>(true)
  const [exportFormat, setExportFormat] = useState<'sng' | 'rb3con'>('sng')

  const [status, setStatus] = useState<'idle' | 'saving' | 'exporting' | 'success' | 'error'>(
    'idle'
  )
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [exportedPath, setExportedPath] = useState<string>('')

  const [showOverwriteWarning, setShowOverwriteWarning] = useState<boolean>(false)

  const showReset = outputFolder !== (autoChartOutputDir || '')

  const getFullOutputPath = useCallback(
    (folder: string, name: string, formatOverride?: 'sng' | 'rb3con'): string => {
      if (!folder.trim()) return ''
      let finalFilename = name.trim()
      const songName = sanitizeFilename(song?.metadata.name || 'song')
      const format = formatOverride || exportFormat
      if (!finalFilename) {
        finalFilename = format === 'sng' ? `${songName}.sng` : `${songName}_rb3con`
      } else {
        if (format === 'sng') {
          if (!finalFilename.toLowerCase().endsWith('.sng')) {
            let base = finalFilename
            if (base.toLowerCase().endsWith('_rb3con')) {
              base = base.slice(0, -7)
            }
            finalFilename = `${base}.sng`
          }
        } else {
          if (!finalFilename.toLowerCase().endsWith('_rb3con')) {
            let base = finalFilename
            if (base.toLowerCase().endsWith('.sng')) {
              base = base.slice(0, -4)
            }
            finalFilename = `${base}_rb3con`
          }
        }
      }
      const separator = folder.includes('\\') ? '\\' : '/'
      return folder.endsWith(separator)
        ? `${folder}${finalFilename}`
        : `${folder}${separator}${finalFilename}`
    },
    [song, exportFormat]
  )

  const checkOverwrite = useCallback(
    async (folder: string, file: string, formatOverride?: 'sng' | 'rb3con') => {
      const fullPath = getFullOutputPath(folder, file, formatOverride)
      if (!fullPath) {
        setShowOverwriteWarning(false)
        return
      }
      try {
        const exists = await window.api.fileExists(fullPath)
        setShowOverwriteWarning(exists)
      } catch (err) {
        console.error('Error checking if file exists:', err)
        setShowOverwriteWarning(false)
      }
    },
    [getFullOutputPath]
  )

  // Initialize checks once on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkOverwrite(outputFolder, filename)
  }, [checkOverwrite, outputFolder, filename])

  // Dismiss modal on Escape key press
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && status !== 'saving' && status !== 'exporting') {
        setExportModalOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, status, setExportModalOpen])

  const handleFormatChange = useCallback(
    (newFormat: 'sng' | 'rb3con'): void => {
      setExportFormat(newFormat)

      let baseName = filename.trim()
      if (baseName.toLowerCase().endsWith('.sng')) {
        baseName = baseName.slice(0, -4)
      }
      if (baseName.toLowerCase().endsWith('_rb3con')) {
        baseName = baseName.slice(0, -7)
      }

      const newFilename = newFormat === 'sng' ? `${baseName}.sng` : `${baseName}_rb3con`
      setFilename(newFilename)

      checkOverwrite(outputFolder, newFilename, newFormat)
    },
    [filename, outputFolder, checkOverwrite]
  )

  if (!isOpen || !activeSongId || !song) return null

  const handleBrowse = async (): Promise<void> => {
    try {
      const path = await window.api.openOutputFolderDialog()
      if (path) {
        setOutputFolder(path)
        checkOverwrite(path, filename)
      }
    } catch (err) {
      console.error('Failed to open output folder dialog:', err)
    }
  }

  const handleExport = async (): Promise<void> => {
    if (!outputFolder.trim()) {
      setErrorMessage(t('exportModal.errors.noOutputFolder'))
      setStatus('error')
      return
    }

    let finalFilename = filename.trim()
    const songName = sanitizeFilename(song.metadata.name || 'song')
    if (!finalFilename) {
      finalFilename = exportFormat === 'sng' ? `${songName}.sng` : `${songName}_rb3con`
    } else {
      if (exportFormat === 'sng') {
        if (!finalFilename.toLowerCase().endsWith('.sng')) {
          let base = finalFilename
          if (base.toLowerCase().endsWith('_rb3con')) {
            base = base.slice(0, -7)
          }
          finalFilename = `${base}.sng`
        }
      } else {
        if (!finalFilename.toLowerCase().endsWith('_rb3con')) {
          let base = finalFilename
          if (base.toLowerCase().endsWith('.sng')) {
            base = base.slice(0, -4)
          }
          finalFilename = `${base}_rb3con`
        }
      }
    }

    setStatus('saving')
    setErrorMessage('')

    try {
      // 1. Optionally save the song first (so disk files are up to date)
      if (saveBeforeExport) {
        await onSaveBeforeExport()
      }

      // 2. Perform the export
      setStatus('exporting')

      const separator = outputFolder.includes('\\') ? '\\' : '/'
      const fullOutputPath = outputFolder.endsWith(separator)
        ? `${outputFolder}${finalFilename}`
        : `${outputFolder}${separator}${finalFilename}`

      let result
      if (exportFormat === 'rb3con') {
        result = await window.api.exportCon(
          song.folderPath,
          song.metadata as Record<string, unknown>,
          fullOutputPath
        )
      } else {
        result = await window.api.exportSng(
          song.folderPath,
          song.metadata as Record<string, unknown>,
          fullOutputPath
        )
      }

      if (result.success) {
        setExportedPath(fullOutputPath)
        updateSettings({ sngLastExportDir: outputFolder })
        setStatus('success')
        setShowOverwriteWarning(false)
      } else {
        setErrorMessage(result.error || t('exportModal.errors.exportFailed'))
        setStatus('error')
      }
    } catch (err) {
      console.error('Export error:', err)
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <div
      className="export-modal-overlay"
      onClick={() => status !== 'saving' && status !== 'exporting' && setExportModalOpen(false)}
    >
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-header">
          <div>
            <h2 className="export-modal-title">{t('exportModal.title')}</h2>
            <p className="export-modal-subtitle">{t('exportModal.subtitle')}</p>
          </div>
          <button
            className="export-modal-close"
            onClick={() => setExportModalOpen(false)}
            disabled={status === 'saving' || status === 'exporting'}
          >
            ✕
          </button>
        </div>

        <div className="export-modal-body">
          {status === 'success' ? (
            <div className="export-status-container success">
              <span className="export-status-icon">✅</span>
              <h3>{t('exportModal.success.title')}</h3>
              <p className="export-success-message">
                {exportFormat === 'rb3con'
                  ? t('exportModal.success.messageRb3con')
                  : t('exportModal.success.messageSng')}
              </p>
              <div className="export-path-preview">
                <div className="export-path-code-container">
                  <strong>{t('exportModal.success.destinationLabel')}</strong>
                  <code>{exportedPath}</code>
                </div>
                <button
                  className="export-modal-secondary reveal-folder-button"
                  onClick={() => window.api.showItemInFolder(exportedPath)}
                >
                  📁 {t('exportModal.success.showInFolder')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {status === 'error' && (
                <div className="export-error-banner">
                  <span className="error-icon">⚠️</span>
                  <div className="error-text">
                    <strong>{t('exportModal.errors.exportFailedTitle')}</strong>
                    <p>{errorMessage}</p>
                  </div>
                </div>
              )}

              {/* Formats Section */}
              <div className="export-section">
                <h3 className="export-section-title">{t('exportModal.format.sectionTitle')}</h3>
                <div className="export-formats-grid">
                  {exportFormat === 'sng' ? (
                    <>
                      <div className="export-format-card active">
                        <div className="export-format-card-header">
                          <span className="export-format-badge">{t('exportModal.format.active')}</span>
                          <span className="export-format-icon">🎸</span>
                        </div>
                        <h4>{t('exportModal.format.cloneHeroName')}</h4>
                        <p>{t('exportModal.format.cloneHeroDescription')}</p>
                      </div>
                      <div
                        className="export-format-card inactive"
                        onClick={() => handleFormatChange('rb3con')}
                      >
                        <h4>{t('exportModal.format.rb3conName')}</h4>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="export-format-card inactive"
                        onClick={() => handleFormatChange('sng')}
                      >
                        <h4>{t('exportModal.format.cloneHeroName')}</h4>
                      </div>
                      <div className="export-format-card active">
                        <div className="export-format-card-header">
                          <span className="export-format-badge">{t('exportModal.format.active')}</span>
                          <span className="export-format-icon">💿</span>
                        </div>
                        <h4>{t('exportModal.format.rb3conName')}</h4>
                        <p>{t('exportModal.format.rb3conDescription')}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Destination Section */}
              <div className="export-section">
                <h3 className="export-section-title">{t('exportModal.destination.sectionTitle')}</h3>

                <div className="export-preferences-body" style={{ padding: 0 }}>
                  {/* Output Folder Picker */}
                  <div className="export-field-stack">
                    <div className="export-folder-label-row">
                      <label className="export-field-label">
                        {t('exportModal.destination.outputFolderLabel')}
                      </label>
                      {showReset && (
                        <button
                          className="export-reset-button"
                          onClick={() => {
                            const defaultDir = autoChartOutputDir || ''
                            setOutputFolder(defaultDir)
                            checkOverwrite(defaultDir, filename)
                          }}
                          disabled={status === 'saving' || status === 'exporting'}
                        >
                          {t('exportModal.destination.resetToDefault')}
                        </button>
                      )}
                    </div>
                    <div className="export-folder-picker">
                      <input
                        className="export-folder-input"
                        type="text"
                        value={outputFolder}
                        placeholder={t('exportModal.destination.outputFolderPlaceholder')}
                        onChange={(e) => setOutputFolder(e.target.value)}
                        onBlur={() => checkOverwrite(outputFolder, filename)}
                        disabled={status === 'saving' || status === 'exporting'}
                      />
                      <button
                        className="export-modal-secondary"
                        onClick={handleBrowse}
                        disabled={status === 'saving' || status === 'exporting'}
                      >
                        {t('exportModal.destination.browse')}
                      </button>
                    </div>
                  </div>

                  {/* Filename Input */}
                  <div className="export-field-stack" style={{ marginTop: '12px' }}>
                    <label className="export-field-label">
                      {t('exportModal.destination.fileNameLabel')}
                    </label>
                    <input
                      className="export-folder-input"
                      style={{ width: '100%' }}
                      type="text"
                      value={filename}
                      placeholder={t('exportModal.destination.fileNamePlaceholder')}
                      onChange={(e) => setFilename(e.target.value)}
                      onBlur={() => checkOverwrite(outputFolder, filename)}
                      disabled={status === 'saving' || status === 'exporting'}
                    />
                  </div>

                  {showOverwriteWarning && (
                    <div className="export-warning-banner">
                      <span className="warning-icon">⚠️</span>
                      <div className="warning-text">
                        <strong>{t('exportModal.destination.overwriteWarningTitle')}</strong>
                        <p>{t('exportModal.destination.overwriteWarningMessage')}</p>
                      </div>
                    </div>
                  )}

                  {/* Save before export checkbox */}
                  <label className="export-checkbox-row" style={{ marginTop: '16px' }}>
                    <input
                      type="checkbox"
                      checked={saveBeforeExport}
                      onChange={(e) => setSaveBeforeExport(e.target.checked)}
                      disabled={status === 'saving' || status === 'exporting'}
                    />
                    <span>{t('exportModal.destination.saveBeforeExportLabel')}</span>
                  </label>
                </div>
              </div>

              {/* Progress Overlay / State */}
              {(status === 'saving' || status === 'exporting') && (
                <div className="export-loading-overlay">
                  <div className="export-loading-spinner"></div>
                  <p>
                    {status === 'saving'
                      ? t('exportModal.progress.savingSongEdits')
                      : exportFormat === 'rb3con'
                        ? t('exportModal.progress.buildingCon')
                        : t('exportModal.progress.buildingSng')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="export-modal-footer">
          {status === 'success' ? (
            <button className="export-modal-primary" onClick={() => setExportModalOpen(false)}>
              {t('exportModal.actions.done')}
            </button>
          ) : (
            <>
              <button
                className="export-modal-secondary"
                onClick={() => setExportModalOpen(false)}
                disabled={status === 'saving' || status === 'exporting'}
              >
                {t('common.cancel')}
              </button>
              <button
                className="export-modal-primary"
                onClick={handleExport}
                disabled={status === 'saving' || status === 'exporting' || !outputFolder.trim()}
              >
                {t('common.export')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
