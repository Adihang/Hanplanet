from django.db import migrations


class Migration(migrations.Migration):
    """
    portfolio, stratagem, git 앱으로 이동된 모델들을 main 상태에서 제거.
    DB 테이블은 그대로 유지 (db_table 메타로 원래 이름 사용).
    """

    dependencies = [
        ("main", "0033_handrive_user_quota"),
        ("portfolio", "0001_initial"),
        ("stratagem", "0001_initial"),
        ("git", "0001_initial"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                # Portfolio 앱으로 이동 — 의존성 역순으로 삭제
                migrations.DeleteModel(name="Project_Comment"),
                migrations.DeleteModel(name="PortfolioProject"),
                migrations.DeleteModel(name="PortfolioActionButton"),
                migrations.DeleteModel(name="PortfolioCareer"),
                migrations.DeleteModel(name="PortfolioProfile"),
                migrations.DeleteModel(name="Project"),
                migrations.DeleteModel(name="Project_Tag"),
                migrations.DeleteModel(name="Career"),
                migrations.DeleteModel(name="Hobby"),
                # Stratagem 앱으로 이동
                migrations.DeleteModel(name="Stratagem"),
                migrations.DeleteModel(name="Stratagem_Hero_Score"),
                migrations.DeleteModel(name="Disciple_icon"),
                migrations.DeleteModel(name="Stratagem_Class"),
                # Git 앱으로 이동
                migrations.DeleteModel(name="GitCollaborator"),
                migrations.DeleteModel(name="GitDeviceCode"),
                migrations.DeleteModel(name="GitRepository"),
                migrations.DeleteModel(name="GitUserMapping"),
            ],
            database_operations=[],
        ),
    ]
