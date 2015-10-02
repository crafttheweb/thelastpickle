One of the things every Cassandra developer should know and regularly practice is using the `cassandra-stress` tool to benchmark schemas and configuration changes before pushing them out to production.

But wouldn't it be nice if you could graph the output of it?

## Graph it!

Using cassandra-stress today at its simplest involves something along the lines of…
```
cassandra-stress write n=10000 -rate threads=10
cassandra-stress mixed n=10000 -rate threads=10
```
The output of this is rather old-school looking like
```
Created keyspaces. Sleeping 1s for propagation.
Sleeping 2s...
Warming up WRITE with 50000 iterations...
INFO  21:41:38 New Cassandra host localhost/127.0.0.1:9042 added
Connected to cluster: Test Cluster
Datatacenter: datacenter1; Host: localhost/127.0.0.1; Rack: rack1
Running WRITE with 10 threads for 10000 iteration
type,      total ops,    op/s,    pk/s,   row/s,    mean,     med,     .95,     .99,    .999,     max,   time,   stderr, errors,  gc: #,  max ms,  sum ms,  sdv ms,      mb
total,         10000,   16386,   16386,   16386,     0.6,     0.4,     1.3,     3.4,    23.4,    25.7,    0.6,  0.00000,      0,      1,      17,      17,       0,     308


Results:
op rate                   : 16386 [WRITE:16386]
partition rate            : 16386 [WRITE:16386]
row rate                  : 16386 [WRITE:16386]
latency mean              : 0.6 [WRITE:0.6]
latency median            : 0.4 [WRITE:0.4]
latency 95th percentile   : 1.3 [WRITE:1.3]
latency 99th percentile   : 3.4 [WRITE:3.4]
latency 99.9th percentile : 23.4 [WRITE:23.4]
latency max               : 25.7 [WRITE:25.7]
Total partitions          : 10000 [WRITE:10000]
Total errors              : 0 [WRITE:0]
total gc count            : 1
total gc mb               : 308
total gc time (s)         : 0
avg gc time(ms)           : 17
stdev gc time(ms)         : 0
Total operation time      : 00:00:00
END
```
There's a lot of useful information here especially in the summary. But making effecient use of that middle section is cumbersome especially when the `n=` option becomes a much larger and more realistic stress number. Comparing consistency of latency numbers or investigating how 99th percentile latencies come about involves a bit of digging.

The lack of graphing ability to cassandra-stress was [raised](https://issues.apache.org/jira/browse/CASSANDRA-7918)¹ over a year ago by [Benedict](http://belliottsmith.com/) as DataStax's big brother to cassandra-stress: [cstar_perf](https://github.com/datastax/cstar_perf) has such graphing ability already and to which graphs you've probably seen before attached to various Cassandra jira issues and Planet Cassandra blog posts.

Once the patch from [CASSANDRA-7918](https://issues.apache.org/jira/browse/CASSANDRA-7918), or if you're willing to checkout [engima curry's cassandra fork](https://github.com/EnigmaCurry/cassandra/tree/7918-stress-graph) and build it yourself, to generate pretty graphs with cassandra-stress is as simple² as…
```
cassandra-stress write n=100000 -rate threads=10 -graph file=example-benchmark.html title=example revision=benchmark-0
cassandra-stress mixed n=100000 -rate threads=10 -graph file=example-benchmark.html title=example revision=benchmark-0
```
Now in the current directory you'll find a example-benchmark.html file. 
Opening this shows the pretty graphs with both write and read benchmarks for the "benchmark-0" revision. In the following image the revision is named "cassandra-2.0.16-lenovo-x1-carbon" and the number of requests was increased to ten million.


!graph-0.png! !graph-1.png!


The nice thing about this html file is that it's completely standalone so sharing it and posting it to jira issues is a practical thing to do. On top of that you just keep running further benchmarks with new revision names and they'll get added to the existing graph.
For example let's run a new benchmark revision
```
cassandra-stress write n=100000 -rate threads=10 -graph file=example-benchmark.html title=example revision=benchmark-1
cassandra-stress mixed n=100000 -rate threads=10 -graph file=example-benchmark.html title=example revision=benchmark-1
```
Refresh the graph and you see the comparison clearly between the two revisions. In this image I added three new revisions "cassandra-2.1.5-lenovo-x1-carbon", "cassandra-2.2.1-lenovo-x1-carbon", and "cassandra-3.0.0-rc1-lenovo-x1-carbon".


!graph-2.png! !graph-3.png!

**Building insightful eyecandy for your peers is so simple now.**

-- 
¹ Benedict in fact went further in raising the need for graphing more than want cstart_perf does today, which seems to also be in the works now.
² When running cassandra-stress you need to run the benchmark, and each revision, first in write mode. Once that is finished then you are free to run in read or mixed mode.
