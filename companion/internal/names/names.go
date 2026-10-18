// Package names gives species names in PokeTokenBar's language, from PokéAPI, cached on disk.
package names

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Book is a cache of names by species and language.
type Book struct {
	mu    sync.Mutex
	path  string
	names map[string]map[string]string // dex -> language -> name
	http  *http.Client
	api   string
}

// Open loads the cache kept at path (created on first save).
func Open(path string) *Book {
	b := &Book{path: path, names: map[string]map[string]string{}, http: &http.Client{Timeout: 10 * time.Second}, api: "https://pokeapi.co/api/v2"}
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &b.names)
	}
	return b
}

// PokeTokenBar's language codes -> PokéAPI's.
var apiLang = map[string]string{"ja": "ja-hrkt", "pt": "en", "ru": "en"}

// Name returns the species' name in lang ("en" when that language has none), or "" if it cannot be had.
func (b *Book) Name(ctx context.Context, dex int, lang string) string {
	if dex <= 0 {
		return ""
	}
	if l, ok := apiLang[lang]; ok {
		lang = l
	}
	if lang == "" {
		lang = "en"
	}
	key := fmt.Sprint(dex)
	b.mu.Lock()
	got, ok := b.names[key]
	b.mu.Unlock()
	if !ok {
		var err error
		if got, err = b.fetch(ctx, dex); err != nil {
			return ""
		}
		b.mu.Lock()
		b.names[key] = got
		b.save()
		b.mu.Unlock()
	}
	if n := got[lang]; n != "" {
		return n
	}
	return got["en"]
}

func (b *Book) fetch(ctx context.Context, dex int) (map[string]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/pokemon-species/%d", b.api, dex), nil)
	if err != nil {
		return nil, err
	}
	res, err := b.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pokeapi: %s", res.Status)
	}
	var body struct {
		Names []struct {
			Name     string `json:"name"`
			Language struct {
				Name string `json:"name"`
			} `json:"language"`
		} `json:"names"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, n := range body.Names {
		out[n.Language.Name] = n.Name
	}
	return out, nil
}

func (b *Book) save() {
	raw, err := json.Marshal(b.names)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(b.path), 0o700)
	_ = os.WriteFile(b.path, raw, 0o600)
}
