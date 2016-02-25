---
layout: post
title: Introduction To Apache Cassandra 3.0 On Disk Format 
author: Aaron Morton
category: blog
tags: cassandra, storageengine
---

Ever get the chance to relive a past experience and have it actually be better the second time round? I used to love [Monkey Magic](https://www.youtube.com/watch?v=-zOFAD6e9Bk) when growing up, now not so much. The first time I dug into the Cassandra storage (back in 2009/2010) engine was the first time I got to see how a database actually works, and I was hooked. Digging into the Cassandra 3.0 storage I am able to see how a database improves, and it's much more enjoyable. 

## Thrift On CQL

Databases, or to be precise databases that can scale, are all about how to get bytes on and off disk. The team responsible for the 3.0 storage engine have done an amazing job making it easier for Cassandra to get bytes off disk. I'll try to take a look at that soon, for now I am going to look at how data is laid out on disk. 

The first step in understanding the 3.0 storage engine is to accept the change in the mental model. Those that knew the Thrift API basically knew how the storage engine worked; each internal _row_ was an ordered list of _columns_ that optionally had a value. This was kind of fun to start with, then we started having more complicated use cases which lead to some common abstractions. These abstractions were formalised in CQL3, which gave birth to terms such as _Partition_ and _Clustering_. Up until 3.0 these abstractions were implemented on a storage engine that did not natively support them.

The 3.0 storage engine natively supports the Partition and Clustering concepts of CQL3. A Partition is a collection of Rows that share the same _Partition Key(s)_ and are ordered by their _Clustering Key(s)_, which allows any Row to be identified by it's _Primary Key_: the combination of Partition Key and Clustering Key. The important change is the the storage engine now knows about all these ideas. The simplest way to illustrate this change is that we now serialise a Row to disk as an efficiently stored entity rather than a complex hack.

Put another way, previously CQL 3 was implemented on top of Thrift now Thrift is implemented on top of CQL 3. 

## Just The Data

Serialising to the `-Data.db` component of the SSTable starts with the Partition. When we decide to flush a Memtable to disk [Memtable.FlushRunnable.writeSortedContents()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/Memtable.java#L370) is made, this iterates the Partitions in the Memtable making a call for each that ends up at [BigTableWriter.append()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/io/sstable/format/big/BigTableWriter.java#L132). For now we are going to focus further to just how the Partition and rows are written to the `-Data.db` component of the SSTable by [ColumnIndex.writeAndBuildIndex()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/ColumnIndex.java#L47).

At a broad level the layout of a Partition in the `-Data.db` file has three components: A header, following by zero or one static rows, followed by zero or more non static rows. 

![Partition Overview)](/files/storage-engine/partition-overview.png) 

## Partition Header

The partition header has a simple layout, contining the Partition Key and deletion information. 

TODO: IMAGE

Breaking this down:

* The Partition Key is the concatenated Columns of the Partition Key defined in your Table. 
    * The length of the Partition Key is encoded using a short, giving it a max length of 65,535 bytes. 
    * The format of the Partition Key depends on the types used. There is a more information on this below when we look at the Row encoding.
* The [DeletionTime](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/DeletionTime.java) for the partition contains deletion information for partition tombstones.
    * Local Deletion Time is the server time in seconds when the deletion occurred, which is compared to `gc_grace_seconds` to decide when it can be purged.
    * Marked For Deletion At is the timestamp of the deletion, data with a timestamp before this value is considered deleted.

## Static Row

If present the Static Row for the Partition is written next. It's important to remember that as we are flushing from the Memtable we are dealing with a _fragment_ of the Partition. That is a summary of the recent inserts into the table; if no recent inserts wrote to the static columns the Partition in the Memtable will not contain a Static Row. Things get a little more complicated now, [UnfilteredSerializer.serializeStaticRow()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/UnfilteredSerializer.java#L112) is called, but ultimatelt all the work is done in [UnfilteredSerializer.serialize()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/UnfilteredSerializer.java#L119). The format of the Static Row is a subset of a normal Row, to keep the discussion simple I'll only talk about the components included in the Static Row for now. 

TODO IMAGE 

Breaking this down:

* Flags is a single byte bitmask whose values are defined at the top of the [UnfilteredSerializer](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/UnfilteredSerializer.java#L77) class. 
* Extended Flags is a single byte included if the `EXTENSION_FLAG` is set in the Flags. This is always set for a Static Row, so will be included for this row. It is also set if there is a "SHADOWABLE" Deletion, let me get back to you on that one :). 
* The size of the row is calculated by `UnfilteredSerializer.serializedRowBodySize()` and encoded as a variable sized integer using [VIntCoding.writeUnsignedVInt()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/utils/vint/VIntCoding.java#L115). If possible it will be a single byte.
* Next the size of the previous row is encoded, agains as a variable sized integer. My guess is this is encoded to enable reverse scanning on the data, but I've not looked into it yet. 
* The [LivenessInfo](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/LivenessInfo.java) for the row is included if it is not empty. Liveness is used to determine if a row is alive yet empty or dead. The best explanation I've found is the comment for [Row.primaryKeyLivenessInfo()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/Row.java#L87). If it is not empty the delta from [EncodingStats.minTimestamp](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/EncodingStats.java#L69) is stored as a variable sized integer. The `EncodingStats` are maintained by [Memtable.put()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/Memtable.java#L247) to contain aggregate stats such as the minimum timestamp for all information in the Memtable. Features such as this are how the 3.0 storage format keeps disk size to a minimum, as the delta can be represented using as few bytes as possible.
* If a [ExpiringLivenessInfo](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/LivenessInfo.java#L219) is used it will also contain TTL information. This will be set when TTL information is included as a query option for a [modification statement](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/cql3/statements/ModificationStatement.java#L711), for example on the [INSERT](http://docs.datastax.com/en/cql/3.3/cql/cql_reference/insert_r.html) statement.
    * `ExpiringLivenessInfo.ttl()` is encoded as a variable sized integer delta from the [EncodingStats.minTTL](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/EncodingStats.java#L71).
    * `ExpiringLivenessInfo.localExpirationTime()` is encoded as a variable sized integer delta from the [EncodingStats.minLocalDeletionTime](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/EncodingStats.java#L70).
* If a Row level deletion has occurred [DeletionTime.isLive()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/DeletionTime.java#L78) will return `false`, meaning there is a Deletion and we should encode it (it kind of makes sense, see the comments). 
    * `DeletionTime.markedForDeleteAt()` is encoded as a variable sized integer delta from [EncodingStats.minTimestamp](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/EncodingStats.java#L69).
    * `DeletionTime.localDeletionTime()` is encoded as a variable sized integer delta from the [EncodingStats.minLocalDeletionTime](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/rows/EncodingStats.java#L70).
* The Columns this Row does not include all the Columns included in this Memtable the different is encoded. The Memtable [tracks](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/Memtable.java#L548) which columns have been added to it, and this is the list we are comparing to rather than the Columns in the Table definition. Encoding is handled by [Columns.serializeSubset()](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/Columns.java#L443) and encodes which Columns are _missing_ in this Row if there are less than 64 Columns, and a more complicated system for more than 64. In either case we end up with a variable sized integer. 