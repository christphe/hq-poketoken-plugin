# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

A [Home Quarters](https://github.com/christphe/homequarters) plugin (`plugin/poketoken`) and its desktop companion (`companion`). Together they show each member's [PokeTokenBar](https://github.com/chattymin/PokeTokenBar) Pokémon following them in the office. The README explains how they fit together.

## Read first

The Home Quarters documentation, as an index for LLMs: <https://christphe.github.io/homequarters/llms.txt>. All the pages in one file: <https://christphe.github.io/homequarters/llms-full.txt>. A local checkout sits next to this repository at `../tilework`. Read `docs/plugins.md` and `docs/plugin-api.md` there, and look at the sample plugin `plugins/bundled/hq-pets`. The rules that bite:

- A server module may export only `load`, `update`, `onJoin`, `onLeave`, `onMessage`, `onSettings` and `unload`. Any other export stops the plugin from starting (`test/server.test.mjs` checks this).
- The server code runs in QuickJS with no I/O and gets 50 ms per call. A message is at most 4 KB, which is why the roster is cut into pieces. Do the broadcasts in `update`.
- The browser code runs in an iframe with `sandbox="allow-scripts"` and has an opaque origin. Its `fetch` works with CORS hosts such as `raw.githubusercontent.com`.
- The installed plugin's name must not start with `hq-`.

## Rules for this repository

- **Never commit SpriteCollab or Pokémon art.** Sprites and portraits are downloaded at run time: by the browser (`public/pmd.ts`) and by the companion (`internal/icon`). Their licence is CC BY-NC 4.0, so they must not be hosted here.
- **Only species, form, shiny and name leave the user's computer.** Do not add progression or profile data to reports.
- `plugin/poketoken/public/forms.json` maps PokeTokenBar's form names to SpriteCollab's form folders. The browser code and the companion (`forms.go`, via `go:embed`) both read it, so keep it as the only copy.
- `plugin/sdk` is a copy of Home Quarters' `plugins/sdk/`. Do not edit it here; copy it again. The browser code type-checks with `"lib": ["ES2020", "DOM"]`.
- The iframe's Content Security Policy only lets it fetch from its own folder and the `externalHosts` of `plugin.json`, here `raw.githubusercontent.com`. A new host has to be declared there.
- A feature that needs a change in Home Quarters gets an issue in christphe/homequarters (example: #10, sprite sheets from image data). Do not work around the platform.
- Code, comments and docs are in English.

## Commands

~~~bash
pnpm install && pnpm check && pnpm test     # plugin: types, then server logic against a fake hq
node test/sprites.mjs <dir> [25 6:: 201:q 492:sky:s 0]   # sheets in headless Chrome (needs network; look at them)
go vet ./... && go test ./...               # companion
go build -ldflags "-H windowsgui" -o bin/poketoken-companion.exe ./companion   # Windows
~~~

To try it in a real office, do not rebuild Home Quarters from source. Check that the `ghcr.io/christphe/homequarters` image build of the commit you need has passed, pull that image, and mount `plugin/poketoken` at `/app/plugins/installed/poketoken` (see `../tilework/deploy`).
