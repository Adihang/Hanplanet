//go:build windows

package main

import (
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	nWsChild        = 0x40000000
	nWsVisible      = 0x10000000
	nWsTabStop      = 0x00010000
	nWsBorder       = 0x00800000
	nWsClipSiblings = 0x04000000
	nWsClipChildren = 0x02000000
	nWsVScroll      = 0x00200000
	nWsCaption      = 0x00C00000
	nWsSysMenu      = 0x00080000
	nWsPopup        = 0x80000000
	nWsOverlapped   = 0x00000000
	nWsMinimizeBox  = 0x00020000
	nWsThickFrame   = 0x00040000
	nWsMaximizeBox  = 0x00010000

	nWsExToolWindow = 0x00000080
	nWsExTopmost    = 0x00000008

	nEsAutoHScroll = 0x0080
	nEsMultiLine   = 0x0004
	nEsReadOnly    = 0x0800
	nEsAutoVScroll = 0x0040

	nSsLeft       = 0x00000000
	nBsPushButton = 0x00000000

	nSwHide = 0
	nSwShow = 5

	nWmCreate         uint32 = 0x0001
	nWmDestroy        uint32 = 0x0002
	nWmClose          uint32 = 0x0010
	nWmCommand        uint32 = 0x0111
	nWmSetFont        uint32 = 0x0030
	nWmGetText        uint32 = 0x000D
	nWmGetTextLength  uint32 = 0x000E
	nWmNCLButtonDown  uint32 = 0x00A1
	nWmCtlColorEdit   uint32 = 0x0133
	nWmCtlColorBtn    uint32 = 0x0135
	nWmCtlColorStatic uint32 = 0x0138
	nWmApp            uint32 = 0x8000

	nSmCXScreen = 0
	nSmCYScreen = 1

	nHtCaption = 2

	nGwlStyle   = -16
	nGwlExStyle = -20

	nSpiGetWorkArea = 0x0030
	nGaRoot         = 2

	nSwpNoSize       = 0x0001
	nSwpNoMove       = 0x0002
	nSwpNoZOrder     = 0x0004
	nSwpFrameChanged = 0x0020
	nSwpShowWindow   = 0x0040

	nFwNormal          = 400
	nFwBold            = 700
	nTransparentBkMode = 1
)

var (
	nUser32   = syscall.NewLazyDLL("user32.dll")
	nGdi32    = syscall.NewLazyDLL("gdi32.dll")
	nKernel32 = syscall.NewLazyDLL("kernel32.dll")

	nRegisterClassEx      = nUser32.NewProc("RegisterClassExW")
	nCreateWindowEx       = nUser32.NewProc("CreateWindowExW")
	nDefWindowProc        = nUser32.NewProc("DefWindowProcW")
	nGetMessage           = nUser32.NewProc("GetMessageW")
	nTranslateMessage     = nUser32.NewProc("TranslateMessage")
	nDispatchMessage      = nUser32.NewProc("DispatchMessageW")
	nPostQuitMessage      = nUser32.NewProc("PostQuitMessage")
	nPostMessage          = nUser32.NewProc("PostMessageW")
	nSendMessage          = nUser32.NewProc("SendMessageW")
	nShowWindow           = nUser32.NewProc("ShowWindow")
	nUpdateWindow         = nUser32.NewProc("UpdateWindow")
	nDestroyWindow        = nUser32.NewProc("DestroyWindow")
	nSetWindowRgn         = nUser32.NewProc("SetWindowRgn")
	nSetWindowText        = nUser32.NewProc("SetWindowTextW")
	nEnableWindow         = nUser32.NewProc("EnableWindow")
	nGetWindowLongPtr     = nUser32.NewProc("GetWindowLongPtrW")
	nSetWindowLongPtr     = nUser32.NewProc("SetWindowLongPtrW")
	nSetWindowPos         = nUser32.NewProc("SetWindowPos")
	nReleaseCapture       = nUser32.NewProc("ReleaseCapture")
	nLoadCursor           = nUser32.NewProc("LoadCursorW")
	nGetCursorPos         = nUser32.NewProc("GetCursorPos")
	nGetSystemMetrics     = nUser32.NewProc("GetSystemMetrics")
	nAdjustWindowRect     = nUser32.NewProc("AdjustWindowRect")
	nSetForeground        = nUser32.NewProc("SetForegroundWindow")
	nSystemParametersInfo = nUser32.NewProc("SystemParametersInfoW")
	nGetForegroundWindow  = nUser32.NewProc("GetForegroundWindow")
	nGetAncestor          = nUser32.NewProc("GetAncestor")
	nGetWindowRect        = nUser32.NewProc("GetWindowRect")
	nIsChild              = nUser32.NewProc("IsChild")

	nCreateFont         = nGdi32.NewProc("CreateFontW")
	nDeleteObject       = nGdi32.NewProc("DeleteObject")
	nGetStockObject     = nGdi32.NewProc("GetStockObject")
	nCreateRoundRectRgn = nGdi32.NewProc("CreateRoundRectRgn")
	nCreateSolidBrush   = nGdi32.NewProc("CreateSolidBrush")
	nSetTextColor       = nGdi32.NewProc("SetTextColor")
	nSetBkColor         = nGdi32.NewProc("SetBkColor")
	nSetBkMode          = nGdi32.NewProc("SetBkMode")

	nGetModuleHandle = nKernel32.NewProc("GetModuleHandleW")
)

type nWndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type nMsg struct {
	HWnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

type nPoint struct {
	X int32
	Y int32
}

type nRect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

var (
	nMsgMu  sync.Mutex
	nMsgMap = map[uint64]string{}
	nMsgSeq uint64
)

func nStoreMsg(s string) uintptr {
	nMsgMu.Lock()
	defer nMsgMu.Unlock()
	nMsgSeq++
	nMsgMap[nMsgSeq] = s
	return uintptr(nMsgSeq)
}

func nLoadMsg(id uintptr) string {
	nMsgMu.Lock()
	defer nMsgMu.Unlock()
	s := nMsgMap[uint64(id)]
	delete(nMsgMap, uint64(id))
	return s
}

func nU16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func nSendMsg(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
	r, _, _ := nSendMessage.Call(hwnd, uintptr(msg), wp, lp)
	return r
}

func nSetText(hwnd uintptr, text string) {
	nSetWindowText.Call(hwnd, uintptr(unsafe.Pointer(nU16(text))))
}

func nGetText(hwnd uintptr) string {
	l := nSendMsg(hwnd, nWmGetTextLength, 0, 0)
	if l == 0 {
		return ""
	}
	buf := make([]uint16, l+1)
	nSendMessage.Call(hwnd, uintptr(nWmGetText), l+1, uintptr(unsafe.Pointer(&buf[0])))
	return syscall.UTF16ToString(buf)
}

func nMakeCtrl(parent uintptr, cls, text string, style uintptr, x, y, w, h int32, id int) uintptr {
	hwnd, _, _ := nCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(nU16(cls))),
		uintptr(unsafe.Pointer(nU16(text))),
		style|nWsChild|nWsVisible,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		parent, uintptr(id), 0, 0,
	)
	return hwnd
}

func nMakeFont(height int32, weight uintptr) uintptr {
	h, _, _ := nCreateFont.Call(
		uintptr(int32(-height)),
		0, 0, 0, weight, 0, 0, 0,
		1, 0, 0, 5, 0x22,
		uintptr(unsafe.Pointer(nU16("Segoe UI"))),
	)
	return h
}

func nApplyFont(hwnd, font uintptr) {
	nSendMsg(hwnd, nWmSetFont, font, 1)
}

func nRGB(r, g, b byte) uintptr {
	return uintptr(uint32(r) | uint32(g)<<8 | uint32(b)<<16)
}

func nSolidBrush(r, g, b byte) uintptr {
	h, _, _ := nCreateSolidBrush.Call(nRGB(r, g, b))
	return h
}

