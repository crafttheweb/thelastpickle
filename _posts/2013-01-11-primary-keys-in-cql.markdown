---
layout: post
title: "PRIMARY KEY's in CQL"
category: Cassandra
tags: cassandra
author: Aaron Morton
---

The final version of [CQL 3](https://github.com/apache/cassandra/blob/cassandra-1.2/doc/cql3/CQL.textile "Cassandra Query Language (CQL) v3.0.0") that ships with Cassandra v1.2 adds some new features to the `PRIMARY KEY` clause. It overloads the concept in ways that differ from the standard [SQL](http://en.wikipedia.org/wiki/Primary_key) definition, and in some places shares ideas with [Hive](http://hive.apache.org/docs/r0.9.0/language_manual/data-manipulation-statements.html). But from a Cassandra point of view it allows for the same flexibility as the Thrift API.

## Schema, Schema, Every Where

There are two ways to specify the primary key in the [CREATE TABLE](http://www.datastax.com/docs/1.2/cql_cli/cql/CREATE_TABLE) statement. It can be specified in line.

    create table foo (
        bar     int PRIMARY KEY, 
        baz     int
    );

Or it can be specified as a separate clause, which is the method we will be using.

    create table foo (
        bar     int, 
        baz     int,
        PRIMARY KEY (bar)
    );

The definition of the `PRIMARY KEY` clause in the [spec](https://github.com/apache/cassandra/blob/cassandra-1.2/doc/cql3/CQL.textile) can appear confusing at first. 

    PRIMARY KEY '(' <partition-key> ( ',' <identifier> )* ')'

However the comments further down the tell us all we need to know.

> In CQL, the order in which columns are defined for the PRIMARY KEY matters. The first column of the key is called the partition key. It has the property that all the rows sharing the same partition key (even across table in fact) are stored on the same physical node. Also, insertion/update/deletion on rows sharing the same partition key for a given table are performed atomically and in isolation. Note that it is possible to have a composite partition key, i.e. a partition key formed of multiple columns, using an extra set of parentheses to define which columns forms the partition key.

So lets get started. 

## The Setup

In the examples below I used a 3 node local cluster created with the [ccm](https://github.com/pcmanus/ccm) tool from Sylvain Lebresne. Before starting the cluster I brought up 2 additional network interfaces for the nodes to bind to.

    $ sudo ifconfig lo0 alias 127.0.0.2 up
    $ sudo ifconfig lo0 alias 127.0.0.3 up

I could then start a 3 node cluster using version 1.2.0 from the ccm directory.

    $ ccm create dev -v 1.2.0
    Current cluster is now: dev
    $ ccm populate -n 3
    $ ccm start

Checked everything was as expected.

    $ ccm node1 ring
    Note: Ownership information does not include topology; for complete information, specify a keyspace

    Datacenter: datacenter1
    ==========
    Address         Rack        Status State   Load            Owns                Token                                       
                                                                                   3074457345618258602                         
    127.0.0.1       rack1       Up     Normal  24.88 KB        33.33%              -9223372036854775808                        
    127.0.0.2       rack1       Up     Normal  24.89 KB        33.33%              -3074457345618258603                        
    127.0.0.3       rack1       Up     Normal  15.54 KB        33.33%              3074457345618258602  

Then I started a `cqlsh` (in `bin/` of the standard distribution) session against node 1. 

    $ bin/cqlsh 127.0.0.1
    Connected to dev at 127.0.0.1:9160.
    [cqlsh 2.3.0 | Cassandra 1.2.0-SNAPSHOT | CQL spec 3.0.0 | Thrift protocol 19.35.0]
    Use HELP for help.
    cqlsh> 

And created a Keyspace with RF 1.

    cqlsh> create keyspace dev 
       ... WITH replication = {'class':'SimpleStrategy', 'replication_factor':1};
    cqlsh> use dev;
    cqlsh:dev> 


## The Sound of One Column Indexing

Cassandra 1.2 [allows](https://issues.apache.org/jira/browse/CASSANDRA-4361 "[CASSANDRA-4361] CQL3: allow definition with only a PK") tables to be defined with one column that is also the `PRIMARY KEY`. If you've used Cassandra before this may sound muy loco as internally a row without columns is purged during compaction. This allows rows that only contain [ExpiringColumns](https://github.com/apache/cassandra/blob/cassandra-1.2/src/java/org/apache/cassandra/db/ExpiringColumn.java) to be automatically removed.  If you wanted a row without any columns you would need a place holder column, and this pretty much what CQL 3 does.

My one column table looked like this.

    CREATE TABLE device (
      device_id int,
      PRIMARY KEY (device_id)
    );

I then put three rows in it.

    INSERT INTO device 
    (device_id)
    values
    (1);
    INSERT INTO device 
    (device_id)
    values
    (2);
    INSERT INTO device 
    (device_id)
    values
    (3);

In `cqlsh` this all looked sane.

    cqlsh:dev> select * from device;

     device_id
    -----------
             1
             2
             3 

Jumping over to the old fashioned `cassandra-cli` we can see the place holder columns.

    $ bin/cassandra-cli -h 127.0.0.1
    Connected to: "dev" on 127.0.0.1/9160
    Welcome to Cassandra CLI version 1.2.0

    Type 'help;' or '?' for help.
    Type 'quit;' or 'exit;' to quit.

    [default@unknown] use dev;
    Authenticated to keyspace: dev
    [default@dev] list device;
    Using default limit of 100
    Using default column limit of 100
    -------------------
    RowKey: 1
    => (column=, value=, timestamp=1357864824406000)
    -------------------
    RowKey: 2
    => (column=, value=, timestamp=1357864824413000)
    -------------------
    RowKey: 3
    => (column=, value=, timestamp=1357864825075000)

    3 Rows Returned.
    Elapsed time: 49 msec(s).

## Partitioning and Clustering

The PRIMARY KEY definition is made up of two parts: the _Partition Key_ and the _Clustering Columns_. The first part maps to the storage engine row key, while the second is used to group columns in a row. In the storage engine the columns are grouped by prefixing their name with the value of the clustering columns. This is a standard design pattern when using the Thrift API. But now CQL takes care of transposing the clustering column values to and from the non key fields in the table. 

My table with both a partitioning key and clustering columns looked like this.

    CREATE TABLE device_check (
      device_id   int,
      checked_at  timestamp, 
      is_power    boolean, 
      is_locked   boolean,
      PRIMARY KEY (device_id, checked_at)
    );

The partitioning key is the `device_id` and the clustering column is `checked_at`. The specification allows for more than one clustering column, I just chose one here. It also allows for multiple partitioning key columns as we will see later. 

To see what these keys do I inserted some data. As before there are three devices in the example and each one is checked once a month to see if it is locked and powered.

    INSERT INTO device_check
      (device_id, checked_at, is_power, is_locked)
    values
      (1, '2013-01-01T09:00+1300', true, true)
    ;
    INSERT INTO device_check
      (device_id, checked_at, is_power, is_locked)
    values
      (2, '2013-01-01T09:10+1300', true, true)
    ;
    INSERT INTO device_check
      (device_id, checked_at, is_power, is_locked)
    values
      (3, '2013-01-01T09:10+1300', true, false)
    ;
    INSERT INTO device_check
      (device_id, checked_at, is_power, is_locked)
    values
      (1, '2013-02-01T09:00+1300', true, false)
    ;
    INSERT INTO device_check
      (device_id, checked_at, is_power, is_locked)
    values
      (2, '2013-02-01T09:10+1300', true, false)
    ;
    INSERT INTO device_check
      (device_id, checked_at, is_power, is_locked)
    values
      (3, '2013-02-01T09:10+1300', true, true)
    ;

Poking around in `cqlsh` everything looks as expected.

    cqlsh:dev> select * from device_check;

     device_id | checked_at               | is_locked | is_power
    -----------+--------------------------+-----------+----------
             1 | 2013-01-01 09:00:00+1300 |      True |     True
             1 | 2013-02-01 09:00:00+1300 |     False |     True
             2 | 2013-01-01 09:10:00+1300 |      True |     True
             2 | 2013-02-01 09:10:00+1300 |     False |     True
             3 | 2013-01-01 09:10:00+1300 |     False |     True
             3 | 2013-02-01 09:10:00+1300 |      True |     True
    cqlsh:dev> select * from device_check where device_id = 1;

     device_id | checked_at               | is_locked | is_power
    -----------+--------------------------+-----------+----------
             1 | 2013-01-01 09:00:00+1300 |      True |     True
             1 | 2013-02-01 09:00:00+1300 |     False |     True             

So back to the `cassandra-cli` we go to see what's happening with the clustering columns for device 1. 

    [default@dev] get device_check[1];
    => (column=2013-01-01 09\:00\:00+1300:, value=, timestamp=1357866010549000)
    => (column=2013-01-01 09\:00\:00+1300:is_locked, value=01, timestamp=1357866010549000)
    => (column=2013-01-01 09\:00\:00+1300:is_power, value=01, timestamp=1357866010549000)
    => (column=2013-02-01 09\:00\:00+1300:, value=, timestamp=1357866056217000)
    => (column=2013-02-01 09\:00\:00+1300:is_locked, value=00, timestamp=1357866056217000)
    => (column=2013-02-01 09\:00\:00+1300:is_power, value=01, timestamp=1357866056217000)
    Returned 6 results.
    Elapsed time: 38 msec(s).

Where we had two rows in `cqlsh` we now have one row with six columns in `cassandra-cli` which uses the Thrift API. CQL is mapping multiple instances of our entity (the `device_check`) to the same partition, and the partition is identified by the value of `device_id`. And you can probably guess that the partition is implemented as a row in the storage engine. The column names look a little strange, and technically I should not call them columns. In the current Cassandra lexicon the internal storage engine columns are called _Cells_, Columns are used for CQL. The first cell / storage column has the value of the first `checked_at` CQL column as it's name _2013-01-01 09:00:00+1300:_. The ':' indicates there are multiple components to this cell name, however this cell does not supply values for all parts. The cell does not have a value as the CQL column value is stored in the cell name. The second cell has a value for `checked_at` and the name of the first none primary key column `is_locked` _2013-01-01 09:00:00+1300:is_locked_. In this case the cell value is the value for the `is_locked` CQL column. This pattern continues for the second CQL row, with `checked_at` equal to `2013-02-01 09:00:00+1300`, and it will continue for all entities in this partition.

Now to take a look at the effect of the partition key on data placement. My expectation is that each unique `device_id` value, and so each partition, will be stored on a different node. In reality the storage engine rows are randomly distributed between nodes so I've adjusted my expectations appropriately. I also expect that each row will be replicated once, as I set the `replication_factor` to one. 

To see the node a row is stored on we use the `nodetool getendpoints` command. It returns the replicas for a (storage engine) row key in a given Keyspace and Column Family.  

    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev device_check 1
    127.0.0.2
    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev device_check 2
    127.0.0.2
    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev device_check 3
    127.0.0.1

That's close enough for me. Different partitions, identified by different `device_id` values, are stored on different nodes.

## The Composite Enchilada

Now lets expand the partition key to use a [composite type](https://issues.apache.org/jira/browse/CASSANDRA-4179 "[CASSANDRA-3761] Add more general support for composites (to row key, column value)"). This is useful when you have a time series and you need to partition the events to avoid huge rows. Rather than have one partition based on, in my example, the `device_id` I can have several where `device_id` is a part of the partition selection. Meaning CQL rows in this table with the same `device_id` may be located on different nodes. But all rows with the same values for the partitioning keys will be located on the same nodes. 

For my example I used the devices I was tracking to check for [dam dirty apes](http://www.youtube.com/watch?feature=player_detailpage&v=ZJT2vJMsYc4#t=67s).

    CREATE TABLE events (
      device_id   int,
      year_month  int,
      sequence    timestamp,
      pressure    int,
      temperature int,
      is_dam_dirty_apes  boolean,
      PRIMARY KEY ((device_id, year_month), sequence)
    );

The partition key*s* are `device_id` and `year_month`, every event from the same device in the same month will be placed in the same partition. The grouping column is the time of the event which I called `sequence` (to avoid confusion with Cassandra timestamps).

So we turn on the network and start checking for apes.

    insert into events 
    (device_id, year_month, sequence, pressure, temperature, is_dam_dirty_apes)
    values
    (1, 201301, '2013-01-20T10:58:35+1300', 123, 10, false);
    insert into events 
    (device_id, year_month, sequence, pressure, temperature, is_dam_dirty_apes)
    values
    (2, 201301, '2013-01-20T10:58:40+1300', 456, 20, false);
    insert into events 
    (device_id, year_month, sequence, pressure, temperature, is_dam_dirty_apes)
    values
    (3, 201301, '2013-01-20T10:58:45+1300', 789, 30, true);
    insert into events 
    (device_id, year_month, sequence, pressure, temperature, is_dam_dirty_apes)
    values
    (1, 201302, '2013-02-20T10:58:35+1300', 1230, 11, true);
    insert into events 
    (device_id, year_month, sequence, pressure, temperature, is_dam_dirty_apes)
    values
    (2, 201302, '2013-02-20T10:58:40+1300', 4560, 21, true);
    insert into events 
    (device_id, year_month, sequence, pressure, temperature, is_dam_dirty_apes)
    values
    (3, 201302, '2013-02-20T10:58:45+1300', 7890, 31, true);

In `cqlsh` we now have 6 rows.

    cqlsh:dev> select * from events;

     device_id | year_month | sequence                 | is_dam_dirty_apes | pressure | temperature
    -----------+------------+--------------------------+-------------------+----------+-------------
             2 |     201302 | 2013-02-20 10:58:40+1300 |              True |     4560 |          21
             3 |     201302 | 2013-02-20 10:58:45+1300 |              True |     7890 |          31
             1 |     201302 | 2013-02-20 10:58:35+1300 |              True |     1230 |          11
             1 |     201301 | 2013-01-20 10:58:35+1300 |             False |      123 |          10
             3 |     201301 | 2013-01-20 10:58:45+1300 |              True |      789 |          30
             2 |     201301 | 2013-01-20 10:58:40+1300 |             False |      456 |          20
         
Checking in the `cassandra-cli` we see a similar layout to before, with the addition of a composite value used for the row key. Each CQL row has been transposed to four columns in a storage engine row. 

    [default@dev] list events;
    Using default limit of 100
    Using default column limit of 100
    -------------------
    RowKey: 2:201302
    => (column=2013-02-20 10\:58\:40+1300:, value=, timestamp=1357869160739000)
    => (column=2013-02-20 10\:58\:40+1300:is_dam_dirty_apes, value=01, timestamp=1357869160739000)
    => (column=2013-02-20 10\:58\:40+1300:pressure, value=000011d0, timestamp=1357869160739000)
    => (column=2013-02-20 10\:58\:40+1300:temperature, value=00000015, timestamp=1357869160739000)
    -------------------
    RowKey: 3:201302
    => (column=2013-02-20 10\:58\:45+1300:, value=, timestamp=1357869161380000)
    => (column=2013-02-20 10\:58\:45+1300:is_dam_dirty_apes, value=01, timestamp=1357869161380000)
    => (column=2013-02-20 10\:58\:45+1300:pressure, value=00001ed2, timestamp=1357869161380000)
    => (column=2013-02-20 10\:58\:45+1300:temperature, value=0000001f, timestamp=1357869161380000)
    ...

Nothing to scary there. Now over to `nodetool` to see where the rows are placed. We need to specify the value of `device_id` and `year_month` as these are used in the storage engine row key.

    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev events 1:201301
    127.0.0.3
    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev events 2:201301
    127.0.0.1
    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev events 3:201301
    127.0.0.1
    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev events 1:201302
    127.0.0.3
    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev events 2:201302
    127.0.0.2
    $ bin/nodetool -h 127.0.0.1 -p 7100 getendpoints dev events 3:201302
    127.0.0.2

The two partitions each for devices 2 and 3 have been placed on different nodes. The partitions for device 1 are on the same node, but with enough nodes they would probably be on different ones.


