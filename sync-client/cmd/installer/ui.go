//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

// ── 레이아웃 상수 ──────────────────────────────────────────────────────────────

const (
	winW    = 526  // 전체 창 너비 (클라이언트)
	winH    = 396  // 전체 창 높이 (클라이언트)
	hdrH    = 78   // 헤더 높이
	footerH = 58   // 푸터 높이
	bodyY   = hdrH + 1
	bodyH   = winH - hdrH - 1 - footerH - 1
	footerY = bodyY + bodyH + 1 // = 340

	padX = 28 // 본문 좌우 여백
	padY = 18 // 본문 상하 여백

	// COLORREF = 0x00BBGGRR
	clrBlue    uintptr = 0x00B85500 // #0055B8
	clrDkBlue  uintptr = 0x00A04400 // #0044A0
	clrFooter  uintptr = 0x00F5F5F5 // 밝은 회색
	clrSep     uintptr = 0x00D8D8D8 // 구분선
	clrWhite   uintptr = 0x00FFFFFF
	clrSuccess uintptr = 0x00228B22 // 성공 초록색
	clrError   uintptr = 0x001919CC // 오류 빨간색

	// Win32 window/control styles
	wsChild       = 0x40000000
	wsVisible     = 0x10000000
	wsTabStop     = 0x00010000
	wsBorder      = 0x00800000
	wsVScroll     = 0x00200000
	esAutoHScroll = 0x0080
	esMultiLine   = 0x0004
	esReadOnly    = 0x0800
	esAutoVScroll = 0x0040
	bsPushButton    = 0x00000000
	bsDefPushButton = 0x00000001
	bsAutoCheckBox  = 0x00000003
	ssLeft        = 0x00000000
	pbsSmooth     = 0x01

	// PB 메시지
	pbmSetRange32 = 0x0406
	pbmSetPos     = 0x0402

	// 공통 Win32 메시지
	wmCreate         uint32 = 0x0001
	wmDestroy        uint32 = 0x0002
	wmPaint          uint32 = 0x000F
	wmClose          uint32 = 0x0010
	wmCommand        uint32 = 0x0111
	wmSetFont        uint32 = 0x0030
	wmGetTextLength  uint32 = 0x000E
	emSetSel         uint32 = 0x00B1
	emReplaceSel     uint32 = 0x00C2
	emScrollCaret    uint32 = 0x00B7
	wmCtlColorStatic uint32 = 0x0138
	wmCtlColorEdit   uint32 = 0x0133
	wmCtlColorBtn    uint32 = 0x0135

	// 커스텀 메시지
	wmProgress uint32 = 0x0401 // wParam=pct(0-100), lParam=msgID
	wmDone     uint32 = 0x0402 // wParam=0(ok)/1(err), lParam=msgID

	swShow = 5
	swHide = 0

	dtLeft      = 0x0000
	dtWordBreak = 0x0010
	dtSingleLine = 0x0020
	dtVCenter   = 0x0004
	dtNoClip    = 0x0100
	dtEndEllipsis = 0x8000

	transparent = 1

	fwBold   = 700
	fwNormal = 400

	smCXScreen = 0
	smCYScreen = 1

	swpNoSize     = 0x0001
	swpNoMove     = 0x0002
	swpNoZOrder   = 0x0004
	swpNoActivate = 0x0010

	// Control IDs
	idBtnCancel = 1001
	idBtnBack   = 1002
	idBtnNext   = 1003
	idInstDir   = 2001
	idServerURL = 2002
	idSyncDir   = 2003
	idProgress  = 2004
	idStatusLbl = 2005
	idLogBox    = 2006
	idChkStart  = 2007

	iccProgressBar = 0x00000020
)

