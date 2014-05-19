---
layout: post
title: JMX Management over SOCKS Proxy
author: Patricia Gorla
category: blog
tags: cassandra, monitoring, ssh, jmx
---

"Applications are meant to be long-running."

Cassandra is meant to be long-running. It can be days and weeks before a node is restarted and new configurations updated. When database downtime translates to money lost, every second is important.

Examining system internals and adjusting settings can't afford to be only on a restart basis, so sysadmins and DBAs have to look elsewhere. Java comes with "Java Management Extensions" (JMX), toolings that allow certain system objects (MBeans) to be monitored and adjusted.

Cassandra uses JMX extensively: tools such as nodetool and OpsCenter monitor cluster health through such MBeans.

Java classes that wish to expose JMX access implement the MBean interface with the methods and attributes to be made available.

### JMX

One such example, `FailureDetectorMBean.java`, exposes read access to endpoint state, endpoint count, inter arrival times, and read/write access to the phi convict threshold (a measure of health for the node).

FailureDetectorMBean.java
```java
package org.apache.cassandra.gms;

...

public interface FailureDetectorMBean
{
    public void dumpInterArrivalTimes();

    public void setPhiConvictThreshold(double phi);

    public double getPhiConvictThreshold();

    public String getAllEndpointStates();

    public String getEndpointState(String address) throws UnknownHostException;

    public Map<String, String> getSimpleStates();

    public int getDownEndpointCount();

    public int getUpEndpointCount();
}

```

The main `FailureDetector.java` class implements these methods to allow visibility into the application through tools such as [JConsole](http://docs.oracle.com/javase/6/docs/technotes/guides/management/jconsole.html) and [jmxterm](http://wiki.cyclopsgroup.org/jmxterm).

### Connecting via JConsole

In one shell, start Cassandra locally with `bin/cassandra -f`. On another shell, start JConsole on your machine with `jconsole`, and make sure port 7199 is accessible.

The screen will automatically populate with a list of running Java programs.

Click through to the CassandraDaemon view. The first five tabs — Overview, Memory, Threads, Classes, VM Summary — show Java runtime statistics, while the last tab, MBeans, give access into the running application.

The **Memory** tab gives a purview into the health of the JVM. You can review the different memory pool generations, and heap and non-heap usage. JConsole also has a button to "Perform GC", though _caveat emptor_ with such functionality.

**Threads** and **Classes** both offer glimpses into their namesakes, while **VM Summary** gives a dated report on the state of the JVM. This is useful for collecting system overviews.

Finally, the **MBeans** tab offers tooling and insight into Cassandra.

#### `o.a.c.db`
This package includes access to the ColumnFamilyStore.

`ColumnFamilyStoreMBean.java`
```java
package org.apache.cassandra.db;

...

/**
 * The MBean interface for ColumnFamilyStore
 */
public interface ColumnFamilyStoreMBean
{
    ...

    /**
     * Sets the compaction strategy by class name
     * @param className the name of the compaction strategy class
     */
    public void setCompactionStrategyClass(String className);

    /**
     * Gets the compaction strategy class name
     */
    public String getCompactionStrategyClass();

    public boolean isAutoCompactionDisabled();

    public long estimateKeys();

    /**
     * Returns a list of filenames that contain the given key on this node
     * @param key
     * @return list of filenames containing the key
     */
    public List<String> getSSTablesForKey(String key);

    /**
     * Scan through Keyspace/ColumnFamily's data directory
     * determine which SSTables should be loaded and load them
     */
    public void loadNewSSTables();

    /**
     * @return the number of SSTables in L0.  Always return 0 if Leveled compaction is not enabled.
     */
    public int getUnleveledSSTables();

    /**
     * @return sstable count for each level. null unless leveled compaction is used.
     *         array index corresponds to level(int[0] is for level 0, ...).
     */
    public int[] getSSTableCountPerLevel();

    /**
     * Get the ratio of droppable tombstones to real columns (and non-droppable tombstones)
     * @return ratio
     */
    public double getDroppableTombstoneRatio();

    /**
     * @return the size of SSTables in "snapshots" subdirectory which aren't live anymore
     */
    public long trueSnapshotsSize();
}
```

From here, we can gain an estimate of how compaction is faring on this column family.

[figure]

#### `o.a.c.net`

Failure detection in Cassandra is an implementation of Hayashibara's [The φ Accrual Failure Detector](http://ddg.jaist.ac.jp/pub/HDY+04.pdf), which samples node heartbeats and message arrival times, and then compares these values against the past distribution. Nodes with a slower response time are not immediately marked as unresponsive, and given a chance to recover.

The `FailureDetector` MBean allows direct access to update the `PhiConvictThreshold` and monitor arrival times of each node heartbeat.

[figure]

JConsole is great for tweaking Cassandra clusters locally, but it cannot access remote clusters without a username/password combo.

### Connecting via SSH SOCKS PROXY

Fortunately, we can set up a [SOCKS proxy connection](http://en.wikipedia.org/wiki/SOCKS) using SSH.

The SOCKS proxy transmits TCP connections through the proxy server. This means that any request -- HTTP or otherwise -- is viewed as originating from the proxy server. It's an effective way of bypassing the firewalls in place on a computer, as well as masking the origin of a request.

We will use the `-D` flag to route all remote traffice through a specified port.
```
-D [bind_address:]port
             Specifies a local ``dynamic'' application-level port forwarding.  This works by allocating a socket to listen to port on the local side, optionally bound to the specified bind_address.  Whenever a connection is made to this port, the connection is forwarded over the secure channel, and the application
             protocol is then used to determine where to connect to from the remote machine.
			 
-N           Do not execute a remote command.  This is useful for just forwarding ports (protocol version 2 only).
```

Setting up the proxy server is simple with using the `-D` flag and a unique port. Add `-v` for verbosity, and `-N` to set up an interruptable connection to the server.

```
$ ssh -vND 9999 vpn
OpenSSH_6.2p2, OSSLShim 0.9.8r 8 Dec 2011
...
debug1: Entering interactive session.
```

Next, open up 'System Preferences > Network > Advanced > Proxies', and enable the SOCKS proxy on localhost:9999.

[figure]

Now you are connected to the remote server. Make sure to turn off any other applications that use a network; that traffic will be routed through the proxy.

* Connecting to JConsole remotely

Now you can connect to any remote process as if it were on your machine.

Start jconsole and add 'localhost:7199' as a remote entry.

[figure]

You're now connected to Cassandra, and can change the values while the process is running. Make sure to monitor the logs for any anomalies while updating the configuration.
