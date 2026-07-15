from django.core.management.base import BaseCommand

from main.models import BumpercarSkin, OnscripterGameConfig
from main.onscripter_views import rebuild_onscripter_game_manifest
from main.views import rebuild_bumpercar_skin_manifest


class Command(BaseCommand):
    help = "Rebuild cached ONScripter and bumpercar static asset manifests."

    def add_arguments(self, parser):
        parser.add_argument("--onscripter-only", action="store_true")
        parser.add_argument("--bumpercar-only", action="store_true")
        parser.add_argument("--missing-only", action="store_true")

    def handle(self, *args, **options):
        onscripter_count = 0
        bumpercar_count = 0
        missing_count = 0
        missing_only = bool(options["missing_only"])

        if not options["bumpercar_only"]:
            games = OnscripterGameConfig.objects.filter(enabled=True).order_by("display_order", "slug")
            if missing_only:
                games = games.filter(asset_manifest={})
            for game in games:
                if rebuild_onscripter_game_manifest(game):
                    onscripter_count += 1
                else:
                    missing_count += 1
                    self.stderr.write(f"ONScripter assets unavailable: {game.slug}")

        if not options["onscripter_only"]:
            skins = BumpercarSkin.objects.filter(enabled=True).order_by("display_order", "name")
            if missing_only:
                skins = skins.filter(asset_manifest={})
            for skin in skins:
                rebuild_bumpercar_skin_manifest(skin)
                bumpercar_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                "game manifests rebuilt: "
                f"onscripter={onscripter_count} bumpercar={bumpercar_count} missing={missing_count}"
            )
        )
