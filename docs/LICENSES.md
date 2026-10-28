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

## PDF.js and its rendering resources

PDF import uses the exact `pdfjs-dist` version **6.4.299**, pinned in
`package.json` and the lockfile. PDF.js itself is Apache-2.0. Its bundled
resources have their own notices; the package license does not replace them.

| Resource                                  | Notice retained from the installed package                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| PDF.js display API / worker               | `LICENSE` (Apache-2.0)                                                                |
| Adobe CMaps                               | `cmaps/LICENSE` (Adobe BSD-style terms)                                               |
| Foxit standard fonts                      | `standard_fonts/LICENSE_FOXIT` (PDFium BSD-style terms)                               |
| Liberation standard font                  | `standard_fonts/LICENSE_LIBERATION` (GPL v2 with the stated font embedding exception) |
| ICC profiles                              | `iccs/LICENSE` (CC0)                                                                  |
| OpenJPEG, JBIG2, QCMS and PDF.js wrappers | Every `wasm/LICENSE_*` file, including the upstream BSD / MIT / Apache notices        |

Vite copies these directories and their original notices without modification
to `dist/pdfjs/6.4.299/`. The worker is emitted as a version-locked build asset;
CMaps, standard fonts, ICC and WASM resources are served from the same origin.
The corresponding upstream resources and build recipe are available in the
[tagged PDF.js source](https://github.com/mozilla/pdf.js/tree/v6.4.299/external)
and [gulpfile](https://github.com/mozilla/pdf.js/blob/v6.4.299/gulpfile.mjs).
Keep these notices and source references when redistributing the build.

The PDF raster writer uses the browser's native `CompressionStream` for
lossless zlib compression, adding no separate compression dependency.
