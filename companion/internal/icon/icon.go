// Package icon makes the tray icon: the Pokémon's PMD SpriteCollab portrait, downloaded once and kept
// in the user's cache folder (shown on this computer only), or a Poké Ball drawn here.
package icon

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/christphe/hq-poketoken-plugin/companion/internal/ptb"
)

const portraits = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait/"

// Ball is the icon shown before a Pokémon is known (or for an egg), in the tray's format.
func Ball(dim bool) []byte {
	const n = 32
	img := image.NewNRGBA(image.Rect(0, 0, n, n))
	red, white, dark := color.NRGBA{226, 58, 52, 255}, color.NRGBA{245, 245, 245, 255}, color.NRGBA{34, 34, 40, 255}
	if dim {
		red = color.NRGBA{150, 150, 150, 255}
	}
	c := float64(n-1) / 2
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			dx, dy := float64(x)-c, float64(y)-c
			d := dx*dx + dy*dy
			switch {
			case d > 15.5*15.5:
				continue
			case d > 13.5*13.5, dy > -1.5 && dy < 1.5, d < 5.5*5.5 && d > 3.5*3.5:
				img.Set(x, y, dark)
			case d <= 3.5*3.5, dy > 0:
				img.Set(x, y, white)
			default:
				img.Set(x, y, red)
			}
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return Tray(b.Bytes())
}

// Tray wraps a PNG for the tray: Windows wants an .ico (a PNG inside is fine since Vista), the others a PNG.
func Tray(pngBytes []byte) []byte {
	if runtime.GOOS != "windows" {
		return pngBytes
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(pngBytes))
	if err != nil {
		return pngBytes
	}
	var b bytes.Buffer
	w, h := byte(cfg.Width), byte(cfg.Height) // 0 means 256
	_ = binary.Write(&b, binary.LittleEndian, [3]uint16{0, 1, 1})
	b.Write([]byte{w, h, 0, 0})
	_ = binary.Write(&b, binary.LittleEndian, [2]uint16{1, 32})
	_ = binary.Write(&b, binary.LittleEndian, [2]uint32{uint32(len(pngBytes)), 22})
	b.Write(pngBytes)
	return b.Bytes()
}

// Portraits gets and caches portraits.
type Portraits struct {
	Dir  string
	HTTP *http.Client
	// Forms maps PokeTokenBar form names to SpriteCollab form folders, per species.
	Forms map[int]map[string]int
}

// NewPortraits keeps portraits in dir.
func NewPortraits(dir string, forms map[int]map[string]int) *Portraits {
	return &Portraits{Dir: dir, HTTP: &http.Client{Timeout: 15 * time.Second}, Forms: forms}
}

// Get returns the tray icon of that Pokémon, falling back from the form and colours to the base portrait.
func (p *Portraits) Get(ctx context.Context, m ptb.Mon) ([]byte, error) {
	if m.Dex <= 0 {
		return Ball(false), nil
	}
	for _, rel := range p.paths(m) {
		cached := filepath.Join(p.Dir, filepath.FromSlash(rel))
		if b, err := os.ReadFile(cached); err == nil {
			return Tray(b), nil
		}
		b, err := p.fetch(ctx, portraits+rel)
		if err != nil {
			continue
		}
		_ = os.MkdirAll(filepath.Dir(cached), 0o700)
		_ = os.WriteFile(cached, b, 0o600)
		return Tray(b), nil
	}
	return nil, fmt.Errorf("no portrait for #%d", m.Dex)
}

func (p *Portraits) paths(m ptb.Mon) []string {
	d := fmt.Sprintf("%04d/", m.Dex)
	f := p.Forms[m.Dex][m.Form]
	var out []string
	if f > 0 && m.Shiny {
		out = append(out, fmt.Sprintf("%s%04d/0001/Normal.png", d, f))
	}
	if f > 0 {
		out = append(out, fmt.Sprintf("%s%04d/Normal.png", d, f))
	}
	if m.Shiny {
		out = append(out, d+"0000/0001/Normal.png")
	}
	return append(out, d+"Normal.png")
}

func (p *Portraits) fetch(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := p.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", url, res.Status)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if _, err := png.DecodeConfig(bytes.NewReader(b)); err != nil {
		return nil, err
	}
	return b, nil
}