// ── DLL 프로시저 ──────────────────────────────────────────────────────────────

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	comctl32 = syscall.NewLazyDLL("comctl32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	pRegisterClassEx    = user32.NewProc("RegisterClassExW")
	pCreateWindowEx     = user32.NewProc("CreateWindowExW")
	pDefWindowProc      = user32.NewProc("DefWindowProcW")
	pGetMessage         = user32.NewProc("GetMessageW")
	pTranslateMessage   = user32.NewProc("TranslateMessage")
	pDispatchMessage    = user32.NewProc("DispatchMessageW")
	pPostQuitMessage    = user32.NewProc("PostQuitMessage")
	pPostMessage        = user32.NewProc("PostMessageW")
	pSendMessage        = user32.NewProc("SendMessageW")
	pShowWindow         = user32.NewProc("ShowWindow")
	pUpdateWindow       = user32.NewProc("UpdateWindow")
	pDestroyWindow      = user32.NewProc("DestroyWindow")
	pSetWindowText      = user32.NewProc("SetWindowTextW")
	pEnableWindow       = user32.NewProc("EnableWindow")
	pBeginPaint         = user32.NewProc("BeginPaint")
	pEndPaint           = user32.NewProc("EndPaint")
	pFillRect           = user32.NewProc("FillRect")
	pDrawText           = user32.NewProc("DrawTextW")
	pLoadCursor         = user32.NewProc("LoadCursorW")
	pLoadIcon           = user32.NewProc("LoadIconW")
	pMessageBox         = user32.NewProc("MessageBoxW")
	pGetClientRect      = user32.NewProc("GetClientRect")
	pGetWindowRect      = user32.NewProc("GetWindowRect")
	pSetWindowPos       = user32.NewProc("SetWindowPos")
	pGetSystemMetrics   = user32.NewProc("GetSystemMetrics")
	pAdjustWindowRect   = user32.NewProc("AdjustWindowRectEx")
	pInvalidateRect     = user32.NewProc("InvalidateRect")
	pSetFocus           = user32.NewProc("SetFocus")

	pCreateSolidBrush = gdi32.NewProc("CreateSolidBrush")
	pCreateFont       = gdi32.NewProc("CreateFontW")
	pDeleteObject     = gdi32.NewProc("DeleteObject")
	pSelectObject     = gdi32.NewProc("SelectObject")
	pSetBkMode        = gdi32.NewProc("SetBkMode")
	pSetTextColor     = gdi32.NewProc("SetTextColor")
	pGetStockObject   = gdi32.NewProc("GetStockObject")

	pInitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")
	pGetModuleHandle      = kernel32.NewProc("GetModuleHandleW")
)

// ── Win32 구조체 ──────────────────────────────────────────────────────────────

type wndClassEx struct {
	Size        uint32
	Style       uint32
	WndProc     uintptr
	ClsExtra    int32
	WndExtra    int32
	Instance    uintptr
	Icon        uintptr
	Cursor      uintptr
	Background  uintptr
	MenuName    *uint16
	ClassName   *uint16
	IconSm      uintptr
}

type rect struct{ Left, Top, Right, Bottom int32 }

type paintStruct struct {
	HDC     uintptr
	FErase  int32
	RcPaint rect
	_       [32]byte
}

type msg struct {
	HWnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

type iccEx struct {
	Size uint32
	ICC  uint32
}

// ── 마법사 전역 상태 ──────────────────────────────────────────────────────────

var wiz struct {
	hwnd      uintptr
	page      int
	isUpdate  bool
	installing int32 // atomic

	installDir string
	serverURL  string
	syncDir    string
	installErr string // 설치 오류 메시지

	// GDI 리소스
	hInstance  uintptr
	hdrBrush   uintptr
	footBrush  uintptr
	sepBrush   uintptr
	whiteBrush uintptr
	hFontBig   uintptr // 헤더 제목 폰트
	hFontSub   uintptr // 헤더 부제목 폰트
	hFontGui   uintptr // 일반 UI 폰트
	hFontBold  uintptr // 굵은 레이블 폰트

	// 헤더 텍스트 (페이지별 변경)
	hdrTitle    string
	hdrSubtitle string

	// 항상 표시되는 버튼
	btnCancel uintptr
	btnBack   uintptr
	btnNext   uintptr

	// 페이지 0 – 환영
	p0Title uintptr
	p0Desc  uintptr

	// 페이지 1 – 설정 (신규 설치)
	p1Lbl1 uintptr
	p1Ed1  uintptr // install dir
	p1Lbl2 uintptr
	p1Ed2  uintptr // server URL
	p1Lbl3 uintptr
	p1Ed3  uintptr // sync dir
	p1Chk  uintptr // auto-start

	// 페이지 2 – 진행 중
	p2Status   uintptr
	p2Progress uintptr
	p2Log      uintptr

	// 페이지 3 – 완료
	p3Msg    uintptr
	p3Launch uintptr // checkbox: HanDrive 시작
}

// 크로스-고루틴 메시지 문자열 전달용
var (
	wizMsgMu  sync.Mutex
	wizMsgMap = map[uint64]string{}
	wizMsgSeq uint64
)

func storeMsg(s string) uintptr {
	wizMsgMu.Lock()
	wizMsgSeq++
	id := wizMsgSeq
	wizMsgMap[id] = s
	wizMsgMu.Unlock()
	return uintptr(id)
}

func loadMsg(id uintptr) string {
	wizMsgMu.Lock()
	s := wizMsgMap[uint64(id)]
	delete(wizMsgMap, uint64(id))
	wizMsgMu.Unlock()
	return s
}

// ── 헬퍼 함수 ────────────────────────────────────────────────────────────────

func u16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func sendMsg(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
	r, _, _ := pSendMessage.Call(hwnd, uintptr(msg), wp, lp)
	return r
}

func showCtrl(hwnd uintptr, show bool) {
	sw := uintptr(swHide)
	if show {
		sw = swShow
	}
	pShowWindow.Call(hwnd, sw)
}

func enableCtrl(hwnd uintptr, en bool) {
	v := uintptr(0)
	if en {
		v = 1
	}
	pEnableWindow.Call(hwnd, v)
}

func setCtrlText(hwnd uintptr, text string) {
	pSetWindowText.Call(hwnd, uintptr(unsafe.Pointer(u16(text))))
}

func setFont(hwnd, hFont uintptr) {
	sendMsg(hwnd, wmSetFont, hFont, 1)
}

func fillRectColor(hdc uintptr, r *rect, brush uintptr) {
	pFillRect.Call(hdc, uintptr(unsafe.Pointer(r)), brush)
}

func drawTxt(hdc uintptr, text string, r *rect, flags uint32) {
	ptr := u16(text)
	pDrawText.Call(hdc, uintptr(unsafe.Pointer(ptr)), ^uintptr(0),
		uintptr(unsafe.Pointer(r)), uintptr(flags))
}

// makeCtrl은 child 컨트롤을 생성합니다 (초기 숨김 상태).
func makeCtrl(parent uintptr, cls, text string, style uintptr, x, y, w, h int32, id int) uintptr {
	hwnd, _, _ := pCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(u16(cls))),
		uintptr(unsafe.Pointer(u16(text))),
		style|wsChild, // visible 아님 - showPage에서 처리
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		parent, uintptr(id), wiz.hInstance, 0,
	)
	return hwnd
}

