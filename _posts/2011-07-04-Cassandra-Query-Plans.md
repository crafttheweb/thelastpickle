---
layout: post
title: "Cassandra Query Plans"
category: Cassandra
---

I've had a few conversations about query performance on wide rows recently, so it seemed about time to dig into how the different slice queries work.

## Lots-o-garbage

Clearly lots of garbage in an SSTable in the form of deleted, expired, overwritten or tombstoned columns will have an impact on reads. As they increase the amount of data that will be read, examined and then discarded.

Like any database one part of query evaluation involves reading data from disk  and another involves filtering the candidate data into the final result set. The filtering part of a Cassandra read query involves collating the various row fragments, reconciling multiple columns with the same name, and handling tombstones and expiring columns.

For now I'm going to focus on the reading part and I'm going to restrict it further by only considering cases where all the data is in a single SSTable and there are no garbage columns. 

## What's in a row?

Aside from the columns there are a few other things stored in a row in an SSTable that are of use when performing read queries.

A row will be written to an SSTable with zero columns if it has a row level Tombstone. The Tombstone will be used when reconciling the columns for a query as it may delete columns in the row that have a lower timestamp.

Each row also contains a [Bloom Filter](http://spyced.blogspot.com/2009/01/all-you-ever-wanted-to-know-about.html) of the column names in the row. This can be used to test if the row *may* contain any of the columns a query is looking for. Bloom Filters may give false positives, just like the SSTable bloom filter for row keys, so the only way to know if the column really exists is to read it. 

Finally if the serialised size of the columns in the row is greater than the `column_index_size_in_kb` config setting (default is 64) a column index is also written. The index is a sampling of first and last column names in each `column_index_size_in_kb` (or more) chunk of column data, along with the offset and width of the chunk. Queries can de-serialise the index and work out how may pages of columns to skip before dropping down to the data file to scan for matching columns.

## Slice By Names

A slice query that specifies a list of columns names in the [SlicePredicate](http://wiki.apache.org/cassandra/API) is turned into a [SliceByNamesReadCommand](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/SliceByNamesReadCommand.java) internally. This is the command you will see logged by the server when `DEBUG` level logging is enabled. It uses the [SSTableNamesIterator](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/columniterator/SSTableNamesIterator.java) to read bytes off disk and create the [Column](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/Column.java) objects that will be collated and reconciled to arrive at the query result. 

The first thing the Iterator does is determine if the SSTable contains the row fragment we are interested in, this follows the read path described in [The forces of Write and Read](http://thelastpickle.com/2011/04/28/Forces-of-Write-and-Read/). When the file is opened a buffer of size `column_index_size_in_kb` (specified in cassandra.yaml, default is 64K) will be allocated if Standard (non memory mapped) file access is been used. If the default [Memory-mapped file access](http://en.wikipedia.org/wiki/Memory-mapped_file) is used the buffer size is ignored. 

If the row exists in the SSTable the Iterator will seek to the start of the row in the `Data` component of the SSTable and take the following initial steps:

1. Read the row key.
2. Read the row size.
3. Read the row level Bloom Filter.
4. Read the row level column index, if present. 
5. Read the row level Tombstone. 
6. Filter the requested columns using the row level Bloom Filter. 

At the end of these initial steps the Iterator will know if the SSTable *may* contain any of the columns requested in the query. Even if the SSTable table does not contain any columns of interest it may contain a row level Tombstone which will need to be reconciled with columns contained in other SSTables. 

If the row may contain columns for the query the path the Iterator will take depends on presence of the column index. 

If the row does not contain a column index the iterator will:

1. Read the number of columns in the row.
2. Read each column fully (including it's value) from the SSTable. 
3. Add the column to the result set if it's name is in the list of columns queried for.
4. Stop the scan early if the number of filtered columns (from the Bloom Filter) is reached.

This is a basic scan operation over potentially all columns in the row. However the code knows it will only have to scan at most one page of columns that will contain at most `column_index_size_in_kb` (64K) of columns. The number of columns in the column page will vary with regard to the size of the columns, so the amount of de-serialisation and object creation will vary for each row.

When using Standard disk access with the default file buffer size is 64K the entire row may have already been read from disk. When using Memory-mapped file access the row will be backed by a [MappedByteBuffer](http://download.oracle.com/javase/6/docs/api/java/nio/MappedByteBuffer.html) of up to 2GB. The MappedByteBuffer will use the native [page size](http://en.wikipedia.org/wiki/Page_(computer_memory)) when it asks for data, on Mac Book this is 4096 bytes (`getconf PAGESIZE`). The `MappedByteBuffer` has the advantage of not needing to copy the bytes read from disk, and it will also keep the data in memory until the OS needs to page it out.

In both cases it's reasonable to assume there maybe no additional IO to read all the bytes for the column page. 

If the row does contain a column index the Iterator will:

1. Use the the column index to work out the distinct ordered set of column pages that contain the columns which may exist in the row (filtered columns from the Bloom Filter). 
2. Seek to the start position for each page of columns identified in step 1.
3. Scan through the entire page of columns, de-serialise each column fully (including it's value) and add it to the result set if it's name is in the list of columns queried for. 

The search path is reduced by only scanning the pages that contain columns which passed through the bloom filter. However there is no facility to stop a particular page scan until the end of the page is reached.

For both indexed and non indexed rows all the columns which match the query are eagerly read from disk for each SSTable and held in the Iterator.

## Slice From Read

A slice query that does not specify a list of columns is turned into a [SliceFromReadCommand](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/SliceFromReadCommand.java). It will contain optional start and finish column names and a column count. Again the work for reading columns from disk is done by an Iterator, this time the [SSTableSliceIterator](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/columniterator/SSTableSliceIterator.java) which wraps either a [SimpleSliceReader](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/columniterator/SimpleSliceReader.java) or an [IndexedSliceReader](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/columniterator/IndexedSliceReader.java).

The `SSTableSliceIterator` is responsible for:

1. Ensuring the key exists in the SSTable and seeking to it's position. 
2. Reading the key from the row. 
3. Reading the row size.
4. Deciding which Iterator to use.

The `SimpleSliceReader` is used when the query does not specify a start column and uses the default ascending column order (i.e. does not specify reversed). Otherwise the `IndexedSliceReader` is used.

When the `SimpleSliceReader` is used it will:

1. Skip and ignore the row level Bloom Filter.
2. Skip and ignore the column index. 
3. Read the row level Tombstone.
4. Read the column count. 
5. De-serialise each column in turn on demand as requested through the Iterator interface. 

The `SimpleSliceReader` will only stop the scan when either the end of the row is reached, or a column with a name greater than the finish column is reached. 

It's the responsibility of the  [SliceQueryFilter](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/filter/SliceQueryFilter.java) to only request the columns it needs for the query. This involves determining which columns are `live` and contribute to the column count specified in the `SliceRange`. The query will be stopped by either:

1. Reading `count` live columns from the SSTables.
2. Reading past the finish column if specified.
3. Exhausting all SSTables involved in the read.

The `IndexedSliceReader` has a much tougher life. It is used when there is a start column or the columns must be returned in reverse order. It will:

1. Skip and ignore the row level Bloom Filter. 
2. Read the column index. 
3. De-serialise the row and read the row level tombstone if present.

Depending on the presence of the column index one of two algorithms will be used to read the columns from disk. The [SimpleBlockFetcher](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/columniterator/IndexedSliceReader.java#L200) is used when the row does not contain a column index. It de-serialises the columns in the row, and builds a list that is either disk ordered or reverse disk ordered depending on the query. The scan is stopped by either:

1. Reading all columns in the row. 
2. Reading a column beyond the finish column, if a finish column was specified and reverse is false. 
3. Reading a column beyond the start column, if a start column was specified and reverse is true. 

Unlike the `SimpleSliceReader` when the `IndexedSliceReader` is used on a small row it will eagerly read all columns from the row which match the query. This only happens in the context of a row which has less then `column_index_size_in_kb` of column data . 

The [IndexedBlockFetcher](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/columniterator/IndexedSliceReader.java#L140) is used for all other cases, it will:

1. Use the column index to find the first column page to read from.
2. Step forwards or backwards (for reversed) through the column pages for the row on demand as each page of columns is exhausted. 
3. Stop the iteration if the [IndexInfo](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/io/sstable/IndexHelper.java#L164) for the next column page does not contain columns inside the start or finish column range, if a start or finish column are specified.  
4. De-serialise all columns in each page, building a list of columns in either disk order or reverse disk order.
5. Stop a page scan using the same criteria as the `SimpleBlockFetcher` above. 

The `IndexedBlockFetcher` greedily reads the columns in each page just as the `SimpleBlockFetcher` does. But will only advance to the next page when the query requests more columns and the previous block of columns has been exhausted.

## So What ?

Not much. 

Cassandra works like other databases by using a seek and partial scan approach to finding data. Read requests that require fewer seek+scan operations will be faster than those the require more.

There are a couple of things we can say about what will make some queries go faster than others though.

### Name Locality

Queries by column name that select columns on fewer column pages should be faster that those which are spread out over more column pages. Querying more column pages means reading more data and creating more Column objects. The pathological case is selecting n columns from n column pages. 

Note that queries by column name must also de-serialise the column index, and will pay a constant cost for every query regardless of the number of columns requested or their distribution in the row.

### Start Position

The entire column index must be de-serialised whenever an offset into the row needs to be found. Queries by that slice columns without specifying a start column and use (default) ascending order will perform better than those that either use a start column or reverse order. However the cost of de-serialising the column index is constant and the position of the start column should have little affect on query performance. 

The overhead should naturally increase with the width of the rows. 

## In Motion - The Setup

The [query_profile gist](https://gist.github.com/1074715) contains the Python code I used to setup the data and profile queries using the [pycassa](https://github.com/pycassa/pycassa) library. All tests were done locally on a 2011 Mac Book Pro with 8GB of RAM and spinning disk. 

**Note**: you will need to edit the file and set the `CASSANDRA_PATH` at the top of the file. 

The tests used columns with a 10 byte name and 25 bytes of data. Together with the [15 bytes of column meta data](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/Column.java#L116) this will create columns that use 50 bytes on disk. For the standard 64KB column page this should give 1,310 columns per column page.

To verify the column paging I recompiled the 0.8.1 source to include a change to the [SSTableNamesIterator that logged](https://gist.github.com/1068855) the number of index entries each row had and how many column pages were used during a read. 

The output made the paging look "good enough", for example:

    #selecting from 1 page
    INFO 13:21:52,662 Column Page Count 4/1
    INFO 13:22:03,309 Column Page Count 8/1
    INFO 13:22:14,070 Column Page Count 77/1
    INFO 13:22:26,140 Column Page Count 763/1
    INFO 13:22:49,362 Column Page Count 7628/1

    #selecting from 50 pages 
    INFO 13:32:15,501 Column Page Count 4/4
    INFO 13:32:25,696 Column Page Count 8/8
    INFO 13:32:36,790 Column Page Count 77/50
    INFO 13:32:54,012 Column Page Count 763/50
    INFO 13:33:37,511 Column Page Count 7628/50
 
    #sometimes it was off
    INFO 13:35:02,987 Column Page Count 77/53
    INFO 13:35:04,153 Column Page Count 77/50
    INFO 13:35:05,325 Column Page Count 77/51
    INFO 13:35:06,489 Column Page Count 77/52
    INFO 13:35:15,812 Column Page Count 763/71
    INFO 13:35:18,182 Column Page Count 763/63
    INFO 13:35:20,536 Column Page Count 763/69
    INFO 13:35:22,898 Column Page Count 763/70
    INFO 13:35:51,997 Column Page Count 7628/67
    INFO 13:36:07,069 Column Page Count 7628/65
    INFO 13:36:22,012 Column Page Count 7628/66


To test the latency of various queries I used the (recent) 'ReadLatency: ' metric available via `nodetool cfstats`. This metric wraps the [local processing](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/ColumnFamilyStore.java#L1180) of a query for a single CF. The value presented by `nodetool` is the most recent value. 

All tests were run 10 times and the min, max 80th and 95th percentiles of latency were recorded. 

Using a clean 0.8.1 install create the following keyspace using `bin/cassandra-cli`:

    create keyspace query
        with strategy_options=[{replication_factor:1}]
        and placement_strategy = 'org.apache.cassandra.locator.SimpleStrategy';
    
    use query;

    create column family NoCache
        with comparator = AsciiType
        and default_validation_class = AsciiType
        and key_validation_class = AsciiType
        and keys_cached = 0
        and rows_cached = 0;

The `query_profile` module will insert the following rows:

* "small-row" with 100 columns, 5K of data
* "no-col-index" with 1200 columns, 60K of data
* "five-thousand" with 5000 columns, 244K of data
* "ten-thousand" with 10000 columns, 488K of data
* "hundred-thousand" with 100000 columns, 4.8M of data
* "one-million" with 1000000 columns, 48M of data
* "ten-million" with 10000000 columns, 480M of data

Insert the data by executing:

    $ python query_profile insert_rows

To keep things simple flush and compact the database so we only have one SSTable:

    $ bin/nodetool -h localhost flush
    $ bin/nodetool -h localhost compact query

At the end of this my `/var/lib/cassandra/data/query` directory contained the following SSTables (ignoring the `-Compacted` SSTables):

    -rw-r--r--  1 aaron  wheel   536M  6 Jul 13:03 NoCache-g-80-Data.db
    -rw-r--r--  1 aaron  wheel   1.4K  6 Jul 13:03 NoCache-g-80-Filter.db
    -rw-r--r--  1 aaron  wheel   154B  6 Jul 13:03 NoCache-g-80-Index.db
    -rw-r--r--  1 aaron  wheel   4.2K  6 Jul 13:03 NoCache-g-80-Statistics.db

`query_profile` contains a warm up function that will slice through all the columns in all the rows, warm up the database by executing:

    $ python query_profile warm_up

## In Motion - Name Locality

We want to test that selecting columns by name when they are tightly grouped has better performance than selecting widely distributed columns. 

The `name_locality` test runs through several tests that select up to 100 columns by name from each of the rows. The numbers show a reasonably stable latency for queries that touch the same number of pages, and an increase when the number of pages increases. Which matches the theory. 

Note: the code outputs a WARN message when the test selects less than 100 columns from a row. For various tests this happened on the "small-row", "no-col-index", "five-thousand" and "ten-thousand" rows. Mostly when selecting a set number of columns from each column page.

    $ python query_profile.py name_locality
    Latency is min, 80th percentile, 95th percentile and max.
    Test name locality...
 
    100 columns by name, start of the row.
    Row            small-row had latency in ms      0.285      0.362     0.3828      0.396
    Row         no-col-index had latency in ms      0.848     0.9146     0.9159      0.917
    Row        five-thousand had latency in ms      1.257      1.321      1.324      1.324
    Row         ten-thousand had latency in ms      1.226      1.311      1.333      1.358
    Row     hundred-thousand had latency in ms      1.406      1.483      1.489      1.492
    Row          one-million had latency in ms      2.848      2.957      3.019      3.089
    Row          ten-million had latency in ms      17.75      18.72      18.76      18.78

    100 columns by name, end of the row.
    Row            small-row had latency in ms      0.273     0.2846     0.2891      0.294
    Row         no-col-index had latency in ms      0.674     0.7078     0.7107      0.714
    Row        five-thousand had latency in ms      0.928      0.962     0.9638      0.966
    Row         ten-thousand had latency in ms      0.882      0.901     0.9172      0.937
    Row     hundred-thousand had latency in ms      0.868     0.9138     0.9154      0.917
    Row          one-million had latency in ms      2.553       2.72       2.73      2.739
    Row          ten-million had latency in ms      16.95      17.67      17.82      17.97

    100 columns by name, middle of row.
    Row            small-row had latency in ms      0.273     0.3134     0.3422      0.368
    Row         no-col-index had latency in ms      0.835     0.9052     0.9092      0.913
    Row        five-thousand had latency in ms      1.719      1.772      1.839      1.915
    Row         ten-thousand had latency in ms      1.726      1.802      1.818      1.837
    Row     hundred-thousand had latency in ms      1.853      1.978      6.987       13.1
    Row          one-million had latency in ms      2.682      2.832      2.927      3.041
    Row          ten-million had latency in ms      17.27      18.59      18.72      18.75

    100 columns by name, first 2 cols from 50 random pages
    Row            small-row had latency in ms      0.115      0.119     0.1195       0.12
    Row         no-col-index had latency in ms       0.37     0.4008     0.4019      0.403
    Row        five-thousand had latency in ms      1.504      1.596      1.614      1.637
    Row         ten-thousand had latency in ms       3.14      3.445      3.493      3.547
    Row     hundred-thousand had latency in ms      25.25      27.63      36.62       47.5
    Row          one-million had latency in ms      26.68      28.47      28.92      29.47
    Row          ten-million had latency in ms      40.95      43.55      43.96      44.13

    100 columns by name, last 2 cols from 50 random pages
    Row            small-row had latency in ms      0.109      0.115     0.1218       0.13
    Row         no-col-index had latency in ms      0.349     0.3536     0.3553      0.357
    Row        five-thousand had latency in ms      1.778      1.854      1.877      1.897
    Row         ten-thousand had latency in ms       3.39      3.664      3.715      3.765
    Row     hundred-thousand had latency in ms      25.17      26.77       28.0      29.35
    Row          one-million had latency in ms      26.44      28.04      28.19      28.35
    Row          ten-million had latency in ms      40.57      44.26      44.69      44.74

    100 columns by name, random 2 cols from 50 random pages
    Row            small-row had latency in ms      0.107      0.117     0.1174      0.118
    Row         no-col-index had latency in ms       0.36     0.4356     0.4445      0.445
    Row        five-thousand had latency in ms       1.72      1.808      2.795      3.998
    Row         ten-thousand had latency in ms      3.367      3.682      3.705      3.715
    Row     hundred-thousand had latency in ms      25.45      27.23      28.93      30.95
    Row          one-million had latency in ms       32.6      38.43      38.91      39.45
    Row          ten-million had latency in ms      48.76      53.88      54.09      54.19

    100 columns by name, first col from 100 random pages
    Row            small-row had latency in ms      0.106      0.113     0.1306      0.152
    Row         no-col-index had latency in ms      0.326     0.3508      0.351      0.351
    Row        five-thousand had latency in ms      1.361      1.451      1.483      1.518
    Row         ten-thousand had latency in ms      2.853      3.071      3.102      3.136
    Row     hundred-thousand had latency in ms      37.65      40.08      40.92      41.84
    Row          one-million had latency in ms      51.23      54.41      55.93       57.6
    Row          ten-million had latency in ms      64.67      68.56      69.24       69.6

    100 columns by name, last col from 100 random pages
    Row            small-row had latency in ms      0.105      0.113     0.1153      0.118
    Row         no-col-index had latency in ms      0.325      0.349     0.3553      0.363
    Row        five-thousand had latency in ms      1.601      1.695      1.698        1.7
    Row         ten-thousand had latency in ms      3.058      3.404      4.317      5.429
    Row     hundred-thousand had latency in ms      37.34      39.52      40.54      41.72
    Row          one-million had latency in ms      50.76      53.92      54.58      55.14
    Row          ten-million had latency in ms       64.2      68.46      69.28      70.07

    100 columns by name, random col from 100 random pages
    Row            small-row had latency in ms       0.11     0.1156     0.1169      0.118
    Row         no-col-index had latency in ms      0.327     0.3628     0.3721      0.382
    Row        five-thousand had latency in ms      1.541      1.656      1.664      1.674
    Row         ten-thousand had latency in ms      2.719      3.272      3.279      3.282
    Row     hundred-thousand had latency in ms      35.51      37.52       38.8      40.35
    Row          one-million had latency in ms      50.11      52.91       53.8       54.7
    Row          ten-million had latency in ms      65.06      68.67       69.3      69.88



## In Motion - Start Position

We want to show that any start position in a (forward) slice query has worse performance than one that does not. And that the position of the start column has little impact on the query performance.

The `start_position` test runs through several tests that select a slice of up to 100 columns with different start positions. 

The test for "100 columns from the start of the row with a start col" takes significantly longer than "100 columns from with no start column" for all rows other than "small-row". For all rows other than "no-col-index" I attribute this to the column index. For "no-col-index" row I attribute the increased latency to eagerly reading the entire page of columns. Performance was then reasonably similar for the other tests which used a start column. 

I'm not sure why the test for "100 columns from the start of the second page" was an outlier. Hopefully I'll get to take a longer look, but it seemed to consistency perform worse than other tests. 

    $ python query_profile.py start_position
    Test start position...

    Latency is min, 80th percentile, 95th percentile and max.
    100 columns from with no start column
    Row            small-row latency in ms      0.181     0.1934     0.2134      0.237
    Row         no-col-index latency in ms       0.18     0.1918     0.1956        0.2
    Row        five-thousand latency in ms      0.169      0.185     0.1864      0.188
    Row         ten-thousand latency in ms      0.187     0.1936     0.1972      0.201
    Row     hundred-thousand latency in ms      0.183     0.1936     0.1963      0.199
    Row          one-million latency in ms      0.181     0.1948     0.1959      0.197
    Row          ten-million latency in ms      0.178     0.1952     0.1965      0.197

    Latency is min, 80th percentile, 95th percentile and max.
    100 columns from the start of the row with a start col
    Row            small-row latency in ms      0.135      0.142     0.1424      0.143
    Row         no-col-index latency in ms       0.34     0.3498       0.35       0.35
    Row        five-thousand latency in ms      0.358     0.3676     0.3684      0.369
    Row         ten-thousand latency in ms       0.36      0.376      0.511      0.676
    Row     hundred-thousand latency in ms      0.358        0.4     0.5005      0.622
    Row          one-million latency in ms      0.456      0.495     0.5006      0.505
    Row          ten-million latency in ms      1.345      1.418       1.44      1.467

    Latency is min, 80th percentile, 95th percentile and max.
    100 columns from the start of the second page
    Row            small-row latency in ms      0.128     0.1412     0.1424      0.143
    Row         no-col-index latency in ms      0.327      0.338     0.3385      0.339
    Row        five-thousand latency in ms      0.637     0.6488     0.6634      0.681
    Row         ten-thousand latency in ms      0.615      0.651     0.6519      0.653
    Row     hundred-thousand latency in ms      0.628     0.6726     0.6762       0.68
    Row          one-million latency in ms      0.706     0.7636     0.7671      0.771
    Row          ten-million latency in ms      1.569      1.706      3.148       4.91

    Latency is min, 80th percentile, 95th percentile and max.
    100 columns starting half way through the row
    Row            small-row latency in ms      0.099     0.1028     0.1125      0.124
    Row         no-col-index latency in ms      0.354     0.3626      0.363      0.363
    Row        five-thousand latency in ms      0.397     0.4068     0.4318      0.462
    Row         ten-thousand latency in ms      0.389     0.4138     0.4167       0.42
    Row     hundred-thousand latency in ms      0.358     0.3828      0.383      0.383
    Row          one-million latency in ms      0.456     0.5048     0.5135      0.524
    Row          ten-million latency in ms      1.347       1.47      1.489      1.504

    Latency is min, 80th percentile, 95th percentile and max.
    100 columns starting from the last page 
    Row            small-row latency in ms      0.126      0.143     0.1434      0.144
    Row         no-col-index latency in ms      0.325     0.3406     0.3425      0.343
    Row        five-thousand latency in ms      0.595      0.634     0.6646      0.696
    Row         ten-thousand latency in ms      0.556     0.5694     0.5795      0.591
    Row     hundred-thousand latency in ms      0.441     0.4942     0.5027      0.512
    Row          one-million latency in ms      0.405     0.4468     0.4507      0.454
    Row          ten-million latency in ms      1.272      1.372      1.393      1.417
