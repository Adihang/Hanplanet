from __future__ import annotations

from django.core.management.base import BaseCommand

from portfolio.models import Career, Hobby, Project


class Command(BaseCommand):
    help = "Delete legacy portfolio rows after migration to Portfolio* models."

    def handle(self, *args, **options):
        deleted_projects = Project.objects.count()
        deleted_careers = Career.objects.count()
        deleted_hobbies = Hobby.objects.count()

        Project.objects.all().delete()
        Career.objects.all().delete()
        Hobby.objects.all().delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"deleted legacy portfolio rows: projects={deleted_projects} careers={deleted_careers} hobbies={deleted_hobbies}"
            )
        )
