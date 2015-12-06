---
layout: post
title: Replacing Cassandra's tracing with Zipkin
date: 2015-12-07 08:00:00+00:00
author: Mick Semb Wever
category: blog
tags: cassandra, zipkin, tracing
---

Integrating Zipkin tracing into Cassandra, it's possible to create one tracing view across an entire platform.  The article is a write-up of the [Distributed Tracing from Application to Database](http://cassandrasummit-datastax.com/agenda/distributed-tracing-from-application-to-database/) presentation at Cassandra Summit 2015, Santa Clara. 


## Introduction
This article covers the need for distributed tracing in our modern development environment, and looks at using Zipkin as a way to achieve that. Zipkin is a solution from Twitter, specialised for distributed tracing. In addition, this write up looks into replacing Cassandra's internal tracing with Zipkin to present full-stack tracing where we have one tracing view across the entire system. 


## The need for distributed tracing

We're constantly seeing the need to scale data. It has been formalised with big data's three V's: volume velocity and variety; and now we're seeing it implemented with technologies like Cassandra, Kafka, and Spark. Amongst these technologies it is Cassandra that gives us the data platform. But with all these technologies we've been brought forth into this new age of BASE and lambda architectures, unudating the outdated technologies like Oracle. XXX

And it isn't just about scaling data – often solutions that need to scale data due to their success also face the more difficult problem of having to scale programmers and teams. We see this reality in how Microservices, which is really just a fresh revival of Service-orientated Architectures, and DevOps deals with how to create postive cohesive cultures in our companies where teams are decentralised and automonous, taking advantage of Conway's law rather than fighting against it.  XXX

So with a combined need to scale both data and people, we're seeing how important it is that companies have modern monitoring tools in place. Two of these tools [Kibana](https://www.elastic.co/webinars/introduction-elk-stack) and Grafana are becoming more popular and their usefulness quickly self-evident. adding to this there's a third tool to compliment the aggregation of logs and metrics. This third tackles the problem of distributed tracing. XXXX


![The Magic Three](/images/using-zipkin-kibana-grafana-zipkin.png)

Zipkin is the tool that solves the distributed tracing problem. It helps you fix high 99th percentile latencies, [XXX] quickly identify the culprits for platform latencies, provides a correlation ID useful to connect logs together, helps visualise hierarchy and asynchronicity of calls, and gives a greater level of transparency into your platform for the whole company.

Bringing these three tools together is crucial in making distributed decentralised teams fully capable of solving the "architectural safety" challenges of microservices. With the correct development methodologies and supporting DevOps tools, teams quickly find themselves in a high quality 'stable master' development cadence where production exceptions are rare and short-lived occurances. The core infrastructure code doesn't fester and expand with half-thought through bug fixes from a culture of someone-elses-problem and inadequite tools to fully see into the faults. Instead a product is built where no user is left out. A positive cohesive culture is established where teams deploying new features and improvements become aware of bugs and collateral damage they cause to other teams, well before those teams see the problems themselves. Such a level of quality assurance implicit within development practices of continuous delivery in turn makes other aspects of incremental development easier, like [dark launching ]() where whole microservice implementations can seamlessly switched out without any platform coordination.  XXX

The cultural benefits of having these modern DevOp tools in place is interesting as it's not just about building more positive collaborative relationships between teams but building a more productive and responsible relationship between teams and middle management. Microservices is about decentralising teams and giving them autonomy, and the role of Architects and middle management changes once these things are in place and functional, as they become more facilators and communicators.

From my own experience, tackling the cultural challenges in a company is not only the most important work but always the hardest. When such challenges can be solved with simple hacks like putting in place the correct tools which change people's behaviour without having to ask anyone to change their behaviour it's nothing to scoff at, and that's our introduction to installing Zipkin, along with Grafana and Kibana.  XXX

## Zipkin

Zipkin is an implementation of Google's Dapper paper from 2010. Google took a relatively simple approach by instrumenting running applications to send simple messages or annotations marking when a call to another service has been made and received. By having a separate service responsible solely for collecting these instrumentation messages, the problem of distributed tracing could be solved. The paper does say that the hardest part of distributing tracing is not the supporting software but the instrumentation that's required across all the codebases in the platform.

