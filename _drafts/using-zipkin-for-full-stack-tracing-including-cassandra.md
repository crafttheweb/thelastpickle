---
layout: post
title: Replacing Cassandra's tracing with Zipkin for full-stack tracing 
author: Mick
category: blog
tags: cassandra, zipkin, tracing
---

With Apache Cassandra positioned as the data platform de jure for the next evolution of software services amidst an enterprise moving ever towards microservices and BASE architectures, often the missing piece for many a development team is tracing and profiling difficult to reproduce production problems across distributed systems. 

## Introduction
This article covers the need for distributed tracing in the modern commercial development environment, goes into using Zipkin a solution from Twitter for distributed tracing, and finally to replace Cassandra's internal tracing with Zipkin so to present full-stack tracing where we have one tracing view across the entire system. 

The article is a write-up of my presentation [Distributed Tracing from Application to Database](http://cassandrasummit-datastax.com/agenda/distributed-tracing-from-application-to-database/) at Cassandra Summit 2015, Santa Clara. When the videos from the conference are up i'll post it here too.

## The need for distributed tracing

We're constantly seeing the need to scale data. It got formalised with the big data three V's volume velocity and variety, and we're seeing it in implementation coming at us in full force with technologies like Cassandra, Kafka, and Spark. Amongst these technologies it is Cassandra that serves as the data platform bringing us forth into this new age of BASE and lambdaa architectures, unudating outdated technologies like Oracle.

But it isn't just about scaling data – often solutions that need to scale data due to their success also face the more difficult problem of having to scale programmers and teams. We see this reality in how Microservices, a fresh revival of service orientated architecture, and DevOps deals with how we create postive cohesive cultures in our companies where teams are decentralised and automonous utilising Conway's law rather than fighting it.

With a combined need of scaling both data and people we're seeing again and again just how important it is that companies have in place up to date monitoring tools. Two of these tools Kibana and Grafana are becoming more popular and their usefulness quickly self-evident, but there's a third tool that's required to compliment the aggregation of logs and metrics. This third need is distributed tracing.

Zipkin is the tool that solves such distributed tracing. It will help you fix high 99th percentile latencies, identify who really are culprits to platform latencies, gives you a correlation ID useful to connect logs together, helps visualise hierarchy and asynchronicity of calls, and provide a greater level of transparency for all your company into your platform.

Nailing these three tools together really comes back to making the "architectural safety" components of microservices much easier to solve.


---
While monitoring provides information on system performance, tracing is necessary to understand individual request performance. Detailed query tracing has been provided by Cassandra since version 1.2 and is invaluable when diagnosing problems. Although knowing what queries to trace and why the application makes them still requires deep technical knowledge. By merging application tracing via Zipkin and Cassandra query tracing we automate the process and make it easier to identify and resolve problems. He will then propose an extension that allows clients to pass a trace identifier through to Cassandra, and a way to integrate Zipkin tracing into Cassandra. Driving all this is the desire to create one tracing view across the entire system. 
