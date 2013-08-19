---
layout: post
title: How are Memtables measured?
category: blog
tags: cassandra
author: Aaron Morton
---

**Updated:** I've added information on the new `memtable_total_space_in_mb` setting in version 0.8 and improved the information about `memtable_throughput`. Thanks for the feedback.

In version 0.7 of Cassandra there are 3 configuration settings that can trigger flushing a memtable to disk. Version 0.8 adds support for a global `memtable_total_space_in_mb` which may replace the previous 3 settings. 

First the 0.7 settings. 

## memtable\_flush\_after (minutes)

This is the maximum number of minutes a memtable should stay in memory for if it has received writes. When the memtable is created the current time is recorded which is then checked every 10 seconds. If after the time span either the primary memtable for the Column Family or any secondary index memtables have received writes they are replaced and flushed to disk. 

Unfortunately as the [wiki](http://wiki.apache.org/cassandra/StorageConfiguration) points out, there is a good reason to make this value small and a good reason to make it large.

A log file cannot be deleted until all of the segments / records it contains have been marked as completed. This [happens](http://thelastpickle.com/2011/04/28/Forces-of-Write-and-Read/) when a memtable is flushed to disk. Because the log file is shared by all Column Familes, one Column Family that has long living memtables can prevent log files from been deleted and their disk space freed up. 

However smaller values can cause multiple memtables to expire at the same time, prior to version 0.7 this could cause flush requests to block. Version 0.7 added  [memtable\_flush\_writers](https://issues.apache.org/jira/browse/CASSANDRA-1099) and [memtable\_flush\_queue\_size](https://issues.apache.org/jira/browse/CASSANDRA-2333) ,but it can still slow down the IO system (see conf/cassandra.yaml for more info). The best approach is to tune the other memtable thresholds to trigger when you want them, and leave this setting as a backup.

The wiki recommends setting a default of 1440 minutes, or 24 hours which is also the default. 

## memtable\_operations (millions)

The Memtable tracks the number of operations applied to it by:

*   counting the number of top level columns (i.e. Columns for a Standard CF or Super Columns for a Super CF) in a mutation.
*   considering a row level deletion as a single operation.

Deletions and Insertions are both considered a `mutation`, inserting 3 columns increases the count by 3 and deleting 3 named columns increases the count by 3. Note that the number of sub columns in a Super Column is ignored. So inserting 10 sub columns into 1 super column increases the count by one, and deleting a super column by name that has 10 sub column increases the count by one. 

The operations threshold (and the size threshold) is checked before applying a mutation and the flush is not requested until after the mutation has completed. So it's possible for the memtable to contain more than `memtable_operations` when it is flushed to disk. 

A different way to think about this setting, and `memtable_throughput`, is as `sstable_min_operations` and `sstable_min_bytes`. In general operation new sstables are created after at least `sstable_min_operations` operations have occurred or at most `sstable_min_bytes` bytes will be written.

If no value is provided when the CF is created it is set to the default memtable throughput in MB (below) / 64 * 0.3, so it's 300k ops per 64MB of throughput. If you have a CF that contains many small columns it's a good idea to look at the log entries for memtable flushes to see if the ops threshold is triggering early and causing small memtables to be frequently written.

## memtable_throughput

Throughput for the memtable is tracked and tested at the same time as the operation count. But counting the byte size of the data is more involved and depends on the type of the column. The size of the data when serialised to disk is counted as follows:

*   standard column byte size is
    * length of the key byte array plus 2 bytes to store the length
    * 1 byte to indicate if the column has been deleted
    * 8 bytes for the timestamp
    * length of the value byte array plus 4 bytes to store the length
*   expiring columns (those with a TTL) add another 8 bytes to the length of a standard column.
*   deleted columns (tombstones) are the same as standard columns but the value is always 4 bytes long.
*   counter columns (in Cassandra v0.8) add another 8 bytes to the length of a standard column. Note that for a counter column the value will always be an 8 byte long.
*   super columns sum the size of all contained columns and then add
    *   length of the name byte array plus 2 bytes to store the length
    *   4 bytes to indicate when it was deleted 
    *   8 bytes to store the timestamp for the deletion
    *   4 bytes to store the number of sub columns

(Currently the calculation for the super column only includes the sum of the sub columns. I think this needs to be changed.)

A row deletion will add zero bytes to the throughput counter.

The byte size of the mutation is always added to the counter, if one mutation replaces columns in the memtable their byte size *is not* subtracted from the counter. 

Getting this setting wrong is a very easy way to run out of memory. From version 0.7 onwards the worse case scenario is up to CF Count + Secondary Index Count + `memtable_flush_queue_size` (defaults to 4) + `memtable_flush_writers` (defaults to 1 per data directory) memtables in memory the JVM at once. It's best to be conservative, follow the [wiki advice](http://wiki.apache.org/cassandra/MemtableThresholds) and consider that the JVM may take up to 10 times as much memory as it takes to serialise the data to disk. 

And that's the problem with this threshold. It's **not** measuring how much memory a memtable is using in the JVM Heap, it's measuring the  maximum amount of bytes it could take to serialise the data (excluding the index and bloom filter) to disk. Which makes it a difficult knob to use when tuning how much memory Cassandra uses.

If a value is not provided when the Column Family is created it will default to 1/16th the maximum size of the JVM Heap at the time. This value stored with the Column Family meta data and will not change again. Typical values are around 128MB to 256MB. 

## memtable_total_space_in_mb

Version 0.8 [adds](https://issues.apache.org/jira/browse/CASSANDRA-2006) the per node `memtable_total_space_in_mb` setting which makes life easier and may eventually [replace](https://issues.apache.org/jira/browse/CASSANDRA-2449) the 3 previous settings. While it's fun to play with the per CF settings, it can also be a pain when building real systems that need to stay up. 

If no value is set in `conf/cassandra.yaml` the setting will default to one third of the JVM max Heap size. If it is set to zero the setting is disabled and only the old per CF thresholds will be used. If the global setting is enabled and there are per CF settings **both** of them will be used.

There are two parts to the global memtable size, measuring the real memory usage of the memtable and flushing. First the measuring.

Rather than track every byte allocated the server periodically works out the ratio between the throughput as measured above and the real in memory bytes as measured by JVM. The in memory byte count is worked out using the [Instrumentation Java Package](http://download.oracle.com/javase/6/docs/api/java/lang/instrument/package-summary.html) and code from [Jonathan Ellis](https://github.com/jbellis/jamm). After a mutation has been applied to the memtable, but before a flush is requested, Cassandra calculates the "Live Ratio" if more than twice as many operations (as calculated above) have been processed since the last time it was calculated. 

Measuring the Live Ratio is done asynchronously and involves measuring the real memory size of all the keys, super columns and columns in the memtable and dividing it by the throughput as measured above. For sanity the ratio is clamped between 1.0 and 64.0, if the value is outside of this range a `WARN` level log message will let you know. Finally the ratio for the Column Family is updated to the new ratio if and only if the new ratio is higher than the previous one. An `INFO` level message will let you know when the ratio is calculated, how long it took and if it changed. 

Next the `MeteredFlusher` runs every second and uses a two phase approach to keeping the live memory use under the setting. First it looks at the total live bytes for each Column Family, including it's secondary indexes, and flushes CF's that could potentially fill the memory if [allowed to create](https://issues.apache.org/jira/browse/CASSANDRA-2006?focusedCommentId=13010860&page=com.atlassian.jira.plugin.system.issuetabpanels:comment-tabpanel#comment-13010860) memtables of this size. Live bytes are calculated by multiplying the throughput as perviously measured by the Live Ratio. The Flusher considers the Column Family to be using too much memory if it's current live size is more than `memtable_total_space_in_mb` divided by the maximum number of memtables the Column Family could have in memory. The calculation for this is similar to the one presented above for `memtable_throughput` but it includes secondary indexes and a fudge factor that takes into account how the live size is measured.

For example if `memtable_total_space_in_mb` is 100MB, and  `memtable_flush_writers` is the default 1 (with one data directory), and  `memtable_flush_queue_size` is the default 4, and a Column Family has no secondary indexes. The CF will not be allowed to get above one seventh of 100MB or 14MB, as if the CF filled the flush pipeline with 7 memtables of this size it would take 98MB. At a more sensible 2GB for `memtable_total_space_in_mb` (1/3 of a 6GB JVM Heap) the CF will be flushed if it is using 292MB of live memory.

(I've skipped a couple of things here such as considering the bytes currently been flushed.)

The flusher process will end there if the number of bytes that were flushing when it started plus the bytes for all the CF's that were not flushed in the first phase is less than `memtable_total_space_in_mb`. 

The second phase flushes the CF's in order of largest to smallest until the total live size (including the bytes currently been flushed) gets down below the target setting.

This new setting (and the existing `flush_largest_memtables_at`) should make it harder to shot yourself in the foot with memory management and easier for new users to feel comfortable with the server.

## In Motion 

You can check the per CF thresholds as well as the current tracked values for a memtable using `bin/nodetool`, `bin/cassandra-cli` or JConsole. I'm not aware of any current features to check the `Live Ratio` or `Live Size` of a CF.

`bin/nodetool cfstats` can tell you the current operation count ('Memtable Columns Count') and throughput ('Memtable Data Size'):

    $ ./bin/nodetool -h localhost cfstats
    Keyspace: dev
        Read Count: 1
        Read Latency: 0.897 ms.
        Write Count: 2
        Write Latency: 0.051 ms.
        Pending Tasks: 0
            Column Family: data
            SSTable count: 2
            Space used (live): 9530
            Space used (total): 9530
            Memtable Columns Count: 1
            Memtable Data Size: 26
            Memtable Switch Count: 1
            Read Count: 1
            Read Latency: 0.897 ms.
            Write Count: 2
            Write Latency: 0.020 ms.
            Pending Tasks: 0
            Key cache capacity: 200000
            Key cache size: 2
            Key cache hit rate: 0.0
            Row cache: disabled
            Compacted row minimum size: 51
            Compacted row maximum size: 86
            Compacted row mean size: 73

'bin/cassandra-cli' can tell you the current thresholds using either `describe keyspace` or `show keyspaces`.

    [default@dev] describe keyspace;
    Keyspace: dev:
      Replication Strategy: org.apache.cassandra.locator.NetworkTopologyStrategy
        Options: [datacenter1:2]
      Column Families:
        ColumnFamily: data
          Key Validation Class: org.apache.cassandra.db.marshal.BytesType
          Default column value validator: org.apache.cassandra.db.marshal.BytesType
          Columns sorted by: org.apache.cassandra.db.marshal.AsciiType
          Row cache size / save period in seconds: 0.0/0
          Key cache size / save period in seconds: 200000.0/14400
          Memtable thresholds: 0.29062499999999997/62/1440 (millions of ops/MB/minutes)

Or using JConsole connect to the server, select MBeans and then navigate to org.apacge.cassandra.db.ColumnFamilies.&lt;your-keyspace&gt;.&lt;your-column-family&gt;. There you can find the current thresholds:

* MemtableFlushAfterMins
* MemtableOperationsInMillions
* MemtableThroughputInMB

And the running values:

* MemtableColumnCount
* MemtableDataSize
