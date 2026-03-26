import base64
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.core.cache import cache, caches
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from datetime import date, datetime
from importlib import import_module

from .models import HandriveAccessRule, NavLink, UserProfile
from portfolio.models import Career, PortfolioActionButton, PortfolioCareer, PortfolioProfile, PortfolioProject
from stratagem.models import Stratagem_Hero_Score
from .handrive_views import (
    DOCS_EDIT_PERMISSION_CODE,
    HANDRIVE_EDITOR_GROUP_NAME,
    DOCS_PUBLIC_WRITE_GROUP_NAME,
    DOCS_USER_SCOPED_ENTRY_LIMIT,
    DOCS_USER_SCOPED_QUOTA_BYTES,
    DOCS_URL_ONLY_GROUP_NAME,
    _apply_forgejo_session_cookie,
    _attach_forgejo_login_session,
    _build_forgejo_authenticated_redirect,
    _build_forgejo_logged_out_redirect,
    _build_forgejo_session_blob,
    _delete_forgejo_session_artifacts,
    _forgejo_db_path,
    _forgejo_server_logout,
    _resolve_handrive_post_login_url,
    get_handrive_text,
    get_handrive_upload_tmp_dir,
    get_handrive_public_write_group,
    is_handrive_editor,
)
from .views import (
    build_game_auth_token,
    build_lang_switch_url,
    has_excessive_korean_text,
    render_markdown_safely,
    render_markdown_with_raw_html,
    resolve_ui_lang,
    should_return_github_link,
)


class MarkdownSafetyTests(TestCase):
    def test_render_markdown_escapes_raw_html(self):
        rendered = render_markdown_safely("<script>alert(1)</script> **bold**")
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", rendered)
        self.assertNotIn("<script>", rendered)
        self.assertIn("<strong>bold</strong>", rendered)

    def test_render_markdown_with_raw_html_keeps_html(self):
        rendered = render_markdown_with_raw_html('<div class="embed">ok</div> **bold**')
        self.assertIn('<div class="embed">ok</div>', rendered)
        self.assertIn("<strong>bold</strong>", rendered)

    def test_render_markdown_supports_fenced_code_blocks(self):
        rendered = render_markdown_safely("```python\nprint('hi')\n```")
        self.assertIn("<pre><code", rendered)
        self.assertIn("language-python", rendered)
        self.assertIn("print('hi')", rendered)
        self.assertNotIn("&amp;#x27;", rendered)

    def test_render_markdown_supports_blockquotes(self):
        rendered = render_markdown_safely("> quoted")
        self.assertIn("<blockquote>", rendered)
        self.assertIn("<p>quoted</p>", rendered)

    def test_render_markdown_supports_indented_fenced_code_blocks(self):
        rendered = render_markdown_safely(
            "- item\n"
            "    ```python\n"
            "    a=1\n"
            "    b=2\n"
            "    ```\n"
        )
        self.assertIn('<pre><code class="language-python">', rendered)
        self.assertIn("a=1", rendered)
        self.assertIn("b=2", rendered)
        self.assertNotIn("<code>python", rendered)


class AddScoreViewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.url = reverse("main:add_score")

    def post_json(self, payload):
        return self.client.post(
            self.url,
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_add_score_accepts_valid_payload(self):
        response = self.post_json({"name": "Tester_01", "score": 12.34})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Stratagem_Hero_Score.objects.count(), 1)
        self.assertEqual(Stratagem_Hero_Score.objects.first().name, "Tester_01")

    def test_add_score_rejects_invalid_name(self):
        response = self.post_json({"name": "<script>", "score": 10})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Stratagem_Hero_Score.objects.count(), 0)

    def test_add_score_rejects_out_of_range_score(self):
        response = self.post_json({"name": "player", "score": -1})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Stratagem_Hero_Score.objects.count(), 0)

    def test_add_score_rate_limits_after_threshold(self):
        for _ in range(20):
            response = self.post_json({"name": "player", "score": 11})
            self.assertEqual(response.status_code, 200)

        limited = self.post_json({"name": "player", "score": 11})
        self.assertEqual(limited.status_code, 429)


@override_settings(
    GLOBAL_RATE_LIMIT_ENABLED=True,
    GLOBAL_RATE_LIMIT_REQUESTS=2,
    GLOBAL_RATE_LIMIT_WINDOW_SECONDS=60,
    GLOBAL_RATE_LIMIT_EXEMPT_PATH_PREFIXES=("/static/", "/media/"),
)
class GlobalRateLimitMiddlewareTests(TestCase):
    def setUp(self):
        cache.clear()
        caches[getattr(settings, "GLOBAL_RATE_LIMIT_CACHE_ALIAS", "rate_limit")].clear()

    def test_rate_limit_is_applied_site_wide_across_different_paths(self):
        first = self.client.get("/ko/portfolio/")
        second = self.client.get("/ko/docs/")
        third = self.client.get("/ko/portfolio/")

        self.assertNotEqual(first.status_code, 429)
        self.assertNotEqual(second.status_code, 429)
        self.assertEqual(third.status_code, 429)
        self.assertIn("Retry-After", third)

    def test_json_requests_receive_json_429_response(self):
        self.client.get("/ko/portfolio/", HTTP_ACCEPT="application/json")
        self.client.get("/ko/portfolio/", HTTP_ACCEPT="application/json")
        limited = self.client.get("/ko/portfolio/", HTTP_ACCEPT="application/json")

        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json(), {"error": "Too many requests. Try again later."})

    def test_exempt_paths_do_not_consume_rate_limit_quota(self):
        for _ in range(5):
            self.client.get("/static/does-not-exist.js")

        first = self.client.get("/ko/portfolio/")
        second = self.client.get("/ko/portfolio/")

        self.assertNotEqual(first.status_code, 429)
        self.assertNotEqual(second.status_code, 429)


class CareerPeriodCalculationTests(TestCase):
    def test_calculates_period_from_join_and_leave_dates(self):
        career = Career(
            company="Test",
            position="Dev",
            content="Work",
            join_date=date(2024, 3, 4),
            leave_date=date(2026, 2, 25),
        )

        self.assertEqual(career.display_period, "1년 11개월 21일")
        self.assertEqual(career.display_period_en, "1y 11m 21d")
        self.assertEqual(career.display_period_rounded, "2년")
        self.assertEqual(career.display_period_en_rounded, "2 year")

    def test_open_ended_leave_date_is_treated_as_current(self):
        career = Career(
            company="Test",
            position="Dev",
            content="Work",
            join_date=date(2024, 3, 4),
            leave_date=None,
        )

        self.assertTrue(career.is_currently_employed)
        self.assertEqual(career.effective_leave_date, timezone.localdate())
        self.assertIn("년", career.display_period)

    def test_rounding_does_not_increase_month_when_days_below_half(self):
        career = Career(
            company="Test",
            position="Dev",
            content="Work",
            join_date=date(2024, 3, 4),
            leave_date=date(2024, 4, 10),
        )

        self.assertEqual(career.display_period, "1개월 6일")
        self.assertEqual(career.display_period_rounded, "1개월")


class DataBackupRetentionTests(TestCase):
    @override_settings(
        MEDIA_ROOT="/Volumes/HANPLANET_HDD/Hanplanet/media",
        FORGEJO_REPOS_ROOT="/Volumes/HANPLANET_HDD/Hanplanet/forgejo-repos",
    )
    def test_build_backup_targets_uses_media_and_forgejo_repos_roots(self):
        scheduler = import_module("main.access_log_scheduler")

        with mock.patch("pathlib.Path.exists", autospec=True) as mocked_exists:
            mocked_exists.side_effect = lambda path_obj: str(path_obj) in {
                "/Volumes/HANPLANET_HDD/Hanplanet/media",
                "/Volumes/HANPLANET_HDD/Hanplanet/forgejo-repos",
            }

            targets = scheduler._build_backup_target_paths()

        self.assertEqual(
            targets,
            [
                Path("/Volumes/HANPLANET_HDD/Hanplanet/media"),
                Path("/Volumes/HANPLANET_HDD/Hanplanet/forgejo-repos"),
            ],
        )

    def test_same_day_backup_cleanup_still_prunes_to_retention_limit(self):
        scheduler = import_module("main.access_log_scheduler")
        with TemporaryDirectory() as tmpdir:
            backup_root = Path(tmpdir)
            for day in range(7, 13):
                (backup_root / f"hanplanet_data_2026-03-{day:02d}.tar.gz").write_text("x", encoding="utf-8")

            with mock.patch.dict(
                "os.environ",
                {
                    "DJANGO_DATA_BACKUP_ROOT": str(backup_root),
                    "DJANGO_DATA_BACKUP_RETENTION_DAYS": "3",
                },
                clear=False,
            ), mock.patch.object(
                scheduler.timezone,
                "localtime",
                return_value=timezone.make_aware(datetime(2026, 3, 12, 0, 6), timezone.get_current_timezone()),
            ):
                previous_last_backup_date = scheduler._last_backup_date
                try:
                    scheduler._last_backup_date = date(2026, 3, 12)
                    scheduler._maybe_backup_data_files()
                finally:
                    scheduler._last_backup_date = previous_last_backup_date

            remaining = sorted(path.name for path in backup_root.glob("hanplanet_data_*.tar.gz"))
            self.assertEqual(
                remaining,
                [
                    "hanplanet_data_2026-03-10.tar.gz",
                    "hanplanet_data_2026-03-11.tar.gz",
                    "hanplanet_data_2026-03-12.tar.gz",
                ],
            )


class HandriveI18nPlaceholderTests(TestCase):
    def test_english_handrive_text_includes_placeholder_keys(self):
        handrive_text = get_handrive_text("en")

        self.assertEqual(handrive_text["search_placeholder"], "Search files")
        self.assertEqual(handrive_text["branch_name_placeholder"], "e.g. feature/my-work")
        self.assertEqual(handrive_text["map_create_placeholder"], "Enter map name")
        self.assertEqual(handrive_text["git_repo_name_placeholder"], "my-repo (letters, numbers, ., -, _)")
        self.assertEqual(handrive_text["map_name_placeholder"], "Enter a name")
        self.assertEqual(handrive_text["map_marker_name_placeholder"], "Marker name")
        self.assertEqual(handrive_text["zoom_out_button"], "Zoom out")
        self.assertEqual(handrive_text["zoom_in_button"], "Zoom in")
        self.assertEqual(handrive_text["list_title"], "Files")
        self.assertEqual(handrive_text["menu_delete_repo"], "Delete Repo")
        self.assertEqual(handrive_text["delete_repo_button"], "Delete Repo")
        self.assertEqual(handrive_text["url_share_enabled_label"], "URL Sharing")
        self.assertEqual(handrive_text["url_unshare_button"], "Disable URL Sharing")


class ChatLanguageHelperTests(TestCase):
    def test_detects_korean_drift_for_english_mode(self):
        korean_text = "안녕하세요. 포트폴리오 프로젝트 경험에 대해 안내해드릴게요."
        english_text = "Hello. I can help explain the portfolio projects."

        self.assertTrue(has_excessive_korean_text(korean_text))
        self.assertFalse(has_excessive_korean_text(english_text))

    def test_github_hint_keyword_works_for_english(self):
        self.assertTrue(should_return_github_link("Can you explain your code design style?"))


class LanguageUrlRoutingTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_localized_portfolio_page_uses_english_context(self):
        response = self.client.get("/en/portfolio/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'lang="en"', html=False)
        self.assertContains(response, 'href="/ko/portfolio/"', html=False)
        self.assertContains(response, 'href="/en/portfolio/"', html=False)

    def test_build_lang_switch_url_replaces_existing_lang_prefix(self):
        request = self.factory.get("/ko/project/1/?tab=info")
        request.session = {}

        switched = build_lang_switch_url(request, "en")

        self.assertEqual(switched, "/en/project/1/?tab=info")

    def test_resolve_ui_lang_prefers_url_lang_over_query_parameter(self):
        request = self.factory.get("/en/portfolio/?lang=ko")
        request.session = {}

        resolved = resolve_ui_lang(request, "en")

        self.assertEqual(resolved, "en")

    def test_resolve_ui_lang_uses_account_preference_before_browser_language(self):
        user = get_user_model().objects.create_user(username="lang_pref_user", password="pw123456")
        UserProfile.objects.create(user=user, preferred_ui_lang="en")
        request = self.factory.get("/portfolio/")
        request.session = {}
        request.user = user

        resolved = resolve_ui_lang(request, None)

        self.assertEqual(resolved, "en")

    def test_legacy_portfolio_redirects_by_browser_language(self):
        response = self.client.get("/portfolio/?tab=projects", HTTP_ACCEPT_LANGUAGE="en-US,en;q=0.9")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/login?next=/portfolio/%3Ftab%3Dprojects")

    def test_legacy_portfolio_redirects_to_ko_when_accept_language_missing(self):
        response = self.client.get("/portfolio/", HTTP_ACCEPT_LANGUAGE="")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/login?next=/portfolio/")

    def test_legacy_portfolio_redirects_to_en_for_non_korean_language(self):
        response = self.client.get("/portfolio/", HTTP_ACCEPT_LANGUAGE="ja-JP,ja;q=0.9")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/login?next=/portfolio/")


class HandriveSignupAutoLoginTests(TestCase):
    @mock.patch("main.handrive_views._prepare_forgejo_login_session", return_value=("forgejo-session-key", None))
    def test_signup_logs_user_in_immediately(self, mock_prepare_session):
        response = self.client.post(
            reverse("main:handrive_signup_lang", kwargs={"ui_lang": "ko"}),
            data={
                "username": "autologin_user",
                "password1": "pw123456!!AA",
                "password2": "pw123456!!AA",
                "first_name": "Auto",
                "email": "auto@example.com",
                "privacy_consent": "on",
                "next": "/ko/fun/bumpercar-spiky/",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/ko/fun/bumpercar-spiky/")
        self.assertTrue("_auth_user_id" in self.client.session)
        self.assertEqual(
            self.client.session["_auth_user_id"],
            str(get_user_model().objects.get(username="autologin_user").pk),
        )
        mock_prepare_session.assert_called_once()
        self.assertIn("i_like_gitea", response.cookies)

    @mock.patch("main.handrive_views._prepare_forgejo_login_session", return_value=(None, "FORGEJO"))
    def test_signup_blocks_django_login_when_forgejo_link_fails(self, mock_prepare_session):
        response = self.client.post(
            reverse("main:handrive_signup_lang", kwargs={"ui_lang": "ko"}),
            data={
                "username": "autologin_blocked_user",
                "password1": "pw123456!!AA",
                "password2": "pw123456!!AA",
                "first_name": "Blocked",
                "email": "blocked@example.com",
                "privacy_consent": "on",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "로그인 실패 (FORGEJO)")
        self.assertNotIn("_auth_user_id", self.client.session)
        mock_prepare_session.assert_called_once()

    @mock.patch("main.handrive_views._prepare_forgejo_login_session")
    def test_signup_oauth_handoff_keeps_existing_gitea_session_cookie(self, mock_prepare_session):
        next_url = (
            "/o/authorize/?client_id=gitea-hanplanet-sso"
            "&redirect_uri=https%3A%2F%2Fgit.hanplanet.com%2Fuser%2Foauth2%2Fhanplanet%2Fcallback"
            "&response_type=code&scope=openid+profile+email&state=signup-oauth-state"
        )
        self.client.cookies["i_like_gitea"] = "existing-oauth-session"

        response = self.client.post(
            reverse("main:handrive_signup_lang", kwargs={"ui_lang": "ko"}),
            data={
                "username": "oauth_signup_user",
                "password1": "pw123456!!AA",
                "password2": "pw123456!!AA",
                "first_name": "OAuth",
                "email": "oauth-signup@example.com",
                "privacy_consent": "on",
                "next": next_url,
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], next_url)
        self.assertTrue("_auth_user_id" in self.client.session)
        self.assertNotIn("i_like_gitea", response.cookies)
        mock_prepare_session.assert_not_called()

    def test_signup_saves_privacy_and_terms_consent(self):
        self.client.post(
            reverse("main:handrive_signup_lang", kwargs={"ui_lang": "ko"}),
            data={
                "username": "consent_user",
                "password1": "pw123456!!AA",
                "password2": "pw123456!!AA",
                "first_name": "Consent",
                "email": "consent@example.com",
                "privacy_consent": "on",
            },
        )

        profile = UserProfile.objects.get(user__username="consent_user")
        self.assertIsNotNone(profile.privacy_policy_agreed_at)
        self.assertIsNotNone(profile.terms_of_service_agreed_at)


class LegalPageTests(TestCase):
    def test_privacy_page_renders(self):
        response = self.client.get(reverse("main:privacy_page_lang", kwargs={"ui_lang": "ko"}))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "개인정보 처리방침")
        self.assertContains(response, "Privacy Policy")
        self.assertNotContains(response, '<nav class="navbar ui-nav">', html=False)

    def test_terms_page_renders(self):
        response = self.client.get(reverse("main:terms_page_lang", kwargs={"ui_lang": "ko"}))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "이용약관")
        self.assertContains(response, "Terms of Service")
        self.assertNotContains(response, '<nav class="navbar ui-nav">', html=False)

    def test_licenses_page_renders(self):
        response = self.client.get(reverse("main:licenses_page_lang", kwargs={"ui_lang": "ko"}))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "오픈소스 라이선스")
        self.assertContains(response, "Open Source Licenses")
        self.assertContains(response, '<nav class="navbar ui-nav">', html=False)
        self.assertContains(response, "Django 5.0.1")


class PortfolioPerUserRoutingTests(TestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.owner, _ = self.user_model.objects.get_or_create(username="HanbyelLim")
        self.owner.set_password("pw12345")
        self.owner.save(update_fields=["password"])
        self.other = self.user_model.objects.create_user(username="GuestUser", password="pw12345")

        PortfolioActionButton.objects.filter(user=self.owner).delete()
        PortfolioCareer.objects.filter(user=self.owner).delete()
        PortfolioProject.objects.filter(user=self.owner).delete()
        PortfolioProfile.objects.filter(user=self.owner).delete()

        PortfolioProfile.objects.create(
            user=self.owner,
            main_title="Owner **Title**",
            main_title_en="Owner Title EN",
            phone="010-1111-2222",
            email="owner@example.com",
            main_subtitle="Owner Subtitle",
            main_subtitle_en="Owner Subtitle EN",
        )
        PortfolioProfile.objects.create(
            user=self.other,
            main_title="Guest Title",
            phone="010-9999-8888",
            email="guest@example.com",
            main_subtitle="Guest Subtitle",
        )
        PortfolioCareer.objects.create(
            user=self.owner,
            order=1,
            company="Owner Company",
            position="Developer",
            content="Owner career",
            join_date=date(2024, 1, 1),
        )
        self.project = PortfolioProject.objects.create(
            user=self.owner,
            number=1,
            title="Owner Project",
            content="Owner project content",
            create_date=date(2024, 2, 1),
        )
        PortfolioActionButton.objects.create(
            user=self.owner,
            order=1,
            label="GitHub",
            url="https://github.com/",
        )

    def test_portfolio_user_url_renders_target_user_data(self):
        response = self.client.get("/ko/portfolio/HanbyelLim/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Owner <strong>Title</strong>", html=False)
        self.assertContains(response, "Owner Company")

    def test_project_detail_user_url_renders_project(self):
        response = self.client.get(f"/ko/project/HanbyelLim/{self.project.number}/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Owner Project")

    def test_english_portfolio_uses_profile_english_fields(self):
        response = self.client.get("/en/portfolio/HanbyelLim/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Owner Title EN")
        self.assertContains(response, "Owner Subtitle EN")

    def test_main_hobbys_visible_only_for_default_owner(self):
        owner_response = self.client.get("/ko/portfolio/HanbyelLim/")
        guest_response = self.client.get("/ko/portfolio/GuestUser/")

        self.assertContains(owner_response, "main_hobbys", html=False)
        self.assertNotContains(guest_response, "main_hobbys", html=False)

    def test_portfolio_write_shows_selectable_list_and_add_mode(self):
        self.client.login(username="HanbyelLim", password="pw12345")

        response = self.client.get("/ko/portfolio/write/?career_new=1")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "+ 경력사항 추가")
        self.assertContains(response, "Owner Company")
        self.assertContains(response, 'value="add_career"', html=False)

    def test_logged_in_user_redirects_from_localized_portfolio_to_own_page(self):
        self.client.login(username="GuestUser", password="pw12345")

        response = self.client.get("/ko/portfolio/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/portfolio/GuestUser/")

    def test_logged_in_user_redirects_from_legacy_portfolio_to_own_page(self):
        self.client.login(username="GuestUser", password="pw12345")

        response = self.client.get("/portfolio/?tab=projects")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/portfolio/GuestUser/?tab=projects")

    def test_unauthenticated_user_redirects_from_localized_portfolio_to_login(self):
        response = self.client.get("/ko/portfolio/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/login?next=/ko/portfolio/")

    def test_unauthenticated_user_redirects_from_legacy_portfolio_to_login(self):
        response = self.client.get("/portfolio/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/login?next=/portfolio/")

    def test_own_portfolio_shows_edit_widget(self):
        self.client.login(username="GuestUser", password="pw12345")

        response = self.client.get("/ko/portfolio/GuestUser/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'class="own-portfolio-edit-widget ui-nav-link"', html=False)
        self.assertContains(response, 'href="/ko/portfolio/write"', html=False)

    def test_other_user_portfolio_hides_edit_widget(self):
        self.client.login(username="GuestUser", password="pw12345")

        response = self.client.get("/ko/portfolio/HanbyelLim/")

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'class="own-portfolio-edit-widget ui-nav-link"', html=False)

    def test_root_page_shows_account_widget_in_nav_links_when_logged_in(self):
        self.client.login(username="GuestUser", password="pw12345")

        response = self.client.get("/ko/", HTTP_HOST="localhost")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "data-auth-account", html=False)
        self.assertContains(response, "data-root-nav-account-host", html=False)
        self.assertContains(response, "GuestUser", html=False)

    def test_non_root_page_does_not_render_root_account_widget(self):
        self.client.login(username="GuestUser", password="pw12345")

        response = self.client.get("/ko/portfolio/GuestUser/")

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "data-auth-account", html=False)

    def test_empty_portfolio_shows_dummy_data(self):
        empty_user = self.user_model.objects.create_user(username="EmptyUser", password="pw12345")

        response = self.client.get(f"/ko/portfolio/{empty_user.username}/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "샘플 회사")
        self.assertContains(response, "샘플 프로젝트")
        self.assertContains(response, "+82-10-0000-0000")
        self.assertContains(response, "your.email@example.com")
        self.assertContains(response, "/static/icons/hanplanet.svg", html=False)
        self.assertContains(response, "/static/icons/hanplanet-og-1200.png", html=False)


class HandriveEditorPermissionTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user_model = get_user_model()
        self.handrive_editor_group, _ = Group.objects.get_or_create(name=HANDRIVE_EDITOR_GROUP_NAME)
        content_type = ContentType.objects.get_for_model(NavLink)
        self.handrive_permission, _ = Permission.objects.get_or_create(
            content_type=content_type,
            codename=DOCS_EDIT_PERMISSION_CODE.split(".", 1)[1],
            defaults={"name": "Can edit HanDrive content"},
        )
        self.handrive_editor_group.permissions.set([self.handrive_permission])

    def test_handrive_editor_group_user_is_allowed(self):
        user = self.user_model.objects.create_user(username="handrive_editor", password="pw123456")
        user.groups.add(self.handrive_editor_group)
        request = self.factory.get("/ko/handrive/list/")
        request.user = user

        self.assertTrue(is_handrive_editor(request))

    def test_regular_user_is_denied_for_write_api(self):
        user = self.user_model.objects.create_user(username="regular_user", password="pw123456")
        self.client.force_login(user)

        response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "", "folder_name": "tmp"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)

    def test_handrive_editor_group_user_passes_auth_gate_for_write_api(self):
        user = self.user_model.objects.create_user(username="handrive_editor2", password="pw123456")
        user.groups.add(self.handrive_editor_group)
        self.client.force_login(user)

        response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "__missing__", "folder_name": "tmp"}),
            content_type="application/json",
        )

        self.assertNotEqual(response.status_code, 403)


class UserPreferenceApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="pref_user", password="pw123456")
        self.client.login(username="pref_user", password="pw123456")

    def test_user_preference_patch_updates_ui_lang_and_root_engine(self):
        response = self.client.patch(
            "/ko/api/user-preferences/",
            data=json.dumps({"ui_lang": "en", "root_search_engine": "gpt"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.preferred_ui_lang, "en")
        self.assertEqual(profile.preferred_root_search_engine, "gpt")


class HandriveAuthFlowTests(TestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="handrive_login_user",
            password="pw123456",
            is_staff=False,
        )

    def test_docs_login_page_is_accessible(self):
        response = self.client.get("/ko/login/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "로그인")
        self.assertContains(response, "이전 페이지")
        self.assertNotContains(response, ">ide<", html=False)

    @mock.patch("main.handrive_views.subprocess.run")
    @mock.patch("main.handrive_views.settings.RUNNING_TESTS", False)
    def test_build_forgejo_session_blob_prefers_homebrew_go(self, mock_run):
        def fake_exists(self):
            return str(self) in {
                "/opt/homebrew/bin/go",
                "/Users/imhanbyeol/Development/Hanplanet/scripts/forgejo_session_blob.go",
            }

        mock_run.side_effect = [
            mock.Mock(returncode=0, stdout=""),
            mock.Mock(returncode=0, stdout="Zm9v"),
        ]
        with mock.patch("main.handrive_views.Path.exists", fake_exists):
            blob = _build_forgejo_session_blob(123, "handrive_login_user")

        self.assertEqual(blob, b"foo")
        build_cmd = mock_run.call_args_list[0].args[0]
        exec_cmd = mock_run.call_args_list[1].args[0]
        self.assertEqual(build_cmd[0], "/opt/homebrew/bin/go")
        self.assertEqual(build_cmd[1:3], ["build", "-o"])
        self.assertIn("forgejo_session_blob.go", build_cmd[-1])
        self.assertIn("hanplanet_forgejo_session_blob", exec_cmd[0])

    @mock.patch("main.handrive_views._persist_forgejo_session")
    @mock.patch("main.handrive_views._build_forgejo_session_blob", return_value=b"blob")
    @mock.patch("main.handrive_views._ensure_forgejo_mapping_for_user")
    def test_attach_forgejo_login_session_uses_session_persist_helper(
        self,
        mock_ensure_mapping,
        mock_build_blob,
        mock_persist_session,
    ):
        response = self.client.get("/ko/login/")
        mock_ensure_mapping.return_value = mock.Mock(
            forgejo_user_id=123,
            forgejo_username="handrive_login_user",
        )

        attached = _attach_forgejo_login_session(response, self.user)

        self.assertIs(attached, response)
        mock_build_blob.assert_called_once_with(123, "handrive_login_user", False)
        mock_persist_session.assert_called_once()
        self.assertIn("i_like_gitea", attached.cookies)

    @mock.patch("main.handrive_views._attach_forgejo_login_session")
    def test_build_forgejo_authenticated_redirect_clears_sync_cookies_before_attach(self, mock_attach_session):
        mock_attach_session.side_effect = lambda response, user: response

        response = _build_forgejo_authenticated_redirect("/ko/portfolio/", self.user)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/portfolio/")
        mock_attach_session.assert_called_once()
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)
        self.assertNotIn("_csrf", response.cookies)
        self.assertNotIn("redirect_to", response.cookies)
        self.assertNotIn("gitea_flash", response.cookies)
        self.assertIn("hp_logout", response.cookies)
        self.assertIn("hp_logout_return", response.cookies)
        self.assertIn("hp_relogin", response.cookies)
        self.assertIn("hp_sso_return", response.cookies)

    def test_build_forgejo_logged_out_redirect_clears_sync_cookies(self):
        response = _build_forgejo_logged_out_redirect("/ko/handrive/list/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/handrive/list/")
        self.assertIn("i_like_gitea", response.cookies)
        self.assertIn("_csrf", response.cookies)
        self.assertIn("redirect_to", response.cookies)
        self.assertIn("gitea_flash", response.cookies)
        self.assertIn(settings.SESSION_COOKIE_NAME, response.cookies)
        self.assertIn("hp_logout", response.cookies)
        self.assertIn("hp_logout_return", response.cookies)
        self.assertIn("hp_relogin", response.cookies)
        self.assertIn("hp_sso_return", response.cookies)

    def test_apply_forgejo_session_cookie_overrides_prior_delete_cookie(self):
        response = _build_forgejo_logged_out_redirect("/ko/handrive/all/list/")

        attached = _attach_forgejo_login_session(response, self.user)

        self.assertEqual(attached.cookies["i_like_gitea"].value, "")
        self.assertEqual(str(attached.cookies["i_like_gitea"]["max-age"]), "0")

        refreshed = _apply_forgejo_session_cookie(attached, "fresh-session-key")

        self.assertEqual(refreshed.cookies["i_like_gitea"].value, "fresh-session-key")
        self.assertEqual(refreshed.cookies["i_like_gitea"]["max-age"], "")

    @mock.patch("main.handrive_views._prepare_forgejo_login_session", return_value=("forgejo-session-key", None))
    def test_docs_login_authenticates_non_staff_user(self, mock_prepare_session):
        response = self.client.post(
            "/ko/login/",
            data={"username": "handrive_login_user", "password": "pw123456", "next": "/ko/handrive/all/list/"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/handrive")
        self.assertTrue("_auth_user_id" in self.client.session)
        self.assertIn("i_like_gitea", response.cookies)
        mock_prepare_session.assert_called_once()

    @mock.patch(
        "main.handrive_views._prepare_forgejo_login_session",
        side_effect=[("forgejo-session-a", None), ("forgejo-session-b", None)],
    )
    def test_docs_login_after_logout_switches_authenticated_user(self, mock_prepare_session):
        other_user = self.user_model.objects.create_user(
            username="handrive_login_user_two",
            password="pw123456",
            is_staff=False,
        )

        first_login = self.client.post(
            "/ko/login/",
            data={"username": "handrive_login_user", "password": "pw123456", "next": "/ko/handrive/all/list/"},
        )
        self.assertEqual(first_login.status_code, 302)
        self.assertEqual(self.client.session["_auth_user_id"], str(self.user.pk))

        logout_response = self.client.post(
            "/ko/logout/",
            data={"next": "/ko/handrive/all/list/"},
        )
        self.assertEqual(logout_response.status_code, 302)
        self.assertNotIn("_auth_user_id", self.client.session)

        second_login = self.client.post(
            "/ko/login/",
            data={"username": "handrive_login_user_two", "password": "pw123456", "next": "/ko/handrive/all/list/"},
        )

        self.assertEqual(second_login.status_code, 302)
        self.assertEqual(second_login["Location"], "/ko/handrive")
        self.assertEqual(self.client.session["_auth_user_id"], str(other_user.pk))
        self.assertIn("i_like_gitea", second_login.cookies)
        self.assertEqual(mock_prepare_session.call_count, 2)

    @mock.patch("main.handrive_views._prepare_forgejo_login_session", return_value=(None, "FORGEJO"))
    def test_docs_login_blocks_django_login_when_forgejo_link_fails(self, mock_prepare_session):
        response = self.client.post(
            "/ko/login/",
            data={"username": "handrive_login_user", "password": "pw123456", "next": "/ko/handrive/list/"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "로그인 실패 (FORGEJO)")
        self.assertNotIn("_auth_user_id", self.client.session)
        mock_prepare_session.assert_called_once()

    @mock.patch("main.handrive_views._prepare_forgejo_login_session")
    def test_docs_login_oauth_handoff_keeps_existing_gitea_session_cookie(self, mock_prepare_session):
        next_url = (
            "/o/authorize/?client_id=gitea-hanplanet-sso"
            "&redirect_uri=https%3A%2F%2Fgit.hanplanet.com%2Fuser%2Foauth2%2Fhanplanet%2Fcallback"
            "&response_type=code&scope=openid+profile+email&state=oauth-state"
        )
        self.client.cookies["i_like_gitea"] = "existing-oauth-session"

        response = self.client.post(
            "/ko/login/",
            data={"username": "handrive_login_user", "password": "pw123456", "next": next_url},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], next_url)
        self.assertTrue("_auth_user_id" in self.client.session)
        self.assertNotIn("i_like_gitea", response.cookies)
        mock_prepare_session.assert_not_called()

    @mock.patch("main.handrive_views._attach_forgejo_login_session")
    def test_docs_login_rehydrates_forgejo_session_for_authenticated_user(self, mock_attach_session):
        mock_attach_session.side_effect = lambda response, user: response
        self.client.force_login(self.user)
        self.client.cookies["hp_logout"] = "1"
        self.client.cookies["hp_logout_return"] = "https://www.hanplanet.com/ko/handrive/list/"
        self.client.cookies["hp_relogin"] = "1"
        self.client.cookies["hp_sso_return"] = "https://www.hanplanet.com/ko/"

        response = self.client.get("/ko/login/?next=/ko/portfolio/handrive_login_user/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/portfolio/handrive_login_user/")
        mock_attach_session.assert_called_once()
        self.assertIn("hp_logout", response.cookies)
        self.assertIn("hp_logout_return", response.cookies)
        self.assertIn("hp_relogin", response.cookies)
        self.assertIn("hp_sso_return", response.cookies)

    @mock.patch("main.handrive_views._attach_forgejo_login_session")
    def test_docs_login_authenticated_oauth_handoff_skips_direct_forgejo_attach(self, mock_attach_session):
        next_url = (
            "/o/authorize/?client_id=gitea-hanplanet-sso"
            "&redirect_uri=https%3A%2F%2Fgit.hanplanet.com%2Fuser%2Foauth2%2Fhanplanet%2Fcallback"
            "&response_type=code&scope=openid+profile+email&state=oauth-authenticated-state"
        )
        self.client.force_login(self.user)

        response = self.client.get("/ko/login/", {"next": next_url})

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], next_url)
        self.assertNotIn("i_like_gitea", response.cookies)
        mock_attach_session.assert_not_called()

    def test_resolve_handrive_post_login_url_keeps_portfolio_next(self):
        public_group, _ = Group.objects.get_or_create(name=DOCS_PUBLIC_WRITE_GROUP_NAME)
        self.user.groups.add(public_group)
        request = RequestFactory().get("/ko/login/")

        resolved = _resolve_handrive_post_login_url(
            request,
            "ko",
            "/ko/portfolio/handrive_login_user/",
            self.user,
        )

        self.assertEqual(resolved, "/ko/portfolio/handrive_login_user/")

    def test_resolve_handrive_post_login_url_redirects_all_list_to_handrive_root(self):
        request = RequestFactory().get("/ko/login/")

        resolved = _resolve_handrive_post_login_url(
            request,
            "ko",
            "/ko/handrive/all/list/",
            self.user,
        )

        self.assertEqual(resolved, "/ko/handrive")

    def test_docs_logout_clears_session(self):
        self.client.force_login(self.user)

        response = self.client.post(
            "/ko/logout/",
            data={"next": "/ko/handrive/list/"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/handrive/list/")
        self.assertFalse("_auth_user_id" in self.client.session)

    @override_settings(PUBLIC_GIT_BASE_URL="https://git.hanplanet.com")
    @mock.patch("main.handrive_views._forgejo_server_logout")
    def test_docs_logout_stays_on_hanplanet_and_clears_forgejo_sync_cookies(self, mock_forgejo_server_logout):
        self.client.force_login(self.user)
        self.client.cookies["i_like_gitea"] = "forgejo-session-key"
        self.client.cookies["hp_logout"] = "1"
        self.client.cookies["hp_logout_return"] = "https://www.hanplanet.com/ko/handrive/list/"
        self.client.cookies["hp_relogin"] = "1"
        self.client.cookies["hp_sso_return"] = "https://www.hanplanet.com/ko/"

        response = self.client.post(
            "/ko/logout/",
            data={"next": "/ko/handrive/list/"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/handrive/list/")
        mock_forgejo_server_logout.assert_called_once_with(self.user, forgejo_session_key="forgejo-session-key")

        self.assertIn("i_like_gitea", response.cookies)
        self.assertIn("hp_logout", response.cookies)
        self.assertIn("hp_logout_return", response.cookies)
        self.assertIn("hp_relogin", response.cookies)
        self.assertIn("hp_sso_return", response.cookies)
        self.assertNotIn("https://git.hanplanet.com/", response["Location"])

    @mock.patch("main.handrive_views._delete_forgejo_session_artifacts")
    def test_forgejo_server_logout_uses_session_delete_helper(self, mock_delete_session_artifacts):
        mapping = mock.Mock(forgejo_user_id=123)
        with mock.patch("main.handrive_views.GitUserMapping.objects.filter") as mock_filter:
            mock_filter.return_value.first.return_value = mapping
            _forgejo_server_logout(self.user, forgejo_session_key="forgejo-session-key")

        mock_delete_session_artifacts.assert_called_once_with(123, forgejo_session_key="forgejo-session-key")

    def test_delete_forgejo_session_artifacts_keeps_auth_tokens_and_uses_short_db_timeout(self):
        mock_conn = mock.MagicMock()
        with mock.patch("main.handrive_views.sqlite3.connect", return_value=mock_conn) as mock_connect:
            _delete_forgejo_session_artifacts(123, forgejo_session_key="forgejo-session-key")

        mock_connect.assert_called_once_with(_forgejo_db_path(), timeout=1)
        executed_sql = [call.args[0] for call in mock_conn.__enter__.return_value.execute.call_args_list]
        self.assertEqual(
            executed_sql,
            [
                "DELETE FROM oauth2_grant WHERE user_id = ?",
                "DELETE FROM session WHERE key = ?",
            ],
        )

    @mock.patch("main.handrive_views._attach_forgejo_login_session")
    def test_legacy_gitea_sso_relay_now_reuses_direct_session_attach(self, mock_attach_session):
        mock_attach_session.side_effect = lambda response, user: response
        self.client.force_login(self.user)
        self.client.cookies["hp_relogin"] = "1"
        self.client.cookies["hp_sso_return"] = "https://www.hanplanet.com/ko/"

        response = self.client.get("/sso/gitea?next=/ko/portfolio/handrive_login_user/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/portfolio/handrive_login_user/")
        mock_attach_session.assert_called_once()
        self.assertIn("hp_relogin", response.cookies)
        self.assertIn("hp_sso_return", response.cookies)

    @override_settings(
        PUBLIC_BASE_URL="https://www.hanplanet.com",
        PUBLIC_GIT_BASE_URL="https://git.hanplanet.com",
    )
    def test_logout_bridge_accepts_gitea_absolute_next_url(self):
        self.client.force_login(self.user)

        response = self.client.get("/ko/logout/bridge/?next=https://git.hanplanet.com/hanplanet/repo")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'action="/ko/logout/"', html=False)
        self.assertContains(
            response,
            'value="https://git.hanplanet.com/hanplanet/repo"',
            html=False,
        )

    def test_docs_logout_csrf_failure_returns_forbidden(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)

        response = csrf_client.post(
            "/ko/logout/",
            data={"next": "/ko/handrive/list/"},
        )

        self.assertEqual(response.status_code, 403)


class RootAuthLinkTests(TestCase):
    def test_root_login_link_keeps_user_on_root(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '/login?next=/', html=False)
        self.assertContains(response, '/signup?next=/', html=False)


class HanplanetMultiplayerPageTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="multiplayer_user",
            password="pw123456",
            email="multi@example.com",
        )
        self.admin_user = get_user_model().objects.create_superuser(
            username="multiplayer_admin",
            password="pw123456",
            email="admin@example.com",
        )

    def test_multiplayer_page_renders_for_unauthenticated_user(self):
        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "data-game-client", html=False)
        self.assertContains(response, "범퍼카 스핔이", html=False)

    def test_multiplayer_page_renders_for_authenticated_user(self):
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/", HTTP_HOST="127.0.0.1:8000")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "data-game-client", html=False)
        self.assertContains(response, "ws://127.0.0.1:8081", html=False)
        self.assertContains(response, "/ko/api/game-auth-token/", html=False)
        self.assertContains(response, "범퍼카 스핔이", html=False)
        self.assertNotContains(response, "서버 재시작", html=False)
        self.assertContains(response, "data-skin-catalog=", html=False)

    def test_multiplayer_page_shows_restart_button_for_superuser(self):
        self.client.force_login(self.admin_user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "서버 재시작", html=False)
        self.assertContains(response, "적용", html=False)

    @override_settings(
        GAME_JWT_SECRET="test-game-secret",
        GAME_JWT_ISSUER="https://hanplanet.com",
        GAME_JWT_AUDIENCE="hanplanet-game",
        GAME_JWT_EXP_SECONDS=300,
    )
    def test_game_auth_token_api_returns_signed_token(self):
        self.client.force_login(self.user)
        response = self.client.get("/ko/api/game-auth-token/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("token", payload)
        token = payload["token"]
        self.assertEqual(token.count("."), 2)
        self.assertEqual(payload["expires_in"], 300)
        payload_segment = token.split(".")[1]
        decoded_payload = json.loads(base64.urlsafe_b64decode(payload_segment + "==").decode("utf-8"))
        self.assertEqual(decoded_payload["selected_skin"], "default")

    @override_settings(
        GAME_JWT_SECRET="test-game-secret",
        GAME_JWT_ISSUER="https://hanplanet.com",
        GAME_JWT_AUDIENCE="hanplanet-game",
        GAME_JWT_EXP_SECONDS=300,
    )
    def test_game_auth_token_api_uses_unlocked_selected_skin(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"game_clears": 1})
        self.client.force_login(self.user)

        response = self.client.get("/ko/api/game-auth-token/?skin=evolution")

        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        payload_segment = token.split(".")[1]
        decoded_payload = json.loads(base64.urlsafe_b64decode(payload_segment + "==").decode("utf-8"))
        self.assertEqual(decoded_payload["selected_skin"], "evolution")

    @override_settings(
        GAME_JWT_SECRET="test-game-secret",
        GAME_JWT_ISSUER="https://hanplanet.com",
        GAME_JWT_AUDIENCE="hanplanet-game",
        GAME_JWT_EXP_SECONDS=300,
    )
    def test_game_auth_token_api_uses_unlocked_double_skin(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"deaths": 20})
        self.client.force_login(self.user)

        response = self.client.get("/ko/api/game-auth-token/?skin=double")

        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        payload_segment = token.split(".")[1]
        decoded_payload = json.loads(base64.urlsafe_b64decode(payload_segment + "==").decode("utf-8"))
        self.assertEqual(decoded_payload["selected_skin"], "double")

    @override_settings(
        GAME_JWT_SECRET="test-game-secret",
        GAME_JWT_ISSUER="https://hanplanet.com",
        GAME_JWT_AUDIENCE="hanplanet-game",
        GAME_JWT_EXP_SECONDS=300,
    )
    def test_game_auth_token_api_uses_unlocked_pumkin_skin_for_superuser(self):
        UserProfile.objects.create(user=self.admin_user, bumpercar_spiky_stats={"max_ner_party_size": 2})
        self.client.force_login(self.admin_user)

        response = self.client.get("/ko/api/game-auth-token/?skin=pumkin")

        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        payload_segment = token.split(".")[1]
        decoded_payload = json.loads(base64.urlsafe_b64decode(payload_segment + "==").decode("utf-8"))
        self.assertEqual(decoded_payload["selected_skin"], "pumkin")

    @override_settings(
        GAME_JWT_SECRET="test-game-secret",
        GAME_JWT_ISSUER="https://hanplanet.com",
        GAME_JWT_AUDIENCE="hanplanet-game",
        GAME_JWT_EXP_SECONDS=300,
    )
    def test_game_auth_token_api_uses_unlocked_pumkin_skin_for_staff_admin(self):
        staff_user = get_user_model().objects.create_user(
            username="staff-pumkin-admin",
            email="staff-pumkin-admin@example.com",
            password="testpass123",
            is_staff=True,
        )
        UserProfile.objects.create(user=staff_user, bumpercar_spiky_stats={})
        self.client.force_login(staff_user)

        response = self.client.get("/ko/api/game-auth-token/?skin=pumkin")

        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        payload_segment = token.split(".")[1]
        decoded_payload = json.loads(base64.urlsafe_b64decode(payload_segment + "==").decode("utf-8"))
        self.assertEqual(decoded_payload["selected_skin"], "pumkin")

    @override_settings(
        GAME_JWT_SECRET="test-game-secret",
        GAME_JWT_ISSUER="https://hanplanet.com",
        GAME_JWT_AUDIENCE="hanplanet-game",
        GAME_JWT_EXP_SECONDS=300,
    )
    def test_game_auth_token_api_returns_signed_guest_token_for_unauthenticated_user(self):
        response = self.client.get("/ko/api/game-auth-token/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("token", payload)
        self.assertEqual(payload["token"].count("."), 2)

    @override_settings(
        GAME_JWT_SECRET="test-game-secret",
        GAME_JWT_ISSUER="https://hanplanet.com",
        GAME_JWT_AUDIENCE="hanplanet-game",
        GAME_JWT_EXP_SECONDS=300,
    )
    def test_build_game_auth_token_uses_expected_subject(self):
        token = build_game_auth_token(self.user)

        self.assertTrue(token.startswith("ey"))

    def test_bumpercar_spiky_admin_requires_superuser(self):
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/admin/")

        self.assertEqual(response.status_code, 404)

    def test_bumpercar_spiky_admin_renders_for_superuser(self):
        self.client.force_login(self.admin_user)

        response = self.client.get("/ko/fun/bumpercar-spiky/admin/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "범퍼카 스핔이 관리자", html=False)
        self.assertContains(response, "네르 첫 돌진 거리 배율", html=False)
        self.assertContains(response, "네르 추가 돌진 거리 배율", html=False)

    @mock.patch("main.views.restart_bumpercar_spiky_server")
    def test_bumpercar_spiky_restart_server_requires_superuser(self, mock_restart):
        self.client.force_login(self.user)

        response = self.client.post(
            reverse("main:bumpercar_spiky_restart_server_lang", kwargs={"ui_lang": "ko"}),
            data={"next": "/ko/fun/bumpercar-spiky/"},
        )

        self.assertEqual(response.status_code, 404)
        mock_restart.assert_not_called()

    @mock.patch("main.views.restart_bumpercar_spiky_server")
    def test_bumpercar_spiky_restart_server_runs_for_superuser(self, mock_restart):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            reverse("main:bumpercar_spiky_restart_server_lang", kwargs={"ui_lang": "ko"}),
            data={"next": "/ko/fun/bumpercar-spiky/"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/fun/bumpercar-spiky/")
        mock_restart.assert_called_once()

    @mock.patch("main.views.set_bumpercar_spiky_npc_health")
    def test_bumpercar_spiky_set_npc_health_requires_superuser(self, mock_set_npc_health):
        self.client.force_login(self.user)

        response = self.client.post(
            reverse("main:bumpercar_spiky_set_npc_health_lang", kwargs={"ui_lang": "ko"}),
            data={"next": "/ko/fun/bumpercar-spiky/", "npc_health": "12"},
        )

        self.assertEqual(response.status_code, 404)
        mock_set_npc_health.assert_not_called()

    @mock.patch("main.views.set_bumpercar_spiky_npc_health")
    def test_bumpercar_spiky_set_npc_health_runs_for_superuser(self, mock_set_npc_health):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            reverse("main:bumpercar_spiky_set_npc_health_lang", kwargs={"ui_lang": "ko"}),
            data={"next": "/ko/fun/bumpercar-spiky/", "npc_health": "12"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/fun/bumpercar-spiky/")
        mock_set_npc_health.assert_called_once_with(12)

    def test_bumpercar_spiky_stats_record_updates_user_profile(self):
        response = self.client.post(
            reverse("main:bumpercar_spiky_stats_record"),
            data=json.dumps(
                {
                    "username": self.user.username,
                    "increments": {
                        "dummy_kills": 2,
                        "deaths": 1,
                        "player_kills": 4,
                        "ner_kills": 3,
                        "game_clears": 1,
                        "ner_phase1_attack_dodges": 4,
                        "ner_phase2_attack_dodges": 5,
                        "ner_phase3_attack_dodges": 6,
                        "ner_hits": 5,
                    },
                    "maxima": {
                        "max_ner_party_size": 3,
                    },
                }
            ),
            content_type="application/json",
            REMOTE_ADDR="127.0.0.1",
        )

        self.assertEqual(response.status_code, 200)
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(
            profile.bumpercar_spiky_stats,
            {
                "dummy_kills": 2,
                "deaths": 1,
                "player_kills": 4,
                "ner_kills": 3,
                "max_ner_party_size": 3,
                "game_clears": 1,
                "ner_phase1_attack_dodges": 4,
                "ner_phase2_attack_dodges": 5,
                "ner_phase3_attack_dodges": 6,
                "ner_hits": 5,
            },
        )

    def test_bumpercar_spiky_stats_record_keeps_larger_existing_maximum(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"max_ner_party_size": 4})

        response = self.client.post(
            reverse("main:bumpercar_spiky_stats_record"),
            data=json.dumps(
                {
                    "username": self.user.username,
                    "increments": {},
                    "maxima": {
                        "max_ner_party_size": 2,
                    },
                }
            ),
            content_type="application/json",
            REMOTE_ADDR="127.0.0.1",
        )

        self.assertEqual(response.status_code, 200)
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.bumpercar_spiky_stats["max_ner_party_size"], 4)

    def test_bumpercar_spiky_stats_record_rejects_non_local_request(self):
        response = self.client.post(
            reverse("main:bumpercar_spiky_stats_record"),
            data=json.dumps(
                {"username": self.user.username, "increments": {"dummy_kills": 1}}
            ),
            content_type="application/json",
            REMOTE_ADDR="203.0.113.10",
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(UserProfile.objects.filter(user=self.user).exists())

    def test_multiplayer_page_includes_account_stats_for_authenticated_user(self):
        UserProfile.objects.create(
            user=self.user,
            bumpercar_spiky_stats={
                "dummy_kills": 1,
                "deaths": 2,
                "player_kills": 7,
                "ner_kills": 3,
                "max_ner_party_size": 0,
                "game_clears": 0,
                "ner_phase1_attack_dodges": 4,
                "ner_phase2_attack_dodges": 5,
                "ner_phase3_attack_dodges": 6,
                "ner_hits": 5,
            },
        )
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.context["account_bumpercar_spiky_stats"],
            {
                "dummy_kills": 1,
                "deaths": 2,
                "player_kills": 7,
                "ner_kills": 3,
                "max_ner_party_size": 0,
                "game_clears": 0,
                "ner_phase1_attack_dodges": 4,
                "ner_phase2_attack_dodges": 5,
                "ner_phase3_attack_dodges": 6,
                "ner_hits": 5,
            },
        )
        self.assertTrue(response.context["show_account_bumpercar_spiky_stats"])

    def test_multiplayer_page_marks_evolution_skin_unlocked_when_game_is_cleared(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"game_clears": 1})
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        skin_catalog = json.loads(response.context["game_skin_catalog_json"])
        evolution_skin = next(skin for skin in skin_catalog if skin["name"] == "evolution")
        self.assertTrue(evolution_skin["unlocked"])

    def test_multiplayer_page_marks_double_skin_unlocked_when_deaths_reach_twenty(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"deaths": 20})
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        skin_catalog = json.loads(response.context["game_skin_catalog_json"])
        double_skin = next(skin for skin in skin_catalog if skin["name"] == "double")
        self.assertTrue(double_skin["unlocked"])

    def test_multiplayer_page_marks_many_skin_locked_for_regular_user(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"dummy_kills": 20})
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        skin_catalog = json.loads(response.context["game_skin_catalog_json"])
        many_skin = next(skin for skin in skin_catalog if skin["name"] == "many")
        self.assertFalse(many_skin["unlocked"])
        self.assertEqual(many_skin["unlock_condition"], "개발 중")

    def test_multiplayer_page_marks_many_skin_unlocked_for_superuser(self):
        admin_user = get_user_model().objects.create_superuser(
            username="many-admin",
            email="many-admin@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(user=admin_user, bumpercar_spiky_stats={"dummy_kills": 0})
        self.client.force_login(admin_user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        skin_catalog = json.loads(response.context["game_skin_catalog_json"])
        many_skin = next(skin for skin in skin_catalog if skin["name"] == "many")
        self.assertTrue(many_skin["unlocked"])

    def test_multiplayer_page_unlocks_all_skins_for_admin_without_stats(self):
        admin_user = get_user_model().objects.create_superuser(
            username="all-skins-admin",
            email="all-skins-admin@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(user=admin_user, bumpercar_spiky_stats={})
        self.client.force_login(admin_user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        skin_catalog = json.loads(response.context["game_skin_catalog_json"])
        self.assertTrue(all(bool(skin["unlocked"]) for skin in skin_catalog))

    def test_multiplayer_page_marks_pumkin_skin_locked_for_regular_user(self):
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        skin_catalog = json.loads(response.context["game_skin_catalog_json"])
        pumkin_skin = next(skin for skin in skin_catalog if skin["name"] == "pumkin")
        self.assertFalse(pumkin_skin["unlocked"])
        self.assertEqual(pumkin_skin["unlock_condition"], "친구와 네르 쓰러트리기")

    def test_multiplayer_page_marks_pumkin_skin_unlocked_when_party_size_reaches_two(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"max_ner_party_size": 2})
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/bumpercar-spiky/")

        self.assertEqual(response.status_code, 200)
        skin_catalog = json.loads(response.context["game_skin_catalog_json"])
        pumkin_skin = next(skin for skin in skin_catalog if skin["name"] == "pumkin")
        self.assertTrue(pumkin_skin["unlocked"])

    def test_minigame_page_shows_stats_button_but_not_account_stats_menu(self):
        UserProfile.objects.create(user=self.user, bumpercar_spiky_stats={"dummy_kills": 1})
        self.client.force_login(self.user)

        response = self.client.get("/ko/fun/minigame/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "전적", html=False)
        self.assertFalse(response.context["show_account_bumpercar_spiky_stats"])


class HandriveAccessRuleTests(TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.override_settings = override_settings(MEDIA_ROOT=self.temp_dir.name)
        self.override_settings.enable()
        self.addCleanup(self.override_settings.disable)
        self.addCleanup(self.temp_dir.cleanup)

        self.user_model = get_user_model()
        self.handrive_editor_group, _ = Group.objects.get_or_create(name=HANDRIVE_EDITOR_GROUP_NAME)
        content_type = ContentType.objects.get_for_model(NavLink)
        self.handrive_permission, _ = Permission.objects.get_or_create(
            content_type=content_type,
            codename=DOCS_EDIT_PERMISSION_CODE.split(".", 1)[1],
            defaults={"name": "Can edit HanDrive content"},
        )
        self.handrive_editor_group.permissions.set([self.handrive_permission])

        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "restricted").mkdir(parents=True, exist_ok=True)
        (handrive_root / "restricted" / "secret.md").write_text("# secret", encoding="utf-8")
        (handrive_root / "public.md").write_text("# public", encoding="utf-8")

    def create_handrive_editor(self, username):
        user = self.user_model.objects.create_user(username=username, password="pw123456")
        user.groups.add(self.handrive_editor_group)
        return user

    def create_scoped_handrive_editor(self, username):
        user = self.create_handrive_editor(username)
        public_group, _ = Group.objects.get_or_create(name=DOCS_PUBLIC_WRITE_GROUP_NAME)
        user.groups.add(public_group)
        user_home = Path(settings.MEDIA_ROOT) / "HanDrive" / "users" / username
        user_home.mkdir(parents=True, exist_ok=True)
        return user

    def test_restricted_path_blocks_non_allowed_user_from_read(self):
        reader_group = Group.objects.create(name="handrive_readers")
        rule = HandriveAccessRule.objects.create(path="restricted")
        rule.read_groups.add(reader_group)

        blocked_user = self.user_model.objects.create_user(username="blocked", password="pw123456")
        self.client.force_login(blocked_user)
        blocked_response = self.client.get("/ko/docs/restricted/secret/")
        self.assertEqual(blocked_response.status_code, 403)

        blocked_user.groups.add(reader_group)
        allowed_response = self.client.get("/ko/docs/restricted/secret/")
        self.assertEqual(allowed_response.status_code, 200)

    def test_restricted_path_blocks_handrive_editor_write_when_not_in_acl(self):
        writers_group = Group.objects.create(name="handrive_writers")
        rule = HandriveAccessRule.objects.create(path="restricted")
        rule.write_groups.add(writers_group)

        blocked_editor = self.create_handrive_editor("blocked_editor")
        allowed_editor = self.create_handrive_editor("allowed_editor")
        allowed_editor.groups.add(writers_group)

        self.client.force_login(blocked_editor)
        blocked = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "restricted", "folder_name": "new_folder"}),
            content_type="application/json",
        )
        self.assertEqual(blocked.status_code, 403)

        self.client.force_login(allowed_editor)
        allowed = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "restricted", "folder_name": "new_folder"}),
            content_type="application/json",
        )
        self.assertEqual(allowed.status_code, 200)

    def test_child_file_write_acl_keeps_parent_directory_writable_for_handrive_editors(self):
        writers_group = Group.objects.create(name="child_file_writers")
        rule = HandriveAccessRule.objects.create(path="restricted/secret.md")
        rule.write_groups.add(writers_group)

        allowed_editor = self.create_handrive_editor("child_file_acl_editor")
        allowed_editor.groups.add(writers_group)
        self.client.force_login(allowed_editor)

        parent_write_response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "restricted", "folder_name": "should_block"}),
            content_type="application/json",
        )
        self.assertEqual(parent_write_response.status_code, 200)

        edit_page_response = self.client.get("/ko/docs/write/", data={"path": "restricted/secret.md"})
        self.assertEqual(edit_page_response.status_code, 200)

    def test_child_file_write_acl_keeps_root_directory_writable_for_handrive_editors(self):
        writers_group = Group.objects.create(name="root_parent_block_writers")
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(writers_group)

        allowed_editor = self.create_handrive_editor("root_parent_block_editor")
        allowed_editor.groups.add(writers_group)
        self.client.force_login(allowed_editor)

        root_write_response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "", "folder_name": "root_should_block"}),
            content_type="application/json",
        )
        self.assertEqual(root_write_response.status_code, 200)

        edit_page_response = self.client.get("/ko/docs/write/", data={"path": "public.md"})
        self.assertEqual(edit_page_response.status_code, 200)

    def test_docs_list_uses_current_directory_write_access_for_write_button(self):
        writers_group = Group.objects.create(name="restricted_list_writers")
        rule = HandriveAccessRule.objects.create(path="restricted")
        rule.write_groups.add(writers_group)

        allowed_editor = self.create_handrive_editor("restricted_list_editor")
        allowed_editor.groups.add(writers_group)
        self.client.force_login(allowed_editor)

        list_response = self.client.get("/ko/docs/restricted/list/")
        self.assertEqual(list_response.status_code, 200)
        self.assertContains(list_response, 'id="handrive-write-btn"')

    def test_docs_view_uses_document_write_access_for_delete_button(self):
        writers_group = Group.objects.create(name="public_doc_writers")
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(writers_group)

        allowed_editor = self.create_handrive_editor("public_doc_editor")
        allowed_editor.groups.add(writers_group)
        self.client.force_login(allowed_editor)

        view_response = self.client.get("/ko/docs/public/")
        self.assertEqual(view_response.status_code, 200)
        self.assertContains(view_response, 'id="handrive-delete-btn"')

    def test_inherited_root_write_acl_stays_usable_when_child_acl_exists(self):
        root_rule = HandriveAccessRule.objects.create(path="")
        root_rule.write_groups.add(self.handrive_editor_group)

        child_writers = Group.objects.create(name="child_override_writers")
        child_rule = HandriveAccessRule.objects.create(path="restricted/secret.md")
        child_rule.write_groups.add(child_writers)

        editor = self.create_handrive_editor("root_inherited_editor")
        self.client.force_login(editor)

        inherited_response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "restricted", "folder_name": "blocked_by_child_acl"}),
            content_type="application/json",
        )
        self.assertEqual(inherited_response.status_code, 200)

        root_allowed_response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "", "folder_name": "root_still_allowed"}),
            content_type="application/json",
        )
        self.assertEqual(root_allowed_response.status_code, 200)

    def test_write_only_rule_on_folder_does_not_block_read_access(self):
        writers_group = Group.objects.create(name="restricted_writers")
        rule = HandriveAccessRule.objects.create(path="restricted")
        rule.write_groups.add(writers_group)

        anonymous_list = self.client.get("/ko/docs/restricted/list/")
        anonymous_doc = self.client.get("/ko/docs/restricted/secret/")
        api_list = self.client.get(reverse("main:handrive_api_list"), data={"path": "restricted"})

        self.assertEqual(anonymous_list.status_code, 200)
        self.assertEqual(anonymous_doc.status_code, 200)
        self.assertEqual(api_list.status_code, 200)

    def test_url_only_group_hides_entry_from_list_and_blocks_direct_path(self):
        url_only_group = Group.objects.create(name=DOCS_URL_ONLY_GROUP_NAME)
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.read_groups.add(url_only_group)
        user = self.user_model.objects.create_user(username="url_only_reader", password="pw123456")
        user.groups.add(url_only_group)
        self.client.force_login(user)

        list_response = self.client.get("/ko/handrive/list/")
        api_list = self.client.get(reverse("main:handrive_api_list"), data={"path": ""})
        direct_view = self.client.get("/ko/handrive/public/")

        self.assertEqual(list_response.status_code, 200)
        self.assertNotContains(list_response, "public.md")
        self.assertEqual(api_list.status_code, 200)
        self.assertFalse(any(entry.get("path") == "public.md" for entry in api_list.json().get("entries", [])))
        self.assertEqual(direct_view.status_code, 403)

    def test_url_only_file_stays_visible_to_editor_and_uses_shared_url_for_anonymous(self):
        url_only_group = Group.objects.create(name=DOCS_URL_ONLY_GROUP_NAME)
        editors_group = Group.objects.create(name="url_only_editors")
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.read_groups.add(url_only_group)
        rule.write_groups.add(editors_group)

        editor = self.create_handrive_editor("url_only_editor")
        editor.groups.add(editors_group)
        self.client.force_login(editor)

        list_response = self.client.get("/ko/handrive/list/")
        api_list = self.client.get(reverse("main:handrive_api_list"), data={"path": ""})

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(api_list.status_code, 200)
        self.assertTrue(any(entry.get("path") == "public.md" for entry in api_list.json().get("entries", [])))

        share_response = self.client.post(
            reverse("main:handrive_api_url_share"),
            data=json.dumps({"path": "public.md", "enabled": True}),
            content_type="application/json",
        )
        self.assertEqual(share_response.status_code, 200)
        share_url = share_response.json()["share_url"]

        self.client.logout()
        anonymous_direct_view = self.client.get("/ko/handrive/public/")
        anonymous_shared_view = self.client.get(share_url)
        self.assertEqual(anonymous_direct_view.status_code, 403)
        self.assertEqual(anonymous_shared_view.status_code, 200)

    def test_url_share_api_returns_shared_view_url(self):
        editor = self.create_handrive_editor("url_share_api_editor")
        self.client.force_login(editor)

        response = self.client.post(
            reverse("main:handrive_api_url_share"),
            data=json.dumps({"path": "public.md", "enabled": True}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["is_url_only"])
        self.assertEqual(payload["slug_path"], "public")
        self.assertEqual(payload["owner_username"], "url_share_api_editor")
        self.assertEqual(payload["share_slug"], "public")
        self.assertTrue(payload["share_url"].endswith("/ko/handrive/share/url_share_api_editor/public"))

    def test_handrive_root_for_superuser_defaults_to_user_folder(self):
        admin_user = self.user_model.objects.create_user(
            username="handrive_superuser_root",
            password="pw123456",
            is_staff=True,
            is_superuser=True,
        )

        self.client.force_login(admin_user)
        response = self.client.get("/ko/handrive/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/handrive/users/handrive_superuser_root/list")

        redirected_response = self.client.get(response["Location"])
        self.assertEqual(redirected_response.status_code, 200)
        self.assertContains(redirected_response, 'data-current-dir="users/handrive_superuser_root"')
        self.assertContains(redirected_response, ">handrive_superuser_root<")

    def test_docs_superuser_can_still_open_unscoped_root_directly(self):
        admin_user = self.user_model.objects.create_user(
            username="handrive_superuser_direct_root",
            password="pw123456",
            is_staff=True,
            is_superuser=True,
        )

        self.client.force_login(admin_user)
        response = self.client.get("/ko/handrive/?root=1")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/handrive/users/handrive_superuser_direct_root/list")

    def test_docs_superuser_can_open_unscoped_root_file_directly(self):
        admin_user = self.user_model.objects.create_user(
            username="handrive_superuser_root_file",
            password="pw123456",
            is_staff=True,
            is_superuser=True,
        )

        self.client.force_login(admin_user)
        response = self.client.get("/ko/handrive/media/HanDrive/help/list_en")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "list_en")

    def test_docs_superuser_can_open_unscoped_root_folder_directly(self):
        admin_user = self.user_model.objects.create_user(
            username="handrive_superuser_root_folder",
            password="pw123456",
            is_staff=True,
            is_superuser=True,
        )

        self.client.force_login(admin_user)
        response = self.client.get("/ko/handrive/media/HanDrive/help/list")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'data-current-dir="media/HanDrive/help"')

    def test_docs_superuser_scoped_folder_shows_root_breadcrumb_link(self):
        admin_user = self.user_model.objects.create_user(
            username="admin",
            password="pw123456",
            is_staff=True,
            is_superuser=True,
        )

        self.client.force_login(admin_user)
        response = self.client.get("/ko/handrive/users/admin/list")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'href="/ko/handrive/users/admin/list"')
        self.assertContains(response, ">admin<")

    def test_handrive_root_for_staff_user_keeps_scoped_home_dir(self):
        staff_user = self.create_handrive_editor("handrive_staff_scoped")
        staff_user.is_staff = True
        staff_user.save(update_fields=["is_staff"])
        public_group, _ = Group.objects.get_or_create(name=DOCS_PUBLIC_WRITE_GROUP_NAME)
        staff_user.groups.add(public_group)

        self.client.force_login(staff_user)
        response = self.client.get("/ko/handrive/")
        redirected_response = self.client.get(response["Location"])

        self.assertEqual(response.status_code, 302)
        self.assertIn("/ko/handrive/users/handrive_staff_scoped/list", response["Location"])
        self.assertNotContains(redirected_response, "스태틱파일 적용+구니콘 재시작")

    @mock.patch("main.handrive_views.subprocess.Popen")
    @mock.patch("main.handrive_views.subprocess.run")
    def test_docs_ops_apply_static_runs_collectstatic_and_restart_for_superuser(
        self,
        mock_run,
        mock_popen,
    ):
        admin_user = self.user_model.objects.create_user(
            username="handrive_ops_superuser",
            password="pw123456",
            is_staff=True,
            is_superuser=True,
        )

        self.client.force_login(admin_user)
        response = self.client.post(
            reverse("main:handrive_ops_apply_static_lang", kwargs={"ui_lang": "ko"}),
            data={"next": "/ko/handrive/"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/handrive/")
        mock_run.assert_called_once_with(
            [mock.ANY, "manage.py", "collectstatic", "--noinput"],
            cwd=str(settings.BASE_DIR),
            check=True,
        )
        mock_popen.assert_called_once()

    def test_docs_ops_apply_static_requires_superuser(self):
        editor = self.create_handrive_editor("handrive_ops_editor")
        self.client.force_login(editor)

        response = self.client.post(
            reverse("main:handrive_ops_apply_static_lang", kwargs={"ui_lang": "ko"}),
            data={"next": "/ko/handrive/"},
        )

        self.assertEqual(response.status_code, 403)

    def test_docs_api_move_moves_file_into_target_directory(self):
        editor = self.create_handrive_editor("move_editor")
        self.client.force_login(editor)

        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "archive").mkdir(parents=True, exist_ok=True)

        response = self.client.post(
            reverse("main:handrive_api_move"),
            data=json.dumps({"source_path": "public.md", "target_dir": "archive"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse((handrive_root / "public.md").exists())
        self.assertTrue((handrive_root / "archive" / "public.md").exists())
        self.assertEqual(response.json().get("path"), "archive/public.md")

    def test_docs_api_move_blocks_folder_move_into_descendant(self):
        editor = self.create_handrive_editor("move_descendant_editor")
        self.client.force_login(editor)

        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "restricted" / "child").mkdir(parents=True, exist_ok=True)

        response = self.client.post(
            reverse("main:handrive_api_move"),
            data=json.dumps({"source_path": "restricted", "target_dir": "restricted/child"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertTrue((handrive_root / "restricted").exists())
        self.assertTrue((handrive_root / "restricted" / "child").exists())

    def test_docs_api_move_requires_write_access_on_target_directory(self):
        writers_group = Group.objects.create(name="archive_writers")
        rule = HandriveAccessRule.objects.create(path="archive")
        rule.write_groups.add(writers_group)

        blocked_editor = self.create_handrive_editor("blocked_move_editor")
        allowed_editor = self.create_handrive_editor("allowed_move_editor")
        allowed_editor.groups.add(writers_group)

        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "archive").mkdir(parents=True, exist_ok=True)

        self.client.force_login(blocked_editor)
        blocked_response = self.client.post(
            reverse("main:handrive_api_move"),
            data=json.dumps({"source_path": "public.md", "target_dir": "archive"}),
            content_type="application/json",
        )
        self.assertEqual(blocked_response.status_code, 403)

        self.client.force_login(allowed_editor)
        allowed_response = self.client.post(
            reverse("main:handrive_api_move"),
            data=json.dumps({"source_path": "public.md", "target_dir": "archive"}),
            content_type="application/json",
        )
        self.assertEqual(allowed_response.status_code, 200)
        self.assertFalse((handrive_root / "public.md").exists())
        self.assertTrue((handrive_root / "archive" / "public.md").exists())

    def test_docs_api_move_allows_target_directory_without_explicit_acl_even_with_child_acl(self):
        editor = self.create_handrive_editor("move_target_default_editor")
        restricted_writer = self.user_model.objects.create_user(
            username="restricted_writer",
            password="pw123456",
        )
        self.client.force_login(editor)

        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "WPF").mkdir(parents=True, exist_ok=True)
        (handrive_root / "C#" / "Winform").mkdir(parents=True, exist_ok=True)
        (handrive_root / "C#" / "Winform" / "test.md").write_text("# test", encoding="utf-8")

        rule = HandriveAccessRule.objects.create(path="C#/Winform/test.md")
        rule.write_users.add(restricted_writer)

        response = self.client.post(
            reverse("main:handrive_api_move"),
            data=json.dumps({"source_path": "WPF", "target_dir": "C#"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("path"), "C#/WPF")
        self.assertFalse((handrive_root / "WPF").exists())
        self.assertTrue((handrive_root / "C#" / "WPF").exists())

    def test_docs_api_upload_saves_file_into_writable_directory(self):
        editor = self.create_handrive_editor("upload_editor")
        self.client.force_login(editor)

        response = self.client.post(
            reverse("main:handrive_api_upload"),
            data={
                "dir": "restricted",
                "files": SimpleUploadedFile("hello.txt", b"hello upload", content_type="text/plain"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue((Path(settings.MEDIA_ROOT) / "HanDrive" / "restricted" / "hello.txt").exists())
        payload = response.json()
        self.assertEqual(payload["path"], "restricted")
        self.assertEqual(payload["entries"][0]["path"], "restricted/hello.txt")

    def test_docs_api_upload_requires_directory_write_access(self):
        writers_group = Group.objects.create(name="upload_writers")
        rule = HandriveAccessRule.objects.create(path="restricted")
        rule.write_groups.add(writers_group)

        blocked_editor = self.create_handrive_editor("blocked_upload_editor")
        self.client.force_login(blocked_editor)

        response = self.client.post(
            reverse("main:handrive_api_upload"),
            data={
                "dir": "restricted",
                "files": SimpleUploadedFile("denied.txt", b"denied", content_type="text/plain"),
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse((Path(settings.MEDIA_ROOT) / "HanDrive" / "restricted" / "denied.txt").exists())

    def test_docs_api_upload_accepts_chunked_upload_and_finalizes_file(self):
        editor = self.create_handrive_editor("chunk_upload_editor")
        self.client.force_login(editor)

        first = self.client.post(
            reverse("main:handrive_api_upload"),
            data={
                "dir": "restricted",
                "upload_id": "chunk-test-upload",
                "file_name": "chunked.txt",
                "chunk_index": "0",
                "total_chunks": "2",
                "chunk": SimpleUploadedFile("chunk.part", b"hello ", content_type="application/octet-stream"),
            },
        )
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json().get("uploading"))

        second = self.client.post(
            reverse("main:handrive_api_upload"),
            data={
                "dir": "restricted",
                "upload_id": "chunk-test-upload",
                "file_name": "chunked.txt",
                "chunk_index": "1",
                "total_chunks": "2",
                "chunk": SimpleUploadedFile("chunk.part", b"world", content_type="application/octet-stream"),
            },
        )

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["entries"][0]["path"], "restricted/chunked.txt")
        saved_path = Path(settings.MEDIA_ROOT) / "HanDrive" / "restricted" / "chunked.txt"
        self.assertTrue(saved_path.exists())
        self.assertEqual(saved_path.read_bytes(), b"hello world")

    def test_docs_api_upload_cancel_removes_chunk_session(self):
        editor = self.create_handrive_editor("cancel_upload_editor")
        self.client.force_login(editor)

        self.client.post(
            reverse("main:handrive_api_upload"),
            data={
                "dir": "restricted",
                "upload_id": "cancel-test-upload",
                "file_name": "cancelled.txt",
                "chunk_index": "0",
                "total_chunks": "2",
                "chunk": SimpleUploadedFile("chunk.part", b"hello ", content_type="application/octet-stream"),
            },
        )

        session_dir = get_handrive_upload_tmp_dir() / "cancel-test-upload"
        self.assertTrue(session_dir.exists())

        response = self.client.post(
            reverse("main:handrive_api_upload_cancel"),
            data={"upload_id": "cancel-test-upload"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(session_dir.exists())

    def test_scoped_docs_api_mkdir_blocks_when_entry_limit_would_be_exceeded(self):
        editor = self.create_scoped_handrive_editor("quota_mkdir_editor")
        scoped_root = Path(settings.MEDIA_ROOT) / "HanDrive" / "users" / editor.username
        for index in range(DOCS_USER_SCOPED_ENTRY_LIMIT):
            (scoped_root / f"entry_{index}.txt").write_text("x", encoding="utf-8")

        self.client.force_login(editor)
        response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps(
                {
                    "parent_dir": f"users/{editor.username}",
                    "folder_name": "blocked_folder",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("하위 폴더/파일 수가 100개를 초과", response.json().get("error", ""))
        self.assertFalse((scoped_root / "blocked_folder").exists())

    def test_scoped_docs_api_upload_blocks_when_quota_would_be_exceeded(self):
        editor = self.create_scoped_handrive_editor("quota_upload_editor")
        scoped_root = Path(settings.MEDIA_ROOT) / "HanDrive" / "users" / editor.username
        with (scoped_root / "existing.bin").open("wb") as handle:
            handle.truncate(DOCS_USER_SCOPED_QUOTA_BYTES)

        self.client.force_login(editor)
        response = self.client.post(
            reverse("main:handrive_api_upload"),
            data={
                "dir": f"users/{editor.username}",
                "files": SimpleUploadedFile("extra.txt", b"b", content_type="text/plain"),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("용량이 1GB를 초과", response.json().get("error", ""))
        self.assertFalse((scoped_root / "extra.txt").exists())

    def test_scoped_docs_api_save_blocks_when_entry_limit_would_be_exceeded(self):
        editor = self.create_scoped_handrive_editor("quota_save_editor")
        scoped_root = Path(settings.MEDIA_ROOT) / "HanDrive" / "users" / editor.username
        for index in range(DOCS_USER_SCOPED_ENTRY_LIMIT):
            (scoped_root / f"entry_{index}.txt").write_text("x", encoding="utf-8")

        self.client.force_login(editor)
        response = self.client.post(
            reverse("main:handrive_api_save"),
            data=json.dumps(
                {
                    "original_path": "",
                    "target_dir": f"users/{editor.username}",
                    "filename": "blocked_note",
                    "content": "# blocked",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("하위 폴더/파일 수가 100개를 초과", response.json().get("error", ""))
        self.assertFalse((scoped_root / "blocked_note.md").exists())

    def test_acl_api_is_admin_only(self):
        editor = self.create_handrive_editor("acl_editor")
        target_group = Group.objects.create(name="target_group")
        target_user = self.user_model.objects.create_user(username="target_user", password="pw123456")

        self.client.force_login(editor)
        response = self.client.post(
            reverse("main:handrive_api_acl"),
            data=json.dumps(
                {
                    "path": "restricted/secret.md",
                    "read_user_ids": [target_user.id],
                    "read_group_ids": [target_group.id],
                    "write_user_ids": [target_user.id],
                    "write_group_ids": [target_group.id],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_acl_api_can_save_and_clear_split_rule(self):
        admin_user = self.user_model.objects.create_user(
            username="acl_admin",
            password="pw123456",
            is_staff=True,
        )
        read_group = Group.objects.create(name="read_group")
        write_group = Group.objects.create(name="write_group")
        read_user = self.user_model.objects.create_user(username="read_user", password="pw123456")
        write_user = self.user_model.objects.create_user(username="write_user", password="pw123456")

        self.client.force_login(admin_user)
        response = self.client.post(
            reverse("main:handrive_api_acl"),
            data=json.dumps(
                {
                    "path": "restricted/secret.md",
                    "read_user_ids": [read_user.id],
                    "read_group_ids": [read_group.id],
                    "write_user_ids": [write_user.id],
                    "write_group_ids": [write_group.id],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        rule = HandriveAccessRule.objects.get(path="restricted/secret.md")
        self.assertEqual(set(rule.read_users.values_list("id", flat=True)), {read_user.id})
        self.assertEqual(set(rule.read_groups.values_list("id", flat=True)), {read_group.id})
        self.assertEqual(set(rule.write_users.values_list("id", flat=True)), {write_user.id})
        self.assertEqual(set(rule.write_groups.values_list("id", flat=True)), {write_group.id})

        clear_response = self.client.post(
            reverse("main:handrive_api_acl"),
            data=json.dumps(
                {
                    "path": "restricted/secret.md",
                    "read_user_ids": [],
                    "read_group_ids": [],
                    "write_user_ids": [],
                    "write_group_ids": [],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(clear_response.status_code, 200)
        self.assertFalse(HandriveAccessRule.objects.filter(path="restricted/secret.md").exists())

    def test_acl_api_can_apply_split_rule_to_multiple_paths(self):
        admin_user = self.user_model.objects.create_user(
            username="acl_admin_bulk",
            password="pw123456",
            is_staff=True,
        )
        read_group = Group.objects.create(name="bulk_read_group")
        write_group = Group.objects.create(name="bulk_write_group")
        read_user = self.user_model.objects.create_user(username="bulk_read_user", password="pw123456")
        write_user = self.user_model.objects.create_user(username="bulk_write_user", password="pw123456")

        self.client.force_login(admin_user)
        response = self.client.post(
            reverse("main:handrive_api_acl"),
            data=json.dumps(
                {
                    "paths": ["restricted/secret.md", "public.md"],
                    "read_user_ids": [read_user.id],
                    "read_group_ids": [read_group.id],
                    "write_user_ids": [write_user.id],
                    "write_group_ids": [write_group.id],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload.get("paths", [])), {"restricted/secret.md", "public.md"})
        for target_path in ["restricted/secret.md", "public.md"]:
            rule = HandriveAccessRule.objects.get(path=target_path)
            self.assertEqual(set(rule.read_users.values_list("id", flat=True)), {read_user.id})
            self.assertEqual(set(rule.read_groups.values_list("id", flat=True)), {read_group.id})
            self.assertEqual(set(rule.write_users.values_list("id", flat=True)), {write_user.id})
            self.assertEqual(set(rule.write_groups.values_list("id", flat=True)), {write_group.id})

    def test_acl_api_rejects_public_all_group_for_any_directory_in_bulk_targets(self):
        admin_user = self.user_model.objects.create_user(
            username="acl_admin_block_bulk_dir_public",
            password="pw123456",
            is_staff=True,
        )
        public_group = get_handrive_public_write_group()
        self.client.force_login(admin_user)

        response = self.client.post(
            reverse("main:handrive_api_acl"),
            data=json.dumps(
                {
                    "paths": ["restricted", "public.md"],
                    "read_user_ids": [],
                    "read_group_ids": [],
                    "write_user_ids": [],
                    "write_group_ids": [public_group.id],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("폴더에는 전체 권한을 설정할 수 없습니다", response.json().get("error", ""))
        self.assertFalse(HandriveAccessRule.objects.filter(path="restricted").exists())

    def test_acl_options_includes_public_all_group(self):
        admin_user = self.user_model.objects.create_user(
            username="acl_admin_options",
            password="pw123456",
            is_staff=True,
        )
        self.client.force_login(admin_user)

        response = self.client.get(reverse("main:handrive_api_acl_options"))
        self.assertEqual(response.status_code, 200)

        groups = response.json().get("groups", [])
        self.assertTrue(any(group.get("name") == DOCS_PUBLIC_WRITE_GROUP_NAME for group in groups))
        self.assertTrue(any(group.get("label") == "전체" for group in groups))

    def test_anonymous_user_cannot_write_directory_when_public_all_group_is_set(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="")
        rule.write_groups.add(public_group)

        response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "", "folder_name": "anon_public_write"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        self.assertFalse((handrive_root / "anon_public_write").exists())

    def test_acl_api_rejects_public_all_group_for_directory(self):
        admin_user = self.user_model.objects.create_user(
            username="acl_admin_block_dir_public",
            password="pw123456",
            is_staff=True,
        )
        public_group = get_handrive_public_write_group()
        self.client.force_login(admin_user)

        response = self.client.post(
            reverse("main:handrive_api_acl"),
            data=json.dumps(
                {
                    "path": "restricted",
                    "read_user_ids": [],
                    "read_group_ids": [],
                    "write_user_ids": [],
                    "write_group_ids": [public_group.id],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("폴더에는 전체 권한을 설정할 수 없습니다", response.json().get("error", ""))

    def test_legacy_directory_public_all_rule_does_not_grant_write_access(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="restricted")
        rule.write_groups.add(public_group)

        editor = self.create_handrive_editor("legacy_dir_public_editor")
        self.client.force_login(editor)

        response = self.client.post(
            reverse("main:handrive_api_mkdir"),
            data=json.dumps({"parent_dir": "restricted", "folder_name": "should_not_create"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_docs_api_list_marks_public_writable_file(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        response = self.client.get(reverse("main:handrive_api_list"), data={"path": ""})
        self.assertEqual(response.status_code, 200)

        entries = response.json().get("entries", [])
        public_entry = next((entry for entry in entries if entry.get("path") == "public.md"), None)
        self.assertIsNotNone(public_entry)
        self.assertTrue(public_entry.get("can_edit"))
        self.assertTrue(public_entry.get("is_public_write"))
        self.assertEqual(public_entry.get("write_acl_labels"), [])

    def test_docs_api_list_includes_write_acl_labels_for_accounts_and_groups(self):
        writer_group = Group.objects.create(name="writers_group")
        writer_user = self.user_model.objects.create_user(username="writer_user", password="pw123456")
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(writer_group)
        rule.write_users.add(writer_user)

        admin_user = self.user_model.objects.create_user(
            username="acl_admin_reader",
            password="pw123456",
            is_staff=True,
        )
        self.client.force_login(admin_user)

        response = self.client.get(reverse("main:handrive_api_list"), data={"path": ""})
        self.assertEqual(response.status_code, 200)
        entries = response.json().get("entries", [])
        public_entry = next((entry for entry in entries if entry.get("path") == "public.md"), None)
        self.assertIsNotNone(public_entry)
        labels = public_entry.get("write_acl_labels") or []
        self.assertIn("#writers_group", labels)
        self.assertIn("@writer_user", labels)

    def test_docs_write_page_allows_anonymous_public_writable_file_edit(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        response = self.client.get("/ko/docs/write/", data={"path": "public.md"})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'data-public-write-direct-save="1"')

    def test_docs_api_preview_rejects_user_without_write_permission(self):
        user = self.user_model.objects.create_user(username="preview_blocked", password="pw123456")
        self.client.force_login(user)

        response = self.client.post(
            reverse("main:handrive_api_preview"),
            data=json.dumps({"original_path": "", "content": "# blocked"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)

    def test_docs_api_preview_allows_new_file_in_scoped_target_dir(self):
        user = self.create_handrive_editor("preview_scoped_editor")
        public_group = get_handrive_public_write_group()
        user.groups.add(public_group)
        self.client.force_login(user)

        response = self.client.post(
            reverse("main:handrive_api_preview"),
            data=json.dumps(
                {
                    "original_path": "",
                    "target_dir": f"users/{user.username}",
                    "content": "# scoped preview",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("ok"))
        self.assertEqual(payload.get("render_mode"), "markdown")
        self.assertIn("<h1>", payload.get("html", ""))

    def test_docs_api_preview_allows_anonymous_for_public_writable_file(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        response = self.client.post(
            reverse("main:handrive_api_preview"),
            data=json.dumps({"original_path": "public.md", "content": "# 제목"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("ok"))
        self.assertEqual(payload.get("render_mode"), "markdown")
        self.assertIn("<h1>", payload.get("html", ""))

    def test_docs_view_shows_edit_button_for_anonymous_public_writable_file(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        response = self.client.get("/ko/docs/public/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "/ko/docs/write")
        self.assertContains(response, "path=public.md")

    def test_docs_view_renders_plain_text_for_non_markdown_file(self):
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "notes.txt").write_text("# heading\n**bold**", encoding="utf-8")

        response = self.client.get("/ko/docs/notes.txt/")
        self.assertEqual(response.status_code, 200)
        html = response.content.decode("utf-8")
        self.assertIn('class="docs-plain-text"', html)
        self.assertIn("<pre><code># heading", html)
        self.assertIn("**bold**", html)
        self.assertNotIn("<strong>bold</strong>", html)

    def test_docs_api_preview_renders_plain_text_for_non_markdown_file(self):
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "notes.txt").write_text("# heading\n**bold**", encoding="utf-8")

        response = self.client.post(
            reverse("main:handrive_api_preview"),
            data=json.dumps({"path": "notes.txt"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("render_mode"), "plain_text")
        self.assertIn("<pre><code># heading", payload.get("html", ""))
        self.assertIn("**bold**", payload.get("html", ""))
        self.assertNotIn("<strong>bold</strong>", payload.get("html", ""))

    def test_docs_view_renders_image_preview_and_hides_edit_button(self):
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        image_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8S7sAAAAASUVORK5CYII="
        )
        (handrive_root / "sample.png").write_bytes(image_bytes)
        editor = self.create_handrive_editor("media_editor")
        self.client.force_login(editor)

        response = self.client.get(
            reverse("main:handrive_view_lang", kwargs={"ui_lang": "ko", "doc_path": "sample.png"})
        )

        self.assertEqual(response.status_code, 200)
        html = response.content.decode("utf-8")
        self.assertIn('class="handrive-media handrive-media-image"', html)
        self.assertIn("/handrive/api/download?path=sample.png", html)
        self.assertNotIn("/ko/docs/write?path=sample.png", html)

    def test_docs_api_preview_renders_audio_preview_for_media_file(self):
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "sample.mp3").write_bytes(b"ID3")
        editor = self.create_handrive_editor("audio_editor")
        self.client.force_login(editor)

        response = self.client.post(
            reverse("main:handrive_api_preview"),
            data=json.dumps({"path": "sample.mp3"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("render_mode"), "media_audio")
        self.assertIn("<audio", payload.get("html", ""))
        self.assertIn("/handrive/api/download?path=sample.mp3", payload.get("html", ""))

    def test_docs_view_renders_html_live_with_same_name_css_and_js(self):
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "sample.html").write_text("<main id='app'>hello</main>", encoding="utf-8")
        (handrive_root / "sample.css").write_text("#app { color: rgb(255, 0, 0); }", encoding="utf-8")
        (handrive_root / "sample.js").write_text("window.__sampleLoaded = true;", encoding="utf-8")

        response = self.client.get("/ko/docs/sample.html/")
        self.assertEqual(response.status_code, 200)

        html = response.content.decode("utf-8")
        self.assertIn('class="docs-html"', html)
        self.assertIn("docs-html-live-frame", html)
        self.assertIn('sandbox="allow-scripts"', html)
        self.assertNotIn("allow-forms", html)
        self.assertNotIn("allow-popups", html)
        self.assertIn("data-docs-linked-css", html)
        self.assertIn("data-docs-linked-js", html)
        self.assertIn("Content-Security-Policy", html)
        self.assertIn("window.__sampleLoaded = true;", html)

    def test_docs_api_preview_renders_html_live_with_same_name_css_and_js(self):
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "sample.html").write_text("<main id='app'>hello</main>", encoding="utf-8")
        (handrive_root / "sample.css").write_text("#app { color: rgb(255, 0, 0); }", encoding="utf-8")
        (handrive_root / "sample.js").write_text("window.__sampleLoaded = true;", encoding="utf-8")

        response = self.client.post(
            reverse("main:handrive_api_preview"),
            data=json.dumps({"path": "sample.html"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("render_class"), "docs-html")
        self.assertIn("docs-html-live-frame", payload.get("html", ""))
        self.assertIn('sandbox="allow-scripts"', payload.get("html", ""))
        self.assertNotIn("allow-forms", payload.get("html", ""))
        self.assertNotIn("allow-popups", payload.get("html", ""))
        self.assertIn("data-docs-linked-css", payload.get("html", ""))
        self.assertIn("data-docs-linked-js", payload.get("html", ""))
        self.assertIn("Content-Security-Policy", payload.get("html", ""))

    def test_public_writable_file_cannot_be_renamed(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        response = self.client.post(
            reverse("main:handrive_api_rename"),
            data=json.dumps({"path": "public.md", "new_name": "public_renamed"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("전체 허용 파일은 이름을 바꿀 수 없습니다", response.json().get("error", ""))
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        self.assertTrue((handrive_root / "public.md").exists())
        self.assertFalse((handrive_root / "public_renamed.md").exists())

    def test_public_writable_file_cannot_be_deleted(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        response = self.client.post(
            reverse("main:handrive_api_delete"),
            data=json.dumps({"path": "public.md"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("전체 허용 파일은 삭제할 수 없습니다", response.json().get("error", ""))
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        self.assertTrue((handrive_root / "public.md").exists())

    def test_docs_api_delete_supports_multiple_paths(self):
        editor = self.create_handrive_editor("bulk_delete_editor")
        self.client.force_login(editor)

        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "extra.md").write_text("# extra", encoding="utf-8")

        response = self.client.post(
            reverse("main:handrive_api_delete"),
            data=json.dumps({"paths": ["public.md", "extra.md"]}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse((handrive_root / "public.md").exists())
        self.assertFalse((handrive_root / "extra.md").exists())

    def test_docs_api_delete_bulk_rejects_when_public_writable_file_is_included(self):
        editor = self.create_handrive_editor("bulk_delete_public_block_editor")
        self.client.force_login(editor)

        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "extra.md").write_text("# extra", encoding="utf-8")

        response = self.client.post(
            reverse("main:handrive_api_delete"),
            data=json.dumps({"paths": ["public.md", "extra.md"]}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertTrue((handrive_root / "public.md").exists())
        self.assertTrue((handrive_root / "extra.md").exists())

    def test_public_writable_file_cannot_be_moved(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "archive").mkdir(parents=True, exist_ok=True)

        response = self.client.post(
            reverse("main:handrive_api_move"),
            data=json.dumps({"source_path": "public.md", "target_dir": "archive"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("전체 허용 파일은 이동할 수 없습니다", response.json().get("error", ""))
        self.assertTrue((handrive_root / "public.md").exists())
        self.assertFalse((handrive_root / "archive" / "public.md").exists())

    def test_public_writable_file_save_api_rejects_rename(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)

        response = self.client.post(
            reverse("main:handrive_api_save"),
            data=json.dumps(
                {
                    "original_path": "public.md",
                    "target_dir": "",
                    "filename": "public_renamed",
                    "content": "# renamed",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("전체 허용 파일은 위치나 이름을 바꿀 수 없습니다", response.json().get("error", ""))
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        self.assertTrue((handrive_root / "public.md").exists())
        self.assertFalse((handrive_root / "public_renamed.md").exists())

    def test_public_writable_file_save_api_rejects_move(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"
        (handrive_root / "archive").mkdir(parents=True, exist_ok=True)

        response = self.client.post(
            reverse("main:handrive_api_save"),
            data=json.dumps(
                {
                    "original_path": "public.md",
                    "target_dir": "archive",
                    "filename": "public",
                    "content": "# moved",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("전체 허용 파일은 위치나 이름을 바꿀 수 없습니다", response.json().get("error", ""))
        self.assertTrue((handrive_root / "public.md").exists())
        self.assertFalse((handrive_root / "archive" / "public.md").exists())

    def test_public_writable_file_save_api_allows_same_path_update(self):
        public_group = get_handrive_public_write_group()
        rule = HandriveAccessRule.objects.create(path="public.md")
        rule.write_groups.add(public_group)
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"

        response = self.client.post(
            reverse("main:handrive_api_save"),
            data=json.dumps(
                {
                    "original_path": "public.md",
                    "target_dir": "",
                    "filename": "public",
                    "content": "# updated",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual((handrive_root / "public.md").read_text(encoding="utf-8"), "# updated")

    def test_docs_api_save_allows_custom_extension(self):
        editor = self.create_handrive_editor("custom_ext_editor")
        self.client.force_login(editor)
        handrive_root = Path(settings.MEDIA_ROOT) / "docs"

        response = self.client.post(
            reverse("main:handrive_api_save"),
            data=json.dumps(
                {
                    "original_path": "",
                    "target_dir": "",
                    "filename": "notes",
                    "extension": ".txt",
                    "content": "# text document",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("path"), "notes.txt")
        self.assertEqual(payload.get("slug_path"), "notes.txt")
        self.assertTrue((handrive_root / "notes.txt").exists())

        view_response = self.client.get("/ko/docs/notes.txt/")
        self.assertEqual(view_response.status_code, 200)

    def test_docs_api_save_rejects_invalid_extension_format(self):
        editor = self.create_handrive_editor("invalid_ext_editor")
        self.client.force_login(editor)

        response = self.client.post(
            reverse("main:handrive_api_save"),
            data=json.dumps(
                {
                    "original_path": "",
                    "target_dir": "",
                    "filename": "broken",
                    "extension": ".",
                    "content": "# invalid extension",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("확장자 형식이 올바르지 않습니다", response.json().get("error", ""))
