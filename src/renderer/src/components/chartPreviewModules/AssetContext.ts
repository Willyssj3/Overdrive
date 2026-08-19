// Asset Context - React context carrying loaded highway assets, split out of
// AssetProvider.tsx so that file exports only the provider component (keeps
// Fast Refresh happy for both files).
import { createContext } from 'react'
import type { HighwayAssets } from './types'

export const HighwayAssetsContext = createContext<HighwayAssets | null>(null)
