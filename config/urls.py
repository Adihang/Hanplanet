"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from functools import partial
import time

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponse
from django.urls import re_path
from django.views.static import serve

urlpatterns = [
    path("admin/", admin.site.urls),
    path('o/', include('oauth2_provider.urls', namespace='oauth2_provider')),
    path('ai/', include('ai.urls')),
    path('', include('main.urls')),
]


def serve_with_cache(request, path, *, document_root, cache_control):
    for attempt in range(4):
        try:
            response = serve(request, path, document_root=document_root)
            response["Cache-Control"] = cache_control
            return response
        except (OSError, PermissionError) as exc:
            if attempt < 3:
                time.sleep(0.15)
                continue
            break
    return HttpResponse("Storage unavailable", status=503)

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
elif getattr(settings, "DJANGO_SERVE_FILES", False):
    urlpatterns += [
        re_path(
            r'^media/(?P<path>.*)$',
            partial(
                serve_with_cache,
                document_root=settings.MEDIA_ROOT,
                cache_control="public, max-age=604800",
            ),
        ),
        re_path(
            r'^static/(?P<path>.*)$',
            partial(
                serve_with_cache,
                document_root=settings.STATIC_ROOT,
                cache_control="public, max-age=2592000, s-maxage=2592000, immutable",
            ),
        ),
    ]