// makeCtrlV는 child 컨트롤을 생성합니다 (즉시 표시 – 버튼용).
func makeCtrlV(parent uintptr, cls, text string, style uintptr, x, y, w, h int32, id int) uintptr {
	hwnd, _, _ := pCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(u16(cls))),
		uintptr(unsafe.Pointer(u16(text))),
		style|wsChild|wsVisible,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		parent, uintptr(id), wiz.hInstance, 0,
	)
	return hwnd
}

func appendLog(text string) {
	if wiz.p2Log == 0 {
		return
	}
	line := text + "\r\n"
	ptr := u16(line)
	length := sendMsg(wiz.p2Log, wmGetTextLength, 0, 0)
	sendMsg(wiz.p2Log, emSetSel, length, length)
	sendMsg(wiz.p2Log, emReplaceSel, 0, uintptr(unsafe.Pointer(ptr)))
	sendMsg(wiz.p2Log, emScrollCaret, 0, 0)
}

// ── 페이지 전환 ───────────────────────────────────────────────────────────────

type pageControls struct {
	ctrls []uintptr
}

func allPageCtrls() [][]uintptr {
	return [][]uintptr{
		{wiz.p0Title, wiz.p0Desc},
		{wiz.p1Lbl1, wiz.p1Ed1, wiz.p1Lbl2, wiz.p1Ed2, wiz.p1Lbl3, wiz.p1Ed3, wiz.p1Chk},
		{wiz.p2Status, wiz.p2Progress, wiz.p2Log},
		{wiz.p3Msg, wiz.p3Launch},
	}
}

func showPage(n int) {
	wiz.page = n
	pages := allPageCtrls()
	for i, ctrls := range pages {
		show := i == n
		for _, h := range ctrls {
			showCtrl(h, show)
		}
	}

	// 헤더 텍스트 업데이트
	titles := []string{
		"HanDrive 설치 마법사",
		"설치 구성",
		func() string {
			if wiz.isUpdate {
				return "업데이트 중"
			}
			return "설치 중"
		}(),
		func() string {
			if wiz.installErr != "" {
				return "설치 실패"
			}
			if wiz.isUpdate {
				return "업데이트 완료"
			}
			return "설치 완료"
		}(),
	}
	subs := []string{
		func() string {
			if wiz.isUpdate {
				return "HanDrive를 최신 버전으로 업데이트합니다."
			}
			return "설치 마법사에 오신 것을 환영합니다."
		}(),
		"설치 경로와 서버 설정을 입력해 주세요.",
		"잠시 기다려 주세요...",
		func() string {
			if wiz.installErr != "" {
				return wiz.installErr
			}
			if wiz.isUpdate {
				return "HanDrive가 최신 버전으로 업데이트되었습니다."
			}
			return "HanDrive가 성공적으로 설치되었습니다."
		}(),
	}
	wiz.hdrTitle = titles[n]
	wiz.hdrSubtitle = subs[n]
	pInvalidateRect.Call(wiz.hwnd, 0, 1)

	updateButtons(n)
}

