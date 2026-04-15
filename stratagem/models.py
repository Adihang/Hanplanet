import uuid

from django.db import models

from config.utils import make_new_path


class OrderField(models.PositiveIntegerField):
    def __init__(self, *args, **kwargs):
        kwargs["blank"] = True
        kwargs["null"] = True
        super().__init__(*args, **kwargs)


def upload_stratagem(instance, filename):
    return make_new_path(
        path_ext=filename,
        dirname="uploads/contents/stratagem",
        new_filename=str(uuid.uuid4().hex),
    )


def upload_disciple_icon(instance, filename):
    return make_new_path(
        path_ext=filename,
        dirname="uploads/contents/disciple_icon",
        new_filename=str(uuid.uuid4().hex),
    )


class Stratagem_Class(models.Model):
    gem_class = models.CharField("스트라타잼 분류", max_length=128)

    class Meta:
        db_table = "main_stratagem_class"

    def __str__(self):
        return self.gem_class


class Stratagem(models.Model):
    order = OrderField()
    name = models.CharField("이름", max_length=200)
    icon = models.FileField("아이콘", upload_to=upload_stratagem)
    stratagem_class = models.ManyToManyField(Stratagem_Class, verbose_name="스트라타잼 분류")
    command = models.IntegerField("Command")

    class Meta:
        db_table = "main_stratagem"
        ordering = ["order"]


class Stratagem_Hero_Score(models.Model):
    name = models.CharField("이름", max_length=128)
    score = models.FloatField("점수")

    class Meta:
        db_table = "main_stratagem_hero_score"
        ordering = ["score"]

    def save(self, *args, **kwargs):
        if not self.pk:
            existing_score = Stratagem_Hero_Score.objects.filter(name=self.name).first()
            if existing_score:
                if self.score < existing_score.score:
                    existing_score.score = self.score
                    return existing_score.save(*args, **kwargs)
                return  # 기존 기록이 더 좋으면 덮어쓰지 않음
        super().save(*args, **kwargs)


class Disciple_icon(models.Model):
    name = models.CharField("이름", max_length=200)
    icon = models.FileField("아이콘", upload_to=upload_disciple_icon)

    class Meta:
        db_table = "main_disciple_icon"
