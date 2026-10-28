import './index.css';
// Bundled by Vite into the SPA's own CSS — the standalone server must serve
// every asset itself (no CDN).
import '@xterm/xterm/css/xterm.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { CommandCenter } from './command/CommandCenter';
import { loadOfficeAssets } from './officeAssets';
import { isBrowserRuntime } from './runtime';

async function main() {
  // Load original Pixel Agents art locally. Agent activity comes only from Codex.
  if (isBrowserRuntime) {
    await loadOfficeAssets();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isBrowserRuntime ? (
        <CommandCenter>
          <App />
        </CommandCenter>
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}

main().catch(console.error);
