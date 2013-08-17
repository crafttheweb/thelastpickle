---
layout: page
title: Previously
---

<h1>By Topic</h1>
<ul class="horizontal clearfix">  
    {% for category in site.categories %}
        <li><a href="/{{ site.category_dir }}/{{ category[0] }}">
            {{ category[0] }}
        </a></li>
    {% endfor %}
</ul>

<h1>By Date</h1>
{% for post in site.posts %}
  {{ post.date | date: "%b %d, %Y" }} - <a href="{{ post.url }}">{{ post.title }}</a>
{% endfor %}
