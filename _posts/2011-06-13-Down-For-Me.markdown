---
layout: post
title: "Down For Me?"
category: Cassandra
---

For a read or write request to *start* in Cassandra at least as many nodes must be seen as `UP` by the coordinator node as the request has specified via the ConsistencyLevel. Otherwise the client will get an `UnavailableException` and the cluster will appear down for that request. That may not necessarily mean it is down for all keys or all requests.

The Replication Factor, number of nodes, the Consistency Level and luck all play a part of determining how many nodes can be lost in a Cassandra cluster before it is unavailable for 100% of the keys. Before it reaches that point though the cluster may go through a period of partial failure where some keys will not be available at some CL levels.

The partial failure support baked into the system is nice thing to have. But most people will be interested in keeping 100% of the keys available at the required Consistency Level. So most of discussion below talks about keeping the cluster up for 100% of the keys at the `QUORUM` CL. 

## Which nodes ? 

When it comes to counting the `UP` nodes for a request we only consider the *Natural Endpoints* for a key. These are the nodes identified by the `placement_strategy` (set when the Keyspace was created) as the replicas for a key, and they never change. All read and write operations for a key, using the same partitioner, will select those same endpoints. Otherwise write operations could plonk down data that reads could never find.

The row key is first *Decorated* by the `partitioner` (specified in `conf/cassandra.yaml`) to create the token used to locate the row in the cluster. For example the `RandomPartitioner` uses an MD5 transform to turn the key into a 128bit token. 

Is using the `SimpleStrategy` it will:

1. Order the nodes in the ring by their `initial_token`. 
2. Select the node whose token range includes the token as the first replica. 
3. Select the next RF-1 nodes in the ordered ring as the remaining replicas.

The nodes loop around, so a row may be replicated on the last 2 nodes and the first 1.

