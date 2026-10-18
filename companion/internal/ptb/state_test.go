package ptb

import (
	"os"
	"path/filepath"
	"testing"
)

// A compact save as PokeTokenBar 2.x writes it (JSONEncoder, no pretty-printing), trimmed of fields this
// package ignores.
const charmeleon = `{"installBaselineSet":true,"usedSinceInstall":412000000,"spentTokens":40000000,"eggUsage":5000000,` +
	`"lastDate":"2026-10-18","active":{"baseID":4,"pathIDs":[4,5],"plannedPathIDs":[4,5,6],"stageIndex":1,` +
	`"usedAtStage":63000000,"rarity":"uncommon","totalForms":3,"isShiny":true,"nature":"adamant",` +
	`"hasGrowthBoost":false,"dittoRevealed":false,"profile":{"instanceID":"6F1C","seed":18446744073709551615,"level":22}},` +
	`"representativeSpeciesID":201,"representativeForm":"q",` +
	`"dex":[{"id":"A1B2","baseID":201,"finalID":201,"chainOrder":[201],"rarity":"common","caughtAt":782000000.5,` +
	`"isShiny":true,"form":"q","names":{"201":{"en":"Unown","fr":"Zarbi"}}}],"collectedFinals":["201:201"],` +
	`"language":"fr","inventory":{"rareCandy":2}}`

func TestParse(t *testing.T) {
	cases := []struct {
		name   string
		json   string
		follow Follow
		want   Mon
	}{
		{"active", charmeleon, FollowActive, Mon{Dex: 5, Shiny: true}},
		{"pinned", charmeleon, FollowPinned, Mon{Dex: 201, Form: "q", Shiny: true}},
		{"pinned without a pin follows the active one", `{"active":{"baseID":1,"pathIDs":[1],"stageIndex":0}}`, FollowPinned, Mon{Dex: 1}},
		{"egg", `{"eggUsage":120,"language":"en","pendingHatchID":25}`, FollowActive, Mon{}},
		{"form", `{"active":{"baseID":492,"pathIDs":[492],"stageIndex":0,"form":"sky"}}`, FollowActive, Mon{Dex: 492, Form: "sky"}},
		{"legacy unown key", `{"active":{"baseID":201,"pathIDs":[201],"stageIndex":0,"unownForm":"exclamation"}}`, FollowActive, Mon{Dex: 201, Form: "exclamation"}},
		{"stage past the path", `{"active":{"baseID":4,"pathIDs":[4,5],"stageIndex":9}}`, FollowActive, Mon{Dex: 5}},
		{"empty path", `{"active":{"baseID":7,"pathIDs":[],"stageIndex":0}}`, FollowActive, Mon{Dex: 7}},
		{"disguised ditto hides its colours", `{"active":{"baseID":10,"pathIDs":[10],"stageIndex":0,"isShiny":true,"dittoDisguise":10}}`, FollowActive, Mon{Dex: 10}},
		{"revealed ditto shows them", `{"active":{"baseID":132,"pathIDs":[132],"stageIndex":0,"isShiny":true,"dittoDisguise":10,"dittoRevealed":true}}`, FollowActive, Mon{Dex: 132, Shiny: true}},
		{"released shinies do not count", `{"representativeSpeciesID":6,"dex":[{"baseID":4,"finalID":6,"chainOrder":[4,5,6],"isShiny":true,"releasedAt":5}]}`, FollowPinned, Mon{Dex: 6}},
		{"a kept shiny of the line counts", `{"representativeSpeciesID":5,"dex":[{"baseID":4,"finalID":6,"chainOrder":[4,5,6],"isShiny":true}]}`, FollowPinned, Mon{Dex: 5, Shiny: true}},
		{"python port", `{"companion":{"hatched":true,"path":[133,134],"stage":1,"shiny":true,"nature":"Hardy"},"pokedex":{}}`, FollowActive, Mon{Dex: 134, Shiny: true}},
		{"python port egg", `{"companion":{"hatched":false,"path":[],"stage":0}}`, FollowActive, Mon{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, err := Parse([]byte(c.json), c.follow)
			if err != nil {
				t.Fatal(err)
			}
			if s.Mon != c.want {
				t.Fatalf("got %+v, want %+v", s.Mon, c.want)
			}
		})
	}
}

func TestParseLanguage(t *testing.T) {
	s, err := Parse([]byte(charmeleon), FollowActive)
	if err != nil || s.Language != "fr" {
		t.Fatalf("got %q, %v", s.Language, err)
	}
}

func TestParseBroken(t *testing.T) {
	if _, err := Parse([]byte(`{"active":`), FollowActive); err == nil {
		t.Fatal("a truncated save must fail")
	}
}

func TestReadFindsTheNewestCandidate(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PTB_STATE_DIR", dir)
	p := filepath.Join(dir, "companion-state.json")
	if err := os.WriteFile(p, []byte(charmeleon), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Read("", FollowActive)
	if err != nil {
		t.Fatal(err)
	}
	if s.Path != p || s.Mon.Dex != 5 {
		t.Fatalf("got %+v", s)
	}
}
