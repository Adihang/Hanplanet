---

# 📘 handrive 개발 계획서 (v1.0)

---

# 1. 🎯 목표 정의

## 제품 목표

* OS 탐색기/Finder에서 사용하는 **클라우드 드라이브 서비스**
* Dropbox / OneDrive 1차 버전 수준

## 핵심 기능

* 파일 자동 동기화 (양방향)
* 계정 기반 파일 관리
* 대용량 파일 업로드/다운로드
* 충돌 처리

---

# 2. 🧠 전체 아키텍처

```text
[ Sync Client (Go) ]
   ├─ File Watcher
   ├─ Sync Engine
   ├─ Local DB (SQLite)
   └─ Network Layer
        ↓
[ Django API Server ]
   ├─ Auth (기존)
   ├─ File Metadata
   ├─ Sync API
   └─ Presigned URL 발급
        ↓
[ Object Storage (S3 / MinIO) ]
```

---

# 3. 🧩 시스템 구성 상세

---

## 3.1 Sync Client

### 역할

* 로컬 파일 감지
* 서버와 동기화
* 충돌 처리

---

### 내부 모듈

#### 1️⃣ Watcher

* 파일 생성/수정/삭제 감지
* OS별 구현

#### 2️⃣ Sync Queue

* 모든 작업을 큐로 관리
* retry / debounce 포함

#### 3️⃣ Sync Engine

* 업로드/다운로드 판단
* version 비교

#### 4️⃣ Local DB (SQLite)

```sql
CREATE TABLE files (
    path TEXT PRIMARY KEY,
    hash TEXT,
    size INTEGER,
    modified_at INTEGER,
    version TEXT
);

CREATE TABLE queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    path TEXT,
    retry INTEGER
);
```

---

## 3.2 Django 서버

### 역할

👉 “컨트롤 타워”

* 사용자 인증
* 파일 메타데이터 관리
* 변경 이력 관리
* presigned URL 발급

---

### 핵심 모델

```python
class File(models.Model):
    id = UUIDField(primary_key=True)
    user = ForeignKey(User)
    path = TextField()
    size = BigIntegerField()
    hash = CharField(max_length=64)
    version = CharField(max_length=32)
    storage_key = TextField()
    modified_at = BigIntegerField()
    deleted = BooleanField(default=False)
```

---

```python
class ChangeLog(models.Model):
    user = ForeignKey(User)
    path = TextField()
    type = CharField(max_length=10)  # CREATE/UPDATE/DELETE
    version = CharField(max_length=32)
    created_at = BigIntegerField()
```

---

```python
class UploadSession(models.Model):
    upload_id = CharField(max_length=100, primary_key=True)
    user = ForeignKey(User)
    path = TextField()
    size = BigIntegerField()
    created_at = BigIntegerField()
```

---

# 4. 🔥 API 설계

---

## 4.1 파일 목록

```http
GET /api/files?cursor=xxx
```

---

## 4.2 업로드 시작

```http
POST /api/files/init-upload
```

### response

```json
{
  "upload_url": "...",
  "file_id": "...",
  "version": "v1"
}
```

---

## 4.3 업로드 완료

```http
POST /api/files/complete
```

---

## 4.4 다운로드 URL

```http
GET /api/files/{id}/download-url
```

---

## 4.5 삭제

```http
DELETE /api/files/{id}
```

---

## 4.6 Sync (핵심)

```http
GET /api/sync?since=cursor
```

```json
{
  "changes": [
    {
      "type": "UPDATE",
      "path": "/docs/a.txt",
      "version": "v2"
    }
  ]
}
```

---

# 5. ☁️ 파일 저장 전략

## 방식

👉 S3 / MinIO + Presigned URL

---

## 업로드 흐름

```text
Client → Django (URL 요청)
      → S3 직접 업로드
      → Django 완료 요청
```

---

## 장점

* 서버 부하 최소화
* 확장성 확보

---

# 6. ⚡ Sync 알고리즘

---

## 업로드 조건

```text
local.modified_at > server.modified_at
```

---

## 다운로드 조건

```text
server.version != local.version
```

---

## 충돌 처리

```text
동시 수정 발생 →
file (conflict-user).txt 생성
```

---

# 7. 🧠 상태 관리

```text
IDLE → SCANNING → SYNCING → IDLE
```

---

# 8. 🚀 성능 전략

## 필수

* chunk upload
* parallel upload (3~5 threads)
* hash 비교
* debounce

---

## 선택

* lazy download
* CDN
* binary diff

---

# 9. 🔐 인증 구조

* 기존 Django 로그인 사용
* JWT 기반 API 인증

```http
Authorization: Bearer xxx
```

---

# 10. 🧪 개발 단계

---

## 🟢 1단계 (MVP, 1~2주)

* 파일 업로드 (단일 파일)
* 파일 목록
* sync polling
* watcher + upload only

---

## 🟡 2단계

* 다운로드 sync
* change_log 기반 동기화
* 충돌 처리

---

## 🔵 3단계

* chunk upload
* 병렬 처리
* 성능 최적화

---

## 🔴 4단계

* 선택적 동기화
* 공유 기능
* 휴지통

---

# 11. ⚠️ 리스크 & 대응

| 문제      | 대응                |
| ------- | ----------------- |
| 대용량 업로드 | chunk + presigned |
| 충돌      | version + rename  |
| 데이터 손실  | versioning        |
| 성능      | queue + 캐싱        |

---

# 12. 🧠 기술 스택

## 서버

* Django (API)
* PostgreSQL
* Redis (옵션)
* S3 / MinIO

## 클라이언트

* Go
* SQLite

---

# 🎯 최종 결론

> handrive = “Django + Sync Client + Object Storage” 구조

---

# 🔥 핵심 요약

* Django는 **메타 + 인증**
* 파일은 **S3**
* 클라이언트는 **Queue 기반 Sync 엔진**

---
