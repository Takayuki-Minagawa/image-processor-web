# Third-party fonts and design assets

Pixelweave is local-first. The following redistributable resources are shipped
with the application; no font or icon CDN is contacted while editing.

## Self-hosted fonts

The font files are supplied by Fontsource packages and retain their upstream
SIL Open Font License 1.1 (`OFL-1.1`). Package copies of the license text are
available at `node_modules/<package>/LICENSE` after dependency installation.

| Family        | Package                              | Source                                       | Loading                   |
| ------------- | ------------------------------------ | -------------------------------------------- | ------------------------- |
| Inter         | `@fontsource-variable/inter`         | <https://fontsource.org/fonts/inter>         | Application font CSS      |
| Space Grotesk | `@fontsource-variable/space-grotesk` | <https://fontsource.org/fonts/space-grotesk> | Application font CSS      |
| Bitter        | `@fontsource-variable/bitter`        | <https://fontsource.org/fonts/bitter>        | Application font CSS      |
| Manrope       | `@fontsource-variable/manrope`       | <https://fontsource.org/fonts/manrope>       | Application font CSS      |
| Noto Sans JP  | `@fontsource-variable/noto-sans-jp`  | <https://fontsource.org/fonts/noto-sans-jp>  | Lazy, unicode-range split |
| Noto Serif JP | `@fontsource-variable/noto-serif-jp` | <https://fontsource.org/fonts/noto-serif-jp> | Lazy, unicode-range split |

The Noto families are loaded from same-origin build assets only when selected.
Their WOFF2 subsets stay outside the service-worker installation shell and are
runtime-cached after use, preventing the full Japanese font collection from
inflating the initial PWA download.

## Built-in SVG icons

The initial `core-icons` asset pack contains geometry adapted from Lucide. It
is redistributed under the ISC License. The installed `lucide-react` package
contains the license text at `node_modules/lucide-react/LICENSE`; the upstream
project is <https://lucide.dev/license>.

The asset catalog records the license identifier and source URL for every icon.
All SVG source, including bundled source, is passed through Pixelweave's SVG
sanitizer before it is exposed to a renderer.

## User-provided assets and fonts

User font bytes remain in device-local storage and are not embedded in
`.pwx.json` project or `.pwxtemplate.json` template files. Projects retain the
font family, fallback, and optional local source reference.

Reusable user-asset library originals are intended to remain in device-local
storage, and templates or brand kits keep asset references instead of binary
payloads. After an asset is inserted into a design, the current renderer may
materialize validated raster data or sanitized SVG geometry inside the
`.pwx.json` Fabric payload so that the project stays self-contained. Users are
responsible for ensuring that files they add and projects they share may be
used for their intended purpose.
