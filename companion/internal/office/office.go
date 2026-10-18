// Package office talks to the poketoken plugin of a Home Quarters office with the member's app token.
package office

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/christphe/hq-poketoken-plugin/companion/internal/ptb"
)

// Plugin is the plugin's name in the office.
const Plugin = "poketoken"

// Report is what POST /pokemon takes.
type Report struct {
	ptb.Mon
	Name string `json:"name"`
}

// Client calls one office.
type Client struct {
	Server string
	Token  string
	HTTP   *http.Client
}

// New checks the address and returns a client for it.
func New(server, token string) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(server), "/"))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, fmt.Errorf("the office address must look like https://office.example.com")
	}
	if u.Scheme == "http" && !isLocal(u.Hostname()) {
		return nil, fmt.Errorf("use https: the token would travel in clear text")
	}
	return &Client{Server: u.String(), Token: strings.TrimSpace(token), HTTP: &http.Client{Timeout: 15 * time.Second}}, nil
}

func isLocal(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// Error is an answer other than 2xx.
type Error struct {
	Status int
	Text   string
}

func (e *Error) Error() string {
	switch e.Status {
	case http.StatusUnauthorized:
		return "the office refused the token (401): create a new one in Plugins > PokeToken"
	case http.StatusNotFound:
		return "the poketoken plugin is not running in this office (404)"
	case http.StatusTooManyRequests:
		return "too many requests (429), retrying later"
	}
	if e.Text != "" {
		return fmt.Sprintf("the office answered %d: %s", e.Status, e.Text)
	}
	return fmt.Sprintf("the office answered %d", e.Status)
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Server+"/plugins/"+Plugin+"/api"+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		var e struct{ Error string }
		_ = json.Unmarshal(b, &e)
		return &Error{Status: res.StatusCode, Text: e.Error}
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

// Send reports the Pokémon PokeTokenBar is raising.
func (c *Client) Send(ctx context.Context, r Report) error {
	return c.do(ctx, http.MethodPost, "/pokemon", r, nil)
}

// Clear tells the office to show nothing.
func (c *Client) Clear(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/clear", struct{}{}, nil)
}

// Shown is what the office shows for the member now.
type Shown struct {
	Current *Report `json:"current"`
	Hidden  bool    `json:"hidden"`
}

// Get asks the office what it shows (also a way to test the address and the token).
func (c *Client) Get(ctx context.Context) (Shown, error) {
	var s Shown
	err := c.do(ctx, http.MethodGet, "/pokemon", nil, &s)
	return s, err
}
