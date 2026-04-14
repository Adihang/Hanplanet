from django.conf import settings
from django.db import models


class AITokenUsage(models.Model):
    """AI API 호출당 토큰 사용 기록."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_token_usage",
        verbose_name="사용자",
    )
    model_name = models.CharField("모델", max_length=100)
    prompt_tokens = models.PositiveIntegerField("입력 토큰", default=0)
    completion_tokens = models.PositiveIntegerField("출력 토큰", default=0)
    total_tokens = models.PositiveIntegerField("합계 토큰", default=0)
    is_stream = models.BooleanField("스트리밍", default=False)
    created_at = models.DateTimeField("요청 시각", auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "AI 토큰 사용 기록"
        verbose_name_plural = "AI 토큰 사용 기록"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} / {self.model_name} / {self.total_tokens} tokens @ {self.created_at:%Y-%m-%d %H:%M}"
