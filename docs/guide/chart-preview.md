# Chart Preview (3D Highway)

A real-time YARG-style 3D highway preview rendered with [Three.js](https://threejs.org/). What you see here is what your chart looks like in-game.

![OCTAVE 3D highway preview](/screenshots/editor-overview.png)

## Playback

The preview is locked to the [MIDI Editor's](/guide/midi-editor) playhead — pressing `Space` plays both at once. Variable speed (toolbar slider) is reflected in both audio and visuals.

## Components

- **Highway** — scrolling note lanes with FBX gem assets and proper YARG textures
- **Strikeline** — the static hit line at the bottom; gems "hit" here in time with audio
- **Beat grid** — measure / beat lines synced to the song's tempo map
- **Star Power overlay** — visualizes star power phrases (purple gradient); the strikeline also gets its own glow while playback is inside a charted phrase
- **Solo overlay** — highlights solo sections
- **Animated venue** — background environment, lighting, and characters (if assets are installed)
- **Vocal track overlay** — piano-roll view of pitched vocal notes below the highway when Vocals is active, with a harmony-part selector and a **🔊 Pitch** toggle to hear charted note pitches during playback

## Venue assets

OCTAVE ships with a default venue. You can install additional venues into:

```text
%APPDATA%/octave/highway-assets/venue/user/
```

The default venue lives at `highway-assets/venue/default/`. Both folders include `ASSET-LICENSES.txt` documenting their sources.

> Custom venues, gem skins, and highway textures use the same conventions as YARG — most YARG community assets work out of the box.

## Edit overlay

When the Place tool is active, the highway overlays a placement preview at the snap position. The overlay disappears during playback so you can review without distraction. Placing a note also fires a brief lane-colored spark at the placement point, confirming the hit without interrupting the flow.

## Performance

The preview targets 60 FPS on integrated GPUs. If you see stutter:
- Lower the chart preview window size by dragging the divider
- Disable the animated venue in *Settings → Chart Preview → Static venue*
- Reduce the FBX gem detail in *Settings → Chart Preview → Gem quality*
