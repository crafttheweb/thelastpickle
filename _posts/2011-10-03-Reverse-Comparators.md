---
layout: post
title: "Reversed Comparators"
category: Cassandra
---

Cassandra 0.8.1 [added](https://issues.apache.org/jira/browse/CASSANDRA-2355) support for Composite Types and Reversed Types, through a handy little type composition language. Hopefully I'll get to show some of the things you can do with Composite Types later, for now the best resource I know is Ed Anuff's presentation on [Cassandra Indexing Techniques](http://www.slideshare.net/edanuff/indexing-in-cassandra) at Cassandra SF 2011. 

The Reversed Comparator wraps another Comparator (.e.g. `AsciiType`) and well, there is easy way to say this, [reverses](https://github.com/apache/cassandra/blob/cassandra-0.8.6/src/java/org/apache/cassandra/db/marshal/ReversedType.java#L60) the order of the comparisons so that columns are stored in **descending** order. If you are using something like a time stamp for a column name, the most recent value will be the first column on the row rather than the last. In a Relational DB with tree based indexes there is not much difference between getting the first or last row in an index, but Cassandra does not use tree indexes.  

Recall from my post on [Cassandra Query Plans](http://thelastpickle.com/2011/07/04/Cassandra-Query-Plans/) that once rows get to a certain size they include an index of the columns. And that the entire index must be read whenever any part of the index needs to be used, which is the case when using a Slice Range that specifies start or reversed. So the fastest slice query to run against a row was one that retrieved the first X columns in a row by only specifying a column count. 

To get an idea of how different the performance is I took the test script from [Cassandra Query Plans](http://thelastpickle.com/2011/07/04/Cassandra-Query-Plans/) and modified it to test two query patterns using both (regular) Ascending and (reversed) Descending comparators.

* Getting the 10 most recent columns using a start column and a column count. 
* Getting the 10 most recent columns using only a column count. 

In the second case the query would specify `reversed` when using (regular) Ascending ordering so Cassandra would get the last 10 columns. However when using (reversed) Descending columns it would only specify the column count.

## In Motion - The Setup

The [reverse_query_profile.py gist](https://gist.github.com/1258711) contains the Python code I used to setup the data and profile queries using the pycassa library. All tests were done locally on a 2011 Mac Book Pro with 8GB of RAM and spinning disk.

**Note:** you will need to edit the file and set the CASSANDRA_PATH at the top of the file.

The tests used columns with a 10 byte name and 25 bytes of data. Together with the [15 bytes of column meta data](https://github.com/apache/cassandra/blob/cassandra-0.8.6/src/java/org/apache/cassandra/db/Column.java#L116) this will create columns that use 50 bytes on disk. For the standard 64KB column page this should give 1,310 columns per column page.

To test the latency of various queries I used the (recent) 'ReadLatency: ' metric available via `nodetool cfstats`. This metric wraps the [local processing](https://github.com/apache/cassandra/blob/cassandra-0.8.6/src/java/org/apache/cassandra/db/ColumnFamilyStore.java#L1295) of a query for a single CF. The value presented by `nodetool` is the most recent value. 

All tests were run 10 times and the min, max 80th and 95th percentiles of latency were recorded. 

The Reversed Comparator is specified by using a string to specify the comparator and appending `(reversed=true)`. I created the schema using a clean 0.8.6 install and the following `bin/cassandra-cli` script:

    create keyspace reverse
        with strategy_options=[{replication_factor:1}]
        and placement_strategy = 'org.apache.cassandra.locator.SimpleStrategy';

    use reverse;

    create column family NoCache_Ascending
        with comparator = AsciiType
        and default_validation_class = AsciiType
        and key_validation_class = AsciiType
        and keys_cached = 0
        and rows_cached = 0;

    create column family NoCache_Descending
        with comparator = 'AsciiType(reversed=true)'
        and default_validation_class = AsciiType
        and key_validation_class = AsciiType
        and keys_cached = 0
        and rows_cached = 0;

**Note:** You can use the Reversed Comparator anywhere, but it only makes sense to do so for the `comparator`, `subcomparator` and any secondary indexes. 

The `reverse_query_profile` module inserts the following rows:

* "small-row" with 100 columns, 5K of data
* "no-col-index" with 1200 columns, 60K of data
* "five-thousand" with 5000 columns, 244K of data
* "ten-thousand" with 10000 columns, 488K of data
* "hundred-thousand" with 100000 columns, 4.8M of data
* "one-million" with 1000000 columns, 48M of data
* "ten-million" with 10000000 columns, 480M of data

Insert the data by executing:

    $ python reverse_query_profile insert_rows

To keep things simple flush and compact the database so we only have one SSTable:

    $ bin/nodetool -h localhost flush
    $ bin/nodetool -h localhost compact query

At the end of this my `/var/lib/cassandra/data/query` directory contained the following SSTables (ignoring the `-Compacted` SSTables):

    -rw-r--r--   1 aaron  wheel   536M  3 Oct 21:49 NoCache_Ascending-g-184-Data.db
    -rw-r--r--   1 aaron  wheel   2.4K  3 Oct 21:49 NoCache_Ascending-g-184-Filter.db
    -rw-r--r--   1 aaron  wheel   154B  3 Oct 21:49 NoCache_Ascending-g-184-Index.db
    -rw-r--r--   1 aaron  wheel   4.2K  3 Oct 21:49 NoCache_Ascending-g-184-Statistics.db
    -rw-r--r--   1 aaron  wheel   536M  3 Oct 21:49 NoCache_Descending-g-149-Data.db
    -rw-r--r--   1 aaron  wheel   2.4K  3 Oct 21:49 NoCache_Descending-g-149-Filter.db
    -rw-r--r--   1 aaron  wheel   154B  3 Oct 21:49 NoCache_Descending-g-149-Index.db
    -rw-r--r--   1 aaron  wheel   4.2K  3 Oct 21:49 NoCache_Descending-g-149-Statistics.db

`reverse_query_profile` contains a warm up function that will slice through all the columns in all the rows, warm up the database by executing:

    $ python reverse_query_profile warm_up

## In Motion - Start Column

I was not expecting much difference between the Ascending and Descending CF's for this test as both use a start column. For the Ascending CF the script specifies the name of the tenth last column as the column name. For the Descending CF it uses the name of the last column because it will be the first column on the row and the others will follow it.

    $ ./reverse_query_profile.py recent_100_start
    Latency is min, 80th percentile, 95th percentile and max.
    100 most recent columns, using start

    Testing CF: NoCache_Ascending
    Row            small-row latency in ms       0.14     0.1512     0.1542      0.157
    Row         no-col-index latency in ms      0.361     0.5082     0.6311      0.751
    Row        five-thousand latency in ms      0.337      0.368     0.5269      0.721
    Row         ten-thousand latency in ms      0.307       0.32     0.3214      0.323
    Row     hundred-thousand latency in ms      0.205     0.2362     0.2506      0.266
    Row          one-million latency in ms      0.429      0.476     0.5234       0.58
    Row          ten-million latency in ms      1.247      1.432       4.71       8.71
    Testing CF: NoCache_Descending
    Row            small-row latency in ms      0.138     0.1526     0.1697       0.19
    Row         no-col-index latency in ms       0.32     0.3532     0.3572       0.36
    Row        five-thousand latency in ms      0.329      0.374     0.3863        0.4
    Row         ten-thousand latency in ms      0.351     0.3868     0.3875      0.388
    Row     hundred-thousand latency in ms      0.357     0.4094     0.4955        0.6
    Row          one-million latency in ms      0.451      0.496     0.5069      0.519
    Row          ten-million latency in ms      1.312      1.401      1.415      1.424

Looks like there was a couple of outliers that mucked up the 95th percentile, but if we look at the 80th percent there is not much difference between the two CF's. 

## In Motion - Count Only

This is where the differences are. When a query does not specify a start column (and does not specify reversed) the server can just start reading columns from the start without having to worry about finding the right place to start. This is exactly what we can do for the Descending CF.

For the regular Ascending CF we need to specify reversed, so the server must read the row index and work out which column is column count from the end of the row. 

There is no comparison really. 

    $ ./reverse_query_profile.py recent_100_count
    Latency is min, 80th percentile, 95th percentile and max.
    100 most recent columns, using no start

    Testing CF: NoCache_Ascending
    Row            small-row latency in ms      0.119     0.1496     0.1577      0.167
    Row         no-col-index latency in ms      0.313     0.3504     0.3879      0.433
    Row        five-thousand latency in ms      0.315      0.328     0.3361      0.346
    Row         ten-thousand latency in ms      0.264      0.291     0.4032      0.539
    Row     hundred-thousand latency in ms      0.181     0.2038     0.2049      0.206
    Row          one-million latency in ms      0.397     0.4308     0.4315      0.432
    Row          ten-million latency in ms       1.29      1.421      4.538      8.341
    Testing CF: NoCache_Descending
    Row            small-row latency in ms      0.133     0.1508     0.1514      0.152
    Row         no-col-index latency in ms      0.139      0.157     0.1633      0.171
    Row        five-thousand latency in ms      0.136     0.1506     0.1532      0.156
    Row         ten-thousand latency in ms      0.142     0.1558     0.1565      0.157
    Row     hundred-thousand latency in ms      0.139     0.1498     0.1518      0.154
    Row          one-million latency in ms      0.139     0.1592     0.1661      0.171
    Row          ten-million latency in ms      0.134     0.1602     0.1678      0.175


For this type of query the Reversed Comparator provided consistent query performance no matter how many columns the row container. From now on if you are modeling time series data, such as in our old friend the Twitter clone, you should probably use the Reversed Comparator. 