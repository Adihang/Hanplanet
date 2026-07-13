from django import forms

from portfolio.models import (
    PortfolioActionButton,
    PortfolioCareer,
    PortfolioCoverLetter,
    PortfolioProfile,
    PortfolioProject,
)


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


class MultipleImageInput(forms.ClearableFileInput):
    allow_multiple_selected = True


class MultipleImageField(forms.ImageField):
    widget = MultipleImageInput

    def clean(self, data, initial=None):
        if not data:
            return []
        files = data if isinstance(data, (list, tuple)) else [data]
        return [super(MultipleImageField, self).clean(file, initial) for file in files if file]


class PortfolioProjectForm(forms.ModelForm):
    project_images = MultipleImageField(
        required=False,
        label="프로젝트 이미지",
        help_text="여러 장을 선택하면 프로젝트 본문 아래 가로 스크롤 이미지 영역에 표시됩니다.",
    )

    class Meta:
        model = PortfolioProject
        fields = [
            "order",
            "title",
            "title_en",
            "banner_img",
            "organization",
            "organization_url",
            "position",
            "project_url_name",
            "project_url",
            "content",
            "content_en",
            "create_date",
            "tags",
            "project_images",
        ]
        widgets = {
            "create_date": forms.DateInput(attrs={"type": "date"}),
        }


class PortfolioActionButtonForm(forms.ModelForm):
    class Meta:
        model = PortfolioActionButton
        fields = ["order", "label", "url", "icon_url"]


class PortfolioCoverLetterForm(forms.ModelForm):
    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user

    class Meta:
        model = PortfolioCoverLetter
        fields = ["company", "name", "content"]

    def clean_company(self):
        company = str(self.cleaned_data.get("company") or "").strip()
        slug = PortfolioCoverLetter.build_slug(company)
        self.instance.slug = slug
        if self.user is not None:
            duplicate_qs = PortfolioCoverLetter.objects.filter(user=self.user, slug=slug)
            if self.instance.pk:
                duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
            if duplicate_qs.exists():
                raise forms.ValidationError("이미 같은 회사명 URL의 자기소개서가 있습니다.")
        return company
