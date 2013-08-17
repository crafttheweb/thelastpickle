---
layout: post
title: "Reading - A Retrospective on SEDA" 
category: Cassandra
---

[A Retrospective on SEDA](http://matt-welsh.blogspot.co.nz/2010/07/retrospective-on-seda.html) is a look back at the [Stage Event Driven Architecture](http://www.eecs.harvard.edu/~mdw/papers/seda-sosp01.pdf) by the Matt Welsh the author of the SEDA paper. Cassandra uses the SEDA model, as anyone who has needed to look at `nodetool tpstats` will know. So it's interesting to see how 10 years has altered his thoughts.

Historical context...

>It's important to keep in mind that I started work on SEDA around 1999. At the time, the server landscape looked pretty different than it does now. Linux threads were suffering a lot of scalability problems, so it was best to avoid using too many of them. Multicore machines were rare....
>
>These days, things are pretty different. Linux threading implementations have vastly improved. Multicores are the norm...

What was wrong...

> The most critical is the idea of connecting stages through event queues, with each stage having its own separate thread pool. As a request passes through the stage graph, it experiences multiple context switches, and potentially long queueing at busy stages. 

The local read and write paths in Cassandra execute within a single thread pool. However an end to end request with multiple nodes will normally use three stages: client connection thread, `READ` / `MUTATION`, `REQUEST_RESPONSE` (as well as threads used for the TCP connections). Crossing the node boundary is more expensive than a context switch. However local reads on the coordinator at CL ONE will not need to involve multiple node. 

> If I were to design SEDA today, I would decouple stages (i.e., code modules) from queues and thread pools (i.e., concurrency boundaries). Stages are still useful as a structuring primitive, but it is probably best to group multiple stages within a single "thread pool domain" where latency is critical. 

This sort of happens in Cassandra, Verbs are mapped to Stages. So multiple task types may be executed within a single Thread Pool.


> I was never completely happy with the SEDA I/O interface. My original work on Java NBIO was used as the foundation for Sandstorm's event-driven socket library... However, layering the SEDA stage abstraction on top proved to be a real pain; there are multiple threads responsible for polling for request completion, incoming sockets, and so forth, and performance is highly sensitive to the timing of these threads... The fact that SEDA never included proper nonblocking disk I/O was disappointing, but this just wasn't available at the time (and I decided, wisely, I think, not to take it on as part of my PhD.)
 
Cassandra uses synchronous I/O.

What was right...

> The most important contribution of SEDA, I think, was the fact that we made load and resource bottlenecks explicit in the application programming model. 

If I recall there was an 0.8 point release of Cassandra where the Gossip verbs moved from their own thread pool into a shared one. Under load nodes were more inclined to flap UP and DOWN as Gossip was not running frequently enough. Moving them back to their owen pool gave them the resources they needed.

> Requests are never "stalled" somewhere under the covers -- say, blocking on an I/O or waiting for a thread to be scheduled. You can always get at them and see where the bottlenecks are, just by looking at the queues.

The Cassandra "request" is a wait for a Condition to be set in the client connection thread. All the other work, which may include blocking IO, is sitting in queues and thread pools on potentially multiple machines.

> I haven't seen another high performance server design that tries to do this -- they mostly focus on peak performance, not performance under overload conditions, which was my main concern.

Cassandra nodes shed load in response to overload conditions, which can result in failed queries if the Consistency Level is not achieved. Because the number of read and write threads is controlled, the latency of local read or write operations typically remains constant. Once the thread pool becomes saturated the end to end latency of the request is dominated by the time spent waiting for a thread.

Cassandra nodes do not actively apply back pressure to slow down the requests from other nodes, or clients. Instead the Dynamic Snitch is used to try to avoid using nodes that are performing poorly from the perspective of the coordinator. Ultimately this ends with a node been marked as down if it cannot keep up with Gossip.



