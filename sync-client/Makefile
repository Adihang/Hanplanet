.PHONY: build build-windows build-mac clean

VERSION ?= 0.1.0

# ── 현재 플랫폼용 빌드 ────────────────────────────────────────────────────────
build:
	go build -ldflags="-s -w" -o handrive ./cmd/handrive

# ── Windows amd64 설치파일 빌드 ───────────────────────────────────────────────
# 결과물: HanDrive Setup.exe (더블클릭으로 설치, handrive.exe 내장)
build-windows:
	@echo ">>> [1/3] handrive.exe (GUI 데몬) 빌드 중..."
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
		go build -ldflags="-s -w -H windowsgui" -o handrive.exe ./cmd/handrive

	@echo ">>> [2/3] HanDrive Setup.exe 빌드 중..."
	cp handrive.exe cmd/installer/handrive.exe
	cp uninstall.ps1 cmd/installer/uninstall.ps1
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
		go build -ldflags="-s -w -H windowsgui" -o "HanDrive Setup.exe" ./cmd/installer

	@echo ">>> 완료: 'HanDrive Setup.exe'"

# ── macOS arm64 빌드 ──────────────────────────────────────────────────────────
build-mac:
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
		go build -ldflags="-s -w" -o handrive-mac ./cmd/handrive

clean:
	rm -f handrive handrive.exe handrive-mac "HanDrive Setup.exe"
	rm -f cmd/installer/handrive.exe cmd/installer/uninstall.ps1
