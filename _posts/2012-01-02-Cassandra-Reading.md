---
layout: post
title: Cassandra Reading 02-01-2012
category: blog
tags: cassandra
author: Aaron Morton
---

Recent Cassandra reading. 

## [CQL: SQL In Cassandra](http://www.slideshare.net/jericevans/cql-sql-in-cassandra)

_And a [blog post](http://www.acunu.com/blogs/eric-evans/cql-benchmarking/)_

By Eric Evans

* Good examples of simple statements.
* Performance comparisons show CQL has 5% to 10% lower throughput and higher latency.
* List of drivers and [where](http://code.google.com/a/apache-extras.org/hosting/search?q=label%3ACassandra) to get them.
* More improvements coming.

## [Storm Cassandra Integration](https://github.com/ptgoetz/storm-cassandra)

By P. Taylor Goetz

* A [storm](https://github.com/nathanmarz/storm) bolt to persist data to Cassandra.

## [Cassandra in Online Advertising: Real Time Bidding](http://www.slideshare.net/edwardcapriolo/m6d-cassandrapresentation)

By Edward Capriolo

* 10TB of data and growing.
* Latency requirements of less than 120ms. 
* "Distributed not Duplicated" is a great phrase.
* Ed still loves the Cacti :)
* Good idea to use JMX to modify the (Cassandra) cache settings for a single node to compare against the others.
* Pay attention to how the cache hit rate varies with regard to the cache size, at some point may be better to accept a (say) 90% hit rate and give more memory to another CF.
* Tuning IO performance for peak and off-peak by modifying `nodetool setcompactionlimit` to improve compaction performance.
* Running night time major compactions like Urban Airship. I wonder how leveled compaction would work with the mixed workload?

## [Replication and the latency-consistency tradeoff](http://dbmsmusings.blogspot.com/2011/12/replication-and-latency-consistency.html)

By Daniel Abadi

* A discussion about latency and consistency.
* "there's no way to perform consistent replication across database replicas without some level of synchronous network communication."
* Not sure I agree that in Dynamo / Cassandra (not sure about Riak) "updates generally go to the same node, and are then propagated synchronously to W other nodes (case (2)(c))".
* [I think](http://dbmsmusings.blogspot.com/2011/12/replication-and-latency-consistency.html?showComment=1325454055745#c307358897668058915) how inconsistencies are handled during read requests is another source of latency. 

## [Cassandra for sys admins](http://www.slideshare.net/nmilford/cassandra-for-sysadmins)

By Nathan Milford

* 14 nodes in two DC's
* In productions since Cassandra version 0.4, awesome!
* A good list of things to monitor in a cluster.
* Good best practices for shutting down a node that give the fastest startup, also [see](http://blog.milford.io/2011/11/rolling-upgrades-for-cassandra).


## [Cassandra for LOBS](http://ruby.dzone.com/articles/cassandra-lobs)

By Dan Pritchett

* Expensive SAN storage bombshell.

## [Expedia Hotel Price Cache](http://www.slideshare.net/clibou/seattle-scalability-meetup-10505322/25)

By B. Todd Burruss

* Pre-calculate, trading space for time.
* A rolling window of 2.8 billion data points.
* Test, measure, tune.

## [Data Modeling Examples](http://www.slideshare.net/mattdennis/cassandra-nyc-2011-data-modeling)

By Matthew Dennis

* I always check out Matthew's data model presentations to see what the best practices are.
* "Usually better to keep a record that something happened as opposed to changing a value".
* Good advice on time series and the XACT_LOG.

## [Cassandra In Production: Things We Learned](http://devblog.seomoz.org/2011/11/cassandra-in-production-things-we-learned/)

By Walt Jones

* Using Cassandra 0.7, there are a *lot* of improvements in Cassandra 1.0.
* 12 AWS EC2 m1.xlarge nodes with 5TB of data.
* S3 archive 
* The memory footprint issues has been eliminated in Cassandra 1.0.
* Please avoid using Super Columns.
* Please use the Random Partitioner.

## [Data Modeling with Cassandra](http://www.acunu.com/blogs/sam-overton/cassandra-data-modelling/)

By Sam Overton

* De-normalize for a brighter future. 
* No SQL "Hello World" twitter example.
