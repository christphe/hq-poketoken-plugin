package office

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/christphe/hq-poketoken-plugin/companion/internal/ptb"
)

func TestSend(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/plugins/poketoken/api/pokemon" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer hqp_x" {
			t.Errorf("got Authorization %q", r.Header.Get("Authorization"))
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	c, err := New(srv.URL+"/", " hqp_x ")
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Send(context.Background(), Report{Mon: ptb.Mon{Dex: 492, Form: "sky", Shiny: true}, Name: "Shaymin"}); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"dex": 492.0, "form": "sky", "shiny": true, "name": "Shaymin"}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s: got %v, want %v (%v)", k, got[k], v, got)
		}
	}
}

func TestErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"error":"dex must be an integer 0-1025"}`))
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "t")
	err := c.Send(context.Background(), Report{})
	var e *Error
	if !errors.As(err, &e) || e.Status != 400 || e.Text != "dex must be an integer 0-1025" {
		t.Fatalf("got %v", err)
	}
}

func TestNewRefusesClearTextToAnotherHost(t *testing.T) {
	for _, bad := range []string{"", "office.example.com", "ftp://x", "http://office.example.com"} {
		if _, err := New(bad, "t"); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	for _, good := range []string{"https://office.example.com", "http://localhost:8080", "http://127.0.0.1:8080/"} {
		if _, err := New(good, "t"); err != nil {
			t.Errorf("%q refused: %v", good, err)
		}
	}
}