func nTextColor(hdc uintptr, r, g, b byte) {
	nSetTextColor.Call(hdc, nRGB(r, g, b))
}

func nBkColor(hdc uintptr, r, g, b byte) {
	nSetBkColor.Call(hdc, nRGB(r, g, b))
}

func nTransparentBk(hdc uintptr) {
	nSetBkMode.Call(hdc, nTransparentBkMode)
}

func nBringToFront(hwnd uintptr) {
	if hwnd != 0 {
		nShowWindow.Call(hwnd, nSwShow)
		nSetForeground.Call(hwnd)
	}
}

func nPopupPosition(width, height int32, style uintptr) (int32, int32, int32, int32) {
	rect := nRect{Left: 0, Top: 0, Right: width, Bottom: height}
	nAdjustWindowRect.Call(uintptr(unsafe.Pointer(&rect)), style, 0)
	totalW := rect.Right - rect.Left
	totalH := rect.Bottom - rect.Top

	var pt nPoint
	nGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	work := nRect{}
	ok, _, _ := nSystemParametersInfo.Call(nSpiGetWorkArea, 0, uintptr(unsafe.Pointer(&work)), 0)
	if ok == 0 {
		screenW, _, _ := nGetSystemMetrics.Call(nSmCXScreen)
		screenH, _, _ := nGetSystemMetrics.Call(nSmCYScreen)
		work.Right = int32(screenW)
		work.Bottom = int32(screenH)
	}
	const edgeGap int32 = 8
	const bottomGap int32 = 2
	x := work.Right - totalW - edgeGap
	y := work.Bottom - totalH - bottomGap
	if x < work.Left+edgeGap {
		x = work.Left + edgeGap
	}
	if y < work.Top+edgeGap {
		y = work.Top + edgeGap
	}
	return x, y, totalW, totalH
}

func nRunWindow(className, title string, width, height int32, wndProc uintptr) uintptr {
	result := make(chan uintptr, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		instance, _, _ := nGetModuleHandle.Call(0)
		cursor, _, _ := nLoadCursor.Call(0, 32512)
		class := nWndClassEx{
			Size:       uint32(unsafe.Sizeof(nWndClassEx{})),
			Style:      0x0002 | 0x0001,
			WndProc:    wndProc,
			Instance:   instance,
			Cursor:     cursor,
			Background: 6,
			ClassName:  nU16(className),
		}
		nRegisterClassEx.Call(uintptr(unsafe.Pointer(&class)))

		style := uintptr(nWsOverlapped | nWsCaption | nWsSysMenu | nWsMinimizeBox)
		x, y, totalW, totalH := nPopupPosition(width, height, style)
		hwnd, _, _ := nCreateWindowEx.Call(
			nWsExToolWindow|nWsExTopmost,
			uintptr(unsafe.Pointer(nU16(className))),
			uintptr(unsafe.Pointer(nU16(title))),
			style,
			uintptr(x), uintptr(y), uintptr(totalW), uintptr(totalH),
			0, 0, instance, 0,
		)
		result <- hwnd
		if hwnd == 0 {
			return
		}
		nShowWindow.Call(hwnd, nSwShow)
		nUpdateWindow.Call(hwnd)
		var m nMsg
		for {
			r, _, _ := nGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if r == 0 {
				break
			}
			nTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			nDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
		}
	}()
	return <-result
}

func nRoundWindow(hwnd uintptr, width, height, radius int32) {
	rgn, _, _ := nCreateRoundRectRgn.Call(
		0, 0,
		uintptr(width+1), uintptr(height+1),
		uintptr(radius), uintptr(radius),
	)
	if rgn != 0 {
		nSetWindowRgn.Call(hwnd, rgn, 1)
	}
}

