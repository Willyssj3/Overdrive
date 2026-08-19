// Provider component to initialize autosave. Split out of useAutosave.tsx so
// that file exports only the hook (keeps Fast Refresh happy for both files).
import { useAutosave } from './useAutosave'

export function AutosaveProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  useAutosave()
  return <>{children}</>
}
