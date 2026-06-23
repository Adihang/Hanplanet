from pathlib import Path

from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import reverse


class SalvationsFireteamTests(TestCase):
    def test_template_exposes_fireteam_viewer(self):
        response = self.client.get(reverse("main:Salvations_Edge_4_lang", kwargs={"ui_lang": "ko"}))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="salvations_fireteam"', html=False)
        self.assertContains(response, 'data-fireteam-url="/ko/api/salvations/fireteam/"', html=False)
        self.assertContains(response, 'class="Salvations_Edge_4 site-loading-host"', html=False)
        self.assertContains(response, "화력팀 장비 보기", html=False)
        self.assertContains(response, 'placeholder="Profile#1234"', html=False)
        self.assertContains(response, 'class="salvations-fireteam-submit-icon"', html=False)
        self.assertContains(response, 'class="salvations-fireteam-results" id="salvations_fireteam_results" hidden', html=False)
        self.assertContains(response, 'id="salvations_fireteam_status" role="status" aria-live="polite" hidden', html=False)
        self.assertContains(response, 'id="salvations_fireteam_loading"', html=False)
        self.assertContains(response, 'class="salvations-fireteam-loading site-loading-overlay"', html=False)
        self.assertContains(response, 'class="salvations-fireteam-loading-spinner site-loading-spinner"', html=False)
        self.assertNotContains(response, 'salvations_fireteam_results_pip', html=False)
        self.assertNotContains(response, 'class="outside_action_button" id="salvations_fireteam_submit"', html=False)
        self.assertNotContains(response, "장비를 불러오는 중...", html=False)
        self.assertNotContains(
            response,
            "Bungie 프로필을 검색해 죽은 수호자 맞추기에 필요한 화력팀 방어구와 고스트를 확인합니다.",
            html=False,
        )
        html = response.content.decode()
        self.assertLess(html.index('class="salvations-primary"'), html.index('id="salvations_fireteam"'))

    def test_fireteam_uses_native_browser_picture_in_picture(self):
        script = (Path(settings.BASE_DIR) / "static/js/fun/salvations_edge_4/page.js").read_text(encoding="utf-8")

        self.assertIn("canvas.captureStream", script)
        self.assertIn("video.requestPictureInPicture", script)
        self.assertIn("openFireteamPictureInPicture", script)
        self.assertIn("ensureFireteamPictureInPictureSession", script)
        self.assertIn("prepareFireteamPictureInPictureSession", script)
        self.assertIn("showFireteamPictureInPicture", script)
        self.assertIn("configureFireteamPipCanvas", script)
        self.assertIn("buildFireteamPipGroups", script)
        self.assertIn("drawFireteamPipMember", script)
        self.assertIn("const canvasHeight = top + classTitleHeight + memberTopGap + memberHeight + bottomPadding;", script)
        self.assertIn("video.autoplay = true;", script)
        self.assertIn("metadataPromise", script)
        self.assertIn("loadedmetadata", script)
        self.assertIn("video.readyState < HTMLMediaElement.HAVE_METADATA", script)
        self.assertIn("prepareFireteamPictureInPictureSession();", script)
        self.assertIn("fireteamQueryInput.addEventListener('focus', prepareFireteamPictureInPictureSession);", script)
        self.assertIn("await openFireteamPictureInPicture(payload.groups);", script)
        self.assertIn("closeFireteamPictureInPicture();", script)
        self.assertIn("no_members: t('fireteamNoMembers')", script)
        self.assertIn("let pipOpenPromise = null;", script)
        self.assertIn("pipOpenPromise = showFireteamPictureInPicture();", script)
        self.assertIn("loadFireteam(query, pipOpenPromise);", script)
        self.assertIn("await pipOpenPromise;", script)
        self.assertLess(
            script.index("pipOpenPromise = showFireteamPictureInPicture();"),
            script.index("loadFireteam(query, pipOpenPromise);"),
        )
        self.assertLess(
            script.index("await pipOpenPromise;"),
            script.index("const response = await fetch"),
        )
        self.assertLess(
            script.index("const payload = await response.json()"),
            script.index("await openFireteamPictureInPicture(payload.groups);"),
        )
        self.assertNotIn("canvas.width = 960", script)
        self.assertNotIn("canvas.height = 540", script)
        self.assertNotIn("drawFireteamPipLoading", script)
        self.assertNotIn("drawFireteamPipMessage", script)
        self.assertNotIn("await document.exitPictureInPicture", script)
        self.assertNotIn("await fireteamPipSession.video.play()", script)
        self.assertNotIn("t('fireteamTitle')", script)
        self.assertNotIn("rgba(255, 255, 255, 0.035)", script)
        self.assertNotIn("strokeRect(left + 0.5", script)
        self.assertNotIn("salvations_fireteam_results_pip", script)

    def test_fireteam_members_keep_vertical_equipment_layout(self):
        css = (Path(settings.BASE_DIR) / "static/css/fun/salvations_edge_4/style.css").read_text(encoding="utf-8")

        primary_block = css[
            css.index(".salvations-primary {"):css.index(".main_title{")
        ]
        main_title_block = css[
            css.index(".main_title{"):css.index("body.salvations-page .footer-links {")
        ]
        main_text_block = css[
            css.index(".main_text{"):css.index(".select_team .main_text {")
        ]
        fireteam_block = css[
            css.index(".salvations-fireteam {"):css.index(".salvations-fireteam::before {")
        ]
        fireteam_separator_block = css[
            css.index(".salvations-fireteam::before {"):css.index(".salvations-fireteam-head {")
        ]
        fireteam_head_block = css[
            css.index(".salvations-fireteam-head {"):css.index(".salvations-fireteam-head h2 {")
        ]
        members_block = css[
            css.index(".salvations-fireteam-members {"):css.index(".salvations-fireteam-member {")
        ]
        member_block = css[
            css.index(".salvations-fireteam-member {"):css.index(".salvations-fireteam-name {")
        ]
        equipment_block = css[
            css.index(".salvations-fireteam-equipment {"):css.index(".salvations-fireteam-item {")
        ]
        item_block = css[
            css.index(".salvations-fireteam-item {"):css.index(".salvations-fireteam-item img {")
        ]

        self.assertIn("padding: 0;", primary_block)
        self.assertNotIn("padding: 24px 16px 8px;", primary_block)
        self.assertNotIn("margin-top: 24px;", primary_block)
        self.assertIn("margin: 0;", main_title_block)
        self.assertIn("margin: 0;", main_text_block)
        self.assertIn("padding-top: 12px;", main_text_block)
        self.assertIn("margin: 24px 0 0;", fireteam_block)
        self.assertIn("padding: 0;", fireteam_block)
        self.assertIn("border-top: 1px solid var(--salvation-border);", fireteam_separator_block)
        self.assertIn("margin: 0 auto 24px;", fireteam_separator_block)
        self.assertIn("width: min(100%, 210px);", fireteam_head_block)
        self.assertIn("max-width: 210px;", fireteam_head_block)
        self.assertNotIn("300px", fireteam_head_block)
        self.assertIn("flex-direction: row;", members_block)
        self.assertIn("justify-content: center;", members_block)
        self.assertNotIn("flex-direction: column;", members_block)
        self.assertIn("flex-direction: column;", member_block)
        self.assertNotIn("flex-direction: row;", member_block)
        self.assertIn("display: flex;", equipment_block)
        self.assertIn("flex-direction: column;", equipment_block)
        self.assertNotIn("grid-template-columns", equipment_block)
        self.assertNotIn("background:", item_block)
        self.assertNotIn("border:", item_block)

    @override_settings(BUNGIE_API_KEY="")
    def test_fireteam_api_requires_bungie_api_key(self):
        response = self.client.get(
            reverse("main:salvations_fireteam_api_lang", kwargs={"ui_lang": "ko"}),
            {"q": "Profile#1234"},
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"ok": False, "error": "bungie_config_missing"})