### Zipkin Web UI

When it comes to explaining how Zipkin works it's easier if we start with the user's experience against the web UI and afterwards deal with the instrumentation requirements. The web UI has three main components: searching for traces, browsing those search results, and investigating an individual trace.

Searching for traces is done against time, the services involved, or even against specific annotations with a trace.

![Searching in Zipkin](/images/using-zipkin-search-0.png)

With the search results you can quickly see how many services, or for example network hops, were involved and the duraction of each trace, and to which services were involved in each. It's also possible to sort to show the longest traces first, making it easy to tackle poor 99th percentile latencies.

![Browsing in Zipkin](/images/using-zipkin-search-1.png)

The top of the trace page shows you the duration, and the number of services and spans involved. Under that you can see the call hierarchy with the user's initial request being made that took 195ms here and then all the underlying services or spans represented by the light blue stagger bars all the way down to database calls. In this example you can see that none of these spans executed concurrently, it all happened synchronously and sequentially.

![Zipkin traces](/images/using-zipkin-trace.png)

The visualisation of the trace page is also possible via the zipkin brower plugin, for example here in firefox it gets added to the firebug extension. The plugin polls the zipkin server for updates to the specific trace displaying them near realtime. Useful when developing webpages and insightful for frontend developers as they stay in touch and aware of all the underlying services currently underneath the front end applications they are coding. Working in this manner usually suits decentralised autonomous teams . Having this type of information easily available also prevents blaming and finger pointing as to who's to fault for services not working and performing slowly and letting the platform down , something that is useful also in testing environments.

![Zipkin dependency graph](/images/using-zipkin-graph.png)

The transparency to the platform isn't just for the front end developers either.  Being able to aggregate traces on a daily basis into a call or runtime service dependency graph goes a long way for architects and management to understand accurately how things work, inundating much of the need for higher level documentation. 

## Zipkin Internals

How does it all work. It really is very basic. Each span is initiated by the client with a "Client Send" or CS annotation. If the trace headers are exposed into the protocol being used and the server has zipkin instrumentation implemented then the server will pick up these trace headers in the incoming request and initiate the server started the same span with a "Server Received" or SR annotation. Once the server has processed the request and finishing the response it notes this with a "Server Send" or SS annotation. When the client has the complete response it completes the span with a final "Client Received" or CR annotation. 

These instrumentation annotations can be sent to the zipkin server individually, but what is typically the case is that the annotations are buffered and sent altogether once either the server or client has finished their part of the span.

![Zipkin architecture](/images/using-zipkin-architecture.png)

Take for example some code from a client making a request to a server that we want to trace.  For example some code that's making a rest call, might even be using apache's httpclient.

To put that tracing in, using the zipkin brave java library and its clientTracer class, is just a matter of wrapping a few lines of code around that call. This makes those CS and CR annotations which is enough to visualise the span in zipkin.

![Zipkin simple instrumentation](/images/using-zipkin-simple-cs-cr.png)

The same thing can be done around a call to cassandra.
Here's an example execute statement using the datastax cql driver.
And here's the wrapping tracing lines.

![Zipkin cassandra instrumentation](/images/using-zipkin-simple-cs-cr-cassandra.png)

This is enough to create the spans in zipkin, but tracing won't continue onwards into the server or database. To do that you need to pass the tracing headers, a trace id and a span id, over the protocol. In the http protocol this is easy as they just go in as request's headers.

![Zipkin instrumentation with headers](/images/using-zipkin-cs-cr-with-headers.png)

## Tracing in Cassandra
So how does tracing work in Cassandra in comparison?

Tracing came to Cassandra in 1.2
It was intended specifically to address those requests creating latency.
While it referenced the more complicated ways of tracing it explicitly was stated that a sophisticated approach wasn't needed. Tracing individual requests or turning on sampling and going off and hunting for those poor requests can really help in speeding up a platform and fixing some of the hairy bugs.

