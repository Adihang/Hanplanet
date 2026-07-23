from django.conf import settings
from django.core.management.base import BaseCommand
from oauth2_provider.models import get_application_model


class Command(BaseCommand):
    help = "Ensure the first-party Hanplanet OIDC client registrations exist."

    def handle(self, *args, **options):
        Application = get_application_model()
        client_id = str(getattr(settings, "WARGAME_OIDC_CLIENT_ID", "") or "").strip()
        redirect_uri = str(getattr(settings, "WARGAME_OIDC_REDIRECT_URI", "") or "").strip()
        if not client_id or not redirect_uri:
            self.stdout.write("OIDC client bootstrap skipped: Wargame client settings are empty.")
            return

        application, created = Application.objects.get_or_create(
            client_id=client_id,
            defaults={
                "name": "Hanplanet Wargame",
                "client_type": Application.CLIENT_PUBLIC,
                "authorization_grant_type": Application.GRANT_AUTHORIZATION_CODE,
                "redirect_uris": redirect_uri,
                "skip_authorization": True,
                "algorithm": "RS256",
                "user": None,
            },
        )

        redirect_uris = {
            value.strip()
            for value in str(application.redirect_uris or "").split()
            if value.strip()
        }
        redirect_uris.add(redirect_uri)
        changed_fields = []
        if application.name != "Hanplanet Wargame":
            application.name = "Hanplanet Wargame"
            changed_fields.append("name")
        if application.client_type != Application.CLIENT_PUBLIC:
            application.client_type = Application.CLIENT_PUBLIC
            changed_fields.append("client_type")
        if application.authorization_grant_type != Application.GRANT_AUTHORIZATION_CODE:
            application.authorization_grant_type = Application.GRANT_AUTHORIZATION_CODE
            changed_fields.append("authorization_grant_type")
        if application.algorithm != "RS256":
            application.algorithm = "RS256"
            changed_fields.append("algorithm")
        next_redirect_uris = " ".join(sorted(redirect_uris))
        if application.redirect_uris != next_redirect_uris:
            application.redirect_uris = next_redirect_uris
            changed_fields.append("redirect_uris")
        if not application.skip_authorization:
            application.skip_authorization = True
            changed_fields.append("skip_authorization")
        if changed_fields:
            application.save(update_fields=changed_fields + ["updated"])

        status = "created" if created else "updated" if changed_fields else "ready"
        self.stdout.write(self.style.SUCCESS(f"OIDC client {client_id}: {status}"))
