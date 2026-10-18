package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/christphe/hq-poketoken-plugin/companion/internal/config"
)

func testSettings(t *testing.T) *settings {
	dir := t.TempDir()
	t.Setenv("AppData", dir)         // windows
	t.Setenv("XDG_CONFIG_HOME", dir) // linux
	t.Setenv("HOME", dir)            // darwin
	a := &app{wakeup: make(chan bool, 1), cfg: config.Config{Server: "https://old.example.com", Token: "hqp_old", Follow: "active"}}
	return &settings{app: a, key: "k1", addr: "127.0.0.1:5555"}
}

func do(s *settings, method, target string, form url.Values) *httptest.ResponseRecorder {
	var r *http.Request
	if form != nil {
		r = httptest.NewRequest(method, target, strings.NewReader(form.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	r.Host = s.addr
	w := httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.page)
	mux.HandleFunc("POST /save", s.save)
	s.guard(mux).ServeHTTP(w, r)
	return w
}

func TestSettingsGuard(t *testing.T) {
	s := testSettings(t)
	if w := do(s, "GET", "/?k=nope", nil); w.Code != http.StatusForbidden {
		t.Fatalf("wrong key: %d", w.Code)
	}
	r := httptest.NewRequest("GET", "/?k=k1", nil)
	r.Host = "evil.example.com:5555"
	w := httptest.NewRecorder()
	s.guard(http.NotFoundHandler()).ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("wrong host: %d", w.Code)
	}
	w = do(s, "GET", "/?k=k1", nil)
	if w.Code != 200 || strings.Contains(w.Body.String(), "hqp_old") {
		t.Fatalf("page: %d, token shown: %v", w.Code, strings.Contains(w.Body.String(), "hqp_old"))
	}
}

func TestSettingsSaveKeepsTheToken(t *testing.T) {
	s := testSettings(t)
	w := do(s, "POST", "/save", url.Values{"k": {"k1"}, "server": {"https://office.example.com/"}, "token": {""}, "follow": {"pinned"}})
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	c := s.app.config()
	if c.Server != "https://office.example.com" || c.Token != "hqp_old" || c.Follow != "pinned" {
		t.Fatalf("got %+v", c)
	}
	saved, err := config.Load()
	if err != nil || saved != c {
		t.Fatalf("saved %+v, %v", saved, err)
	}
	if force := <-s.app.wakeup; !force {
		t.Fatal("saving must send at once")
	}
}
