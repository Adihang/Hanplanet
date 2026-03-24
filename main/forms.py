from django import forms

from portfolio.models import PortfolioActionButton, PortfolioCareer, PortfolioProfile, PortfolioProject


class PortfolioProfileForm(forms.ModelForm):
    class Meta:
        model = PortfolioProfile
        fields = [
            "profile_img",
            "main_title",
            "main_title_en",
            "phone",
            "email",
            "main_subtitle",
            "main_subtitle_en",
        ]


class PortfolioCareerForm(forms.ModelForm):
    class Meta:
        model = PortfolioCareer
        fields = [
            "order",
            "company",
            "company_en",
            "position",
            "content",
            "content_en",
            "join_date",
            "leave_date",
        ]
        widgets = {
            "join_date": forms.DateInput(attrs={"type": "date"}),
            "leave_date": forms.DateInput(attrs={"type": "date"}),
        }


class PortfolioProjectForm(forms.ModelForm):
    class Meta:
        model = PortfolioProject
        fields = [
            "order",
            "title",
            "title_en",
            "banner_img",
            "content",
            "content_en",
            "create_date",
            "tags",
        ]
        widgets = {
            "create_date": forms.DateInput(attrs={"type": "date"}),
        }


class PortfolioActionButtonForm(forms.ModelForm):
    class Meta:
        model = PortfolioActionButton
        fields = ["order", "label", "url", "icon_url"]
