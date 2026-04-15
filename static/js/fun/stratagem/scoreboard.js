// Scoreboard page — 다시 하기 버튼으로 게임 페이지로 돌아간다.
document.addEventListener('DOMContentLoaded', function () {
    const replayBtn = document.getElementById('scoreboard_replay_btn');
    if (replayBtn) {
        replayBtn.addEventListener('click', function () {
            location.replace(new URL('../', window.location.href).toString());
        });
    }
});
