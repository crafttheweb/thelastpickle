---
layout: post
title: Anatomy of a Cassandra Partition
category: blog
tags: cassandra
author: Aaron Morton
---

Recently I was working on a Cassandra cluster and experienced a strange situation that resulted in a partition of sorts between the nodes. Whether you actually call it a partition or not is a matter for discussion (see [" You Can’t Sacrifice Partition Tolerance - Updated October 22, 2010"](http://codahale.com/you-cant-sacrifice-partition-tolerance/)]. But weird stuff happened, Cassandra remained available, and it was fixed with zero site down time. It was also a good example of how and why Cassandra is a Highly Available data store, and fun to fix. So here are all the nerdy details...

The cluster was running Cassandra 1.0.5 on 6 nodes, 3 in the East DC (nodes 20, 21 and 22) and 3 in the West DC (nodes 23, 24 and 25), and the Keyspace was configured with RF 3 in each DC. Application servers were running in each DC and it was important to keep a `LOCAL_QUOURM` in each data centre. The code would drop back to QUORUM if necessary, but that was something we wanted to avoid. 

I was deploying some configuration changes that required a rolling restart. The first few nodes worked fine, after restarting Cassandra I watched the other nodes detect it was `UP` and start sending hints to it. However when node #23 restarted the rest of the cluster continued to see it as `DOWN`, even though node #23 could see the rest of the cluster as `UP`.

## Is Cassandra available ?

This was the first question to answer. For this situation available meant all keys could be written to or read from using the `LOCAL_QUOURM` CL. Technically as I still had at least 2 nodes in each data centre I still had a Quorum, but strange stuff was happening so I wanted to confirm this.

Node #23 appeared to be happy:

    cassandra23# bin/nodetool -h localhost info
    Token            : 28356863910078205288614550619314017621
    Gossip active    : true
    Load             : 275.44 GB
    Generation No    : 1762556151
    Uptime (seconds) : 67548
    Heap Memory (MB) : 2926.44 / 8032.00
    Data Center      : DC1
    Rack             : RAC_unknown  
    Exceptions       : 0
(Note: this is from a little later, so the Uptime is not correct)

When I looked at the ring from any node other than #23 all nodes were `UP` other than node #23 (10.29.60.10):

    cassandra20# nodetool -h localhost ring
    Address         DC          Rack        Status State   Load            Owns    Token                                       
                                                                                   141784319550391026443072753096570088106     
    10.37.114.8     DC1         RAC20       Up     Normal  285.86 GB       16.67%  0                                           
    10.29.60.10     DC2         RAC23       Down   Normal  277.86 GB       16.67%  28356863910078205288614550619314017621      
    10.6.130.70     DC1         RAC21       Up     Normal  244.9 GB        16.67%  56713727820156410577229101238628035242      
    10.29.60.14     DC2         RAC24       Up     Normal  296.85 GB       16.67%  85070591730234615865843651857942052864      
    10.37.114.10    DC1         RAC22       Up     Normal  255.81 GB       16.67%  113427455640312821154458202477256070485     
    10.29.60.12     DC2         RAC25       Up     Normal  316.88 GB       16.67%  141784319550391026443072753096570088106  

But when I looked at the ring from node #23 all nodes were `UP`:

    cassandra23# nodetool -h localhost ring
        Address         DC          Rack        Status State   Load            Owns    Token                                       
                                                                                       141784319550391026443072753096570088106     
        10.37.114.8     DC1         RAC20       Up     Normal  285.86 GB       16.67%  0                                           
        10.29.60.10     DC2         RAC23       Up     Normal  277.86 GB       16.67%  28356863910078205288614550619314017621      
        10.6.130.70     DC1         RAC21       Up     Normal  244.9 GB        16.67%  56713727820156410577229101238628035242      
        10.29.60.14     DC2         RAC24       Up     Normal  296.85 GB       16.67%  85070591730234615865843651857942052864      
        10.37.114.10    DC1         RAC22       Up     Normal  255.81 GB       16.67%  113427455640312821154458202477256070485     
        10.29.60.12     DC2         RAC25       Up     Normal  316.88 GB       16.67%  141784319550391026443072753096570088106  

So it did not appear to be a cross DC networking issue, and technically we have a Quorum of replicas in each data centre.

To confirm the consistency levels available to the application I opened the `cassandra-cli` on nodes #20 and #23 and did some `get`'s changing the consistency level with `consistencylevel as`. It was still working but things were strange, this is what I found. 

* Node #23 could serve requests at `LOCAL_QUORUM`, `QUORUM` and `ALL` consistency.  
* All other nodes could serve requests at `LOCAL_QUOURM` and `QUORUM` but not `ALL` consistency.

Also I could see requests been processed by node #23 using `nodetool tpstats`.

So from the point of view of the application the cluster was up, and the application guys confirmed this. However we had lost redundancy in the West DC, if we lost another node for any reason we would lose the `LOCAL_QUORUM`. Any reason can include things like a planned restart. 

To be sure this had to be fixed, but we had time to fix it. This is part of the ops story with Cassandra, if something goes wrong you can normally fix it while the application keeps working.

## Orientate

My initial thought was that either the Gossip heartbeat from node #23 was not getting through, or it was been ignored. So I started looking around to get an idea of what view the nodes in the cluster had of node #23. 

Nodes in the rest of the cluster could telnet to node #23 on port 7000 the default `storage_port`. A simple test but it helps to know the basic assumptions are still valid.

All the nodes (including #23) had a consistent view of the state of the other nodes propagated via Gossip, for example:

    cassandra20# bin/nodetool -h localhost gossipinfo
    ...
    /10.29.60.10
      LOAD:2.98347080902E11
      STATUS:NORMAL,28356863910078205288614550619314017621
      RPC_ADDRESS:10.29.60.10
      SCHEMA:fe933880-19bd-11e1-0000-5ff37d368cb6
      RELEASE_VERSION:1.0.5 

The "Application State" transmitted via Gossip is not directly related to a node been marked as `DOWN` (more later), but at least I could see that Gossip was distributing the same information about the node around the cluster. The properties listed above have the following meaning:

* `LOAD`: The total live disk space used, in bytes.
* `STATUS`: The ring state of the node, it's token (if any) and some other information. `NORMAL` indicates the node is a normal member of the ring, the other options are `BOOT`, `LEAVING`, `LEFT`, `MOVING`.
* `RPC_ADDRESS`: IP address to connect to this node on. 
* `SCHEMA`: UUID of the schema this node is using.
* `RELEASE_VERSION`: Cassandra version. 

If Application State was responsible `nodetool ring` would have said something other than `DOWN` for node #23.

Node #23 should have been trying to tell the other nodes that it is here and happy to answer queries. So the next step was to look at the Gossip traffic and see if that was happening. I started by enabling `TRACE` debugging on the main `org.apache.cassandra.gms.Gossiper` class by adding the line below to  `conf/log4j-server.properties`, log4j is configured to watch for changes so you can just change the file and wait a few seconds. 

    log4j.logger.org.apache.cassandra.gms.Gossiper=TRACE
    
To disable a live change to the logging config like this it's not enough to just comment out the line. You will need to a provide a new value for the `Gossiper` logger. So after I saw what I wanted in `/var/log/cassandra/system.log` on node #20 I changed the line the logging config to be:

    log4j.logger.org.apache.cassandra.gms.Gossiper=INFO

This was the first thing I looked at in the logs on node #20:

    TRACE [GossipStage:1] 2011-12-13 00:58:49,636 Gossiper.java (line 647) local heartbeat version 526912 greater than 7951 for /10.29.60.10
    TRACE [GossipStage:1] 2011-12-13 00:58:49,636 Gossiper.java (line 661) Adding state LOAD: 2.98347080902E11
    TRACE [GossipStage:1] 2011-12-13 00:58:49,636 Gossiper.java (line 647) local heartbeat version 1231 greater than 1229 for /10.37.114.10
    TRACE [GossipStage:1] 2011-12-13 00:58:49,636 Gossiper.java (line 647) local heartbeat version 4892 greater than 4890 for /10.29.60.12


The first line was the important one, something in the cluster was telling node #20 about node #23. The `version` number referred to in the message is  part of the heartbeat, a higher version number means the heartbeat is more recent. So it looked like node #20 was remembering something about node #23 from one of the machines that had been restarted, that would explain the higher local version number. But that didn't make sense, Cassandra can handle nodes restarting.

This was not the right place to be looking. The log message could have been logged in response to information about node #23 that was sent from any other node. I needed to find proof of Gossip messages been received directly from node #23. 

Gossip uses a 3 step protocol, the initiating node sends an `Syn` message, the target replies with an `Ack` and the initiator replies with an `Ack2`. So I went hunting information about `Syn`'s received from node #23 by enabling `TRACE` logging on the verb handler: 

    log4j.logger.org.apache.cassandra.gms.GossipDigestSynVerbHandler=TRACE

This is what I found in the node #20 logs:

    TRACE [GossipStage:1] 2011-12-13 02:04:56,165 GossipDigestSynVerbHandler.java (line 46) Received a GossipDigestSynMessage from /10.29.60.10
    TRACE [GossipStage:1] 2011-12-13 02:04:56,166 GossipDigestSynVerbHandler.java (line 76) Gossip syn digests are : /10.6.130.70:1323732220:9792 /10.37.114.10:1323736718:5242 /10.29.60.12:1323733099:8904 /10.29.60.10:1762556151:11964 /10.29.60.14:1323732392:9619 /10.37.114.8:1323731527:10494 
    TRACE [GossipStage:1] 2011-12-13 02:04:56,166 GossipDigestSynVerbHandler.java (line 90) Sending a GossipDigestAckMessage to /10.29.60.10

It got a `Syn` from node #23 and replied with an `Ack`. It was receiving and responding to messages from node #23 but it still thought it was `DOWN`. Things were getting weirder, time to go check the code.

Right after logging that message `GossipDigestSynVerbHandler` [notifies the `FailureDetector`](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/GossipDigestSynVerbHandler.java#L79) that it had heard from the endpoint. The `FailureDetector` is ultimately responsible for deciding if a node is UP or DOWN, the clue is in the name. `GossipDigestSynVerbHandler` actually calls the main `Gossiper` class which does a few things and then decides if it wants to report to the `FailureDetector`. I just wanted to know if the call was made, so I enabled the logging again:

    log4j.logger.org.apache.cassandra.gms.GossipDigestSynVerbHandler=TRACE
    log4j.logger.org.apache.cassandra.gms.FailureDetector=TRACE
    
And found this in the logs on node #20:

    TRACE [GossipStage:1] 2011-12-13 02:14:37,033 GossipDigestSynVerbHandler.java (line 46) Received a GossipDigestSynMessage from /10.29.60.10
    TRACE [GossipStage:1] 2011-12-13 02:14:37,033 GossipDigestSynVerbHandler.java (line 76) Gossip syn digests are : /10.29.60.10:1762556151:12552 /10.29.60.14:1323732392:10208 /10.37.114.8:1323731527:11082 /10.37.114.10:1323736718:5830 /10.6.130.70:1323732220:10379 /10.29.60.12:1323733099:9493 
    TRACE [GossipStage:1] 2011-12-13 02:14:37,033 GossipDigestSynVerbHandler.java (line 90) Sending a GossipDigestAckMessage to /10.29.60.10
    TRACE [GossipStage:1] 2011-12-13 02:14:37,037 GossipDigestSynVerbHandler.java (line 46) Received a GossipDigestSynMessage from /10.37.114.10
    TRACE [GossipStage:1] 2011-12-13 02:14:37,037 GossipDigestSynVerbHandler.java (line 76) Gossip syn digests are : /10.37.114.10:1323736718:5831 /10.29.60.12:1323733099:9493 /10.6.130.70:1323732220:10379 /10.29.60.14:1323732392:10208 /10.37.114.8:1323731527:11082 /10.29.60.10:1762556151:526912 
    TRACE [GossipStage:1] 2011-12-13 02:14:37,037 GossipDigestSynVerbHandler.java (line 90) Sending a GossipDigestAckMessage to /10.37.114.10
    TRACE [GossipStage:1] 2011-12-13 02:14:37,038 FailureDetector.java (line 164) reporting /10.37.114.10
    TRACE [GossipStage:1] 2011-12-13 02:14:37,038 FailureDetector.java (line 164) reporting /10.29.60.12
    TRACE [GossipTasks:1] 2011-12-13 02:14:37,447 FailureDetector.java (line 185) PHI for /10.29.60.12 : 0.1740028340787402
    TRACE [GossipTasks:1] 2011-12-13 02:14:37,447 FailureDetector.java (line 185) PHI for /10.6.130.70 : 0.17769446955863263
    TRACE [GossipTasks:1] 2011-12-13 02:14:37,447 FailureDetector.java (line 185) PHI for /10.29.60.14 : 0.3766607052738764
    TRACE [GossipTasks:1] 2011-12-13 02:14:37,447 FailureDetector.java (line 185) PHI for /10.37.114.10 : 0.16292431576785454
    TRACE [GossipTasks:1] 2011-12-13 02:14:37,448 FailureDetector.java (line 185) PHI for /10.29.60.10 : 9511.26282656631
    TRACE [GossipTasks:1] 2011-12-13 02:14:37,448 FailureDetector.java (line 189) notifying listeners that /10.29.60.10 is down
    TRACE [GossipTasks:1] 2011-12-13 02:14:37,448 FailureDetector.java (line 190) intervals: 500.0 mean: 500.0
    TRACE [GossipTasks:1] 2011-12-13 02:14:38,453 FailureDetector.java (line 185) PHI for /10.29.60.12 : 0.6019902450401402
    TRACE [GossipTasks:1] 2011-12-13 02:14:38,453 FailureDetector.java (line 185) PHI for /10.6.130.70 : 0.5983077316197724
    TRACE [GossipTasks:1] 2011-12-13 02:14:38,453 FailureDetector.java (line 185) PHI for /10.29.60.14 : 0.7697319392007641
    TRACE [GossipTasks:1] 2011-12-13 02:14:38,453 FailureDetector.java (line 185) PHI for /10.37.114.10 : 0.5636623638423329
    TRACE [GossipTasks:1] 2011-12-13 02:14:38,454 FailureDetector.java (line 185) PHI for /10.29.60.10 : 9512.137495652863
    TRACE [GossipTasks:1] 2011-12-13 02:14:38,454 FailureDetector.java (line 189) notifying listeners that /10.29.60.10 is down
    TRACE [GossipTasks:1] 2011-12-13 02:14:38,454 FailureDetector.java (line 190) intervals: 500.0 mean: 500.0
    TRACE [GossipStage:1] 2011-12-13 02:14:38,454 FailureDetector.java (line 164) reporting /10.29.60.14
    TRACE [GossipStage:1] 2011-12-13 02:14:38,454 FailureDetector.java (line 164) reporting /10.37.114.10
    TRACE [GossipStage:1] 2011-12-13 02:14:38,454 FailureDetector.java (line 164) reporting /10.6.130.70
    TRACE [GossipStage:1] 2011-12-13 02:14:38,454 FailureDetector.java (line 164) reporting /10.29.60.12
    TRACE [GossipStage:1] 2011-12-13 02:14:39,030 GossipDigestSynVerbHandler.java (line 46) Received a GossipDigestSynMessage from /10.6.130.70

The first line shows a `Syn` message received from node #23, later a response `Ack` was sent and the next `Syn` handled without reporting to the `FailureDetector`. By contrast look at the next `Syn` message from 10.37.114.10, it results in the `FailureDetector` been told (via the `report()` function) that we've head from both 10.37.114.10 and 10.29.60.12. 

You can also see that the `FailureDetector` has logged some information about node #23 (10.29.60.10). At the [end of a Gossip round](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L167) the node [asks the `FailureDetector`](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L559) to [interpret](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/FailureDetector.java#L175) the information it has about each other node. The `FailureDetector` tracks the intervals between when it is told about a node, these values are interpreted every second to [calculate the PHI value](https://issues.apache.org/jira/browse/CASSANDRA-2597) used to determine the nodes liveness. By default a node with a `PHI` higher than 8 is considered `DOWN`, as you can see node #23 was way `DOWN`.

At the time I did not pay any attention to the other log messages from the `FailureDetector`, I just wanted to know why `report()` was not been called.

## Stop and think

This is what I knew:

* All nodes in the cluster other than node #23 had a consistent view that #23 was down. 
* New "Application State" about node #23 transmitted via Gossip was been ignored as the nodes thought it was from the past. 
* Direct Gossip messages from node #23 were not been reported to the FailureDetector.

So I put out a call for help on the #Cassandra IRC channel and started poking around [Gossiper.notifyFailureDetector()](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L694) to see why it was not reporting messages from node #23. 

My assumption was that the high heartbeat version number node #20 had locally for node #23 was the reason for not reporting to the `FailureDetector`, and [line 724](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L724) reinforce this view of the world. The `FailureDetector` was not called because the local version number was higher than the remote one. Done. I saw what I wanted to see, the version number is the problem. 

But I still didn't know why this was happening, it was unlikely to be a bug in the Gossip code. Rolling restarts are standard practice, we do them all the time. About this time I got some help from Brandon Williams (driftx) from [Data Stax](http://www.datastax.com) in the IRC room. Getting help is always good, and Gossip is Brandon's thing.

## Generational issues

Heartbeat versions are only part of how Gossip works out if new information it receives really is new, or is old information delivered out of order. Sitting above the version number is the Generation. When a major change occurs on a node, such as a restart or a changing tokens, the Generation number is increased

When a node detects a higher Generation for another endpoint in a `Syn` Gossip message it [clears the](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L706) the `FailureDetector` information for endpoint. More importantly it takes action to get the most recent information about the node. First the node [includes a request](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L951) in the `Ack` it returns to the gossiper for all the information it has about the endpoint where the generation has increased. Second when [processing](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L844) the digests in the returned `Ack2` message the local endpoint state is  [replaced](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/gms/Gossiper.java#L783) with the new state. 

When node #23 restarted it should have picked up a new Generation number and the other nodes in the cluster should have noticed the change and updated their local state. The simple way to test if this was happening was do another restart on node #23 and see what happened, yay for redundant clusters with no single point of failure.

While that was going on Brandon noticed that the Generation number for node #23 was strange. The number is initialized to the current UTC time in seconds when the server is first started. After than it is increased by 1 for every major change, such as a restart. The number shown in the logs and other places for node #23 was `1762556151`, which equates to **Fri, 07 Nov 2025 22:55:51 GMT**. 

This server was from the future. 

Still is should have incremented the Generation on restart and maintained the forward trajectory of the space time continuum. The restart completed. Node #23 came back on line with the same generation number `1762556151`. 

It was a server from the future that was stuck in present which was really it's past!

## Back to the future

The current Generation for a node is stored in the `LocationInfo` CF in the `System` KS. Every time the Generation is bumped it's read from there, incremented and written back. So the next step was to see what was actually stored in the CF using the `cassandra-cli`:

    [default@system] list LocationInfo;                      
    Using default limit of 100
    -------------------
    RowKey: Ring
    => (column=00, value=0a257208, timestamp=1323730075935)
    => (column=2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, value=0a068246, timestamp=1323730075923)
    => (column=40000000000000000000000000000000, value=0a1d3c0e, timestamp=1323730075897)
    => (column=55555555555555555555555555555555, value=0a25720a, timestamp=1323730075907)
    => (column=6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, value=0a1d3c0c, timestamp=1323730075944)
    -------------------
    RowKey: L
    => (column=436c75737465724e616d65, value=737069, timestamp=1320437246450000)
    => (column=47656e65726174696f6e, value=690e78f6, timestamp=1762556150811000)
    => (column=50617274696f6e6572, value=6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572, timestamp=1320437246450000)
    => (column=546f6b656e, value=15555555555555555555555555555555, timestamp=1762556150877)
    -------------------
    RowKey: Cookies
    => (column=5072652d312e302068696e747320707572676564, value=6f68207965732c2074686579207765726520707572676564, timestamp=1320437246470)
    -------------------
    RowKey: Bootstrap
    => (column=42, value=01, timestamp=1762556150877)

    4 Rows Returned.
    Elapsed time: 37 msec(s).
    
There were columns in the "L" row (the local node state) and the "Cookies" row that were written with a timestamp from the future (the ones that start with 17...). Any attempt to overwrite these columns would fail unless it used a higher time stamp. 

Here's the "L" row with proper formatting for the column names:

    [default@system] assume LocationInfo comparator as ascii; 
    Assumption for column family 'LocationInfo' added successfully.
    [default@system] get LocationInfo['L'];
    => (column=ClusterName, value=737069, timestamp=1320437246450000)
    => (column=Generation, value=690e78f6, timestamp=1762556150811000)
    => (column=Partioner, value=6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572, timestamp=1320437246450000)
    => (column=Token, value=15555555555555555555555555555555, timestamp=1762556150877)
    Returned 4 results.
    Elapsed time: 2 msec(s).

Generation is hex `690e78f6`, which is `1762556150` binary. When node #23 started it [read this value](https://github.com/apache/cassandra/blob/3d5d9a40720034368feddd2f442cd6851ce6a233/src/java/org/apache/cassandra/db/SystemTable.java#L312), added 1 to it to get `1762556151` and wrote it back. However the timestamp used to write it back was the current time, which was less than the one on disk so the write was ignored during reads. So the next time it started it got the same Generation number.

## Back to the present

The fix was to somehow get the Generation number to be increased. The approach I took was to delete the `Generation` column with the high time stamp, and purge it's existence out of the SSTables. It wasn't enough to just delete the column, I needed to delete it with a higher time stamp and then see that Tombstone was purged so that future writes with current time stamps would work as expected.

This approach was possible because the `GC_GRACE_SECONDS` on the `LocationInfo` CF is 0. So tombstones are committed to disk, but will be purged the first time compaction processes them. If `GC_GRACE_SECONDS` was higher I would have to either wait for the time to pass or temporarily reduce it. 

The other possible options were a full cluster stop and restart passing the `Dcassandra.load_ring_state=false` option. Or some form of monkeying with the token and/or IP address.

Here are the steps I took to get there, I've included a few additional ones to illustrate what was happening with the tombstone.

### Step 1 - Snapshot

Always backup data before you start exploring it's limits, think of it as safe word. If it all get's a little to scary just say the safe word and we can stop. 

    cassandra23# bin/nodetool -h localhost snapshot system -t pre-generation-delete
    Requested snapshot for: system 
    Snapshot directory: pre-generation-delete

I snap shot a lot when doing stuff like this so that I can roll back to any point. 

### Step 1 - Delete the Generation column

To specify a timestamp for the delete I used the [pycassaShell](http://pycassa.github.com/pycassa/assorted/pycassa_shell.html) bundled with the [pycassa](https://github.com/pycassa/pycassa) client, this is an interactive Python session with some handy tools.

Remember I wanted to delete the Generation column:

    [default@system] get LocationInfo['L'];
    => (column=ClusterName, value=737069, timestamp=1320437246450000)
    => (column=Generation, value=690e78f6, timestamp=1762556150811000)
    => (column=Partioner, value=6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572, timestamp=1320437246450000)
    => (column=Token, value=15555555555555555555555555555555, timestamp=1323805490467000)
    Returned 4 results.
    Elapsed time: 2 msec(s).

So I needed to specify a timestamp higher than 1762556150811000:

    cassandra23# ./pycassaShell -H 10.29.60.10 -k system
    [I]: IPython not found, falling back to default interpreter.
    ----------------------------------
    Cassandra Interactive Python Shell
    ----------------------------------
    Keyspace: system
    Host: 10.29.60.10:9160

    Available ColumnFamily instances:
     * HINTSCOLUMNFAMILY          ( HintsColumnFamily )
     * VERSIONS                   ( Versions )
     * INDEXINFO                  ( IndexInfo )
     * LOCATIONINFO               ( LocationInfo )
     * MIGRATIONS                 ( Migrations )
     * NODEIDINFO                 ( NodeIdInfo )
     * SCHEMA                     ( Schema )

    Schema definition tools and cluster information are available through SYSTEM_MANAGER.
    >>> LOCATIONINFO.remove("L", columns=["Generation"], timestamp=1762556150811001)

The Generation column was no longer returned in query results:

    [default@system] get LocationInfo['L'];
    => (column=ClusterName, value=737069, timestamp=1320437246450000)
    => (column=Partioner, value=6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572, timestamp=1320437246450000)
    => (column=Token, value=15555555555555555555555555555555, timestamp=1323805490467000)
    Returned 4 results.
    Elapsed time: 2 msec(s).

### Step 3 - Snapshot

Another snapshot for good luck. This one will also flush the `LocationInfo` CF so all of our changes are on disk.

    cassandra23# bin/nodetool -h localhost snapshot system -t post-generation-delete
    Requested snapshot for: system 
    Snapshot directory: post-generation-delete
    
### Step 4 - Check the delete

This was not necessary, I knew what was going to happen later but I like to confirm that my expectations are correct and it helps illustrate how tombstones work. What I expected to see was two SSTables for `LocationInfo`, the first would have all the columns we saw originally and the second would have the tombstone for the `Generation` column delete. 

First check which SSTables are on disk:

    cassandra23# ls -lah data/system
    total 9428
    ...
    -rw-r--r--  2 root  wheel   617B Dec 13 20:56 LocationInfo-hb-52-Data.db
    -rw-r--r--  2 root  wheel    68B Dec 13 20:56 LocationInfo-hb-52-Digest.sha1
    -rw-r--r--  2 root  wheel   1.9K Dec 13 20:56 LocationInfo-hb-52-Filter.db
    -rw-r--r--  2 root  wheel    61B Dec 13 20:56 LocationInfo-hb-52-Index.db
    -rw-r--r--  2 root  wheel   4.2K Dec 13 20:56 LocationInfo-hb-52-Statistics.db
    -rw-r--r--  2 root  wheel    80B Dec 13 21:18 LocationInfo-hb-54-Data.db
    -rw-r--r--  2 root  wheel    68B Dec 13 21:18 LocationInfo-hb-54-Digest.sha1
    -rw-r--r--  2 root  wheel    16B Dec 13 21:18 LocationInfo-hb-54-Filter.db
    -rw-r--r--  2 root  wheel    11B Dec 13 21:18 LocationInfo-hb-54-Index.db
    -rw-r--r--  2 root  wheel   4.2K Dec 13 21:18 LocationInfo-hb-54-Statistics.db

Excellent, there were two. So I used `sstable2json` to take a look in the oldest one:

    cassandra23# bin/sstable2json data/system/LocationInfo-hb-52-Data.db
    {'426f6f747374726170': [['42', '01', 1323805212929000]],
     '436f6f6b696573': [['5072652d312e302068696e747320707572676564',
                         '6f68207965732c2074686579207765726520707572676564',
                         1320437246470]],
     '4c': [['436c75737465724e616d65', '737069', 1320437246450000],
            ['47656e65726174696f6e', '690e78f6', 1762556150811000],
            ['50617274696f6e6572',
             '6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572',
             1320437246450000],
            ['546f6b656e', '15555555555555555555555555555555', 1323805490467000]],
     '52696e67': [['00', '0a257208', 1323730075935],
                  ['2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a068246', 1323730075923],
                  ['40000000000000000000000000000000', '0a1d3c0e', 1323730075897],
                  ['55555555555555555555555555555555', '0a25720a', 1323730075907],
                  ['6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a1d3c0c', 1323730075944]]}

I've reformatted the output a little. The row key `4c` is the "L" row from above, and the "Generation" column is the second column in the list with `47656e65726174696f6e` as the column name (it's just the hex encoded ASCII values). The column value and timestamp are the next two values. 

Now the newer SSTable:

    cassandra23# bin/sstable2json data/system/LocationInfo-hb-54-Data.db
    {
    "4c": [["47656e65726174696f6e","4ee7c086",1762556150811001,"d"]]
    }

There was a single row with the `4c` / "L" row key. That had a single column with "Generation" as the name, the local time of the deletion as the value, a sensible timestamp and "d" as a flag to indicate it's a `DeletedColumn`.

### Step 5 - Compact away the Tombstone.

It was time to purge the Tombstone by running a manual compaction on the `LocationInfo` CF.

cassandra23# bin/nodetool -h localhost compact system LocationInfo

### Step 6 - Confirm the purge

I now expected to see a single `LocationInfo` SSTable:

    cassandra23# ls -lah data/system/
    ...
    -rw-r--r--  1 root  wheel    68B Dec 13 21:24 LocationInfo-hb-55-Digest.sha1
    -rw-r--r--  1 root  wheel   976B Dec 13 21:24 LocationInfo-hb-55-Filter.db
    -rw-r--r--  1 root  wheel    61B Dec 13 21:24 LocationInfo-hb-55-Index.db
    -rw-r--r--  1 root  wheel   4.2K Dec 13 21:24 LocationInfo-hb-55-Statistics.db

In the SSTable the `4c` row should be present but the `47656e65726174696f6e` "Generation" column should not:

    cassandra23# bin/sstable2json data/system/LocationInfo-hb-55-Data.db
    {'426f6f747374726170': [['42', '01', 1323805212929000]],
     '436f6f6b696573': [['5072652d312e302068696e747320707572676564',
                         '6f68207965732c2074686579207765726520707572676564',
                         1320437246470]],
     '4c': [['436c75737465724e616d65', '737069', 1320437246450000],
            ['50617274696f6e6572',
             '6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572',
             1320437246450000],
            ['546f6b656e', '15555555555555555555555555555555', 1323805490467000]],
     '52696e67': [['00', '0a257208', 1323730075935],
                  ['2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a068246', 1323730075923],
                  ['40000000000000000000000000000000', '0a1d3c0e', 1323730075897],
                  ['55555555555555555555555555555555', '0a25720a', 1323730075907],
                  ['6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a1d3c0c', 1323730075944]]}

And just like that node #23 has no record of ever having a value for the "Generation" column. 

### Step 7 - Re-write the Generation number

The next time I restarted node #23 I needed it to get a Generation number greater than the one all the other nodes have for it. And for all restarts after that it should continue to increase the Generation.

So I set the Generation column to `1762556151` decimal or `690e78f7` hex using the `cassandra-cli`:
 
    [default@system] set LocationInfo['L']['Generation'] = bytes('690e78f7');
    Value inserted.
    Elapsed time: 1 msec(s).

And then just to check:

    [default@system] get LocationInfo['L'];                                  
    => (column=ClusterName, value=737069, timestamp=1320437246450000)
    => (column=Generation, value=690e78f7, timestamp=1323811677675000)
    => (column=Partioner, value=6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572, timestamp=1320437246450000)
    => (column=Token, value=15555555555555555555555555555555, timestamp=1323805490467000)
    Returned 4 results.
    Elapsed time: 1 msec(s).
    [default@system] 

Looks good, got the next Generation number in there and the timestamp is sane.

### Step 8 - Confirm the Generation re-write

To get the change on disk I flushed the CF:

    cassandra23# bin/nodetool -h localhost flush system LocationInfo

I now expected to see two SSTables for `LocationInfo` on disk:

    cassandra23# ls -lah data/system/
    total 9428
    -rw-r--r--  1 root  wheel   588B Dec 13 21:24 LocationInfo-hb-55-Data.db
    -rw-r--r--  1 root  wheel    68B Dec 13 21:24 LocationInfo-hb-55-Digest.sha1
    -rw-r--r--  1 root  wheel   976B Dec 13 21:24 LocationInfo-hb-55-Filter.db
    -rw-r--r--  1 root  wheel    61B Dec 13 21:24 LocationInfo-hb-55-Index.db
    -rw-r--r--  1 root  wheel   4.2K Dec 13 21:24 LocationInfo-hb-55-Statistics.db
    -rw-r--r--  1 root  wheel    80B Dec 13 21:32 LocationInfo-hb-57-Data.db
    -rw-r--r--  1 root  wheel    68B Dec 13 21:32 LocationInfo-hb-57-Digest.sha1
    -rw-r--r--  1 root  wheel    16B Dec 13 21:32 LocationInfo-hb-57-Filter.db
    -rw-r--r--  1 root  wheel    11B Dec 13 21:32 LocationInfo-hb-57-Index.db
    -rw-r--r--  1 root  wheel   4.2K Dec 13 21:32 LocationInfo-hb-57-Statistics.db

And if we poke into the new one:

    cassandra23# bin/sstable2json data/system/LocationInfo-hb-57-Data.db
    {
    "4c": [["47656e65726174696f6e","690e78f7",1323811677675000]]
    }

### Step 9 - Restart node #23

Before the restart node #23 was using 1762556151 as the Generation. This was because the previous on disk value was 1762556150, and when it started it read this and added 1. I had now set the on disk value to be 1762556151 so after the restart I expected the Generation to be 1762556152:

    cassandra23# bin/nodetool -h localhost info
    Token            : 28356863910078205288614550619314017621
    Gossip active    : true
    Load             : 275.44 GB
    Generation No    : 1762556152
    Uptime (seconds) : 495
    Heap Memory (MB) : 959.72 / 8032.00
    Data Center      : DC1
    Rack             : RAC_unknown  
    Exceptions       : 0
    
Aces. And finally on disk the value should be 1762556152 decimal or 690E78F8 hex:

    [default@system] get LocationInfo['L'];            
    => (column=ClusterName, value=737069, timestamp=1320437246450000)
    => (column=Generation, value=690e78f8, timestamp=1323812553690000)
    => (column=Partioner, value=6f72672e6170616368652e63617373616e6472612e6468742e52616e646f6d506172746974696f6e6572, timestamp=1320437246450000)
    => (column=Token, value=15555555555555555555555555555555, timestamp=1323805490467000)
    Returned 4 results.
    Elapsed time: 22 msec(s).
    
After the node came back online it started using the new Generation number and the other nodes saw it as UP.

## Wrapping up

I think in theory there is a danger that if we removed node #23 from the ring and added another node with the same IP in less than 4 days it will have problems with it's Generation not been seen as new. But thats a pretty small danger. 

The important thing in all this was that the site stayed up. It's one of the nicest things about working on Cassandra, you can fix problems while it's working.

Oh and I fixed the other columns with wacky time stamps and am about to write a patch to log when things like this happen.

