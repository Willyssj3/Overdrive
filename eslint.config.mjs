import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/venv', 'venv/**'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // react-three-fiber JSX intrinsics (<mesh>, <lineSegments>, <primitive>, ...) take
    // Three.js object props that aren't real DOM attributes, so react/no-unknown-property
    // false-positives on every one of them across the chart preview's 3D scene.
    files: [
      'src/renderer/src/components/ChartPreview.tsx',
      'src/renderer/src/components/chartPreviewModules/**/*.tsx'
    ],
    rules: {
      'react/no-unknown-property': ['error', {
        ignore: [
          'position', 'rotation', 'geometry', 'material', 'args', 'attach',
          'transparent', 'depthWrite', 'toneMapped', 'map', 'side', 'blending',
          'emissive', 'emissiveIntensity', 'intensity', 'distance', 'raycast',
          'vertexShader', 'fragmentShader', 'uniforms', 'castShadow', 'visible',
          'sizeAttenuation', 'renderOrder'
        ]
      }]
    }
  },
  {
    // Plain CommonJS build/tooling scripts run directly under `node`, not compiled —
    // TypeScript-specific rules (return-type annotations, ESM-only import style) don't
    // apply and would produce invalid runtime syntax if "fixed" per those rules.
    files: ['scripts/**/*.{js,mjs}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  eslintConfigPrettier
)
