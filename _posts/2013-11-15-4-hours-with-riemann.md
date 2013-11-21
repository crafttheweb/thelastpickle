---
layout: post
title: Four Hours with Riemann
author: Aaron Morton
category: blog
tags: cassandra, riemann, monitoring
---

I recently found an afternoon to play with [Riemann](http://riemann.io/), something I've been wanting to do for a while. A lot of people have said nice things about it and it was time we got in on the action. One of the catalysts for action was the addition of configurable reporters for the [Metrics](http://metrics.codahale.com/) library in Cassandra v2.0.2. If you've not heard about this head over to the DataStax blog and read the [guest post](http://www.datastax.com/dev/blog/pluggable-metrics-reporting-in-cassandra-2-0-2) by [Chris Burroughs](https://twitter.com/csby54).

Going into this my understanding of Riemann was based on glancing at the web site and things I'd read on Twitter. I thought it would let me monitor Cassandra in real time, which it did. I thought it would be nice, which it was. I thought it would have more features than I could grasp in four hours, and it did.

## Readying the Reporter

My plan was to use a [Metrics reporter](http://metrics.codahale.com/manual/core/#reporters) to push data from Cassandra to Riemann. Kyle had created a [Java library](http://aphyr.com/posts/231-riemann-recap-client-libraries-and-performance) for Riemann that [included](https://github.com/aphyr/riemann-java-client) a Metrics Reporter. A reporter collects metrics from the [MetricRegistry](http://metrics.codahale.com/manual/core/#metric-registries) and does something with them. Cassandra uses the `JmxReporter` to make the metrics available via JMX. The `RiemannReporter` collects metrics that match some rules and pushes them to the Riemann server. This removes one part from the deployment, so if the Cassandra server is running there is a good chance the metrics are being reported.

I was able to use the `RiemannReporter` without any changes. I simply built the target and downloaded the dependencies so I could put them in the Cassandra library path later. 

    mvn install
    mvn dependency:copy-dependencies

This compiles to `riemann-java-client-0.2.9-SNAPSHOT` in the `target/` dir and downloads the dependencies to `target/dependency`.
 
Later we will need to call [RiemannReporter.enable()](https://github.com/aphyr/riemann-java-client/blob/master/src/main/java/com/yammer/metrics/reporting/RiemannReporter.java#L115) to start the reporter so it's a good idea to take a look at that code now. It need a [RiemannReporter.Config](https://github.com/aphyr/riemann-java-client/blob/master/src/main/java/com/yammer/metrics/reporting/RiemannReporter.java#L43) object that we build and supply when Cassandra starts the reporters.

## Conflating the Configuration

Cassandra 2.0.2 adds the ability to start Metrics Reporters through a configuration file that drives  [`metrics-reporter-config`](https://github.com/addthis/metrics-reporter-config). The configuration file is specified on the command line when starting Cassandra using the `cassandra.metricsReporterConfigFile` parameter. For my example I added this to `cassandra-env.sh`:

    JVM_OPTS="$JVM_OPTS -Dcassandra.metricsReporterConfigFile=my-metrics.yaml" 

My `my-metrics.yaml` file was based on `conf/metrics-reporter-config-sample.yaml` that ships with Cassandra 2.0.2 and was placed in `config/`. Out of the box there is support for reporting to the `console`, 'csv', 'ganglia' or 'graphite'. All of these are fine choices but none of them will connect directly to Riemann. To use the `RiemannReporter` I needed to modify `ReporterConfig` to expose it as a property for the `snakeyaml` to set. Currently the change is in our [fork of metrics-reporter-config](https://github.com/TheLastPickle/metrics-reporter-config), we will get a PR sorted shortly. 

I updated `ReporterConfig` to have a list of `RiemannReporterConfig` objects that both hold the config for the reporter and enable it. The config objects have a pretty simple life; it's created and populated by `snakeyaml` and we then call it to construct and start the reporter.

XX MAVEN CHANGES XX

Finally I needed to compile the project to get a `jar` to replace the one that ships with Cassandra 2.0.2.

With those changes in place the next time I started Cassandra it would read `my-metrics.yaml` and start pushing metrics to the Riemann server. The configuration below will send metrics every second to `localhost` on TCP port `5555`. I've asked for the thread pool, client request and column family metrics:

{% highlight yaml %}
riemann:
  -
    period: 1
    timeunit: 'SECONDS'
    hosts:
      - host: 'localhost'
        port: 5555
    predicate:
      color: "white"
      useQualifiedName: true
      patterns:
        - "^org.apache.cassandra.metrics.ThreadPools.+"
        - "^org.apache.cassandra.metrics.ClientRequest.+"
        - "^org.apache.cassandra.metrics.ColumnFamily.Keyspace1.Standard1.+"
{% endhighlight %}

I was planning to generate some load using `cassandra-stress` and wanted to see the write load on Standard1 Column Family it uses.

## Running with Riemann

Riemann has a good [quick start guide](http://riemann.io/quickstart.html) that I used to get going. It's worth a read as I've only listed the few commands I used. I did encounter an [error](https://gist.github.com/amorton/f6dbcc3c9d7c4e4729b8) on startup using the latest 0.2.3 release on OSX Mavericks. Dropping back to 0.2.2 solved it for me, there is a [thread](XXX) on the user list for anyone playing along at home. 

To get the server running I downloaded the [tar ball](http://aphyr.com/riemann/riemann-0.2.2.tar.bz2), unpacked it and ran `bin/riemann etc/riemann.config`. 

    aarons-MBP-2011:riemann-0.2.2 aaron$ bin/riemann etc/riemann.config
    INFO [2013-11-18 20:19:38,688] main - riemann.bin - PID 11513
    INFO [2013-11-18 20:19:38,826] clojure-agent-send-off-pool-4 - riemann.transport.tcp - TCP server 127.0.0.1 5555 online
    INFO [2013-11-18 20:19:38,826] clojure-agent-send-off-pool-2 - riemann.transport.udp - UDP server 127.0.0.1 5555 16384 online
    INFO [2013-11-18 20:19:38,826] clojure-agent-send-off-pool-0 - riemann.transport.websockets - Websockets server 127.0.0.1 5556 online
    INFO [2013-11-18 20:19:38,829] main - riemann.core - Hyperspace core online

_Note:_ If you edit `etc/riemann.config` and add the following to the end the server will log all events to the console, this can be useful when you are just starting.
    
    ; print events to the log
    (streams
            prn)

To get the dashboard running I installed the ruby client, tools and dashboard using `gem install riemann-client riemann-tools riemann-dash`. Then started the dashboard.

    aarons-MBP-2011:riemann-0.2.3 aaron$ riemann-dash
    No configuration loaded; using defaults.
    == Sinatra/1.4.4 has taken the stage on 4567 for development with backup from Thin
    Thin web server (v1.6.1 codename Death Proof)
    Maximum connections set to 1024
    Listening on localhost:4567, CTRL+C to stop

The quick start guide explains how to run a ping test program that creates some data to view in the dashboard.

## Cranking with Cassandra

To keep things simple I was running with the stock Cassandra 2.0.2 bin tar ball. As this was a quick hack job I made the following changes to the `lib/` dir:

* copied `target/riemann-java-client-0.2.9-SNAPSHOT` from `riemann-java-client`
* copied `target/dependency/*.*` from `riemann-java-client` removed `netty-3.6.1.Final.jar` and `metrics-core-2.1.2.jar` as they are older versions of jar's that cassandra ships with.
* copied `target/reporter-config-2.2.0-SNAPSHOT.jar` from `metrics-reporter-config`
* remove `reporter-config-2.2.0`

When everything works Cassandra will log the following during startup (after the log has replayed):

    INFO 20:38:13,813 Startup completed! Now serving reads.
    INFO 20:38:13,817 Trying to load metrics-reporter-config from file: my-metrics.yaml
    INFO 20:38:13,856 Enabling RiemannReporter to localhost:5555

At this point Cassandra will be sending metrics to the Riemann server. If you added the verbose logging to the Riemann configuration you should see something like this:

    #riemann.codec.Event{:host "aarons-MBP-2011.local", :service " org.apache.cassandra.metrics ThreadPools request.MutationStage ActiveTasks", :state nil, :description nil, :metric 0, :tags nil, :time 1384844560, :ttl nil}
    #riemann.codec.Event{:host "aarons-MBP-2011.local", :service " org.apache.cassandra.metrics ThreadPools request.MutationStage CompletedTasks", :state nil, :description nil, :metric 89321, :tags nil, :time 1384844560, :ttl nil}
    #riemann.codec.Event{:host "aarons-MBP-2011.local", :service " org.apache.cassandra.metrics ThreadPools request.MutationStage CurrentlyBlockedTasks", :state nil, :description nil, :metric 0, :tags nil, :time 1384844560, :ttl nil}
    #riemann.codec.Event{:host "aarons-MBP-2011.local", :service " org.apache.cassandra.metrics ThreadPools request.MutationStage PendingTasks", :state nil, :description nil, :metric 0, :tags nil, :time 1384844560, :ttl nil}
    #riemann.codec.Event{:host "aarons-MBP-2011.local", :service " org.apache.cassandra.metrics ThreadPools request.MutationStage TotalBlockedTasks", :state nil, :description nil, :metric 0, :tags nil, :time 1384844560, :ttl nil}
 

## Dancing with Dashboards

Starting out the dashboard in Riemann look underwhelming, but it soon becomes overwhelming when you realise the power it provides. After some trial and error I created a dashboard to show the:

* [1 minute average](https://github.com/codahale/metrics/blob/master/metrics-core/src/main/java/com/codahale/metrics/EWMA.java) write throughput per second.
* 95th percentile write request latency in microseconds.
* rolling graph of the local write latency with the request latency stacked on top. 

Using this simple layout.

![Riemann Dashboard)](/files/2013-11-15-4-hours-with-riemann/riemann-layout.jpg) 

To get the layout I selected the top tile in the example dashboard and split it using control+left arrow. This gave three tiles that I configured (select the tile and press "e") as:

* Top Left
  * Type: Gauge
  * Title: 1m Rate
  * Query: (service = " org.apache.cassandra.metrics ClientRequest Write Latency")
* Top Right
  * Type: Gauge
  * Title: 95% Latency (us)
  * Query: (service = " org.apache.cassandra.metrics ClientRequest Write Latency .95")
* Bottom
  * Type: Flot
  * Title: Request Latency
  * Graph Type: Bar
  * Stack Mode: Normal
  * Query: (service = " org.apache.cassandra.metrics ColumnFamily Keyspace1.Standard1 WriteLatency .95") or (service = " org.apache.cassandra.metrics ClientRequest Write Latency .95")

You can see an example of the dashboard updating in response to `cassandra-stress` [here](/files/2013-11-15-4-hours-with-riemann/riemann-example.mov)

This is simple but it has some _really_ nice features. First it's mucho fast and gives instant feedback on the latency and throughput. Second the graph makes it clear what is taking time to process the complete request. The pale blue at the bottom is the local write time as is usually less than 50us. This only measure the time the write thread spends updating the memtable and the secondary indexes. The larger yellow part of the line measures the complete request time which includes overhead, queue time and the time taken to update the commit log. This is the clearest illustration I've ever seen of the difference between `nodetool proxyhistograms` and `nodetool cfhistograms`. It's exactly what I hoped Riemann would do. 

## Next Steps

There are a few more steps I need to do. First ask Kyle to upload the `riemann-java-client` to Maven Central so I can easily add it to the `metrics-reporter-config`. Then tidy up my hack job on `metrics-reporter-config` and send a Pull Request to Chris. 

While that is going on it's time to get better acquainted with the Riemann stream processing language.

