// Stratagem Hero game page script.
// One-at-a-time mode: shows one stratagem card at a time, with a real-time timer and remaining count.

// ── Sound ──────────────────────────────────────────────────────────────────
function waitForAudioEnd(audioElement) {
    return new Promise(resolve => {
        let resolved = false;
        let timeoutId = null;
        const finish = () => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            audioElement.removeEventListener('ended', finish);
            audioElement.removeEventListener('error', finish);
            resolve();
        };

        audioElement.addEventListener('ended', finish);
        audioElement.addEventListener('error', finish);
        timeoutId = setTimeout(finish, 600);
    });
}

async function playSound(soundURL, options = {}) {
    const soundEffect = new Audio(soundURL);
    const endPromise = options.waitUntilEnd ? waitForAudioEnd(soundEffect) : null;
    try {
        await soundEffect.play();
    } catch (error) {
        return;
    }
    if (endPromise) {
        await endPromise;
    }
}

// ── CSRF ───────────────────────────────────────────────────────────────────
function getCSRFToken() {
    return document.querySelector('meta[name="csrf-token"]').getAttribute('content');
}

// ── Game state ─────────────────────────────────────────────────────────────
let queue = [];          // 순서대로 정렬된 카드 Element 배열
let currentIdx = 0;      // 현재 표시 중인 카드 인덱스
let typecommand = "";    // 현재 입력 중인 커맨드 문자열
let startTime = null;    // performance.now() 기준 시작 시각
let timerInterval = null;
let seconds = 0;         // 최종 기록 (게임 완료 후)
let isClearingCard = false;
const TOTAL = 10;

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer() {
    startTime = performance.now();
    timerInterval = setInterval(() => {
        const t = ((performance.now() - startTime) / 1000).toFixed(2);
        const timerEl = document.querySelector('.game_timer');
        if (timerEl) timerEl.textContent = `⏱ ${t}초`;
    }, 50);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    seconds = ((performance.now() - startTime) / 1000).toFixed(2);
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function updateStatusBar() {
    const remaining = TOTAL - currentIdx;
    const el = document.querySelector('.game_remaining');
    if (el) el.textContent = `${remaining} / ${TOTAL}`;
}

function resetHighlights(card) {
    if (!card) return;
    card.querySelectorAll('.stratagem_command img').forEach(img => {
        img.style.filter = 'none';
    });
}

function updateHighlights(card, typedLength) {
    if (!card) return;
    card.querySelectorAll('.stratagem_command img').forEach(img => {
        const id = parseInt(img.id);
        img.style.filter = (typedLength - 1 >= id) ? 'sepia(100%)' : 'none';
    });
}

function showScore() {
    const scoreEl = document.querySelector('.score_time');
    if (scoreEl) scoreEl.textContent = seconds + '초';

    const statusBar = document.querySelector('.game_status_bar');
    if (statusBar) statusBar.style.display = 'none';

    const descBottom = document.querySelector('.description_bottom');
    if (descBottom) descBottom.style.display = 'none';

    const scorePanel = document.querySelector('.stratagem_score');
    if (scorePanel) scorePanel.style.display = 'flex';
}

// ── Initialisation ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    // 커맨드 화살표 이미지 생성
    document.querySelectorAll('.stratagem_command').forEach(function (commandDiv) {
        const commandNumber = commandDiv.dataset.command;
        commandNumber.toString().split('').forEach(function (digit, index) {
            const img = document.createElement('img');
            img.src = `/static/media/icon/arrow${digit}.png`;
            img.alt = `arrow ${digit}`;
            img.classList.add('commend_arrow');
            img.setAttribute('id', String(index));
            commandDiv.appendChild(img);
        });
    });

    // 큐 초기화: 모든 카드 숨기고 첫 번째만 표시
    queue = Array.from(document.querySelectorAll('.stratagem_card'));
    queue.forEach(card => { card.style.display = 'none'; });
    if (queue.length > 0) queue[0].style.display = '';
    updateStatusBar();

    // 모바일 d-pad 버튼 연결
    function simulateKeyEvent(key) {
        document.dispatchEvent(new KeyboardEvent('keydown', { 'key': key }));
    }
    document.querySelector('.arrow-top')?.addEventListener('click', () => simulateKeyEvent('ArrowUp'));
    document.querySelector('.arrow-bottom')?.addEventListener('click', () => simulateKeyEvent('ArrowDown'));
    document.querySelector('.arrow-left')?.addEventListener('click', () => simulateKeyEvent('ArrowLeft'));
    document.querySelector('.arrow-right')?.addEventListener('click', () => simulateKeyEvent('ArrowRight'));

    // 점수 등록 버튼
    const input_score_button = document.getElementById('input_score_button');
    if (input_score_button) {
        input_score_button.addEventListener('click', () => {
            const textInputValue = document.getElementById('input_score_name').value;
            if (textInputValue.length > 0) {
                fetch('add_score/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCSRFToken()
                    },
                    body: JSON.stringify({ name: textInputValue, score: seconds })
                }).then(response => response.json())
                    .then(data => console.log('Success:', data))
                    .catch(error => console.error('Error:', error));
            }
            location.href = 'Scoreboard/';
        });
    }
});

// ── Main game loop ─────────────────────────────────────────────────────────
document.addEventListener('keydown', async function (event) {
    const currentCard = queue[currentIdx];
    if (!currentCard) return; // 게임 종료 상태
    if (isClearingCard) return;

    // 유효 키 판별 (방향키 or WASD)
    const key = event.key;
    let digit = null;
    switch (key) {
        case 'ArrowLeft':  case 'a': digit = '1'; break;
        case 'ArrowDown':  case 's': digit = '2'; break;
        case 'ArrowRight': case 'd': digit = '3'; break;
        case 'ArrowUp':    case 'w': digit = '5'; break;
        default:
            // 유효하지 않은 키 → 현재 입력 초기화
            typecommand = '';
            resetHighlights(currentCard);
            return;
    }

    // 첫 입력 시 타이머 시작
    if (startTime === null) startTimer();

    typecommand += digit;
    const command = currentCard.querySelector('.stratagem_command').dataset.command;

    if (command.startsWith(typecommand)) {
        // 올바른 prefix 입력
        updateHighlights(currentCard, typecommand.length);

        if (typecommand === command) {
            // 완전 일치 → 카드 클리어
            isClearingCard = true;
            await playSound('/static/media/mp3/stratagem/stratagem1.mp3', { waitUntilEnd: true });
            playSound('/static/media/mp3/stratagem/stratagem4.mp3');
            setTimeout(() => {
                currentCard.style.display = 'none';
                resetHighlights(currentCard);
                typecommand = '';
                currentIdx++;
                updateStatusBar();
                isClearingCard = false;

                if (currentIdx >= TOTAL) {
                    // 모든 카드 클리어 → 게임 완료
                    stopTimer();
                    showScore();
                } else {
                    // 다음 카드 표시
                    queue[currentIdx].style.display = '';
                }
            }, 500);
        } else {
            // 부분 일치 → 입력 진행음
            await playSound('/static/media/mp3/stratagem/stratagem1.mp3');
        }
    } else {
        // 잘못된 입력 → 오류음 + 초기화
        const randomOption = Math.floor(Math.random() * 2);
        playSound(randomOption === 0
            ? '/static/media/mp3/stratagem/stratagem2.mp3'
            : '/static/media/mp3/stratagem/stratagem3.mp3'
        );
        typecommand = '';
        resetHighlights(currentCard);
    }
});
