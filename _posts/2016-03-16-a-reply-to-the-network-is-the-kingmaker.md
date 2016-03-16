---
layout: post
title: A Reply to The Network is the Kingmaker
author: Mick Semb Wever
category: blog
tags: cassandra, zipkin, opentracing, distributed tracing
---


Last week [Sudip Chakrabarti](https://twitter.com/chakrabartis) from Lightspeed Venture Partners published the [blog post](https://medium.com/lightspeed-venture-partners/in-the-land-of-microservices-the-network-is-the-king-maker-37de7ec4119a#.rnoj7917f) 'In the land of microservices, the network is the king(maker)'. The writeup captures the Zeitgeist; foreseeing the pain and solution many large systems around us will face as they migrate to distributed architectures. Written so well I've felt compelled to do more than just retweet.

## Architectural Safety, Monitoring and Deployment

A common theme in many of my presentations from London to San Francisco is how many companies are running blind while adopting Microservices. On the back of the new discipline of DevOps and a revamped made relevant concept of Service Orientated Architecture; Microservices is stepping in to solve the both the technical problems of distributed computing and the human factors of parallel autonomous teams working on shared products. Behind the need for scaling teams as well as the code Microservices emphasizes the infrastructural importance of distributed code. In fact three of the four categories: Architectural Safety, Monitoring and Deployment; found within Microservices touches as much upon the infrastructure underneath and around your distributed design as it does the design itself.

![Image of Microservices Categories](/files/2016-03-16-a-reply-to-the-network-is-the-kingmaker/reply-to-the-network-is-the-kingmaker-microservices_500w.png)


> But as the world adopts Microservices does it have the right infrastructure tools to monitor and manage such distributed applications and architecture. – Sudip Chakrabarti

Sudip writes to the importance of having the right infrastructure tools in place. I'd go even further than this to say these tools often themselves must be solid distributed technologies. We see this in the existing tools out there. Kibana and the ELK stack have become a steadfast asset in the infrastructural toolbag for many a company. Grafana on the other hand has faced many a problems like Graphite underneath it having been built in a way that didn't scale. Not only must the infrastructural tools that support your product be able to scale, they must be as stable if not more stable than the production platform itself. You can't build architectural safety into your product if you don't have accurate reliable insight into the platform, especially when everything is on fire.

## The Missing Piece in Microservices

> Infrastructure tools in a distributed environment move from instrumentation of the code, to instrumentation of the network. As all API calls now go over that network, capturing this from packet-level traffic to application telemetry data instrumentation means now runtime insight can exceed what it could in the non-distributed world. – Sudip Chakrabarti

This leads to the introduction of [distributed tracing](http://opentracing.io/), [correlation identifiers](https://vimeo.com/99531595), and network transparency. Kibana and Grafana, the two standard infrastructural tools we have today, don't address the central message in Sudip's blog. Both address the need to aggregate information from a distributed environment into one place for accurate insight, but neither go all the way in understanding that we must now have insight into the gaps between our services, not just the services themselves.

> Microservices and Containers are stitched together by the network. – Sudip Chakrabarti

Microservices does touch on the relevance of the gaps by recommending the use of correlation identifiers across services: these then stitch individual requests together. Mightily useful, now in Kibana a search for a correlation ID and you have all the logs across the platform for just that one request, it still does not go all the way in really comprehending that the *Network is King*.

The third infrastructural tool that is missing and steps in to really take advantage of our use of the network is Distributed Tracing. In my presentations it has been [Zipkin](http://zipkin.io/) presented as the scaling solution that provides such Distributed Tracing for your platform.

![Image of Kibana, Grafana, and Zipkin.](/files/2016-03-16-a-reply-to-the-network-is-the-kingmaker/reply-to-the-network-is-the-kingmaker-kibana-grafana-zipkin_500w.png)

## Distributed Tracing

Zipkin provides this correlation identifier, and along with instrumenting your code presents you with a rich insight into your distributed design otherwise not seen. Zipkin is a solution that is gaining momentum quickly; from being able to be [plugged into Cassandra](http://thelastpickle.com/blog/2015/12/07/using-zipkin-for-full-stack-tracing-including-cassandra.html) as its tracing implementation, to being a solution now rewritten into multiple different languages and available ready to go in different container technologies. Twitter recently supported handing its Zipkin code completely back into community hands, which now sees a number of companies participating. On the back of this one of the authors to Google's [Dapper paper](http://research.google.com/pubs/pub36356.html): [Benjamin H Sigelman](https://github.com/bensigelman); has started the [OpenTracing](http://opentracing.io/) initiative, looking to create a common distributed tracing specification that different tracing instrumentations can jump behind. This is exciting momentum, an exciting moment, in our industry and an important step forward in our maturity in Microservices.

If you haven't already I recommend you to go read Sudip Chakrabarti post [In the land of microservices, the network is the king(maker)](https://medium.com/lightspeed-venture-partners/in-the-land-of-microservices-the-network-is-the-king-maker-37de7ec4119a#.rnoj7917f).
