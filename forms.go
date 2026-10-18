// Package hqpoketoken holds what the plugin and the companion share: the table of PokeTokenBar form names
// to PMD SpriteCollab form folders, kept once in plugin/poketoken/public/forms.json.
package hqpoketoken

import (
	_ "embed"
	"encoding/json"
	"strconv"
)

//go:embed plugin/poketoken/public/forms.json
var formsJSON []byte

// Forms maps a species' PokeTokenBar form names to SpriteCollab form folders (sprite/<dex>/<form>/).
func Forms() map[int]map[string]int {
	var raw map[string]map[string]int
	if err := json.Unmarshal(formsJSON, &raw); err != nil {
		panic(err) // the file is embedded: a broken one never builds a release (see forms_test.go)
	}
	out := make(map[int]map[string]int, len(raw))
	for k, v := range raw {
		n, err := strconv.Atoi(k)
		if err != nil {
			panic(err)
		}
		out[n] = v
	}
	return out
}
