//go:build windows

package main

import _ "embed"

// appIcon은 Hanplanet 사이트 아이콘과 동일한 ICO 바이트입니다.
//
//go:embed hanplanet.ico
var appIcon []byte
