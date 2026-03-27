.PHONY: build build-windows build-windows-msi build-mac popup-preview clean windows-icons

VERSION ?= 0.1.0
RSRC ?= $(shell go env GOPATH)/bin/rsrc

windows-icons:
	$(RSRC) -arch amd64 -ico cmd/handrive/hanplanet.ico -o cmd/handrive/rsrc_windows_amd64.syso
	$(RSRC) -arch amd64 -ico cmd/installer/hanplanet.ico -o cmd/installer/rsrc_windows_amd64.syso

# ── 현재 플랫폼용 빌드 ────────────────────────────────────────────────────────
build:
	go build -ldflags="-s -w" -o handrive ./cmd/handrive

# ── Windows amd64 설치파일 빌드 ───────────────────────────────────────────────
# 결과물: HanDrive Setup.exe (더블클릭으로 설치, handrive.exe 내장)
build-windows:
	@echo ">>> [0/3] Windows 아이콘 리소스 생성 중..."
	$(MAKE) windows-icons

	@echo ">>> [1/3] handrive.exe (GUI 데몬) 빌드 중..."
	bash ./scripts/build_handrive_windows.sh

	@echo ">>> [2/3] HanDrive Setup.exe 빌드 중..."
	cp handrive.exe cmd/installer/handrive.exe
	cp uninstall.ps1 cmd/installer/uninstall.ps1
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
		go build -ldflags="-s -w -H=windowsgui" -o "HanDrive Setup.exe" ./cmd/installer

	@echo ">>> 완료: 'HanDrive Setup.exe'"

# ── Windows amd64 MSI 빌드 ────────────────────────────────────────────────────
# 결과물: HanDrive-$(VERSION).msi (per-user 설치, handrive.exe 포함)
build-windows-msi:
	@command -v wixl >/dev/null 2>&1 || { echo "wixl not found. Install msitools first."; exit 1; }

	@echo ">>> [0/3] Windows 아이콘 리소스 생성 중..."
	$(MAKE) windows-icons

	@echo ">>> [1/3] handrive.exe (GUI 데몬) 빌드 중..."
	bash ./scripts/build_handrive_windows.sh

	@echo ">>> [2/3] WiX source 생성 및 MSI 빌드 중..."
	sed 's/@VERSION@/$(VERSION)/g' packaging/windows-msi/handrive.wxs.in > packaging/windows-msi/handrive.wxs
	wixl -o "HanDrive-$(VERSION).msi" packaging/windows-msi/handrive.wxs

	@echo ">>> 완료: 'HanDrive-$(VERSION).msi'"

# ── macOS arm64 빌드 ──────────────────────────────────────────────────────────
build-mac:
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
		go build -ldflags="-s -w" -o handrive-mac ./cmd/handrive

popup-preview:
	go run ./cmd/popup-preview

clean:
	rm -f handrive handrive.exe handrive-mac "HanDrive Setup.exe" "HanDrive-$(VERSION).msi"
	rm -f cmd/installer/handrive.exe cmd/installer/uninstall.ps1
	rm -f cmd/handrive/rsrc_windows_amd64.syso cmd/installer/rsrc_windows_amd64.syso
	rm -f packaging/windows-msi/handrive.wxs
