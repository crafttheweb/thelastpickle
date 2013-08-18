---
layout: post
title: "The forces of Write and Read"
category: Cassandra
---

Requests that write and read data in Cassandra, like any data base, have competing characteristics that need to be balanced. This post compares the approach taken by Cassandra to traditional Relation Database Systems.

When writing data the most efficient approach to splat it somewhere on disk with the minimum of fuss. Preferably at the end of a file, or even in a new file. The write is going to take longer if the data is carefully placed in the correct ordered position in an existing file.

Problem is reading data is going to be much more efficient if the data is in the correct ordered location, and preferably in just one location. If the data is unordered and spread out in a file, or multiple files, the read is going to take longer.

Traditional Relational databases such as SQL Server are optimised for read requests, so write requests ensure that data is written to the correct ordered location. However the [transaction log / write ahead  log](http://en.wikipedia.org/wiki/Database_log) lets the database delay  writing the data to the correct location on disk, providing a handy performance boost while still supporting [ACID](http://en.wikipedia.org/wiki/ACID) transactions.

## Roughly speaking Write requests

(very) Roughly speaking a write request in a RDBMS follows this path:

1. Append the write request to the end of the transaction log.
2. Locate the rows modified by the request or those adjacent to new rows, by reading index, data or other [pages](http://msdn.microsoft.com/en-us/library/ms190969.aspx) from disk if not already in memory.
3. Modify the index and data pages in memory to insert or update rows.
4. Acknowledge the write to the client.
5. [Checkpoint](http://en.wikipedia.org/wiki/Transaction_checkpoint#Recovery_process) the modified pages by flushing them to disk in the correct ordered location, and mark the log records associated with the changes as no longer needed. The Checkpoint process is typically executed asynchronously ([SQL Server](http://msdn.microsoft.com/en-us/library/ms189573.aspx)  [MySQL](http://dev.mysql.com/doc/refman/5.0/en/innodb-checkpoints.html)).

(I think in reality the log record is written once a statement completes inserting/updating an individual row. Also a record needs to be written to say if the transaction was committed or aborted, so that during log file recovery the system knows if the transaction should be [replayed](http://en.wikipedia.org/wiki/Transaction_processing#Rollforward) or [ignored](http://en.wikipedia.org/wiki/Transaction_processing#Rollback). I'm also ignoring all the locking.)

The write ahead log lets the write request dump the data *somewhere* on disk fast, then work on structures which are *hopefully* in memory. For updates care is taken to check for existing data, which is then read and mutated in memory. The read request ignores the transaction log, it reads the single source of truth from the correctly ordered index and data pages that are hopefully still in memory.

If the RDBMS uses [Multi Version Concurrency Control](http://en.wikipedia.org/wiki/Multiversion_concurrency_control) life is a bit more difficult for the read request, so lets ignore that for now. 

On the other hand Cassandra is optimised for write requests, so read requests need to do more work to ensure they have the correct data.

Again roughly speaking a write request for Cassandra follows the path:

1. Appended the write to the end of the write ahead log. 
2. Modify an in memory structure called a [Memtable](http://wiki.apache.org/cassandra/MemtableSSTable) to store the row changes present in the request.
3. Queue the Memtable to be flushed to disk (in the background) if per Memtable [thresholds](http://wiki.apache.org/cassandra/MemtableThresholds) on operation count, data size or time to be violated. A new empty Memtable is immediately put in it's place.
4. Acknowledge the write to the client.
5. Flush the Memtable to disk by creating a new [SSTable (Sorted String Table)](http://wiki.apache.org/cassandra/ArchitectureSSTable) on disk, and mark the log records as no longer needed. Typically the flush task is executed asynchronously.

(This is the write process on a single node, I'm ignoring how the write is applied to the cluster and other features required for 'Eventual Consistency'.)

Again the write ahead log lets the write process dump the data *somewhere* on disk fast, and then work on structures which are *guaranteed* to be in memory. No effort is taken to read the existing data, if a row was updated it may now partially exist in memory and in multiple SSTables on disk.

It's probably important to point out that the RDBMS Checkpoint process works with an *extent* which defines it's on disk allocation unit. Sql Server uses [extents](http://msdn.microsoft.com/en-us/library/ms190969.aspx) that contain 8 8KB pages. MySQL uses a [default EXTENT_SIZE](http://dev.mysql.com/doc/refman/5.1/en/create-tablespace.html) of 1MB for the extent, and the InnoDB engine has a [hard coded](http://dev.mysql.com/doc/refman/5.0/en/innodb-restrictions.html) 16KB page size. Once one extent has been written it may be necessary to seek to anther random part of the disk to write to next extent. Though I'm sure they do all sorts of clever things to make it nice and fast, this is the basic unit they deal with.

In Cassandra the maximum Memtable size is configured per [Column Family](http://www.datastax.com/docs/0.7/data_model/column_families) (sort of like a table but I dislike that analogy). Memory thresholds of 128MB, 256MB or higher are [common](http://wiki.apache.org/cassandra/MemtableThresholds), though Memtables may flush at lower sizes due violating other thresholds or in response to certain system events. The Flush task is able to write the entire contents of the Memtable to disk as a new file without having to perform random IO seeks.

## Dear Readers 

In Cassandra read requests potentially have a lot more to do that those in a traditional RDBMS. A typical read request in a RDBMS to get a row by Primary Key seeks through the nicely ordered [b-tree](http://en.wikipedia.org/wiki/B_tree) index pages to find the right data page, scans the page to find the appropriate row and reads the complete row (ignoring off page large data). Reading the index and data pages may require disk access, and a [query cache](http://dev.mysql.com/doc/refman/5.1/en/query-cache.html) may provide direct access to the results of a previous query without needing to negotiate the index.

Cassandra has two caches that can expedite a read request, a key cache (discussed below) and a [row cache](http://www.datastax.com/dev/blog/maximizing-cache-benefit-with-cassandra). The row cache contains all the current data for the row, and a query that needs to read any column from the row can be fully resolved by reading the cache.

If the requested row cannot be served from the row cache it must be read from disk, however the write path may have left fragments of the row in various SSTables. The read request follows the path:

1. Check the in memory [Bloom Filter](http://en.wikipedia.org/wiki/Bloom_filter) for each SSTable on disk, to build a list of candidate SSTables where the row *may* exist.
2. If enabled probe the key cache for each candidate SSTable from step 1 to get the position of the row in the data file. The key cache may hold only a sample of keys from the file so misses are possible.
3. If the key cache missed, probe the SSTable index summary held in memory which contains a regular sampling of the keys (and their positions) in the SSTable index file to find the preceding (sampled) key. Seek to the position of the preceding sampled key in the SSTable index file, and then scan the index file until the requested key and it's data file position is found.
4. Seek to the row position in the SSTable data file and then scan the row data to read the columns that match the read request.
5. Reduce (potentially) multiple values for each column provided by each SSTable and the current Memtable to a single value by considering column [timestamps](http://wiki.apache.org/cassandra/API?highlight=%28timestamp%29), Time To Live settings and  [deletes](http://wiki.apache.org/cassandra/DistributedDeletes).
5. Return the result to the client.

(This is the read path on a single node, I'm ignoring how the read is processed by the cluster, features required for 'Eventual Consistency', and have not mentioned that memory mapped file access is used by default on 64 bit platforms.)

The read request must piece together the row from potentially many files, which may each involve random IO. Each SSTable which contains any columns for a row must be read to determine if it contains columns that match the request criteria. Hot rows may be present in present in memory in the form of Cassandra key and row caches or OS caches. 

Rows which receive many writes (including overwriting the same column) over time have the potential to perform worse than those that are written to within a short time span. Multiple writes to the same row and column are reconciled in memory by the Memtable so that only the current values for a row are written to disk in the SSTable. The [Compaction Process](http://wiki.apache.org/cassandra/MemtableSSTable) provides an opposing force to the propensity of write requests to spread data out over multiple files.

With all this going on it's still possible to get millisecond or better read performance. The import thing to note is that it's possible to have poorly performing reads due to spread out rows.

## Compacting for a sustainable future

The [Compaction Process](http://wiki.apache.org/cassandra/MemtableSSTable) is there to help the read requests by reducing the number of SSTables they may have visit. Compaction is also responsible for finalising [Distributed Deletes](http://wiki.apache.org/cassandra/DistributedDeletes) and Time To Live, but I will ignore those for now.

Major Compactions are triggered manually via the [nodetool](http://wiki.apache.org/cassandra/NodeTool) utility and compact all SSTables for a Column Family into one file. Owing to the way compaction chooses which files to process this may result in the new file not been compacted for a very long time. As a result Major compactions are no longer recommended as Minor compactions can do the same things. I've mentioned them here just for completeness. 

Cassandra checks to see if a Minor compaction is needed whenever an SSTable is written to disk. The process groups the files into buckets where every file in a bucket is within 50% of the average size of files in the bucket, small files (less than 50MB) are put in the first bucket. If the bucket contains more than than the Column Family defined min\_compaction\_threshold files the compaction process will compact up to max\_compaction\_threshold files together.

During compaction the row fragments from the SSTables are reconciled to create a single row. When merging columns the one with the highest timestamp is used, if the timestamps are equal the column value is used as a tie breaker. 

The result is a single SSTable that contains an aggregated view of the row that was present in the mulitple input SStables. And a shorter path for any read request that previously needed to potentially read from several SSTables. 

## In motion 

It's reasonably easy to see this process happening in slow motion by constructing a contrived schema in Cassandra and playing with some of the command line tools. 

This schema creates two Column Families. The OneOp CF sets the Memtable to flush to disk after just one operation is written, and FiveOp after 5 operations (`memtable_operations` is expressed in millions of operations). The `min_compaction_threshold` tells compaction to start after we see 4 files. The script then inserts some sample data, all against the same row and the same columns to demonstrate overwrites.

Note that the Memtable thresholds are checked before the operation starts, but it is not flushed to disk until after the operation completes. For writes it counts the each columns in the request as an operation. In our case it means the SSTables will be created with after 2 or 6 operations rather than the expected 1 or 5.

Start the cassandra cli and paste the script into the cli. 

    create keyspace ReadWrite;

    use ReadWrite;

    create column family OneOp 
      with memtable_operations = 0.000001
      and min_compaction_threshold = 4;
    create column family FiveOp 
      with memtable_operations = 0.000005
      and min_compaction_threshold = 4;
  
    set OneOp['foo1']['bar'] = 'baz1';
    set OneOp['foo1']['bar'] = 'baz2';
    set OneOp['foo1']['bar'] = 'baz3';
    set OneOp['foo1']['bar'] = 'baz3';
    set OneOp['foo1']['bar'] = 'baz1';
    set OneOp['foo1']['bar'] = 'baz1';


    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';
    set FiveOp['foo1']['bar'] = 'baz';

The data directory for the ReadWrite keyspace should now look like. 

    /var/lib/cassandra/data/ReadWrite:
    total 200
    drwxr-xr-x  22 aaron  wheel   748B 27 Apr 10:42 .
    drwxr-xr-x   4 aaron  wheel   136B 27 Apr 10:42 ..
    -rw-r--r--   1 aaron  wheel    75B 27 Apr 10:42 FiveOp-f-1-Data.db
    -rw-r--r--   1 aaron  wheel    16B 27 Apr 10:42 FiveOp-f-1-Filter.db
    -rw-r--r--   1 aaron  wheel    14B 27 Apr 10:42 FiveOp-f-1-Index.db
    -rw-r--r--   1 aaron  wheel   4.2K 27 Apr 10:42 FiveOp-f-1-Statistics.db
    -rw-r--r--   1 aaron  wheel    75B 27 Apr 10:42 FiveOp-f-2-Data.db
    -rw-r--r--   1 aaron  wheel    16B 27 Apr 10:42 FiveOp-f-2-Filter.db
    -rw-r--r--   1 aaron  wheel    14B 27 Apr 10:42 FiveOp-f-2-Index.db
    -rw-r--r--   1 aaron  wheel   4.2K 27 Apr 10:42 FiveOp-f-2-Statistics.db
    -rw-r--r--   1 aaron  wheel    76B 27 Apr 10:42 OneOp-f-1-Data.db
    -rw-r--r--   1 aaron  wheel    16B 27 Apr 10:42 OneOp-f-1-Filter.db
    -rw-r--r--   1 aaron  wheel    14B 27 Apr 10:42 OneOp-f-1-Index.db
    -rw-r--r--   1 aaron  wheel   4.2K 27 Apr 10:42 OneOp-f-1-Statistics.db
    -rw-r--r--   1 aaron  wheel    76B 27 Apr 10:42 OneOp-f-2-Data.db
    -rw-r--r--   1 aaron  wheel    16B 27 Apr 10:42 OneOp-f-2-Filter.db
    -rw-r--r--   1 aaron  wheel    14B 27 Apr 10:42 OneOp-f-2-Index.db
    -rw-r--r--   1 aaron  wheel   4.2K 27 Apr 10:42 OneOp-f-2-Statistics.db
    -rw-r--r--   1 aaron  wheel    76B 27 Apr 10:42 OneOp-f-3-Data.db
    -rw-r--r--   1 aaron  wheel    16B 27 Apr 10:42 OneOp-f-3-Filter.db
    -rw-r--r--   1 aaron  wheel    14B 27 Apr 10:42 OneOp-f-3-Index.db
    -rw-r--r--   1 aaron  wheel   4.2K 27 Apr 10:42 OneOp-f-3-Statistics.db

There are 3 SSTables for OneOp and 2 for FiveOp, and all of them contain the a fragment of the 'foo1' row. 

The `nodetool cfhistograms` utility shows recent statistics for requests against a Column Family, where recent means "since the last time it was run". The same statistics are also available via the org.apache.cassandra.db.ColumnFamilies.&lt;keyspace&gt;.&lt;column_family&gt; MBean in JConsole. 

Clear the stats for both Column Families on the command line.
 
    $ bin/nodetool -h localhost cfhistograms ReadWrite OneOp
    $ bin/nodetool -h localhost cfhistograms ReadWrite FiveOp

Now execute two reads via the cli.

    [default@ReadWrite] get OneOp['foo1'];
    => (column=626172, value=62617a31, timestamp=1303875486224000)
    Returned 1 results.
    [default@ReadWrite] get FiveOp['foo1'];
    => (column=626172, value=62617a, timestamp=1303875486248000)
    Returned 1 results.
    [default@ReadWrite] 

Check the stats for the OneOp Column Family.

    $ bin/nodetool -h localhost cfhistograms ReadWrite OneOp
    ReadWrite/OneOp histograms
    Offset      SSTables     Write Latency      Read Latency          Row Size      Column Count
    1                  0                 0                 0                 0                 3
    2                  0                 0                 0                 0                 0
    3                  1                 0                 0                 0                 0
    4                  0                 0                 0                 0                 0

The histogram is saying that 1 request used 3 SSTables, and there are an estimated 3 columns in all the SSTables the Column Family is tracking. The Column Family should be tracking 3 SSTables, and each should have only one column for the 'foo1' row. The insert script overwrote the same column and the Memtable absorbed one overwrite before been flushed to disk.

The stats for the FiveOp Column Family also make sense.

    $ bin/nodetool -h localhost cfhistograms ReadWrite FiveOp
    ReadWrite/FiveOp histograms
    Offset      SSTables     Write Latency      Read Latency          Row Size      Column Count
    1                  0                 0                 0                 0                 2
    2                  1                 0                 0                 0                 0

There are only 2 SSTables for the Column Family, both contain a fragment of the 'foo1' row and both contain only one column.

A minor compaction on the OneOp Column Family can be triggered by adding just two more [wafer thin](http://www.youtube.com/watch?v=rXH_12QWWg8) rows via the cli. 

    [default@ReadWrite] set OneOp['foo1']['bar'] = 'baz1';
    Value inserted.
    [default@ReadWrite] set OneOp['foo1']['bar'] = 'baz2';
    Value inserted.
    [default@ReadWrite]

This should trigger a minor compaction as there is now 4 SSTables of similar size. The data directory should now look something like this.

    $ ls -l /var/lib/cassandra/data/ReadWrite/
    total 280
    -rw-r--r--  1 aaron  wheel    75 27 Apr 15:38 FiveOp-f-1-Data.db
    -rw-r--r--  1 aaron  wheel    16 27 Apr 15:38 FiveOp-f-1-Filter.db
    -rw-r--r--  1 aaron  wheel    14 27 Apr 15:38 FiveOp-f-1-Index.db
    -rw-r--r--  1 aaron  wheel  4264 27 Apr 15:38 FiveOp-f-1-Statistics.db
    -rw-r--r--  1 aaron  wheel    75 27 Apr 15:38 FiveOp-f-2-Data.db
    -rw-r--r--  1 aaron  wheel    16 27 Apr 15:38 FiveOp-f-2-Filter.db
    -rw-r--r--  1 aaron  wheel    14 27 Apr 15:38 FiveOp-f-2-Index.db
    -rw-r--r--  1 aaron  wheel  4264 27 Apr 15:38 FiveOp-f-2-Statistics.db
    -rw-r--r--  1 aaron  wheel     0 27 Apr 16:16 OneOp-f-1-Compacted
    -rw-r--r--  1 aaron  wheel    76 27 Apr 15:38 OneOp-f-1-Data.db
    -rw-r--r--  1 aaron  wheel    16 27 Apr 15:38 OneOp-f-1-Filter.db
    -rw-r--r--  1 aaron  wheel    14 27 Apr 15:38 OneOp-f-1-Index.db
    -rw-r--r--  1 aaron  wheel  4264 27 Apr 15:38 OneOp-f-1-Statistics.db
    -rw-r--r--  1 aaron  wheel     0 27 Apr 16:16 OneOp-f-2-Compacted
    -rw-r--r--  1 aaron  wheel    76 27 Apr 15:38 OneOp-f-2-Data.db
    -rw-r--r--  1 aaron  wheel    16 27 Apr 15:38 OneOp-f-2-Filter.db
    -rw-r--r--  1 aaron  wheel    14 27 Apr 15:38 OneOp-f-2-Index.db
    -rw-r--r--  1 aaron  wheel  4264 27 Apr 15:38 OneOp-f-2-Statistics.db
    -rw-r--r--  1 aaron  wheel     0 27 Apr 16:16 OneOp-f-3-Compacted
    -rw-r--r--  1 aaron  wheel    76 27 Apr 15:38 OneOp-f-3-Data.db
    -rw-r--r--  1 aaron  wheel    16 27 Apr 15:38 OneOp-f-3-Filter.db
    -rw-r--r--  1 aaron  wheel    14 27 Apr 15:38 OneOp-f-3-Index.db
    -rw-r--r--  1 aaron  wheel  4264 27 Apr 15:38 OneOp-f-3-Statistics.db
    -rw-r--r--  1 aaron  wheel     0 27 Apr 16:16 OneOp-f-4-Compacted
    -rw-r--r--  1 aaron  wheel    76 27 Apr 16:16 OneOp-f-4-Data.db
    -rw-r--r--  1 aaron  wheel    16 27 Apr 16:16 OneOp-f-4-Filter.db
    -rw-r--r--  1 aaron  wheel    14 27 Apr 16:16 OneOp-f-4-Index.db
    -rw-r--r--  1 aaron  wheel  4264 27 Apr 16:16 OneOp-f-4-Statistics.db
    -rw-r--r--  1 aaron  wheel    76 27 Apr 16:16 OneOp-f-5-Data.db
    -rw-r--r--  1 aaron  wheel  1936 27 Apr 16:16 OneOp-f-5-Filter.db
    -rw-r--r--  1 aaron  wheel    14 27 Apr 16:16 OneOp-f-5-Index.db
    -rw-r--r--  1 aaron  wheel  4264 27 Apr 16:16 OneOp-f-5-Statistics.db

The SSTables for OneOp numbered 1 through 4 have been compacted, this is tracked in the server and a compacted marker file (e.g. "OneOp-f-4-Compacted") is written to disk to preserve the information across system restarts. The unused files will be physically deleted during [JVM Garbage Collection](http://wiki.apache.org/cassandra/ArchitectureInternals?highlight=%28delete%29). If Cassandra detects it is low on disk space when about to write data to disk, it will trigger GC in an effort to reclaim unused space. 

There is also a new SSTable `OneOp-f-5-Data.db` that contains the single reconciled row from the other 4 SSTables. A read request against that row should now only use one SSTable:

    [default@ReadWrite] get OneOp['foo1'];
    => (column=626172, value=62617a32, timestamp=1303877811057000)
    Returned 1 results.
    [default@ReadWrite] 

Check the stats.

    $ bin/nodetool -h localhost cfhistograms ReadWrite OneOp
    ReadWrite/OneOp histograms
    Offset      SSTables     Write Latency      Read Latency          Row Size      Column Count
    1                  1                 0                 0                 0                 1
    2                  0                 0                 0                 0                 0
    3                  0                 0                 0                 0                 0
    4                  0                 0                 0                 0                 0

The request used one SSTable and the Column Family has only 1 column in all the SSTables it is tracking.
