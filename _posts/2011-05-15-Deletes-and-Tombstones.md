---
layout: post
title: Deletes and Tombstones
category: blog
tags: cassandra
author: Aaron Morton
---

Deletes in Cassandra rely on Tombstones to support the Eventual Consistency model. Tombstones are markers that can exist at different levels of the data model and let the cluster know that a delete was recored on a replica, and when it happened. Tombstones then play a role in keeping deleted data hidden and help with freeing space used by deleted columns on disk.

It's possible to delete columns, super columns and entire rows in Cassandra. However in this post I'm going to look at the simple case of deleting a single column in a Standard Column Family.

## Remembering things forgotten

In a simple case of a single node traditional RDBMS deleting data is relatively straight forward process. Rows in Index and Data pages are marked as unused and other than recording the transaction in the commit log, the fact that the delete happened is forgotten.

As the [Distributed Deletes](http://wiki.apache.org/cassandra/DistributedDeletes) wiki page points out, things are a bit more complicated in Cassandra. From the perspective of the coordinator node (the one the client is connected to) one or more nodes may be down when the delete is executed. So long as the requested Consistency Level is achieved the delete can still proceed, but if we forget that the delete happened it will not be possible to reach the *correct* consistent view of the data later. The nodes that were offline will say "foo == bar" and the nodes that did the delete will have nothing to say.

When a column is deleted a `DeletedColumn` aka Tombstone is created in Cassandra. The DeletedColumn will have:

*   name: Name of the column deleted
*   value: Current server time as seconds since the unix epoch (integer). This is known as the `localDeleteTime` and is used during the (cassandra) GC process.
*   timestamp: As provided by the client

The mutation is then [applied](http://thelastpickle.com/2011/04/28/Forces-of-Write-and-Read/) to the memtable in one of two ways. If the memtable does not contain the named column for the row it is simply added to the memtable. If there is an existing column it is [reconcile() 'd](https://github.com/apache/cassandra/blob/trunk/src/java/org/apache/cassandra/db/Column.java#L179) with the Deleted Column. The new `DeletedColumn` will replace the existing column if it has a higher (client provided) timestamp. The localDeleteTime is not used for reconciliation. At this point any previous column value in the memtable is lost and will not be persisted to disk. 

We now have a tombstone. If there are no other mutations the `DeletedColumn` will later be persisted to the SSTable just like any other column. 

##  Local Reads for [Local](http://www.bbc.co.uk/comedy/clips/p006vm6j/the_league_of_gentlemen_a_local_shop_for_local_people/) Queries

During a local read for a row value the same reconciliation process that was used during the delete request runs. Multiple row fragments are retrieved from the current memtable, memtables pending flush and SSTables on disk. The fragments are reduced and the columns with the same name reconciled to arrive at the current value.

For example if there is a row fragment in an SSTable for key "foo" that says columns "bar" is "baz", and a DeletedColumn in another SSTable with a higher time stamp when they are reconciled the DeletedColumn will "win". The current view of the row will be that the "bar" column is deleted.

When a read query is filtering the reconciled candidate columns it will include the `DeletedColumn` in the result set if the localDeletionTime recorded for it is beyond the current `gcBefore` time. `gcBefore` is determined when the query starts as the current time (to 1 second resolution) less the `GCGraceSeconds` value specified for the Column Family. If the deletion is before `gcBefore` it is totally ignored, more on the GC process below. When a slice based query (e.g. get the first 10 columns) executes it adds the `DeletedColumn` to the result set, but does not count it towards the limit of columns the query has asked for.

The deleted columns are filtered out of the result set as the last step before returning it to the client. In the simple case of a local read at CL ONE the result of the local query is filtered and returned. For cluster reads the result of the query must be reconciled with CL replicas before the coordinator can say it has a consistent result. And this is why the `DeletedColumn`'s are still in the result set. 

## Readers Digest

If a read request involves more than one replica only the "closest" (as determined by the [snitch](http://wiki.apache.org/cassandra/ArchitectureInternals?highlight=%28snitch%29)) is asked to return the full result set. The result set it returns is will include any `DeletedColumn`'s read during the local read. 

The other nodes in the cluster are asked to return [digest](http://wiki.apache.org/cassandra/DigestQueries) of their local read. The digest is a [MD5](http://en.wikipedia.org/wiki/Md5) hash of the columns, their values, timestamps and other meta data. Once the coordinator node has received CL read responses, including the data response, it compares the digests with each other and the digest of the data response. 

If they all match then the read is consistent at the CL requested. Otherwise there is an inconsistency that needs to be repaired. The inconsistency could come from one replica including a `DeletedColumn` in it's digest while another includes the previously deleted value. 

## Read Repair (sort of)

Once a [`DigestMismatch`](https://github.com/apache/cassandra/blob/trunk/src/java/org/apache/cassandra/service/DigestMismatchException.java) is detected the differences have to be reconciled before the read response is returned to the client. The process that does this is part of the [ReadRepair](http://wiki.apache.org/cassandra/ReadRepair) feature, but depending on the circumstances it may not be considered a full Read Repair. 

Read Repair is considered to be happening when the coordinator requests a response from all replicas for a row, no just those that are needed to meet the Consistency Level for the request. This read repair will run for normal get / multi_get / indexed get operations but not range scans, and can be controlled with the `read_repair_chance` config setting. Even though all replicas receive the request, the request will only block of Consistency Level replicas. For now I'm going to ignore this process and just consider what happens if replicas required for the Consistency Level do not agree. 

Once the `DigestMismatch` is detected all the replicas that were involved in the read are asked to do the read again and return a full data response to the coordinator. Their responses are then reconciled using the same process as a normal mutation request to get a consistent result for the query. 

This is where the tombstone do their work of remembering that the delete happened. For example if replica 1 says 'foo' is a normal column, and replica 2 says 'foo' is a `DeletedColumn` with a higher time stamp the value from replica 2 will be used.

Once a reconciled view of the row has been created each replica is asynchronously sent a mutation with the difference between it's data and the reconciled data. The read can then return the reconciled view of the data to the client while the repair of the replicas that participated in the request is going on in the background. 

## Free

Existing data on disk for a column is not deleted when the delete mutation is processed. Cassandra never mutates on disk data. 

Instead the [compaction](http://wiki.apache.org/cassandra/MemtableSSTable?highlight=%28compaction%29) process reconciles the data in multiple SSTables on disk. The row fragments from each SSTable are collated and columns with the same name reconciled using the process we've already seen. The result of the compaction is a single SSTable that contains the same "truth" as the input files, but may be considerably smaller due to reconciling overwrites and deletions.

For example, there could be three SSTables that contain a value for the "foo" column. In the first the value is "bar", in the second the value is a 16KB string, and in the third it's a `DeletedColumn`. Before compaction runs the value of the column is nothing, however on disk it uses at least 16KB. After compaction the value will still be nothing, but it will be stored in a single SSTable and use only a few bytes.

Minor compaction typically runs frequently, so data that is created and deleted reasonably quickly will be deleted from disk quickly. Data that has been through several generations of compaction before it is deleted will not be deleted from disk as quickly. The `DeletedColumn` will continue to be written into the new, compacted, SStables until it's `localDeletionTime` occurs before the current (server) time less the `GCGraceSeconds`.


## The reincarnation of [Paul Revere’s horse](http://www.bobdylan.com/songs/tombstone-blues)

Compactions run locally and by default automatically based on load. Once `GCGraceSeconds` has elapsed since the delete a new compaction on the SSTable will purge the tombstone from disk and the delete will be forgotten. But how do we guarantee that other nodes in the cluster have seen the delete before it's deleted?

If a node goes down for longer than `max_hint_window_in_ms` it will no longer have hints recorded for it. If the column was never read a Read Repair could not have run. If the column was read but Read Repair was not active and the node was not included in CL nodes it would not have received a repair.

Deletes operate under Eventual Consistency just like writing a value, with the added complication that they have an built in expiry time (`GCGraceSeconds`). If the replicas for a value have not seen the delete before that time there is a risk of deleted data reappearing. The stop that happening `nodetool reapir` [needs to be run](http://wiki.apache.org/cassandra/Operations#Dealing_with_the_consequences_of_nodetool_repair_not_running_within_GCGraceSeconds) at least every `GCGraceSeconds`.

## In Motion on a single node

There is not a lot to look at on a single node, but it's pretty easy to see the tombstones and the column value persisted into an SSTable.

One a fresh 0.7 install create the sample schema:

    $ bin/cassandra-cli -h localhost -f conf/schema-sample.txt

The jump into the `cassandra-cli` and insert one column:

    $ bin/cassandra-cli -h localhost
    Connected to: "Test Cluster" on localhost/9160
    Welcome to cassandra CLI.

    Type 'help;' or '?' for help. Type 'quit;' or 'exit;' to quit.
    [default@unknown] use Keyspace1;                                    
    Authenticated to keyspace: Keyspace1
    [default@Keyspace1] set Standard1['foo']['bar'] = 'baz';

Flush the data from the memtable so our delete cannot be applied in memory:

    $ bin/nodetool -h localhost flush Keyspace1

Now delete the column using the cli:

    [default@Keyspace1] del Standard1['foo']['bar'];        
    column removed.

Flush the delete to disk:

    $ bin/nodetool -h localhost flush Keyspace1

Finally use the `sstable2json` dump the data from the SSTables:

    $ bin/sstable2json /var/lib/cassandra/data/Keyspace1/Standard1-f-1-Data.db 
    {
    "666f6f": [["626172", "62617a", 1305412876934000, false]]
    }
    $ bin/sstable2json /var/lib/cassandra/data/Keyspace1/Standard1-f-2-Data.db 
    {
    "666f6f": [["626172", "4dcf05ab", 1305413035092000, true]]
    }

The top level key in the output is the row key and each column is formatted as: name, value, timestamp, delete flag. The first SSTable still contains the "bar" column and the "baz" data written in the first set operation. The second SSTable also has the "bar" column, however the deleted flag is `true` and the value is now the (server) time stamp of deletion. This is the timestamp used with `GCGraceSeconds`.

Read the data back:

    [default@Keyspace1] get Standard1['foo']['bar'];
    Value was not found

## In Motion on a cluster

It's a bit more involved but it's also possible to see a Read Repair happening on a cluster. 

I normally run a 2 node cluster on my mac book using the direction from [Gary Dusbabek](http://www.onemanclapping.org/2010/03/running-multiple-cassandra-nodes-on.html). There is also this really handy tool from [Sylvain](https://github.com/pcmanus/ccm) that I've been meaning to try, or you can just run a normal two node cluster. 

Edit `conf/cassandra.yaml` for both nodes to disable Hinted Handoff:

    # See http://wiki.apache.org/cassandra/HintedHandoff
    hinted_handoff_enabled: true

This will prevent the nodes telling each other about mutations that happen while the other is down. 

I've also edited conf/log4j-server.properties to set logging at `DEBUG`.

Start the nodes and create and populate schema below using `bin/cassandra-cli` (schema definition is for a 0.7.5 cluster):

    create keyspace dev 
      with placement_strategy = 'org.apache.cassandra.locator.SimpleStrategy'
      and replication_factor = 2;

    use dev;

    create column family data 
      with comparator = AsciiType;

    set data[ascii('foo')]['bar'] = 'baz';

Flush the data on both nodes:

    $ bin/nodetool -h your-node1 flush dev
    $ bin/nodetool -h your-node2 flush dev
    
Shutdown node 1, connect to node 2 and delete the column using the cli:

    $ bin/cassandra-cli -h your-node2
    Connected to: "Test Cluster" on 127.0.0.2/9160
    Welcome to cassandra CLI.

    Type 'help;' or '?' for help. Type 'quit;' or 'exit;' to quit.
    [default@unknown] use dev;
    Authenticated to keyspace: dev
    [default@dev] del data['foo']['bar'];
    column removed.

Restart node 1, connect via the cli, set the consistency level to ALL to ensure Read Repair runs and read the deleted column:

    $ bin/cassandra-cli -h your-node1
    Connected to: "Test Cluster" on 127.0.0.1/9160
    Welcome to cassandra CLI.

    Type 'help;' or '?' for help. Type 'quit;' or 'exit;' to quit.
    [default@unknown] use dev;
    Authenticated to keyspace: dev
    [default@dev] consistencylevel as ALL;
    Consistency level is set to 'ALL'.
    [default@dev] get data['foo']['bar']; 
    Value was not found

This would have also worked at QUORUM (which is 2 for RF 2).

Digging through the logs on node1 you should see that the read will block for 2 nodes and Read Repair is enabled:

    ReadCallback.java (line 84) Blockfor/repair is 2/true; setting up requests
        to localhost/127.0.0.1,/127.0.0.2

Next should be some messages about reading the data locally and handling the response from your-node2. Then the `RowDigestResolver` will say it's resolving 2 responses before detecting the mismatch and raising an error:

    RowDigestResolver.java (line 62) resolving 2 responses
    StorageProxy.java (line 398) Digest mismatch:
        org.apache.cassandra.service.DigestMismatchException: Mismatch for key
            DecoratedKey(110673303387115207421586718101067225896, 666f6f)
            (34ec2eb2ec21eb3d05fb6f97cbf84c51 vs ba720207d87132da833ae2579487b172)
        at org.apache.cassandra.service.RowDigestResolver.resolve(
            RowDigestResolver.java:106)
        at org.apache.cassandra.service.RowDigestResolver.resolve(
            RowDigestResolver.java:30)
    ...

There should now be a few messages about doing the read again, and receiving the response from your-node2 again. Once the data responses have been received by node1 it will resolve the differences and send out mutations to the nodes than need them. In this case it's node1 and you can see the mutation logged from `Table` (aka Keyspace):

    RowRepairResolver.java (line 50) resolving 2 responses
    RowRepairResolver.java (line 76) versions merged
    RowRepairResolver.java (line 85) resolve: 1 ms.
    Table.java (line 337) applying mutation of row 666f6f

If you run the read again you should see the RowRepairResolver log 'digests verified' to say the data matched and there are no repairs to run. 

 