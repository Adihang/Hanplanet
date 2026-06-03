from django import template
from django.template.loader import render_to_string

register = template.Library()


@register.simple_tag(takes_context=True)
def include_trimmed(context, template_name, **kwargs):
    include_context = context.flatten()
    include_context.update(kwargs)
    return str(render_to_string(template_name, include_context)).strip()
