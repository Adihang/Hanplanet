//go:build windows

package main

import "encoding/binary"

// appIcon은 16x16 HanDrive 아이콘 ICO 바이트입니다.
// 실행 시 파란색(#0055B8) 단색으로 생성됩니다.
var appIcon = makeICO(0x00, 0x55, 0xB8) // R, G, B

// makeICO는 단색 16×16 ICO 파일을 메모리에서 생성합니다.
// BGRA 픽셀 데이터 + AND 마스크를 포함한 표준 ICO 구조입니다.
func makeICO(r, g, b byte) []byte {
	const (
		w = 16
		h = 16
	)

	// BGRA 픽셀 데이터 (하단→상단 순, Windows BMP 규칙)
	pixels := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		pixels[i*4+0] = b    // Blue
		pixels[i*4+1] = g    // Green
		pixels[i*4+2] = r    // Red
		pixels[i*4+3] = 0xFF // Alpha (불투명)
	}

	// AND 마스크: 모두 0 = 완전 불투명
	// 행당 크기 = ((w + 31) / 32) * 4 = 4 bytes
	andMask := make([]byte, 4*h) // 64 bytes

	bitmapSize := 40 + len(pixels) + len(andMask) // 40+1024+64 = 1128

	ico := make([]byte, 0, 6+16+bitmapSize)
	b4 := make([]byte, 4)

	// ── ICONDIR (6 bytes) ────────────────────────────────────────────────────
	ico = append(ico, 0x00, 0x00) // reserved
	ico = append(ico, 0x01, 0x00) // type: ICO
	ico = append(ico, 0x01, 0x00) // count: 1

	// ── ICONDIRENTRY (16 bytes) ──────────────────────────────────────────────
	ico = append(ico, byte(w), byte(h)) // width, height
	ico = append(ico, 0x00, 0x00)       // colorCount, reserved
	ico = append(ico, 0x01, 0x00)       // planes
	ico = append(ico, 0x20, 0x00)       // bitCount: 32

	binary.LittleEndian.PutUint32(b4, uint32(bitmapSize))
	ico = append(ico, b4...)

	binary.LittleEndian.PutUint32(b4, 22) // imageOffset = 6+16
	ico = append(ico, b4...)

	// ── BITMAPINFOHEADER (40 bytes) ──────────────────────────────────────────
	bih := make([]byte, 40)
	binary.LittleEndian.PutUint32(bih[0:], 40)          // biSize
	binary.LittleEndian.PutUint32(bih[4:], w)           // biWidth
	binary.LittleEndian.PutUint32(bih[8:], h*2)         // biHeight (XOR+AND 합산)
	binary.LittleEndian.PutUint16(bih[12:], 1)          // biPlanes
	binary.LittleEndian.PutUint16(bih[14:], 32)         // biBitCount
	binary.LittleEndian.PutUint32(bih[20:], uint32(len(pixels))) // biSizeImage
	ico = append(ico, bih...)

	ico = append(ico, pixels...)
	ico = append(ico, andMask...)
	return ico
}
