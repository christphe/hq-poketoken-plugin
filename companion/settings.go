package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"html/template"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/christphe/hq-poketoken-plugin/companion/internal/config"
	"github.com/christphe/hq-poketoken-plugin/companion/internal/office"
	"github.com/christphe/hq-poketoken-plugin/companion/internal/ptb"
)

//go:embed settings.html
var settingsHTML string

var settingsPage = template.Must(template.New("settings").Parse(settingsHTML))

// settings serves the settings page on 127.0.0.1 only, behind a random key in its address, so that no
// other site in the browser can read or post it.
type settings struct {
	app  *app
	key  string
	addr string
}

func startSettings(a *app) (*settings, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	k := make([]byte, 16)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	s := &settings{app: a, key: hex.EncodeToString(k), addr: ln.Addr().String()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.page)
	mux.HandleFunc("POST /save", s.save)
	mux.HandleFunc("POST /test", s.test)
	srv := &http.Server{Handler: s.guard(mux), ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	return s, nil
}

// URL opens the page.
func (s *settings) URL() string { return "http://" + s.addr + "/?k=" + s.key }

func (s *settings) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// the Host check stops DNS rebinding; the key stops other pages from posting the form
		if r.Host != s.addr {
			http.Error(w, "wrong host", http.StatusForbidden)
			return
		}
		k := r.URL.Query().Get("k")
		if r.Method == http.MethodPost {
			k = r.PostFormValue("k")
		}
		if subtle.ConstantTimeCompare([]byte(k), []byte(s.key)) != 1 {
			http.Error(w, "open the settings from the tray icon", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

type view struct {
	Key       string
	Config    config.Config
	HasToken  bool
	Found     string
	Status    string
	ConfigDir string
	Message   string
	OK        bool
}

func (s *settings) render(w http.ResponseWriter, msg string, ok bool) {
	c := s.app.config()
	dir, _ := config.Dir()
	v := view{Key: s.key, Config: c, HasToken: c.Token != "", Found: ptb.Find(), Status: s.app.statusLine(), ConfigDir: dir, Message: msg, OK: ok}
	v.Config.Token = ""
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = settingsPage.Execute(w, v)
}

func (s *settings) page(w http.ResponseWriter, _ *http.Request) { s.render(w, "", true) }

// fromForm merges the form into the current settings; an empty token keeps the saved one.
func (s *settings) fromForm(r *http.Request) config.Config {
	c := s.app.config()
	c.Server = strings.TrimRight(strings.TrimSpace(r.PostFormValue("server")), "/")
	if t := strings.TrimSpace(r.PostFormValue("token")); t != "" {
		c.Token = t
	}
	c.SavePath = strings.TrimSpace(r.PostFormValue("savePath"))
	c.Follow = ptb.Follow(r.PostFormValue("follow"))
	if c.Follow != ptb.FollowPinned {
		c.Follow = ptb.FollowActive
	}
	return c
}

func (s *settings) save(w http.ResponseWriter, r *http.Request) {
	c := s.fromForm(r)
	if _, err := office.New(c.Server, c.Token); err != nil {
		s.render(w, err.Error(), false)
		return
	}
	if err := s.app.setConfig(c); err != nil {
		s.render(w, "Could not save the settings: "+err.Error(), false)
		return
	}
	s.app.wake(true)
	s.render(w, "Saved. The current Pokémon is being sent.", true)
}

func (s *settings) test(w http.ResponseWriter, r *http.Request) {
	c := s.fromForm(r)
	cl, err := office.New(c.Server, c.Token)
	if err == nil && c.Token == "" {
		err = errNoToken
	}
	if err == nil {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		_, err = cl.Get(ctx)
	}
	if err != nil {
		s.render(w, "Connection failed: "+err.Error(), false)
		return
	}
	s.render(w, "The office accepts this token. Save to use it.", true)
}
