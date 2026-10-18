# PokeToken for Home Quarters

Your [PokeTokenBar](https://github.com/chattymin/PokeTokenBar) Pokémon follows you around your [Home Quarters](https://github.com/christphe/homequarters) office. When it hatches or evolves there, it changes in the office too.

Two parts:

| Part | Where | What it does |
| --- | --- | --- |
| [`plugin/poketoken`](plugin/poketoken) | the office's server (`HQ_PLUGINS_DIR/installed/poketoken`) | Keeps each member's current Pokémon and gives it to them as a pet of the bundled pets plugin (`hq-pets`): it follows, wanders and comes back like their other pets. Members create an app token in its panel. |
| [`companion`](companion) | the computer running PokeTokenBar (macOS, Windows, Linux) | A tray icon that reads PokeTokenBar's save once a minute and reports the current Pokémon to the office when it changes. It shows that Pokémon's portrait in the tray. You set the office's address and the token there. |

> **Needs Home Quarters with guest pets drawn by their plugin** ([christphe/homequarters#12](https://github.com/christphe/homequarters/issues/12): `setPet` with `metadata`, `hq.provideSheet`) and sheets from image data (#10), with `hq-pets` turned on. The plugin declares `raw.githubusercontent.com` in `externalHosts`; administrators see it before turning the plugin on.

## How it works

~~~text
PokeTokenBar save ──(every minute, on change)──> companion ──POST /plugins/poketoken/api/pokemon──> poketoken (server)
  companion-state.json        { dex, form, shiny, name }        Authorization: Bearer hqp_…            │
                                                                    setPet({ metadata: {dex,form,shiny} })
                                                                                                         ▼
  every page: hq-pets asks poketoken's browser code for that sheet (hq.provideSheet), which fetches the
  PMD SpriteCollab sprite from GitHub and lays it out; hq-pets then walks it like the member's other pets
~~~

- **What leaves your computer:** the species number, the form name, whether it is shiny, and its name in PokeTokenBar's language. Nothing else does: tokens, progression, IVs and your dex stay where they are.
- **Which Pokémon:** by default, the one being raised (an egg before it hatches). You can choose the one pinned in PokeTokenBar instead.
- **Sprites:** they come from [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab) (CC BY-NC 4.0). Neither this repository nor the office stores them. Each viewer's browser downloads `Walk-Anim.png`, `Idle-Anim.png` and `AnimData.xml` from `raw.githubusercontent.com` and crops them into a sheet (the walk, and the first idle frame held still when it stands), feet at the bottom, shrunk to the size of a pet (1.5 times, 3 times for the biggest). GitHub therefore sees each viewer's IP address. Species that SpriteCollab has not drawn yet are shown as an egg.

## Install the plugin

1. Copy `plugin/poketoken` to `HQ_PLUGINS_DIR/installed/poketoken` on the office's server. In Docker, mount it at `/app/plugins/installed/poketoken`; read-only is fine.
2. Restart Home Quarters, then turn the plugin on in **Administration > Plugins**.
3. Turn on the pets plugin (`hq-pets`) too: it walks the Pokémon as one of the member's pets (Let pets wander, Call pets, moods, name on hover). A member has at most 4 such guest pets, all plugins together. Administration > Plugins lists the external host poketoken fetches sprites from.

## Run the companion

1. Download it from the [releases](https://github.com/christphe/hq-poketoken-plugin/releases), or build it with `go build -o poketoken-companion ./companion`. On Windows, add `-ldflags "-H windowsgui"`. On macOS you need cgo, so build on a Mac.
2. Start it. On the first run it opens its settings page in your browser.
3. In the office, open **side panel > Plugins > PokeToken > Create token**. Paste the token and the office's address (`https://…`) into the settings, then **Save and send**.

It finds PokeTokenBar's save by itself, picking the most recently written of:

| App | Save |
| --- | --- |
| PokeTokenBar (macOS) | `~/Library/Application Support/PokeTokenBar/companion-state.json` |
| PokeTokenBar-Windows (fully-notdev) | `%APPDATA%\PokeTokenBar\companion-state.json` |
| PokeTokenBar (aschwehm, Tauri) | `%LOCALAPPDATA%\poketokenbar\companion-state.json`, `~/.local/share/poketokenbar/companion-state.json` |
| PokeTokenBar-for-Windows (NMHK-134711) | `%LOCALAPPDATA%\PokeTokenBarWin\save.json` |
| any of them with `PTB_STATE_DIR` set | `$PTB_STATE_DIR/companion-state.json` |

Settings are stored, readable by you only, in `PokeTokenCompanion/config.json` under your user config folder. The log is `companion.log` in the same folder. Portraits and names are cached under your user cache folder.

### The plugin's API (for other companions)

All routes take the member's app token (`Authorization: Bearer hqp_…`):

| Route | Body / answer |
| --- | --- |
| `POST /plugins/poketoken/api/pokemon` | `{ "dex": 25, "form": "", "shiny": false, "name": "Pikachu" }`: `dex` from 1 to 1025, or 0 for an egg. `form` is a PokeTokenBar form name (`sky`, `q`, `therian`…). `name` is at most 24 characters. → `{ ok, hidden }`, or 400 `{ ok: false, error }` |
| `GET /plugins/poketoken/api/pokemon` | → `{ ok, current, hidden, at }` |
| `POST /plugins/poketoken/api/clear` | Shows nothing until the next report. |

A member can also hide their Pokémon from the plugin's panel, without touching the companion.

## Develop

~~~bash
pnpm install
pnpm check                      # tsc on the plugin's server and browser code (against plugin/sdk)
pnpm test                       # the plugin's server code compiled with esbuild, against a fake hq
node test/sprites.mjs out/      # builds sample sheets in headless Chrome from SpriteCollab (network)
node test/office.mjs out/       # against a running office (the published image, plugin mounted): see the file
go vet ./... && go test ./...   # the companion
~~~

`plugin/sdk` is a copy of Home Quarters' `plugins/sdk`. Copy it again when Home Quarters changes the plugin API. [`AGENTS.md`](AGENTS.md) lists the Home Quarters documents to read first.

## Credits and licences

- The code in this repository is under the MIT licence ([LICENSE](LICENSE)).
- The sprites and portraits are by the [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab) contributors, under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). They are downloaded at run time and never redistributed here. Non-commercial use only.
- Species names come from [PokéAPI](https://pokeapi.co).
- Pokémon is © Nintendo, Creatures and GAME FREAK, and The Pokémon Company. This is an unofficial fan project, not affiliated with any of them, nor with PokeTokenBar.
