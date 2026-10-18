// Package config keeps the companion's settings in the user's config folder, readable by the user only.
package config

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/christphe/hq-poketoken-plugin/companion/internal/ptb"
)

// Config is what the settings page edits.
type Config struct {
	// Server is the office's address, e.g. https://office.example.com.
	Server string `json:"server"`
	// Token is the member's app token for the poketoken plugin (hqp_...).
	Token string `json:"token"`
	// SavePath overrides where PokeTokenBar's save is looked for ("" finds it).
	SavePath string `json:"savePath,omitempty"`
	// Follow is which Pokémon to show: the one being raised, or the one pinned in PokeTokenBar.
	Follow ptb.Follow `json:"follow,omitempty"`
	// Paused stops reporting until it is turned off again.
	Paused bool `json:"paused,omitempty"`
}

// Ready tells whether reports can be sent.
func (c Config) Ready() bool { return c.Server != "" && c.Token != "" }

// Dir is the companion's folder in the user's config folder.
func Dir() (string, error) {
	d, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "PokeTokenCompanion"), nil
}

func file() (string, error) {
	d, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "config.json"), nil
}

// Load reads the settings; a missing file gives the defaults.
func Load() (Config, error) {
	c := Config{Follow: ptb.FollowActive}
	p, err := file()
	if err != nil {
		return c, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	if c.Follow != ptb.FollowPinned {
		c.Follow = ptb.FollowActive
	}
	return c, nil
}

// Save writes the settings (the token is a secret: the file is the user's only).
func Save(c Config) error {
	p, err := file()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}
