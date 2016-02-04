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

The 3.0 [storage engine](http://www.datastax.com/2015/12/storage-engine-30) is focused on rows. These are managed through the [o.a.c.db.rows.Unfiltered]() interface, and (de)serialised by the [o.a.c.db.rows.UnfilteredSerializer]() class. To get the [o.a.c.db.rows.Row]() from the SSTable a call is made to `UnfilteredSerializer.deserializeRowBody` which iterates over all the `Cell`'s in the Row. We know which Cells are encoded in the Partition by looking at the [o.a.c.db.SerializationHeader]() and the Row flags. The Row will either have all the Cells encoded in the Partition or a subset, encoded as bit flag. 

Whichever process is used, we sequentially read the Cells for the query from the data stream. This is managed by `UnfilteredSerializer.readSimpleColumn`:

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

We will read the column if it is required by the CQL query, the call to `helper.includes` checks this, otherwise we skip the data in the input stream. A query that reads all the cells, such as `select * from foo` above, will return `True` for all the Cells in the Row. Once we have the Cell in memory we then check to see if it was dropped from the Table.

So the answer is, if you drop a Column from a Table some reads will read the dropped Cell from disk. Which may lead you to ask, why ?.

For each unique Column dropped from a Table we keep a timestamp of when the drop occurred:

        // drop timestamp, in microseconds, yet with millisecond granularity
        public final long droppedTime;

Any Cells on disk created before this time were present when the Column was dropped and should not be considered. Any created after, which can only happen if the Column was added to the Table, should be.

