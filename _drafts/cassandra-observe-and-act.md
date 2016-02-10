---
layout: post
title: Cassandra - Observe and Act
author: Alain Rodriguez
category: blog
tags: cassandra, operational, configuration, tuning, troubleshooting, monitoring
---

# Introduction

This post aims at presenting you cassandra from an operational perspective, then to give you the tools to monitor your cluster and the key metrics to monitor and will finally go through common issues and how you can detect and fix them.

I will be considering we are using cassandra 2.1 when sharing docs, talking about configuration or using nodetool commands. If you are using a Cassandra version higher than 2.1, you can browse for new features from the github repository: https://github.com/apache/cassandra/blob/trunk/NEWS.txt

I will also consider you know the basics about the architecture (Replication, Consistency Levels, Availibility, …).

# Know your environment

## Configuration files

All the configuration files are located under the same directory. On packaged installs you will find them under /etc/cassandra/, for tarball it will be under the path you choose, path_to_cassandra/conf. In case of doubt, look for a file called “cassandra.yaml”, other files should using the same path:

  find / -name "cassandra.yaml" -type f

Those files are important to know about, as this will leverage your understanding of Cassandra and so your ability to manage your cluster by doing the right choices. I will present you the 3 most important ones for the day to day operations that I will refer to later on.

Datastax gives you a good start point to understand Cassandra configuration: https://docs.datastax.com/en/cassandra/2.1/cassandra/configuration/configTOC.html

Al Tobey also wrote a very complete post about monitoring and tuning in Cassandra 2.1: https://tobert.github.io/pages/als-cassandra-21-tuning-guide.html

Reading about the topic before performing any action (and testing things in dev environments) is often worth it as it will end up saving your time. If you prepare your operations and tuning, you also dramatically reduces the risks and level of stress.

### cassandra-env.sh

This file is the one that contains all the Java options. You will mainly be tuning your heap and GC options in this file.

There is a good tuning guide already about this topic: https://tobert.github.io/pages/als-cassandra-21-tuning-guide.html (go to the part called “The Java Virtual Machine”)

Make sure to have the CASSANDRA_HEAPDUMP_DIR set to a folder where a heap dump (size of your heap) can fit ! This file is very handy to have as it helps with debugging inside the JVM but you want to make sure it does not take all the available space, even if there are a few heap dumps.

More information: https://docs.datastax.com/en/cassandra/2.1/cassandra/configuration/configHeapDump_t.html

### cassandra.yaml

I will refer to this file later on this post as this is the main configuration file for the Cassandra server. Going through it and understand you understand what options are is really worth it.
No need for me to go through the whole file as you can find a good description of this file here: https://docs.datastax.com/en/cassandra/2.1/cassandra/configuration/configCassandra_yaml_r.html

### logback.xml

This file is responsible for the logging configuration. Since Cassandra 2.1, Logback is the default logging system for Cassandra (replacing log4j).

More information: https://docs.datastax.com/en/cassandra/2.1/cassandra/configuration/configLoggingLevels_r.html

You will probably need to turn debug or tracing logging on at some point. Nate’s blog about changing logging levels during the runtime (without restarting) and understanding the output:
TODO: add link blogpost Nate.

## Logs

Logs are often located in /var/log/cassandra (packaged installs at least). It is important for you to know where logs are and to be able to read them. If you are unsure, you can find logs location by using:

  find / -name "system.log" -type f | grep cassandra

The main log file is system.log The line <file>/var/log/cassandra/system.log</file> from logback.xml (configuration file) gives you the information on where your logs are stored and allows you to update this location.

A log line look like this:

  WARN  [SharedPool-Worker-5] 2016-02-09 16:16:40,917 SliceQueryFilter.java:319 - Read 2 live and 1968 tombstone cells in tmo_my_account.events for key: cellularphone.w5S0D-0jD85QTr-ohSXKCu9aH7vA81IG3YulzOO0UNc=:20160126 (see tombstone_warn_threshold). 500 columns were requested, slices=[-]
  INFO  [NativePoolCleaner] 2016-02-09 16:16:50,281 ColumnFamilyStore.java:1197 - Flushing largest CFS(Keyspace='tmo_my_account', ColumnFamily='events') to free up room. Used total: 0.10/0.33, live: 0.10/0.33, flushing: 0.00/0.00, this: 0.05/0.05

First information in a log line is the error level. Logs TRACE and DEBUG are for development or debugging purposes, you should only enable those levels for short periods when you are trying to understand a behavior or dig an issue. INFO, WARN and ERROR error messages are enabled by default and relate

TODO: missing part

## Data

# Observing

## Command Lines

- nodetool based
  - nodetool status
  - nodetool tpstats
  - nodetool info
  - nodetool cfstats / tablestats
  - nodetool cfhistograms / tablehistograms
  - nodetool proxyhistograms
  - ...
- system tools
  - ps aux | grep cassandra
  - iftop
  - iostats -mx 5 100
  - htop / top
  - dstat -lrvn 10
  - netstat -tnap
  - lsof -i -P
  - ...

## Visual charts organized within Dashboards

### Existing commercial dashboard solutions

### Existing opensource dashboard solutions

# Alerting

## Existing alerting solutions

## Where should I set alerts
Where should I put triggers, what should be the thresholds, etc

## What should be the thresholds triggering alerts ?

# Acting

## Starting / Stopping Cassandra

soft stop - disable protocols and drain
with service
killing java / nodetool stopdaemon

## Commonly used commands

- System tools
  - ...
- Nodetool commands
  - ...

# Troubleshooting

## Frequent issues and workaround

### The OODA loop, a good method for operational purposes

### Node is down

Some possible reasons (not exhaustive):
- JVM / Heap issue
- Corrupted sstables / Disk error (policy stop)
- Server is no longer accessible at all (AWS terminated)
- Someone else stopped the node

Troubleshooting process:

### Bootstrap failed

Some possible reasons (not exhaustive):
- Network issue (one node no longer reachable)
- Wrong configutations
  - auto_bootstrap set to false
  - wrong cluster name, seeds, ...
- Permission issue

Troubleshooting process:

### Latency spike / high latencies

Is it really coming from Cassandra, what should I check to be sure?
Any massive GC?
sstable hit per read ? sstable count / compactionstats / cfstats
Load (CPU), disk utilization ?

Optimising: Performance

First, what do I want to optimise and why ?


# Getting some Help ?

## Community support

## Commercial support