func updateButtons(page int) {
	switch page {
	case 0:
		setCtrlText(wiz.btnCancel, "취소")
		setCtrlText(wiz.btnBack, "< 이전")
		setCtrlText(wiz.btnNext, "다음 >")
		enableCtrl(wiz.btnBack, false)
		enableCtrl(wiz.btnNext, true)
		enableCtrl(wiz.btnCancel, true)
	case 1:
		setCtrlText(wiz.btnCancel, "취소")
		setCtrlText(wiz.btnBack, "< 이전")
		setCtrlText(wiz.btnNext, "설치")
		enableCtrl(wiz.btnBack, true)
		enableCtrl(wiz.btnNext, true)
		enableCtrl(wiz.btnCancel, true)
	case 2: // 설치 중 – 모든 버튼 비활성화
		setCtrlText(wiz.btnCancel, "취소")
		setCtrlText(wiz.btnBack, "< 이전")
		setCtrlText(wiz.btnNext, "설치 중...")
		enableCtrl(wiz.btnBack, false)
		enableCtrl(wiz.btnNext, false)
		enableCtrl(wiz.btnCancel, false)
	case 3: // 완료
		setCtrlText(wiz.btnCancel, "닫기")
		setCtrlText(wiz.btnBack, "< 이전")
		setCtrlText(wiz.btnNext, "마침")
		enableCtrl(wiz.btnBack, false)
		enableCtrl(wiz.btnNext, true)
		enableCtrl(wiz.btnCancel, true)
	}
}

// ── 컨트롤 생성 ───────────────────────────────────────────────────────────────

