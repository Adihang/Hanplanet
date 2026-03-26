package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

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
	var result struct {
		Files []ServerFile `json:"files"`
	}
	if err := c.doJSON("GET", "/api/sync/files", nil, &result); err != nil {
		return nil, err
	}
	return result.Files, nil
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
	req, err := http.NewRequest("PUT", uploadURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(data))
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
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
	resp, err := c.http.Get(downloadURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("download failed HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
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
	Username      string      `json:"username"`
	UsedBytes     int64       `json:"quota_used_bytes"`
	TotalBytes    int64       `json:"quota_total_bytes"`
	Percent       float64     `json:"quota_percent"`
	UsedDisplay   string      `json:"quota_used_display"`
	TotalDisplay  string      `json:"quota_total_display"`
	FreeDisplay   string      `json:"quota_free_display"`
	FreePercent   float64     `json:"quota_free_percent"`
	Breakdown     []QuotaItem `json:"quota_breakdown"`
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
	path := "/api/sync/changes?" + url.Values{"cursor": {strconv.FormatInt(cursor, 10)}}.Encode()
	var result struct {
		Changes    []ChangeEntry `json:"changes"`
		NextCursor int64         `json:"next_cursor"`
	}
	if err := c.doJSON("GET", path, nil, &result); err != nil {
		return nil, cursor, err
	}
	return result.Changes, result.NextCursor, nil
}
