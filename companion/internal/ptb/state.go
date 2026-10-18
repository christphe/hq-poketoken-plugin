// Package ptb reads the Pokémon that PokeTokenBar (or one of its ports) is raising from its save file.
// Only the species, form and colours leave this package: progression, natures, IVs and the dex never do.
package ptb

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// Mon is what the office is told: a national dex number (0 for an egg), PokeTokenBar's form name ("" for
// the default form) and whether it is drawn in its shiny colours.
type Mon struct {
	Dex   int    `json:"dex"`
	Form  string `json:"form"`
	Shiny bool   `json:"shiny"`
}

// Follow chooses which Pokémon to report.
type Follow string

const (
	// FollowActive reports the Pokémon being raised now (an egg before it hatches).
	FollowActive Follow = "active"
	// FollowPinned reports the Pokémon pinned for PokeTokenBar's menu bar and floating pet, or the
	// active one when none is pinned.
	FollowPinned Follow = "pinned"
)

// Save is what was read: the Pokémon, the save's language (for names) and the file.
type Save struct {
	Mon      Mon
	Language string
	Path     string
}

// Candidates lists the save files of PokeTokenBar and its ports on this system, most likely first.
func Candidates() []string {
	var out []string
	if d := os.Getenv("PTB_STATE_DIR"); d != "" {
		out = append(out, filepath.Join(d, "companion-state.json"))
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		out = append(out, filepath.Join(home, "Library", "Application Support", "PokeTokenBar", "companion-state.json"))
	case "windows":
		if d := os.Getenv("APPDATA"); d != "" { // fully-notdev/PokeTokenBar-Windows
			out = append(out, filepath.Join(d, "PokeTokenBar", "companion-state.json"))
		}
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			out = append(out,
				filepath.Join(d, "poketokenbar", "companion-state.json"), // aschwehm/PokeTokenBar (Tauri)
				filepath.Join(d, "PokeTokenBarWin", "save.json"),         // NMHK-134711/PokeTokenBar-for-Windows
			)
		}
	default:
		data := os.Getenv("XDG_DATA_HOME")
		if data == "" {
			data = filepath.Join(home, ".local", "share")
		}
		out = append(out, filepath.Join(data, "poketokenbar", "companion-state.json"))
	}
	return out
}

// Find returns the most recently written save among the candidates, or "" when there is none.
func Find() string {
	best, bestAt := "", time.Time{}
	for _, p := range Candidates() {
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.ModTime().After(bestAt) {
			best, bestAt = p, st.ModTime()
		}
	}
	return best
}

// ErrNoSave means no save file was found.
var ErrNoSave = errors.New("no PokeTokenBar save found")

// Read reads the save at path ("" finds it).
func Read(path string, follow Follow) (Save, error) {
	if path == "" {
		if path = Find(); path == "" {
			return Save{}, ErrNoSave
		}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return Save{}, err
	}
	s, err := Parse(b, follow)
	s.Path = path
	return s, err
}

// The parts of PokeTokenBar's CompanionState (Sources/PokeTokenBar/Core/CompanionModel.swift) that say
// which Pokémon is shown. The Windows and Linux ports that share its format write the same keys.
type state struct {
	Active          *monState    `json:"active"`
	RepSpeciesID    *int         `json:"representativeSpeciesID"`
	RepForm         *string      `json:"representativeForm"`
	Dex             []dexEntry   `json:"dex"`
	Language        string       `json:"language"`
	PythonCompanion *pyCompanion `json:"companion"` // NMHK-134711's port
}

type monState struct {
	BaseID        int     `json:"baseID"`
	PathIDs       []int   `json:"pathIDs"`
	StageIndex    int     `json:"stageIndex"`
	IsShiny       bool    `json:"isShiny"`
	Form          *string `json:"form"`
	UnownForm     *string `json:"unownForm"` // older saves
	DittoDisguise *int    `json:"dittoDisguise"`
	DittoRevealed bool    `json:"dittoRevealed"`
}

type dexEntry struct {
	BaseID     int      `json:"baseID"`
	FinalID    int      `json:"finalID"`
	ChainOrder []int    `json:"chainOrder"`
	IsShiny    bool     `json:"isShiny"`
	Form       *string  `json:"form"`
	ReleasedAt *float64 `json:"releasedAt"`
}

type pyCompanion struct {
	Hatched bool  `json:"hatched"`
	Path    []int `json:"path"`
	Stage   int   `json:"stage"`
	Shiny   bool  `json:"shiny"`
}

// Parse reads a save's bytes.
func Parse(b []byte, follow Follow) (Save, error) {
	var s state
	if err := json.Unmarshal(b, &s); err != nil {
		return Save{}, fmt.Errorf("reading the save: %w", err)
	}
	out := Save{Language: s.Language}
	if s.PythonCompanion != nil && s.Active == nil {
		c := s.PythonCompanion
		if c.Hatched && len(c.Path) > 0 {
			out.Mon = Mon{Dex: c.Path[clamp(c.Stage, len(c.Path))], Shiny: c.Shiny}
		}
		return out, nil
	}
	if follow == FollowPinned && s.RepSpeciesID != nil && *s.RepSpeciesID > 0 {
		id, form := *s.RepSpeciesID, deref(s.RepForm)
		out.Mon = Mon{Dex: id, Form: form, Shiny: s.ownsShiny(id, form)}
		return out, nil
	}
	if a := s.Active; a != nil {
		id := a.BaseID
		if len(a.PathIDs) > 0 {
			id = a.PathIDs[clamp(a.StageIndex, len(a.PathIDs))]
		}
		form := deref(a.Form)
		if form == "" {
			form = deref(a.UnownForm)
		}
		// a disguised Ditto shows its disguise's colours until it is revealed (MonState.displaysShiny)
		out.Mon = Mon{Dex: id, Form: form, Shiny: a.IsShiny && (a.DittoDisguise == nil || a.DittoRevealed)}
	}
	return out, nil // no active Pokémon: an egg (Dex 0)
}

// ownsShiny mirrors CompanionState.ownsShinySpecies: a kept (not released) shiny of that species and form.
func (s state) ownsShiny(id int, form string) bool {
	for _, e := range s.Dex {
		if !e.IsShiny || e.ReleasedAt != nil || (form != "" && deref(e.Form) != form) {
			continue
		}
		if e.FinalID == id || e.BaseID == id {
			return true
		}
		for _, c := range e.ChainOrder {
			if c == id {
				return true
			}
		}
	}
	return false
}

func clamp(i, n int) int {
	if i < 0 {
		return 0
	}
	if i >= n {
		return n - 1
	}
	return i
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
