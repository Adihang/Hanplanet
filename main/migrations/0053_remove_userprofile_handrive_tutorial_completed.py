from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0052_userprofile_handrive_tutorial_completed"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="userprofile",
            name="handrive_tutorial_completed",
        ),
    ]
