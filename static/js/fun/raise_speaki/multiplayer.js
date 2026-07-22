(function () {
    'use strict';

    // bumpercar_spiky multiplayer 클라이언트 엔트리.
    // 캔버스 렌더링, 소켓 상태, 스킨 선택, 오디오, 모바일 컨트롤,
    // 사망/인카운터 UI까지 한 파일에서 다루는 큰 상태 머신이다.

    // data-game-client 루트가 없는 페이지에서는 즉시 종료한다.
    const root = document.querySelector('[data-game-client]');
    if (!root) {
        return;
    }

    const canvas = root.querySelector('[data-game-canvas]');
    const minimapCanvas = root.querySelector('[data-game-minimap]');
    const startOverlay = root.querySelector('[data-game-start-overlay]');
    const startButton = root.querySelector('[data-game-start]');
    const loadingOverlay = root.querySelector('[data-game-loading-overlay]');
    const loadingCaption = root.querySelector('[data-game-loading-caption]');
    const loadingSpinner = root.querySelector('[data-game-loading-spinner]');
    const loadingMainNode = root.querySelector('[data-game-loading-main]');
    const loadingTrailNodes = Array.from(root.querySelectorAll('[data-game-loading-trail]'));
    const startCharacterButton = root.querySelector('[data-game-skin-open]');
    const startCharacterImage = root.querySelector('[data-game-start-character-image]');
    const skinModal = root.querySelector('[data-game-skin-modal]');
    const skinModalCloseButton = root.querySelector('[data-game-skin-modal-close]');
    const skinListNode = root.querySelector('[data-game-skin-list]');
    const skinDetailNode = root.querySelector('[data-game-skin-detail]');
    const skinDetailIconNode = root.querySelector('[data-game-skin-detail-icon]');
    const skinDetailNameNode = root.querySelector('[data-game-skin-detail-name]');
    const skinDetailUnlockNode = root.querySelector('[data-game-skin-detail-unlock]');
    const skinDetailDescriptionNode = root.querySelector('[data-game-skin-detail-description]');
    const skinSelectButton = root.querySelector('[data-game-skin-select]');
    const connectionStatus = root.querySelector('[data-game-connection-status]');
    const defeatReceivedCountNode = root.querySelector('[data-game-defeat-received-count]');
    const defeatDealtCountNode = root.querySelector('[data-game-defeat-dealt-count]');
    const playerCountNode = root.querySelector('[data-game-player-count]');
    const selfIdNode = root.querySelector('[data-game-self-id]');
    const selfPositionNode = root.querySelector('[data-game-self-position]');
    const reconnectButton = root.querySelector('[data-game-reconnect]');
    const fullscreenToggles = Array.from(root.querySelectorAll('[data-game-fullscreen-toggle]'));
    const fullscreenExitButton = root.querySelector('[data-game-fullscreen-exit]');
    const topActions = root.querySelector('[data-game-top-actions]');
    const escMenuButton = root.querySelector('[data-game-escape-toggle]');
    const mobileControlsToggle = root.querySelector('[data-game-mobile-controls-toggle]');
    const mobileControls = root.querySelector('[data-game-mobile-controls]');
    const joystick = root.querySelector('[data-game-joystick]');
    const joystickKnob = root.querySelector('[data-game-joystick-knob]');
    const mobileBoostButton = root.querySelector('[data-game-mobile-boost]');
    const deathModal = root.querySelector('[data-game-death-modal]');
    const deathModalTitleNode = root.querySelector('[data-game-death-modal-title]');
    const deathModalRespawnButton = root.querySelector('[data-game-death-modal-respawn]');
    const deathModalSpectateWrap = root.querySelector('[data-game-death-modal-spectate]');
    const deathModalSpectatePrevButton = root.querySelector('[data-game-death-modal-spectate-prev]');
    const deathModalSpectateNextButton = root.querySelector('[data-game-death-modal-spectate-next]');
    const deathModalSpectateLabel = root.querySelector('[data-game-death-modal-spectate-label]');
    const encounterOverlayNode = root.querySelector('[data-game-encounter-overlay]');
    const encounterMessageNode = root.querySelector('[data-game-encounter-message]');
    const encounterCountdownNode = root.querySelector('[data-game-encounter-countdown]');
    const confettiLayer = root.querySelector('[data-game-confetti-layer]');
    const pingNode = root.querySelector('[data-game-ping]');
    const sharedLivesNode = root.querySelector('[data-game-shared-lives]');
    const sharedLivesCountNode = root.querySelector('[data-game-shared-lives-count]');
    const masterVolumeSlider = root.querySelector('[data-game-master-volume]');
    const musicMuteToggleButton = root.querySelector('[data-game-music-mute-toggle]');
    const sfxMuteToggleButton = root.querySelector('[data-game-sfx-mute-toggle]');
    const spriteOverlayRoot = root.querySelector('[data-game-sprite-overlay]');
    const idleModal = document.querySelector('[data-game-idle-modal]');
    const idleModalCloseButtons = idleModal
        ? Array.from(idleModal.querySelectorAll('[data-game-idle-modal-close]'))
        : [];

    if (!canvas || !minimapCanvas || !connectionStatus) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const minimapCtx = minimapCanvas.getContext('2d');
    if (!ctx || !minimapCtx) {
        return;
    }

    // Localized labels are copied out once so render/update code does not keep touching the DOM for text.
    const labels = {
        connecting: root.getAttribute('data-connecting-label') || 'Connecting',
        connected: root.getAttribute('data-connected-label') || 'Connected',
        disconnected: root.getAttribute('data-disconnected-label') || 'Disconnected'
    };
    const phaseOneBackgroundColor = { r: 251, g: 246, b: 237 };
    const phaseThreeBackgroundColor = { r: 232, g: 139, b: 88 };
    const SELF_PUMPKIN_NTR_VISUAL_DURATION_MS = 3000;
    const PUMPKIN_NPC_HEALTH_SEGMENTS = 4;
    const deathTitleLabel = root.getAttribute('data-death-title-label') || 'You\'ve been Nered!';
    const deathGameOverTitleLabel = root.getAttribute('data-death-game-over-title-label') || 'Spiky tried hard......';
    const deathRespawnLabel = root.getAttribute('data-death-respawn-label') || 'Respawn';
    const deathNoLivesLabel = root.getAttribute('data-death-no-lives-label') || 'No Lives Left';
    const deathSpectateEmptyLabel = root.getAttribute('data-death-spectate-empty-label') || 'No players to spectate';
    const skinLockedLabel = window.document.documentElement.lang === 'en' ? 'Locked' : '잠김';
    const playerName = root.getAttribute('data-player-name') || 'Player';
    const skinCatalog = (function () {
        // Server-rendered skin metadata lets unlock rules and asset URLs stay data-driven on the client.
        const rawValue = root.getAttribute('data-skin-catalog') || '[]';
        try {
            const parsed = JSON.parse(rawValue);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    })();
    const playerNpcIconUrl = root.getAttribute('data-player-npc-icon-url') || '';
    const playerNpcPhase2IconUrl = root.getAttribute('data-player-npc-phase2-icon-url') || '';
    const playerNpcPhase3IconUrl = root.getAttribute('data-player-npc-phase3-icon-url') || '';
    const playerNpcBoostIconUrl = root.getAttribute('data-player-npc-boost-icon-url') || '';
    const playerNpcDefeat1IconUrl = root.getAttribute('data-player-npc-defeat1-icon-url') || '';
    const playerNpcDefeat2IconUrl = root.getAttribute('data-player-npc-defeat2-icon-url') || '';
    const playerNpcDieIconUrl = root.getAttribute('data-player-npc-die-icon-url') || '';
    const nerTrackingSoundUrls = (function () {
        const rawValue = root.getAttribute('data-player-ner-tracking-sound-urls') || '[]';
        try {
            const parsed = JSON.parse(rawValue);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
            return [];
        }
    })();
    const nerAccelerationSoundUrls = (function () {
        const rawValue = root.getAttribute('data-player-ner-acceleration-sound-urls') || '[]';
        try {
            const parsed = JSON.parse(rawValue);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
            return [];
        }
    })();
    const nerWinIconUrls = (function () {
        const rawValue = root.getAttribute('data-player-ner-win-icon-urls') || '[]';
        try {
            const parsed = JSON.parse(rawValue);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
            return [];
        }
    })();
    const ostUrls = (function () {
        const rawValue = root.getAttribute('data-ost-urls') || '{}';
        try {
            const parsed = JSON.parse(rawValue);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    })();
    const rawWsUrl = root.getAttribute('data-ws-url') || '';
    const tokenUrl = root.getAttribute('data-token-url') || '';
    const gameSlug = root.getAttribute('data-game-slug') || 'raise-speaki';
    const gameplaySettings = (function () {
        // Admin-tuned movement/combat values are injected through the page so runtime behavior matches server config.
        const rawValue = root.getAttribute('data-gameplay-settings') || '{}';
        try {
            const parsed = JSON.parse(rawValue);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    })();
    const house1Url = root.getAttribute('data-house1-url') || '';
    const house2Url = root.getAttribute('data-house2-url') || '';
    const house3Url = root.getAttribute('data-house3-url') || '';
    const encounterLabels = {
        stage1: root.getAttribute('data-encounter-stage-one-label') || '',
        stage2: root.getAttribute('data-encounter-stage-two-label') || '',
        stage3: root.getAttribute('data-encounter-stage-three-label') || '',
        finale: root.getAttribute('data-encounter-finale-label') || ''
    };
    const worldSize = 2000;
    const basePlayerSpeedPerSecond = Number(gameplaySettings.user_base_speed || 225);
    const npcBaseSpeedPerSecond = Number(gameplaySettings.npc_base_speed || 281.25);
    const boostAccelerationPerSecond = Number(gameplaySettings.user_boost_acceleration || 360);
    const boostCooldownPerSecond = Number(gameplaySettings.user_boost_cooldown || 280);
    const boostDurationMs = Number(gameplaySettings.user_boost_duration_ms || 1238);
    const npcMaxHealth = Number(gameplaySettings.npc_max_health || 20);
    const cameraFollow = 0.18;
    const remoteLerpPerFrame = 0.24;
    const selfRenderLerpPerFrame = 0.62;
    const selfReconcilePerFrame = 0.2;
    const selfSnapDistance = 220;
    const selfIgnoreDistance = 2;
    const playerSpriteWidth = 44;
    const playerSpriteHeight = 44;
    const playerLabelOffset = 34;
    const viewZoom = 4.266666666666667;
    const smallPlayerSpriteThresholdPx = 26;
    const renderOverscan = 2;
    const cameraDeadZoneRatioX = 0.16;
    const cameraDeadZoneRatioY = 0.2;
    const cameraLeadRatioX = 0.12;
    const cameraLeadRatioY = 0.14;
    const cameraLeadSpeedThreshold = 18;
    const remoteRenderDelaySeconds = 0.06;
    const MUSIC_MUTED_STORAGE_KEY = 'bumpercar_spiky_music_muted';
    const SFX_MUTED_STORAGE_KEY = 'bumpercar_spiky_sfx_muted';
    const referenceCanvasWidth = 960;
    const referenceCanvasHeight = 640;
    const defaultPlayerAspectRatio = 173 / 170;
    const rotationLerpPerSecond = 14;
    const flipDurationSeconds = 0.18;
    const doubleUnitDeathFadeMs = 3000;
    const soundHearingRadius = 560;
    const remoteCharacterSoundMinVolume = 0.2;
    const characterSoundTargetRms = 0.13;
    const characterSoundMaxNormalizationGain = 2.8;
    const inputSendIntervalMs = 33;
    const inputHeartbeatMs = 150;
    const levelBoostDistanceScaleFactor = 1.1;
    const input = { up: false, down: false, left: false, right: false, boost: false, special: false, respawn: false };
    const keyboardDirectionInput = { up: false, down: false, left: false, right: false };
    const joystickDirectionInput = { up: false, down: false, left: false, right: false };
    const joystickAnalogInput = { x: 0, y: 0 };
    const mouseDirectionInput = { up: false, down: false, left: false, right: false };
    const keyMap = {
        w: 'up',
        ArrowUp: 'up',
        s: 'down',
        ArrowDown: 'down',
        a: 'left',
        ArrowLeft: 'left',
        d: 'right',
        ArrowRight: 'right'
    };

    let socket = null;
    let activeSocket = null;
    let gameStarted = false;
    let selfId = '';
    let serverPlayers = [];
    let levelDrops = [];
    // delta 수신 시 플레이어별 최신 full state를 유지하는 Map
    let serverPlayerMap = new Map();
    let renderPlayers = [];
    let sendTimer = null;
    let pingTimer = null;
    let reconnectTimer = null;
    let reconnectAttemptInFlight = false;
    let suppressNextCloseReconnect = false;
    let idleReconnectBlocked = false;
    let isFullscreenMode = false;
    let isCompactViewport = false;
    let joystickPointerId = null;
    let keyboardCurrentAngle = null;
    let keyboardAngleLastUpdate = 0;
    const keyboardVelocity = { x: 0, y: 0 };
    let mouseMoveActive = false;
    let mouseLeftHeld = false;
    let mouseRightHeld = false;
    let mouseBoostRequested = false;
    let mouseScreenDX = 0;
    let mouseScreenDY = 0;
    let mouseBoostPulseTimer = null;
    let lastRenderTime = 0;
    let cameraX = worldSize / 2;
    let cameraY = worldSize / 2;
    let predictedSelf = null;
    let renderedSelf = null;
    let currentMoveSpeed = basePlayerSpeedPerSecond;
    let serverReportedMoveSpeed = basePlayerSpeedPerSecond;
    let collisionRecoveryActive = false;
    let boostLockedActive = false;
    let boostState = 'idle';
    let boostDirectionX = 0;
    let boostDirectionY = 0;
    let selfDeathActive = false;
    let selfDeathRespawnReady = false;
    let selfLivesRemaining = Math.max(1, Number(gameplaySettings.user_lives || 3));
    let selfLevel = 1;
    let selfCurrentHealth = 1;
    let selfMaxHealth = 1;
    let roundResetAnnouncementActive = false;
    let roundResetAnnouncementLatched = false;
    let selfDoubleMerged = false;
    let respawnRequestPending = false;
    let manualStartAutoRespawnPending = false;
    let spectateTargetId = '';
    let selfCollisionActive = false;
    let selfCollisionImpactActive = false;
    let selfCollisionVisualType = 'win';
    let selfPumpkinNtrVisualUntil = 0;
    let encounterStage = 0;
    let encounterAnnouncementKey = '';
    let encounterCountdownSeconds = 0;
    let encounterFinaleActive = false;
    let encounterFinaleUntil = 0;
    let confettiParticles = [];
    let lastConfettiSpawnAt = 0;
    let lastSentInputSignature = '';
    let lastSentInputAt = 0;
    let audioContext = null;
    let masterVolume = 0.2;
    let musicMuted = false;
    let effectsMuted = false;
    let backgroundMusicAudio = null;
    let currentBackgroundMusicKey = '';
    let backgroundMusicAutoplayBlocked = false;
    let loadingCaptionTimer = null;
    let loadingCaptionMessageIndex = 0;
    let loadingCaptionStep = 0;
    let loadingCaptionPauseUntil = 0;
    let loadingTrailPoints = [];
    let loadingTrailLastAt = 0;
    const playerAudioStates = new Map();
    const activePlayerSounds = new Map();
    const pendingPlayerSoundTimers = new Map();
    const lastRandomSoundUrlByList = new WeakMap();
    const characterSoundBufferByUrl = new Map();
    const characterSoundPreloadByUrl = new Map();
    const playerVisuals = new Map();
    const spriteOverlayNodes = new Map();
    let canvasScale = 1;
    const animatedAssetDock = window.document.createElement('div');
    const npcTintCanvas = window.document.createElement('canvas');
    const npcTintContext = npcTintCanvas.getContext('2d');
    const skinAssetRuntimeByName = new Map();
    const playerNpcIcon = new window.Image();
    const playerNpcPhase2Icon = new window.Image();
    const playerNpcPhase3Icon = new window.Image();
    const playerNpcBoostIcon = new window.Image();
    const playerNpcDefeat1Icon = new window.Image();
    const playerNpcDefeat2Icon = new window.Image();
    const playerNpcDieIcon = new window.Image();
    const playerNpcWinIcons = nerWinIconUrls.map(function (url) {
        return {
            image: new window.Image(),
            ready: false,
            url: url
        };
    });
    let playerNpcIconReady = false;
    let playerNpcPhase2IconReady = false;
    let playerNpcPhase3IconReady = false;
    let playerNpcBoostIconReady = false;
    let playerNpcDefeat1IconReady = false;
    let playerNpcDefeat2IconReady = false;
    let playerNpcDieIconReady = false;
    let selectedSkinName = 'default';
    let activeSelfSkinName = 'default';
    let selectedSkinDetailName = '';
    let selfPumpkinNtrTriggerCount = 0;
    let selfServerAudioStateInitialized = false;

    animatedAssetDock.setAttribute('aria-hidden', 'true');
    animatedAssetDock.style.position = 'fixed';
    animatedAssetDock.style.left = '0';
    animatedAssetDock.style.top = '0';
    animatedAssetDock.style.width = '36px';
    animatedAssetDock.style.height = '36px';
    animatedAssetDock.style.overflow = 'hidden';
    animatedAssetDock.style.opacity = '0.001';
    animatedAssetDock.style.pointerEvents = 'none';
    animatedAssetDock.style.zIndex = '1';
    animatedAssetDock.style.borderRadius = '999px';
    animatedAssetDock.style.clipPath = 'inset(0 0 0 0 round 999px)';
    window.document.body.appendChild(animatedAssetDock);

    const isAnimatedRasterAsset = function (src) {
        return /\.(?:gif|webp)(?:\?|$)/i.test(String(src || ''));
    };

    const bindImage = function (image, src, onReadyChange) {
        // Animated raster assets must stay attached to live DOM on some browsers,
        // otherwise GIF/WebP playback pauses after decode. The hidden dock keeps
        // those frames ticking while gameplay still draws them onto canvas/UI.
        if (!src) {
            return;
        }
        if (isAnimatedRasterAsset(src) && !image.isConnected) {
            image.setAttribute('aria-hidden', 'true');
            image.style.position = 'static';
            image.style.display = 'block';
            image.style.width = '36px';
            image.style.height = '36px';
            image.style.objectFit = 'contain';
            image.style.opacity = '1';
            image.style.pointerEvents = 'none';
            image.decoding = 'sync';
            image.loading = 'eager';
            animatedAssetDock.appendChild(image);
        }
        image.src = src;
        if (image.complete) {
            onReadyChange(true);
        }
        image.addEventListener('load', function () {
            onReadyChange(true);
        });
        image.addEventListener('error', function () {
            onReadyChange(false);
        });
    };

    const createManagedImage = function (src) {
        const entry = {
            image: new window.Image(),
            ready: false,
            url: src || ''
        };
        bindImage(entry.image, src || '', function (ready) {
            entry.ready = ready;
        });
        return entry;
    };

    const getManagedImageSource = function (entry) {
        if (!entry || !entry.image) {
            return '';
        }
        return String(entry.image.currentSrc || entry.image.src || '');
    };

    const houseImages = {
        house1: createManagedImage(house1Url),
        house2: createManagedImage(house2Url),
        house3: createManagedImage(house3Url)
    };

    const createSkinAssetRuntime = function (skinConfig) {
        // Convert the serialized skin catalog from Django into a runtime object
        // with managed images, unlock metadata, and grouped audio URLs.
        const assets = skinConfig && skinConfig.assets ? skinConfig.assets : {};
        const runtime = {
            name: skinConfig && skinConfig.name ? skinConfig.name : 'default',
            displayName: skinConfig && skinConfig.display_name ? skinConfig.display_name : 'Default',
            visualScale: Math.max(0.1, Number(skinConfig && skinConfig.visual_scale !== undefined ? skinConfig.visual_scale : 1)),
            unlocked: Boolean(skinConfig && skinConfig.unlocked),
            unlockCondition: skinConfig && skinConfig.unlock_condition ? skinConfig.unlock_condition : '',
            description: skinConfig && skinConfig.description ? skinConfig.description : '',
            sounds: {
                boost: Array.isArray(assets.boost_sound_urls) ? assets.boost_sound_urls.filter(Boolean) : [],
                crash: Array.isArray(assets.crash_sound_urls) ? assets.crash_sound_urls.filter(Boolean) : [],
                defeat: Array.isArray(assets.defeat_sound_urls) ? assets.defeat_sound_urls.filter(Boolean) : [],
                die: Array.isArray(assets.die_sound_urls) ? assets.die_sound_urls.filter(Boolean) : [],
                respawn: Array.isArray(assets.respawn_sound_urls) ? assets.respawn_sound_urls.filter(Boolean) : [],
                ntr: Array.isArray(assets.ntr_sound_urls) ? assets.ntr_sound_urls.filter(Boolean) : [],
            },
            previewIcon: createManagedImage(assets.preview_icon_url || assets.default_icon_url || ''),
            pumpkinNpcIcon: createManagedImage(assets.pumpkin_npc_icon_url || ''),
            legacyIcon: createManagedImage(assets.default_icon_url || assets.preview_icon_url || ''),
            legacyBoostIcon: createManagedImage(assets.boost_icon_url || ''),
            legacyCollisionIcon: createManagedImage(assets.collision_icon_url || ''),
            legacyDefeatIcon: createManagedImage(assets.defeat_icon_url || ''),
            skinType: skinConfig && skinConfig.skin_type ? String(skinConfig.skin_type) : 'classic',
            defaultIconSets: Array.isArray(assets.default_icon_sets)
                ? assets.default_icon_sets.map(function (set) {
                    return {
                        healthy: createManagedImage(set && set.healthy_icon_url ? set.healthy_icon_url : ''),
                        damaged: createManagedImage(set && set.damaged_icon_url ? set.damaged_icon_url : '')
                    };
                }).filter(function (set) {
                    return set.healthy.url || set.damaged.url;
                })
                : [],
            boostStages: Array.isArray(assets.boost_icon_stages)
                ? assets.boost_icon_stages.filter(Boolean).map(createManagedImage)
                : [],
            collisionIconSets: Array.isArray(assets.collision_icon_sets)
                ? assets.collision_icon_sets.map(function (set) {
                    return {
                        impact: createManagedImage(set && set.impact_icon_url ? set.impact_icon_url : ''),
                        slow: createManagedImage(set && set.slow_icon_url ? set.slow_icon_url : '')
                    };
                }).filter(function (set) {
                    return set.impact.url || set.slow.url;
                })
                : [],
            defeatStages: Array.isArray(assets.defeat_icon_stages)
                ? assets.defeat_icon_stages.filter(Boolean).map(createManagedImage)
                : [],
            defaultStateIcons: Array.isArray(assets.default_state_icons)
                ? assets.default_state_icons.filter(Boolean).map(createManagedImage)
                : [],
            collisionStateIcons: Array.isArray(assets.collision_state_icons)
                ? assets.collision_state_icons.filter(Boolean).map(createManagedImage)
                : [],
            defeatStateIcons: Array.isArray(assets.defeat_state_icons)
                ? assets.defeat_state_icons.filter(Boolean).map(createManagedImage)
                : [],
            winStateIcons: Array.isArray(assets.win_state_icons)
                ? assets.win_state_icons.filter(Boolean).map(createManagedImage)
                : [],
            stopStateIcons: Array.isArray(assets.stop_state_icons)
                ? assets.stop_state_icons.filter(Boolean).map(createManagedImage)
                : [],
        };
        return runtime;
    };

    const ensureSkinAssetRuntime = function (skinName) {
        // Skin runtimes are cached once so repeated render/audio lookups do not
        // recreate Image objects or rescan the raw catalog every frame.
        const normalizedName = String(skinName || 'default').trim().toLowerCase() || 'default';
        if (skinAssetRuntimeByName.has(normalizedName)) {
            return skinAssetRuntimeByName.get(normalizedName);
        }
        const skinConfig = skinCatalog.find(function (entry) {
            return String(entry && entry.name || '').trim().toLowerCase() === normalizedName;
        }) || skinCatalog[0] || {
            name: 'default',
            display_name: 'Default',
            unlocked: true,
            assets: {}
        };
        const runtime = createSkinAssetRuntime(skinConfig);
        skinAssetRuntimeByName.set(normalizedName, runtime);
        return runtime;
    };

    const getSkinConfig = function (skinName) {
        return ensureSkinAssetRuntime(skinName || selectedSkinName || 'default');
    };

    const resolveSelectedSkinName = function () {
        const storedValue = window.localStorage ? window.localStorage.getItem('hanplanet-bumpercar-selected-skin') : '';
        const requestedName = String(storedValue || 'default').trim().toLowerCase() || 'default';
        const matchingSkin = skinCatalog.find(function (skin) {
            return String(skin && skin.name || '').trim().toLowerCase() === requestedName;
        });
        if (matchingSkin && matchingSkin.unlocked) {
            return requestedName;
        }
        return 'default';
    };

    const isAnimatedGifIcon = function (icon) {
        const src = String((icon && (icon.currentSrc || icon.src)) || '');
        return isAnimatedRasterAsset(src);
    };

    const getSpriteOverlayNode = function (playerId) {
        // Animated overlays that cannot be represented well on canvas are rendered
        // in a DOM layer keyed by player id and synchronized with the world view.
        if (!spriteOverlayRoot) {
            return null;
        }
        let node = spriteOverlayNodes.get(playerId);
        if (node) {
            return node;
        }
        node = window.document.createElement('img');
        node.className = 'multiplayer-sprite-overlay-item';
        node.alt = '';
        node.decoding = 'sync';
        node.loading = 'eager';
        spriteOverlayRoot.appendChild(node);
        spriteOverlayNodes.set(playerId, node);
        return node;
    };

    const hideSpriteOverlayNode = function (playerId) {
        const node = spriteOverlayNodes.get(playerId);
        if (!node) {
            return;
        }
        node.style.display = 'none';
    };

    skinCatalog.forEach(function (skinConfig) {
        ensureSkinAssetRuntime(skinConfig && skinConfig.name ? skinConfig.name : 'default');
    });
    bindImage(playerNpcIcon, playerNpcIconUrl, function (ready) {
        playerNpcIconReady = ready;
    });
    bindImage(playerNpcPhase2Icon, playerNpcPhase2IconUrl, function (ready) {
        playerNpcPhase2IconReady = ready;
    });
    bindImage(playerNpcPhase3Icon, playerNpcPhase3IconUrl, function (ready) {
        playerNpcPhase3IconReady = ready;
    });
    bindImage(playerNpcBoostIcon, playerNpcBoostIconUrl, function (ready) {
        playerNpcBoostIconReady = ready;
    });
    bindImage(playerNpcDefeat1Icon, playerNpcDefeat1IconUrl, function (ready) {
        playerNpcDefeat1IconReady = ready;
    });
    bindImage(playerNpcDefeat2Icon, playerNpcDefeat2IconUrl, function (ready) {
        playerNpcDefeat2IconReady = ready;
    });
    bindImage(playerNpcDieIcon, playerNpcDieIconUrl, function (ready) {
        playerNpcDieIconReady = ready;
    });
    playerNpcWinIcons.forEach(function (entry) {
        bindImage(entry.image, entry.url, function (ready) {
            entry.ready = ready;
        });
    });
    selectedSkinName = resolveSelectedSkinName();
    activeSelfSkinName = selectedSkinName;

    const clampToWorld = function (value) {
        return Math.max(0, Math.min(worldSize, value));
    };

    const getFrameAdjustedLerp = function (perFrameValue, deltaSeconds) {
        const normalizedFrames = Math.max(deltaSeconds, 0) * 60;
        return 1 - Math.pow(1 - perFrameValue, normalizedFrames);
    };

    const getCanvasDisplayWidth = function () {
        return canvas.width > 0 ? (canvas.width / canvasScale) : (canvas.clientWidth || 960);
    };

    const getCanvasDisplayHeight = function () {
        return canvas.height > 0 ? (canvas.height / canvasScale) : (canvas.clientHeight || 640);
    };

    const getViewportDisplayWidth = function () {
        return getCanvasDisplayWidth();
    };

    const getViewportDisplayHeight = function () {
        return getCanvasDisplayHeight();
    };

    const getEffectiveZoom = function () {
        const displayWidth = getViewportDisplayWidth();
        const displayHeight = getViewportDisplayHeight();
        const canvasArea = displayWidth > 0 && displayHeight > 0
            ? displayWidth * displayHeight
            : referenceCanvasWidth * referenceCanvasHeight;
        const referenceArea = referenceCanvasWidth * referenceCanvasHeight;
        const canvasScale = Math.sqrt(canvasArea / referenceArea);
        const activeViewZoom = viewZoom * 0.82;
        const scaledZoom = (activeViewZoom / renderOverscan) * Math.max(canvasScale, 0.35);
        const minWorldFitZoom = Math.max(
            displayWidth / worldSize,
            displayHeight / worldSize,
            0.35
        );
        return Math.max(scaledZoom, minWorldFitZoom);
    };

    const getControlledPlayerPosition = function () {
        if (predictedSelf) {
            return {
                x: Number(predictedSelf.x || 0),
                y: Number(predictedSelf.y || 0)
            };
        }
        if (renderedSelf) {
            return {
                x: Number(renderedSelf.x || 0),
                y: Number(renderedSelf.y || 0)
            };
        }
        const selfPlayer = renderPlayers.find(function (player) {
            return player.id === selfId;
        });
        if (!selfPlayer) {
            return null;
        }
        return {
            x: Number(selfPlayer.x || 0),
            y: Number(selfPlayer.y || 0)
        };
    };

    const updateMouseTarget = function (clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }
        const displayX = ((clientX - rect.left) / rect.width) * getCanvasDisplayWidth();
        const displayY = ((clientY - rect.top) / rect.height) * getCanvasDisplayHeight();
        const controlledPosition = getControlledPlayerPosition();
        if (!controlledPosition) {
            mouseScreenDX = displayX - (getCanvasDisplayWidth() / 2);
            mouseScreenDY = displayY - (getCanvasDisplayHeight() / 2);
            return;
        }
        const zoom = getEffectiveZoom();
        const selfScreenX = (controlledPosition.x - cameraX) * zoom;
        const selfScreenY = (controlledPosition.y - cameraY) * zoom;
        mouseScreenDX = displayX - selfScreenX;
        mouseScreenDY = displayY - selfScreenY;
    };

    const syncDirectionalInput = function () {
        const keyboardActive = keyboardDirectionInput.up || keyboardDirectionInput.down || keyboardDirectionInput.left || keyboardDirectionInput.right;
        const joystickActive = joystickDirectionInput.up || joystickDirectionInput.down || joystickDirectionInput.left || joystickDirectionInput.right;
        const source = keyboardActive
            ? keyboardDirectionInput
            : (joystickActive ? joystickDirectionInput : mouseDirectionInput);
        input.up = Boolean(source.up);
        input.down = Boolean(source.down);
        input.left = Boolean(source.left);
        input.right = Boolean(source.right);
    };

    const updateMouseDirectionalInput = function () {
        if (!mouseMoveActive || selfDeathActive) {
            mouseDirectionInput.up = false;
            mouseDirectionInput.down = false;
            mouseDirectionInput.left = false;
            mouseDirectionInput.right = false;
            syncDirectionalInput();
            return;
        }
        const deadZone = 18;
        const distance = Math.hypot(mouseScreenDX, mouseScreenDY);
        if (distance <= deadZone) {
            mouseDirectionInput.up = false;
            mouseDirectionInput.down = false;
            mouseDirectionInput.left = false;
            mouseDirectionInput.right = false;
            syncDirectionalInput();
            return;
        }
        mouseDirectionInput.left = false;
        mouseDirectionInput.right = false;
        mouseDirectionInput.up = false;
        mouseDirectionInput.down = false;
        syncDirectionalInput();
    };

    const refreshMouseMoveState = function () {
        mouseMoveActive = mouseLeftHeld && !mouseBoostRequested && !selfDeathActive;
        updateMouseDirectionalInput();
    };

    const triggerMouseBoostPulse = function () {
        if (mouseBoostPulseTimer) {
            window.clearTimeout(mouseBoostPulseTimer);
            mouseBoostPulseTimer = null;
        }
        if (boostLockedActive) {
            mouseBoostRequested = false;
            refreshMouseMoveState();
            input.boost = false;
            sendInputNow();
            return;
        }
        mouseBoostRequested = true;
        refreshMouseMoveState();
        input.boost = true;
        sendInputNow(true);
        mouseBoostPulseTimer = window.setTimeout(function () {
            mouseBoostRequested = false;
            refreshMouseMoveState();
            input.boost = false;
            if (boostState === 'cooldown' && currentMoveSpeed <= getSelectedPlayerBaseSpeed()) {
                boostState = 'idle';
            }
            sendInputNow(true);
            mouseBoostPulseTimer = null;
        }, 90);
    };

    const syncMouseButtons = function (buttons, event) {
        const normalizedButtons = Number(buttons || 0);
        const nextLeftHeld = Boolean(normalizedButtons & 1);
        const nextRightHeld = Boolean(normalizedButtons & 2);
        mouseLeftHeld = nextLeftHeld;
        if (nextRightHeld && !mouseRightHeld && event) {
            updateMouseTarget(event.clientX, event.clientY);
            triggerMouseBoostPulse();
        }
        mouseRightHeld = nextRightHeld;
        refreshMouseMoveState();
    };

    const getMouseVector = function (allowWhenInactive) {
        if ((!mouseMoveActive && !allowWhenInactive) || selfDeathActive) {
            return { dx: 0, dy: 0 };
        }
        const distance = Math.hypot(mouseScreenDX, mouseScreenDY);
        if (distance <= 18) {
            return { dx: 0, dy: 0 };
        }
        return {
            dx: mouseScreenDX / distance,
            dy: mouseScreenDY / distance
        };
    };

    const getNetworkMoveVector = function () {
        const keyboardActive = keyboardDirectionInput.up || keyboardDirectionInput.down || keyboardDirectionInput.left || keyboardDirectionInput.right;

        if (!keyboardActive) {
            keyboardCurrentAngle = null;
            keyboardVelocity.x = 0;
            keyboardVelocity.y = 0;
            if (joystickPointerId !== null) {
                return { dx: joystickAnalogInput.x, dy: joystickAnalogInput.y };
            }
            return getMouseVector(mouseBoostRequested);
        }

        // velocity 가속 모델: UP/DOWN/LEFT/RIGHT는 직관대로 북/남/서/동
        // 방향 전환 시 x/y 속도 벡터가 목표로 서서히 가속 → 전환 경로가 곡선을 그려 진짜 중간 각도를 지남
        const now = Date.now();
        const elapsed = Math.min(now - keyboardAngleLastUpdate, 100);
        keyboardAngleLastUpdate = now;

        let targetX = 0;
        let targetY = 0;
        if (keyboardDirectionInput.left)  targetX -= 1;
        if (keyboardDirectionInput.right) targetX += 1;
        if (keyboardDirectionInput.up)    targetY -= 1;
        if (keyboardDirectionInput.down)  targetY += 1;
        const targetMag = Math.hypot(targetX, targetY);
        if (targetMag > 0) {
            targetX /= targetMag;
            targetY /= targetMag;
        }

        // 목표 벡터 방향으로 가속 (약 120ms 만에 최고속 도달)
        const step = (8 / 1000) * elapsed;
        const diffX = targetX - keyboardVelocity.x;
        const diffY = targetY - keyboardVelocity.y;
        const diffMag = Math.hypot(diffX, diffY);
        if (diffMag <= step) {
            keyboardVelocity.x = targetX;
            keyboardVelocity.y = targetY;
        } else {
            keyboardVelocity.x += (diffX / diffMag) * step;
            keyboardVelocity.y += (diffY / diffMag) * step;
        }

        const velMag = Math.hypot(keyboardVelocity.x, keyboardVelocity.y);
        if (velMag > 1) {
            keyboardVelocity.x /= velMag;
            keyboardVelocity.y /= velMag;
        }

        return { dx: keyboardVelocity.x, dy: keyboardVelocity.y };
    };

    const buildInputPayload = function () {
        const moveVector = getNetworkMoveVector();
        return {
            up: Boolean(input.up),
            down: Boolean(input.down),
            left: Boolean(input.left),
            right: Boolean(input.right),
            boost: Boolean(input.boost),
            special: Boolean(input.special),
            respawn: Boolean(input.respawn),
            moveX: Number(moveVector.dx.toFixed(4)),
            moveY: Number(moveVector.dy.toFixed(4))
        };
    };

    const buildInputSignature = function () {
        return JSON.stringify(buildInputPayload());
    };

    const getInputVector = function () {
        return getNetworkMoveVector();
    };

    const setStatus = function (label, color) {
        connectionStatus.textContent = label;
        connectionStatus.style.color = color;
    };

    const setPing = function (value) {
        if (!pingNode) {
            return;
        }
        pingNode.textContent = typeof value === 'number' ? ('Ping ' + value + ' ms') : 'Ping -- ms';
    };

    const getEncounterLabel = function (key) {
        if (key === 'stage1' || key === 'ner_knocks_door') {
            return encounterLabels.stage1;
        }
        if (key === 'stage2' || key === 'ner_breaks_door') {
            return encounterLabels.stage2;
        }
        if (key === 'stage3' || key === 'ner_holds_deed') {
            return encounterLabels.stage3;
        }
        if (key === 'finale' || key === 'ner_true_finale') {
            return encounterLabels.finale;
        }
        return '';
    };

    const setEncounterOverlayState = function () {
        if (!encounterOverlayNode || !encounterMessageNode || !encounterCountdownNode) {
            return;
        }
        const label = getEncounterLabel(encounterAnnouncementKey).replace(/\\n/g, '\n');
        const showCountdown = !encounterFinaleActive && encounterCountdownSeconds > 0;
        const visible = Boolean(label) || showCountdown;
        encounterOverlayNode.hidden = !visible;
        if (!visible) {
            encounterMessageNode.textContent = '';
            encounterCountdownNode.textContent = '';
            return;
        }
        encounterMessageNode.textContent = label;
        encounterCountdownNode.textContent = showCountdown ? String(Math.max(0, encounterCountdownSeconds)) : '';
    };

    const confettiColors = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

    const clearConfetti = function () {
        confettiParticles = [];
        lastConfettiSpawnAt = 0;
        if (confettiLayer) {
            confettiLayer.innerHTML = '';
        }
    };

    const spawnConfettiBurst = function (nowMs) {
        if (!confettiLayer) {
            return;
        }
        const width = confettiLayer.clientWidth || getCanvasDisplayWidth();
        for (let index = 0; index < 8; index += 1) {
            const node = document.createElement('span');
            node.className = 'multiplayer-confetti-piece';
            node.style.background = confettiColors[Math.floor(Math.random() * confettiColors.length)];
            confettiLayer.appendChild(node);
            confettiParticles.push({
                node: node,
                x: Math.random() * Math.max(1, width),
                y: -20 - Math.random() * 40,
                driftX: -0.8 + Math.random() * 1.6,
                velocityY: 90 + Math.random() * 140,
                rotation: Math.random() * Math.PI * 2,
                spin: -2.4 + Math.random() * 4.8,
                wobble: Math.random() * Math.PI * 2,
                scale: 0.8 + Math.random() * 0.6,
                alpha: 0.92,
                createdAt: nowMs
            });
        }
    };

    const updateConfetti = function (deltaSeconds, nowMs) {
        if (!confettiLayer) {
            return;
        }
        if (!encounterFinaleActive) {
            if (confettiParticles.length || confettiLayer.childElementCount) {
                clearConfetti();
            }
            return;
        }
        if (!lastConfettiSpawnAt || nowMs - lastConfettiSpawnAt >= 180) {
            spawnConfettiBurst(nowMs);
            lastConfettiSpawnAt = nowMs;
        }
        const height = confettiLayer.clientHeight || getCanvasDisplayHeight();
        confettiParticles = confettiParticles.filter(function (particle) {
            particle.x += particle.driftX * 60 * deltaSeconds;
            particle.y += particle.velocityY * deltaSeconds;
            particle.rotation += particle.spin * deltaSeconds;
            particle.wobble += 3.2 * deltaSeconds;
            particle.alpha = Math.max(0, 0.92 - ((particle.y / Math.max(1, height)) * 0.55));
            if (particle.y > height + 40) {
                if (particle.node.parentNode === confettiLayer) {
                    confettiLayer.removeChild(particle.node);
                }
                return false;
            }
            particle.node.style.opacity = String(particle.alpha);
            particle.node.style.transform =
                'translate(' + Math.round(particle.x) + 'px, ' + Math.round(particle.y) + 'px) ' +
                'rotate(' + particle.rotation + 'rad) ' +
                'scale(' + (particle.scale + Math.sin(particle.wobble) * 0.16) + ')';
            return true;
        });
        while (confettiParticles.length > 120) {
            const particle = confettiParticles.shift();
            if (particle && particle.node.parentNode === confettiLayer) {
                confettiLayer.removeChild(particle.node);
            }
        }
    };

    const updateEncounterStateFromPlayer = function (player) {
        if (!player) {
            return;
        }
        encounterStage = typeof player.encounterStage === 'number' ? player.encounterStage : encounterStage;
        encounterAnnouncementKey = String(player.encounterAnnouncementKey || '');
        encounterCountdownSeconds = typeof player.encounterCountdownSeconds === 'number' ? Math.max(0, player.encounterCountdownSeconds) : 0;
        encounterFinaleActive = Boolean(player.encounterFinaleActive);
        encounterFinaleUntil = typeof player.encounterFinaleUntil === 'number' ? player.encounterFinaleUntil : 0;
        setEncounterOverlayState();
        updateBackgroundMusic();
    };

    const setIdleModalOpen = function (opened) {
        if (!idleModal) {
            return;
        }
        idleModal.hidden = !opened;
    };

    const updateStartCharacterPreview = function () {
        if (!startCharacterImage) {
            return;
        }
        const skinRuntime = getSkinConfig(selectedSkinName);
        const nextUrl = getManagedImageSource(skinRuntime.previewIcon) || getManagedImageSource(skinRuntime.legacyIcon);
        startCharacterImage.classList.remove('is-ready');
        if (nextUrl) {
            if (startCharacterImage.src !== nextUrl) {
                startCharacterImage.src = nextUrl;
            }
        }
        startCharacterImage.alt = skinRuntime.displayName;
        startCharacterImage.classList.toggle('is-evolution', skinRuntime.skinType === 'evolution');
        startCharacterImage.classList.toggle('is-pumkin', skinRuntime.skinType === 'pumkin');
        if (startCharacterImage.complete && startCharacterImage.naturalWidth > 0) {
            startCharacterImage.classList.add('is-ready');
        }
    };

    if (startCharacterImage) {
        startCharacterImage.addEventListener('load', function () {
            startCharacterImage.classList.add('is-ready');
        });
        startCharacterImage.addEventListener('error', function () {
            startCharacterImage.classList.remove('is-ready');
        });
    }

    const setSkinModalOpen = function (opened) {
        if (!skinModal) {
            return;
        }
        skinModal.hidden = !opened;
        if (!opened && skinDetailNode) {
            skinDetailNode.hidden = true;
            selectedSkinDetailName = '';
        }
        if (!opened && skinDetailIconNode) {
            skinDetailIconNode.classList.remove('is-evolution');
            skinDetailIconNode.classList.remove('is-pumkin');
        }
    };

    const renderSkinList = function () {
        if (!skinListNode) {
            return;
        }
        skinListNode.innerHTML = '';
        skinCatalog.forEach(function (skinConfig) {
            const skinRuntime = getSkinConfig(skinConfig.name);
            const item = window.document.createElement('div');
            item.className = 'multiplayer-skin-item';
            if (!skinConfig.unlocked) {
                item.classList.add('is-locked');
            }
            if (selectedSkinName === skinConfig.name) {
                item.classList.add('is-selected');
            }

            const button = window.document.createElement('button');
            button.className = 'multiplayer-skin-item-button';
            button.type = 'button';
            button.dataset.skinName = skinConfig.name;

            const icon = window.document.createElement('img');
            icon.className = 'multiplayer-skin-item-icon';
            icon.src = getManagedImageSource(skinRuntime.previewIcon) || getManagedImageSource(skinRuntime.legacyIcon);
            icon.alt = skinRuntime.displayName;
            icon.classList.toggle('is-evolution', skinRuntime.skinType === 'evolution');
            icon.classList.toggle('is-pumkin', skinRuntime.skinType === 'pumkin');

            const name = window.document.createElement('strong');
            name.className = 'multiplayer-skin-item-name';
            name.textContent = skinConfig.unlocked ? skinRuntime.displayName : '???';

            const state = window.document.createElement('span');
            state.className = 'multiplayer-skin-item-state';
            state.textContent = selectedSkinName === skinConfig.name
                ? '✓'
                : (skinConfig.unlocked ? '' : skinLockedLabel);

            button.appendChild(icon);
            button.appendChild(name);
            button.appendChild(state);
            button.addEventListener('click', function () {
                selectedSkinDetailName = skinConfig.name;
                if (skinDetailNode) {
                    skinDetailNode.hidden = false;
                }
                if (skinDetailIconNode) {
                    skinDetailIconNode.src = icon.src;
                    skinDetailIconNode.alt = skinRuntime.displayName;
                    skinDetailIconNode.classList.toggle('is-evolution', skinRuntime.skinType === 'evolution');
                    skinDetailIconNode.classList.toggle('is-pumkin', skinRuntime.skinType === 'pumkin');
                    skinDetailIconNode.classList.toggle('is-locked', !skinRuntime.unlocked);
                }
                if (skinDetailNameNode) {
                    skinDetailNameNode.textContent = skinRuntime.unlocked ? skinRuntime.displayName : '???';
                }
                if (skinDetailUnlockNode) {
                    skinDetailUnlockNode.textContent = skinRuntime.unlockCondition;
                }
                if (skinDetailDescriptionNode) {
                    skinDetailDescriptionNode.hidden = !skinRuntime.unlocked;
                    skinDetailDescriptionNode.textContent = skinRuntime.unlocked
                        ? String(skinRuntime.description || '')
                            .replace(/₩n/g, '\n')
                            .replace(/\\n/g, '\n')
                        : '';
                }
                if (skinSelectButton) {
                    skinSelectButton.hidden = !skinRuntime.unlocked;
                    skinSelectButton.disabled = selectedSkinName === skinConfig.name;
                    skinSelectButton.textContent = selectedSkinName === skinConfig.name
                        ? (window.document.documentElement.lang === 'en' ? 'Selected' : '선택됨')
                        : (window.document.documentElement.lang === 'en' ? 'Select' : '선택');
                }
            });

            item.appendChild(button);
            skinListNode.appendChild(item);
        });
    };

    const applySelectedSkin = function (skinName) {
        const skinRuntime = getSkinConfig(skinName);
        if (!skinRuntime.unlocked) {
            return;
        }
        selectedSkinName = skinRuntime.name;
        if (!gameStarted) {
            activeSelfSkinName = skinRuntime.name;
        }
        if (boostState === 'idle') {
            currentMoveSpeed = getSelectedPlayerBaseSpeed();
            serverReportedMoveSpeed = getSelectedPlayerBaseSpeed();
        }
        if (window.localStorage) {
            window.localStorage.setItem('hanplanet-bumpercar-selected-skin', selectedSkinName);
        }
        updateStartCharacterPreview();
        renderSkinList();
    };

    const restoreConnectedSkinSelection = function () {
        const connectedSkin = getSkinConfig(activeSelfSkinName || selectedSkinName || 'default');
        selectedSkinName = connectedSkin.name;
        if (window.localStorage) {
            window.localStorage.setItem('hanplanet-bumpercar-selected-skin', selectedSkinName);
        }
        updateStartCharacterPreview();
        renderSkinList();
    };

    const handleIdleTimeoutDisconnect = function () {
        idleReconnectBlocked = true;
        serverPlayers = [];
        levelDrops = [];
        serverPlayerMap.clear();
        renderPlayers = [];
        lastSentInputSignature = '';
        lastSentInputAt = 0;
        predictedSelf = null;
        renderedSelf = null;
        activeSelfSkinName = selectedSkinName;
        currentMoveSpeed = getSelectedPlayerBaseSpeed();
        serverReportedMoveSpeed = getSelectedPlayerBaseSpeed();
        collisionRecoveryActive = false;
        boostLockedActive = false;
        selfDeathActive = false;
        selfDeathRespawnReady = false;
        selfLivesRemaining = Math.max(1, Number(gameplaySettings.user_lives || 3));
        selfLevel = 1;
        selfCurrentHealth = 1;
        selfMaxHealth = 1;
        roundResetAnnouncementActive = false;
        roundResetAnnouncementLatched = false;
        respawnRequestPending = false;
        manualStartAutoRespawnPending = false;
        selfCollisionActive = false;
        selfCollisionVisualType = 'win';
        selfPumpkinNtrVisualUntil = 0;
        mouseMoveActive = false;
        mouseLeftHeld = false;
        mouseRightHeld = false;
        mouseBoostRequested = false;
        mouseScreenDX = 0;
        mouseScreenDY = 0;
        if (mouseBoostPulseTimer) {
            window.clearTimeout(mouseBoostPulseTimer);
            mouseBoostPulseTimer = null;
        }
        keyboardDirectionInput.up = false;
        keyboardDirectionInput.down = false;
        keyboardDirectionInput.left = false;
        keyboardDirectionInput.right = false;
        joystickDirectionInput.up = false;
        joystickDirectionInput.down = false;
        joystickDirectionInput.left = false;
        joystickDirectionInput.right = false;
        mouseDirectionInput.up = false;
        mouseDirectionInput.down = false;
        mouseDirectionInput.left = false;
        mouseDirectionInput.right = false;
        syncDirectionalInput();
        input.boost = false;
        input.special = false;
        encounterStage = 0;
        encounterAnnouncementKey = '';
        encounterCountdownSeconds = 0;
        encounterFinaleActive = false;
        encounterFinaleUntil = 0;
        stopBackgroundMusic();
        spectateTargetId = '';
        setSharedLives(selfLevel, selfCurrentHealth, selfMaxHealth);
        setDeathModalState(false, false, selfLivesRemaining);
        setEncounterOverlayState();
        boostState = 'idle';
        if (defeatReceivedCountNode) {
            defeatReceivedCountNode.textContent = '0';
        }
        if (defeatDealtCountNode) {
            defeatDealtCountNode.textContent = '0';
        }
        setStatus(labels.disconnected, '#ef4444');
        setIdleModalOpen(true);
    };

    const clearGameplayInputForStartOverlay = function () {
        keyboardDirectionInput.up = false;
        keyboardDirectionInput.down = false;
        keyboardDirectionInput.left = false;
        keyboardDirectionInput.right = false;
        joystickDirectionInput.up = false;
        joystickDirectionInput.down = false;
        joystickDirectionInput.left = false;
        joystickDirectionInput.right = false;
        joystickAnalogInput.x = 0;
        joystickAnalogInput.y = 0;
        joystickPointerId = null;
        mouseDirectionInput.up = false;
        mouseDirectionInput.down = false;
        mouseDirectionInput.left = false;
        mouseDirectionInput.right = false;
        mouseLeftHeld = false;
        mouseRightHeld = false;
        mouseBoostRequested = false;
        mouseMoveActive = false;
        input.boost = false;
        syncDirectionalInput();
        if (joystickKnob) {
            joystickKnob.style.transform = 'translate(0, 0)';
        }
        sendInputNow(true);
    };

    const setStartOverlayOpen = function (opened) {
        if (!startOverlay) {
            return;
        }
        startOverlay.hidden = !opened;
        startOverlay.classList.toggle('is-game-menu', Boolean(opened && gameStarted));
        if (escMenuButton) {
            escMenuButton.classList.toggle('is-active', Boolean(opened && gameStarted));
            escMenuButton.setAttribute('aria-pressed', opened && gameStarted ? 'true' : 'false');
        }
        if (startButton) {
            startButton.textContent = opened && gameStarted
                ? (startButton.dataset.continueLabel || 'Continue')
                : (startButton.dataset.startLabel || 'Start!');
        }
        if (opened && gameStarted) {
            clearGameplayInputForStartOverlay();
        }
    };

    const resumeGameFromStartOverlay = function () {
        const skinChangedSinceConnection = gameStarted && selectedSkinName !== activeSelfSkinName;
        setStartOverlayOpen(false);
        if (!gameStarted) {
            startGame();
            return;
        }
        if (skinChangedSinceConnection) {
            connect();
        }
    };

    const runEscapeAction = function () {
        if (skinModal && !skinModal.hidden) {
            setSkinModalOpen(false);
            return true;
        }
        if (startOverlay && !startOverlay.hidden) {
            resumeGameFromStartOverlay();
            return true;
        }
        let handled = false;
        if (isFullscreenMode) {
            setFullscreenMode(false);
            handled = true;
        }
        if (gameStarted && !selfDeathActive) {
            setStartOverlayOpen(true);
            return true;
        }
        return handled;
    };

    const returnToInitialStartScreen = function () {
        gameStarted = false;
        idleReconnectBlocked = true;
        reconnectAttemptInFlight = false;
        manualStartAutoRespawnPending = false;
        window.clearTimeout(reconnectTimer);
        stopInputLoop();
        stopPingLoop();
        const socketToClose = activeSocket || socket;
        activeSocket = null;
        socket = null;
        if (socketToClose) {
            try {
                socketToClose.close();
            } catch (error) {}
        }
        handleIdleTimeoutDisconnect();
        setIdleModalOpen(false);
        setSkinModalOpen(false);
        setLoadingOverlayOpen(false);
        setStartOverlayOpen(true);
    };

    const releaseInitialLoadingOverlay = function () {
        const hideOverlay = function () {
            window.setTimeout(function () {
                setLoadingOverlayOpen(false);
            }, 260);
        };

        if (window.document.readyState === 'complete') {
            hideOverlay();
            return;
        }

        window.addEventListener('load', hideOverlay, { once: true });
    };

    const setLoadingOverlayOpen = function (opened) {
        if (!loadingOverlay) {
            return;
        }
        loadingOverlay.hidden = !opened;
        if (opened) {
            loadingTrailPoints = [];
            loadingTrailLastAt = 0;
            startLoadingCaptionAnimation();
        } else {
            loadingTrailPoints = [];
            loadingTrailLastAt = 0;
            if (loadingMainNode) {
                loadingMainNode.style.transform = 'translate(-9999px, -9999px)';
            }
            loadingTrailNodes.forEach(function (trailNode) {
                trailNode.style.opacity = '0';
                trailNode.style.transform = 'translate(-9999px, -9999px)';
            });
            stopLoadingCaptionAnimation();
        }
    };

    const updateLoadingSpinner = function (nowMs) {
        if (!loadingSpinner || !loadingMainNode) {
            return;
        }

        const orbitRadius = 62;
        const iconSize = 39;
        const centerX = 82;
        const centerY = 82;
        const cycleMs = 1050;
        const angle = (nowMs / cycleMs) * Math.PI * 2;
        const posX = centerX + Math.cos(angle - Math.PI / 2) * orbitRadius;
        const posY = centerY + Math.sin(angle - Math.PI / 2) * orbitRadius;
        const rotation = angle;
        const translateX = posX - iconSize / 2;
        const translateY = posY - iconSize / 2;
        const trailFadeDurationMs = 980;

        loadingMainNode.style.opacity = '1';
        loadingMainNode.style.transform = `translate(${translateX}px, ${translateY}px) rotate(${rotation}rad)`;

        if (!loadingTrailLastAt || nowMs - loadingTrailLastAt >= 80) {
            loadingTrailPoints.push({
                x: translateX,
                y: translateY,
                rotation,
                expiresAt: nowMs + trailFadeDurationMs
            });
            loadingTrailLastAt = nowMs;
        }

        if (loadingTrailPoints.length) {
            loadingTrailPoints = loadingTrailPoints.filter(function (trailPoint) {
                return trailPoint.expiresAt > nowMs;
            });
        }

        loadingTrailNodes.forEach(function (trailNode, index) {
            const trailPoint = loadingTrailPoints[loadingTrailPoints.length - 1 - index];
            if (!trailPoint) {
                trailNode.style.opacity = '0';
                trailNode.style.transform = 'translate(-9999px, -9999px)';
                return;
            }
            const fadeRatio = Math.max(0, Math.min(1, (trailPoint.expiresAt - nowMs) / trailFadeDurationMs));
            const alpha = 0.58 * ((loadingTrailNodes.length - index) / loadingTrailNodes.length) * fadeRatio;
            trailNode.style.opacity = String(alpha);
            trailNode.style.transform = `translate(${trailPoint.x}px, ${trailPoint.y}px) rotate(${trailPoint.rotation}rad)`;
        });
    };

    const loadingMessageOptions = [
        {
            type: 'single',
            messages: [
                '스피키 네발로 퇴화하는중......'
            ]
        },
        {
            type: 'single',
            messages: [
                '호박친구와 숨바꼭질 하는중......'
            ]
        },
        {
            type: 'single',
            messages: [
                '사제장 호출하는 중......'
            ]
        },
        {
            type: 'single',
            messages: [
                '셰이디가 엘리아스에 차원문 여는중......'
            ]
        },
        {
            type: 'sequence',
            messages: [
                '네르가 도끼를 찾는 중…...',
                '네르가 아직도 도끼를 찾는 중…...',
                '여왕님! 제 도끼들고 뭐하시는 거에요!',
                '네르가 에르핀을 쫓는중......'
            ]
        }
    ];
    let loadingMessageMode = 'single';
    let loadingMessageSequence = [];
    let lastLoadingMessageOptionIndex = -1;

    const pickNextLoadingMessageSelection = function () {
        let nextIndex = Math.floor(Math.random() * loadingMessageOptions.length);
        if (loadingMessageOptions.length > 1 && nextIndex === lastLoadingMessageOptionIndex) {
            nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (loadingMessageOptions.length - 1))) % loadingMessageOptions.length;
        }
        lastLoadingMessageOptionIndex = nextIndex;
        const selection = loadingMessageOptions[nextIndex] || loadingMessageOptions[0];
        loadingMessageMode = selection.type || 'single';
        loadingMessageSequence = Array.isArray(selection.messages) ? selection.messages.slice() : [];
        loadingCaptionMessageIndex = 0;
    };

    const stopLoadingCaptionAnimation = function () {
        if (loadingCaptionTimer) {
            window.clearTimeout(loadingCaptionTimer);
            loadingCaptionTimer = null;
        }
        if (loadingCaption) {
            loadingCaption.textContent = '';
        }
    };

    const scheduleLoadingCaptionTick = function (delay) {
        loadingCaptionTimer = window.setTimeout(runLoadingCaptionTick, delay);
    };

    const runLoadingCaptionTick = function () {
        if (!loadingCaption || !loadingOverlay || loadingOverlay.hidden) {
            return;
        }
        const now = Date.now();
        const message = loadingMessageSequence[loadingCaptionMessageIndex] || '';

        if (loadingCaptionPauseUntil > now) {
            scheduleLoadingCaptionTick(90);
            return;
        }

        if (loadingCaptionStep > message.length) {
            loadingCaptionStep = 0;
            loadingCaptionPauseUntil = now + 260;
            if (loadingMessageMode === 'sequence') {
                loadingCaptionMessageIndex += 1;
                if (loadingCaptionMessageIndex >= loadingMessageSequence.length) {
                    pickNextLoadingMessageSelection();
                }
            } else {
                pickNextLoadingMessageSelection();
            }
            loadingCaption.textContent = '';
            scheduleLoadingCaptionTick(120);
            return;
        }

        loadingCaption.textContent = message.slice(0, loadingCaptionStep);
        loadingCaptionStep += 1;
        if (loadingCaptionStep > message.length) {
            loadingCaptionPauseUntil = now + 520;
            scheduleLoadingCaptionTick(120);
            return;
        }
        scheduleLoadingCaptionTick(message.charAt(loadingCaptionStep - 1) === '.' ? 120 : 70);
    };

    const startLoadingCaptionAnimation = function () {
        if (!loadingCaption || loadingCaptionTimer) {
            return;
        }
        pickNextLoadingMessageSelection();
        loadingCaptionStep = 1;
        loadingCaptionPauseUntil = 0;
        runLoadingCaptionTick();
    };

    const getSpectatablePlayers = function () {
        return renderPlayers.filter(function (player) {
            return !player.isNpc && !player.isDummy && !player.isPumpkinNpc && player.id !== selfId && !player.deathActive;
        });
    };

    const getServerDisplayName = function (serverPlayer) {
        if (serverPlayer && serverPlayer.isPumpkinNpc) {
            return '';
        }
        return (serverPlayer && typeof serverPlayer.displayName === 'string' && serverPlayer.displayName.length)
            ? serverPlayer.displayName
            : (serverPlayer && serverPlayer.id) || '';
    };

    const syncSpectateTarget = function () {
        const spectatablePlayers = getSpectatablePlayers();
        if (!spectatablePlayers.length) {
            spectateTargetId = '';
            return spectatablePlayers;
        }
        const hasCurrentTarget = spectatablePlayers.some(function (player) {
            return player.id === spectateTargetId;
        });
        if (!hasCurrentTarget) {
            spectateTargetId = spectatablePlayers[0].id;
        }
        return spectatablePlayers;
    };

    const cycleSpectateTarget = function (direction) {
        const spectatablePlayers = syncSpectateTarget();
        if (!spectatablePlayers.length) {
            return;
        }
        const currentIndex = spectatablePlayers.findIndex(function (player) {
            return player.id === spectateTargetId;
        });
        const safeIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (safeIndex + direction + spectatablePlayers.length) % spectatablePlayers.length;
        spectateTargetId = spectatablePlayers[nextIndex].id;
    };

    const setDeathModalState = function (opened, respawnReady, livesRemaining) {
        if (!deathModal) {
            return;
        }

        const safeLivesRemaining = Math.max(0, Number(livesRemaining || 0));
        const spectatablePlayers = syncSpectateTarget();
        const canSpectate = opened && respawnReady && spectatablePlayers.length > 0;
        const shouldHideForRespawn = respawnRequestPending && opened && respawnReady && safeLivesRemaining > 0;
        deathModal.hidden = !opened || shouldHideForRespawn;
        if (opened && roundResetAnnouncementActive) {
            roundResetAnnouncementLatched = true;
        }
        if (deathModalTitleNode) {
            deathModalTitleNode.textContent = (opened && roundResetAnnouncementLatched)
                ? deathGameOverTitleLabel
                : deathTitleLabel;
        }
        if (deathModalRespawnButton) {
            if (!opened) {
                deathModalRespawnButton.textContent = deathRespawnLabel;
            } else {
                deathModalRespawnButton.textContent = safeLivesRemaining > 0 ? deathRespawnLabel : deathNoLivesLabel;
            }
            deathModalRespawnButton.hidden = false;
            deathModalRespawnButton.disabled = !respawnReady || safeLivesRemaining <= 0;
        }
        if (deathModalSpectateWrap) {
            deathModalSpectateWrap.hidden = !canSpectate;
        }
        if (deathModalSpectateLabel) {
            deathModalSpectateLabel.textContent = canSpectate
                ? ((spectatablePlayers.find(function (player) { return player.id === spectateTargetId; }) || spectatablePlayers[0]).displayName
                    || (spectatablePlayers.find(function (player) { return player.id === spectateTargetId; }) || spectatablePlayers[0]).id)
                : deathSpectateEmptyLabel;
        }
        if (deathModalSpectatePrevButton) {
            deathModalSpectatePrevButton.disabled = !canSpectate || spectatablePlayers.length <= 1;
        }
        if (deathModalSpectateNextButton) {
            deathModalSpectateNextButton.disabled = !canSpectate || spectatablePlayers.length <= 1;
        }
        if (!opened || !respawnReady || safeLivesRemaining <= 0) {
            input.respawn = false;
        }
    };

    const setMobileControlsOpen = function (opened) {
        if (!mobileControls) {
            return;
        }
        mobileControls.hidden = !opened;
        if (mobileControlsToggle) {
            mobileControlsToggle.classList.toggle('is-active', opened);
            mobileControlsToggle.setAttribute('aria-pressed', opened ? 'true' : 'false');
        }
    };

    const isMobileSizedViewport = function () {
        const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        return Math.min(viewportWidth, viewportHeight) <= 900;
    };

    const updateCompactViewportUI = function () {
        isCompactViewport = isMobileSizedViewport();
        if (topActions) {
            topActions.hidden = !isCompactViewport;
        }
        if (!isCompactViewport) {
            setMobileControlsOpen(false);
        }
    };

    const setSharedLives = function (value, currentHealth, maxHealth, options) {
        if (!sharedLivesCountNode) {
            return;
        }
        const opts = options || {};
        const safeLevel = Math.max(1, Number(value || 1));
        const safeCurrentHealth = Math.max(0, Number(currentHealth || 0));
        const safeMaxHealth = Math.max(1, Number(maxHealth || 1));
        if (opts.levelText) {
            sharedLivesCountNode.textContent = opts.levelText + ' · ' + safeCurrentHealth + '/' + safeMaxHealth;
            return;
        }
        sharedLivesCountNode.textContent = 'Lv ' + safeLevel + ' · ' + safeCurrentHealth + '/' + safeMaxHealth;
    };
    setSharedLives(selfLevel, selfCurrentHealth, selfMaxHealth);

    const buildDoubleHudLevelText = function (player) {
        if (!player || !player.doubleState || !Array.isArray(player.doubleState.units)) {
            return '';
        }
        const aliveUnits = player.doubleState.units.filter(function (unit) {
            const unitMaxHealth = Math.max(1, Math.round(Number(unit && unit.maxHealth || unit && unit.level || 1)));
            const unitCurrentHealth = Math.max(0, Math.min(unitMaxHealth, Math.round(Number(unit && unit.currentHealth !== undefined ? unit.currentHealth : unit && unit.health || 0))));
            return unitCurrentHealth > 0;
        });
        if (!aliveUnits.length) {
            return '';
        }
        return 'Lv ' + aliveUnits.map(function (unit) {
            return Math.max(1, Math.round(Number(unit && unit.level || 1)));
        }).join('-');
    };

    const syncFullscreenViewportSize = function () {
        const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        if (isFullscreenMode) {
            root.style.setProperty('--multiplayer-mobile-vw', viewportWidth + 'px');
            root.style.setProperty('--multiplayer-mobile-vh', viewportHeight + 'px');
        } else {
            root.style.removeProperty('--multiplayer-mobile-vw');
            root.style.removeProperty('--multiplayer-mobile-vh');
        }
        updateCompactViewportUI();
    };

    const setFullscreenMode = function (enabled) {
        isFullscreenMode = Boolean(enabled);
        syncFullscreenViewportSize();
        root.classList.toggle('is-fullscreen', isFullscreenMode);
        root.classList.toggle('is-default-fullscreen', !isFullscreenMode);
        document.body.classList.toggle('multiplayer-fullscreen-active', isFullscreenMode);

        if (fullscreenExitButton) {
            fullscreenExitButton.hidden = !isFullscreenMode;
        }

        if (isFullscreenMode) {
            setMobileControlsOpen(true);
        } else {
            setMobileControlsOpen(false);
            resetJoystick();
            input.boost = false;
            sendInputNow();
        }
    };

    const resetJoystick = function () {
        joystickPointerId = null;
        joystickDirectionInput.up = false;
        joystickDirectionInput.down = false;
        joystickDirectionInput.left = false;
        joystickDirectionInput.right = false;
        joystickAnalogInput.x = 0;
        joystickAnalogInput.y = 0;
        syncDirectionalInput();
        if (joystickKnob) {
            joystickKnob.style.transform = 'translate(0, 0)';
        }
        sendInputNow();
    };

    const updateJoystickInput = function (clientX, clientY) {
        if (!joystick || !joystickKnob || selfDeathActive) {
            return;
        }
        const rect = joystick.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const screenX = clientX - centerX;
        const screenY = clientY - centerY;
        const rawX = isFullscreenMode ? screenY : screenX;
        const rawY = isFullscreenMode ? -screenX : screenY;
        const maxRadius = rect.width * 0.28;
        const magnitude = Math.hypot(rawX, rawY);
        const limitedRatio = magnitude > maxRadius && magnitude > 0 ? maxRadius / magnitude : 1;
        const limitedX = rawX * limitedRatio;
        const limitedY = rawY * limitedRatio;
        const normalizedX = maxRadius > 0 ? limitedX / maxRadius : 0;
        const normalizedY = maxRadius > 0 ? limitedY / maxRadius : 0;
        const threshold = 0.34;
        const analogMagnitude = Math.hypot(normalizedX, normalizedY);
        const analogActive = analogMagnitude > 0.1;

        joystickKnob.style.transform = 'translate(' + limitedX + 'px, ' + limitedY + 'px)';
        joystickAnalogInput.x = analogActive ? normalizedX : 0;
        joystickAnalogInput.y = analogActive ? normalizedY : 0;
        joystickDirectionInput.left = normalizedX < -threshold;
        joystickDirectionInput.right = normalizedX > threshold;
        joystickDirectionInput.up = normalizedY < -threshold;
        joystickDirectionInput.down = normalizedY > threshold;
        syncDirectionalInput();
        sendInputNow();
    };

    const getSpatialVolume = function (listenerPlayer, emitterPlayer, maxVolume, minVolume) {
        if (!listenerPlayer || !emitterPlayer) {
            return maxVolume;
        }

        const normalizedMinVolume = Math.max(0, Math.min(maxVolume, Number(minVolume || 0)));
        const distance = Math.hypot(emitterPlayer.x - listenerPlayer.x, emitterPlayer.y - listenerPlayer.y);
        if (distance >= soundHearingRadius) {
            return normalizedMinVolume;
        }

        const distanceRatio = 1 - distance / soundHearingRadius;
        return Math.max(
            normalizedMinVolume,
            maxVolume * distanceRatio * distanceRatio * distanceRatio * distanceRatio
        );
    };

    const getSpatialPan = function (listenerPlayer, emitterPlayer) {
        if (!listenerPlayer || !emitterPlayer) {
            return 0;
        }
        const dx = Number(emitterPlayer.x || 0) - Number(listenerPlayer.x || 0);
        return Math.max(-1, Math.min(1, dx / soundHearingRadius));
    };

    const getSpatialAudio = function (listenerPlayer, emitterPlayer, maxVolume, minVolume) {
        return {
            volume: getSpatialVolume(listenerPlayer, emitterPlayer, maxVolume, minVolume),
            pan: getSpatialPan(listenerPlayer, emitterPlayer)
        };
    };

    const getRemoteCharacterSpatialAudio = function (listenerPlayer, emitterPlayer) {
        return getSpatialAudio(listenerPlayer, emitterPlayer, 0.95, remoteCharacterSoundMinVolume);
    };

    const stopPlayerSound = function (playerId) {
        const pendingTimer = pendingPlayerSoundTimers.get(playerId);
        if (pendingTimer) {
            window.clearTimeout(pendingTimer);
            pendingPlayerSoundTimers.delete(playerId);
        }
        const activeSound = activePlayerSounds.get(playerId);
        if (!activeSound) {
            return;
        }

        if (activeSound.kind === 'audio' && activeSound.audio) {
            try {
                activeSound.audio.pause();
                activeSound.audio.currentTime = 0;
            } catch (error) {}
        }

        if (activeSound.source) {
            try {
                activeSound.source.disconnect();
            } catch (error) {}
        }

        if (activeSound.panner) {
            try {
                activeSound.panner.disconnect();
            } catch (error) {}
        }

        if (activeSound.gain) {
            try {
                activeSound.gain.disconnect();
            } catch (error) {}
        }

        if (activeSound.kind === 'buffer' && activeSound.source) {
            try {
                activeSound.source.stop(0);
            } catch (error) {}
        }

        activePlayerSounds.delete(playerId);
    };

    const stopPlayerSoundFamily = function (playerIdPrefix) {
        if (!playerIdPrefix) {
            return;
        }
        Array.from(pendingPlayerSoundTimers.keys()).forEach(function (key) {
            if (key === playerIdPrefix || key.indexOf(playerIdPrefix + ':') === 0) {
                const timerId = pendingPlayerSoundTimers.get(key);
                if (timerId) {
                    window.clearTimeout(timerId);
                }
                pendingPlayerSoundTimers.delete(key);
            }
        });
        Array.from(activePlayerSounds.keys()).forEach(function (key) {
            if (key === playerIdPrefix || key.indexOf(playerIdPrefix + ':') === 0) {
                stopPlayerSound(key);
            }
        });
    };

    const stopAllPlayerSounds = function () {
        Array.from(pendingPlayerSoundTimers.keys()).forEach(function (key) {
            const timerId = pendingPlayerSoundTimers.get(key);
            if (timerId) {
                window.clearTimeout(timerId);
            }
        });
        pendingPlayerSoundTimers.clear();
        Array.from(activePlayerSounds.keys()).forEach(function (key) {
            stopPlayerSound(key);
        });
    };

    const readMutePreference = function (storageKey) {
        try {
            return window.localStorage.getItem(storageKey) === '1';
        } catch (error) {
            return false;
        }
    };

    const writeMutePreference = function (storageKey, nextValue) {
        try {
            window.localStorage.setItem(storageKey, nextValue ? '1' : '0');
        } catch (error) {}
    };

    const syncMasterVolumeSliderVisual = function () {
        if (!masterVolumeSlider) {
            return;
        }
        const percent = Math.max(0, Math.min(100, Number(masterVolumeSlider.value || 20)));
        masterVolumeSlider.style.setProperty('--multiplayer-volume-percent', percent + '%');
    };

    const applyMusicMuteState = function () {
        if (backgroundMusicAudio) {
            backgroundMusicAudio.muted = musicMuted;
            backgroundMusicAudio.volume = Math.max(0, Math.min(1, masterVolume * 0.5));
        }
        const musicNodes = root.querySelectorAll('audio[data-game-music]');
        musicNodes.forEach(function (node) {
            node.muted = musicMuted;
            node.volume = Math.max(0, Math.min(1, masterVolume * 0.5));
        });
    };

    const stopBackgroundMusic = function () {
        if (!backgroundMusicAudio) {
            currentBackgroundMusicKey = '';
            backgroundMusicAutoplayBlocked = false;
            return;
        }
        try {
            backgroundMusicAudio.pause();
            backgroundMusicAudio.currentTime = 0;
        } catch (error) {}
        backgroundMusicAudio = null;
        currentBackgroundMusicKey = '';
        backgroundMusicAutoplayBlocked = false;
    };

    const tryPlayBackgroundMusic = function () {
        if (!backgroundMusicAudio) {
            return;
        }
        backgroundMusicAudio.play().then(function () {
            backgroundMusicAutoplayBlocked = false;
        }).catch(function () {
            backgroundMusicAutoplayBlocked = true;
        });
    };

    const getEncounterMusicKey = function () {
        if (!gameStarted) {
            return '1pa';
        }
        if (!activeSocket || activeSocket.readyState !== window.WebSocket.OPEN) {
            return encounterStage === 0 ? '1pa' : currentBackgroundMusicKey;
        }
        if (encounterStage === 0) {
            return '1pa';
        }
        if (encounterStage === 1) {
            return '1hou';
        }
        if (encounterStage === 2) {
            return '2pa';
        }
        if (encounterStage === 3) {
            return '2hou';
        }
        if (encounterStage === 4) {
            return '3pa';
        }
        if (encounterStage === 5) {
            return '3hou';
        }
        if (encounterStage === 6) {
            return 'ed';
        }
        return '';
    };

    const updateBackgroundMusic = function () {
        const nextMusicKey = getEncounterMusicKey();
        const nextUrl = nextMusicKey ? String(ostUrls[nextMusicKey] || '').trim() : '';
        if (!nextUrl) {
            stopBackgroundMusic();
            return;
        }
        if (currentBackgroundMusicKey === nextMusicKey && backgroundMusicAudio) {
            applyMusicMuteState();
            if (backgroundMusicAudio.paused || backgroundMusicAutoplayBlocked) {
                tryPlayBackgroundMusic();
            }
            return;
        }
        stopBackgroundMusic();
        backgroundMusicAudio = new window.Audio(nextUrl);
        backgroundMusicAudio.loop = true;
        backgroundMusicAudio.volume = Math.max(0, Math.min(1, masterVolume * 0.5));
        currentBackgroundMusicKey = nextMusicKey;
        applyMusicMuteState();
        tryPlayBackgroundMusic();
    };

    const updateAudioToggleButtons = function () {
        if (musicMuteToggleButton) {
            musicMuteToggleButton.classList.toggle('is-muted', musicMuted);
            musicMuteToggleButton.setAttribute('aria-pressed', musicMuted ? 'true' : 'false');
        }
        if (sfxMuteToggleButton) {
            sfxMuteToggleButton.classList.toggle('is-muted', effectsMuted);
            sfxMuteToggleButton.setAttribute('aria-pressed', effectsMuted ? 'true' : 'false');
        }
    };

    const getEffectiveVolume = function (volume) {
        const normalizedVolume = typeof volume === 'number' ? volume : 1;
        if (effectsMuted) {
            return 0;
        }
        return Math.max(0, Math.min(1, normalizedVolume * masterVolume));
    };

    const getAllCharacterSoundUrls = function () {
        const soundUrls = new Set();
        const soundGroups = [
            'boost_sound_urls',
            'crash_sound_urls',
            'defeat_sound_urls',
            'die_sound_urls',
            'respawn_sound_urls',
            'ntr_sound_urls'
        ];
        skinCatalog.forEach(function (skin) {
            const assets = skin && skin.assets ? skin.assets : {};
            soundGroups.forEach(function (groupName) {
                const urls = assets[groupName];
                if (Array.isArray(urls)) {
                    urls.forEach(function (url) {
                        if (url) {
                            soundUrls.add(url);
                        }
                    });
                }
            });
        });
        nerTrackingSoundUrls.concat(nerAccelerationSoundUrls).forEach(function (url) {
            if (url) {
                soundUrls.add(url);
            }
        });
        return Array.from(soundUrls);
    };

    const getCharacterSoundNormalizationGain = function (buffer) {
        if (!buffer || !buffer.length || !buffer.numberOfChannels) {
            return 1;
        }
        const sampleStep = Math.max(1, Math.floor(buffer.length / 120000));
        let sampleCount = 0;
        let squaredTotal = 0;
        let peak = 0;
        for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
            const channel = buffer.getChannelData(channelIndex);
            for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += sampleStep) {
                const sample = channel[sampleIndex];
                squaredTotal += sample * sample;
                peak = Math.max(peak, Math.abs(sample));
                sampleCount += 1;
            }
        }
        if (!sampleCount) {
            return 1;
        }
        const rms = Math.sqrt(squaredTotal / sampleCount);
        const targetGain = rms > 0.0001 ? characterSoundTargetRms / rms : 1;
        const peakSafeGain = peak > 0.0001 ? 0.95 / peak : characterSoundMaxNormalizationGain;
        return Math.max(0.55, Math.min(characterSoundMaxNormalizationGain, targetGain, peakSafeGain));
    };

    const decodeCharacterSound = function (context, audioData) {
        return new Promise(function (resolve, reject) {
            try {
                const decoded = context.decodeAudioData(audioData, resolve, reject);
                if (decoded && typeof decoded.then === 'function') {
                    decoded.then(resolve, reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    };

    const preloadCharacterSound = function (url) {
        if (!url || characterSoundPreloadByUrl.has(url)) {
            return characterSoundPreloadByUrl.get(url) || Promise.resolve();
        }
        const context = getAudioContext();
        if (!context || typeof window.fetch !== 'function') {
            return Promise.resolve();
        }
        const preload = window.fetch(url, { credentials: 'same-origin' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Unable to preload character sound');
                }
                return response.arrayBuffer();
            })
            .then(function (audioData) {
                return decodeCharacterSound(context, audioData);
            })
            .then(function (buffer) {
                characterSoundBufferByUrl.set(url, {
                    buffer: buffer,
                    normalizationGain: getCharacterSoundNormalizationGain(buffer)
                });
            })
            .catch(function () {
                // Keep the HTMLAudio fallback available if a browser cannot decode a file here.
            });
        characterSoundPreloadByUrl.set(url, preload);
        return preload;
    };

    const primeCharacterAudio = function () {
        getAudioContext();
        getAllCharacterSoundUrls().forEach(preloadCharacterSound);
    };

    const playBufferedAudioFile = function (url, effectiveVolume, playerId, pan) {
        const soundEntry = characterSoundBufferByUrl.get(url);
        const context = getAudioContext();
        if (!soundEntry || !context || context.state !== 'running' || effectiveVolume <= 0.01) {
            return false;
        }
        try {
            stopPlayerSound(playerId);
            const source = context.createBufferSource();
            const gain = context.createGain();
            const panner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
            source.buffer = soundEntry.buffer;
            gain.gain.value = effectiveVolume * soundEntry.normalizationGain;
            source.connect(gain);
            if (panner) {
                panner.pan.value = Math.max(-1, Math.min(1, Number(pan || 0)));
                gain.connect(panner);
                panner.connect(context.destination);
            } else {
                gain.connect(context.destination);
            }
            activePlayerSounds.set(playerId, {
                kind: 'buffer',
                source: source,
                gain: gain,
                panner: panner
            });
            source.addEventListener('ended', function () {
                if (activePlayerSounds.get(playerId)?.source === source) {
                    try {
                        source.disconnect();
                    } catch (error) {}
                    try {
                        gain.disconnect();
                    } catch (error) {}
                    if (panner) {
                        try {
                            panner.disconnect();
                        } catch (error) {}
                    }
                    activePlayerSounds.delete(playerId);
                }
            });
            source.start(0);
            return true;
        } catch (error) {
            return false;
        }
    };

    const connectSoundToStereoOutput = function (sound, pan) {
        const context = getAudioContext();
        if (!context || typeof context.createMediaElementSource !== 'function' || typeof context.createStereoPanner !== 'function') {
            return null;
        }
        try {
            const source = context.createMediaElementSource(sound);
            const panner = context.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, Number(pan || 0)));
            source.connect(panner);
            panner.connect(context.destination);
            return {
                source: source,
                panner: panner
            };
        } catch (error) {
            return null;
        }
    };

    const playAudioFile = function (url, volume, playerId, pan) {
        const effectiveVolume = getEffectiveVolume(volume);
        if (!url || effectiveVolume <= 0.01) {
            return;
        }

        if (playBufferedAudioFile(url, effectiveVolume, playerId, pan)) {
            return;
        }
        preloadCharacterSound(url);

        stopPlayerSound(playerId);
        const sound = new window.Audio(url);
        sound.volume = effectiveVolume;
        const stereoNodes = connectSoundToStereoOutput(sound, pan);
        activePlayerSounds.set(playerId, {
            kind: 'audio',
            audio: sound,
            source: stereoNodes ? stereoNodes.source : null,
            panner: stereoNodes ? stereoNodes.panner : null
        });
        sound.addEventListener('ended', function () {
            if (activePlayerSounds.get(playerId)?.audio === sound) {
                if (stereoNodes) {
                    try {
                        stereoNodes.source.disconnect();
                    } catch (error) {}
                    try {
                        stereoNodes.panner.disconnect();
                    } catch (error) {}
                }
                activePlayerSounds.delete(playerId);
            }
        });
        sound.play().catch(function () {});
    };

    const selectRandomSoundUrl = function (urls) {
        if (!Array.isArray(urls) || !urls.length) {
            return '';
        }
        if (urls.length === 1) {
            return urls[0] || '';
        }
        const lastUrl = lastRandomSoundUrlByList.get(urls) || '';
        const availableUrls = urls.filter(function (url) {
            return url && url !== lastUrl;
        });
        const candidateUrls = availableUrls.length ? availableUrls : urls.filter(Boolean);
        if (!candidateUrls.length) {
            return '';
        }
        const selectedUrl = candidateUrls[Math.floor(Math.random() * candidateUrls.length)];
        if (selectedUrl) {
            lastRandomSoundUrlByList.set(urls, selectedUrl);
        }
        return selectedUrl || '';
    };

    const playRandomSoundFromList = function (urls, fallbackVolume, volume, playerId, pan) {
        const selectedUrl = selectRandomSoundUrl(urls);
        if (!selectedUrl) {
            return;
        }
        playAudioFile(selectedUrl, typeof volume === 'number' ? volume : fallbackVolume, playerId, pan);
    };

    const playMergedDoubleSoundFromList = function (urls, fallbackVolume, volume, playerId, pan) {
        if (!Array.isArray(urls) || !urls.length || !playerId) {
            return;
        }
        const selectedUrl = selectRandomSoundUrl(urls);
        if (!selectedUrl) {
            return;
        }
        const resolvedVolume = typeof volume === 'number' ? volume : fallbackVolume;
        stopPlayerSoundFamily(playerId);
        playAudioFile(selectedUrl, resolvedVolume, playerId, pan);
    };

    const playRandomBoostSound = function (urls, volume, playerId, pan) {
        playRandomSoundFromList(urls, 0.9, volume, playerId, pan);
    };

    const getAudioContext = function () {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
            return null;
        }
        if (!audioContext) {
            audioContext = new AudioContextCtor();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(function () {});
        }
        return audioContext;
    };

    const playRandomCrashSound = function (urls, volume, playerId, pan) {
        playRandomSoundFromList(urls, 0.95, volume, playerId, pan);
    };

    const playRandomDefeatSound = function (urls, volume, playerId, pan) {
        playRandomSoundFromList(urls, 0.95, volume, playerId, pan);
    };

    const playRandomDieSound = function (urls, volume, playerId, pan) {
        playRandomSoundFromList(urls, 0.98, volume, playerId, pan);
    };

    const playRandomRespawnSound = function (urls, volume, playerId, pan) {
        playRandomSoundFromList(urls, 0.92, volume, playerId, pan);
    };

    const playRandomNtrSound = function (urls, volume, playerId, pan) {
        playRandomSoundFromList(urls, 0.95, volume, playerId, pan);
    };

    const syncDoubleUnitAudioSnapshots = function (player) {
        if (!player || !player.doubleState || !Array.isArray(player.doubleState.units)) {
            return;
        }
        player.doubleState.units.forEach(function (unit, unitIndex) {
            const audioId = player.id + ':double:' + unitIndex;
            const unitHealth = Math.max(0, Number(unit && unit.currentHealth !== undefined ? unit.currentHealth : unit && unit.health || 0));
            playerAudioStates.set(audioId, {
                boostState: unit.boostState || 'idle',
                collisionActive: Boolean(unit.collisionActive),
                collisionVisualType: unit.collisionVisualType || 'win',
                inactive: Boolean(unit.inactive),
                health: unitHealth
            });
        });
    };

    const processDoubleUnitSounds = function (player, listenerPlayer, isSelfPlayer) {
        if (!player || !player.doubleState || !Array.isArray(player.doubleState.units)) {
            return;
        }

        const skinRuntime = getSkinConfig('default');
        player.doubleState.units.forEach(function (unit, unitIndex) {
            const audioId = player.id + ':double:' + unitIndex;
            const previousState = playerAudioStates.get(audioId) || {
                boostState: 'idle',
                collisionActive: false,
                collisionVisualType: 'win',
                inactive: false,
                health: Math.max(0, Number(unit && unit.currentHealth !== undefined ? unit.currentHealth : unit && unit.health || 0))
            };
            const unitAudio = isSelfPlayer
                ? { volume: undefined, pan: 0 }
                : getRemoteCharacterSpatialAudio(listenerPlayer, {
                    x: Number(unit.x || player.x || 0),
                    y: Number(unit.y || player.y || 0)
                });

            const unitInactive = Boolean(unit.inactive);
            if (!unitInactive) {
                if (unit.boostState === 'charging' && previousState.boostState !== 'charging') {
                    playRandomBoostSound(skinRuntime.sounds.boost, unitAudio.volume, audioId, unitAudio.pan);
                }

                if (unit.collisionActive && !previousState.collisionActive) {
                    if ((unit.collisionVisualType || 'win') === 'defeat') {
                        playRandomDefeatSound(skinRuntime.sounds.defeat, unitAudio.volume, audioId, unitAudio.pan);
                    } else {
                        playRandomCrashSound(skinRuntime.sounds.crash, unitAudio.volume, audioId, unitAudio.pan);
                    }
                }
            }

            const unitHealth = Math.max(0, Number(unit && unit.currentHealth !== undefined ? unit.currentHealth : unit && unit.health || 0));
            if (unitInactive && Number(previousState.health || 0) > 0 && unitHealth <= 0) {
                playRandomDieSound(skinRuntime.sounds.die, unitAudio.volume, audioId, unitAudio.pan);
            }

            if (!unitInactive && Number(previousState.health || 0) <= 0 && unitHealth > 0) {
                playRandomRespawnSound(skinRuntime.sounds.respawn, unitAudio.volume, audioId, unitAudio.pan);
            }

            playerAudioStates.set(audioId, {
                boostState: unit.boostState || 'idle',
                collisionActive: Boolean(unit.collisionActive),
                collisionVisualType: unit.collisionVisualType || 'win',
                inactive: Boolean(unit.inactive),
                health: unitHealth
            });
        });
    };

    const playRandomNerTrackingSound = function (volume, playerId, pan) {
        if (!nerTrackingSoundUrls.length) {
            return;
        }

        const selectedUrl = selectRandomSoundUrl(nerTrackingSoundUrls);
        if (!selectedUrl) {
            return;
        }

        playAudioFile(selectedUrl, typeof volume === 'number' ? volume : 0.9, playerId, pan);
    };

    const playRandomNerAccelerationSound = function (volume, playerId, pan) {
        if (!nerAccelerationSoundUrls.length) {
            return;
        }

        const selectedUrl = selectRandomSoundUrl(nerAccelerationSoundUrls);
        if (!selectedUrl) {
            return;
        }

        playAudioFile(selectedUrl, typeof volume === 'number' ? volume : 0.95, playerId, pan);
    };

    const processRemotePlayerSounds = function (players, listenerPlayer) {
        players.forEach(function (player) {
            const previousState = playerAudioStates.get(player.id) || {
                boostState: 'idle',
                collisionActive: false,
                collisionVisualType: 'win',
                deathActive: false,
                npcState: '',
                skinName: ''
            };

            if (player.id !== selfId && player.isHouse) {
                playerAudioStates.set(player.id, {
                    boostState: 'idle',
                    collisionActive: false,
                    collisionVisualType: 'win',
                    deathActive: false,
                    npcState: '',
                    skinName: ''
                });
                return;
            }

            if (player.id !== selfId && player.isNpc) {
                const npcAudio = getSpatialAudio(listenerPlayer, player, 0.95);

                if ((player.npcState || '') === 'chase' && previousState.npcState !== 'chase') {
                    playRandomNerTrackingSound(npcAudio.volume, player.id, npcAudio.pan);
                }

                if ((player.npcState || '') === 'windup' && previousState.npcState !== 'windup') {
                    playRandomNerAccelerationSound(npcAudio.volume, player.id, npcAudio.pan);
                }
            } else if (player.id !== selfId && !player.isNpc && !player.isPumpkinNpc && !player.isDummy && !player.isHouse) {
                if (getPlayerSkinProfile(player.skinName || 'default').type === 'double' && player.doubleState) {
                    if (!player.doubleState.merged && !player.deathActive) {
                        processDoubleUnitSounds(player, listenerPlayer, false);
                    } else {
                        syncDoubleUnitAudioSnapshots(player);
                    }
                }
                const playerAudio = getRemoteCharacterSpatialAudio(listenerPlayer, player);
                const skinRuntime = getSkinConfig(player.skinName);
                const isMergedDouble = getPlayerSkinProfile(player.skinName || 'default').type === 'double'
                    && player.doubleState
                    && Boolean(player.doubleState.merged);
                const enteredPumpkinForm = player.skinName === 'pumkin' && previousState.skinName && previousState.skinName !== 'pumkin';

                if (enteredPumpkinForm) {
                    playRandomRespawnSound(getSkinConfig('pumkin').sounds.respawn, playerAudio.volume, player.id, playerAudio.pan);
                }

                if (player.boostState === 'charging' && previousState.boostState !== 'charging') {
                    if (isMergedDouble) {
                        playMergedDoubleSoundFromList(skinRuntime.sounds.boost, 0.9, playerAudio.volume * 0.95, player.id, playerAudio.pan);
                    } else {
                        playRandomBoostSound(skinRuntime.sounds.boost, playerAudio.volume * 0.95, player.id, playerAudio.pan);
                    }
                }

                if (player.collisionActive && !previousState.collisionActive) {
                    if ((player.collisionVisualType || 'win') === 'defeat') {
                        if (isMergedDouble) {
                            playMergedDoubleSoundFromList(skinRuntime.sounds.defeat, 0.95, playerAudio.volume, player.id, playerAudio.pan);
                        } else {
                            playRandomDefeatSound(skinRuntime.sounds.defeat, playerAudio.volume, player.id, playerAudio.pan);
                        }
                    } else {
                        if (isMergedDouble) {
                            playMergedDoubleSoundFromList(skinRuntime.sounds.crash, 0.95, playerAudio.volume, player.id, playerAudio.pan);
                        } else {
                            playRandomCrashSound(skinRuntime.sounds.crash, playerAudio.volume, player.id, playerAudio.pan);
                        }
                    }
                }

                if (player.deathActive && !previousState.deathActive) {
                    if (isMergedDouble) {
                        playMergedDoubleSoundFromList(skinRuntime.sounds.die, 0.98, playerAudio.volume, player.id, playerAudio.pan);
                    } else {
                        playRandomDieSound(skinRuntime.sounds.die, playerAudio.volume, player.id, playerAudio.pan);
                    }
                }

                if (!player.deathActive && previousState.deathActive) {
                    if (isMergedDouble) {
                        playMergedDoubleSoundFromList(skinRuntime.sounds.respawn, 0.92, playerAudio.volume, player.id, playerAudio.pan);
                    } else {
                        playRandomRespawnSound(skinRuntime.sounds.respawn, playerAudio.volume, player.id, playerAudio.pan);
                    }
                }
            }

            playerAudioStates.set(player.id, {
                boostState: player.boostState || 'idle',
                npcState: player.npcState || '',
                collisionActive: Boolean(player.collisionActive),
                collisionVisualType: player.collisionVisualType || 'win',
                deathActive: Boolean(player.deathActive),
                skinName: player.skinName || 'default'
            });
        });

        playerAudioStates.forEach(function (_, id) {
            const stillExists = players.some(function (player) {
                if (player.id === id) {
                    return true;
                }
                if (id.indexOf(player.id + ':double:') !== 0) {
                    return id.indexOf(player.id + ':merged-echo') === 0;
                }
                if (id.indexOf(player.id + ':merged-echo') === 0) {
                    return Boolean(
                        getPlayerSkinProfile(player.skinName || 'default').type === 'double' &&
                        player.doubleState &&
                        player.doubleState.merged
                    );
                }
                return Boolean(
                    getPlayerSkinProfile(player.skinName || 'default').type === 'double' &&
                    player.doubleState &&
                    !player.doubleState.merged
                );
            });
            if (!stillExists) {
                stopPlayerSound(id);
                playerAudioStates.delete(id);
            }
        });
    };

    const getPlayerVisual = function (id) {
        if (!playerVisuals.has(id)) {
            playerVisuals.set(id, {
                previousX: null,
                previousY: null,
                currentFlipX: 1,
                targetFlipX: 1,
                flipFromX: 1,
                flipProgress: 1,
                currentRotation: 0,
                targetRotation: 0,
                trailPoints: [],
                lastTrailAt: 0,
                lastNpcPhase: null,
                phaseShiftStartedAt: 0,
                phaseShiftUntil: 0,
                npcWinVisualActive: false,
                npcWinIconIndex: 0,
                defaultIconSetIndex: Math.floor(Math.random() * 3),
                collisionIconSetIndex: Math.floor(Math.random() * 3),
                defeatIconIndex: 0,
                playerWinVisualActive: false,
                playerWinIconIndex: 0,
                stopVisualActive: false,
                stopIconIndex: 0,
                collisionVisualActive: false,
                finaleActive: false,
                finaleStuntPattern: 0,
                pumpkinNtrTriggerCount: 0,
                pumpkinNtrVisualUntil: 0,
                lastHouseHealth: null,
                houseShakeStartedAt: 0,
                houseShakeUntil: 0
            });
        }
        return playerVisuals.get(id);
    };

    const normalizeAngle = function (angle) {
        let nextAngle = angle;
        while (nextAngle > Math.PI) {
            nextAngle -= Math.PI * 2;
        }
        while (nextAngle < -Math.PI) {
            nextAngle += Math.PI * 2;
        }
        return nextAngle;
    };

    const easeInOut = function (value) {
        return 0.5 - Math.cos(value * Math.PI) / 2;
    };

    const normalizeVector = function (dx, dy) {
        const magnitude = Math.hypot(dx, dy);
        if (magnitude < 0.0001) {
            return { dx: 0, dy: 0 };
        }
        return {
            dx: dx / magnitude,
            dy: dy / magnitude
        };
    };

    const setVisualDirection = function (visual, dx, dy, options) {
        if (!visual) {
            return;
        }

        const usesLeftFacingSprite = Boolean(options && options.usesLeftFacingSprite);

        const movementMagnitude = Math.hypot(dx, dy);
        if (movementMagnitude < 0.001) {
            return;
        }

        if (Math.abs(dx) > 0.001) {
            const nextFlipX = usesLeftFacingSprite
                ? (dx < 0 ? 1 : -1)
                : (dx < 0 ? -1 : 1);
            if (visual.targetFlipX !== nextFlipX) {
                visual.flipFromX = visual.currentFlipX;
                visual.targetFlipX = nextFlipX;
                visual.flipProgress = 0;
            }
        }

        const baseRotation = Math.atan2(dy, Math.abs(dx));
        const logicalFlipX = usesLeftFacingSprite ? -visual.targetFlipX : visual.targetFlipX;
        visual.targetRotation = logicalFlipX < 0 ? -baseRotation : baseRotation;
    };

    const getPlayerDirectionVector = function (player, visual) {
        if (!player || !visual) {
            return { dx: 0, dy: 0 };
        }

        if (Boolean(player.collisionActive) || Boolean(player.collisionRecoveryActive)) {
            const collisionVelocityX = Number(player.velocityX || 0);
            const collisionVelocityY = Number(player.velocityY || 0);
            if (Math.hypot(collisionVelocityX, collisionVelocityY) > 0.001) {
                return {
                    dx: collisionVelocityX,
                    dy: collisionVelocityY
                };
            }
            if (Math.abs(Number(player.collisionImpactX || 0)) > 0.001 || Math.abs(Number(player.collisionImpactY || 0)) > 0.001) {
                return {
                    dx: Number(player.collisionImpactX || 0),
                    dy: Number(player.collisionImpactY || 0)
                };
            }
        }

        if (player.id === selfId && (boostState === 'charging' || boostState === 'cooldown')) {
            if (Math.hypot(boostDirectionX, boostDirectionY) > 0.001) {
                return {
                    dx: boostDirectionX,
                    dy: boostDirectionY
                };
            }
        }

        if (player.id === selfId) {
            const inputVector = getInputVector();
            if (Math.hypot(inputVector.dx, inputVector.dy) > 0.001) {
                return inputVector;
            }
        }

        if ((Boolean(player.isNpc) || Boolean(player.isDummy)) && typeof player.facingAngle === 'number') {
            return {
                dx: Math.cos(player.facingAngle),
                dy: Math.sin(player.facingAngle)
            };
        }

        const hasVelocity = typeof player.velocityX === 'number' && typeof player.velocityY === 'number';
        if (Boolean(player.isNpc) && hasVelocity) {
            const velocityMagnitude = Math.hypot(player.velocityX, player.velocityY);
            if (velocityMagnitude > 0.001) {
                return {
                    dx: player.velocityX,
                    dy: player.velocityY
                };
            }
        }

        if (player.id !== selfId && hasVelocity) {
            return {
                dx: player.velocityX,
                dy: player.velocityY
            };
        }

        return {
            dx: player.x - visual.previousX,
            dy: player.y - visual.previousY
        };
    };

    const updateVisualAnimation = function (visual, deltaSeconds) {
        if (!visual) {
            return;
        }

        const rotationDiff = normalizeAngle(visual.targetRotation - visual.currentRotation);
        const rotationStep = Math.min(1, rotationLerpPerSecond * deltaSeconds);
        visual.currentRotation = normalizeAngle(visual.currentRotation + rotationDiff * rotationStep);

        if (visual.flipProgress < 1) {
            visual.flipProgress = Math.min(1, visual.flipProgress + deltaSeconds / flipDurationSeconds);
            visual.currentFlipX =
                visual.flipFromX + (visual.targetFlipX - visual.flipFromX) * easeInOut(visual.flipProgress);
            return;
        }

        visual.currentFlipX += (visual.targetFlipX - visual.currentFlipX) * Math.min(1, 18 * deltaSeconds);
    };

    const updatePredictedDoubleState = function (authoritativePlayer, deltaSeconds, inputVector, movementVector, selfReconcileLerp) {
        if (!predictedSelf || !authoritativePlayer || !authoritativePlayer.doubleState || !Array.isArray(authoritativePlayer.doubleState.units)) {
            return;
        }

        const authoritativeDoubleState = authoritativePlayer.doubleState;
        if (!predictedSelf.doubleState || !Array.isArray(predictedSelf.doubleState.units) || predictedSelf.doubleState.units.length !== authoritativeDoubleState.units.length) {
            predictedSelf.doubleState = JSON.parse(JSON.stringify(authoritativeDoubleState));
        }

        predictedSelf.doubleState.merged = Boolean(authoritativeDoubleState.merged);
        predictedSelf.doubleState.phase = authoritativeDoubleState.phase;

        const aliveUnits = [];
        authoritativeDoubleState.units.forEach(function (unit, unitIndex) {
            if (!predictedSelf.doubleState.units[unitIndex]) {
                predictedSelf.doubleState.units[unitIndex] = JSON.parse(JSON.stringify(unit));
            }
            const predictedUnit = predictedSelf.doubleState.units[unitIndex];
            const wasCollisionActive = Boolean(predictedUnit.collisionActive);
            const wasRecoveryActive = Boolean(predictedUnit.collisionRecoveryActive);
            predictedUnit.level = unit.level;
            predictedUnit.health = unit.health;
            predictedUnit.currentHealth = unit.currentHealth;
            predictedUnit.maxHealth = unit.maxHealth;
            predictedUnit.sizeMultiplier = unit.sizeMultiplier;
            predictedUnit.currentSpeed = unit.currentSpeed;
            predictedUnit.boostState = unit.boostState;
            predictedUnit.collisionActive = unit.collisionActive;
            predictedUnit.collisionImpactActive = unit.collisionImpactActive;
            predictedUnit.collisionVisualType = unit.collisionVisualType;
            predictedUnit.collisionImpactX = unit.collisionImpactX;
            predictedUnit.collisionImpactY = unit.collisionImpactY;
            predictedUnit.collisionRecoveryActive = unit.collisionRecoveryActive;
            predictedUnit.collisionRecoveryRemainingMs = unit.collisionRecoveryRemainingMs;
            predictedUnit.collisionRecoveryDurationMs = unit.collisionRecoveryDurationMs;
            predictedUnit.boostLockedActive = unit.boostLockedActive;
            predictedUnit.boostLockRemainingMs = unit.boostLockRemainingMs;
            predictedUnit.boostLockDurationMs = unit.boostLockDurationMs;
            predictedUnit.inactive = unit.inactive;
            predictedUnit.facingAngle = typeof unit.facingAngle === 'number' ? unit.facingAngle : 0;
            if (typeof predictedUnit.x !== 'number' || typeof predictedUnit.y !== 'number' || unit.inactive !== predictedUnit.inactive) {
                predictedUnit.x = unit.x;
                predictedUnit.y = unit.y;
            }
            if ((!wasCollisionActive && predictedUnit.collisionActive) || (!wasRecoveryActive && predictedUnit.collisionRecoveryActive)) {
                predictedUnit.x = unit.x;
                predictedUnit.y = unit.y;
            }
            if (!unit.inactive) {
                aliveUnits.push(unitIndex);
            } else {
                predictedUnit.x = unit.x;
                predictedUnit.y = unit.y;
            }
        });

        if (!aliveUnits.length) {
            return;
        }

        const localInputActive = Math.hypot(inputVector.dx, inputVector.dy) > 0.001;
        const usingBoostVector = Math.hypot(movementVector.dx, movementVector.dy) > 0.001;

        aliveUnits.forEach(function (unitIndex) {
            const authoritativeUnit = authoritativeDoubleState.units[unitIndex];
            const predictedUnit = predictedSelf.doubleState.units[unitIndex];
            let desiredVector = { dx: 0, dy: 0 };
            const authoritativeVelocityVector = normalizeVector(authoritativeUnit.velocityX || 0, authoritativeUnit.velocityY || 0);
            const authoritativeUnitBoosting = authoritativeUnit.boostState === 'charging' || authoritativeUnit.boostState === 'cooldown';

            if (authoritativeUnit.collisionActive || authoritativeUnit.collisionRecoveryActive) {
                desiredVector = normalizeVector(authoritativeUnit.velocityX || 0, authoritativeUnit.velocityY || 0);
            } else if (authoritativeUnitBoosting && Math.hypot(authoritativeVelocityVector.dx, authoritativeVelocityVector.dy) > 0.001) {
                desiredVector = authoritativeVelocityVector;
            } else if (aliveUnits.length === 1) {
                if (usingBoostVector && authoritativeUnitBoosting) {
                    desiredVector = normalizeVector(movementVector.dx, movementVector.dy);
                } else if (localInputActive) {
                    desiredVector = normalizeVector(inputVector.dx, inputVector.dy);
                } else if (typeof authoritativeUnit.velocityX === 'number' || typeof authoritativeUnit.velocityY === 'number') {
                    desiredVector = normalizeVector(authoritativeUnit.velocityX || 0, authoritativeUnit.velocityY || 0);
                }
            } else if (localInputActive && authoritativeUnit.boostState === 'idle') {
                const otherIndex = aliveUnits.find(function (candidate) { return candidate !== unitIndex; });
                const otherPredictedUnit = typeof otherIndex === 'number' ? predictedSelf.doubleState.units[otherIndex] : null;
                if (otherPredictedUnit) {
                    const diffX = otherPredictedUnit.x - predictedUnit.x;
                    const diffY = otherPredictedUnit.y - predictedUnit.y;
                    const distance = Math.hypot(diffX, diffY);
                    if (distance > 0.001) {
                        const attractionRatio = Math.max(0, Math.min(1, 1 - (distance / (((defaultPlayerAspectRatio * playerSpriteHeight) * 0.72) * 6))));
                        const steerAngle = (5 * Math.PI / 180) + ((45 * Math.PI / 180) - (5 * Math.PI / 180)) * attractionRatio;
                        const inputAngle = Math.atan2(inputVector.dy, inputVector.dx);
                        const attractionAngle = Math.atan2(diffY, diffX);
                        const angleDelta = normalizeAngle(attractionAngle - inputAngle);
                        const lateralDistance = Math.abs((-inputVector.dy * diffX) + (inputVector.dx * diffY));
                        if (Math.abs(angleDelta) <= (3 * Math.PI / 180) || lateralDistance <= ((defaultPlayerAspectRatio * playerSpriteHeight) * 0.72 * 0.35)) {
                            desiredVector = normalizeVector(inputVector.dx, inputVector.dy);
                        } else {
                            const appliedAngle = Math.sign(angleDelta || 1) * Math.min(Math.abs(angleDelta), steerAngle);
                            const rotated = {
                                dx: inputVector.dx * Math.cos(appliedAngle) - inputVector.dy * Math.sin(appliedAngle),
                                dy: inputVector.dx * Math.sin(appliedAngle) + inputVector.dy * Math.cos(appliedAngle)
                            };
                            desiredVector = normalizeVector(rotated.dx, rotated.dy);
                        }
                    }
                }
            } else if (usingBoostVector && authoritativeUnitBoosting) {
                desiredVector = normalizeVector(movementVector.dx, movementVector.dy);
            } else if (typeof authoritativeUnit.velocityX === 'number' || typeof authoritativeUnit.velocityY === 'number') {
                desiredVector = normalizeVector(authoritativeUnit.velocityX || 0, authoritativeUnit.velocityY || 0);
            }

            predictedUnit.renderDirectionX = desiredVector.dx;
            predictedUnit.renderDirectionY = desiredVector.dy;

            predictedUnit.x = clampToWorld(predictedUnit.x + desiredVector.dx * Number(authoritativeUnit.currentSpeed || 0) * deltaSeconds);
            predictedUnit.y = clampToWorld(predictedUnit.y + desiredVector.dy * Number(authoritativeUnit.currentSpeed || 0) * deltaSeconds);

            const diffX = authoritativeUnit.x - predictedUnit.x;
            const diffY = authoritativeUnit.y - predictedUnit.y;
            const diffDistance = Math.hypot(diffX, diffY);
            const unitSnapDistance = selfSnapDistance;
            const unitIgnoreDistance = selfIgnoreDistance;
            if (diffDistance > unitSnapDistance) {
                predictedUnit.x = authoritativeUnit.x;
                predictedUnit.y = authoritativeUnit.y;
            } else if (diffDistance > unitIgnoreDistance) {
                const unitReconcileLerp = (authoritativeUnit.collisionActive || authoritativeUnit.collisionRecoveryActive)
                    ? Math.max(selfReconcileLerp, 0.55)
                    : selfReconcileLerp;
                predictedUnit.x += diffX * unitReconcileLerp;
                predictedUnit.y += diffY * unitReconcileLerp;
            }
        });

        if (aliveUnits.length > 1) {
            const livePredictedUnits = aliveUnits.map(function (unitIndex) {
                return predictedSelf.doubleState.units[unitIndex];
            }).filter(Boolean);
            if (livePredictedUnits.length) {
                predictedSelf.x = livePredictedUnits.reduce(function (sum, unit) { return sum + unit.x; }, 0) / livePredictedUnits.length;
                predictedSelf.y = livePredictedUnits.reduce(function (sum, unit) { return sum + unit.y; }, 0) / livePredictedUnits.length;
            }
        } else if (aliveUnits.length === 1) {
            const liveUnit = predictedSelf.doubleState.units[aliveUnits[0]];
            if (liveUnit) {
                predictedSelf.x = liveUnit.x;
                predictedSelf.y = liveUnit.y;
            }
        }
    };

    const updateMoveSpeed = function (deltaSeconds, inputVector) {
        const isMoving = inputVector.dx !== 0 || inputVector.dy !== 0;
        const selectedBaseSpeed = getSelectedPlayerBaseSpeed();
        const selectedMaxBoostSpeed = getSelectedPlayerMaxBoostSpeed();

        if (boostLockedActive) {
            input.boost = false;
            boostState = 'idle';
            boostDirectionX = 0;
            boostDirectionY = 0;
        }

        if (input.boost && !boostLockedActive && boostState === 'idle' && isMoving) {
            boostState = 'charging';
            boostDirectionX = inputVector.dx;
            boostDirectionY = inputVector.dy;
            if (getPlayerSkinProfile(activeSelfSkinName || selectedSkinName).type === 'double' && selfDoubleMerged) {
                playMergedDoubleSoundFromList(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.boost, 0.9, undefined, selfId || '__self__');
            } else {
                playRandomBoostSound(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.boost, undefined, selfId || '__self__');
            }
        }

        const selectedDeltaSpeed = Math.max(0, selectedMaxBoostSpeed - selectedBaseSpeed);
        const boostDurationSeconds = boostDurationMs / 1000;
        const skinBoostAcceleration = selectedDeltaSpeed > 0
            ? (3 * selectedDeltaSpeed) / (2 * boostDurationSeconds)
            : boostAccelerationPerSecond;
        const skinBoostCooldown = skinBoostAcceleration * 2;

        if (boostState === 'charging') {
            currentMoveSpeed = Math.min(
                selectedMaxBoostSpeed,
                currentMoveSpeed + skinBoostAcceleration * deltaSeconds
            );
            if (currentMoveSpeed >= selectedMaxBoostSpeed) {
                boostState = 'cooldown';
            }
            return;
        }

        if (boostState === 'cooldown') {
            currentMoveSpeed = Math.max(
                selectedBaseSpeed,
                currentMoveSpeed - skinBoostCooldown * deltaSeconds
            );
            if (currentMoveSpeed <= selectedBaseSpeed) {
                currentMoveSpeed = selectedBaseSpeed;
                if (!input.boost) {
                    boostState = 'idle';
                    boostDirectionX = 0;
                    boostDirectionY = 0;
                }
            }
            return;
        }

        if (!isMoving) {
            currentMoveSpeed = Math.max(
                selectedBaseSpeed,
                currentMoveSpeed - skinBoostCooldown * deltaSeconds
            );
        } else {
            currentMoveSpeed = selectedBaseSpeed;
            boostDirectionX = 0;
            boostDirectionY = 0;
        }
    };

    const getSocketUrl = function (token) {
        const url = new URL(rawWsUrl, window.location.origin);
        if (token) {
            url.searchParams.set('token', token);
        }
        return url.toString();
    };

    const fetchGameToken = async function () {
        const requestUrl = new URL(tokenUrl, window.location.origin);
        requestUrl.searchParams.set('game', gameSlug);
        requestUrl.searchParams.set('skin', selectedSkinName || 'default');
        const response = await window.fetch(requestUrl.toString(), {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('token_request_failed');
        }

        const payload = await response.json();
        if (!payload || !payload.token) {
            throw new Error('token_missing');
        }

        return payload.token;
    };

    const stopInputLoop = function () {
        if (sendTimer !== null) {
            window.clearInterval(sendTimer);
            sendTimer = null;
        }
    };

    const stopPingLoop = function () {
        if (pingTimer !== null) {
            window.clearInterval(pingTimer);
            pingTimer = null;
        }
    };

    const startInputLoop = function () {
        stopInputLoop();
        sendTimer = window.setInterval(function () {
            sendInputNow(false);
        }, inputSendIntervalMs);
    };

    const startPingLoop = function () {
        stopPingLoop();
        setPing(null);
        pingTimer = window.setInterval(function () {
            if (!socket || socket.readyState !== window.WebSocket.OPEN) {
                return;
            }
            socket.send(JSON.stringify({
                type: 'ping',
                sentAt: Date.now()
            }));
        }, 2000);
    };

    const sendInputNow = function (force) {
        if (!socket || socket.readyState !== window.WebSocket.OPEN) {
            return;
        }
        const now = Date.now();
        const nextPayload = buildInputPayload();
        const nextSignature = JSON.stringify(nextPayload);
        if (!force && nextSignature === lastSentInputSignature && now - lastSentInputAt < inputHeartbeatMs) {
            return;
        }

        socket.send(nextSignature);
        lastSentInputSignature = nextSignature;
        lastSentInputAt = now;
    };

    const scheduleReconnect = function () {
        if (!gameStarted) {
            return;
        }
        if (reconnectAttemptInFlight) {
            return;
        }
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 1500);
    };

    const connect = async function () {
        if (!gameStarted) {
            return;
        }
        if (reconnectAttemptInFlight) {
            return;
        }

        idleReconnectBlocked = false;
        reconnectAttemptInFlight = true;
        stopInputLoop();
        stopPingLoop();
        setPing(null);
        window.clearTimeout(reconnectTimer);
        setLoadingOverlayOpen(true);
        updateBackgroundMusic();

        if (socket) {
            suppressNextCloseReconnect = true;
            try {
                socket.close();
            } catch (error) {
                reconnectAttemptInFlight = false;
                return;
            }
        }

        setStatus(labels.connecting, '#c084fc');

        let token = '';
        try {
            token = await fetchGameToken();
        } catch (error) {
            setStatus(labels.disconnected, '#ef4444');
            setLoadingOverlayOpen(false);
            stopBackgroundMusic();
            reconnectAttemptInFlight = false;
            scheduleReconnect();
            return;
        }

        socket = new window.WebSocket(getSocketUrl(token));
        socket.binaryType = 'arraybuffer';
        const nextSocket = socket;
        activeSocket = nextSocket;

        nextSocket.addEventListener('open', function () {
            if (nextSocket !== activeSocket) {
                return;
            }
            lastSentInputSignature = '';
            lastSentInputAt = 0;
            setStartOverlayOpen(false);
            setLoadingOverlayOpen(false);
            setIdleModalOpen(false);
            reconnectAttemptInFlight = false;
            setStatus(labels.connected, '#22c55e');
            updateBackgroundMusic();
            startInputLoop();
            startPingLoop();
        });

        nextSocket.addEventListener('message', function (event) {
            if (nextSocket !== activeSocket) {
                return;
            }
            let payload = null;
            try {
                if (event.data instanceof ArrayBuffer) {
                    payload = window.MessagePack.decode(new Uint8Array(event.data));
                } else {
                    payload = JSON.parse(event.data);
                }
            } catch (error) {
                return;
            }

            if (payload && payload.type === 'welcome') {
                selfId = payload.id || '';
                if (selfIdNode) {
                    selfIdNode.textContent = selfId || playerName;
                }
                predictedSelf = {
                    id: selfId,
                    x: payload.x || worldSize / 2,
                    y: payload.y || worldSize / 2
                };
                renderedSelf = {
                    id: selfId,
                    x: predictedSelf.x,
                    y: predictedSelf.y
                };
                return;
            }

            if (payload && payload.type === 'pong') {
                if (typeof payload.sentAt === 'number' && payload.sentAt > 0) {
                    setPing(Math.max(0, Math.round(Date.now() - payload.sentAt)));
                }
                return;
            }

            if (payload && payload.type === 'idle_timeout') {
                handleIdleTimeoutDisconnect();
                return;
            }

            if (payload && Array.isArray(payload.d)) {
                const receivedAt = window.performance.now();
                levelDrops = Array.isArray(payload.l) ? payload.l.slice() : [];
                // 삭제된 플레이어 제거
                if (Array.isArray(payload.r)) {
                    payload.r.forEach(function (id) { serverPlayerMap.delete(id); });
                }
                // delta를 기존 state에 merge한다. __new 플래그가 있으면 신규 플레이어다.
                payload.d.forEach(function (delta) {
                    var existing = serverPlayerMap.get(delta.id);
                    if (delta.__new || !existing) {
                        var full = Object.assign({}, delta, { clientReceivedAt: receivedAt });
                        delete full.__new;
                        serverPlayerMap.set(full.id, full);
                    } else {
                        Object.assign(existing, delta, { clientReceivedAt: receivedAt });
                    }
                });
                serverPlayers = Array.from(serverPlayerMap.values());
                const selfPlayer = serverPlayerMap.get(selfId) || null;
                updateEncounterStateFromPlayer(
                    selfPlayer ||
                    serverPlayers.find(function (player) {
                        return !player.isHouse;
                    }) ||
                    serverPlayers[0] ||
                    null
                );
                if (playerCountNode) {
                    playerCountNode.textContent = String(serverPlayers.length);
                }
                processRemotePlayerSounds(serverPlayers, selfPlayer || predictedSelf);
                if (selfPlayer) {
                    const wasSelfDeathActive = selfDeathActive;
                    const previousSelfSkinName = activeSelfSkinName || selectedSkinName || 'default';
                    const nextSelfSkinName = selfPlayer.skinName
                        ? (String(selfPlayer.skinName).trim().toLowerCase() || previousSelfSkinName)
                        : previousSelfSkinName;
                    const previousSelfPumpkinNtrTriggerCount = selfPumpkinNtrTriggerCount;
                    if (selfPlayer.skinName) {
                        activeSelfSkinName = nextSelfSkinName;
                    }
                    selfPumpkinNtrTriggerCount = Math.max(0, Number(selfPlayer.pumpkinNtrTriggerCount || 0));
                    const selfSkinType = getPlayerSkinProfile(selfPlayer.skinName || activeSelfSkinName || selectedSkinName).type;
                    selfDoubleMerged = Boolean(
                        selfSkinType === 'double' &&
                        selfPlayer.doubleState &&
                        selfPlayer.doubleState.merged
                    );
                    serverReportedMoveSpeed = typeof selfPlayer.currentSpeed === 'number'
                        ? selfPlayer.currentSpeed
                        : getSelectedPlayerBaseSpeed();
                    collisionRecoveryActive = Boolean(selfPlayer.collisionRecoveryActive);
                    boostLockedActive = Boolean(selfPlayer.boostLockedActive);
                    selfDeathActive = Boolean(selfPlayer.deathActive);
                    selfDeathRespawnReady = Boolean(selfPlayer.deathRespawnReady);
                    selfLivesRemaining = typeof selfPlayer.livesRemaining === 'number'
                        ? Math.max(0, selfPlayer.livesRemaining)
                        : 1;
                    selfLevel = typeof selfPlayer.level === 'number'
                        ? Math.max(1, Math.round(Number(selfPlayer.level || 1)))
                        : selfLevel;
                    selfCurrentHealth = typeof selfPlayer.currentHealth === 'number'
                        ? Math.max(0, Math.round(Number(selfPlayer.currentHealth || 0)))
                        : selfCurrentHealth;
                    selfMaxHealth = typeof selfPlayer.maxHealth === 'number'
                        ? Math.max(1, Math.round(Number(selfPlayer.maxHealth || 1)))
                        : selfMaxHealth;
                    if (!selfDeathActive) {
                        respawnRequestPending = false;
                        roundResetAnnouncementLatched = false;
                        manualStartAutoRespawnPending = false;
                    }
                    roundResetAnnouncementActive = Boolean(selfPlayer.roundResetAnnouncementActive);
                    const selfHudLevelText = selfSkinType === 'double'
                        ? buildDoubleHudLevelText(selfPlayer)
                        : '';
                    setSharedLives(selfLevel, selfCurrentHealth, selfMaxHealth, {
                        levelText: selfHudLevelText
                    });
                    setDeathModalState(selfDeathActive, selfDeathRespawnReady, selfLivesRemaining);
                    if (defeatReceivedCountNode) {
                        defeatReceivedCountNode.textContent = String(selfPlayer.defeatReceivedCount || 0);
                    }
                    if (defeatDealtCountNode) {
                        defeatDealtCountNode.textContent = String(selfPlayer.defeatDealtCount || 0);
                    }
                    if (selfSkinType === 'double' && selfPlayer.doubleState) {
                        if (!selfPlayer.doubleState.merged && !selfPlayer.deathActive) {
                            processDoubleUnitSounds(selfPlayer, selfPlayer, true);
                        } else {
                            syncDoubleUnitAudioSnapshots(selfPlayer);
                        }
                    } else if (Boolean(selfPlayer.collisionActive) && !selfCollisionActive) {
                        if ((selfPlayer.collisionVisualType || 'win') === 'defeat') {
                            if (selfDoubleMerged) {
                                playMergedDoubleSoundFromList(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.defeat, 0.95, undefined, selfId || '__self__');
                            } else {
                                playRandomDefeatSound(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.defeat, undefined, selfId || '__self__');
                            }
                        } else {
                            if (selfDoubleMerged) {
                                playMergedDoubleSoundFromList(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.crash, 0.95, undefined, selfId || '__self__');
                            } else {
                                playRandomCrashSound(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.crash, undefined, selfId || '__self__');
                            }
                        }
                    }
                    if (selfDeathActive && !wasSelfDeathActive) {
                        restoreConnectedSkinSelection();
                        setSkinModalOpen(false);
                        setStartOverlayOpen(false);
                        if (selfDoubleMerged) {
                            playMergedDoubleSoundFromList(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.die, 0.98, undefined, selfId || '__self__');
                        } else {
                            playRandomDieSound(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.die, undefined, selfId || '__self__');
                        }
                    }
                    if (!selfDeathActive && wasSelfDeathActive) {
                        if (selfDoubleMerged) {
                            playMergedDoubleSoundFromList(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.respawn, 0.92, undefined, selfId || '__self__');
                        } else {
                            playRandomRespawnSound(getSkinConfig(activeSelfSkinName || selectedSkinName).sounds.respawn, undefined, selfId || '__self__');
                        }
                    }
                    if (selfServerAudioStateInitialized && previousSelfSkinName && previousSelfSkinName !== 'pumkin' && nextSelfSkinName === 'pumkin') {
                        playRandomRespawnSound(getSkinConfig('pumkin').sounds.respawn, undefined, selfId || '__self__');
                    }
                    if (selfServerAudioStateInitialized && selfPumpkinNtrTriggerCount > previousSelfPumpkinNtrTriggerCount) {
                        playRandomNtrSound(getSkinConfig('pumkin').sounds.ntr, undefined, selfId || '__self__');
                        selfPumpkinNtrVisualUntil = window.performance.now() + SELF_PUMPKIN_NTR_VISUAL_DURATION_MS;
                    }
                    selfServerAudioStateInitialized = true;
                    const selfVisual = getPlayerVisual(selfPlayer.id);
                    if (selfPumpkinNtrTriggerCount > Number(selfVisual.pumpkinNtrTriggerCount || 0)) {
                        selfVisual.pumpkinNtrVisualUntil = window.performance.now() + SELF_PUMPKIN_NTR_VISUAL_DURATION_MS;
                    }
                    selfVisual.pumpkinNtrTriggerCount = selfPumpkinNtrTriggerCount;
                    selfCollisionActive = Boolean(selfPlayer.collisionActive);
                    selfCollisionImpactActive = Boolean(selfPlayer.collisionImpactActive);
                    selfCollisionVisualType = selfPlayer.collisionVisualType || 'win';
                    if (selfDeathActive) {
                        input.up = false;
                        input.down = false;
                        input.left = false;
                        input.right = false;
                        input.boost = false;
                        input.special = false;
                        currentMoveSpeed = 0;
                        boostState = 'idle';
                        resetJoystick();
                    } else {
                        input.respawn = false;
                        roundResetAnnouncementActive = false;
                    }
                    if (manualStartAutoRespawnPending && selfDeathActive && selfDeathRespawnReady && selfLivesRemaining > 0) {
                        respawnRequestPending = true;
                        input.respawn = true;
                        sendInputNow(true);
                        setDeathModalState(selfDeathActive, selfDeathRespawnReady, selfLivesRemaining);
                        manualStartAutoRespawnPending = false;
                    }
                    if (manualStartAutoRespawnPending && (!selfDeathActive || selfLivesRemaining <= 0)) {
                        manualStartAutoRespawnPending = false;
                    }
                    if (boostLockedActive) {
                        input.boost = false;
                        currentMoveSpeed = serverReportedMoveSpeed;
                        boostState = 'idle';
                    }
                    if (!predictedSelf) {
                        predictedSelf = {
                            id: selfPlayer.id,
                            x: selfPlayer.x,
                            y: selfPlayer.y
                        };
                        renderedSelf = {
                            id: selfPlayer.id,
                            x: selfPlayer.x,
                            y: selfPlayer.y
                        };
                    }
                }
            }
        });

        nextSocket.addEventListener('close', function (event) {
            if (nextSocket !== activeSocket) {
                return;
            }
            activeSocket = null;
            reconnectAttemptInFlight = false;
            setLoadingOverlayOpen(false);
            stopInputLoop();
            stopPingLoop();
            setPing(null);
            stopBackgroundMusic();
            stopPlayerSound(selfId || '__self__');
            playerAudioStates.clear();
            selfPumpkinNtrTriggerCount = 0;
            selfServerAudioStateInitialized = false;
            playerVisuals.clear();
            serverPlayerMap.clear();
            if (suppressNextCloseReconnect) {
                suppressNextCloseReconnect = false;
                return;
            }
            if (event && event.code === 4002) {
                handleIdleTimeoutDisconnect();
                return;
            }
            setStatus(labels.disconnected, '#f97316');
            if (idleReconnectBlocked) {
                return;
            }
            scheduleReconnect();
        });

        nextSocket.addEventListener('error', function () {
            if (nextSocket !== activeSocket) {
                return;
            }
            stopPingLoop();
            setPing(null);
            setLoadingOverlayOpen(false);
            stopBackgroundMusic();
            setStatus(labels.disconnected, '#ef4444');
        });
    };

    const startGame = function () {
        primeCharacterAudio();
        manualStartAutoRespawnPending = true;
        if (gameStarted) {
            connect();
            return;
        }
        gameStarted = true;
        setStartOverlayOpen(false);
        updateBackgroundMusic();
        connect();
    };

    const resizeCanvas = function () {
        const displayWidth = Math.round(canvas.parentElement?.clientWidth || canvas.clientWidth || 960);
        const displayHeight = Math.round(canvas.parentElement?.clientHeight || canvas.clientHeight || 640);
        const nextScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        const nextWidth = Math.round(displayWidth * nextScale);
        const nextHeight = Math.round(displayHeight * nextScale);
        if (canvas.width === nextWidth && canvas.height === nextHeight && canvasScale === nextScale) {
            return;
        }
        canvasScale = nextScale;
        canvas.style.removeProperty('width');
        canvas.style.removeProperty('height');
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
    };

    const drawGrid = function (cameraX, cameraY, zoom) {
        const canvasWidth = getCanvasDisplayWidth();
        const canvasHeight = getCanvasDisplayHeight();
        const step = 50;
        ctx.strokeStyle = 'rgba(161, 138, 101, 0.14)';
        ctx.lineWidth = 1;

        for (let x = 0; x <= worldSize; x += step) {
            const screenX = Math.round((x - cameraX) * zoom);
            ctx.beginPath();
            ctx.moveTo(screenX, 0);
            ctx.lineTo(screenX, canvasHeight);
            ctx.stroke();
        }

        for (let y = 0; y <= worldSize; y += step) {
            const screenY = Math.round((y - cameraY) * zoom);
            ctx.beginPath();
            ctx.moveTo(0, screenY);
            ctx.lineTo(canvasWidth, screenY);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(120, 91, 49, 0.72)';
        ctx.lineWidth = Math.max(3, 4 * zoom);
        ctx.strokeRect(
            Math.round(-cameraX * zoom),
            Math.round(-cameraY * zoom),
            Math.round(worldSize * zoom),
            Math.round(worldSize * zoom)
        );
    };

    const getPhaseBackgroundColor = function (players) {
        let destroyedHouseCount = 0;
        if (encounterFinaleActive) {
            destroyedHouseCount = 3;
        } else if (encounterStage >= 4) {
            destroyedHouseCount = 2;
        } else if (encounterStage >= 2) {
            destroyedHouseCount = 1;
        }
        const phaseRatio = Math.max(0, Math.min(1, destroyedHouseCount / 3));
        const red = Math.round(phaseOneBackgroundColor.r + (phaseThreeBackgroundColor.r - phaseOneBackgroundColor.r) * phaseRatio);
        const green = Math.round(phaseOneBackgroundColor.g + (phaseThreeBackgroundColor.g - phaseOneBackgroundColor.g) * phaseRatio);
        const blue = Math.round(phaseOneBackgroundColor.b + (phaseThreeBackgroundColor.b - phaseOneBackgroundColor.b) * phaseRatio);
        return 'rgb(' + red + ', ' + green + ', ' + blue + ')';
    };

    const getImageEntryState = function (entry) {
        return {
            activeIcon: entry && entry.image ? entry.image : null,
            activeIconReady: Boolean(entry && entry.ready)
        };
    };

    const getPlayerSkinProfile = function (skinName) {
        const normalizedName = String(skinName || 'default').trim().toLowerCase() || 'default';
        const defaultCharacterBoostSpeedMultiplier = 359.0726978998385 / 286;
        const defaultSkinProfiles = {
            default: {
                baseSpeedMultiplier: 1,
                maxBoostSpeedMultiplier: defaultCharacterBoostSpeedMultiplier,
                maxHealthSegments: 3,
                type: 'classic',
                movementType: 'classic'
            },
            happy: {
                baseSpeedMultiplier: 1,
                maxBoostSpeedMultiplier: defaultCharacterBoostSpeedMultiplier,
                maxHealthSegments: 3,
                type: 'classic',
                movementType: 'classic'
            },
            many: {
                baseSpeedMultiplier: 1,
                maxBoostSpeedMultiplier: defaultCharacterBoostSpeedMultiplier,
                maxHealthSegments: 5,
                type: 'many',
                movementType: 'classic'
            },
            double: {
                baseSpeedMultiplier: 1,
                maxBoostSpeedMultiplier: defaultCharacterBoostSpeedMultiplier,
                maxHealthSegments: 4,
                type: 'double',
                movementType: 'classic'
            },
            evolution: {
                baseSpeedMultiplier: 1,
                maxBoostSpeedMultiplier: defaultCharacterBoostSpeedMultiplier,
                maxHealthSegments: 5,
                type: 'evolution',
                movementType: 'evolution'
            },
            pumkin: {
                baseSpeedMultiplier: 1.4,
                maxBoostSpeedMultiplier: 1.137,
                maxHealthSegments: 3,
                type: 'pumkin',
                movementType: 'classic'
            }
        };
        const configuredCharacterSettings = gameplaySettings && gameplaySettings.character_settings && gameplaySettings.character_settings[normalizedName]
            ? gameplaySettings.character_settings[normalizedName]
            : null;
        const skinProfile = defaultSkinProfiles[normalizedName] || defaultSkinProfiles.default;
        const resolvedBaseSpeedMultiplier = Math.max(
            0.1,
            Number(configuredCharacterSettings && configuredCharacterSettings.base_speed_multiplier !== undefined
                ? configuredCharacterSettings.base_speed_multiplier
                : skinProfile.baseSpeedMultiplier)
        );
        const resolvedMaxBoostSpeedMultiplier = Math.max(
            0.1,
            Number(configuredCharacterSettings && configuredCharacterSettings.max_boost_speed_multiplier !== undefined
                ? configuredCharacterSettings.max_boost_speed_multiplier
                : skinProfile.maxBoostSpeedMultiplier)
        );
        const resolvedMaxHealthSegments = Math.max(
            1,
            Math.round(Number(
                configuredCharacterSettings && configuredCharacterSettings.max_health_segments !== undefined
                    ? configuredCharacterSettings.max_health_segments
                    : skinProfile.maxHealthSegments
            ))
        );
        const resolvedMovementType = String(
            configuredCharacterSettings && configuredCharacterSettings.movement_type !== undefined
                ? configuredCharacterSettings.movement_type
                : skinProfile.movementType
        ).trim().toLowerCase() === 'evolution'
            ? 'evolution'
            : 'classic';
        return {
            baseSpeed: basePlayerSpeedPerSecond * resolvedBaseSpeedMultiplier,
            maxBoostSpeed: basePlayerSpeedPerSecond * resolvedBaseSpeedMultiplier * resolvedMaxBoostSpeedMultiplier,
            maxHealthSegments: resolvedMaxHealthSegments,
            type: skinProfile.type,
            movementType: resolvedMovementType
        };
    };

    const getSelectedPlayerBaseSpeed = function () {
        return getPlayerSkinProfile(activeSelfSkinName || selectedSkinName).baseSpeed;
    };

    const getLevelBoostDistanceMultiplier = function (level) {
        const safeLevel = Math.max(1, Math.round(Number(level || 1)));
        return Math.pow(levelBoostDistanceScaleFactor, safeLevel - 1);
    };

    const getDoubleMergedBoostLevel = function (player) {
        const units = player && player.doubleState && Array.isArray(player.doubleState.units)
            ? player.doubleState.units
            : [];
        const aliveUnits = units.filter(function (unit) {
            return unit && !unit.inactive && Number(unit.health || 0) > 0;
        });
        const sourceUnits = aliveUnits.length ? aliveUnits : units;
        if (!sourceUnits.length) {
            return Math.max(1, Math.round(Number(player && player.level || selfLevel || 1)));
        }
        const totalLevel = sourceUnits.reduce(function (sum, unit) {
            return sum + Math.max(1, Math.round(Number(unit && unit.level || 1)));
        }, 0);
        return Math.max(1, Math.round(totalLevel / sourceUnits.length));
    };

    const getSelectedPlayerMaxBoostSpeed = function () {
        const skinName = activeSelfSkinName || selectedSkinName;
        const skinProfile = getPlayerSkinProfile(skinName);
        if (skinProfile.type === 'double' && predictedSelf && predictedSelf.doubleState) {
            return skinProfile.maxBoostSpeed * getLevelBoostDistanceMultiplier(getDoubleMergedBoostLevel(predictedSelf));
        }
        return skinProfile.maxBoostSpeed * getLevelBoostDistanceMultiplier(selfLevel);
    };

    currentMoveSpeed = getSelectedPlayerBaseSpeed();
    serverReportedMoveSpeed = getSelectedPlayerBaseSpeed();

    const usesLeftFacingSpriteForPlayer = function (player) {
        if (!player) {
            return false;
        }
        if (Boolean(player.isNpc)) {
            return true;
        }
        return getPlayerSkinProfile(player.skinName || 'default').movementType === 'evolution';
    };

    const getPlayerHealthSegments = function (player) {
        if (Boolean(player.deathActive)) {
            return 0;
        }
        if (typeof player.currentHealth === 'number' || typeof player.maxHealth === 'number') {
            const safeMaxHealth = Math.max(1, Math.round(Number(player.maxHealth || 1)));
            const safeCurrentHealth = Math.max(0, Math.min(safeMaxHealth, Math.round(Number(player.currentHealth || 0))));
            return safeCurrentHealth;
        }
        const skinProfile = getPlayerSkinProfile(player && player.skinName ? player.skinName : selectedSkinName);
        const defeatReceivedCount = typeof player.defeatReceivedCount === 'number'
            ? Math.max(0, player.defeatReceivedCount)
            : 0;
        const pumpkinBaseSkinName = String(player && player.pumpkinBaseSkinName || '').trim().toLowerCase();
        const maxHealthSegments = Boolean(player && player.isPumpkinNpc)
            ? PUMPKIN_NPC_HEALTH_SEGMENTS
            : (pumpkinBaseSkinName === 'double_single' ? 2 : skinProfile.maxHealthSegments);
        const defeatsInCurrentLife = defeatReceivedCount % maxHealthSegments;
        return defeatsInCurrentLife === 0 ? maxHealthSegments : Math.max(0, maxHealthSegments - defeatsInCurrentLife);
    };

    const getPlayerSpriteState = function (player, isSelf, visual) {
        const isNpc = Boolean(player.isNpc);
        const isPumpkinNpc = Boolean(player.isPumpkinNpc);
        const isDummy = Boolean(player.isDummy);
        const nowMs = window.performance.now();
        const boostStateValue = isSelf ? boostState : (player.boostState || 'idle');
        const skinName = (!isNpc || isPumpkinNpc)
            ? (isSelf ? (player.skinName || activeSelfSkinName || selectedSkinName) : (player.skinName || 'default'))
            : 'default';
        const skinProfile = getPlayerSkinProfile(skinName);
        const npcState = player.npcState || '';
        const npcPhase = isNpc ? Math.max(1, Number(player.npcPhase || 1)) : 1;
        const npcDefeatDamageRatio = isNpc
            ? Math.max(0, Math.min(1, Number(player.npcDefeatDamageRatio || 0)))
            : 0;
        const npcWinVisualActive = isNpc && Boolean(player.npcWinVisualActive);
        const isBoostVisualActive = isNpc
            ? (npcState === 'windup' || npcState === 'charging')
            : (boostStateValue === 'charging' || boostStateValue === 'cooldown');
        const isPlayerWinVisualActive = !isNpc && Boolean(player.playerWinVisualActive);
        const isStopVisualActive = !isNpc && Boolean(player.stopVisualActive);
        const isCollisionVisualActive = Boolean(player.collisionActive);
        const isCollisionImpactActive = Boolean(player.collisionImpactActive);
        const isDefeatVisualActive = isCollisionVisualActive && player.collisionVisualType === 'defeat';
        const isDeathVisualActive = Boolean(player.deathActive);
        const npcChargeWindupProgress = typeof player.npcChargeWindupProgress === 'number'
            ? Math.max(0, Math.min(1, player.npcChargeWindupProgress))
            : 0;
        const npcBoostState = typeof player.boostState === 'string' ? player.boostState : 'idle';
        const isNpcChargeVisualActive = isNpc && (npcChargeWindupProgress > 0 || npcBoostState === 'charging');
        const isNpcDefeatIconActive = isNpc && isDefeatVisualActive && !isDeathVisualActive && npcDefeatDamageRatio >= 0.4;
        const growthScale = isPumpkinNpc ? 1 : Math.max(0.6, Number(player && player.sizeMultiplier || 1));
        const spriteScale = isNpc
            ? (isNpcChargeVisualActive ? 2.0 : 2.8)
            : ((skinProfile.type === 'pumkin' || isPumpkinNpc) ? 2 : 1) * growthScale;
        const skinRuntime = (!isNpc || isPumpkinNpc) ? getSkinConfig(skinName) : null;
        let activeIcon = null;
        let activeIconReady = false;

        if (isNpc) {
            if (npcPhase >= 3 && playerNpcPhase3IconReady) {
                activeIcon = playerNpcPhase3Icon;
                activeIconReady = playerNpcPhase3IconReady;
            } else if (npcPhase >= 2 && playerNpcPhase2IconReady) {
                activeIcon = playerNpcPhase2Icon;
                activeIconReady = playerNpcPhase2IconReady;
            } else {
                activeIcon = playerNpcIcon;
                activeIconReady = playerNpcIconReady;
            }
        }

        if (isNpc && isNpcChargeVisualActive && playerNpcBoostIconReady) {
            activeIcon = playerNpcBoostIcon;
            activeIconReady = playerNpcBoostIconReady;
        } else if (isNpc && npcWinVisualActive && playerNpcWinIcons.length) {
            const selectedWinIcon = playerNpcWinIcons[visual && typeof visual.npcWinIconIndex === 'number'
                ? visual.npcWinIconIndex % playerNpcWinIcons.length
                : 0];
            if (selectedWinIcon && selectedWinIcon.ready) {
                activeIcon = selectedWinIcon.image;
                activeIconReady = true;
            }
        } else if (isNpc && isDeathVisualActive && playerNpcDieIconReady) {
            activeIcon = playerNpcDieIcon;
            activeIconReady = playerNpcDieIconReady;
        } else if (isNpc && isDefeatVisualActive && npcDefeatDamageRatio >= 0.8 && playerNpcDefeat2IconReady) {
            activeIcon = playerNpcDefeat2Icon;
            activeIconReady = playerNpcDefeat2IconReady;
        } else if (isNpc && isDefeatVisualActive && npcDefeatDamageRatio >= 0.4 && playerNpcDefeat1IconReady) {
            activeIcon = playerNpcDefeat1Icon;
            activeIconReady = playerNpcDefeat1IconReady;
        } else if ((!isNpc || isPumpkinNpc) && skinRuntime) {
            if (isPumpkinNpc) {
                const pumpkinState = getImageEntryState(
                    skinRuntime.pumpkinNpcIcon.ready
                        ? skinRuntime.pumpkinNpcIcon
                        : (skinRuntime.previewIcon.ready ? skinRuntime.previewIcon : skinRuntime.legacyIcon)
                );
                activeIcon = pumpkinState.activeIcon;
                activeIconReady = pumpkinState.activeIconReady;
                return {
                    isNpc,
                    isPumpkinNpc,
                    isDummy,
                    npcPhase,
                    npcDefeatDamageRatio,
                    npcWinVisualActive,
                    isCollisionVisualActive,
                    isCollisionImpactActive,
                    isDefeatVisualActive,
                    isDeathVisualActive,
                    npcChargeWindupProgress,
                    npcBoostState,
                    npcState,
                    isNpcChargeVisualActive,
                    isNpcDefeatIconActive,
                    isBoostVisualActive,
                    isPlayerWinVisualActive,
                    isStopVisualActive,
                    spriteScale,
                    skinRuntime,
                    activeIcon,
                    activeIconReady
                };
            }
            const healthSegments = getPlayerHealthSegments(player);
            const defaultSet = skinRuntime.defaultIconSets.length
                ? skinRuntime.defaultIconSets[visual.defaultIconSetIndex % skinRuntime.defaultIconSets.length]
                : null;
            const collisionSet = skinRuntime.collisionIconSets.length
                ? skinRuntime.collisionIconSets[visual.collisionIconSetIndex % skinRuntime.collisionIconSets.length]
                : null;
            const defaultSkinRuntime = getSkinConfig('default');
            const forcedNtrCollisionSet = defaultSkinRuntime.collisionIconSets.length
                ? defaultSkinRuntime.collisionIconSets[visual.collisionIconSetIndex % defaultSkinRuntime.collisionIconSets.length]
                : null;
            const isPumpkinNtrVisualActive = Number((visual && visual.pumpkinNtrVisualUntil) || 0) > nowMs
                || (isSelf && Number(selfPumpkinNtrVisualUntil || 0) > nowMs);
            const movementSpeed = isSelf
                ? Math.max(0, Number(currentMoveSpeed || 0))
                : Math.max(0, Number(player.currentSpeed || 0));
            const playerBaseSpeed = skinProfile.baseSpeed;
            const playerLevelForBoost = getPlayerSkinProfile(player && player.skinName ? player.skinName : selectedSkinName).type === 'double'
                ? getDoubleMergedBoostLevel(player)
                : Math.max(1, Math.round(Number(player && player.level || selfLevel || 1)));
            const playerMaxBoostedSpeed = skinProfile.maxBoostSpeed * getLevelBoostDistanceMultiplier(playerLevelForBoost);
            const boostRatio = Math.max(
                0,
                Math.min(
                    0.999,
                    (movementSpeed - playerBaseSpeed) / Math.max(1, playerMaxBoostedSpeed - playerBaseSpeed)
                )
            );
            const boostStageIndex = boostStateValue === 'cooldown'
                ? Math.max(0, skinRuntime.boostStages.length - 1)
                : Math.min(
                    Math.max(0, skinRuntime.boostStages.length - 1),
                    Math.floor(boostRatio * Math.max(1, skinRuntime.boostStages.length))
                );
            const collisionRecoveryActive = Boolean(player.collisionRecoveryActive);
            const collisionRecoveryRemainingMs = Math.max(0, Number(player.collisionRecoveryRemainingMs || 0));
            const collisionRecoveryDurationMs = Math.max(1, Number(player.collisionRecoveryDurationMs || 1));
            const collisionRecoveryProgress = Math.max(
                0,
                Math.min(1, 1 - (collisionRecoveryRemainingMs / collisionRecoveryDurationMs))
            );
            let selectedEntry = defaultSet
                ? (healthSegments >= 3 ? defaultSet.healthy : defaultSet.damaged)
                : skinRuntime.legacyIcon;

            if (isPumpkinNtrVisualActive && forcedNtrCollisionSet && forcedNtrCollisionSet.impact) {
                selectedEntry = forcedNtrCollisionSet.impact;
            } else if (skinRuntime.skinType === 'many') {
                const manyIconIndex = Math.max(0, Math.min((skinRuntime.defaultStateIcons.length || 1) - 1, healthSegments - 1));
                if (skinRuntime.defaultStateIcons.length) {
                    selectedEntry = skinRuntime.defaultStateIcons[manyIconIndex] || selectedEntry;
                }
                if ((isDeathVisualActive || isDefeatVisualActive || (collisionRecoveryActive && player.collisionVisualType === 'defeat')) && skinRuntime.defeatStateIcons.length) {
                    selectedEntry = skinRuntime.defeatStateIcons[Math.max(0, Math.min(skinRuntime.defeatStateIcons.length - 1, healthSegments - 1))] || selectedEntry;
                } else if ((isCollisionVisualActive || collisionRecoveryActive) && player.collisionVisualType !== 'defeat' && skinRuntime.collisionStateIcons.length) {
                    selectedEntry = skinRuntime.collisionStateIcons[Math.max(0, Math.min(skinRuntime.collisionStateIcons.length - 1, healthSegments - 1))] || selectedEntry;
                } else if (isBoostVisualActive && skinRuntime.boostStages.length) {
                    selectedEntry = skinRuntime.boostStages[Math.max(0, Math.min(skinRuntime.boostStages.length - 1, healthSegments - 1))] || selectedEntry;
                }
            } else if (skinRuntime.skinType === 'evolution') {
                if (skinRuntime.defaultStateIcons.length) {
                    if (healthSegments >= 5) {
                        selectedEntry = skinRuntime.defaultStateIcons[0] || selectedEntry;
                    } else if (healthSegments >= 3) {
                        selectedEntry = skinRuntime.defaultStateIcons[Math.min(1, skinRuntime.defaultStateIcons.length - 1)] || selectedEntry;
                    } else {
                        selectedEntry = skinRuntime.defaultStateIcons[Math.min(2, skinRuntime.defaultStateIcons.length - 1)] || selectedEntry;
                    }
                }

                if (isPlayerWinVisualActive && skinRuntime.winStateIcons.length) {
                    selectedEntry = skinRuntime.winStateIcons[visual.playerWinIconIndex % skinRuntime.winStateIcons.length];
                } else if (isStopVisualActive && skinRuntime.stopStateIcons.length) {
                    selectedEntry = skinRuntime.stopStateIcons[visual.stopIconIndex % skinRuntime.stopStateIcons.length];
                } else if ((isDeathVisualActive || isDefeatVisualActive || (collisionRecoveryActive && player.collisionVisualType === 'defeat')) && skinRuntime.defeatStateIcons.length) {
                    selectedEntry = skinRuntime.defeatStateIcons[visual.defeatIconIndex % skinRuntime.defeatStateIcons.length];
                } else if (isCollisionVisualActive && skinRuntime.collisionStateIcons.length) {
                    selectedEntry = skinRuntime.collisionStateIcons[visual.collisionIconSetIndex % skinRuntime.collisionStateIcons.length];
                } else if (isBoostVisualActive && skinRuntime.boostStages.length) {
                    if (healthSegments >= 5) {
                        selectedEntry = skinRuntime.boostStages[0] || selectedEntry;
                    } else if (healthSegments >= 3) {
                        selectedEntry = skinRuntime.boostStages[Math.min(1, skinRuntime.boostStages.length - 1)] || selectedEntry;
                    } else {
                        selectedEntry = skinRuntime.boostStages[Math.min(2, skinRuntime.boostStages.length - 1)] || selectedEntry;
                    }
                }
            } else if ((isDeathVisualActive || isDefeatVisualActive || (collisionRecoveryActive && player.collisionVisualType === 'defeat')) && skinRuntime.defeatStages.length) {
                if (isDeathVisualActive) {
                    selectedEntry = skinRuntime.defeatStages[0];
                } else if (isDefeatVisualActive && isCollisionImpactActive) {
                    selectedEntry = skinRuntime.defeatStages[0];
                } else {
                    let defeatStageIndex = 0;
                    if (collisionRecoveryProgress >= (1 / 3)) {
                        defeatStageIndex = 1;
                    }
                    if (collisionRecoveryProgress >= 0.5) {
                        defeatStageIndex = 2;
                    }
                    defeatStageIndex = Math.min(skinRuntime.defeatStages.length - 1, Math.max(0, defeatStageIndex));
                    selectedEntry = skinRuntime.defeatStages[defeatStageIndex];
                }
            } else if (
                collisionSet &&
                player.collisionVisualType !== 'defeat' &&
                (isCollisionImpactActive || (collisionRecoveryActive && collisionRecoveryProgress <= (1 / 3)))
            ) {
                selectedEntry = collisionSet.impact;
            } else if (collisionRecoveryActive && collisionSet && player.collisionVisualType !== 'defeat') {
                selectedEntry = collisionSet.slow;
            } else if (isBoostVisualActive && skinRuntime.boostStages.length) {
                selectedEntry = skinRuntime.boostStages[boostStageIndex];
            }

            const selectedState = getImageEntryState(selectedEntry);
            activeIcon = selectedState.activeIcon;
            activeIconReady = selectedState.activeIconReady;

            if (!activeIconReady) {
                const fallbackState = getImageEntryState(skinRuntime.previewIcon.ready ? skinRuntime.previewIcon : skinRuntime.legacyIcon);
                activeIcon = fallbackState.activeIcon;
                activeIconReady = fallbackState.activeIconReady;
            }
        }

        return {
            isNpc,
            isPumpkinNpc,
            isDummy,
            npcPhase,
            npcDefeatDamageRatio,
            npcWinVisualActive,
            isCollisionVisualActive,
            isCollisionImpactActive,
            isDefeatVisualActive,
            isDeathVisualActive,
            npcChargeWindupProgress,
            npcBoostState,
            npcState,
            isNpcChargeVisualActive,
            isNpcDefeatIconActive,
            isBoostVisualActive,
            isPlayerWinVisualActive,
            isStopVisualActive,
            spriteScale,
            skinRuntime,
            activeIcon,
            activeIconReady
        };
    };

    const drawSpriteImage = function (drawCtx, icon, x, y, width, height, rotation, flipX, alpha) {
        drawCtx.save();
        drawCtx.globalAlpha = alpha;
        drawCtx.translate(x, y);
        drawCtx.rotate(rotation);
        drawCtx.scale(flipX, 1);
        drawCtx.drawImage(
            icon,
            -width / 2,
            -height / 2,
            width,
            height
        );
        drawCtx.restore();
    };

    const getTrailTintColor = function (trailIndex, isNpc) {
        if (isNpc) {
            return 'rgba(239, 68, 68, 0.68)';
        }
        const tintPalette = [
            'rgba(239, 68, 68, 0.68)',
            'rgba(234, 179, 8, 0.68)',
            'rgba(34, 197, 94, 0.68)',
            'rgba(6, 182, 212, 0.68)',
            'rgba(59, 130, 246, 0.68)',
            'rgba(217, 70, 239, 0.68)'
        ];
        const safeIndex = Math.max(0, trailIndex) % tintPalette.length;
        return tintPalette[safeIndex];
    };

    const drawTrailSprite = function (drawCtx, icon, x, y, width, height, rotation, flipX, alpha, tintColor) {
        const tintWidth = Math.max(1, Math.round(width));
        const tintHeight = Math.max(1, Math.round(height));
        npcTintCanvas.width = tintWidth;
        npcTintCanvas.height = tintHeight;
        npcTintContext.clearRect(0, 0, tintWidth, tintHeight);
        npcTintContext.globalCompositeOperation = 'source-over';
        npcTintContext.globalAlpha = 1;
        npcTintContext.drawImage(icon, 0, 0, tintWidth, tintHeight);
        npcTintContext.globalCompositeOperation = 'source-atop';
        npcTintContext.fillStyle = tintColor;
        npcTintContext.fillRect(0, 0, tintWidth, tintHeight);
        npcTintContext.globalCompositeOperation = 'source-over';

        drawCtx.save();
        drawCtx.translate(x, y);
        drawCtx.rotate(rotation);
        drawCtx.scale(flipX, 1);
        drawCtx.globalAlpha = alpha;
        drawCtx.drawImage(
            npcTintCanvas,
            -width / 2,
            -height / 2,
            width,
            height
        );
        drawCtx.restore();
    };

    const getDoubleUnitSpriteEntry = function (player, unit, unitVisual) {
        const skinRuntime = getSkinConfig('default');
        const defaultSet = skinRuntime.defaultIconSets.length
            ? skinRuntime.defaultIconSets[unitVisual.defaultIconSetIndex % skinRuntime.defaultIconSets.length]
            : null;
        const collisionSet = skinRuntime.collisionIconSets.length
            ? skinRuntime.collisionIconSets[unitVisual.collisionIconSetIndex % skinRuntime.collisionIconSets.length]
            : null;
        const collisionRecoveryActive = Boolean(unit.collisionRecoveryActive);
        const collisionRecoveryRemainingMs = Math.max(0, Number(unit.collisionRecoveryRemainingMs || 0));
        const collisionRecoveryDurationMs = Math.max(1, Number(unit.collisionRecoveryDurationMs || 1));
        const collisionRecoveryProgress = Math.max(
            0,
            Math.min(1, 1 - (collisionRecoveryRemainingMs / collisionRecoveryDurationMs))
        );
        let selectedEntry = defaultSet
            ? (Number(unit.health || 0) >= 2 ? defaultSet.healthy : defaultSet.damaged)
            : skinRuntime.legacyIcon;

        if ((Boolean(unit.deathActive) || Boolean(unit.collisionVisualType === 'defeat') || (collisionRecoveryActive && unit.collisionVisualType === 'defeat')) && skinRuntime.defeatStages.length) {
            if (Boolean(unit.deathActive)) {
                selectedEntry = skinRuntime.defeatStages[0];
            } else if (Boolean(unit.collisionImpactActive) && unit.collisionVisualType === 'defeat') {
                selectedEntry = skinRuntime.defeatStages[0];
            } else {
                let defeatStageIndex = 0;
                if (collisionRecoveryProgress >= (1 / 3)) {
                    defeatStageIndex = 1;
                }
                if (collisionRecoveryProgress >= 0.5) {
                    defeatStageIndex = 2;
                }
                defeatStageIndex = Math.min(skinRuntime.defeatStages.length - 1, Math.max(0, defeatStageIndex));
                selectedEntry = skinRuntime.defeatStages[defeatStageIndex];
            }
        } else if (
            collisionSet &&
            unit.collisionVisualType !== 'defeat' &&
            (Boolean(unit.collisionImpactActive) || (collisionRecoveryActive && collisionRecoveryProgress <= (1 / 3)))
        ) {
            selectedEntry = collisionSet.impact;
        } else if (collisionRecoveryActive && collisionSet && unit.collisionVisualType !== 'defeat') {
            selectedEntry = collisionSet.slow;
        } else if ((unit.boostState || 'idle') === 'charging' || (unit.boostState || 'idle') === 'cooldown') {
            const movementSpeed = Math.max(0, Number(unit.currentSpeed || 0));
            const playerBaseSpeed = getPlayerSkinProfile('double').baseSpeed;
            const playerMaxBoostedSpeed = getPlayerSkinProfile('double').maxBoostSpeed * getLevelBoostDistanceMultiplier(unit.level);
            const boostRatio = Math.max(
                0,
                Math.min(0.999, (movementSpeed - playerBaseSpeed) / Math.max(1, playerMaxBoostedSpeed - playerBaseSpeed))
            );
            const boostStageIndex = (unit.boostState || 'idle') === 'cooldown'
                ? Math.max(0, skinRuntime.boostStages.length - 1)
                : Math.min(
                    Math.max(0, skinRuntime.boostStages.length - 1),
                    Math.floor(boostRatio * Math.max(1, skinRuntime.boostStages.length))
                );
            if (skinRuntime.boostStages.length) {
                selectedEntry = skinRuntime.boostStages[boostStageIndex];
            }
        }

        return getImageEntryState(selectedEntry);
    };

    const getDoubleMergedSpriteEntry = function (player, visual, isSelf) {
        const skinRuntime = getSkinConfig('double');
        const defaultSet = skinRuntime.defaultIconSets.length
            ? skinRuntime.defaultIconSets[visual.defaultIconSetIndex % skinRuntime.defaultIconSets.length]
            : null;
        const collisionSet = skinRuntime.collisionIconSets.length
            ? skinRuntime.collisionIconSets[visual.collisionIconSetIndex % skinRuntime.collisionIconSets.length]
            : null;
        const movementSpeed = isSelf
            ? Math.max(0, Number(currentMoveSpeed || 0))
            : Math.max(0, Number(player.currentSpeed || 0));
        const playerBaseSpeed = getPlayerSkinProfile('double').baseSpeed;
        const mergedDisplayLevel = getDoubleMergedBoostLevel(player);
        const playerMaxBoostedSpeed = getPlayerSkinProfile('double').maxBoostSpeed * getLevelBoostDistanceMultiplier(mergedDisplayLevel);
        const boostRatio = Math.max(
            0,
            Math.min(
                0.999,
                (movementSpeed - playerBaseSpeed) / Math.max(1, playerMaxBoostedSpeed - playerBaseSpeed)
            )
        );
        const boostStageIndex = (isSelf ? boostState : (player.boostState || 'idle')) === 'cooldown'
            ? Math.max(0, skinRuntime.boostStages.length - 1)
            : Math.min(
                Math.max(0, skinRuntime.boostStages.length - 1),
                Math.floor(boostRatio * Math.max(1, skinRuntime.boostStages.length))
            );
        const totalHealthSegments = (player.doubleState && Array.isArray(player.doubleState.units) ? player.doubleState.units : []).reduce(function (sum, unit) {
            return sum + Math.max(0, Math.min(2, Number(unit.health || 0)));
        }, 0);
        const collisionRecoveryActive = Boolean(player.collisionRecoveryActive);
        const collisionRecoveryRemainingMs = Math.max(0, Number(player.collisionRecoveryRemainingMs || 0));
        const collisionRecoveryDurationMs = Math.max(1, Number(player.collisionRecoveryDurationMs || 1));
        const collisionRecoveryProgress = Math.max(
            0,
            Math.min(1, 1 - (collisionRecoveryRemainingMs / collisionRecoveryDurationMs))
        );
        let selectedEntry = defaultSet
            ? (totalHealthSegments >= 3 ? defaultSet.healthy : defaultSet.damaged)
            : (skinRuntime.defaultStateIcons[0] || skinRuntime.previewIcon || skinRuntime.legacyIcon);

        if ((Boolean(player.deathActive) || Boolean(player.collisionVisualType === 'defeat') || (collisionRecoveryActive && player.collisionVisualType === 'defeat')) && skinRuntime.defeatStages.length) {
            if (Boolean(player.deathActive)) {
                selectedEntry = skinRuntime.defeatStages[0];
            } else if (Boolean(player.collisionImpactActive) && player.collisionVisualType === 'defeat') {
                selectedEntry = skinRuntime.defeatStages[0];
            } else {
                let defeatStageIndex = 0;
                if (collisionRecoveryProgress >= (1 / 3)) {
                    defeatStageIndex = 1;
                }
                if (collisionRecoveryProgress >= 0.5) {
                    defeatStageIndex = 2;
                }
                defeatStageIndex = Math.min(skinRuntime.defeatStages.length - 1, Math.max(0, defeatStageIndex));
                selectedEntry = skinRuntime.defeatStages[defeatStageIndex];
            }
        } else if (
            collisionSet &&
            player.collisionVisualType !== 'defeat' &&
            (Boolean(player.collisionImpactActive) || (collisionRecoveryActive && collisionRecoveryProgress <= (1 / 3)))
        ) {
            selectedEntry = collisionSet.impact;
        } else if (collisionRecoveryActive && collisionSet && player.collisionVisualType !== 'defeat') {
            selectedEntry = collisionSet.slow;
        } else if (((player.boostState || 'idle') === 'charging' || (player.boostState || 'idle') === 'cooldown') && skinRuntime.boostStages.length) {
            selectedEntry = skinRuntime.boostStages[boostStageIndex];
        }

        const selectedState = getImageEntryState(selectedEntry);
        let activeIcon = selectedState.activeIcon;
        let activeIconReady = selectedState.activeIconReady;
        if (!activeIconReady) {
            const fallbackState = getImageEntryState(
                (defaultSet && (totalHealthSegments >= 3 ? defaultSet.healthy : defaultSet.damaged))
                    ? (totalHealthSegments >= 3 ? defaultSet.healthy : defaultSet.damaged)
                    : (skinRuntime.previewIcon.ready ? skinRuntime.previewIcon : skinRuntime.legacyIcon)
            );
            activeIcon = fallbackState.activeIcon;
            activeIconReady = fallbackState.activeIconReady;
        }

        return {
            skinRuntime: skinRuntime,
            state: {
                activeIcon: activeIcon,
                activeIconReady: activeIconReady
            }
        };
    };

    const drawDoublePlayer = function (player, visual, cameraX, cameraY, zoom, nowMs, isSelf, deltaSeconds) {
        const doubleState = player.doubleState;
        if (!doubleState || !Array.isArray(doubleState.units) || !doubleState.units.length) {
            return false;
        }

        const getUnitLevel = function (unit) {
            return Math.max(1, Math.round(Number(unit && unit.level || 1)));
        };
        const getUnitMaxHealth = function (unit) {
            return Math.max(1, Math.round(Number(unit && unit.maxHealth || getUnitLevel(unit))));
        };
        const getUnitCurrentHealth = function (unit) {
            return Math.max(0, Math.min(getUnitMaxHealth(unit), Math.round(Number(unit && unit.currentHealth !== undefined ? unit.currentHealth : unit && unit.health || 0))));
        };
        const drawUnitHealthBar = function (barX, barY, barWidth, segmentHeight, unit, fillStyle) {
            const maxHealth = getUnitMaxHealth(unit);
            const currentHealth = getUnitCurrentHealth(unit);
            const segmentGap = Math.max(1, 1 * zoom);
            const totalGap = segmentGap * Math.max(0, maxHealth - 1);
            const segmentWidth = Math.max(3, (barWidth - totalGap) / maxHealth);
            for (let segmentIndex = 0; segmentIndex < maxHealth; segmentIndex += 1) {
                const segmentX = barX + segmentIndex * (segmentWidth + segmentGap);
                ctx.fillStyle = segmentIndex < currentHealth
                    ? 'rgba(34, 197, 94, 1)'
                    : 'rgba(15, 23, 42, 0.28)';
                ctx.fillRect(segmentX, barY, segmentWidth, segmentHeight);
            }
        };

        const unitBarColors = ['rgba(125, 211, 252, 0.98)', 'rgba(37, 99, 235, 0.98)'];
        const usesLeftFacingSprite = usesLeftFacingSpriteForPlayer(player);
        const deathFadeProgress = typeof player.deathFadeProgress === 'number' ? player.deathFadeProgress : 0;
        const playerAlpha = Boolean(player.deathActive) ? Math.max(0, 1 - deathFadeProgress) : 1;
        if (!Array.isArray(visual.doubleUnitVisuals) || visual.doubleUnitVisuals.length !== doubleState.units.length) {
            visual.doubleUnitVisuals = doubleState.units.map(function () {
                return {
                    x: null,
                    y: null,
                    previousX: null,
                    previousY: null,
                    currentFlipX: 1,
                    targetFlipX: 1,
                    flipFromX: 1,
                    flipProgress: 1,
                    currentRotation: 0,
                    targetRotation: 0,
                    defaultIconSetIndex: 0,
                    collisionIconSetIndex: 0,
                    collisionVisualActive: false,
                    inactive: false,
                    inactiveStartedAt: 0,
                    trailPoints: [],
                    lastTrailAt: 0
                };
            });
        }
        const aliveUnits = doubleState.units.filter(function (unit) {
            return !unit.inactive;
        });
        const isMerged = Boolean(doubleState.merged) && aliveUnits.length > 1;
        if (playerAlpha <= 0) {
            return true;
        }

        if (isMerged) {
            const mergedDirection = getPlayerDirectionVector(player, visual);
            setVisualDirection(visual, mergedDirection.dx, mergedDirection.dy, {
                usesLeftFacingSprite: usesLeftFacingSprite
            });
            updateVisualAnimation(visual, deltaSeconds);
            const mergedSprite = getDoubleMergedSpriteEntry(player, visual, isSelf);
            const activeIcon = mergedSprite.state.activeIcon;
            const activeIconReady = mergedSprite.state.activeIconReady;
            if (!activeIconReady || !activeIcon) {
                return false;
            }

            const x = (player.x - cameraX) * zoom;
            const y = (player.y - cameraY) * zoom;
            const mergedSizeUnits = aliveUnits.length ? aliveUnits : doubleState.units;
            const mergedSizeMultiplier = mergedSizeUnits.reduce(function (sum, unit) {
                return sum + Math.max(0.6, Number(unit && unit.sizeMultiplier || 1));
            }, 0) / Math.max(1, mergedSizeUnits.length);
            const spriteHeight = playerSpriteHeight * mergedSizeMultiplier * zoom;
            const mergedAspectRatio = activeIcon.naturalWidth && activeIcon.naturalHeight
                ? (activeIcon.naturalWidth / activeIcon.naturalHeight)
                : 1.48;
            const spriteWidth = spriteHeight * mergedAspectRatio;

            drawSpriteImage(
                ctx,
                activeIcon,
                x,
                y,
                spriteWidth,
                spriteHeight,
                visual.currentRotation,
                usesLeftFacingSprite ? -visual.currentFlipX : visual.currentFlipX,
                playerAlpha
            );

            if (!player.deathActive) {
                const pairWidth = Math.max(30, defaultPlayerAspectRatio * playerSpriteHeight * zoom * 0.9);
                const segmentHeight = Math.max(4, 5 * zoom);
                const barGap = Math.max(2, 3 * zoom);
                const totalBarsWidth = pairWidth * 2 + barGap;
                const barsLeft = x - totalBarsWidth / 2;
                const healthBarY = y + spriteHeight / 2 + 6 * zoom;
                const cooldownY = healthBarY + segmentHeight + Math.max(2, 2 * zoom);

                aliveUnits.slice(0, 2).forEach(function (unit, unitIndex) {
                    const barX = barsLeft + unitIndex * (pairWidth + barGap);
                    ctx.save();
                    drawUnitHealthBar(barX, healthBarY, pairWidth, segmentHeight, unit, unitBarColors[unitIndex % unitBarColors.length]);
                    const boostLockRemainingMs = Math.max(0, Number(unit.boostLockRemainingMs || 0));
                    const boostLockDurationMs = Math.max(0, Number(unit.boostLockDurationMs || 0));
                    const boostStateValue = String(unit.boostState || 'idle');
                    let cooldownRatio = 1;
                    if (boostStateValue === 'charging' || boostStateValue === 'cooldown') {
                        cooldownRatio = 0;
                    } else if (boostLockDurationMs > 0) {
                        cooldownRatio = Math.max(0, Math.min(1, 1 - (boostLockRemainingMs / boostLockDurationMs)));
                    }
                    ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
                    ctx.fillRect(barX, cooldownY, pairWidth, segmentHeight);
                    ctx.fillStyle = unitBarColors[unitIndex % unitBarColors.length];
                    ctx.fillRect(barX, cooldownY, pairWidth * cooldownRatio, segmentHeight);
                    ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
                    ctx.font = '700 11px Inter, Noto Sans KR, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Lv.' + getUnitLevel(unit), barX + pairWidth / 2, healthBarY - 3 * zoom);
                    ctx.restore();
                });

                const mergedLabel = typeof player.displayName === 'string' ? player.displayName.trim() : '';
                if (mergedLabel) {
                    ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
                    ctx.font = '800 15px Inter, Noto Sans KR, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(mergedLabel, x, y - spriteHeight / 2 - 5 * zoom);
                }
            }
            return true;
        }

        const unitStates = doubleState.units.map(function (unit, unitIndex) {
            return {
                unit: unit,
                unitIndex: unitIndex
            };
        });

        unitStates.forEach(function (unitState) {
            const unit = unitState.unit;
            const unitVisual = visual.doubleUnitVisuals[unitState.unitIndex] || {
                x: null,
                y: null,
                previousX: null,
                previousY: null,
                currentFlipX: 1,
                targetFlipX: 1,
                flipFromX: 1,
                flipProgress: 1,
                currentRotation: 0,
                targetRotation: 0,
                defaultIconSetIndex: 0,
                collisionIconSetIndex: 0,
                collisionVisualActive: false,
                inactive: false,
                inactiveStartedAt: 0,
                trailPoints: [],
                lastTrailAt: 0
            };
            if (Boolean(unit.inactive) && !unitVisual.inactive) {
                unitVisual.inactiveStartedAt = nowMs;
            } else if (!Boolean(unit.inactive) && unitVisual.inactive) {
                unitVisual.inactiveStartedAt = 0;
            }
            unitVisual.inactive = Boolean(unit.inactive);
            const splitSkinRuntime = getSkinConfig('default');
            if (unitVisual.defaultIconSetIndex === null || typeof unitVisual.defaultIconSetIndex !== 'number') {
                unitVisual.defaultIconSetIndex = splitSkinRuntime.defaultIconSets.length
                    ? Math.floor(Math.random() * splitSkinRuntime.defaultIconSets.length)
                    : 0;
            }
            if (Boolean(unit.collisionActive) && !unitVisual.collisionVisualActive) {
                unitVisual.defaultIconSetIndex = splitSkinRuntime.defaultIconSets.length
                    ? Math.floor(Math.random() * splitSkinRuntime.defaultIconSets.length)
                    : 0;
                unitVisual.collisionIconSetIndex = splitSkinRuntime.collisionIconSets.length
                    ? Math.floor(Math.random() * splitSkinRuntime.collisionIconSets.length)
                    : 0;
            }
            unitVisual.collisionVisualActive = Boolean(unit.collisionActive);
            const unitProjectionSeconds = isSelf ? 0.06 : remoteProjectionSeconds;
            if (!unit.inactive) {
                const targetUnitX = isSelf
                    ? unit.x
                    : (typeof unit.velocityX === 'number'
                        ? unit.x + (unit.velocityX * unitProjectionSeconds)
                        : unit.x);
                const targetUnitY = isSelf
                    ? unit.y
                    : (typeof unit.velocityY === 'number'
                        ? unit.y + (unit.velocityY * unitProjectionSeconds)
                        : unit.y);
                if (unitVisual.x === null || unitVisual.y === null) {
                    unitVisual.x = targetUnitX;
                    unitVisual.y = targetUnitY;
                    unitVisual.previousX = targetUnitX;
                    unitVisual.previousY = targetUnitY;
                } else {
                    unitVisual.previousX = unitVisual.x;
                    unitVisual.previousY = unitVisual.y;
                    const splitLerp = isSelf
                        ? getFrameAdjustedLerp(selfRenderLerpPerFrame, deltaSeconds)
                        : 0.4;
                    unitVisual.x += (targetUnitX - unitVisual.x) * splitLerp;
                    unitVisual.y += (targetUnitY - unitVisual.y) * splitLerp;
                }
            } else if (unitVisual.x === null || unitVisual.y === null) {
                unitVisual.x = unit.x;
                unitVisual.y = unit.y;
                unitVisual.previousX = unit.x;
                unitVisual.previousY = unit.y;
            }
            let directionDx = unitVisual.x - (typeof unitVisual.previousX === 'number' ? unitVisual.previousX : unitVisual.x);
            let directionDy = unitVisual.y - (typeof unitVisual.previousY === 'number' ? unitVisual.previousY : unitVisual.y);
            if (
                isSelf &&
                typeof unit.renderDirectionX === 'number' &&
                typeof unit.renderDirectionY === 'number' &&
                Math.hypot(unit.renderDirectionX, unit.renderDirectionY) > 0.001
            ) {
                directionDx = unit.renderDirectionX;
                directionDy = unit.renderDirectionY;
            }
            if (Math.hypot(directionDx, directionDy) < 0.001 && typeof unit.velocityX === 'number' && typeof unit.velocityY === 'number') {
                const velocityMagnitude = Math.hypot(unit.velocityX, unit.velocityY);
                if (velocityMagnitude > 0.01) {
                    directionDx = unit.velocityX;
                    directionDy = unit.velocityY;
                }
            }
            if (
                Math.hypot(directionDx, directionDy) < 0.001 &&
                typeof unit.facingAngle === 'number'
            ) {
                directionDx = Math.cos(unit.facingAngle);
                directionDy = Math.sin(unit.facingAngle);
            }
            if (Math.hypot(directionDx, directionDy) < 0.001 && typeof player.facingAngle === 'number') {
                directionDx = Math.cos(player.facingAngle);
                directionDy = Math.sin(player.facingAngle);
            }
            setVisualDirection(unitVisual, directionDx, directionDy, {
                usesLeftFacingSprite: usesLeftFacingSprite
            });
            updateVisualAnimation(unitVisual, deltaSeconds);
            visual.doubleUnitVisuals[unitState.unitIndex] = unitVisual;
            const entryState = getDoubleUnitSpriteEntry(player, unit, unitVisual);
            const x = (unitVisual.x - cameraX) * zoom;
            const y = (unitVisual.y - cameraY) * zoom;
            const activeIcon = entryState.activeIcon;
            const activeIconReady = entryState.activeIconReady;
            if (!activeIconReady || !activeIcon) {
                return;
            }
            let unitAlpha = playerAlpha;
            if (!player.deathActive && unit.inactive) {
                const inactiveFadeProgress = unitVisual.inactiveStartedAt
                    ? Math.max(0, Math.min(1, (nowMs - unitVisual.inactiveStartedAt) / doubleUnitDeathFadeMs))
                    : 0;
                unitAlpha *= Math.max(0, 1 - inactiveFadeProgress);
                if (unitAlpha <= 0) {
                    visual.doubleUnitVisuals[unitState.unitIndex] = unitVisual;
                    return;
                }
            }

            const spriteHeight = playerSpriteHeight * Math.max(0.6, Number(unit.sizeMultiplier || 1)) * zoom;
            const spriteWidth = spriteHeight * defaultPlayerAspectRatio;
            const unitTrailActive = activeIconReady &&
                !player.deathActive &&
                !unit.inactive &&
                (unit.boostState === 'charging' || unit.boostState === 'cooldown');
            const unitTrailFadeDurationMs = 280;
            if (unitVisual.trailPoints.length) {
                unitVisual.trailPoints = unitVisual.trailPoints.filter(function (trailPoint) {
                    return !trailPoint.expiresAt || trailPoint.expiresAt > nowMs;
                });
            }
            if (unitTrailActive) {
                if (!unitVisual.lastTrailAt || nowMs - unitVisual.lastTrailAt >= 140) {
                    unitVisual.trailPoints.push({
                        x: unitVisual.x,
                        y: unitVisual.y,
                        rotation: unitVisual.currentRotation,
                        flipX: unitVisual.currentFlipX,
                        icon: activeIcon,
                        width: spriteWidth,
                        height: spriteHeight,
                        createdAt: nowMs,
                        expiresAt: 0
                    });
                    unitVisual.lastTrailAt = nowMs;
                }
                if (unitVisual.trailPoints.length > 4) {
                    unitVisual.trailPoints.shift();
                }
            } else if (unitVisual.trailPoints.length) {
                unitVisual.trailPoints.forEach(function (trailPoint) {
                    if (!trailPoint.expiresAt) {
                        trailPoint.expiresAt = nowMs + unitTrailFadeDurationMs;
                    }
                });
                unitVisual.lastTrailAt = 0;
            }

            if (unitVisual.trailPoints.length) {
                unitVisual.trailPoints.forEach(function (trailPoint, index) {
                    const trailX = (trailPoint.x - cameraX) * zoom;
                    const trailY = (trailPoint.y - cameraY) * zoom;
                    const fadeRatio = trailPoint.expiresAt
                        ? Math.max(0, Math.min(1, (trailPoint.expiresAt - nowMs) / unitTrailFadeDurationMs))
                        : 1;
                    const alpha = 0.25 * ((index + 1) / unitVisual.trailPoints.length) * fadeRatio;
                    drawTrailSprite(
                        ctx,
                        trailPoint.icon || activeIcon,
                        trailX,
                        trailY,
                        trailPoint.width || spriteWidth,
                        trailPoint.height || spriteHeight,
                        trailPoint.rotation,
                        trailPoint.flipX,
                        alpha,
                        getTrailTintColor(index, false)
                    );
                });
            }
            drawSpriteImage(
                ctx,
                activeIcon,
                x,
                y,
                spriteWidth,
                spriteHeight,
                unitVisual.currentRotation,
                usesLeftFacingSprite ? -unitVisual.currentFlipX : unitVisual.currentFlipX,
                unitAlpha
            );

            if (!player.deathActive && !unit.inactive) {
                const healthBarWidth = Math.max(24, spriteWidth * 0.9);
                const segmentHeight = Math.max(4, 5 * zoom);
                const barX = x - healthBarWidth / 2;
                const barY = y + spriteHeight / 2 + 5 * zoom;

                ctx.save();
                drawUnitHealthBar(barX, barY, healthBarWidth, segmentHeight, unit, unitBarColors[unitState.unitIndex % unitBarColors.length]);
                const boostLockRemainingMs = Math.max(0, Number(unit.boostLockRemainingMs || 0));
                const boostLockDurationMs = Math.max(0, Number(unit.boostLockDurationMs || 0));
                const boostStateValue = String(unit.boostState || 'idle');
                let cooldownRatio = 1;
                if (boostStateValue === 'charging' || boostStateValue === 'cooldown') {
                    cooldownRatio = 0;
                } else if (boostLockDurationMs > 0) {
                    cooldownRatio = Math.max(0, Math.min(1, 1 - (boostLockRemainingMs / boostLockDurationMs)));
                }
                const cooldownY = barY + segmentHeight + Math.max(2, 2 * zoom);
                ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
                ctx.fillRect(barX, cooldownY, healthBarWidth, segmentHeight);
                ctx.fillStyle = unitBarColors[unitState.unitIndex % unitBarColors.length];
                ctx.fillRect(barX, cooldownY, healthBarWidth * cooldownRatio, segmentHeight);
                ctx.restore();

                const splitUnitLabel = typeof player.displayName === 'string' ? player.displayName.trim() : '';
                if (splitUnitLabel) {
                    ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
                    ctx.font = '800 15px Inter, Noto Sans KR, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(
                        splitUnitLabel + ' Lv.' + getUnitLevel(unit),
                        x,
                        y - spriteHeight / 2 - 5 * zoom
                    );
                }
            }
        });

        if (!player.deathActive && isMerged) {
            const mergedPlayerLabel = typeof player.displayName === 'string' ? player.displayName.trim() : '';
            if (mergedPlayerLabel) {
                ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
                ctx.font = '800 15px Inter, Noto Sans KR, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(mergedPlayerLabel, (player.x - cameraX) * zoom, (player.y - cameraY) * zoom - (playerSpriteHeight * zoom) / 2 - 5 * zoom);
            }
        }
        return true;
    };

    const drawNpcFocusLines = function (drawCtx, x, y, baseRadius, phase, nowMs) {
        const isPhaseThree = phase >= 3;
        const burstCount = isPhaseThree ? 40 : 28;
        const orbitRadius = baseRadius * (isPhaseThree ? 0.64 : 0.58);
        const minBurstLength = baseRadius * (isPhaseThree ? 0.05 : 0.035);
        const maxBurstLength = baseRadius * (isPhaseThree ? 0.18 : 0.12);
        const strokeColor = isPhaseThree
            ? 'rgba(37, 99, 235, 0.98)'
            : 'rgba(59, 130, 246, 0.9)';
        const shadowColor = isPhaseThree
            ? 'rgba(191, 219, 254, 0.5)'
            : 'rgba(219, 234, 254, 0.38)';

        drawCtx.save();
        drawCtx.lineCap = 'round';
        drawCtx.shadowBlur = baseRadius * (isPhaseThree ? 0.1 : 0.06);
        drawCtx.shadowColor = shadowColor;
        for (let index = 0; index < burstCount; index += 1) {
            const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / burstCount;
            const rootX = x + Math.cos(angle) * orbitRadius;
            const rootY = y + Math.sin(angle) * orbitRadius;
            const randomSeed = Math.sin(nowMs * 0.012 + index * 17.231 + phase * 3.17) * 43758.5453;
            const randomRatio = randomSeed - Math.floor(randomSeed);
            const burstLength = minBurstLength + (maxBurstLength - minBurstLength) * randomRatio;
            const startX = rootX + Math.cos(angle) * baseRadius * 0.02;
            const startY = rootY + Math.sin(angle) * baseRadius * 0.02;
            const endX = rootX + Math.cos(angle) * burstLength;
            const endY = rootY + Math.sin(angle) * burstLength;

            drawCtx.strokeStyle = strokeColor;
            drawCtx.lineWidth = Math.max(1.2, baseRadius * (isPhaseThree ? 0.03 : 0.022));
            drawCtx.beginPath();
            drawCtx.moveTo(startX, startY);
            drawCtx.lineTo(endX, endY);
            drawCtx.stroke();
        }
        drawCtx.restore();
    };

    const drawNpcPhaseShiftBurst = function (drawCtx, x, y, baseRadius, phase, startedAt, until, nowMs) {
        if (!startedAt || !until || nowMs >= until) {
            return;
        }

        const progress = Math.max(0, Math.min(1, (nowMs - startedAt) / Math.max(1, until - startedAt)));
        const eased = 1 - Math.pow(1 - progress, 3);
        const isPhaseThree = phase >= 3;
        const ringRadius = baseRadius * (0.42 + eased * (isPhaseThree ? 0.38 : 0.28));
        const ringAlpha = (1 - progress) * (isPhaseThree ? 0.8 : 0.58);
        const markCount = isPhaseThree ? 8 : 6;
        const markLength = baseRadius * (isPhaseThree ? 0.24 : 0.18) * (1 + progress * 0.35);
        const markWidth = baseRadius * (isPhaseThree ? 0.095 : 0.075);
        const rotationOffset = (nowMs / 1000) * (isPhaseThree ? 4.2 : 3.2);

        drawCtx.save();
        drawCtx.strokeStyle = isPhaseThree
            ? 'rgba(239, 68, 68, ' + ringAlpha + ')'
            : 'rgba(250, 204, 21, ' + ringAlpha + ')';
        drawCtx.lineWidth = Math.max(2, baseRadius * 0.05);
        drawCtx.beginPath();
        drawCtx.arc(x, y, ringRadius, 0, Math.PI * 2);
        drawCtx.stroke();

        for (let index = 0; index < markCount; index += 1) {
            const angle = rotationOffset + (Math.PI * 2 * index) / markCount;
            const rootX = x + Math.cos(angle) * (ringRadius + baseRadius * 0.02);
            const rootY = y + Math.sin(angle) * (ringRadius + baseRadius * 0.02);

            drawCtx.save();
            drawCtx.translate(rootX, rootY);
            drawCtx.rotate(angle);
            drawCtx.globalAlpha = Math.max(0, 1 - progress);
            drawCtx.beginPath();
            drawCtx.moveTo(0, 0);
            drawCtx.lineTo(markLength, -markWidth);
            drawCtx.lineTo(markLength * 0.62, 0);
            drawCtx.lineTo(markLength, markWidth);
            drawCtx.closePath();
            drawCtx.fillStyle = isPhaseThree
                ? 'rgba(239, 68, 68, 0.92)'
                : 'rgba(250, 204, 21, 0.88)';
            drawCtx.fill();
            drawCtx.restore();
        }
        drawCtx.restore();
    };

    const drawFallbackArrow = function (drawCtx, x, y, size, rotation, flipX, fillStyle) {
        drawCtx.save();
        drawCtx.translate(x, y);
        drawCtx.rotate(rotation);
        drawCtx.scale(flipX, 1);
        drawCtx.fillStyle = fillStyle;
        drawCtx.beginPath();
        drawCtx.moveTo(size * 0.62, 0);
        drawCtx.lineTo(-size * 0.2, -size * 0.48);
        drawCtx.lineTo(-size * 0.04, -size * 0.14);
        drawCtx.lineTo(-size * 0.62, 0);
        drawCtx.lineTo(-size * 0.04, size * 0.14);
        drawCtx.lineTo(-size * 0.2, size * 0.48);
        drawCtx.closePath();
        drawCtx.fill();
        drawCtx.restore();
    };

    const drawNpcFallbackCore = function (drawCtx, x, y, size, rotation, fillStyle) {
        drawCtx.save();
        drawCtx.translate(x, y);
        drawCtx.rotate(rotation);
        drawCtx.fillStyle = fillStyle;
        drawCtx.beginPath();
        drawCtx.roundRect(-size * 0.42, -size * 0.58, size * 0.84, size * 1.16, size * 0.18);
        drawCtx.fill();
        drawCtx.restore();
    };

    const drawHouseEntity = function (player, cameraX, cameraY, zoom) {
        const imageEntry = houseImages[player.houseImageKey || ''];
        const image = imageEntry && imageEntry.ready ? imageEntry.image : null;
        if (!image) {
            return;
        }
        const visual = getPlayerVisual(player.id);
        const nowMs = window.performance.now();
        const health = Math.max(0, Number(player.houseHealth || 0));
        if (typeof visual.lastHouseHealth !== 'number') {
            visual.lastHouseHealth = health;
        } else if (health < visual.lastHouseHealth) {
            visual.houseShakeStartedAt = nowMs;
            visual.houseShakeUntil = nowMs + 260;
            visual.lastHouseHealth = health;
        } else if (health !== visual.lastHouseHealth) {
            visual.lastHouseHealth = health;
        }
        let houseShakeOffsetX = 0;
        if (Number(visual.houseShakeUntil || 0) > nowMs) {
            const shakeDuration = Math.max(1, Number(visual.houseShakeUntil || 0) - Number(visual.houseShakeStartedAt || 0));
            const shakeProgress = Math.max(0, Math.min(1, (nowMs - Number(visual.houseShakeStartedAt || 0)) / shakeDuration));
            const shakeStrength = (1 - shakeProgress) * Math.max(4, 12 * zoom);
            houseShakeOffsetX = Math.sin(shakeProgress * Math.PI * 10) * shakeStrength;
        }
        const x = (player.x - cameraX) * zoom + houseShakeOffsetX;
        const y = (player.y - cameraY) * zoom;
        const naturalWidth = image.naturalWidth || 220;
        const naturalHeight = image.naturalHeight || 220;
        const targetWidth = Math.max(132, 220 * zoom);
        const targetHeight = targetWidth * (naturalHeight / Math.max(1, naturalWidth));
        drawSpriteImage(ctx, image, x, y, targetWidth, targetHeight, 0, 1, 1);

        const maxHealth = Math.max(1, Number(player.houseMaxHealth || 1));
        const healthRatio = Math.max(0, Math.min(1, health / maxHealth));
        const barWidth = targetWidth * 0.7;
        const barHeight = Math.max(8, 10 * zoom);
        const barX = x - barWidth / 2;
        const barY = y - targetHeight / 2 - (18 * zoom);

        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.74)';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = 'rgba(31, 41, 55, 0.16)';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = healthRatio > 0.5
            ? 'rgba(34, 197, 94, 0.94)'
            : (healthRatio > 0.25 ? 'rgba(245, 158, 11, 0.94)' : 'rgba(239, 68, 68, 0.94)');
        ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
        ctx.restore();
    };

    const getFinaleJumpOffset = function (player, nowMs, zoom) {
        if (!encounterFinaleActive || player.isNpc || player.isDummy || player.isHouse || player.deathActive) {
            return 0;
        }
        const cycleMs = 860;
        const phase = (nowMs % cycleMs) / cycleMs;
        const jumpHeight = playerSpriteHeight * zoom;
        if (phase < 0.22) {
            return -(jumpHeight * (phase / 0.22));
        }
        return -(jumpHeight * Math.max(0, 1 - ((phase - 0.22) / 0.78)));
    };

    const getFinaleSpinRotation = function (player, visual, nowMs) {
        if (!encounterFinaleActive || player.isNpc || player.isDummy || player.isHouse || player.deathActive) {
            return 0;
        }
        if (!visual || !visual.finaleStuntPattern) {
            return 0;
        }
        const cycleMs = 860;
        const phase = (nowMs % cycleMs) / cycleMs;
        const direction = visual.finaleStuntPattern === 2 ? -1 : 1;
        return direction * (Math.PI * 2) * phase;
    };

    const drawPlayers = function (cameraX, cameraY, deltaSeconds, zoom) {
        const visibleOverlayIds = new Set();
        renderPlayers.forEach(function (player) {
            if (Boolean(player.isHouse)) {
                drawHouseEntity(player, cameraX, cameraY, zoom);
                return;
            }
            const x = (player.x - cameraX) * zoom;
            const y = (player.y - cameraY) * zoom;
            const nowMs = window.performance.now();
            const drawY = y + getFinaleJumpOffset(player, nowMs, zoom);
            const isSelf = player.id === selfId;
            const visual = getPlayerVisual(player.id);
            if (encounterFinaleActive && !player.isNpc && !player.isDummy && !player.isHouse && !player.deathActive) {
                if (!visual.finaleActive) {
                    visual.finaleActive = true;
                    visual.finaleStuntPattern = Math.floor(Math.random() * 3);
                }
            } else {
                visual.finaleActive = false;
                visual.finaleStuntPattern = 0;
            }
            if (Boolean(player.npcWinVisualActive) && !visual.npcWinVisualActive) {
                visual.npcWinIconIndex = playerNpcWinIcons.length
                    ? Math.floor(Math.random() * playerNpcWinIcons.length)
                    : 0;
            }
            visual.npcWinVisualActive = Boolean(player.npcWinVisualActive);
            const spriteState = getPlayerSpriteState(player, isSelf, visual);
            const currentPlayerSkinProfile = getPlayerSkinProfile(player.skinName || (isSelf ? selectedSkinName : 'default'));
            const splitDoubleSkinRuntime = currentPlayerSkinProfile.type === 'double'
                ? getSkinConfig('default')
                : spriteState.skinRuntime;
            if (Boolean(player.collisionActive) && !visual.collisionVisualActive) {
                const defaultSetCount = splitDoubleSkinRuntime && splitDoubleSkinRuntime.defaultIconSets
                    ? splitDoubleSkinRuntime.defaultIconSets.length
                    : 0;
                const collisionSetCount = splitDoubleSkinRuntime && splitDoubleSkinRuntime.collisionIconSets
                    ? splitDoubleSkinRuntime.collisionIconSets.length
                    : 0;
                const defeatStateCount = spriteState.skinRuntime && spriteState.skinRuntime.defeatStateIcons
                    ? spriteState.skinRuntime.defeatStateIcons.length
                    : 0;
                visual.defaultIconSetIndex = defaultSetCount ? Math.floor(Math.random() * defaultSetCount) : 0;
                visual.collisionIconSetIndex = collisionSetCount ? Math.floor(Math.random() * collisionSetCount) : 0;
                visual.defeatIconIndex = defeatStateCount ? Math.floor(Math.random() * defeatStateCount) : 0;
            }
            visual.collisionVisualActive = Boolean(player.collisionActive);
            if (Boolean(player.playerWinVisualActive) && !visual.playerWinVisualActive) {
                const winIconCount = spriteState.skinRuntime && spriteState.skinRuntime.winStateIcons
                    ? spriteState.skinRuntime.winStateIcons.length
                    : 0;
                visual.playerWinIconIndex = winIconCount
                    ? Math.floor(Math.random() * winIconCount)
                    : 0;
            }
            visual.playerWinVisualActive = Boolean(player.playerWinVisualActive);
            if (Boolean(player.stopVisualActive) && !visual.stopVisualActive) {
                const stopIconCount = spriteState.skinRuntime && spriteState.skinRuntime.stopStateIcons
                    ? spriteState.skinRuntime.stopStateIcons.length
                    : 0;
                visual.stopIconIndex = stopIconCount
                    ? Math.floor(Math.random() * stopIconCount)
                    : 0;
            }
            visual.stopVisualActive = Boolean(player.stopVisualActive);
            const isNpc = spriteState.isNpc;
            const isPumpkinNpc = spriteState.isPumpkinNpc;
            const isCollisionVisualActive = spriteState.isCollisionVisualActive;
            const isDefeatVisualActive = spriteState.isDefeatVisualActive;
            const isDeathVisualActive = spriteState.isDeathVisualActive;
            const deathFadeProgress = typeof player.deathFadeProgress === 'number' ? player.deathFadeProgress : 0;
            const pumpkinFadeOutProgress = typeof player.pumpkinFadeOutProgress === 'number' ? player.pumpkinFadeOutProgress : 0;
            const pumpkinFadeAlpha = Boolean(player.pumpkinFadeOutActive) ? Math.max(0, 1 - pumpkinFadeOutProgress) : 1;
            const isNpcDeathAnimating = Boolean(player.npcDeathAnimating);
            const npcHealth = typeof player.npcHealth === 'number' ? player.npcHealth : npcMaxHealth;
            const playerNpcMaxHealth = typeof player.npcMaxHealth === 'number' ? player.npcMaxHealth : npcMaxHealth;
            const collisionImpactX = typeof player.collisionImpactX === 'number' ? player.collisionImpactX : 0;
            const collisionImpactY = typeof player.collisionImpactY === 'number' ? player.collisionImpactY : 0;
            const isNpcChargeVisualActive = spriteState.isNpcChargeVisualActive;
            const isBoostVisualActive = spriteState.isBoostVisualActive;
            const spriteScale = spriteState.spriteScale;
            const skinVisualScale = !isNpc && spriteState.skinRuntime
                ? Math.max(0.1, Number(spriteState.skinRuntime.visualScale || 1))
                : 1;
            const activeIcon = spriteState.activeIcon;
            const activeIconReady = spriteState.activeIconReady;
            const fallbackSpriteHeight = playerSpriteHeight * spriteScale * zoom * skinVisualScale;
            const useDomGifOverlay = Boolean(activeIconReady && isAnimatedGifIcon(activeIcon));
            const fallbackNaturalWidth = activeIcon.naturalWidth || playerSpriteWidth;
            const fallbackNaturalHeight = activeIcon.naturalHeight || playerSpriteHeight;
            const fallbackAspectRatio = fallbackNaturalHeight > 0 ? fallbackNaturalWidth / fallbackNaturalHeight : 1;
            let spriteHeight = fallbackSpriteHeight;
            let spriteWidth = spriteHeight * fallbackAspectRatio;
            if (!isNpc && spriteState.skinRuntime && spriteState.skinRuntime.skinType === 'evolution') {
                const classicReferenceWidth = fallbackSpriteHeight * defaultPlayerAspectRatio * 2;
                spriteWidth = classicReferenceWidth;
                spriteHeight = spriteWidth / Math.max(0.1, fallbackAspectRatio);
            }
            const trailActive = activeIconReady && !isDeathVisualActive && (
                isNpc
                    ? (player.npcState === 'charging')
                    : isBoostVisualActive
            );
            const trailFadeDurationMs = 280;
            const npcPhase = isNpc
                ? Math.max(1, Number(player.npcPhase || 1))
                : 1;
            const playerSkinProfile = getPlayerSkinProfile(player.skinName || 'default');

            if (!isNpc && !isPumpkinNpc && playerSkinProfile.type === 'double' && drawDoublePlayer(player, visual, cameraX, cameraY, zoom, nowMs, isSelf, deltaSeconds)) {
                visual.previousX = player.x;
                visual.previousY = player.y;
                return;
            }

            if (isNpc) {
                if (visual.lastNpcPhase === null) {
                    visual.lastNpcPhase = npcPhase;
                } else if (npcPhase > visual.lastNpcPhase) {
                    visual.phaseShiftStartedAt = nowMs;
                    visual.phaseShiftUntil = nowMs + 520;
                    visual.lastNpcPhase = npcPhase;
                } else if (npcPhase < visual.lastNpcPhase) {
                    visual.lastNpcPhase = npcPhase;
                    visual.phaseShiftStartedAt = 0;
                    visual.phaseShiftUntil = 0;
                }
            }

            updateVisualAnimation(visual, deltaSeconds);

            if (visual.trailPoints.length) {
                visual.trailPoints = visual.trailPoints.filter(function (trailPoint) {
                    return !trailPoint.expiresAt || trailPoint.expiresAt > nowMs;
                });
            }

            if (trailActive) {
                if (!visual.lastTrailAt || nowMs - visual.lastTrailAt >= 140) {
                    visual.trailPoints.push({
                        x: player.x,
                        y: player.y,
                        rotation: visual.currentRotation,
                        flipX: visual.currentFlipX,
                        icon: activeIcon,
                        width: spriteWidth,
                        height: spriteHeight,
                        createdAt: nowMs,
                        expiresAt: 0
                    });
                    visual.lastTrailAt = nowMs;
                }
                if (visual.trailPoints.length > 4) {
                    visual.trailPoints.shift();
                }
            } else if (visual.trailPoints.length) {
                visual.trailPoints.forEach(function (trailPoint) {
                    if (!trailPoint.expiresAt) {
                        trailPoint.expiresAt = nowMs + trailFadeDurationMs;
                    }
                });
                visual.lastTrailAt = 0;
            }

            if (activeIconReady) {
                if (isNpc && isDeathVisualActive && !isNpcDeathAnimating) {
                    hideSpriteOverlayNode(player.id);
                    visual.previousX = player.x;
                    visual.previousY = player.y;
                    return;
                }
                if (visual.trailPoints.length) {
                    visual.trailPoints.forEach(function (trailPoint, index) {
                        const trailX = (trailPoint.x - cameraX) * zoom;
                        const trailY = (trailPoint.y - cameraY) * zoom + getFinaleJumpOffset(player, nowMs, zoom);
                        const fadeRatio = trailPoint.expiresAt
                            ? Math.max(0, Math.min(1, (trailPoint.expiresAt - nowMs) / trailFadeDurationMs))
                            : 1;
                        const alpha = 0.25 * ((index + 1) / visual.trailPoints.length) * fadeRatio * pumpkinFadeAlpha;
                        drawTrailSprite(
                            ctx,
                            trailPoint.icon || activeIcon,
                            trailX,
                            trailY,
                            trailPoint.width || spriteWidth,
                            trailPoint.height || spriteHeight,
                            trailPoint.rotation,
                            trailPoint.flipX,
                            alpha,
                            getTrailTintColor(index, isNpc)
                        );
                    });
                }
                const playerAlpha = (isDeathVisualActive ? Math.max(0, 1 - deathFadeProgress) : 1) * pumpkinFadeAlpha;
                const finaleSpinRotation = getFinaleSpinRotation(player, visual, nowMs);
                const dentAngle = Math.atan2(collisionImpactY, collisionImpactX) - visual.currentRotation;
                const dentLocalX = collisionImpactX === 0 && collisionImpactY === 0
                    ? 0
                    : Math.cos(dentAngle) * visual.currentFlipX;
                const dentLocalY = collisionImpactX === 0 && collisionImpactY === 0
                    ? 0
                    : Math.sin(dentAngle);
                if (useDomGifOverlay) {
                    const overlayNode = getSpriteOverlayNode(player.id);
                    if (overlayNode) {
                        const iconSrc = activeIcon.currentSrc || activeIcon.src;
                        if (iconSrc && overlayNode.src !== iconSrc) {
                            overlayNode.src = iconSrc;
                        }
                        overlayNode.style.display = 'block';
                        overlayNode.style.width = spriteWidth + 'px';
                        overlayNode.style.height = spriteHeight + 'px';
                        overlayNode.style.opacity = String(playerAlpha);
                        overlayNode.style.transform =
                            'translate(' + x + 'px, ' + drawY + 'px) translate(-50%, -50%) rotate(' +
                            (visual.currentRotation + finaleSpinRotation + (isNpcDeathAnimating ? Math.PI / 2 : 0)) +
                            'rad) scale(' + visual.currentFlipX + ', 1)';
                        visibleOverlayIds.add(player.id);
                    }
                } else {
                    hideSpriteOverlayNode(player.id);
                    ctx.save();
                    ctx.translate(x, drawY);
                    ctx.rotate(
                        visual.currentRotation +
                        finaleSpinRotation +
                        (isNpcDeathAnimating ? Math.PI / 2 : 0)
                    );
                    ctx.scale(visual.currentFlipX, 1);
                    ctx.globalAlpha = playerAlpha;
                    ctx.drawImage(
                        activeIcon,
                        -spriteWidth / 2,
                        -spriteHeight / 2,
                        spriteWidth,
                        spriteHeight
                    );
                }
                if (!useDomGifOverlay && isNpc && isDefeatVisualActive && npcTintContext) {
                    const tintWidth = Math.max(1, Math.round(spriteWidth));
                    const tintHeight = Math.max(1, Math.round(spriteHeight));
                    const impactX = tintWidth / 2 + dentLocalX * tintWidth * 0.34;
                    const impactY = tintHeight / 2 + dentLocalY * tintHeight * 0.34;
                    const impactRadius = Math.max(16, Math.min(tintWidth, tintHeight) * 0.22);
                    npcTintCanvas.width = tintWidth;
                    npcTintCanvas.height = tintHeight;
                    npcTintContext.clearRect(0, 0, tintWidth, tintHeight);
                    npcTintContext.drawImage(activeIcon, 0, 0, tintWidth, tintHeight);
                    npcTintContext.globalCompositeOperation = 'source-atop';
                    const impactGradient = npcTintContext.createRadialGradient(
                        impactX,
                        impactY,
                        0,
                        impactX,
                        impactY,
                        impactRadius
                    );
                    impactGradient.addColorStop(0, 'rgba(220, 38, 38, 0.72)');
                    impactGradient.addColorStop(0.55, 'rgba(239, 68, 68, 0.36)');
                    impactGradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
                    npcTintContext.fillStyle = impactGradient;
                    npcTintContext.fillRect(0, 0, tintWidth, tintHeight);
                    npcTintContext.globalCompositeOperation = 'source-over';
                    ctx.drawImage(
                        npcTintCanvas,
                        -spriteWidth / 2,
                        -spriteHeight / 2,
                        spriteWidth,
                        spriteHeight
                    );
                }
                if (!useDomGifOverlay) {
                    ctx.restore();
                }
            } else {
                hideSpriteOverlayNode(player.id);
                ctx.save();
                ctx.globalAlpha = pumpkinFadeAlpha;
                if (isNpc) {
                    drawNpcFallbackCore(
                        ctx,
                        x,
                        drawY,
                        18 * zoom,
                        visual.currentRotation,
                        'rgba(127, 29, 29, 0.92)'
                    );
                } else {
                    drawFallbackArrow(
                        ctx,
                        x,
                        drawY,
                        12 * zoom,
                        visual.currentRotation,
                        visual.currentFlipX,
                        isSelf ? 'rgba(37, 99, 235, 0.92)' : 'rgba(245, 158, 11, 0.92)'
                    );
                }
                ctx.restore();
            }

            if (!isNpc) {
                const skinProfile = getPlayerSkinProfile(player.skinName || 'default');
                const pumpkinBaseSkinName = String(player.pumpkinBaseSkinName || '').trim().toLowerCase();
                const playerMaxHealthSegments = typeof player.maxHealth === 'number'
                    ? Math.max(1, Math.round(Number(player.maxHealth || 1)))
                    : isPumpkinNpc
                    ? PUMPKIN_NPC_HEALTH_SEGMENTS
                    : (pumpkinBaseSkinName === 'double_single'
                    ? 2
                    : skinProfile.maxHealthSegments);
                const healthSegmentsFilled = isDeathVisualActive
                    ? 0
                    : (typeof player.currentHealth === 'number'
                        ? Math.max(0, Math.min(playerMaxHealthSegments, Math.round(Number(player.currentHealth || 0))))
                        : Math.max(
                            0,
                            playerMaxHealthSegments - ((typeof player.defeatReceivedCount === 'number'
                                ? Math.max(0, player.defeatReceivedCount)
                                : 0) % playerMaxHealthSegments || 0)
                        ));
                if (!isDeathVisualActive) {
                    const defaultClassicHealthBarReferenceWidth = spriteWidth / Math.max(0.1, skinVisualScale);
                    const healthBarReferenceWidth = skinProfile.type === 'evolution'
                        ? (playerSpriteHeight * spriteScale * zoom * defaultPlayerAspectRatio)
                        : ((skinProfile.type === 'pumkin' || isPumpkinNpc)
                            ? (isPumpkinNpc
                                ? (playerSpriteHeight * zoom * defaultPlayerAspectRatio)
                                : spriteWidth)
                            : ((spriteState.skinRuntime && spriteState.skinRuntime.name === 'happy')
                                ? defaultClassicHealthBarReferenceWidth
                                : spriteWidth));
                    const healthBarWidth = Math.max(24, healthBarReferenceWidth * 0.9);
                    const totalSegments = Math.max(1, isPumpkinNpc ? PUMPKIN_NPC_HEALTH_SEGMENTS : playerMaxHealthSegments);
                    const segmentGap = skinProfile.type === 'evolution'
                        ? Math.max(1, 1 * zoom)
                        : Math.max(2, 2 * zoom);
                    const segmentWidth = (healthBarWidth - segmentGap * Math.max(0, totalSegments - 1)) / totalSegments;
                    const segmentHeight = Math.max(4, 5 * zoom);
                    const defaultSegmentStartX = x - healthBarWidth / 2;
                    const verticalOffset = skinProfile.type === 'evolution' ? 9 * zoom : 5 * zoom;
                    const defaultSegmentY = drawY + spriteHeight / 2 + verticalOffset;
                    const healthSegmentColor = healthSegmentsFilled >= Math.max(3, totalSegments)
                        ? 'rgba(34, 197, 94, 1)'
                        : (healthSegmentsFilled >= Math.max(2, Math.ceil(totalSegments / 2))
                            ? 'rgba(234, 179, 8, 1)'
                            : 'rgba(239, 68, 68, 1)');
                    const playerBoostState = typeof player.boostState === 'string' ? player.boostState : 'idle';
                    const boostLockRemainingMs = typeof player.boostLockRemainingMs === 'number' ? Math.max(0, player.boostLockRemainingMs) : 0;
                    const boostLockDurationMs = typeof player.boostLockDurationMs === 'number' ? Math.max(0, player.boostLockDurationMs) : 0;
                    let cooldownRatio = 1;
                    if (playerBoostState === 'charging' || playerBoostState === 'cooldown') {
                        cooldownRatio = 0;
                    } else if (boostLockDurationMs > 0) {
                        cooldownRatio = Math.max(0, Math.min(1, 1 - (boostLockRemainingMs / boostLockDurationMs)));
                    }
                    const segmentStartX = defaultSegmentStartX;
                    const segmentY = defaultSegmentY;
                    ctx.save();
                    ctx.globalAlpha = pumpkinFadeAlpha;
                    for (let segmentIndex = 0; segmentIndex < totalSegments; segmentIndex += 1) {
                        const segmentX = segmentStartX + segmentIndex * (segmentWidth + segmentGap);
                        ctx.fillStyle = segmentIndex < healthSegmentsFilled
                            ? healthSegmentColor
                            : 'rgba(15, 23, 42, 0.28)';
                        ctx.fillRect(segmentX, segmentY, segmentWidth, segmentHeight);
                    }
                    ctx.restore();

                    if (isSelf) {
                        const cooldownBarY = segmentY + segmentHeight + Math.max(2, 2 * zoom);
                        ctx.save();
                        ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
                        ctx.fillRect(segmentStartX, cooldownBarY, healthBarWidth, segmentHeight);
                        ctx.fillStyle = 'rgba(59, 130, 246, 0.92)';
                        ctx.fillRect(segmentStartX, cooldownBarY, healthBarWidth * cooldownRatio, segmentHeight);
                        ctx.restore();
                    }
                }
                const labelText = typeof player.displayName === 'string' ? player.displayName.trim() : '';
                const levelText = typeof player.level === 'number' ? ' Lv.' + Math.max(1, Math.round(Number(player.level || 1))) : '';
                if (labelText) {
                    ctx.fillStyle = isDeathVisualActive
                        ? 'rgba(17, 24, 39, ' + Math.max(0, 0.92 * (1 - deathFadeProgress)) + ')'
                        : 'rgba(17, 24, 39, 0.92)';
                    ctx.font = '800 15px Inter, Noto Sans KR, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(
                        labelText + levelText,
                        x,
                        drawY - spriteHeight / 2 - (getPlayerSkinProfile(player.skinName || 'default').type === 'evolution' ? 9 * zoom : 5 * zoom)
                    );
                }
            } else if (!isDeathVisualActive || isNpcDeathAnimating) {
                const healthRatio = Math.max(0, Math.min(1, npcHealth / playerNpcMaxHealth));
                const npcPhaseTwoRatio = typeof player.npcPhaseTwoRatio === 'number' ? player.npcPhaseTwoRatio : 0.6;
                const npcPhaseThreeRatio = typeof player.npcPhaseThreeRatio === 'number' ? player.npcPhaseThreeRatio : 0.2;
                const barWidth = Math.max(44, 76 * zoom);
                const barHeight = Math.max(6, 8 * zoom);
                const barX = x - barWidth / 2;
                const healthBarGap = isNpcChargeVisualActive ? 18 : 4;
                const barY = drawY - (playerSpriteHeight * spriteScale * zoom) / 2 - healthBarGap * zoom;

                ctx.fillStyle = 'rgba(17, 24, 39, 0.22)';
                ctx.fillRect(barX, barY, barWidth, barHeight);
                ctx.fillStyle = npcPhase >= 3
                    ? '#ef4444'
                    : (npcPhase >= 2 ? '#eab308' : '#22c55e');
                ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
                const phaseTwoMarkerX = barX + barWidth * npcPhaseTwoRatio;
                const phaseThreeMarkerX = barX + barWidth * npcPhaseThreeRatio;
                const phaseMarkerWidth = Math.max(1.4, 1.6 * zoom);
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillRect(phaseTwoMarkerX - phaseMarkerWidth / 2, barY, phaseMarkerWidth, barHeight);
                ctx.fillRect(phaseThreeMarkerX - phaseMarkerWidth / 2, barY, phaseMarkerWidth, barHeight);
                ctx.restore();
            }

            visual.previousX = player.x;
            visual.previousY = player.y;
        });

        spriteOverlayNodes.forEach(function (node, playerId) {
            if (!visibleOverlayIds.has(playerId)) {
                node.style.display = 'none';
            }
        });
    };

    const drawLevelDrops = function (cameraX, cameraY, zoom) {
        if (!Array.isArray(levelDrops) || !levelDrops.length) {
            return;
        }
        const now = Date.now();
        levelDrops.forEach(function (drop) {
            const createdAt = Number(drop.createdAt || 0);
            const spawnAnimDuration = 360;
            const spawnProgress = createdAt > 0
                ? Math.max(0, Math.min(1, (now - createdAt) / spawnAnimDuration))
                : 1;
            const easedSpawnProgress = 1 - Math.pow(1 - spawnProgress, 3);
            const worldX = Number(drop.originX || drop.x || 0) + (Number(drop.x || 0) - Number(drop.originX || drop.x || 0)) * easedSpawnProgress;
            const worldY = Number(drop.originY || drop.y || 0) + (Number(drop.y || 0) - Number(drop.originY || drop.y || 0)) * easedSpawnProgress;
            const x = (worldX - cameraX) * zoom;
            const y = (worldY - cameraY) * zoom;
            const size = Math.max(12.6, 15.4 * zoom);
            const fadeStartsAt = Number(drop.fadeStartsAt || 0);
            const expiresAt = Number(drop.expiresAt || 0);
            const remaining = Math.max(0, expiresAt - now);
            const fadeDuration = Math.max(1, expiresAt - fadeStartsAt);
            const alpha = now <= fadeStartsAt
                ? 1
                : Math.max(0, Math.min(1, remaining / fadeDuration));
            const rotation = ((now - createdAt) / 2000) * Math.PI * 2;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.fillStyle = 'rgba(249, 115, 22, 0.96)';
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(120, 53, 15, 0.96)';
            ctx.fillRect(-size * 0.08, -size * 0.58, size * 0.16, size * 0.26);
            ctx.fillStyle = 'rgba(34, 197, 94, 0.96)';
            ctx.beginPath();
            ctx.ellipse(size * 0.22, -size * 0.5, size * 0.2, size * 0.12, -0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    };

    const drawMinimap = function () {
        // Minimap renders a filtered subset of actors into a compact navigation aid, not a full second scene.
        const width = minimapCanvas.width;
        const height = minimapCanvas.height;
        const padding = 10;
        const drawableWidth = width - padding * 2;
        const drawableHeight = height - padding * 2;

        minimapCtx.clearRect(0, 0, width, height);

        minimapCtx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(padding, padding, drawableWidth, drawableHeight);

        renderPlayers.forEach(function (player) {
            const isSelf = player.id === selfId;
            const isPumpkinNpc = Boolean(player.isPumpkinNpc);
            if ((!isSelf && !isPumpkinNpc) || player.deathActive) {
                return;
            }
            const x = padding + (player.x / worldSize) * drawableWidth;
            const y = padding + (player.y / worldSize) * drawableHeight;
            const visual = getPlayerVisual(player.id);
            if (isPumpkinNpc) {
                minimapCtx.save();
                minimapCtx.fillStyle = 'rgba(249, 115, 22, 0.96)';
                minimapCtx.beginPath();
                minimapCtx.arc(x, y, 5.2, 0, Math.PI * 2);
                minimapCtx.fill();
                minimapCtx.fillStyle = 'rgba(120, 53, 15, 0.96)';
                minimapCtx.fillRect(x - 1.1, y - 7.2, 2.2, 3.2);
                minimapCtx.fillStyle = 'rgba(34, 197, 94, 0.96)';
                minimapCtx.beginPath();
                minimapCtx.ellipse(x + 2.7, y - 6.6, 2.4, 1.5, -0.6, 0, Math.PI * 2);
                minimapCtx.fill();
                minimapCtx.restore();
                return;
            }
            drawFallbackArrow(
                minimapCtx,
                x,
                y,
                player.isNpc ? 9 : 6,
                visual.currentRotation,
                visual.currentFlipX,
                player.isNpc ? 'rgba(127, 29, 29, 0.92)' : '#38bdf8'
            );
        });
    };

    const render = function () {
        // This is the authoritative client frame loop: reconcile network snapshots, move camera, draw world/UI, schedule next frame.
        const now = window.performance.now();
        const deltaSeconds = lastRenderTime ? Math.min((now - lastRenderTime) / 1000, 0.05) : 1 / 60;
        lastRenderTime = now;
        const remoteLerp = getFrameAdjustedLerp(remoteLerpPerFrame, deltaSeconds);
        const selfRenderLerp = getFrameAdjustedLerp(selfRenderLerpPerFrame, deltaSeconds);
        const selfReconcileLerp = getFrameAdjustedLerp(selfReconcilePerFrame, deltaSeconds);

        resizeCanvas();
        const canvasWidth = getCanvasDisplayWidth();
        const canvasHeight = getCanvasDisplayHeight();
        const nextById = new Map();
        serverPlayers.forEach(function (player) {
            nextById.set(player.id, player);
        });
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        ctx.fillStyle = getPhaseBackgroundColor(serverPlayers);
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        const effectiveZoom = getEffectiveZoom();

        let inputVector = getInputVector();
        if (encounterFinaleActive || selfDeathActive) {
            input.up = false;
            input.down = false;
            input.left = false;
            input.right = false;
            input.boost = false;
            inputVector = { dx: 0, dy: 0 };
            currentMoveSpeed = 0;
            boostState = 'idle';
        }
        if (boostLockedActive) {
            input.boost = false;
            currentMoveSpeed = serverReportedMoveSpeed;
            boostState = 'idle';
        } else {
            updateMoveSpeed(deltaSeconds, inputVector);
        }
        const movementVector = (boostState === 'charging' || boostState === 'cooldown')
            ? { dx: boostDirectionX, dy: boostDirectionY }
            : inputVector;

        if (predictedSelf && selfId) {
            const authoritativeSelf = nextById.get(selfId);
            const authoritativeIsDouble = Boolean(
                authoritativeSelf &&
                getPlayerSkinProfile(authoritativeSelf.skinName || selectedSkinName).type === 'double'
            );

            if (!authoritativeIsDouble) {
                if (selfDeathActive && authoritativeSelf) {
                    predictedSelf.x = authoritativeSelf.x;
                    predictedSelf.y = authoritativeSelf.y;
                } else if (authoritativeSelf && (authoritativeSelf.collisionActive || authoritativeSelf.collisionRecoveryActive)) {
                    const authoritativeVelocityX = Number(authoritativeSelf.velocityX || 0);
                    const authoritativeVelocityY = Number(authoritativeSelf.velocityY || 0);
                    predictedSelf.x = clampToWorld(predictedSelf.x + authoritativeVelocityX * deltaSeconds);
                    predictedSelf.y = clampToWorld(predictedSelf.y + authoritativeVelocityY * deltaSeconds);
                } else {
                    predictedSelf.x = clampToWorld(predictedSelf.x + movementVector.dx * currentMoveSpeed * deltaSeconds);
                    predictedSelf.y = clampToWorld(predictedSelf.y + movementVector.dy * currentMoveSpeed * deltaSeconds);
                }

                if (authoritativeSelf) {
                    const diffX = authoritativeSelf.x - predictedSelf.x;
                    const diffY = authoritativeSelf.y - predictedSelf.y;
                    const diffDistance = Math.hypot(diffX, diffY);
                    const selfSnapThreshold = selfSnapDistance;
                    const selfIgnoreThreshold = selfIgnoreDistance;

                    if (diffDistance > selfSnapThreshold) {
                        predictedSelf.x = authoritativeSelf.x;
                        predictedSelf.y = authoritativeSelf.y;
                    } else if (diffDistance > selfIgnoreThreshold) {
                        predictedSelf.x += diffX * selfReconcileLerp;
                        predictedSelf.y += diffY * selfReconcileLerp;
                    }
                }
            }

            if (authoritativeIsDouble) {
                updatePredictedDoubleState(authoritativeSelf, deltaSeconds, inputVector, movementVector, selfReconcileLerp);
            } else if (predictedSelf) {
                predictedSelf.doubleState = authoritativeSelf && authoritativeSelf.doubleState ? authoritativeSelf.doubleState : null;
            }
        }

        renderPlayers = renderPlayers.filter(function (player) {
            return nextById.has(player.id) || player.id === selfId;
        });
        playerVisuals.forEach(function (_, id) {
            if (!nextById.has(id) && id !== selfId) {
                playerVisuals.delete(id);
            }
        });

        nextById.forEach(function (serverPlayer, id) {
            const current = renderPlayers.find(function (player) {
                return player.id === id;
            });

            if (id === selfId && predictedSelf) {
                if (!renderedSelf) {
                    renderedSelf = {
                        id: predictedSelf.id,
                        x: predictedSelf.x,
                        y: predictedSelf.y
                    };
                } else {
                    renderedSelf.x += (predictedSelf.x - renderedSelf.x) * selfRenderLerp;
                    renderedSelf.y += (predictedSelf.y - renderedSelf.y) * selfRenderLerp;
                }

                if (current) {
                    const selfVisual = getPlayerVisual(current.id);
                    const nextPumpkinNtrTriggerCount = Math.max(0, Number(serverPlayer.pumpkinNtrTriggerCount || 0));
                    if (nextPumpkinNtrTriggerCount > Number(selfVisual.pumpkinNtrTriggerCount || 0)) {
                        selfVisual.pumpkinNtrVisualUntil = window.performance.now() + SELF_PUMPKIN_NTR_VISUAL_DURATION_MS;
                    }
                    selfVisual.pumpkinNtrTriggerCount = nextPumpkinNtrTriggerCount;
                    current.displayName = getServerDisplayName(serverPlayer);
                    current.skinName = serverPlayer.skinName || 'default';
                    current.pumpkinBaseSkinName = serverPlayer.pumpkinBaseSkinName || '';
                    current.pumpkinNtrTriggerCount = nextPumpkinNtrTriggerCount;
                    current.x = renderedSelf.x;
                    current.y = renderedSelf.y;
                    current.velocityX = typeof serverPlayer.velocityX === 'number' ? serverPlayer.velocityX : 0;
                    current.velocityY = typeof serverPlayer.velocityY === 'number' ? serverPlayer.velocityY : 0;
                    current.facingAngle = typeof serverPlayer.facingAngle === 'number' ? serverPlayer.facingAngle : 0;
                    current.isDummy = Boolean(serverPlayer.isDummy);
                    current.isNpc = Boolean(serverPlayer.isNpc);
                    current.isPumpkinNpc = Boolean(serverPlayer.isPumpkinNpc);
                    current.isHouse = Boolean(serverPlayer.isHouse);
                    current.houseStage = typeof serverPlayer.houseStage === 'number' ? serverPlayer.houseStage : 0;
                    current.houseHealth = typeof serverPlayer.houseHealth === 'number' ? serverPlayer.houseHealth : null;
                    current.houseMaxHealth = typeof serverPlayer.houseMaxHealth === 'number' ? serverPlayer.houseMaxHealth : null;
                    current.houseImageKey = serverPlayer.houseImageKey || '';
                    current.collisionImpactActive = Boolean(serverPlayer.collisionImpactActive);
                    current.collisionActive = Boolean(serverPlayer.collisionActive);
                    current.npcPhase = typeof serverPlayer.npcPhase === 'number' ? serverPlayer.npcPhase : 1;
                    current.npcPhaseTwoRatio = typeof serverPlayer.npcPhaseTwoRatio === 'number' ? serverPlayer.npcPhaseTwoRatio : 0.6;
                    current.npcPhaseThreeRatio = typeof serverPlayer.npcPhaseThreeRatio === 'number' ? serverPlayer.npcPhaseThreeRatio : 0.2;
                    current.npcState = serverPlayer.npcState || '';
                    current.collisionVisualType = serverPlayer.collisionVisualType || 'win';
                    current.doubleState = predictedSelf && predictedSelf.doubleState ? predictedSelf.doubleState : (serverPlayer.doubleState || null);
                    current.collisionImpactX = typeof serverPlayer.collisionImpactX === 'number' ? serverPlayer.collisionImpactX : 0;
                    current.collisionImpactY = typeof serverPlayer.collisionImpactY === 'number' ? serverPlayer.collisionImpactY : 0;
                    current.deathActive = Boolean(serverPlayer.deathActive);
                    current.deathFadeProgress = typeof serverPlayer.deathFadeProgress === 'number'
                        ? serverPlayer.deathFadeProgress
                        : 0;
                    current.npcDeathAnimating = Boolean(serverPlayer.npcDeathAnimating);
                    current.npcMaxHealth = typeof serverPlayer.npcMaxHealth === 'number' ? serverPlayer.npcMaxHealth : null;
                    current.npcHealth = typeof serverPlayer.npcHealth === 'number' ? serverPlayer.npcHealth : null;
                    current.npcDefeatDamageRatio = typeof serverPlayer.npcDefeatDamageRatio === 'number' ? serverPlayer.npcDefeatDamageRatio : 0;
                    current.npcWinVisualActive = Boolean(serverPlayer.npcWinVisualActive);
                    current.playerWinVisualActive = Boolean(serverPlayer.playerWinVisualActive);
                    current.stopVisualActive = Boolean(serverPlayer.stopVisualActive);
                    current.boostState = serverPlayer.boostState || 'idle';
                    current.currentSpeed = typeof serverPlayer.currentSpeed === 'number'
                        ? serverPlayer.currentSpeed
                        : getPlayerSkinProfile(serverPlayer.skinName || 'default').baseSpeed;
                    current.collisionRecoveryActive = Boolean(serverPlayer.collisionRecoveryActive);
                    current.collisionRecoveryRemainingMs = typeof serverPlayer.collisionRecoveryRemainingMs === 'number' ? serverPlayer.collisionRecoveryRemainingMs : 0;
                    current.collisionRecoveryDurationMs = typeof serverPlayer.collisionRecoveryDurationMs === 'number' ? serverPlayer.collisionRecoveryDurationMs : 0;
                    current.pumpkinFadeOutActive = Boolean(serverPlayer.pumpkinFadeOutActive);
                    current.pumpkinFadeOutProgress = typeof serverPlayer.pumpkinFadeOutProgress === 'number' ? serverPlayer.pumpkinFadeOutProgress : 0;
                    current.defeatReceivedCount = typeof serverPlayer.defeatReceivedCount === 'number' ? serverPlayer.defeatReceivedCount : 0;
                    current.level = typeof serverPlayer.level === 'number' ? serverPlayer.level : 1;
                    current.currentHealth = typeof serverPlayer.currentHealth === 'number' ? serverPlayer.currentHealth : null;
                    current.maxHealth = typeof serverPlayer.maxHealth === 'number' ? serverPlayer.maxHealth : null;
                    current.sizeMultiplier = typeof serverPlayer.sizeMultiplier === 'number' ? serverPlayer.sizeMultiplier : 1;
                    current.boostLockRemainingMs = typeof serverPlayer.boostLockRemainingMs === 'number' ? serverPlayer.boostLockRemainingMs : 0;
                    current.boostLockDurationMs = typeof serverPlayer.boostLockDurationMs === 'number' ? serverPlayer.boostLockDurationMs : 0;
                    current.npcChargeWindupProgress = typeof serverPlayer.npcChargeWindupProgress === 'number'
                        ? serverPlayer.npcChargeWindupProgress
                        : 0;
                } else {
                    const nextPumpkinNtrTriggerCount = Math.max(0, Number(serverPlayer.pumpkinNtrTriggerCount || 0));
                    const selfVisual = getPlayerVisual(renderedSelf.id);
                    selfVisual.pumpkinNtrTriggerCount = nextPumpkinNtrTriggerCount;
                    renderPlayers.push({
                        id: renderedSelf.id,
                        displayName: getServerDisplayName(serverPlayer),
                        skinName: serverPlayer.skinName || 'default',
                        pumpkinBaseSkinName: serverPlayer.pumpkinBaseSkinName || '',
                        pumpkinNtrTriggerCount: nextPumpkinNtrTriggerCount,
                        x: renderedSelf.x,
                        y: renderedSelf.y,
                        velocityX: typeof serverPlayer.velocityX === 'number' ? serverPlayer.velocityX : 0,
                        velocityY: typeof serverPlayer.velocityY === 'number' ? serverPlayer.velocityY : 0,
                        facingAngle: typeof serverPlayer.facingAngle === 'number' ? serverPlayer.facingAngle : 0,
                        isDummy: Boolean(serverPlayer.isDummy),
                        isPumpkinNpc: Boolean(serverPlayer.isPumpkinNpc),
                        isHouse: Boolean(serverPlayer.isHouse),
                        houseStage: typeof serverPlayer.houseStage === 'number' ? serverPlayer.houseStage : 0,
                        houseHealth: typeof serverPlayer.houseHealth === 'number' ? serverPlayer.houseHealth : null,
                        houseMaxHealth: typeof serverPlayer.houseMaxHealth === 'number' ? serverPlayer.houseMaxHealth : null,
                        houseImageKey: serverPlayer.houseImageKey || '',
                        collisionImpactActive: Boolean(serverPlayer.collisionImpactActive),
                        isNpc: Boolean(serverPlayer.isNpc),
                        npcPhase: typeof serverPlayer.npcPhase === 'number' ? serverPlayer.npcPhase : 1,
                        npcPhaseTwoRatio: typeof serverPlayer.npcPhaseTwoRatio === 'number' ? serverPlayer.npcPhaseTwoRatio : 0.6,
                        npcPhaseThreeRatio: typeof serverPlayer.npcPhaseThreeRatio === 'number' ? serverPlayer.npcPhaseThreeRatio : 0.2,
                        npcState: serverPlayer.npcState || '',
                        collisionActive: Boolean(serverPlayer.collisionActive),
                        collisionVisualType: serverPlayer.collisionVisualType || 'win',
                        doubleState: predictedSelf && predictedSelf.doubleState ? predictedSelf.doubleState : (serverPlayer.doubleState || null),
                        collisionImpactX: typeof serverPlayer.collisionImpactX === 'number' ? serverPlayer.collisionImpactX : 0,
                        collisionImpactY: typeof serverPlayer.collisionImpactY === 'number' ? serverPlayer.collisionImpactY : 0,
                        deathActive: Boolean(serverPlayer.deathActive),
                        deathFadeProgress: typeof serverPlayer.deathFadeProgress === 'number'
                            ? serverPlayer.deathFadeProgress
                            : 0,
                        npcDeathAnimating: Boolean(serverPlayer.npcDeathAnimating),
                        npcMaxHealth: typeof serverPlayer.npcMaxHealth === 'number' ? serverPlayer.npcMaxHealth : null,
                        npcHealth: typeof serverPlayer.npcHealth === 'number' ? serverPlayer.npcHealth : null,
                        npcDefeatDamageRatio: typeof serverPlayer.npcDefeatDamageRatio === 'number' ? serverPlayer.npcDefeatDamageRatio : 0,
                        npcWinVisualActive: Boolean(serverPlayer.npcWinVisualActive),
                        playerWinVisualActive: Boolean(serverPlayer.playerWinVisualActive),
                        stopVisualActive: Boolean(serverPlayer.stopVisualActive),
                        boostState: serverPlayer.boostState || 'idle',
                        currentSpeed: typeof serverPlayer.currentSpeed === 'number'
                            ? serverPlayer.currentSpeed
                            : getPlayerSkinProfile(serverPlayer.skinName || 'default').baseSpeed,
                        collisionRecoveryActive: Boolean(serverPlayer.collisionRecoveryActive),
                        collisionRecoveryRemainingMs: typeof serverPlayer.collisionRecoveryRemainingMs === 'number' ? serverPlayer.collisionRecoveryRemainingMs : 0,
                        collisionRecoveryDurationMs: typeof serverPlayer.collisionRecoveryDurationMs === 'number' ? serverPlayer.collisionRecoveryDurationMs : 0,
                        pumpkinFadeOutActive: Boolean(serverPlayer.pumpkinFadeOutActive),
                        pumpkinFadeOutProgress: typeof serverPlayer.pumpkinFadeOutProgress === 'number' ? serverPlayer.pumpkinFadeOutProgress : 0,
                        defeatReceivedCount: typeof serverPlayer.defeatReceivedCount === 'number' ? serverPlayer.defeatReceivedCount : 0,
                        level: typeof serverPlayer.level === 'number' ? serverPlayer.level : 1,
                        currentHealth: typeof serverPlayer.currentHealth === 'number' ? serverPlayer.currentHealth : null,
                        maxHealth: typeof serverPlayer.maxHealth === 'number' ? serverPlayer.maxHealth : null,
                        sizeMultiplier: typeof serverPlayer.sizeMultiplier === 'number' ? serverPlayer.sizeMultiplier : 1,
                        boostLockRemainingMs: typeof serverPlayer.boostLockRemainingMs === 'number' ? serverPlayer.boostLockRemainingMs : 0,
                        boostLockDurationMs: typeof serverPlayer.boostLockDurationMs === 'number' ? serverPlayer.boostLockDurationMs : 0,
                        npcChargeWindupProgress: typeof serverPlayer.npcChargeWindupProgress === 'number'
                            ? serverPlayer.npcChargeWindupProgress
                            : 0,
                    });
                }
                return;
            }

            const packetAgeSeconds = Math.min(
                0.12,
                Math.max(0, (now - (serverPlayer.clientReceivedAt || now)) / 1000)
            );
            const isPumpkinNpc = Boolean(serverPlayer.isPumpkinNpc);
            const remoteCollisionActive = Boolean(serverPlayer.collisionActive);
            const remoteCollisionRecoveryActive = Boolean(serverPlayer.collisionRecoveryActive);
            const remoteDeathActive = Boolean(serverPlayer.deathActive);
            const remoteProjectionSeconds = isPumpkinNpc
                ? 0
                : ((remoteCollisionActive || remoteCollisionRecoveryActive || remoteDeathActive)
                    ? Math.min(0.025, packetAgeSeconds)
                    : (remoteRenderDelaySeconds + packetAgeSeconds));
            const delayedTargetX = clampToWorld(
                serverPlayer.x + ((typeof serverPlayer.velocityX === 'number' ? serverPlayer.velocityX : 0) * remoteProjectionSeconds)
            );
            const delayedTargetY = clampToWorld(
                serverPlayer.y + ((typeof serverPlayer.velocityY === 'number' ? serverPlayer.velocityY : 0) * remoteProjectionSeconds)
            );

            const remoteVelocityX = typeof serverPlayer.velocityX === 'number' ? serverPlayer.velocityX : 0;
            const remoteVelocityY = typeof serverPlayer.velocityY === 'number' ? serverPlayer.velocityY : 0;

            if (current) {
                const remoteVisual = getPlayerVisual(current.id);
                const nextPumpkinNtrTriggerCount = Math.max(0, Number(serverPlayer.pumpkinNtrTriggerCount || 0));
                if (nextPumpkinNtrTriggerCount > Number(remoteVisual.pumpkinNtrTriggerCount || 0)) {
                    remoteVisual.pumpkinNtrVisualUntil = window.performance.now() + SELF_PUMPKIN_NTR_VISUAL_DURATION_MS;
                }
                remoteVisual.pumpkinNtrTriggerCount = nextPumpkinNtrTriggerCount;
                const respawnTransition = Boolean(current.deathActive) && !Boolean(serverPlayer.deathActive);
                current.displayName = getServerDisplayName(serverPlayer);
                current.skinName = serverPlayer.skinName || 'default';
                current.pumpkinBaseSkinName = serverPlayer.pumpkinBaseSkinName || '';
                current.pumpkinNtrTriggerCount = nextPumpkinNtrTriggerCount;
                current.targetX = delayedTargetX;
                current.targetY = delayedTargetY;
                if (respawnTransition) {
                    current.x = delayedTargetX;
                    current.y = delayedTargetY;
                    const visual = getPlayerVisual(current.id);
                    visual.previousX = delayedTargetX;
                    visual.previousY = delayedTargetY;
                } else if (isPumpkinNpc) {
                    current.x += (delayedTargetX - current.x) * 0.7;
                    current.y += (delayedTargetY - current.y) * 0.7;
                } else {
                    const reconcileDiffX = current.targetX - current.x;
                    const reconcileDiffY = current.targetY - current.y;
                    const reconcileDistance = Math.hypot(reconcileDiffX, reconcileDiffY);
                    const collisionSensitiveLerp = (remoteCollisionActive || remoteCollisionRecoveryActive || remoteDeathActive)
                        ? Math.max(remoteLerp, 0.5)
                        : remoteLerp;
                    if (reconcileDistance > 220) {
                        current.x = current.targetX;
                        current.y = current.targetY;
                    } else if (reconcileDistance > 0.35) {
                        current.x += reconcileDiffX * collisionSensitiveLerp;
                        current.y += reconcileDiffY * collisionSensitiveLerp;
                    }
                }
                current.velocityX = remoteVelocityX;
                current.velocityY = remoteVelocityY;
                current.facingAngle = typeof serverPlayer.facingAngle === 'number' ? serverPlayer.facingAngle : 0;
                current.isDummy = Boolean(serverPlayer.isDummy);
                current.isPumpkinNpc = Boolean(serverPlayer.isPumpkinNpc);
                current.isHouse = Boolean(serverPlayer.isHouse);
                current.houseStage = typeof serverPlayer.houseStage === 'number' ? serverPlayer.houseStage : 0;
                current.houseHealth = typeof serverPlayer.houseHealth === 'number' ? serverPlayer.houseHealth : null;
                current.houseMaxHealth = typeof serverPlayer.houseMaxHealth === 'number' ? serverPlayer.houseMaxHealth : null;
                current.houseImageKey = serverPlayer.houseImageKey || '';
                current.isNpc = Boolean(serverPlayer.isNpc);
                current.collisionImpactActive = Boolean(serverPlayer.collisionImpactActive);
                current.npcPhase = typeof serverPlayer.npcPhase === 'number' ? serverPlayer.npcPhase : 1;
                current.npcPhaseTwoRatio = typeof serverPlayer.npcPhaseTwoRatio === 'number' ? serverPlayer.npcPhaseTwoRatio : 0.6;
                current.npcPhaseThreeRatio = typeof serverPlayer.npcPhaseThreeRatio === 'number' ? serverPlayer.npcPhaseThreeRatio : 0.2;
                current.npcState = serverPlayer.npcState || '';
                current.collisionActive = Boolean(serverPlayer.collisionActive);
                current.collisionVisualType = serverPlayer.collisionVisualType || 'win';
                current.doubleState = serverPlayer.doubleState || null;
                current.collisionImpactX = typeof serverPlayer.collisionImpactX === 'number' ? serverPlayer.collisionImpactX : 0;
                current.collisionImpactY = typeof serverPlayer.collisionImpactY === 'number' ? serverPlayer.collisionImpactY : 0;
                current.deathActive = Boolean(serverPlayer.deathActive);
                current.deathFadeProgress = typeof serverPlayer.deathFadeProgress === 'number'
                    ? serverPlayer.deathFadeProgress
                    : 0;
                current.npcDeathAnimating = Boolean(serverPlayer.npcDeathAnimating);
                current.npcMaxHealth = typeof serverPlayer.npcMaxHealth === 'number' ? serverPlayer.npcMaxHealth : null;
                current.npcHealth = typeof serverPlayer.npcHealth === 'number' ? serverPlayer.npcHealth : null;
                current.npcDefeatDamageRatio = typeof serverPlayer.npcDefeatDamageRatio === 'number' ? serverPlayer.npcDefeatDamageRatio : 0;
                current.npcWinVisualActive = Boolean(serverPlayer.npcWinVisualActive);
                current.playerWinVisualActive = Boolean(serverPlayer.playerWinVisualActive);
                current.stopVisualActive = Boolean(serverPlayer.stopVisualActive);
                current.boostState = serverPlayer.boostState || 'idle';
                current.currentSpeed = typeof serverPlayer.currentSpeed === 'number'
                    ? serverPlayer.currentSpeed
                    : getPlayerSkinProfile(serverPlayer.skinName || 'default').baseSpeed;
                current.collisionRecoveryActive = Boolean(serverPlayer.collisionRecoveryActive);
                current.collisionRecoveryRemainingMs = typeof serverPlayer.collisionRecoveryRemainingMs === 'number' ? serverPlayer.collisionRecoveryRemainingMs : 0;
                current.collisionRecoveryDurationMs = typeof serverPlayer.collisionRecoveryDurationMs === 'number' ? serverPlayer.collisionRecoveryDurationMs : 0;
                current.pumpkinFadeOutActive = Boolean(serverPlayer.pumpkinFadeOutActive);
                current.pumpkinFadeOutProgress = typeof serverPlayer.pumpkinFadeOutProgress === 'number' ? serverPlayer.pumpkinFadeOutProgress : 0;
                current.defeatReceivedCount = typeof serverPlayer.defeatReceivedCount === 'number' ? serverPlayer.defeatReceivedCount : 0;
                current.level = typeof serverPlayer.level === 'number' ? serverPlayer.level : 1;
                current.currentHealth = typeof serverPlayer.currentHealth === 'number' ? serverPlayer.currentHealth : null;
                current.maxHealth = typeof serverPlayer.maxHealth === 'number' ? serverPlayer.maxHealth : null;
                current.sizeMultiplier = typeof serverPlayer.sizeMultiplier === 'number' ? serverPlayer.sizeMultiplier : 1;
                current.boostLockRemainingMs = typeof serverPlayer.boostLockRemainingMs === 'number' ? serverPlayer.boostLockRemainingMs : 0;
                current.boostLockDurationMs = typeof serverPlayer.boostLockDurationMs === 'number' ? serverPlayer.boostLockDurationMs : 0;
                current.npcChargeWindupProgress = typeof serverPlayer.npcChargeWindupProgress === 'number'
                    ? serverPlayer.npcChargeWindupProgress
                    : 0;
            } else {
                const nextPumpkinNtrTriggerCount = Math.max(0, Number(serverPlayer.pumpkinNtrTriggerCount || 0));
                const remoteVisual = getPlayerVisual(serverPlayer.id);
                remoteVisual.pumpkinNtrTriggerCount = nextPumpkinNtrTriggerCount;
                renderPlayers.push({
                    id: serverPlayer.id,
                    displayName: getServerDisplayName(serverPlayer),
                    skinName: serverPlayer.skinName || 'default',
                    pumpkinBaseSkinName: serverPlayer.pumpkinBaseSkinName || '',
                    pumpkinNtrTriggerCount: nextPumpkinNtrTriggerCount,
                    x: delayedTargetX,
                    y: delayedTargetY,
                    targetX: delayedTargetX,
                    targetY: delayedTargetY,
                    velocityX: remoteVelocityX,
                    velocityY: remoteVelocityY,
                    facingAngle: typeof serverPlayer.facingAngle === 'number' ? serverPlayer.facingAngle : 0,
                    isDummy: Boolean(serverPlayer.isDummy),
                    isPumpkinNpc: Boolean(serverPlayer.isPumpkinNpc),
                    isHouse: Boolean(serverPlayer.isHouse),
                    houseStage: typeof serverPlayer.houseStage === 'number' ? serverPlayer.houseStage : 0,
                    houseHealth: typeof serverPlayer.houseHealth === 'number' ? serverPlayer.houseHealth : null,
                    houseMaxHealth: typeof serverPlayer.houseMaxHealth === 'number' ? serverPlayer.houseMaxHealth : null,
                    houseImageKey: serverPlayer.houseImageKey || '',
                    collisionImpactActive: Boolean(serverPlayer.collisionImpactActive),
                    isNpc: Boolean(serverPlayer.isNpc),
                    npcPhase: typeof serverPlayer.npcPhase === 'number' ? serverPlayer.npcPhase : 1,
                    npcPhaseTwoRatio: typeof serverPlayer.npcPhaseTwoRatio === 'number' ? serverPlayer.npcPhaseTwoRatio : 0.6,
                    npcPhaseThreeRatio: typeof serverPlayer.npcPhaseThreeRatio === 'number' ? serverPlayer.npcPhaseThreeRatio : 0.2,
                    npcState: serverPlayer.npcState || '',
                    collisionActive: Boolean(serverPlayer.collisionActive),
                    collisionVisualType: serverPlayer.collisionVisualType || 'win',
                    doubleState: serverPlayer.doubleState || null,
                    collisionImpactX: typeof serverPlayer.collisionImpactX === 'number' ? serverPlayer.collisionImpactX : 0,
                    collisionImpactY: typeof serverPlayer.collisionImpactY === 'number' ? serverPlayer.collisionImpactY : 0,
                    deathActive: Boolean(serverPlayer.deathActive),
                    deathFadeProgress: typeof serverPlayer.deathFadeProgress === 'number'
                        ? serverPlayer.deathFadeProgress
                        : 0,
                    npcDeathAnimating: Boolean(serverPlayer.npcDeathAnimating),
                    npcMaxHealth: typeof serverPlayer.npcMaxHealth === 'number' ? serverPlayer.npcMaxHealth : null,
                    npcHealth: typeof serverPlayer.npcHealth === 'number' ? serverPlayer.npcHealth : null,
                    npcDefeatDamageRatio: typeof serverPlayer.npcDefeatDamageRatio === 'number' ? serverPlayer.npcDefeatDamageRatio : 0,
                    npcWinVisualActive: Boolean(serverPlayer.npcWinVisualActive),
                    playerWinVisualActive: Boolean(serverPlayer.playerWinVisualActive),
                    stopVisualActive: Boolean(serverPlayer.stopVisualActive),
                    boostState: serverPlayer.boostState || 'idle',
                    currentSpeed: typeof serverPlayer.currentSpeed === 'number'
                        ? serverPlayer.currentSpeed
                        : getPlayerSkinProfile(serverPlayer.skinName || 'default').baseSpeed,
                    collisionRecoveryActive: Boolean(serverPlayer.collisionRecoveryActive),
                    collisionRecoveryRemainingMs: typeof serverPlayer.collisionRecoveryRemainingMs === 'number' ? serverPlayer.collisionRecoveryRemainingMs : 0,
                    collisionRecoveryDurationMs: typeof serverPlayer.collisionRecoveryDurationMs === 'number' ? serverPlayer.collisionRecoveryDurationMs : 0,
                    pumpkinFadeOutActive: Boolean(serverPlayer.pumpkinFadeOutActive),
                    pumpkinFadeOutProgress: typeof serverPlayer.pumpkinFadeOutProgress === 'number' ? serverPlayer.pumpkinFadeOutProgress : 0,
                    defeatReceivedCount: typeof serverPlayer.defeatReceivedCount === 'number' ? serverPlayer.defeatReceivedCount : 0,
                    level: typeof serverPlayer.level === 'number' ? serverPlayer.level : 1,
                    currentHealth: typeof serverPlayer.currentHealth === 'number' ? serverPlayer.currentHealth : null,
                    maxHealth: typeof serverPlayer.maxHealth === 'number' ? serverPlayer.maxHealth : null,
                    sizeMultiplier: typeof serverPlayer.sizeMultiplier === 'number' ? serverPlayer.sizeMultiplier : 1,
                    boostLockRemainingMs: typeof serverPlayer.boostLockRemainingMs === 'number' ? serverPlayer.boostLockRemainingMs : 0,
                    boostLockDurationMs: typeof serverPlayer.boostLockDurationMs === 'number' ? serverPlayer.boostLockDurationMs : 0,
                    npcChargeWindupProgress: typeof serverPlayer.npcChargeWindupProgress === 'number'
                        ? serverPlayer.npcChargeWindupProgress
                        : 0,
                });
            }
        });

        if (predictedSelf && selfPositionNode) {
            selfPositionNode.textContent = Math.round(predictedSelf.x) + ', ' + Math.round(predictedSelf.y);
        } else if (selfPositionNode) {
            selfPositionNode.textContent = '-';
        }

        renderPlayers.forEach(function (player) {
            const visual = getPlayerVisual(player.id);
            const directionVector = getPlayerDirectionVector(player, visual);
            if (visual.previousX === null || visual.previousY === null) {
                visual.previousX = player.x;
                visual.previousY = player.y;
                setVisualDirection(visual, directionVector.dx, directionVector.dy, {
                    usesLeftFacingSprite: usesLeftFacingSpriteForPlayer(player)
                });
                return;
            }

            setVisualDirection(visual, directionVector.dx, directionVector.dy, {
                usesLeftFacingSprite: usesLeftFacingSpriteForPlayer(player)
            });
        });

        const spectatablePlayers = syncSpectateTarget();
        let cameraTargetPlayer = renderPlayers.find(function (player) {
            return player.id === selfId;
        });
        if (selfDeathActive && selfDeathRespawnReady && spectatablePlayers.length > 0) {
            cameraTargetPlayer = renderPlayers.find(function (player) {
                return player.id === spectateTargetId;
            }) || spectatablePlayers[0];
        }
        if (!cameraTargetPlayer) {
            cameraTargetPlayer = renderPlayers[0] || { x: worldSize / 2, y: worldSize / 2 };
        }
        const viewportWorldWidth = getViewportDisplayWidth() / effectiveZoom;
        const viewportWorldHeight = getViewportDisplayHeight() / effectiveZoom;
        const deadZoneWidth = viewportWorldWidth * cameraDeadZoneRatioX;
        const deadZoneHeight = viewportWorldHeight * cameraDeadZoneRatioY;
        const currentCenterX = cameraX + viewportWorldWidth / 2;
        const currentCenterY = cameraY + viewportWorldHeight / 2;
        let desiredCenterX = cameraTargetPlayer.x;
        let desiredCenterY = cameraTargetPlayer.y;
        const cameraTargetVisual = getPlayerVisual(cameraTargetPlayer.id);
        const cameraLeadVector = getPlayerDirectionVector(cameraTargetPlayer, cameraTargetVisual);
        const cameraLeadMagnitude = Math.hypot(cameraLeadVector.dx, cameraLeadVector.dy);
        const cameraIsMoving = cameraLeadMagnitude > cameraLeadSpeedThreshold;
        if (cameraLeadMagnitude > cameraLeadSpeedThreshold) {
            desiredCenterX += (cameraLeadVector.dx / cameraLeadMagnitude) * viewportWorldWidth * cameraLeadRatioX;
            desiredCenterY += (cameraLeadVector.dy / cameraLeadMagnitude) * viewportWorldHeight * cameraLeadRatioY;
        }
        let targetCenterX = currentCenterX;
        let targetCenterY = currentCenterY;

        if (!cameraIsMoving) {
            targetCenterX = desiredCenterX;
            targetCenterY = desiredCenterY;
        } else {
            if (desiredCenterX < currentCenterX - deadZoneWidth) {
                targetCenterX = desiredCenterX + deadZoneWidth;
            } else if (desiredCenterX > currentCenterX + deadZoneWidth) {
                targetCenterX = desiredCenterX - deadZoneWidth;
            }

            if (desiredCenterY < currentCenterY - deadZoneHeight) {
                targetCenterY = desiredCenterY + deadZoneHeight;
            } else if (desiredCenterY > currentCenterY + deadZoneHeight) {
                targetCenterY = desiredCenterY - deadZoneHeight;
            }
        }

        const targetCameraX = targetCenterX - viewportWorldWidth / 2;
        const targetCameraY = targetCenterY - viewportWorldHeight / 2;
        cameraX += (targetCameraX - cameraX) * cameraFollow;
        cameraY += (targetCameraY - cameraY) * cameraFollow;
        const maxCameraX = Math.max(0, worldSize - viewportWorldWidth);
        const maxCameraY = Math.max(0, worldSize - viewportWorldHeight);
        cameraX = Math.max(0, Math.min(maxCameraX, cameraX));
        cameraY = Math.max(0, Math.min(maxCameraY, cameraY));

        drawGrid(cameraX, cameraY, effectiveZoom);
        drawLevelDrops(cameraX, cameraY, effectiveZoom);
        drawPlayers(cameraX, cameraY, deltaSeconds, effectiveZoom);
        drawMinimap();
        updateConfetti(deltaSeconds, now);
        updateLoadingSpinner(now);
        window.requestAnimationFrame(render);
    };

    const handleKey = function (value) {
        // Keydown/keyup handlers are generated from one factory so boost and directional keys share the same send path.
        return function (event) {
            const mapped = keyMap[event.key];
            if (startOverlay && !startOverlay.hidden && (event.key === ' ' || event.key === 'c' || event.key === 'C' || mapped)) {
                event.preventDefault();
                return;
            }
            if (selfDeathActive && (event.key === ' ' || event.key === 'c' || event.key === 'C' || mapped)) {
                event.preventDefault();
                if (mapped) {
                    keyboardDirectionInput[mapped] = false;
                    syncDirectionalInput();
                }
                input.boost = false;
                input.special = false;
                return;
            }
            if (event.key === ' ') {
                event.preventDefault();
                if (boostLockedActive) {
                    input.boost = false;
                    sendInputNow();
                    return;
                }
                input.boost = value;
                if (!value && boostState === 'cooldown' && currentMoveSpeed <= getSelectedPlayerBaseSpeed()) {
                    boostState = 'idle';
                }
                sendInputNow();
                return;
            }

            if (event.key === 'c' || event.key === 'C') {
                event.preventDefault();
                input.special = value;
                sendInputNow();
                return;
            }

            if (!mapped) {
                return;
            }
            event.preventDefault();
            keyboardDirectionInput[mapped] = value;
            syncDirectionalInput();
            sendInputNow();
        };
    };

    document.addEventListener('keydown', handleKey(true));
    document.addEventListener('keyup', handleKey(false));
    musicMuted = readMutePreference(MUSIC_MUTED_STORAGE_KEY);
    effectsMuted = readMutePreference(SFX_MUTED_STORAGE_KEY);
    applyMusicMuteState();
    updateAudioToggleButtons();
    const unlockBackgroundMusicPlayback = function () {
        // First trusted user interaction is used to satisfy autoplay restrictions and resume BGM if needed.
        if (!backgroundMusicAudio) {
            updateBackgroundMusic();
            return;
        }
        if (backgroundMusicAudio.paused || backgroundMusicAutoplayBlocked) {
            tryPlayBackgroundMusic();
        }
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (eventName) {
        document.addEventListener(eventName, unlockBackgroundMusicPlayback, { passive: true });
    });
    if (musicMuteToggleButton) {
        musicMuteToggleButton.addEventListener('click', function () {
            musicMuted = !musicMuted;
            writeMutePreference(MUSIC_MUTED_STORAGE_KEY, musicMuted);
            applyMusicMuteState();
            updateAudioToggleButtons();
        });
    }
    if (sfxMuteToggleButton) {
        sfxMuteToggleButton.addEventListener('click', function () {
            const wasMuted = effectsMuted;
            effectsMuted = !effectsMuted;
            writeMutePreference(SFX_MUTED_STORAGE_KEY, effectsMuted);
            if (effectsMuted) {
                stopAllPlayerSounds();
            } else if (wasMuted) {
                playRandomCrashSound(getSkinConfig('default').sounds.crash, undefined, '__sfx_toggle__');
            }
            updateAudioToggleButtons();
        });
    }
    if (masterVolumeSlider) {
        masterVolume = Math.max(0, Math.min(1, Number(masterVolumeSlider.value || 20) / 100));
        syncMasterVolumeSliderVisual();
        masterVolumeSlider.addEventListener('input', function () {
            masterVolume = Math.max(0, Math.min(1, Number(masterVolumeSlider.value || 20) / 100));
            syncMasterVolumeSliderVisual();
        });
    }
    if (deathModalRespawnButton) {
        deathModalRespawnButton.addEventListener('click', function () {
            if (!selfDeathActive || !selfDeathRespawnReady || selfLivesRemaining <= 0) {
                return;
            }

            if (!socket || socket.readyState !== window.WebSocket.OPEN) {
                return;
            }

            respawnRequestPending = true;
            input.respawn = true;
            sendInputNow();
            setDeathModalState(selfDeathActive, selfDeathRespawnReady, selfLivesRemaining);
        });
    }
    if (deathModalSpectatePrevButton) {
        deathModalSpectatePrevButton.addEventListener('click', function () {
            cycleSpectateTarget(-1);
            setDeathModalState(selfDeathActive, selfDeathRespawnReady, selfLivesRemaining);
        });
    }
    if (deathModalSpectateNextButton) {
        deathModalSpectateNextButton.addEventListener('click', function () {
            cycleSpectateTarget(1);
            setDeathModalState(selfDeathActive, selfDeathRespawnReady, selfLivesRemaining);
        });
    }
    if (fullscreenToggles.length) {
        fullscreenToggles.forEach(function (fullscreenToggle) {
            fullscreenToggle.addEventListener('click', function () {
                if (!isCompactViewport) {
                    return;
                }
                setFullscreenMode(true);
            });
        });
    }
    if (fullscreenExitButton) {
        fullscreenExitButton.addEventListener('click', function () {
            setFullscreenMode(false);
        });
    }
    if (escMenuButton) {
        escMenuButton.addEventListener('click', function () {
            runEscapeAction();
        });
    }
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') {
            return;
        }
        if (runEscapeAction()) {
            event.preventDefault();
        }
    });
    window.addEventListener('resize', function () {
        syncFullscreenViewportSize();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function () {
            syncFullscreenViewportSize();
        });
    }
    if (mobileControlsToggle) {
        mobileControlsToggle.addEventListener('click', function () {
            if (!isCompactViewport) {
                return;
            }
            setMobileControlsOpen(mobileControls.hidden);
        });
    }
    if (joystick) {
        joystick.addEventListener('pointerdown', function (event) {
            if (selfDeathActive) {
                return;
            }
            event.preventDefault();
            joystickPointerId = event.pointerId;
            if (joystick.setPointerCapture) {
                joystick.setPointerCapture(event.pointerId);
            }
            updateJoystickInput(event.clientX, event.clientY);
        });
        joystick.addEventListener('pointermove', function (event) {
            if (selfDeathActive) {
                return;
            }
            if (event.pointerId !== joystickPointerId) {
                return;
            }
            event.preventDefault();
            updateJoystickInput(event.clientX, event.clientY);
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (eventName) {
            joystick.addEventListener(eventName, function (event) {
                if (event.pointerId !== undefined && joystickPointerId !== null && event.pointerId !== joystickPointerId && eventName !== 'lostpointercapture') {
                    return;
                }
                resetJoystick();
            });
        });
    }
    if (mobileBoostButton) {
        const setBoostState = function (value) {
            // Mobile boost button feeds the same input state as keyboard boost to avoid divergent control logic.
            if (selfDeathActive) {
                input.boost = false;
                return;
            }
            if (boostLockedActive) {
                input.boost = false;
                sendInputNow();
                return;
            }
            input.boost = value;
            if (!value && boostState === 'cooldown' && currentMoveSpeed <= getSelectedPlayerBaseSpeed()) {
                boostState = 'idle';
            }
            sendInputNow();
        };
        mobileBoostButton.addEventListener('pointerdown', function (event) {
            event.preventDefault();
            setBoostState(true);
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (eventName) {
            mobileBoostButton.addEventListener(eventName, function (event) {
                event.preventDefault();
                setBoostState(false);
            });
        });
    }
    canvas.addEventListener('contextmenu', function (event) {
        event.preventDefault();
    });
    canvas.addEventListener('pointerdown', function (event) {
        if (!gameStarted || selfDeathActive) {
            return;
        }
        syncMouseButtons(event.buttons, event);
        updateMouseTarget(event.clientX, event.clientY);
        if (event.button === 0) {
            event.preventDefault();
            sendInputNow();
        }
    });
    canvas.addEventListener('mousedown', function (event) {
        if (!gameStarted || selfDeathActive) {
            return;
        }
        syncMouseButtons(event.buttons, event);
        if (event.button === 2) {
            event.preventDefault();
            sendInputNow(true);
        }
    });
    canvas.addEventListener('pointermove', function (event) {
        if (!gameStarted) {
            return;
        }
        syncMouseButtons(event.buttons, event);
        updateMouseTarget(event.clientX, event.clientY);
        if (mouseMoveActive) {
            updateMouseDirectionalInput();
            sendInputNow();
        }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (eventName) {
        canvas.addEventListener(eventName, function (event) {
            if (eventName === 'pointerleave' || eventName === 'pointercancel') {
                mouseLeftHeld = false;
                mouseRightHeld = false;
                mouseBoostRequested = false;
                refreshMouseMoveState();
            } else {
                syncMouseButtons(event.buttons, event);
                if (event.button === 2) {
                    mouseBoostRequested = false;
                    refreshMouseMoveState();
                }
            }
            sendInputNow();
        });
    });
    if (startButton) {
        startButton.addEventListener('click', function () {
            resumeGameFromStartOverlay();
        });
    }
    if (startCharacterButton) {
        startCharacterButton.addEventListener('click', function () {
            renderSkinList();
            setSkinModalOpen(true);
        });
    }
    if (skinModalCloseButton) {
        skinModalCloseButton.addEventListener('click', function () {
            setSkinModalOpen(false);
        });
    }
    if (skinModal) {
        skinModal.addEventListener('click', function (event) {
            if (event.target === skinModal) {
                setSkinModalOpen(false);
            }
        });
    }
    if (skinSelectButton) {
        skinSelectButton.addEventListener('click', function () {
            if (!selectedSkinDetailName) {
                return;
            }
            applySelectedSkin(selectedSkinDetailName);
            setSkinModalOpen(false);
        });
    }
    if (reconnectButton) {
        reconnectButton.addEventListener('click', function () {
            startGame();
        });
    }
    idleModalCloseButtons.forEach(function (idleModalCloseButton) {
        idleModalCloseButton.addEventListener('click', function () {
            returnToInitialStartScreen();
        });
    });

    setFullscreenMode(false);
    updateCompactViewportUI();
    updateStartCharacterPreview();
    renderSkinList();
    setStartOverlayOpen(true);
    setSkinModalOpen(false);
    setLoadingOverlayOpen(true);
    setStatus(labels.disconnected, '#64748b');
    setPing(null);
    updateBackgroundMusic();
    render();
    releaseInitialLoadingOverlay();
})();
