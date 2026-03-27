// Package api는 Django Sync API HTTP 클라이언트를 제공합니다.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Tokens는 access + refresh 토큰 쌍입니다.
type Tokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// tokenStore는 토큰을 메모리 + 파일에 저장합니다.
type tokenStore struct {
	mu           sync.RWMutex
	accessToken  string
	refreshToken string
	tokensPath   string
}

func newTokenStore(tokensPath string) *tokenStore {
	return &tokenStore{tokensPath: tokensPath}
}

func (ts *tokenStore) load() error {
	data, err := os.ReadFile(ts.tokensPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 첫 실행
		}
		return err
	}
	var t Tokens
	if err := json.Unmarshal(data, &t); err != nil {
		return err
	}
	ts.mu.Lock()
	ts.accessToken = t.AccessToken
	ts.refreshToken = t.RefreshToken
	ts.mu.Unlock()
	return nil
}

func (ts *tokenStore) save(t Tokens) error {
	ts.mu.Lock()
	ts.accessToken = t.AccessToken
	ts.refreshToken = t.RefreshToken
	ts.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(ts.tokensPath), 0700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(t, "", "  ")
	return os.WriteFile(ts.tokensPath, data, 0600)
}

func (ts *tokenStore) getAccess() string {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.accessToken
}

func (ts *tokenStore) getRefresh() string {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.refreshToken
}

// Client는 Django Sync API HTTP 클라이언트입니다.
type Client struct {
	serverURL string
	http      *http.Client
	tokens    *tokenStore
}

// NewClient는 새 API 클라이언트를 생성합니다.
func NewClient(serverURL, tokensPath string) *Client {
	c := &Client{
		serverURL: serverURL,
		http:      &http.Client{Timeout: 30 * time.Second},
		tokens:    newTokenStore(tokensPath),
	}
	_ = c.tokens.load()
	return c
}

// Login은 username/password로 토큰을 발급받고 저장합니다.
func (c *Client) Login(username, password string) error {
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	resp, err := c.http.Post(c.serverURL+"/api/sync/auth/token", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("login request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("login failed: HTTP %d", resp.StatusCode)
	}
	var t Tokens
	if err := json.NewDecoder(resp.Body).Decode(&t); err != nil {
		return fmt.Errorf("decode token response: %w", err)
	}
	return c.tokens.save(t)
}

// refreshAccess는 refresh token으로 access token을 갱신합니다.
func (c *Client) refreshAccess() error {
	refreshToken := c.tokens.getRefresh()
	if refreshToken == "" {
		return fmt.Errorf("no refresh token stored — please login first")
	}
	body, _ := json.Marshal(map[string]string{"refresh_token": refreshToken})
	resp, err := c.http.Post(c.serverURL+"/api/sync/auth/refresh", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("refresh request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("refresh failed: HTTP %d", resp.StatusCode)
	}
	var result struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}
	return c.tokens.save(Tokens{
		AccessToken:  result.AccessToken,
		RefreshToken: refreshToken,
	})
}

// do는 인증 헤더를 포함한 HTTP 요청을 전송합니다. 401 시 자동으로 token 갱신 후 재시도.
func (c *Client) do(method, path string, body []byte) (*http.Response, error) {
	for attempt := 0; attempt < 2; attempt++ {
		log.Printf("[api] %s %s attempt=%d body_bytes=%d", method, path, attempt+1, len(body))
		req, err := http.NewRequest(method, c.serverURL+path, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("Authorization", "Bearer "+c.tokens.getAccess())

		resp, err := c.http.Do(req)
		if err != nil {
			log.Printf("[api] %s %s failed: %v", method, path, err)
			return nil, err
		}
		if resp.StatusCode == 401 && attempt == 0 {
			log.Printf("[api] %s %s got 401, refreshing token", method, path)
			resp.Body.Close()
			if err := c.refreshAccess(); err != nil {
				return nil, fmt.Errorf("token refresh failed: %w", err)
			}
			continue
		}
		log.Printf("[api] %s %s status=%d", method, path, resp.StatusCode)
		return resp, nil
	}
	return nil, fmt.Errorf("authentication failed after token refresh")
}

// doJSON은 JSON 응답을 dst에 디코딩합니다.
func (c *Client) doJSON(method, path string, body []byte, dst interface{}) error {
	resp, err := c.do(method, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(raw))
	}
	if dst != nil {
		return json.Unmarshal(raw, dst)
	}
	return nil
}

func (c *Client) isSameServer(target *url.URL) bool {
	serverURL, err := url.Parse(c.serverURL)
	if err != nil || target == nil {
		return false
	}
	return serverURL.Scheme == target.Scheme && serverURL.Host == target.Host
}

func (c *Client) doAbsolute(req *http.Request) (*http.Response, error) {
	for attempt := 0; attempt < 2; attempt++ {
		if c.isSameServer(req.URL) {
			req.Header.Set("Authorization", "Bearer "+c.tokens.getAccess())
		}
		resp, err := c.http.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == 401 && attempt == 0 && c.isSameServer(req.URL) {
			log.Printf("[api] absolute %s %s got 401, refreshing token", req.Method, req.URL.String())
			resp.Body.Close()
			if err := c.refreshAccess(); err != nil {
				return nil, fmt.Errorf("token refresh failed: %w", err)
			}
			continue
		}
		return resp, nil
	}
	return nil, fmt.Errorf("authentication failed after token refresh")
}
