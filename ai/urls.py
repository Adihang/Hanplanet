from django.urls import re_path
from . import views

urlpatterns = [
    # GET /ai/v1/models
    re_path(r'^v1/models$', views.ollama_models),
    # POST /ai/v1/chat/completions  (and any other /v1/* endpoint)
    re_path(r'^v1/(?P<path>.+)$', views.ollama_proxy),
]
