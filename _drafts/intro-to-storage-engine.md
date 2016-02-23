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

The partition header has a simple layout

Breaking this down:

* The Partition Key is the concatenated Columns of the Partition Key defined in your Table. 
    * The length of the Partition Key is encoded using a short, giving it a max length of 65,535 bytes. 
    * The Byte Buffer for the key is then written out. 
* The [DeletionTime](https://github.com/apache/cassandra/blob/cassandra-3.0/src/java/org/apache/cassandra/db/DeletionTime.java) for the  