from django.urls import path, re_path

from . import views


app_name = "hpmail"

urlpatterns = [
    path("Email", views.email_redirect, name="email_root"),
    path("Email/", views.email_redirect),
    path("email", views.email_redirect, name="email_lower_root"),
    path("email/", views.email_redirect),
    re_path(r"^(?P<ui_lang>ko|en)/Email/?$", views.email_page, name="email_page_lang"),
    re_path(r"^(?P<ui_lang>ko|en)/email/?$", views.email_lower_redirect, name="email_lower_page_lang"),
    path("api/email/mailboxes", views.api_mailboxes, name="api_mailboxes"),
    path("api/email/mailboxes/create", views.api_mailbox_create, name="api_mailbox_create"),
    path("api/email/mailboxes/rename", views.api_mailbox_rename, name="api_mailbox_rename"),
    path("api/email/mailboxes/delete", views.api_mailbox_delete, name="api_mailbox_delete"),
    path("api/email/messages", views.api_messages, name="api_messages"),
    path("api/email/messages/detail", views.api_message_detail, name="api_message_detail"),
    path("api/email/messages/flags", views.api_message_flags, name="api_message_flags"),
    path("api/email/messages/move", views.api_message_move, name="api_message_move"),
    path("api/email/messages/delete", views.api_message_delete, name="api_message_delete"),
    path("api/email/send", views.api_send, name="api_send"),
    path("api/email/quota", views.api_quota, name="api_quota"),
]
