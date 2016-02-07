---
layout: post
title: Dropping columns in Apache Cassandra 3.0
author: Aaron Morton
category: blog
tags: cassandra
---

Someone recently asked me: What happens when I drop a column in CQL? With all the recent changes in the [storage engine](XXX) I took the opportunity to explore the new code. In short, we will continue to read the dropped column from disk until the files are rewritten by compaction or you force Cassandra to rewrite the files.

## The Setup

To see what happens when columns are dropped I started a server using the tip of the Cassandra 3.0 branch and created the following schema using `cqlsh`:

    create keyspace dev WITH replication = {'class':'SimpleStrategy', 'replication_factor':1};

    use dev;

    create table foo (
         foo text primary key,
         bar text,
         baz text
    );

    insert into foo (foo, bar, baz) values ('foo','this is bar', 'this is baz');

I wanted to ensure I was observing what happens when we read from SSTables so the next step was to flush to disk:

    $ nodetool flush

Then confirm I had the expected behaviour: the `foo`, `bar`, and `baz` columns were returned:

    cqlsh:dev> select * from foo;

     foo | bar         | baz
    -----+-------------+-------------
     foo | this is bar | this is baz

Great, now to drop the `baz` column (via `cqlsh`):

    alter table foo
    drop baz;

And confirm the data is not there:

    cqlsh:dev> select * from foo;

     foo | bar
    -----+-------------
     foo | this is bar

    (1 rows)

**Note:** If you restart the node after this point you will hit the issue described in [CASSANDRA-XXXX](). As a work around flush the `system_schema.dropped_columns` table before restarting the node:

```
nodetool flush system_schema dropped_columns
```

## Down (almost) To The Disk

