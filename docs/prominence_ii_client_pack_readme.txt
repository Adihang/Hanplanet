Hanplanet Prominence II: Hasturian Era client pack
===================================================

===================================================
한국어 설치 안내
===================================================

이 모드팩은 Minecraft 1.20.1과 Fabric Loader 0.18.4 기준입니다.
Forge는 사용하지 않습니다. 모드팩 설치 기능이 있는 Fabric 호환 런처에서
manifest.json의 모드 파일을 설치한 뒤, 아래 방식으로 overrides 내용을 적용하세요.

1. Fabric 설치

   1) 공식 Fabric 설치 프로그램을 실행합니다.
   2) Minecraft version에서 1.20.1을 선택합니다.
   3) Loader version에서 0.18.4를 선택합니다.
   4) Client를 선택하고 설치합니다.

   Fabric 설치 프로그램:
   https://fabricmc.net/use/installer/

2. 모드팩 압축 해제

   Hanplanet_Prominence_II_v3.9.27_ko.zip을 임의의 위치에 압축 해제합니다.
   압축을 푼 폴더 안에는 manifest.json, overrides 폴더,
   HANPLANET_KOREAN_INSTALL.txt 등이 있습니다.

3. Fabric 프로필의 게임 폴더 확인

   기본 게임 폴더는 다음과 같습니다.

   macOS:
   ~/Library/Application Support/minecraft

   Windows:
   %AppData%\\.minecraft

   런처에서 별도 게임 폴더를 지정했다면 해당 Fabric 프로필의 게임 폴더를 사용합니다.

