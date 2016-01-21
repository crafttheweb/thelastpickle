---
layout: post
title: Seattle Area Cassandra Meetup January 2015
author: Nate McCall
category: speaking
tags: cassandra, meetup
---

Last night, I spoke at [Seattle Area Cassandra Meetup](http://www.meetup.com/Cassandra-Seattle-Users/events/227675496/)
delivering the latest version of my securing cassandra talk. Unfortunately, giving this talk reminds of the evangelizing I did in the early days of Apache Cassandra. System security topics, much like explaining "distributed systems" to the average Java developer back in 2010, tend to give most people glazed expressions.

To combat this, I like to point out that one can quite easily craft a Cassandra node-to-node message which can, say, insert an administrative user or simply just drop an arbitrary table. That tends to wake folks up pretty quickly. Fortunately, enabling node-to-node SSL makes this problem go away (given you are using client certificate authentication - don't bother enabling encryption if you don't). 

To find out more about the above as well as how to do authentication and authorization, client to server encryption, encryption at rest, and securing management and tooling in Cassandra, see my slides which are available on [here](http://www.slideshare.net/zznate/seattle-c-meetup-hardening-cassandra-for-compliance-or-paranoia).
