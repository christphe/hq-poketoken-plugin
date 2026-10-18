// The PokeToken companion: a tray icon that reads PokeTokenBar's save once a minute and tells the
// poketoken plugin of a Home Quarters office which Pokémon is being raised, when that changes.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"fyne.io/systray"

	hqpoketoken "github.com/christphe/hq-poketoken-plugin"
	"github.com/christphe/hq-poketoken-plugin/companion/internal/config"
	"github.com/christphe/hq-poketoken-plugin/companion/internal/icon"
	"github.com/christphe/hq-poketoken-plugin/companion/internal/names"
	"github.com/christphe/hq-poketoken-plugin/companion/internal/office"
	"github.com/christphe/hq-poketoken-plugin/companion/internal/ptb"
)

// Set by the release build (-ldflags "-X main.version=...").
var version = "dev"

const every = time.Minute

var errNoToken = errors.New("no app token")

type app struct {
	mu       sync.Mutex
	cfg      config.Config
	sent     *office.Report // last report the office accepted
	mon      *ptb.Mon       // last Pokémon read
	name     string
	status   string
	at       time.Time
	iconFor  *ptb.Mon // the Pokémon the tray icon shows
	wakeup   chan bool
	names    *names.Book
	pictures *icon.Portraits

	mPokemon, mStatus, mSend, mPause, mSettings, mOffice, mQuit *systray.MenuItem
	settings                                                    *settings
}

func main() {
	dir, err := config.Dir()
	if err == nil {
		_ = os.MkdirAll(dir, 0o700)
		if f, err := os.OpenFile(filepath.Join(dir, "companion.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
			log.SetOutput(f)
		}
	}
	cfg, err := config.Load()
	if err != nil {
		log.Printf("settings: %v (using defaults)", err)
	}
	cache, _ := os.UserCacheDir()
	cache = filepath.Join(cache, "PokeTokenCompanion")
	a := &app{
		cfg:      cfg,
		wakeup:   make(chan bool, 1),
		names:    names.Open(filepath.Join(cache, "names.json")),
		pictures: icon.NewPortraits(filepath.Join(cache, "portraits"), hqpoketoken.Forms()),
		status:   "Starting",
	}
	systray.Run(a.ready, func() {})
}

func (a *app) ready() {
	systray.SetIcon(icon.Ball(true))
	systray.SetTooltip("PokeToken companion")
	a.mPokemon = systray.AddMenuItem("No Pokémon yet", "")
	a.mPokemon.Disable()
	a.mStatus = systray.AddMenuItem("Starting", "")
	a.mStatus.Disable()
	systray.AddSeparator()
	a.mSend = systray.AddMenuItem("Send now", "Read PokeTokenBar's save and send the Pokémon now")
	a.mPause = systray.AddMenuItemCheckbox("Pause", "Stop sending until unpaused", a.config().Paused)
	a.mSettings = systray.AddMenuItem("Settings…", "Office address, app token, which Pokémon")
	a.mOffice = systray.AddMenuItem("Open the office", "")
	systray.AddSeparator()
	a.mQuit = systray.AddMenuItem("Quit", "")

	s, err := startSettings(a)
	if err != nil {
		log.Printf("settings page: %v", err)
		a.mSettings.Disable()
	}
	a.settings = s
	if !a.config().Ready() && s != nil {
		openURL(s.URL()) // first run: ask for the office and the token
	}
	go a.menu()
	go a.loop()
}

func (a *app) menu() {
	for {
		select {
		case <-a.mSend.ClickedCh:
			a.wake(true)
		case <-a.mPause.ClickedCh:
			c := a.config()
			c.Paused = !c.Paused
			if err := a.setConfig(c); err != nil {
				log.Printf("pause: %v", err)
			}
			if c.Paused {
				a.mPause.Check()
			} else {
				a.mPause.Uncheck()
			}
			a.wake(!c.Paused)
		case <-a.mSettings.ClickedCh:
			if a.settings != nil {
				openURL(a.settings.URL())
			}
		case <-a.mOffice.ClickedCh:
			if c := a.config(); c.Server != "" {
				openURL(c.Server)
			}
		case <-a.mQuit.ClickedCh:
			systray.Quit()
			return
		}
	}
}

func (a *app) loop() {
	force := true // the first report after starting always goes out
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		a.tick(force)
		select {
		case <-t.C:
			force = false
		case force = <-a.wakeup:
		}
	}
}

