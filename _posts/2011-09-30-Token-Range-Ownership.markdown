---
layout: post
title: "Token Range Ownership"
category: Cassandra
---

Recently, like 2 hours ago, I was planning some work to rebalance a Cassandra cluster and I wanted to see how the steps involved would effect the range ownership of the nodes. So I replicated the logic from [RandomPartitioner.describeOwnership()](https://github.com/apache/cassandra/blob/cassandra-0.8.6/src/java/org/apache/cassandra/dht/RandomPartitioner.java#L152) in a handy python script.

The script is available at [git hub](https://gist.github.com/1250496).

In my case I had an unbalanced cluster that looked like:

    Address         DC          Rack        Status State   Load            Owns    Token                                       
                                                                                  154009024815050802110273337963779530663     
    127.0.0.3    datacenter1 rack1       Up     Normal  430.51 GB       69.95%  	102889564695022956386161396156024583904     
    127.0.0.2     datacenter1 rack1       Up     Normal  430.26 GB       22.81%   	141704132449535340642001248672108470009     
    127.0.0.1    datacenter1 rack1       Up     Normal  725.61 GB       7.23%   	154009024815050802110273337963779530663

So I wanted to change the nodes to use the balanced tokens:

    0
    56713727820156410577229101238628035242
    113427455640312821154458202477256070484

As a side affect I also want to make the token order match the node IP / host name order, which makes things a little more confusing than they need to be. So each node, together with it's old and new token looks like:

    127.0.0.1
        154009024815050802110273337963779530663
        0
    127.0.0.2
        141704132449535340642001248672108470009
        56713727820156410577229101238628035242
    127.0.0.3
        102889564695022956386161396156024583904
        113427455640312821154458202477256070484

To get an idea of what the cluster balance would look like as I performed the `nodetool move` operations I passed the initial tokens as a space separated list to the script and used the `--interactive` arg so I could easily enter the changes I wanted to make.

Here are the initial tokens, in the order of the host names.

    ./token_range.py --interactive 154009024815050802110273337963779530663 141704132449535340642001248672108470009 102889564695022956386161396156024583904
    154009024815050802110273337963779530663 141704132449535340642001248672108470009 102889564695022956386161396156024583904
    69.95% - 102889564695022956386161396156024583904
    22.81% - 141704132449535340642001248672108470009
     7.23% - 154009024815050802110273337963779530663

First change is to wrap the token for `0.1` around to 0:

    Next tokens: 0 141704132449535340642001248672108470009 102889564695022956386161396156024583904
    0 141704132449535340642001248672108470009 102889564695022956386161396156024583904
    16.71% - 0
    60.47% - 102889564695022956386161396156024583904
    22.81% - 141704132449535340642001248672108470009

Next center the middle token:

    Next tokens: 0 56713727820156410577229101238628035242 102889564695022956386161396156024583904
    0 56713727820156410577229101238628035242 102889564695022956386161396156024583904
    39.53% - 0
    33.33% - 56713727820156410577229101238628035242
    27.14% - 102889564695022956386161396156024583904

Finally sort out the little piggy at the end:

    Next tokens: 0 56713727820156410577229101238628035242 113427455640312821154458202477256070484
    0 56713727820156410577229101238628035242 113427455640312821154458202477256070484
    33.33% - 0
    33.33% - 56713727820156410577229101238628035242
    33.33% - 113427455640312821154458202477256070484

**Note:** The only testing this had was that it worked for me and matched what a live cluster was saying.