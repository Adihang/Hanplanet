from django.contrib.auth.views import redirect_to_login
from django.urls import path, re_path, reverse

from oauth2_provider import views as oauth2_views
from oauth2_provider.urls import management_urlpatterns, oidc_urlpatterns

from .views import resolve_ui_lang


class HanplanetAuthorizationView(oauth2_views.AuthorizationView):
    """Force anonymous OAuth authorize requests through Hanplanet's login page."""

    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return self._redirect_to_hanplanet_login(request)
        return super().dispatch(request, *args, **kwargs)

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
