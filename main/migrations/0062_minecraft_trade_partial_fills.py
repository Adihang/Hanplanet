from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


def initialize_trade_balances_and_fills(apps, schema_editor):
    Listing = apps.get_model("main", "MinecraftTradeListing")
    Fill = apps.get_model("main", "MinecraftTradeFill")

    for listing in Listing.objects.all().iterator():
        updates = {}
        if listing.status == "open":
            updates["remaining_sell_amount"] = listing.sell_amount
            updates["remaining_price_amount"] = listing.price_amount
        elif listing.status == "completed":
            updates["unclaimed_price_amount"] = listing.price_amount
        elif listing.status == "claimed":
            updates["claimed_price_amount"] = listing.price_amount

        if updates:
            Listing.objects.filter(pk=listing.pk).update(**updates)

        if listing.status in {"completed", "claimed"} and listing.buyer_id:
            Fill.objects.create(
                listing_id=listing.id,
                buyer_id=listing.buyer_id,
                buyer_minecraft_name=listing.buyer_minecraft_name,
                sell_amount=listing.sell_amount,
                price_amount=listing.price_amount,
            )


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("main", "0061_minecrafttradelisting"),
    ]

    operations = [
        migrations.AddField(
            model_name="minecrafttradelisting",
            name="allow_partial",
            field=models.BooleanField(default=False, verbose_name="부분 거래 허용"),
        ),
        migrations.AddField(
            model_name="minecrafttradelisting",
            name="claimed_price_amount",
            field=models.PositiveIntegerField(default=0, verbose_name="수령한 대가 수량"),
        ),
        migrations.AddField(
            model_name="minecrafttradelisting",
            name="remaining_price_amount",
            field=models.PositiveIntegerField(default=0, verbose_name="남은 대가 수량"),
        ),
        migrations.AddField(
            model_name="minecrafttradelisting",
            name="remaining_sell_amount",
            field=models.PositiveIntegerField(default=0, verbose_name="남은 판매 수량"),
        ),
        migrations.AddField(
            model_name="minecrafttradelisting",
            name="unclaimed_price_amount",
            field=models.PositiveIntegerField(default=0, verbose_name="미수령 대가 수량"),
        ),
        migrations.CreateModel(
            name="MinecraftTradeFill",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("buyer_minecraft_name", models.CharField(max_length=32, verbose_name="구매자 Minecraft 닉네임")),
                ("sell_amount", models.PositiveIntegerField(validators=[django.core.validators.MinValueValidator(1)], verbose_name="판매 수량")),
                ("price_amount", models.PositiveIntegerField(validators=[django.core.validators.MinValueValidator(1)], verbose_name="지불 수량")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="구매일")),
                ("buyer", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="minecraft_trade_fill_purchases", to=settings.AUTH_USER_MODEL, verbose_name="구매자")),
                ("listing", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="fills", to="main.minecrafttradelisting", verbose_name="거래글")),
            ],
            options={
                "verbose_name": "Minecraft 거래 체결",
                "verbose_name_plural": "Minecraft 거래 체결",
                "db_table": "main_minecrafttradefill",
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="minecrafttradefill",
            index=models.Index(fields=["listing", "-created_at"], name="main_minecr_listing_423c59_idx"),
        ),
        migrations.AddIndex(
            model_name="minecrafttradefill",
            index=models.Index(fields=["buyer", "-created_at"], name="main_minecr_buyer_i_aac2f3_idx"),
        ),
        migrations.RunPython(initialize_trade_balances_and_fills, migrations.RunPython.noop),
    ]