![Cassandra tracing](/images/using-zipkin-c-tracing.png)

The code that does the tracing in cassandra in found in the tracing package and there's surprisingly little to it, just four classes: ExpiredTraceState, TraceKeyspace, TraceState, and Tracing.

The flow to how the tracing works is like this. The only "annotations" in cassandra are the trace(..) calls which emit trace msgs at fixed points of time relative to when the request started.

            CO-ORDINATOR NODE                    REPLICA NODE
            -->
            beginSession(..)
                trace(..)
                trace(..)
                                            --> initialiseMessage(..)
                                                    trace(..)
                                                    trace(..)
                                            <--
                trace(..)
            endSession(..)
            <--

## Replacing Cassandra tracing with Zipkin
By replacing this code with zipkin tracing there's a lot to gain.  The obvious is that the visualisation. But also more detailed timings, and it'll become clearer to see the hierarchy and asynchronisity of calls. It also becomes a tracing solution that has basically zero overhead. Rather that having a massive write amplification for all the trace annotations going back into the same cassandra it's now possible to offload that entire workload efficiently out onto separate infrastructure.

This work has been done under [CASSANDRA-10392](https://issues.apache.org/jira/browse/CASSANDRA-10392). Here's a screenshot of the results on just one node, and you can see already that for a lot of new developers to cassandra this is going to explain a lot much faster.

![Cassandra Zipkin tracing](/images/using-zipkin-single-node.png)

To achieve this only two classes: Tracing and TraceState; needed to be subclass and one chunk of functionality moved into a new method in one of those classes so it could be overridden.

## Zipkin Tracing across Cassandra nodes
Building on this the code needs to do tracing across nodes. This involves the messaging service in cassandra. The messaging service has an arbitary map, much like http headers, that arbitary key-values can be added to. Adding those zipkin headers in there, and reading them out again when we're initialising a message and tracing across nodes is solved.

![CCM Zipkin tracing](/images/using-zipkin-ccm.png)

This is looking really cool, and as a cassandra consultant this would make life a lot easier in a number of situations.

## Full-stack Cassandra Zipkin Tracing
The last thing to do is to complete the idea of zipkin doing proper distributed tracing through all applications. Somehow the Zipkin trace headers need to be propagated in with Cassandra requests so that the zipkin trace displayed further above continous seamlessly into the Cassandra coordinator and further in to each of the Cassandra's replica nodes.

To achieve this it's to take advantage of the work done in [CASSANDRA-855]() that was released in Cassandra 2.2, which allows us to pass in arbitrary headers from client to server behind the scenes to a CQL request. Similar to the example with http headers it's the traceId and the spanId we need to pass over the protocol. Here it's to serialise the traceId and spanId in the one byte buffer and put it into the outgoing payload.

![Full stack Zipkin tracing](/images/using-zipkin-cs-cr-with-payload-cassandra.png)

By connecting together our client applications and the cassandra database we're going to 1) solve faster a lot of bugs that are immediately known if they're client-side or server-side, and 2) give more intuitive feedback to the platform developers on how cassandra works internally.

![Full stack Zipkin tracing](/images/using-zipkin-full-stack-trace.png)

This shows a whole new world of distributed tracing, across one's platform and into distributed technologies like Cassandra. And it can be taken further… for example tracing could be visualised for anti-entropy repairs and compactions, helping to solve such problems as bad disks or cross-dc issues.

## Summary
While monitoring provides information on system performance, tracing is necessary to understand individual request performance. Detailed query tracing has been provided by Cassandra since version 1.2 and is invaluable when diagnosing problems, although knowing what queries to trace and why the application makes them still requires deep technical knowledge. By merging application tracing via Zipkin and Cassandra query tracing we automate the process and make it easier to identify and resolve problems. Going further and proposing an extension that allows clients to pass a trace identifier through to Cassandra, and a way to integrate Zipkin tracing into Cassandra, creates one tracing view across the entire system. 

The video for this talk presented at Santa Clara's Cassandra Summit in 2015 is available [here](https://vimeopro.com/user35188327/cassandra-summit-2015/video/144237635).


