---
layout: post
title: Partitioning Cassandra for Fun and Timeouts
author: Aaron Morton
category: blog
tags: cassandra
---

Timeout errors in Apache Cassandra occur when less than `Consistency Level` number of replicas return to the coordinator. It's the distributed systems way of shrugging and saying "ooo not in the colour mate". From the Coordinators perspective the request may have been lost, the replica may have failed while doing the work, or the response may have been lost. Recently we wanted to test how write timeouts were handled as part of back porting [CASSANDRA-8819](https://issues.apache.org/jira/browse/CASSANDRA-8819) for a client. To do so we created a network partition that dropped response messages from a node. 

## The Cluster

We used [CCM](https://github.com/pcmanus/ccm) to create a local cluster and [iptables](https://en.wikipedia.org/wiki/Iptables) to add the network partition. OSX does not ship with iptables so the work was done on Ubuntu Trusty. To start with I created a 3 node cluster using CCM:

    ccm create -n 3 -v 2.1.8 timeout
    ccm start

We will be using `node2` for all the operations (no time to explain now) so let's check that the cluster looks normal from it's perspective:

    $ ccm node2 status

    Datacenter: datacenter1
    =======================
    Status=Up/Down
    |/ State=Normal/Leaving/Joining/Moving
    --  Address    Load       Tokens  Owns (effective)  Host ID                               Rack
    UN  127.0.0.1  46.57 KB   1       66.7%             25f8e2df-5ff1-46e7-aaef-adffbfeb1879  rack1
    UN  127.0.0.2  46.58 KB   1       66.7%             62377aae-5af5-41b2-b9ec-a4ecd83188a7  rack1
    UN  127.0.0.3  46.58 KB   1       66.7%             42460c04-f753-4766-87dc-0cd649bd045a  rack1

Looks good, time to check we can insert some data. I want to ensure `node2` can talk to all other nodes so will use `ALL` Consistentcy Level. 

Connect to the `cqlsh` shell on `node2` using:

    $ ccm node2 cqlsh

The give it a little work to do:

    create keyspace timeout WITH replication = {'class':'NetworkTopologyStrategy', 'datacenter1':3};
    use timeout;
    create table foo (
         foo text primary key,
         bar text
    );
    consistency all;
    insert into foo (foo, bar) values ('foo', 'bar');

These commands should complete successfully, proving that an insert sent to `node2` can be successfully replicated to all nodes. 

## The Ports

To add our network partition we will need to understand how the nodes are talking to each other. Begin by getting the `pid` for `node3`, this is the node we will partition from `node2`. Using these two nodes makes it a little easier to understand as they are listening on `127.0.0.3` and `127.0.0.2` respectively. 

CCM stores the `pid` in a local file:

    $ cat ~/.ccm/timeout/node3/cassandra.pid 
    15603

And we can get the list of open IP files using:

    $ sudo lsof -i -P | grep 15603
    15603 vagrant   49u  IPv4 230602      0t0  TCP localhost:7300 (LISTEN)
    15603 vagrant   50u  IPv4 230603      0t0  TCP localhost:46648 (LISTEN)
    15603 vagrant   59u  IPv4 230740      0t0  TCP 127.0.0.3:7000->localhost:55864 (ESTABLISHED)
    15603 vagrant   60u  IPv4 230632      0t0  TCP 127.0.0.3:7000 (LISTEN)
    15603 vagrant   61u  IPv4 230633      0t0  TCP 127.0.0.3:7000->localhost:55856 (ESTABLISHED)
    15603 vagrant   62u  IPv4 230741      0t0  TCP localhost:44855->127.0.0.2:7000 (ESTABLISHED)
    15603 vagrant   66u  IPv6 231370      0t0  TCP 127.0.0.3:9042 (LISTEN)
    15603 vagrant   67u  IPv4 231372      0t0  TCP 127.0.0.3:9160 (LISTEN)
    15603 vagrant   68u  IPv4 230637      0t0  TCP localhost:57876->localhost:7000 (ESTABLISHED)
    15603 vagrant   81u  IPv4 230732      0t0  TCP 127.0.0.3:7000->localhost:55857 (ESTABLISHED)

This shows the node is listening on five ports, has three incoming connections, and has two outgoing connections to other nodes. The tricky part here is that all outgoing connections from all nodes in our cluster are coming from the `localhost`. This is because the `127.0.0.2` and `127.0.0.3` interfaces are aliases for `127.0.0.1`. It makes things a little more complex, but we can handle it. 

The ports we are `LISTEN`'ing on are:

* `localhost:7300 (LISTEN)` for JMX, this non default value is set by the CCM tool. 
* `localhost:46648 (LISTEN)` I'm not sure what this is, may be JMX related ? 
* `127.0.0.3:7000 (LISTEN)` for unsecured internode traffic, this is known as the storage port. 
* `127.0.0.3:9042 (LISTEN)` for our old friend Thrift client connections. 
* `127.0.0.3:9160 (LISTEN)` for the groovy funky CQL over Native Binary client connections.

The three `ESTABLISHED` incoming connections we have are connections to port 7000 (the storage port) on `127.0.0.3`:

* 127.0.0.3:7000->localhost:55864 (ESTABLISHED)
* 127.0.0.3:7000->localhost:55856 (ESTABLISHED)
* 127.0.0.3:7000->localhost:55857 (ESTABLISHED)

With two other nodes to talk you may expect to only have two incoming connections. In fact each node has two outgoing connections to every other node, one called the `ackCon` (Acknowledgement Connection) and one called the `cmdCon` (Command Connection). If a node wants to get another to perform a task such as a mutation it will send a message on the `cmdCon`. When the remote node has completed it will respond on the `ackCon` it established.

This code sample from [OutboundTcpConnectionPool](https://github.com/apache/cassandra/blob/trunk/src/java/org/apache/cassandra/net/OutboundTcpConnectionPool.java) shows the process:

    OutboundTcpConnection getConnection(MessageOut msg)
    {
        Stage stage = msg.getStage();
        return stage == Stage.REQUEST_RESPONSE || stage == Stage.INTERNAL_RESPONSE || stage == Stage.GOSSIP
               ? ackCon
               : cmdCon;
    }

We can now reason about why we have the three connections given what actions the cluster has performed. From the perspective `node3`, both nodes 1 and 2 connected to port `7000` to establish an `ackCon` to send Gossip messages used for cluster health. Additionally `node2` connected a `cmdCon` as the client sent an `INSERT` statement that needed to be sent to `node3`.

The two `ESTABLISHED` outgoing connections we have are connections to port 7000 (the storage port) on nodes 1 and 2:

* localhost:44855->127.0.0.2:7000 (ESTABLISHED)
* localhost:57876->localhost:7000 (ESTABLISHED)

The reason that we only have two connections should now be clear. `node3` has only sent Gossip messages and as such has not opened a `cmdCon` to any nodes. Later we will want to know which connection is the `ackCon` to `node2`, running on `127.0.0.2`, so let's make a note of it now:

    15603 vagrant   62u  IPv4 230741      0t0  TCP localhost:44855->127.0.0.2:7000 (ESTABLISHED)

Now is a good time to test our view of the world, and the best way to do that is make a prediction. If we connect to `node3` and run an `INSERT` that hits all the nodes `node3` will open a second connection to `127.0.0.2` to serve as the `cmdCon`. 

We can run the command using:

    $ ccm node3 cqlsh
    Connected to timeout at 127.0.0.3:9042.
    [cqlsh 5.0.1 | Cassandra 2.1.8-SNAPSHOT | CQL spec 3.2.0 | Native protocol v3]
    Use HELP for help.
    cqlsh> use timeout;
    cqlsh:timeout> consistency all;
    Consistency level set to ALL.
    cqlsh:timeout> insert into foo (foo, bar) values ('foo', 'bar');

And then check the connections using:

    $ sudo lsof -i -P | grep 15603
    15603 vagrant   49u  IPv4 230602      0t0  TCP localhost:7300 (LISTEN)
    15603 vagrant   50u  IPv4 230603      0t0  TCP localhost:46648 (LISTEN)
    15603 vagrant   59u  IPv4 230740      0t0  TCP 127.0.0.3:7000->localhost:55864 (ESTABLISHED)
    15603 vagrant   60u  IPv4 230632      0t0  TCP 127.0.0.3:7000 (LISTEN)
    15603 vagrant   61u  IPv4 230633      0t0  TCP 127.0.0.3:7000->localhost:55856 (ESTABLISHED)
    15603 vagrant   62u  IPv4 230741      0t0  TCP localhost:44855->127.0.0.2:7000 (ESTABLISHED)
    15603 vagrant   66u  IPv6 231370      0t0  TCP 127.0.0.3:9042 (LISTEN)
    15603 vagrant   67u  IPv4 231372      0t0  TCP 127.0.0.3:9160 (LISTEN)
    15603 vagrant   68u  IPv4 230637      0t0  TCP localhost:57876->localhost:7000 (ESTABLISHED)
    15603 vagrant   74u  IPv6 232267      0t0  TCP 127.0.0.3:9042->localhost:47639 (ESTABLISHED)
    15603 vagrant   75u  IPv6 232270      0t0  TCP 127.0.0.3:9042->localhost:47640 (ESTABLISHED)
    15603 vagrant   76u  IPv4 232276      0t0  TCP localhost:57892->localhost:7000 (ESTABLISHED)
    15603 vagrant   77u  IPv4 232278      0t0  TCP localhost:44868->127.0.0.2:7000 (ESTABLISHED)
    15603 vagrant   81u  IPv4 230732      0t0  TCP 127.0.0.3:7000->localhost:55857 (ESTABLISHED)


We now have two connections to `127.0.0.2`, one from port `44855` that we had previously and one from `44868` for the `cmdCon`.

## The Partition

Everything is working so it's time to break it. We will block incoming traffic that is on the `ackCon` from `node3` to `node2`. With this in place `node3` should do the work and but fail to tell `node2`.

We can block the traffic using the following:

     iptables  -A INPUT -p tcp --source 127.0.0.1 --source-port 44855 --destination 127.0.0.2 --destination-port 7000 -j DROP

There are a few things to note here. 

* `--source 127.0.0.1` filters traffic starting from the `localhost` because all connections originate from the `localhost`.
* `--source-port 44855` because this is is the port we identified as originating the `ackCon` from `node3` to `node2`.
* `--destination-port 7000` because we are blocking traffic that arrives at the storage port.

To remove this rule later run the same command with a `-D`:

     iptables  -D INPUT -p tcp --source 127.0.0.1 --source-port 44855 --destination 127.0.0.2 --destination-port 7000 -j DROP

After running the command we can check the configuration using:

    $ sudo iptables --list -n
    Chain INPUT (policy ACCEPT)
    target     prot opt source               destination         
    DROP       tcp  --  127.0.0.1            127.0.0.2            tcp spt:44855 dpt:7000

    Chain FORWARD (policy ACCEPT)
    target     prot opt source               destination         

    Chain OUTPUT (policy ACCEPT)
    target     prot opt source               destination  

Strangely enough this change does not change the view of the cluster for either `node2` or `node3`:

    $ ccm node2 status timeout

    Datacenter: datacenter1
    =======================
    Status=Up/Down
    |/ State=Normal/Leaving/Joining/Moving
    --  Address    Load       Tokens  Owns (effective)  Host ID                               Rack
    UN  127.0.0.1  66.46 KB   1       100.0%            25f8e2df-5ff1-46e7-aaef-adffbfeb1879  rack1
    UN  127.0.0.2  66.47 KB   1       100.0%            62377aae-5af5-41b2-b9ec-a4ecd83188a7  rack1
    UN  127.0.0.3  66.46 KB   1       100.0%            42460c04-f753-4766-87dc-0cd649bd045a  rack1

    $ ccm node3 status timeout

    Datacenter: datacenter1
    =======================
    Status=Up/Down
    |/ State=Normal/Leaving/Joining/Moving
    --  Address    Load       Tokens  Owns (effective)  Host ID                               Rack
    UN  127.0.0.1  66.46 KB   1       100.0%            25f8e2df-5ff1-46e7-aaef-adffbfeb1879  rack1
    UN  127.0.0.2  66.47 KB   1       100.0%            62377aae-5af5-41b2-b9ec-a4ecd83188a7  rack1
    UN  127.0.0.3  66.46 KB   1       100.0%            42460c04-f753-4766-87dc-0cd649bd045a  rack1 

This is because the other nodes are continuing to gossip about `node3` to `node2`. It's still hearing that it is up. Finally we can run the `INSERT` from `node2`:

    $ ccm node2 cqlsh
    Connected to timeout at 127.0.0.2:9042.
    [cqlsh 5.0.1 | Cassandra 2.1.8-SNAPSHOT | CQL spec 3.2.0 | Native protocol v3]
    Use HELP for help.
    cqlsh> use timeout;
    cqlsh:timeout> consistency all;
    Consistency level set to ALL.
    cqlsh:timeout> insert into foo (foo, bar) values ('foo', 'bar');
    WriteTimeout: code=1100 [Coordinator node timed out waiting for replica nodes' responses] message="Operation timed out - received only 2 responses." info={'received_responses': 2, 'required_responses': 3, 'consistency': 'ALL'}
    cqlsh:timeout> 

This is what we wanted to see. From the coordinators point of view there was enough nodes to start the request, so it sent commands to all the available replicas. But after that? _shrug_. Our theory is that `node3` did the work and sent a response to `node2` that was blocked. We can confirm that by enabling tracing and running it again:

    cqlsh:timeout> tracing on;
    Now Tracing is enabled
    cqlsh:timeout> insert into foo (foo, bar) values ('foo', 'bar');
    WriteTimeout: code=1100 [Coordinator node timed out waiting for replica nodes' responses] message="Operation timed out - received only 2 responses." info={'received_responses': 2, 'required_responses': 3, 'consistency': 'ALL'}
    Statement trace did not complete within 10 seconds

We also need to remove the IP Tables rule to ensure we can `SELECT` from the tracing tables in cassandra: 

    $ sudo iptables  -D INPUT -p tcp -s 127.0.0.1 --source-port 44855 -d 127.0.0.2 --destination-port 7000 -j DROP
    $ sudo iptables --list -n
    Chain INPUT (policy ACCEPT)
    target     prot opt source               destination         

    Chain FORWARD (policy ACCEPT)
    target     prot opt source               destination         

    Chain OUTPUT (policy ACCEPT)
    target     prot opt source               destination 

Back to `cqlsh` on `node2`, there should be a single trace:

    cqlsh:timeout> select session_id from system_traces.sessions;

     session_id                           
    --------------------------------------
     53eb91c0-702b-11e5-b0eb-1ba3f54909df 

And we can see the events in the trace by:

    cqlsh:timeout> select activity, source, source_elapsed from system_traces.events where session_id = 53eb91c0-702b-11e5-b0eb-1ba3f54909df order by event_id;

     activity                                                  | source    | source_elapsed 
    -----------------------------------------------------------+-----------+----------------
                     MUTATION message received from /127.0.0.2 | 127.0.0.1 |             54 
     Parsing insert into foo (foo, bar) values ('foo', 'bar'); | 127.0.0.2 |            736 
                                           Preparing statement | 127.0.0.2 |           1202 
                             Determining replicas for mutation | 127.0.0.2 |           1372 
                        Sending MUTATION message to /127.0.0.3 | 127.0.0.2 |           1692 
                     MUTATION message received from /127.0.0.2 | 127.0.0.3 |             52 
                        Sending MUTATION message to /127.0.0.1 | 127.0.0.2 |           1891 
                                        Appending to commitlog | 127.0.0.2 |           4411 
                                        Adding to foo memtable | 127.0.0.2 |           4607 
             REQUEST_RESPONSE message received from /127.0.0.1 | 127.0.0.2 |           6924 
                           Processing response from /127.0.0.1 | 127.0.0.2 |          11471 
                                        Appending to commitlog | 127.0.0.1 |           1887 
                                        Adding to foo memtable | 127.0.0.1 |           2040 
                              Enqueuing response to /127.0.0.2 | 127.0.0.1 |           2259 
                Sending REQUEST_RESPONSE message to /127.0.0.2 | 127.0.0.1 |           2794 
                                        Appending to commitlog | 127.0.0.3 |          12936 
                                        Adding to foo memtable | 127.0.0.3 |          13081 
                              Enqueuing response to /127.0.0.2 | 127.0.0.3 |          15809 
                Sending REQUEST_RESPONSE message to /127.0.0.2 | 127.0.0.3 |          16613 
               Write timeout; received 2 of 3 required replies | 127.0.0.2 |        2001743 

Inspecting the events from `127.0.0.3` we can see it did the `INSERT`, the "Appending to commitlog" and "Adding to foo memtable" events show the local write. It then sent the acknowledgement shown by the "Enqueuing response to /127.0.0.2" and "Sending REQUEST_RESPONSE message to /127.0.0.2" events. Then our Coordinator timed out after approximately 2 seconds as the iptables rule prevented the response from arriving. 

## Failing At QUORUM

A more common scenario is to fail when using `QUORUM` Consistency Level. To do that we simply need to take one node down and run the process again. When I went through this I had restarted the cluster so needed to setup the rules again. So here are all the steps again, assuming you have the cluster and the schema from above:

Shutdown `node1`:

    ccm node1 stop

Confirm it is down:

    $ ccm node2 status timeout

    Datacenter: datacenter1
    =======================
    Status=Up/Down
    |/ State=Normal/Leaving/Joining/Moving
    --  Address    Load       Tokens  Owns (effective)  Host ID                               Rack
    DN  127.0.0.1  66.46 KB   1       100.0%            25f8e2df-5ff1-46e7-aaef-adffbfeb1879  rack1
    UN  127.0.0.2  140.67 KB  1       100.0%            62377aae-5af5-41b2-b9ec-a4ecd83188a7  rack1
    UN  127.0.0.3  122.28 KB  1       100.0%            42460c04-f753-4766-87dc-0cd649bd045a  rack1

Get the `pid` for `node3`:

    $ cat ~/.ccm/timeout/node3/cassandra.pid 
    15603

Get the source port for the `ackCon` from `node3` to `node2`:

    $ lsof -i -P | grep 15603 | grep 127.0.0.2
    java      15603 vagrant   59u  IPv4 421995      0t0  TCP localhost:60472->127.0.0.2:7000 (ESTABLISHED)

Add a rule to block traffic:

    $ sudo iptables  -A INPUT -p tcp --source 127.0.0.1 --source-port 60472 --destination 127.0.0.2 --destination-port 7000 -j DROP

Using `cqlsh` on `node2`:

    $ ccm node2 cqlsh
    Connected to timeout at 127.0.0.2:9042.
    [cqlsh 5.0.1 | Cassandra 2.1.8-SNAPSHOT | CQL spec 3.2.0 | Native protocol v3]
    Use HELP for help.
    cqlsh> use timeout;
    cqlsh:timeout> consistency quorum;
    Consistency level set to QUORUM.
    cqlsh:timeout> insert into foo (foo, bar) values ('foo', 'bar');
    WriteTimeout: code=1100 [Coordinator node timed out waiting for replica nodes' responses] message="Operation timed out - received only 1 responses." info={'received_responses': 1, 'required_responses': 2, 'consistency': 'QUORUM'}

## Caveat Emptor

Nodes can and do reestablish connections. I've not dived into the code to understand the how's and the why's and the do you mind if I dont's. The thing to remember that the source port is not guaranteed to be stable. 