The `NetworkTopologyStrategy` use a more involved algorithm that considers the Data Centre and Rack the node is assigned to by the Snitch. There is a good discussion of the process from [Peter Schuller](http://www.mail-archive.com/user@cassandra.apache.org/msg12092.html).

## The weird Consistency Level

There is one Consistency Level that does not behave like the others, so lets just get it out of the way first. CL `ANY` for write requests allows the coordinator node to store the mutation in the form of a [Hinted Handoff](http://wiki.apache.org/cassandra/HintedHandoff) on **any node in the cluster**, which in practice means on the coordinator itself.

This is useful in cases where extreme write uptime is needed. The sort of extreme where the write **cannot** be reliably read until a `nodetool repair` operation has been completed. `Hinted Handoffs` must be delivered to Natural Endpoints before they can be included in a read operation.

If you write at CL `ANY` and some of the Natural Endpoints are up, the write and the Hints will be sent to them. The coordinator will only be used to store the Hints in cases where all the Natural Endpoints are down.

For more information on Hinted Handoff see [Jonathan's recent post](http://www.datastax.com/dev/blog/understanding-hinted-handoff).

## Consistency Levels

For all the other Consistency Levels the read or write request is directed to one of the Natural Endpoints. Hinted Handoffs may be used as part of the request but are do not considered when determining if the cluster is available for the request.

The named Consistency Levels `ONE`, `TWO` and `THREE` are pretty easy to understand. Once, two or three replicas for the key must be seen as `UP` before the operation will start. CL `ONE` is the most often used of these.

`QUORUM` is calculated as `floor(RF \ 2) + 1`. This is most used CL level and in my opinion should be the starting CL for all applications until a reason is found to change (performance is *not* a reason).

For RF levels below 3 the `QUORUM` is the same as the RF level so:

* RF 1 - QUORUM =  1
* RF 2 - QUORUM =  2
* RF 3 - QUORUM =  2
* RF 4 - QUORUM =  3
* RF 5 - QUORUM =  3
* RF 6 - QUORUM =  4
* RF 7 - QUORUM =  4

When the `NetworkTopologyStrategy` is used each data centre has it's own RF, and the standard `QUORUM` is calculated using the total RF for the cluster. 

`LOCAL_QUORUM` and `EACH_QUORUM` can be used with the `NetworkTopologyStrategy` and they instruct the coordinator to also consider the Data Centre the nodes are located in. A write is always sent to all `UP` replicas, this 

For `LOCAL_QUORUM` only the RF of the local data centre is considered when:

* Calculating how many nodes to block for.
* Checking if enough nodes are `UP` for the request.
* Counting if CL nodes have responded to the request.

`EACH_QUORUM` works in a similar way but the tests apply to every DC in the cluster.

`ALL` requires that all replicas for the row be `UP` before the request will start.

## A failing Range

A simple, but incomplete, way to think about the cluster been available is to focus a one key range and it's replicas.

Consider RF 3, at QUORUM if one node is lost the range will still be available. If two nodes are lost the range will not be available for QUORUM operations, but will still be available for ONE and ANY requests. 

For any number of nodes in the cluster, a range will become unavailable it more than (RF - CL) nodes are `DOWN`.

Now consider a cluster with 50 nodes, RF 5, QUORUM operations and the SimpleStrategy. If 3 adjacent nodes nodes go down the range assigned to the first one will no longer be available, as their will only be 2 replicas `UP`. The cluster will be down for 2% of the possible keys, not terrible but it's no longer up for 100%. The range assigned to the second down node will have 3 `UP` replicas and the range assigned to the third will have 4 `UP` replicas. The nodes do not have to be adjacent in the ring for this occur, it could be any nodes in the replica set for the range. It's just easier to think about when they are adjacent.

Spreading replicas for a key across nodes with different physical infrastructure is a good way to mitigate this risk. The `NetworkTopologyStrategy` distributes the replicas for a DC across the available Racks. As defined by either the `RackInferringSnitch`, `PropertyFileSnitch` or the `EC2Snitch` which uses AWS Availability Zones as racks. The `SimpleSnitch` puts all nodes into `rack1` in `datacenter1`.

In the worst case failure scenario the cluster can sustain up to (RF - CL) failures and still remain available for 100% of the keys.

## A failing Cluster

The best case scenario for failure is when the node failures are evenly divided amongst the replicas for a range. So that every RF number of failures only removes one node from the available replica set for each range. To know how many nodes we can lose for a Consistency Level to still be available for 100% of the keys multiply by RF-CL. 

For a 5 node cluster with RF 3 at `QUORUM` this is (5 / 3) * (3 - 2) or 1. For other cluster sizes the number is:


    def max_failure(num_nodes, rf, block_for):
        print "For up to %s nodes with RF %s and blocking for %s nodes..." % (
            num_nodes, rf, block_for)
        print "Number Nodes / max_failure";
        for n in range(1, num_nodes + 1):
             print "%s / %s" % (n, ( int(n/rf) * (rf - block_for)))

    max_failure(10, 3, 2)

    For up to 10 nodes with RF 3 and blocking for 2 nodes...
    Number Nodes / max_failure
    1 / 0
    2 / 0
    3 / 1
    4 / 1
    5 / 1
    6 / 2
    7 / 2
    8 / 2
    9 / 3
    10 / 3
    
In the best case failure scenario the cluster can sustain up to floor(number of nodes / RF) * (RF - CL) failed nodes and still remain up for 100% of the keys.

## The view from one node

Considering which nodes are `UP` or `DOWN` is always from the perspective of the coordinator node. Network Partitions also play a part in the deciding if the cluster is available, as the nodes must be both running and contactable by the coordinator.

At the small scale if a client connects to a node in the cluster that has lost connectivity to other nodes in the cluster it will consider them all `DOWN` and be unavailable for all `QUORUM` requests. The client will receive a `UnavailableException` and should connect to another node and try request. Other nodes in the cluster may be in a bigger partition that contains enough `UP` replicas for the request to complete.

At a bigger scale when using Amazon AWS it's more likely that nodes an Availability Zone will lose connectivity with nodes from a different AZ then from nodes in the same AZ. 

With two AZ's operations at `QUORUM` will require nodes in both AZ's as neither will hold `QUORUM` replicas. So a network partition between the two would result in 100% of the keys been down in both AZ's.

With three AZ's each AZ will hold one third of the replicas, and any two together may provide enough `UP` replicas to support `QUORUM` operations. The cluster could sustain a network partition so long as each AZ can talk to at least one other AZ.

 