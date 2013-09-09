---
layout: post
title: IO Settings For Cassandra
author: Author Name
category: blog
tags: cassandra
---

**Outline:** A look at the effect of IO settings when using the same HW

* * Disk journaling and the commit log, does this hurt the pre-allocation and re-use (Ioctl settings) ? 
* The EXT4 setting that pulls dirty pages down from the kernel ? 
* Feeds into the benchmark tool

