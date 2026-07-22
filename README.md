# Boardroom

Boardroom is an original, static-browser implementation of the classic hotel acquisition strategy game. It includes a 9 × 12 board, seven hotel chains, mergers, shareholder bonuses, stock purchasing, computer investors, local pass-and-play, autosave, responsive design, and no server dependency.

## Play locally

```bash
npm run dev
```

Open <http://localhost:4173>. No build or install step is required. Run the rules-engine tests with `npm test`.

## GitHub Pages

The included workflow automatically tests and deploys the repository as a static site.

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main`, `master`, or `work`, or manually run **Deploy to GitHub Pages** from the Actions tab.

All asset links are relative, so the game works from either a user site or a project subpath. `.nojekyll` prevents Jekyll processing.

## Multiplayer and privacy

- **Solo:** set the other seats to Computer.
- **Local multiplayer:** turn Computer off for two or more seats. A privacy handoff screen appears between human turns.
- **Persistence:** the current game is saved in the browser's `localStorage` after every action.
- **Offline:** a service worker caches the game after the first visit. The optional web font falls back to system fonts if unavailable.

Internet peer-to-peer play is intentionally not represented as available: WebRTC still requires a signaling mechanism and reliable host-state synchronization. Local pass-and-play provides complete multiplayer without pretending that GitHub Pages can supply a game server.

## Rules notes

The game uses the standard 108-tile board and 25 shares per chain. Safe chains contain 11 or more tiles. Defunct shares are automatically sold during mergers so turns remain quick; majority/minority bonuses are paid first. When the largest chains tie during a merger, the more expensive chain survives. The game can end when one chain has at least 41 tiles or every active chain is safe.

This is a fan-made project and is not affiliated with or endorsed by Hasbro, Avalon Hill, or Renegade Game Studios. “Boardroom” uses original presentation and does not include publisher artwork.
