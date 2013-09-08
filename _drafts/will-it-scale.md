---
layout: post
title: Will It Scale
author: Author Name
category: blog
tags: cassandra
---

**Outline:** Data model anti pattern (from agoda) where adding more machines does not improve throughput because hot rows (e.g. 4th of july) are only on one set of replicas. 