func nRunPopupWindow(className, title string, width, height, radius int32, wndProc uintptr) uintptr {
	result := make(chan uintptr, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		instance, _, _ := nGetModuleHandle.Call(0)
		cursor, _, _ := nLoadCursor.Call(0, 32512)
		class := nWndClassEx{
			Size:       uint32(unsafe.Sizeof(nWndClassEx{})),
			Style:      0x0002 | 0x0001,
			WndProc:    wndProc,
			Instance:   instance,
			Cursor:     cursor,
			Background: 6,
			ClassName:  nU16(className),
		}
		nRegisterClassEx.Call(uintptr(unsafe.Pointer(&class)))

		style := uintptr(nWsPopup | nWsClipSiblings | nWsClipChildren)
		x, y, _, _ := nPopupPosition(width, height, 0)
		hwnd, _, _ := nCreateWindowEx.Call(
			nWsExToolWindow|nWsExTopmost,
			uintptr(unsafe.Pointer(nU16(className))),
			uintptr(unsafe.Pointer(nU16(title))),
			style,
			uintptr(x), uintptr(y), uintptr(width), uintptr(height),
			0, 0, instance, 0,
		)
		result <- hwnd
		if hwnd == 0 {
			return
		}
		nRoundWindow(hwnd, width, height, radius)
		nShowWindow.Call(hwnd, nSwShow)
		nUpdateWindow.Call(hwnd)
		var m nMsg
		for {
			r, _, _ := nGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if r == 0 {
				break
			}
			nTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			nDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
		}
	}()
	return <-result
}

func nGetWindowLong(hwnd uintptr, index int32) uintptr {
	r, _, _ := nGetWindowLongPtr.Call(hwnd, uintptr(index))
	return r
}

func nSetWindowLong(hwnd uintptr, index int32, value uintptr) {
	nSetWindowLongPtr.Call(hwnd, uintptr(index), value)
}

func nBeginWindowDrag(hwnd uintptr) {
	nReleaseCapture.Call()
	nSendMessage.Call(hwnd, uintptr(nWmNCLButtonDown), nHtCaption, 0)
}

func nStylePopupWindow(hwnd uintptr, width, height, radius int32) {
	if hwnd == 0 {
		return
	}
	style := uintptr(nWsPopup | nWsVisible | nWsClipChildren | nWsClipSiblings)
	exStyle := uintptr(nWsExToolWindow | nWsExTopmost)
	nSetWindowLong(hwnd, nGwlStyle, style)
	nSetWindowLong(hwnd, nGwlExStyle, exStyle)
	x, y, _, _ := nPopupPosition(width, height, 0)
	nShowWindow.Call(hwnd, nSwHide)
	nSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), uintptr(width), uintptr(height), nSwpNoZOrder|nSwpFrameChanged)
	nRoundWindow(hwnd, width, height, radius)
}

func nRevealPopupWindow(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	nShowWindow.Call(hwnd, nSwShow)
	nUpdateWindow.Call(hwnd)
	nBringToFront(hwnd)
}

func nResizeWindow(hwnd uintptr, width, height int32) {
	if hwnd == 0 {
		return
	}
	rect := nRect{}
	x, y := int32(0), int32(0)
	if ok, _, _ := nGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&rect))); ok != 0 {
		x = rect.Left
		y = rect.Top
	} else {
		x, y, _, _ = nPopupPosition(width, height, 0)
	}
	nSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), uintptr(width), uintptr(height), nSwpNoZOrder|nSwpFrameChanged|nSwpShowWindow)
}

func nPopupLosesFocus(hwnd uintptr) bool {
	if hwnd == 0 {
		return true
	}
	fg, _, _ := nGetForegroundWindow.Call()
	if fg == 0 {
		return true
	}
	if fg == hwnd {
		return false
	}
	if child, _, _ := nIsChild.Call(hwnd, fg); child != 0 {
		return false
	}
	root, _, _ := nGetAncestor.Call(fg, nGaRoot)
	return root != hwnd
}

func nWatchPopupDeactivation(hwnd uintptr, isOpen func() bool, onDeactivate func()) {
	go func() {
		time.Sleep(350 * time.Millisecond)
		ticker := time.NewTicker(120 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			if !isOpen() {
				return
			}
			if nPopupLosesFocus(hwnd) {
				onDeactivate()
				return
			}
		}
	}()
}