func createAllControls(hwnd uintptr) {
	// 폰트를 모든 컨트롤에 적용하는 헬퍼
	applyFont := func(h uintptr, font ...uintptr) {
		f := wiz.hFontGui
		if len(font) > 0 {
			f = font[0]
		}
		setFont(h, f)
	}

	// ── 상단 고정 버튼 (항상 표시) ────────────────────────────────────────────
	btnY := int32(footerY + (footerH-32)/2)
	wiz.btnCancel = makeCtrlV(hwnd, "BUTTON", "취소", bsPushButton|wsTabStop, 10, btnY, 82, 32, idBtnCancel)
	wiz.btnBack = makeCtrlV(hwnd, "BUTTON", "< 이전", bsPushButton|wsTabStop, int32(winW)-10-82-8-82, btnY, 82, 32, idBtnBack)
	wiz.btnNext = makeCtrlV(hwnd, "BUTTON", "다음 >", bsDefPushButton|wsTabStop, int32(winW)-10-82, btnY, 82, 32, idBtnNext)
	applyFont(wiz.btnCancel)
	applyFont(wiz.btnBack)
	applyFont(wiz.btnNext)

	bY := int32(bodyY)

	// ── 페이지 0: 환영 ────────────────────────────────────────────────────────
	welcomeTitle := "이 마법사는 HanDrive를 컴퓨터에 설치합니다.\n\n계속하려면 [다음]을 클릭하세요."
	if wiz.isUpdate {
		welcomeTitle = "HanDrive의 최신 버전이 준비되었습니다.\n\n업데이트를 시작하려면 [다음]을 클릭하세요."
	}
	wiz.p0Title = makeCtrl(hwnd, "STATIC",
		"Hanplanet HanDrive",
		ssLeft, padX, bY+padY, int32(winW)-padX*2, 28, 0)
	wiz.p0Desc = makeCtrl(hwnd, "STATIC",
		welcomeTitle,
		ssLeft, padX, bY+padY+36, int32(winW)-padX*2, int32(bodyH)-padY*2-36, 0)
	applyFont(wiz.p0Title, wiz.hFontBold)
	applyFont(wiz.p0Desc)

	// ── 페이지 1: 설치 구성 ───────────────────────────────────────────────────
	lx := int32(padX)
	lw := int32(winW) - padX*2
	ey := func(row int) int32 { return bY + int32(padY) + int32(row)*62 }

	home, _ := os.UserHomeDir()
	wiz.p1Lbl1 = makeCtrl(hwnd, "STATIC", "설치 위치", ssLeft, lx, ey(0), lw, 16, 0)
	wiz.p1Ed1 = makeCtrl(hwnd, "EDIT",
		defaultInstallDir(),
		esAutoHScroll|wsBorder|wsTabStop, lx, ey(0)+20, lw, 24, idInstDir)
	wiz.p1Lbl2 = makeCtrl(hwnd, "STATIC", "서버 URL", ssLeft, lx, ey(1), lw, 16, 0)
	wiz.p1Ed2 = makeCtrl(hwnd, "EDIT", "https://www.hanplanet.com",
		esAutoHScroll|wsBorder|wsTabStop, lx, ey(1)+20, lw, 24, idServerURL)
	wiz.p1Lbl3 = makeCtrl(hwnd, "STATIC", "동기화 폴더", ssLeft, lx, ey(2), lw, 16, 0)
	wiz.p1Ed3 = makeCtrl(hwnd, "EDIT", filepath.Join(home, "HanDrive"),
		esAutoHScroll|wsBorder|wsTabStop, lx, ey(2)+20, lw, 24, idSyncDir)
	wiz.p1Chk = makeCtrl(hwnd, "BUTTON", "Windows 시작 시 자동으로 동기화 실행",
		bsAutoCheckBox|wsTabStop, lx, ey(3)+4, lw, 22, idChkStart)
	sendMsg(wiz.p1Chk, 0x00F1 /*BM_SETCHECK*/, 1, 0) // 기본 체크
	applyFont(wiz.p1Lbl1, wiz.hFontBold)
	applyFont(wiz.p1Ed1)
	applyFont(wiz.p1Lbl2, wiz.hFontBold)
	applyFont(wiz.p1Ed2)
	applyFont(wiz.p1Lbl3, wiz.hFontBold)
	applyFont(wiz.p1Ed3)
	applyFont(wiz.p1Chk)

	// ── 페이지 2: 진행 중 ─────────────────────────────────────────────────────
	wiz.p2Status = makeCtrl(hwnd, "STATIC", "준비 중...",
		ssLeft, padX, bY+padY, int32(winW)-padX*2, 20, idStatusLbl)
	wiz.p2Progress = makeCtrl(hwnd, "msctls_progress32", "",
		pbsSmooth, padX, bY+padY+26, int32(winW)-padX*2, 22, idProgress)
	sendMsg(wiz.p2Progress, pbmSetRange32, 0, 100)
	logH := int32(bodyH) - int32(padY) - 26 - 22 - 10 - int32(padY)
	wiz.p2Log = makeCtrl(hwnd, "EDIT", "",
		esMultiLine|esReadOnly|esAutoVScroll|wsVScroll|wsBorder,
		padX, bY+padY+54, int32(winW)-padX*2, logH, idLogBox)
	applyFont(wiz.p2Status)
	applyFont(wiz.p2Progress)
	applyFont(wiz.p2Log)

	// ── 페이지 3: 완료 ────────────────────────────────────────────────────────
	wiz.p3Msg = makeCtrl(hwnd, "STATIC",
		"HanDrive 설치가 완료되었습니다!\n\n시작 메뉴 > Hanplanet > HanDrive 를 실행하거나\n아래 체크박스를 선택하고 [마침]을 클릭하세요.",
		ssLeft, padX, bY+padY, int32(winW)-padX*2, int32(bodyH)-padY*3-24, 0)
	wiz.p3Launch = makeCtrl(hwnd, "BUTTON", "HanDrive 지금 시작",
		bsAutoCheckBox|wsTabStop, padX, bY+int32(bodyH)-padY-26, int32(winW)-padX*2, 24, 0)
	sendMsg(wiz.p3Launch, 0x00F1, 1, 0) // 기본 체크
	applyFont(wiz.p3Msg)
	applyFont(wiz.p3Launch)
}

// ── 윈도우 프로시저 ───────────────────────────────────────────────────────────

