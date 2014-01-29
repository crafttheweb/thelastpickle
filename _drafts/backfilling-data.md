---
layout: post
title: Backfilling Data in Bulk
author: Patricia Gorla
category: blog
tags: cassandra, bulk-load
---

// Walk through steps of how to backfill data using our sstable-writer.


1. Why do this?
 - Backfilling 20y of data
 - Running load test against cluster
2. Choosing a data model
 - Thrift or CQL
 - Row composition (long/wide)
 - sstable size
3. Loading into Cassandra
 - Using sstable-loader
3. Running benchmarks
 - Load time
 - Bootstrapping
