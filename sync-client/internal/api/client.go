package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
)

type progressReader struct {
	reader     io.Reader
	total      int64
	read       int64
	onProgress func(transferred, total int64)
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.reader.Read(buf)
	if n > 0 {
		p.read += int64(n)
		if p.onProgress != nil {
			p.onProgress(p.read, p.total)
		}
	}
	return n, err
}

// ServerFile은 서버의 SyncFile 응답입니다.
type ServerFile struct {
	ID               string `json:"id"`
	Path             string `json:"path"`
	Size             int64  `json:"size"`
	Hash             string `json:"hash"`
	Version          int64  `json:"version"`
	ClientModifiedAt int64  `json:"client_modified_at"`
	ServerModifiedAt int64  `json:"server_modified_at"`
	Deleted          bool   `json:"deleted"`
}

type ListFilesResponse struct {
	Files         []ServerFile `json:"files"`
	ExcludedPaths []string     `json:"excluded_paths"`
}

// ChangeEntry는 /api/sync/changes 응답의 변경 항목입니다.
type ChangeEntry struct {
	ID        int64  `json:"id"`
	FileID    string `json:"file_id"`
	Path      string `json:"path"`
	OldPath   string `json:"old_path"`
	Type      string `json:"type"` // CREATE / UPDATE / DELETE / MOVE
	Version   int64  `json:"version"`
	CreatedAt int64  `json:"created_at"`
}

// InitUploadRequest는 init-upload 요청 바디입니다.
type InitUploadRequest struct {
	Path             string `json:"path"`
	Size             int64  `json:"size"`
	Hash             string `json:"hash"`
	ClientModifiedAt int64  `json:"client_modified_at"`
}

// InitUploadResponse는 init-upload 응답입니다.
type InitUploadResponse struct {
	SkipUpload bool   `json:"skip_upload"`
	UploadURL  string `json:"upload_url"`
	FileID     string `json:"file_id"`
	UploadID   string `json:"upload_id"`
	StorageKey string `json:"storage_key"`
}

// CompleteUploadRequest는 complete 요청 바디입니다.
type CompleteUploadRequest struct {
	UploadID        string `json:"upload_id"`
	ExpectedVersion int64  `json:"expected_version"`
}

// ListFiles는 서버의 전체 파일 목록을 반환합니다.
func (c *Client) ListFiles() ([]ServerFile, error) {
	result, err := c.ListFilesWithExclusions()
	if err != nil {
		return nil, err
	}
	return result.Files, nil
}

