import logging

from django.contrib.auth.views import redirect_to_login
from django.urls import path, re_path, reverse

from oauth2_provider import views as oauth2_views
from oauth2_provider.urls import management_urlpatterns, oidc_urlpatterns

from .views import resolve_ui_lang


logger = logging.getLogger(__name__)


class HanplanetAuthorizationView(oauth2_views.AuthorizationView):
    """Force anonymous OAuth authorize requests through Hanplanet's login page."""

    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return self._redirect_to_hanplanet_login(request)
        self._authenticated_user = request.user
        self._ensure_forgejo_oauth_link_if_needed(request)
        return super().dispatch(request, *args, **kwargs)

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        # base.html uses these as filter arguments (|default:meta_canonical_url),
        # which raises VariableDoesNotExist if missing — unlike standalone variables.
        ctx.setdefault("meta_canonical_url", self.request.build_absolute_uri(self.request.path))
        ctx.setdefault("meta_og_image", "https://www.hanplanet.com/static/media/icons/hanplanet-og-1200.png")
        # 인증 중인 계정 표시
        ctx["oauth_username"] = getattr(getattr(self, "_authenticated_user", None), "username", "")
        return ctx

    def handle_no_permission(self):
        prompt = self.request.GET.get("prompt")
        redirect_uri = self.request.GET.get("redirect_uri")

        if prompt == "none" and redirect_uri:
            return super().handle_no_permission()

        return self._redirect_to_hanplanet_login(self.request)

    def _redirect_to_hanplanet_login(self, request):
        resolved_lang = resolve_ui_lang(request)
        login_url = reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang})
        return redirect_to_login(
            request.get_full_path(),
            login_url,
            self.get_redirect_field_name(),
        )

    def _ensure_forgejo_oauth_link_if_needed(self, request):
        if str(request.GET.get("client_id") or "").strip() != "gitea-hanplanet-sso":
            return
        try:
            from .handrive_views import _ensure_forgejo_oauth_link_for_user

            _ensure_forgejo_oauth_link_for_user(request.user)
        except Exception:
            logger.exception(
                "Failed to ensure Forgejo OAuth link for %s",
                getattr(request.user, "username", "unknown"),
            )


base_urlpatterns = [
    path("authorize/", HanplanetAuthorizationView.as_view(), name="authorize"),
    path("token/", oauth2_views.TokenView.as_view(), name="token"),
    path("revoke_token/", oauth2_views.RevokeTokenView.as_view(), name="revoke-token"),
    path("introspect/", oauth2_views.IntrospectTokenView.as_view(), name="introspect"),
    path(
        "device-authorization/",
        oauth2_views.DeviceAuthorizationView.as_view(),
        name="device-authorization",
    ),
    path("device/", oauth2_views.DeviceUserCodeView.as_view(), name="device"),
    path(
        "device-confirm/<slug:client_id>/<slug:user_code>",
        oauth2_views.DeviceConfirmView.as_view(),
        name="device-confirm",
    ),
    path(
        "device-grant-status/<slug:client_id>/<slug:user_code>",
        oauth2_views.DeviceGrantStatusView.as_view(),
        name="device-grant-status",
    ),
]


app_name = "oauth2_provider"
urlpatterns = base_urlpatterns + management_urlpatterns + oidc_urlpatterns


oauth_compat_urlpatterns = [
    re_path(r"^authorize/?$", HanplanetAuthorizationView.as_view(), name="authorize-compat"),
]
