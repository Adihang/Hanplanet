from django.db import migrations


NON_POSITION_VALUES = {"개발팀"}


def clear_team_name_project_positions(apps, schema_editor):
    PortfolioProject = apps.get_model("portfolio", "PortfolioProject")
    PortfolioProject.objects.filter(position__in=NON_POSITION_VALUES).update(position="")


class Migration(migrations.Migration):

    dependencies = [
        ("portfolio", "0006_portfolioproject_affiliation_fields"),
    ]

    operations = [
        migrations.RunPython(clear_team_name_project_positions, migrations.RunPython.noop),
    ]
