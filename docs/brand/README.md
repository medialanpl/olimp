# OLIMP brand

The mark is an O made of twelve segments around a single peak: the twelve gods of Olympus, and
the agents working around one goal. One segment is ochre: the active one.

All files are plain SVG paths: no `<text>`, no `<use>`, no rasters or filters.

## Files

| File | Use |
|---|---|
| `olimp-symbol.svg` | main symbol in colour, 48 px and up |
| `olimp-symbol-mono.svg` | one colour (Graphite) |
| `olimp-symbol-reversed.svg` | on Graphite: thinner segments (radii 103/73), wider gaps (11) |
| `olimp-symbol-medium.svg` | 25–47 px: the simple mark with the top segment cut out |
| `olimp-symbol-small.svg` | 24 px and below: the simple mark, O with the peak |
| `olimp-wordmark.svg` | wordmark only |
| `olimp-horizontal.svg`, `olimp-horizontal-reversed.svg` | horizontal lockup, light and dark backgrounds |
| `olimp-stacked.svg` | stacked lockup |
| `olimp-app-icon.svg` | app icon on a Graphite tile |
| `olimp-loader.svg` | loading indicator (CSS inside the file) |
| `web/favicon.svg` | favicon from the small mark, switches to Paper in dark mode |
| `explorations/peak-v1-arc.svg`, `explorations/peak-v2-flat.svg` | peak variants to compare; v1 is the one in use |

## Colours

| Name     | HEX     | RGB         | Use                                   |
|----------|---------|-------------|---------------------------------------|
| Graphite | #1C1F26 | 28 31 38    | 11 segments, peak, wordmark           |
| Ochre    | #B87A20 | 184 122 32  | the single active segment, never text |
| Paper    | #F4F1EA | 244 241 234 | light background, reversed mark       |

Ochre reaches 3.6:1 on white, 3.2:1 on Paper and 4.6:1 on Graphite (graphics threshold 3:1).

## Sizes

| Size     | File                       |
|----------|----------------------------|
| 48 px+   | olimp-symbol.svg           |
| 25–47 px | olimp-symbol-medium.svg    |
| ≤ 24 px  | olimp-symbol-small.svg     |

Horizontal lockup: at least 200 px wide; below that use the medium symbol at the same scale.

## Clear space

Keep free space equal to the ring thickness (32/256 of the symbol) on every side.

## Backgrounds

White or Paper with the Graphite mark; Graphite with the reversed files.

## Loader

The ochre segment steps around the ring every 30° over twelve grey segments; it stays still with
`prefers-reduced-motion: reduce`. Inline the SVG or use it as an image: the CSS is inside the file.

## Don't

- rotate the mark (the peak always points up) or change the number of segments;
- colour more than one segment, or put ochre text on a light background;
- stretch, add shadows or gradients, or place the mark on a photo without a Graphite tile;
- shrink olimp-symbol.svg below 48 px instead of switching to the medium cut;
- retype the wordmark in a font: it is built from shapes.

UI typeface: Geist and Geist Mono (SIL OFL).

## Licence

The OLIMP name and logo are not covered by the code licence. (to be confirmed)
