# Settings

Open with `Ctrl+,` (or *Toolbar → Settings*).

![Settings modal](/screenshots/settings-modal.png)

## General

- **Language** — English / Español. Switches the UI language immediately; OCTAVE auto-detects English or Spanish from the OS locale the first time it runs, and this picker overrides that from then on.

## Auto-Chart

- **Enable Overdrive Engine auto-charting** — turns the Auto-Chart feature on or off.
- **Default output folder** — where generated chart packages are written. *Browse* opens a native folder picker; if left blank, OCTAVE fills in its own default output folder the first time the modal opens.

## Updates

- **Receive beta (pre-release) updates** — switches the update channel between stable and beta. Beta builds include fixes still being tested and may be less stable than regular releases; turn this off to return to the stable channel. Changing this takes effect as soon as you press *Done*.

## MIDI Editor

- **Invert piano-roll vertical mouse wheel scroll** — flips the direction of the mouse wheel when scrolling the piano roll vertically.

## Validation Preferences

Controls for the note/chart validator.

- **Enable overlapping notes check** — flags notes that overlap each other.
- **Enable missing star power check** — flags charts with no Star Power phrases.
- **Enable drum physical checks** — flags drum patterns a human couldn't physically play, using the thresholds below.

Per-instrument minimum sustain length, below which a note is treated as a tap instead of a sustain:

| Instrument | Min sustain (ticks) |
|------------|---------------------|
| Guitar | 48 |
| Bass | 48 |
| Keys | 48 |
| Drums | 0 |

Drum physical-check thresholds (only used when *Enable drum physical checks* is on):

| Threshold | Default | Meaning |
|-----------|---------|---------|
| Drum separation limit (ms) | 40 | Speed limit between hits on different drum pads/cymbals |
| Crossover limit (ms) | 80 | Speed limit for crossover hits (e.g. Snare to Green) |

## Hotkeys

Full list of remappable shortcuts, grouped by action (General, Placement, Movement, Modifiers). See the [Keyboard Shortcuts reference](/reference/keyboard-shortcuts) for the defaults.

- Click a binding, then press the new key combination to rebind it. Press `Esc` while recording to cancel.
- Bindings that collide with another action are highlighted, with a note showing which action they conflict with — conflicts must be resolved before you can save.
- Each row has its own *Reset* button to restore just that action's default binding.

## Footer actions

- **Reset All to Defaults** — reverts every hotkey to its default binding (does not affect the other settings sections).
- **Cancel** — closes the modal and discards any unsaved changes.
- **Done** — saves all changes and closes the modal. Disabled while any hotkey conflicts are unresolved.
