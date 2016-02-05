---
layout: post
title: Locking Down Apache Cassandra Logging
author: Nate McCall
category: blog
tags: cassandra, security, configuration, information exposure, logging
---

# Background

Since versions of Cassandra dating back to `0.4`, the ability to set logging levels dynamically has been available. Before I go any further, I want to make it clear that dynamic log level adjustment is A Very Good Thing. Unfortunately for security conscious installations, this can cause issues with information exposure. For many, this may seem trivial, but it is minor issues like this that can put an enterprise in violation of industry regulations, potentially creating serious liability concerns.

In this post, i'll detail the three different ways of adjusting the logging levels. Then we'll see what happens when we turn up the level to `TRACE`. We'll then demonstrate how to disable dynamic logging in both the Logback configuration and via JMX.

## Methods of Runtime Adjustment

Listed below are the three different mechanisms which can be used to adjust logging levels at runtime in Apache Cassandra. In each example, we are setting the logging level of the `org.apache.cassandra.transport` package to TRACE.
1. Using the `nodetool` utility

    nodetool setlogginglevel org.apache.cassandra.transport TRACE

2. Using JMX to invoke `setLoggingLevel` on `org.apache.cassandra.db.StorageServiceMBean`

  ![Using JConsole to set log levels](/images/cassandra-logging-jmx.png)

3. Update the `logback.xml` configuration file and having it dynamically reload by adding this at the bottom, just above the closing `</configuration>` element.

    <logger name="org.apache.cassandra.transport" level="TRACE"/>

Regardless of the method used, a quick check of the `$CASSANDRA_HOME/logs/system.log` file will show something similar to the following:

    INFO  [RMI TCP Connection(22)-127.0.0.1] 2016-02-05 19:43:57,440 StorageService.java:3321 - set log level to TRACE for classes under 'org.apache.cassandra.transport' (if the level doesn't look like 'TRACE' then the logger couldn't parse 'TRACE')

Unfortunately, we won't know if we have typed everything correctly until it starts printing messages. Each of the three approaches detailed above will happily accept typos in either the class/package name or logging level.     

### Looking at What Happens

Now that we are in trace mode, let's go over to `cqlsh`. We'll create a simple users table for our example:

    CREATE KEYSPACE tlp_example WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
    USE tlp_example;
    CREATE TABLE user_data (
        user_id uuid,
        email TEXT,
        tax_id TEXT,
        PRIMARY KEY (user_id)
    );

With this table created, let's insert a row, then select it back out:

    INSERT INTO user_data (user_id, email, tax_id) VALUES (now(), 'nate+logex@thelastpickle.com','abc123');
    SELECT * FROM user_data;

Now, let's go have a look at the log output (note that as of version 2.2, DEBUG and higher will [by default](https://github.com/apache/cassandra/blob/trunk/conf/logback.xml#L51-L64) be located in `$CASSANDRA_HOME/logs/debug.log`):

    TRACE [SharedPool-Worker-1] 2016-02-05 19:44:00,154 Message.java:506 - Received: OPTIONS, v=4
    TRACE [SharedPool-Worker-1] 2016-02-05 19:44:00,154 Message.java:525 - Responding: SUPPORTED {COMPRESSION=[snappy, lz4], CQL_VERSION=[3.4.0]}, v=4
    TRACE [SharedPool-Worker-1] 2016-02-05 19:44:00,158 Message.java:506 - Received: OPTIONS, v=4
    TRACE [SharedPool-Worker-1] 2016-02-05 19:44:00,158 Message.java:525 - Responding: SUPPORTED {COMPRESSION=[snappy, lz4], CQL_VERSION=[3.4.0]}, v=4
    TRACE [SharedPool-Worker-1] 2016-02-05 19:44:09,341 Message.java:506 - Received: QUERY select * from user_data;[pageSize = 100], v=4
    TRACE [SharedPool-Worker-1] 2016-02-05 19:44:09,341 QueryProcessor.java:201 - Process org.apache.cassandra.cql3.statements.SelectStatement@30febfee @CL.ONE
    TRACE [SharedPool-Worker-1] 2016-02-05 19:44:09,346 Message.java:525 - Responding: ROWS [user_id(tlp_example, user_data), org.apache.cassandra.db.marshal.UUIDType][email(tlp_example, user_data), org.apache.cassandra.db.marshal.UTF8Type][tax_id(tlp_example, user_data), org.apache.cassandra.db.marshal.UTF8Type]
     | db8f7a00-cc3e-11e5-b248-091830ac5256 | nate+logex@thelastpickle.com | abc123
     | 19be0e40-cc3f-11e5-b248-091830ac5256 | nate+logex@thelastpickle.com | abc123
    ---, v=4

As we can see, not only do we have the contents of the select statement, but the String-ified output from the response. As an example, if you worked for a TelCo in the United States, and you did this on a production system while troubleshooting something, you basically just did an end-around of the security requirements regarding customer information, particularly if you use a log aggregation system.

So, are these information exposure bugs? No. These are useful outputs for debugging. The point at which I would draw the line would be printing authentication credentials in a logging statement (which [has happened](https://issues.apache.org/jira/browse/CASSANDRA-9682), but was immediately corrected when discovered).

Regardless of what your requirements are around exposure, the following two sections detail how to disable runtime modification of logging levels.

#### Configuration Reloading

As detailed above, Cassandra makes use of the built-in Logback API's configuration file reloading feature [detailed here](http://logback.qos.ch/manual/configuration.html#autoScan). By default, Cassandra (via Logback) will scan `logback.xml` for changes once per minute, applying any modifications found.

This reloading mechanism can be disabled by setting the `scan` attribute from the top-level `configuration` [element](https://github.com/apache/cassandra/blob/trunk/conf/logback.xml#L25) to `false`. When not present, `scan` is considered to be `false`, but as with any security-sensitive default configuration change, you should set it explicitly to make the intention clear.

#### Dynamic Adjustment

Though the logging levels can be explicitly controlled via `logback.xml`, by default the `StorageSeriviceMBean` exposes a `setLoggingLevel` method which will dynamically adjust the logging level of an arbitrary class or package qualifier to any level, including `TRACE`. This functionality can be accessed via JMX at both the MBean level and via `nodetool setlogginglevel` command (which itself invokes the MBean) as we saw in the example above.

For both cases, this functionality can be removed by removing the `<jmxConfigurator />` [element](https://github.com/apache/cassandra/blob/trunk/conf/logback.xml#L26) present in `logback.xml`. This disables the JMX logging endpoint, making either invocation a no-op.

## Summary

Dynamically adjusting the logging levels of Apache Cassandra at runtime is a useful feature. However, some operators might be surprised at the amount of information that can leak into logs when `TRACE` logging is enabled on certain classes. Knowing how to disable dynamic log adjustment by using the approaches described above can provide security conscious environments the control they need to keep this from happening. 
