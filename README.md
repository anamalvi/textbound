# Textbound

Play Snake on any webpage by navigating the **gaps between words**. Text ink becomes the maze walls (laid out with [Pretext](https://github.com/chenglou/pretext)); the snake weaves through the open space on a full-page overlay.

## Install (load unpacked)

1. From this folder: `npm install && npm run build`
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this `snake-extension` folder.
5. Visit any webpage. A pull-tab with a snake icon appears on the right edge — click it to start.

After code changes, run `npm run build` again and hit **Reload** on the extension card.

## Controls

- **Arrow keys / WASD** — move through the gaps between words
- **P** — pause
- **Enter** — retry after game over
- **Esc** or click the tab again — quit
- Toolbar icon toggles the game on the current tab

Hitting a word (toggle for highlighted tint) or your own body ends the run. The snake wraps at the viewport edges. Best score is saved in `chrome.storage.local`.

## Develop

```sh
npm install
npm run build    # → dist/content.js
npm run watch    # rebuild on change
```

Source lives in `src/` (`content.js` + `textMap.js`). The Manifest V3 content script loads the bundled `dist/content.js`.