// wake runs a tick now; force sends even if nothing changed.
func (a *app) wake(force bool) {
	select {
	case a.wakeup <- force:
	default:
	}
}

func (a *app) config() config.Config {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

func (a *app) setConfig(c config.Config) error {
	if err := config.Save(c); err != nil {
		return err
	}
	a.mu.Lock()
	changed := c.Server != a.cfg.Server || c.Token != a.cfg.Token
	a.cfg = c
	if changed {
		a.sent = nil // a new office or token: report again
	}
	a.mu.Unlock()
	return nil
}

func (a *app) statusLine() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.at.IsZero() {
		return a.status
	}
	return a.status + " (" + a.at.Format("15:04") + ")"
}

func (a *app) setStatus(s string) {
	a.mu.Lock()
	a.status, a.at = s, time.Now()
	a.mu.Unlock()
	line := a.statusLine()
	a.mStatus.SetTitle(line)
	systray.SetTooltip("PokeToken: " + line)
}

func (a *app) tick(force bool) {
	c := a.config()
	save, err := ptb.Read(c.SavePath, c.Follow)
	if err != nil {
		if errors.Is(err, ptb.ErrNoSave) {
			a.setStatus("PokeTokenBar's save was not found: set its path in Settings")
		} else {
			a.setStatus("Cannot read PokeTokenBar's save: " + err.Error())
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	name := a.names.Name(ctx, save.Mon.Dex, save.Language)
	if save.Mon.Dex == 0 {
		name = "Egg"
	} else if name == "" {
		name = fmt.Sprintf("#%d", save.Mon.Dex)
	}
	a.mu.Lock()
	m := save.Mon
	a.mon, a.name = &m, name
	a.mu.Unlock()
	a.showPokemon(ctx, m, name)

	switch {
	case c.Paused:
		a.setStatus("Paused")
		return
	case !c.Ready():
		a.setStatus("Not set up: open Settings")
		return
	}
	r := office.Report{Mon: m, Name: name}
	a.mu.Lock()
	same := a.sent != nil && *a.sent == r
	a.mu.Unlock()
	if same && !force {
		return
	}
	cl, err := office.New(c.Server, c.Token)
	if err == nil {
		err = cl.Send(ctx, r)
	}
	if err != nil {
		log.Printf("send: %v", err)
		a.setStatus("Not sent: " + err.Error())
		return // tried again on the next tick
	}
	a.mu.Lock()
	a.sent = &r
	a.mu.Unlock()
	a.setStatus("Sent to the office")
}

func (a *app) showPokemon(ctx context.Context, m ptb.Mon, name string) {
	label := name
	if m.Dex > 0 {
		label = fmt.Sprintf("%s (#%d", name, m.Dex)
		if m.Form != "" {
			label += ", " + m.Form
		}
		if m.Shiny {
			label += ", shiny"
		}
		label += ")"
	}
	a.mPokemon.SetTitle(label)
	a.mu.Lock()
	same := a.iconFor != nil && *a.iconFor == m
	a.mu.Unlock()
	if same {
		return
	}
	b, err := a.pictures.Get(ctx, m)
	if err != nil {
		log.Printf("icon: %v", err)
		b = icon.Ball(false)
	}
	systray.SetIcon(b)
	a.mu.Lock()
	a.iconFor = &m
	a.mu.Unlock()
}

func openURL(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	case "darwin":
		cmd = exec.Command("open", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("open %s: %v", u, err)
	}
}

func init() {
	log.SetPrefix("poketoken-companion " + version + " ")
}
