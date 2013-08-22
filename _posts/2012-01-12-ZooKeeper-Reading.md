---
layout: post
title: ZooKeeper Reading 12-01-2012
category: blog
tags: zookeeper
author: Aaron Morton
---

Some recent Zoo Keeper reading.

## [Overview](http://zookeeper.apache.org/doc/current/zookeeperOver.html)

* There is a leader in the cluster.
* Hierarchical model of `znodes` which act like directories and files. Uses "/" as the path separator. 
* All in memory, high throughput low latency.
* "The ZooKeeper implementation puts a premium on high performance, highly available, strictly ordered access."
* Transaction logs and snapshots on disk.
* Clients hold a TCP connection for duplex messaging.
* All updates have a globally ordered TxID. 
* Works best in read heavy workloads, think 10:1 R:W ratios. 
* `znodes` may have data and children. 
* `znodes` have a version number for their local (?) state.
* Reads and writes on a `znode` are atomic with respect to the version of data. 
* `znodes` can be protected by an ACL. 
* Ephemeral `znodes` are deleted when the session that created them ends. 
* Clients can set a watch on `znode` that is triggered when it changes. Is this for the local data or local data and children ?
* Guarantees:
    * Sequential Consistency - Updates from a client will be applied in the order that they were sent.
    * Atomicity - Updates either succeed or fail. No partial results.
    * Single System Image - A client will see the same view of the service regardless of the server that it connects to.
    * Reliability - Once an update has been applied, it will persist from that time forward until a client overwrites the update.
    * Timeliness - The clients view of the system is guaranteed to be up-to-date within a certain time bound.