func wndProc(hwnd, message uintptr, wParam, lParam uintptr) uintptr {
	switch uint32(message) {

	case wmCreate:
		wiz.hwnd = hwnd
		// 브러시/폰트 생성
		wiz.hdrBrush, _, _ = pCreateSolidBrush.Call(clrBlue)
		wiz.footBrush, _, _ = pCreateSolidBrush.Call(clrFooter)
		wiz.sepBrush, _, _ = pCreateSolidBrush.Call(clrSep)
		wiz.whiteBrush, _, _ = pGetStockObject.Call(0 /*WHITE_BRUSH*/)
		// 폰트: header big (17px bold)
		wiz.hFontBig, _, _ = pCreateFont.Call(
			uintptr(0xFFFFFFFF-17+1), // -17
			0, 0, 0, fwBold, 0, 0, 0,
			1, 0, 0, 5, 0x22, // CLEARTYPE_QUALITY, FF_SWISS|DEFAULT_PITCH
			uintptr(unsafe.Pointer(u16("Segoe UI"))),
		)
		// 폰트: header subtitle (12px)
		wiz.hFontSub, _, _ = pCreateFont.Call(
			uintptr(0xFFFFFFFF-12+1), // -12
			0, 0, 0, fwNormal, 0, 0, 0,
			1, 0, 0, 5, 0x22,
			uintptr(unsafe.Pointer(u16("Segoe UI"))),
		)
		// 폰트: body GUI (13px regular)
		wiz.hFontGui, _, _ = pCreateFont.Call(
			uintptr(0xFFFFFFFF-13+1), // -13
			0, 0, 0, fwNormal, 0, 0, 0,
			1, 0, 0, 5, 0x22,
			uintptr(unsafe.Pointer(u16("Segoe UI"))),
		)
		// 폰트: label bold (13px bold)
		wiz.hFontBold, _, _ = pCreateFont.Call(
			uintptr(0xFFFFFFFF-13+1),
			0, 0, 0, fwBold, 0, 0, 0,
			1, 0, 0, 5, 0x22,
			uintptr(unsafe.Pointer(u16("Segoe UI"))),
		)
		createAllControls(hwnd)
		showPage(0)
		return 0

	case wmPaint:
		var ps paintStruct
		hdc, _, _ := pBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))

		// 헤더 파란 배경
		fillRectColor(hdc, &rect{0, 0, winW, hdrH}, wiz.hdrBrush)
		// 헤더/본문 구분선
		fillRectColor(hdc, &rect{0, hdrH, winW, hdrH + 1}, wiz.sepBrush)
		// 푸터 배경
		fillRectColor(hdc, &rect{0, footerY, winW, winH}, wiz.footBrush)
		// 푸터 상단 구분선
		fillRectColor(hdc, &rect{0, footerY - 1, winW, footerY}, wiz.sepBrush)

		// 헤더 제목 (흰색, 큰 폰트)
		old, _, _ := pSelectObject.Call(hdc, wiz.hFontBig)
		pSetBkMode.Call(hdc, transparent)
		pSetTextColor.Call(hdc, clrWhite)
		titleR := rect{padX, 12, winW - padX, 12 + 28}
		drawTxt(hdc, wiz.hdrTitle, &titleR, dtLeft|dtSingleLine|dtVCenter|dtNoClip)

		// 헤더 부제목 (흰색 70%, 작은 폰트)
		pSelectObject.Call(hdc, wiz.hFontSub)
		pSetTextColor.Call(hdc, 0x00D0C0B0) // 연한 흰색
		subR := rect{padX + 2, 44, winW - padX, 44 + 22}
		drawTxt(hdc, wiz.hdrSubtitle, &subR, dtLeft|dtSingleLine|dtNoClip)

		pSelectObject.Call(hdc, old)
		pEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0

	// 정적 컨트롤 배경을 흰색으로 (본문 영역)
	case wmCtlColorStatic:
		pSetBkMode.Call(wParam, transparent)
		return wiz.whiteBrush

	case wmCtlColorEdit:
		return wiz.whiteBrush

	case wmCommand:
		ctrlID := wParam & 0xFFFF
		switch ctrlID {
		case idBtnNext:
			handleNext()
		case idBtnBack:
			handleBack()
		case idBtnCancel:
			handleCancel(hwnd)
		}
		return 0

	case wmProgress:
		pct := wParam
		text := loadMsg(lParam)
		sendMsg(wiz.p2Progress, pbmSetPos, pct, 0)
		if text != "" {
			setCtrlText(wiz.p2Status, text)
			appendLog(fmt.Sprintf("[%d%%] %s", pct, text))
		}
		return 0

	case wmDone:
		atomic.StoreInt32(&wiz.installing, 0)
		if wParam == 1 { // 오류
			wiz.installErr = loadMsg(lParam)
		}
		showPage(3)
		// 완료 페이지 메시지 업데이트
		if wiz.installErr != "" {
			setCtrlText(wiz.p3Msg,
				"설치 중 오류가 발생했습니다:\n\n"+wiz.installErr+
					"\n\n창을 닫고 다시 시도해 주세요.")
		} else if wiz.isUpdate {
			setCtrlText(wiz.p3Msg,
				"HanDrive가 최신 버전으로 업데이트되었습니다!\n\n"+
					"동기화가 자동으로 재시작됩니다.")
			showCtrl(wiz.p3Launch, false)
		} else {
			setCtrlText(wiz.p3Msg,
				"HanDrive 설치가 완료되었습니다!\n\n"+
					"시작 메뉴 > Hanplanet > HanDrive 에서 실행하거나,\n"+
					"아래 체크박스를 선택하고 [마침]을 클릭하세요.")
		}
		pInvalidateRect.Call(hwnd, 0, 1)
		return 0

	case wmClose:
		if atomic.LoadInt32(&wiz.installing) != 0 {
			pMessageBox.Call(hwnd,
				uintptr(unsafe.Pointer(u16("설치가 진행 중입니다. 완료될 때까지 기다려 주세요."))),
				uintptr(unsafe.Pointer(u16("HanDrive 설치"))),
				0x00000030, // MB_ICONWARNING
			)
			return 0
		}
		pDestroyWindow.Call(hwnd)
		return 0

	case wmDestroy:
		// GDI 리소스 해제
		for _, h := range []uintptr{wiz.hdrBrush, wiz.footBrush, wiz.sepBrush,
			wiz.hFontBig, wiz.hFontSub, wiz.hFontGui, wiz.hFontBold} {
			if h != 0 {
				pDeleteObject.Call(h)
			}
		}
		pPostQuitMessage.Call(0)
		return 0
	}

	r, _, _ := pDefWindowProc.Call(hwnd, message, wParam, lParam)
	return r
}