The 3.0 [storage engine](http://www.datastax.com/2015/12/storage-engine-30) is focused on rows. These are managed through the [o.a.c.db.rows.Unfiltered]() interface, and (de)serialised by the [o.a.c.db.rows.UnfilteredSerializer]() class. To get the [o.a.c.db.rows.Row]() from the SSTable a call is made to `UnfilteredSerializer.deserializeRowBody()` which iterates over all the Cell's in the Row. We know which Cells are encoded in the Partition by looking at the [o.a.c.db.SerializationHeader]() and the Row flags. The Row will either have all the Cells encoded in the Partition or a subset, encoded as bit flag. 

Whichever process is used, we sequentially read the Cells for the query from the data stream. This is managed by `UnfilteredSerializer.readSimpleColumn()`:

    private void readSimpleColumn(ColumnDefinition column, DataInputPlus in, SerializationHeader header, SerializationHelper helper, Row.Builder builder, LivenessInfo rowLiveness)
    throws IOException
    {
        if (helper.includes(column))
        {
            Cell cell = Cell.serializer.deserialize(in, rowLiveness, column, header, helper);
            if (!helper.isDropped(cell, false))
                builder.addCell(cell);
        }
        else
        {
            Cell.serializer.skip(in, column, header);
        }
    }

We will read the column if it is required by the CQL query, the call to `helper.includes()` checks this, otherwise we skip the data in the input stream. A query that reads all the cells, such as `select * from foo` above, will return `True` for all the Cells in the Row. Once we have the Cell in memory we then check to see if it was dropped from the Table.

So the answer is, yes in some circumstances we will read dropped Cells from disk. Which may lead you to ask, why ?.

For each unique Column dropped from a Table we keep a timestamp of when the drop occurred ([CFMetaData.DroppedColumn]()):

    // drop timestamp, in microseconds, yet with millisecond granularity
    public final long droppedTime;

Any Cells on disk created before this time were present when the Column was dropped and should not be considered. Any created after, which can only happen if the Column was re-added to the Table, should be.

This says something interesting about the timestamp for Cells, which we will see below.

## Won't Someone Think of The Performance!

Of course the Cells that were on disk before we dropped the Column were read: the on disk files are immutable. Cassandra needs an reason to re-write the SSTables so it can filter out the Cells that represent deleted Columns. There are a few ways to do that, but first we need a way to verify the expected outcome. The `sstable2json` tool was removed ([CASSANDRA-XXX]()) in 3.0, however Al Toby has created a handy tool that fills the gap [sstabletools]().

Using Al's tool we can check the contents of the one SSTable created above, and confirm that as we expect there is a Cell for `baz`:

    $ java -jar target/sstable-tools-3.0.0-SNAPSHOT.jar toJson data/data/dev/foo-e61a4890cd5311e59b10a78b2c43262c/ma-1-big-Data.db 
    [
      {
        "partition" : {
          "key" : [ "foo" ]
        },
        "rows" : [
          {
            "type" : "row",
            "liveness_info" : { "tstamp" : 1454819593731668 },
            "cells" : [
              { "name" : "bar", "value" : "this is bar" },
              { "name" : "baz", "value" : "this is baz" }
            ]
          }
        ]
      }
    ]

A simple way to force a re-write is to run `upgradesstables`:

    bin/nodetool  upgradesstables --include-all-sstables dev foo

And check the new file:

    $ java -jar target/sstable-tools-3.0.0-SNAPSHOT.jar toJson data/data/dev/foo-e61a4890cd5311e59b10a78b2c43262c/ma-2-big-Data.db 
    [
      {
        "partition" : {
          "key" : [ "foo" ]
        },
        "rows" : [
          {
            "type" : "row",
            "liveness_info" : { "tstamp" : 1454819593731668 },
            "cells" : [
              { "name" : "bar", "value" : "this is bar" }
            ]
          }
        ]
      }
    ]

That's great but not very practical. As you would expect though `upgradesstables` uses similar code paths to regular compaction. So that as your data is compacted Cells for dropped Columns will be purged from the disk. This will work well for recent data that is still under active compaction, or when using the Levelled Compaction Strategy where data is more frequently compacted. A different approach may be needed for older data that is no longer compacted. 

## Gardening Duty

To actively purge Cells from disk for a Column you have dropped the first thing you will need to know is when the Column was dropped. This can easily be found via `cqlsh`:

    cqlsh:system_schema> select * from system_schema.dropped_columns;

     keyspace_name | table_name | column_name | dropped_time             | type
    ---------------+------------+-------------+--------------------------+------
               dev |        foo |         baz | 2016-02-07 05:26:10+0000 | text

Then find the SSTables that were created before that date. 

Finally run a user defined compaction on the SSTables using the [CompactionManagerMBean.forceUserDefinedCompaction()]() JMX operation. For example when using [jmxterm]():

    $ jmxterm
    Welcome to JMX terminal. Type "help" for available commands.
    $>open localhost:7199
    #Connection to localhost:7199 is opened
    $>bean org.apache.cassandra.db:type=CompactionManager
    #bean is set to org.apache.cassandra.db:type=CompactionManager
    $>info
    #mbean = org.apache.cassandra.db:type=CompactionManager
    #class name = org.apache.cassandra.db.compaction.CompactionManager
    # attributes
      %0   - CompactionHistory (javax.management.openmbean.TabularData, r)
      %1   - CompactionSummary (java.util.List, r)
      %2   - Compactions (java.util.List, r)
      %3   - CoreCompactorThreads (int, rw)
      %4   - CoreValidationThreads (int, rw)
      %5   - MaximumCompactorThreads (int, rw)
      %6   - MaximumValidatorThreads (int, rw)
    # operations
      %0   - void forceUserDefinedCompaction(java.lang.String p1)
      %1   - void stopCompaction(java.lang.String p1)
      %2   - void stopCompactionById(java.lang.String p1)
    #there's no notifications
    $>run forceUserDefinedCompaction "/Users/aaron/code/apache/cassandra/data/data/dev/foo-13a1d880cd5b11e5a714a1b88fe46d8c/ma-7-big-Data.db"
    #calling operation forceUserDefinedCompaction of mbean org.apache.cassandra.db:type=CompactionManager
    #operation returns: 
    null
    $>

The operation only logs if it cannot find the file, you can follow the progress using `nodetool compactionstats` though. 

## Dropping Columns And Timestamps

Remember the check above to determine if a Cell was created before the Column was dropped? That **only** works if you are using actual time for the timestamp when inserting data. If you do nothing, that is you **do not** use the [TIMESTAMP]() clause of the `INSERT` statement, the timestamp will be set to microseconds with millisecond precision via [ClientState.getTimestamp()](). Remember that phrase from above? 

    // drop timestamp, in microseconds, yet with millisecond granularity

The same scale of value is used when recording information `dropped_columns` table. If you are going to drop Columns from your tables your `TIMESTAMP`'s **must** be microseconds past the epoch. This is mentioned in the documentation for the [ALTER TABLE]() statement, but is worth emphasising. Back in the day we could say "the timestamp is a 64 bit int, which is microseconds past the epoch by convention". Light Weight Transactions had a requirement that it be real time, but that was a special case. It's now a general requirement that Cell timestamps are real time. 