* Write to WAL before apply to in memory DB.
* Reads are serviced by the local DB on the node, writes are services by an agreement protocol. Guess this is why it's tuned for read.
* Writes go to the leader, are then distributed to the other (follower) nodes. Local DB's should never diverge.
* [Performance](http://zookeeper.apache.org/doc/current/zookeeperOver.html#Performance) 3 servers should give between 20k/sec and 80k/sec requests depending on the read/write mix. 
* [Reliability](http://zookeeper.apache.org/doc/current/zookeeperOver.html#Reliability) less than 200ms to elect a new leader, failure of a follower reduces throughput. 
* What's the recover model for a follower that is down for a while ? Does this affect performance ? **Answer** (from the internals) If too many `Proposals` are missing a snapshot is sent.

## [ZooKeeper Internals](http://zookeeper.apache.org/doc/current/zookeeperInternals.html)

* "At the heart of ZooKeeper is an [atomic](http://img135.imageshack.us/img135/5011/atomics.gif) messaging system that keeps all of the servers in sync."
* Guarantees: 
    * Reliable Delivery
    * Total Order
    * Causal Order
* The messaging layer is build around FIFO channels between nodes, and relies on the properties of TCP for this. Specifically:
    * Ordered delivery
    * No message after close
* The protocol is composed of:
    * Packet: a sequence of bytes sent through a FIFO channel
    * Proposal: a unit of agreement. Proposals are agreed upon by exchanging packets with a quorum of ZooKeeper servers. Most proposals contain messages, however the NEW_LEADER proposal is an example of a proposal that does not correspond to a message.
    * Message: a sequence of bytes to be atomically broadcast to all ZooKeeper servers. A message put into a proposal and agreed upon before it is delivered.
* QUORUM is (n/2) +1 by default. 
* QUORUM can be majority quorums, weights, or a hierarchy of groups.
* Proposals are stamped with the `zxid` and sent to all servers, a server ack's when it is on persistent store. Messages in the proposal are then delivered. 
* `zxid` has two parts: the epoch and a counter. Implemented as a 64 bit int, high 32 bits are the epoch, low 32 are the count. 
* "The epoch number represents a change in leadership. Each time a new leader comes into power it will have its own epoch number."
* Messaging consists of two phases, Leader Activation and Active Messaging.
* Leader Activation may appear to have worked but later fail when checking the  invariant that a QUORUM of followers follow the same leader. During the election it must only hold with a high probability. 
* In Active Messaging:
    * Leader sends `PROPOSE` to all followers for a new proposal.
    * Followers commit to non-volatile storage and then `ACK`
    * Leader sends `COMMIT` to all followers once a `QUOURM` have `ACK`'d.  

## [Getting Started](http://zookeeper.apache.org/doc/current/zookeeperStarted.html)

* Grab the latest distro and start a single node with `bin/zkServer.sh start-foreground conf/zoo_sample.cfg`
* Fire up the command line interface with `bin/zkCli.sh -server 127.0.0.1:2181` and work through the examples in the doc.

## [Zope ZooKeeper client for Python](http://pypi.python.org/pypi/zc.zk/0.5.2)

* Requires [zc-zookeeper-static](http://pypi.python.org/pypi/zc-zookeeper-static/3.3.4.0)
* `zc-zookeeper-static` is a wrapper around the C libs, it's pretty low level. e.g. you get an int handle and pass that into methods, not OO. `zc.zk` ads an OO wrapper and some other stuff I cannot work out. 
* A lot of methods on the zc.zk.ZooKepper object are pass through to the `zc-zookeeper-static` package and do not have any docs. Check to docs on `zookeeper` for the function help. For example `zc.zk.ZooKeeper.get` has no docs and a crap `(*arg, **kwargs)` param list, look at `zookeeper.get`.

### Get a connection

    import zc.zk
    zk = zc.zk.ZooKeeper('127.0.0.1:2181')

### Get the children of a `znode`

    In [6]: zk.get_children("/")
    Out[6]: ['consumers', 'brokers', 'zookeeper', 'zk_test']
    # some stuff from kafka there.

### Get the properties of a `znode`

    # Get a zc.zk.Properties for the path
    # **NOTE:** This is heavy weight, for single reads use get_properties()
    In [55]: p = zk.properties("/zookeeper")
    
    In [56]: p.data
    Out[56]: {}
    
    In [58]: p.values()
    Out[58]: []
    
    # simple get_properties()
    In [64]: zk.get_properties("/zk_test")
    Out[64]: {'string_value': 'foo'}

    #zv.zk assume node data is json
    In [49]: zk.set("/zk_test", "foo")
    Out[49]: 0
    
    In [51]: p = zk.properties("/zk_test")
    
    In [53]: p.values()
    Out[53]: ['foo']

    In [54]: p.data
    Out[54]: {'string_value': 'foo'}

### Tree operations 

    In [59]: zk.print_tree("/zookeeper")
    /zookeeper
      /quota

### `znode` operations

    # create an ephemeral node
    
    # must have an ACL this is an open one 
    In [78]: acl = [{"perms" : zookeeper.PERM_ALL, "scheme" : "world", "id" : "anyone"}]
    
    # Parent path must exist
    In [85]: zk.create( "/fake/ephemeral", "some data", acl, zookeeper.EPHEMERAL)
    ...
    NoNodeException: no node

    In [84]: zk.create( "/zk_test/ephemeral", "some data", acl, zookeeper.EPHEMERAL)
    Out[84]: '/zk_test/ephemeral'
    
    # node now listed (locally) on the connection 
    In [86]: zk.ephemeral
    Out[86]: 
    {'/zk_test/ephemeral': {'acl': [{'id': 'anyone',
                                     'perms': 31,
                                     'scheme': 'world'}],
                            'data': 'some data',
                            'flags': 1}}
                            
    # View from the cluster
    In [88]: zk.get_properties("/zk_test/ephemeral")
    Out[88]: {'string_value': 'some data'}

    In [89]: p = zk.properties("/zk_test/ephemeral")
    In [91]: p.meta_data
    Out[91]: 
    {'aversion': 0,
     'ctime': 1326337991257L,
     'cversion': 0,
     'czxid': 1950L,
     'dataLength': 9,
     'ephemeralOwner': 86922380708675587L,
     'mtime': 1326337991257L,
     'mzxid': 1950L,
     'numChildren': 0,
     'pzxid': 1950L,
     'version': 0}
    
### Watch for changes

    In [8]: children = zk.children("/zk_test")

    In [9]: def my_callback(node):
       ...:   print "Called with node: ", str(node)
       ...: 

    In [11]: children(my_callback)
    Called with node:  zc.zk.Children(0, /zk_test)
    Out[11]: zc.zk.Children(0, /zk_test)

    In [14]: acl = [{"perms" : zookeeper.PERM_ALL, "scheme" : "world", "id" : "anyone"}]

    In [15]: zk.create( "/zk_test/ephemeral", "some data", acl, zookeeper.EPHEMERAL)
    Out[15]: '/zk_test/ephemeral'
    Called with node:  zc.zk.Children(0, /zk_test)    