// ── 버튼 핸들러 ───────────────────────────────────────────────────────────────

func getEditText(hwnd uintptr) string {
	l := sendMsg(hwnd, wmGetTextLength, 0, 0)
	if l == 0 {
		return ""
	}
	buf := make([]uint16, l+1)
	pSendMessage.Call(hwnd, 0x000D /*WM_GETTEXT*/, l+1,
		uintptr(unsafe.Pointer(&buf[0])))
	return syscall.UTF16ToString(buf)
}

func handleNext() {
	switch wiz.page {
	case 0:
		if wiz.isUpdate {
			// 업데이트: 설정 페이지 건너뜀 → 직접 진행 페이지로
			startProgress(true)
		} else {
			showPage(1)
			pSetFocus.Call(wiz.p1Ed1)
		}
	case 1:
		// 입력값 수집 및 검증
		wiz.installDir = getEditText(wiz.p1Ed1)
		wiz.serverURL = getEditText(wiz.p1Ed2)
		wiz.syncDir = getEditText(wiz.p1Ed3)
		if wiz.installDir == "" || wiz.serverURL == "" || wiz.syncDir == "" {
			pMessageBox.Call(wiz.hwnd,
				uintptr(unsafe.Pointer(u16("모든 항목을 입력해 주세요."))),
				uintptr(unsafe.Pointer(u16("HanDrive 설치"))),
				0x00000030,
			)
			return
		}
		startProgress(false)
	case 3:
		// 마침 버튼
		launch := sendMsg(wiz.p3Launch, 0x00F0 /*BM_GETCHECK*/, 0, 0) == 1
		if launch && wiz.installErr == "" {
			exePath := filepath.Join(wiz.installDir, "handrive.exe")
			exePtr, _ := syscall.UTF16PtrFromString(exePath)
			verbPtr, _ := syscall.UTF16PtrFromString("open")
			shell32 := syscall.NewLazyDLL("shell32.dll")
			shell32.NewProc("ShellExecuteW").Call(
				0, uintptr(unsafe.Pointer(verbPtr)), uintptr(unsafe.Pointer(exePtr)),
				0, 0, 5,
			)
		}
		pDestroyWindow.Call(wiz.hwnd)
	}
}

func handleBack() {
	if wiz.page == 1 {
		showPage(0)
	}
}

func handleCancel(hwnd uintptr) {
	if wiz.page == 3 {
		pDestroyWindow.Call(hwnd)
		return
	}
	r, _, _ := pMessageBox.Call(hwnd,
		uintptr(unsafe.Pointer(u16("설치를 취소하시겠습니까?"))),
		uintptr(unsafe.Pointer(u16("HanDrive 설치"))),
		0x00000024, // MB_YESNO | MB_ICONQUESTION
	)
	if r == 6 { // IDYES
		pDestroyWindow.Call(hwnd)
	}
}