4. overrides 내용 덮어쓰기

   압축 해제한 모드팩의 overrides 폴더를 엽니다.
   overrides 폴더 자체를 .minecraft 안에 넣지 말고,
   overrides 폴더 안의 모든 파일과 폴더를 게임 폴더에 복사해 병합합니다.
   같은 이름의 파일을 덮어쓸지 묻는 경우 덮어쓰기를 선택합니다.

   예시:

   overrides/mods/*          -> .minecraft/mods/
   overrides/config/*        -> .minecraft/config/
   overrides/resourcepacks/* -> .minecraft/resourcepacks/
   overrides/shaderpacks/*   -> .minecraft/shaderpacks/
   overrides/kubejs/*        -> .minecraft/kubejs/
   overrides/options.txt     -> .minecraft/options.txt

   즉, .minecraft/overrides/ 폴더가 새로 생기면 잘못 복사한 것입니다.

5. 모드 파일 설치

   manifest.json에 정의된 기본 Prominence II 모드 파일은 Fabric 호환 런처의
   모드팩 가져오기 기능으로 설치합니다. 런처가 overrides를 자동 적용하지 않는
   경우에는 4번의 방식으로 직접 덮어씁니다.

   manifest.json 또는 modlist.html을 .minecraft 폴더에 복사할 필요는 없습니다.

6. 한국어 리소스팩 확인

   한국어 리소스팩 파일 이름은 다음과 같습니다.

   resourcepacks/Prominence_II_3.9.27_Korean.zip

   기본 options.txt에 한국어가 활성화되어 있습니다. 게임에서 적용되지 않으면
   Options > Resource Packs에서 Prominence II Korean 리소스팩을 활성화하고,
   Language에서 한국어(ko_kr)를 선택합니다.

7. 실행 및 서버 접속

   Minecraft Launcher에서 Fabric Loader 1.20.1 프로필을 선택하고 실행합니다.
   서버 주소에 다음을 입력합니다.

   rlc.hanplanet.com

   서버의 실제 포트는 25566이며, 도메인 SRV 설정으로 기본 주소만 입력해도
   연결되도록 구성되어 있습니다. 연결되지 않으면 rlc.hanplanet.com:25566을
   직접 입력하세요.

   서버: Prominence II: Hasturian Era v3.9.27
   Minecraft: 1.20.1
   Loader: Fabric 0.18.4
   포함 의존성: Architectury 9.2.14 (Fabric), Fabric API 0.92.7+1.20.1

문제 해결

- Fabric Loader가 아닌 Forge 프로필로 실행하지 마세요.
- 게임 버전은 반드시 1.20.1을 사용하세요.
- 모드가 없다는 오류가 나오면 manifest 모드를 Fabric 호환 런처로 먼저 설치했는지 확인하세요.
- 설정과 리소스팩이 적용되지 않으면 overrides 폴더 자체가 아니라 그 안의 내용을 복사했는지 확인하세요.


===================================================
English installation guide
===================================================

This pack is for Minecraft 1.20.1 with Fabric Loader 0.18.4.
It uses Fabric, not Forge. Use a Fabric-compatible launcher that can install
the mod files listed in manifest.json, then apply the overrides as described below.

1. Install Fabric

   1) Open the official Fabric installer.
   2) Select Minecraft version 1.20.1.
   3) Select Loader version 0.18.4.
   4) Select Client and install it.

   Fabric installer:
   https://fabricmc.net/use/installer/

2. Extract the pack

   Extract Hanplanet_Prominence_II_v3.9.27_ko.zip to any temporary location.
   The extracted folder contains manifest.json, an overrides folder,
   and HANPLANET_KOREAN_INSTALL.txt.

3. Find the Fabric profile game directory

   Default game directories:

   macOS:
   ~/Library/Application Support/minecraft

   Windows:
   %AppData%\\.minecraft

   If your launcher uses a custom game directory, use the directory assigned
   to the Fabric profile instead.

4. Merge the overrides contents

   Open the extracted overrides folder.
   Do not copy the overrides folder itself into .minecraft.
   Copy every file and folder inside overrides into the game directory and merge them.
   Choose Replace when asked whether existing files should be overwritten.

   Examples:

   overrides/mods/*          -> .minecraft/mods/
   overrides/config/*        -> .minecraft/config/
   overrides/resourcepacks/* -> .minecraft/resourcepacks/
   overrides/shaderpacks/*   -> .minecraft/shaderpacks/
   overrides/kubejs/*        -> .minecraft/kubejs/
   overrides/options.txt     -> .minecraft/options.txt

   If .minecraft/overrides/ is created, the folder was copied at the wrong level.

5. Install the mod files

   Install the base Prominence II mod files listed in manifest.json using the
   modpack import feature of a Fabric-compatible launcher. If the launcher does
   not apply overrides automatically, merge them manually using step 4.

   Do not copy manifest.json or modlist.html into the .minecraft directory.

6. Check the Korean resource pack

   The Korean resource pack is:

   resourcepacks/Prominence_II_3.9.27_Korean.zip

   options.txt enables Korean by default. If it is not active, open
   Options > Resource Packs, enable Prominence II Korean, and select Korean
   (ko_kr) under Language.

7. Launch and connect

   Select the Fabric Loader 1.20.1 profile in Minecraft Launcher and launch it.
   Enter this server address:

   rlc.hanplanet.com

   The server uses port 25566. DNS SRV is configured so the hostname normally
   works without a port. If it does not connect, enter rlc.hanplanet.com:25566.

   Server: Prominence II: Hasturian Era v3.9.27
   Minecraft: 1.20.1
   Loader: Fabric 0.18.4
   Included dependencies: Architectury 9.2.14 (Fabric), Fabric API 0.92.7+1.20.1

Troubleshooting

- Do not launch a Forge profile. Use Fabric Loader.
- Use Minecraft 1.20.1 exactly.
- If a mod is missing, install the manifest mods through a Fabric-compatible launcher.
- If settings or resources are missing, copy the contents of overrides, not the overrides folder itself.


Korean translation patch:
https://moru.gg/ko/pack/b54d6892-0e88-4917-b002-cb01938e564b
