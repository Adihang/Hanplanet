package main

import (
	"bytes"
	"encoding/base64"
	"encoding/gob"
	"fmt"
	"os"
	"strconv"
)

func main() {
	if len(os.Args) < 4 {
		panic("usage: forgejo_session_blob <uid> <username> <hasTwoFactorAuth>")
	}

	uid, err := strconv.ParseInt(os.Args[1], 10, 64)
	if err != nil {
		panic(err)
	}

	hasTwoFactorAuth, err := strconv.ParseBool(os.Args[3])
	if err != nil {
		panic(err)
	}

	payload := map[interface{}]interface{}{
		"uid":                 uid,
		"uname":               os.Args[2],
		"userHasTwoFactorAuth": hasTwoFactorAuth,
	}

	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(payload); err != nil {
		panic(err)
	}

	fmt.Print(base64.StdEncoding.EncodeToString(buf.Bytes()))
}