func (c *Client) ListFilesWithExclusions() (*ListFilesResponse, error) {
	var result ListFilesResponse
	if err := c.doJSON("GET", "/api/sync/files", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// InitUpload는 presigned 업로드 URL을 발급받습니다.
func (c *Client) InitUpload(req InitUploadRequest) (*InitUploadResponse, error) {
	body, _ := json.Marshal(req)
	var resp InitUploadResponse
	if err := c.doJSON("POST", "/api/sync/files/init-upload", body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// UploadToPresignedURL은 presigned URL에 파일을 직접 PUT 업로드합니다.
func (c *Client) UploadToPresignedURL(uploadURL string, data []byte) error {
	return c.UploadToPresignedURLWithProgress(uploadURL, data, nil)
}

func (c *Client) UploadToPresignedURLWithProgress(uploadURL string, data []byte, onProgress func(transferred, total int64)) error {
	parsedURL, _ := url.Parse(uploadURL)
	log.Printf("[api] upload url host=%s bytes=%d", parsedURL.Host, len(data))
	reader := &progressReader{
		reader:     bytes.NewReader(data),
		total:      int64(len(data)),
		onProgress: onProgress,
	}
	req, err := http.NewRequest("PUT", uploadURL, reader)
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(data))
	resp, err := c.doAbsolute(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	log.Printf("[api] upload response host=%s status=%d", parsedURL.Host, resp.StatusCode)
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("presigned upload failed HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// CompleteUpload는 업로드 완료를 서버에 알립니다.
func (c *Client) CompleteUpload(req CompleteUploadRequest) (*ServerFile, error) {
	body, _ := json.Marshal(req)
	var file ServerFile
	if err := c.doJSON("POST", "/api/sync/files/complete", body, &file); err != nil {
		return nil, err
	}
	return &file, nil
}

// DownloadURL은 presigned 다운로드 URL을 반환합니다.
func (c *Client) DownloadURL(fileID string) (string, error) {
	var result struct {
		DownloadURL string `json:"download_url"`
	}
	if err := c.doJSON("GET", "/api/sync/files/"+fileID+"/download-url", nil, &result); err != nil {
		return "", err
	}
	return result.DownloadURL, nil
}

// DownloadFile은 presigned URL에서 파일을 다운로드합니다.
func (c *Client) DownloadFile(downloadURL string) ([]byte, error) {
	return c.DownloadFileWithProgress(downloadURL, nil)
}

func (c *Client) DownloadFileWithProgress(downloadURL string, onProgress func(transferred, total int64)) ([]byte, error) {
	parsedURL, _ := url.Parse(downloadURL)
	log.Printf("[api] download url host=%s", parsedURL.Host)
	req, err := http.NewRequest("GET", downloadURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.doAbsolute(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	log.Printf("[api] download response host=%s status=%d", parsedURL.Host, resp.StatusCode)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("download failed HTTP %d", resp.StatusCode)
	}
	total := resp.ContentLength
	var out bytes.Buffer
	buf := make([]byte, 64*1024)
	var transferred int64
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			transferred += int64(n)
			_, _ = out.Write(buf[:n])
			if onProgress != nil {
				onProgress(transferred, total)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	return out.Bytes(), nil
}

// DeleteFile은 서버 파일을 soft delete합니다.
func (c *Client) DeleteFile(fileID string) error {
	return c.doJSON("DELETE", "/api/sync/files/"+fileID, nil, nil)
}

// MoveFile은 파일 경로를 변경합니다.
func (c *Client) MoveFile(fileID, targetPath string, expectedVersion int64) (*ServerFile, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"target_path":      targetPath,
		"expected_version": expectedVersion,
	})
	var file ServerFile
	if err := c.doJSON("PATCH", "/api/sync/files/"+fileID+"/move", body, &file); err != nil {
		return nil, err
	}
	return &file, nil
}

// QuotaItem은 용량 구분 항목입니다.
type QuotaItem struct {
	Label   string  `json:"label"`
	Color   string  `json:"color"`
	Display string  `json:"display"`
	Bytes   int64   `json:"bytes"`
	Percent float64 `json:"percent"`
}

// UserInfo는 /api/sync/me 응답입니다.
type UserInfo struct {
	Username     string      `json:"username"`
	UsedBytes    int64       `json:"quota_used_bytes"`
	TotalBytes   int64       `json:"quota_total_bytes"`
	Percent      float64     `json:"quota_percent"`
	UsedDisplay  string      `json:"quota_used_display"`
	TotalDisplay string      `json:"quota_total_display"`
	FreeDisplay  string      `json:"quota_free_display"`
	FreePercent  float64     `json:"quota_free_percent"`
	Breakdown    []QuotaItem `json:"quota_breakdown"`
	ExcludedPaths []string   `json:"excluded_paths"`
}

// GetMe는 로그인 계정 정보와 용량 현황을 반환합니다.
func (c *Client) GetMe() (*UserInfo, error) {
	var info UserInfo
	if err := c.doJSON("GET", "/api/sync/me", nil, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// GetStorageMode는 서버의 현재 storage mode ("ssd" 또는 "hdd")를 반환합니다.
func (c *Client) GetStorageMode() (string, error) {
	var result struct {
		Mode string `json:"mode"`
	}
	if err := c.doJSON("GET", "/api/sync/storage-mode", nil, &result); err != nil {
		return "", err
	}
	return result.Mode, nil
}

// GetChanges는 cursor 이후의 변경 이력을 반환합니다.
func (c *Client) GetChanges(cursor int64) ([]ChangeEntry, int64, error) {
	changes, nextCursor, _, err := c.GetChangesWithExclusions(cursor)
	return changes, nextCursor, err
}

func (c *Client) GetChangesWithExclusions(cursor int64) ([]ChangeEntry, int64, []string, error) {
	path := "/api/sync/changes?" + url.Values{"cursor": {strconv.FormatInt(cursor, 10)}}.Encode()
	var result struct {
		Changes       []ChangeEntry `json:"changes"`
		NextCursor    int64         `json:"next_cursor"`
		ExcludedPaths []string      `json:"excluded_paths"`
	}
	if err := c.doJSON("GET", path, nil, &result); err != nil {
		return nil, cursor, nil, err
	}
	return result.Changes, result.NextCursor, result.ExcludedPaths, nil
}