func startProgress(isUpdate bool) {
	showPage(2)
	atomic.StoreInt32(&wiz.installing, 1)

	hwnd := wiz.hwnd
	report := func(pct int, msg string) {
		id := storeMsg(msg)
		pPostMessage.Call(hwnd, uintptr(wmProgress), uintptr(pct), id)
	}
	done := func(err error) {
		atomic.StoreInt32(&wiz.installing, 0)
		if err != nil {
			id := storeMsg(err.Error())
			pPostMessage.Call(hwnd, uintptr(wmDone), 1, id)
		} else {
			pPostMessage.Call(hwnd, uintptr(wmDone), 0, 0)
		}
	}

	if isUpdate {
		installDir := defaultInstallDir()
		go func() {
			done(RunUpdate(installDir, report))
		}()
	} else {
		autoStart := sendMsg(wiz.p1Chk, 0x00F0, 0, 0) == 1
		params := InstallParams{
			InstallDir: wiz.installDir,
			ServerURL:  wiz.serverURL,
			SyncDir:    wiz.syncDir,
			AutoStart:  autoStart,
		}
		go func() {
			done(RunInstall(params, report))
		}()
	}
}

// ── RunWizard: 메인 진입점 ────────────────────────────────────────────────────

func RunWizard() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// comctl32 초기화 (진행 표시줄 사용)
	icc := iccEx{Size: uint32(unsafe.Sizeof(iccEx{})), ICC: iccProgressBar}
	pInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))

	// 모듈 핸들
	wiz.hInstance, _, _ = pGetModuleHandle.Call(0)

	// 기존 설치 감지
	exePath := defaultInstallDir()
	exePath = filepath.Join(exePath, "handrive.exe")
	wiz.isUpdate = isAlreadyInstalled(exePath)
	if wiz.isUpdate {
		wiz.installDir = defaultInstallDir()
		wiz.hdrTitle = "HanDrive 업데이트"
		wiz.hdrSubtitle = "HanDrive를 최신 버전으로 업데이트합니다."
	} else {
		wiz.hdrTitle = "HanDrive 설치 마법사"
		wiz.hdrSubtitle = "설치 마법사에 오신 것을 환영합니다."
	}

	// 윈도우 클래스 등록
	className := u16("HanDriveSetup")
	cb := syscall.NewCallback(wndProc)
	cursor, _, _ := pLoadCursor.Call(0, idcArrow)
	appIcon, _, _ := pLoadIcon.Call(wiz.hInstance, 1)
	wcex := wndClassEx{
		Style:      0x0002 | 0x0001, // CS_HREDRAW | CS_VREDRAW
		WndProc:    cb,
		Instance:   wiz.hInstance,
		Background: uintptr(wiz.whiteBrush) + 1, // 나중에 WM_CREATE에서 사용하므로 임시
		Cursor:     cursor,
		Icon:       appIcon,
		IconSm:     appIcon,
		ClassName:  className,
	}
	wcex.Size = uint32(unsafe.Sizeof(wcex))
	// 배경 브러시: COLOR_WINDOW+1 = 6
	wcex.Background = 6
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wcex)))

	// 창 크기 계산 (클라이언트 영역 winW×winH)
	winStyle := uintptr(0x00CA0000) // WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX
	adjR := rect{0, 0, winW, winH}
	pAdjustWindowRect.Call(uintptr(unsafe.Pointer(&adjR)), winStyle, 0, 0)
	totalW := adjR.Right - adjR.Left
	totalH := adjR.Bottom - adjR.Top

	// 화면 중앙 위치 계산
	screenW, _, _ := pGetSystemMetrics.Call(smCXScreen)
	screenH, _, _ := pGetSystemMetrics.Call(smCYScreen)
	x := (int32(screenW) - totalW) / 2
	y := (int32(screenH) - totalH) / 2

	title := "HanDrive 설치"
	if wiz.isUpdate {
		title = "HanDrive 업데이트"
	}

	hwnd, _, _ := pCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(u16(title))),
		winStyle,
		uintptr(x), uintptr(y), uintptr(totalW), uintptr(totalH),
		0, 0, wiz.hInstance, 0,
	)
	if hwnd == 0 {
		return
	}

	pShowWindow.Call(hwnd, swShow)
	pUpdateWindow.Call(hwnd)

	// 메시지 루프
	var m msg
	for {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if r == 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}

	// 설치 후 메모리에서 exe 실행 (p3Launch 체크 시 handleNext에서 처리)
	_ = exec.Command
}

const idcArrow = 32512
